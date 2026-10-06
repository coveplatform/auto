import fs from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeJSON, imageBlock, textBlock } from "./claude";
import { config } from "./config";
import { db, getBusiness, getFoundation, getScan, parseJSON, setBusinessStatus, type Business } from "./db";
import { assetsDirFor, extractSite } from "./extract";
import { briefText, checkClaims, contactSheet, corpus, getIndustryBrief, isVerbatim, type IndustryBrief } from "./design";
import type { Qualification } from "./qualify";
import { readShotBase64, type SiteMetrics } from "./scan";
import type { Extraction } from "./templates/content";

/**
 * The redesign foundation: strategy + creative direction + homepage narrative for ONE business,
 * written before anything is built. You approve it, then the custom builder works from it.
 *
 * Passes (one model, several specialised prompts):
 *   1. Researcher      — facts about the business only, no design opinions   (text)
 *   2. UX auditor      — what's wrong with the current site and why         (screenshots)
 *   3. Creative director — positioning, creative concept, visual system     (screenshots + photos)
 *   4. Information architect + copy director — navigation, homepage story, section copy
 *   5. Critic          — hunts clichés, generic AI choices, inconsistencies, then revises
 */

type Content = Anthropic.Beta.BetaContentBlockParam[];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ResearchSchema = z.object({
  summary: z.string().describe("2-3 sentences: what this business actually is and sells, plainly."),
  offerings: z.array(z.object({ name: z.string(), detail: z.string() })).describe("What they sell, most valuable first, from the source only."),
  location: z.string().describe("Where they operate / service area, only as stated."),
  likely_customers: z.array(z.string()).describe("Who buys, inferred from the offerings and copy. Mark inferences as such."),
  primary_conversion: z.string().describe("The single highest-value action a visitor can take (call, book, quote request, order…)."),
  secondary_conversions: z.array(z.string()),
  credibility: z.array(z.object({ asset: z.string(), evidence: z.string() })).describe("Real trust assets with where they appear (reviews, years, licences, clients, photos of work). Only what the source shows."),
  useful_content: z.array(z.string()).describe("Existing content worth carrying over."),
  outdated_or_weak: z.array(z.string()).describe("Content that is stale, redundant, or hurts."),
  unknowns: z.array(z.string()).describe("Facts a designer would want but the site doesn't state (do NOT guess them)."),
});
export type Research = z.infer<typeof ResearchSchema>;

export const AuditSchema = z.object({
  current_perception: z.string().describe("How the business comes across today in a few words, e.g. 'dated local limousine operator'."),
  first_impression: z.string().describe("What a visitor understands and feels in the first 5 seconds on desktop and on mobile."),
  issues: z
    .array(
      z.object({
        area: z.enum(["hierarchy", "typography", "spacing", "colour", "imagery", "navigation", "mobile", "cta", "trust", "conversion", "content", "brand"]),
        observation: z.string().describe("Concrete and evidenced, e.g. 'Seven competing actions above the fold'."),
        severity: z.enum(["high", "medium", "low"]),
      }),
    )
    .describe("Most important first. 6-12 items."),
  dated_patterns: z.array(z.string()),
  what_works: z.array(z.string()),
  brand_equity: z.array(z.string()).describe("Things the owner and customers likely recognise and that should survive the redesign (name styling, logo, a colour, a photo, a phrase)."),
});
export type Audit = z.infer<typeof AuditSchema>;

const Colour = z.object({
  name: z.string().describe("e.g. 'Ink', 'Warm ivory'"),
  hex: z.string().describe("#RRGGBB"),
  role: z.string().describe("e.g. 'page background', 'primary text', 'accent: CTAs only'"),
});
const Face = z.object({
  family: z.string().describe("Exact Google Fonts family name."),
  weights: z.array(z.number().int()),
  usage: z.string(),
});

export const DirectionSchema = z.object({
  business: z.object({
    name: z.string().describe("Exactly as the business writes it."),
    industry: z.string(),
    location: z.string(),
    offer: z.string().describe("One sentence, what they sell and to whom."),
    primary_conversion: z.string(),
    secondary_conversions: z.array(z.string()),
  }),
  diagnosis: z.object({
    current_perception: z.string(),
    desired_perception: z.string(),
    opportunity: z.string().describe("A paragraph: the redesign opportunity and the single biggest shift to make."),
    keep: z.array(z.string()),
    remove: z.array(z.string()),
    elevate: z.array(z.string()),
  }),
  audience: z.object({
    primary: z.string(),
    secondary: z.string().nullable(),
    needs: z.array(z.string()),
    anxieties: z.array(z.string()),
  }),
  positioning: z.object({
    statement: z.string().describe("Position this as X rather than Y — specific and opinionated."),
    differentiators: z.array(z.string()).describe("Only real ones supported by the source."),
    personality: z.array(z.string()).describe("4-6 adjectives."),
    tone_of_voice: z.string(),
  }),
  creative_direction: z.object({
    concept: z.string().describe("A short name for the concept, e.g. 'Quiet automotive editorial'."),
    summary: z
      .string()
      .describe("A paragraph a designer could act on: what the visual language sits between (e.g. 'a premium automotive campaign, a contemporary hotel and Melbourne hospitality branding'), the palette mood, what it rejects."),
    references: z.array(z.object({ name: z.string(), why: z.string() })).describe("4-6 real brands/sites/design movements to borrow from, with what to take from each."),
    avoid: z.array(z.string()).describe("Clichés and generic choices for THIS business and industry."),
  }),
  visual_system: z.object({
    colours: z.array(Colour).describe("4-7 tokens covering background, surface, text, muted text, line, accent."),
    typography: z.object({ display: Face, body: Face, scale: z.string().describe("Size scale and leading, e.g. 'Display 72/0.95 desktop, 44 mobile; body 17/1.6'.") }),
    layout: z.object({
      grid: z.string(),
      spacing: z.string().describe("e.g. '120-160px between sections on desktop, 72px on mobile'"),
      radius: z.string(),
      density: z.string(),
    }),
    motion: z.string(),
    components: z.array(z.string()).describe("Rules for buttons, links, cards/lists, forms, header, footer."),
  }),
  photography: z.object({
    direction: z.string().describe("What the photos should show and feel like."),
    treatment: z.string().describe("Crops, contrast, colour grading, scale."),
    site_photos: z.array(z.object({ index: z.number().int(), use: z.string() })).describe("Which of the business's own photos (#index) to use and where. Never use weak or tiny ones big."),
    stock: z
      .array(z.object({ slot: z.string().describe("e.g. 'hero', 'brand-moment'"), query: z.string().describe("3-6 word searchable stock query") }))
      .describe("Max 4. Only for mood slots the business has no suitable photo for. Never for products, work, team or the owner."),
    avoid: z.array(z.string()),
  }),
  logo_index: z.number().int().nullable().describe("Best logo candidate #index, or null to set the name as a typographic wordmark."),
});
export type Direction = z.infer<typeof DirectionSchema>;

const SectionPlan = z.object({
  id: z.string().describe("kebab-case anchor id"),
  name: z.string(),
  purpose: z.string().describe("Why it sits here in the story and what the visitor should feel/know after it."),
  layout: z.string().describe("Concrete: grid, alignment, image placement, scale, background."),
  content: z.object({
    eyebrow: z.string().nullable(),
    headline: z.string().nullable(),
    body: z.string().nullable(),
    items: z.array(z.string()).describe("List items / services / steps / verbatim testimonials (with name) etc."),
    cta: z.string().nullable(),
  }),
  imagery: z.string().describe("'site #3', 'stock: hero', or 'none' plus how it's cropped."),
  mobile: z.string().describe("How this section adapts on a phone."),
});

export const StructureSchema = z.object({
  navigation: z.array(z.object({ label: z.string(), purpose: z.string() })).describe("Top-level pages for the full site (the demo builds the homepage)."),
  homepage: z.object({
    goal: z.string(),
    story: z.string().describe("The narrative as a chain, e.g. 'Brand proposition → Booking → Credibility → Services → …'"),
    sections: z.array(SectionPlan).describe("6-10 sections in order, header and footer included."),
  }),
  copy: z.object({
    voice: z.string(),
    headline: z.string().describe("Max ~8 words. Specific to this business."),
    subheadline: z.string(),
    primary_cta: z.string(),
    secondary_cta: z.string().nullable(),
    words_to_avoid: z.array(z.string()),
  }),
  mobile: z.array(z.string()).describe("Mobile experience decisions."),
  conversion: z.array(z.string()).describe("Conversion strategy decisions."),
  build_requirements: z.array(z.string()).describe("Concrete, checkable requirements for the developer."),
});
export type Structure = z.infer<typeof StructureSchema>;

export const FoundationSchema = DirectionSchema.extend(StructureSchema.shape);
export type Foundation = z.infer<typeof FoundationSchema>;

const CritiqueSchema = z.object({
  score: z.number().int().describe("1-10"),
  verdict: z.string().describe("One or two sentences."),
  issues: z.array(z.string()),
  revised: FoundationSchema.nullable().describe("The full corrected foundation when score < 9, else null."),
});
export type FoundationCritique = { score: number; verdict: string; issues: string[]; revised: boolean };

// ---------------------------------------------------------------------------
// Studio design standard (your house rules, editable markdown)
// ---------------------------------------------------------------------------

export function designStandard(): string {
  const file = path.join(config.root, "studio", "design-standard.md");
  try {
    return `STUDIO DESIGN STANDARD (house rules — follow them):\n${fs.readFileSync(file, "utf8")}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const FACT_RULES = `FACTS (hard rules): never invent qualifications, licences, years in business, awards, guarantees, prices, hours, service areas, team members, client names or testimonials. Use only what the source pages, structured data and Google listing show. Testimonials are copied verbatim with the name as shown. Keep the business name exactly as written.`;

const SYSTEM_RESEARCH = `You are the researcher at a small web design studio. Read everything we scraped from a local business's website and Google listing and establish the facts.
Facts only — no design opinions. Be precise and concrete. If something isn't stated, put it in "unknowns" rather than guessing.
${FACT_RULES}`;

const SYSTEM_AUDIT = `You are a senior UX auditor. You see desktop and mobile screenshots of a small business's current homepage plus measurements.
Diagnose it like an expert, with evidence a business owner would recognise: visual hierarchy, typography, spacing, colour, imagery, navigation, mobile UX, calls to action, brand perception, trust, conversion friction, dated design patterns.
Say exactly what you see ("Airport transfer content is ~400 words before any booking action"), not generic advice ("improve the CTA"). Also note what works and what brand equity must survive.`;

const SYSTEM_DIRECTION = `You are the brand strategist and creative director at a small, opinionated web design studio that makes speculative redesign concepts for local Australian businesses.
You set the creative direction BEFORE anything is designed. Your output is the source of truth for the designer and developer.

Your job:
- Diagnose current vs desired perception, then position the business: "Position this as X rather than Y."
- Create a real creative concept. Not "modern clean design" — that is AI-generated nothingness. Name what the visual language sits between (e.g. "somewhere between a premium automotive campaign, a contemporary hotel and Melbourne hospitality branding"), what it borrows from each reference, and what it rejects.
- Define a concrete visual system: hex colour tokens with roles, a Google Fonts pairing with weights and a type scale, grid, spacing, radius, motion, component rules, photography direction and treatment.
- Decide which of the business's own photos to use (you see them on a labelled contact sheet) and where stock mood photos are genuinely needed.
- Stay grounded: the concept must suit THIS business's size, audience, price point and real assets. A home-based florist is not a luxury fashion house. Be ambitious in craft, honest in claims.

Typography: real Google Fonts only. Prefer distinctive but legible pairings; don't default to Inter + Playfair unless it's genuinely right.
Colour: mostly neutrals plus one deliberate accent. If the existing brand colour is garish, refine it rather than discard it, when it carries brand equity.
${FACT_RULES}`;

const SYSTEM_STRUCTURE = `You are the information architect and copy director at the same studio. The creative direction is decided (below). Now design the site's structure and the homepage narrative.

- Navigation: the top-level pages the full site should have, and why each exists.
- The homepage is a story, not a list of sections. Ask "what story should the page tell from the first viewport to conversion?" and write it as a chain (Brand proposition → Booking → Credibility → …). Every section must earn its place; drop anything you can't fill with real, specific content.
- For each section: purpose, concrete layout, the actual copy (headline, body, items, CTA), imagery, and how it works on mobile.
- Copy: Australian English, plain, confident and specific. Headlines that could only belong to this business. No clichés ("look no further", "one-stop shop", "elevate", "seamless", "your trusted partner").
- Mobile, conversion strategy and build requirements: concrete, checkable decisions.
${FACT_RULES}`;

const SYSTEM_CRITIC = `You are the studio's editor and critic — the person who kills AI slop before a client ever sees it.
Critique the complete redesign foundation below. Identify:
- clichés and generic AI design choices (gradient blobs, three feature cards, "Elevate your…", stock-smile photos, black-and-gold-for-luxury and other industry clichés),
- anything that would make the final website feel templated,
- inconsistencies with the business (wrong price point, overclaiming, audience mismatch, a concept that its real photos can't support),
- unnecessary complexity, sections that don't earn their place, weak or vague copy, vague visual rules a developer couldn't act on,
- any fact not supported by the source (invented years, licences, guarantees, testimonials, prices).
Score 1-10 against the bar "a respected independent studio would present this to a client". If below 9, return the FULL revised foundation that fixes every issue (same schema). Keep what's good; don't make it blander.
${FACT_RULES}`;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function factsBlock(b: Business, ex: Extraction, q: Qualification | null): string {
  return [
    `Business name (Google): ${b.name}`,
    `Category: ${b.category ?? "unknown"}`,
    `Website: ${ex.sourceUrl}`,
    `Address (Google): ${b.address ?? "unknown"}`,
    `Phone (Google): ${b.phone ?? "unknown"}`,
    `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews`,
    `Phones on site: ${ex.phones.join(", ") || "none"} | Emails on site: ${ex.emails.join(", ") || "none"}`,
    `Social links: ${ex.socialLinks.join(", ") || "none"}`,
    `Brand colours found in CSS (hex, weight, where): ${ex.colorCandidates.map((c) => `${c.color} (${c.weight}, ${c.where})`).join("; ") || "none"}`,
    q ? `Earlier quick assessment: ${q.summary} Problems: ${q.problems.join("; ")}. Strengths: ${q.strengths.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function sourceBlock(ex: Extraction): string {
  return ["STRUCTURED DATA (JSON-LD):", JSON.stringify(ex.jsonLd).slice(0, 4000), "", "SOURCE PAGES:", corpus(ex)].join("\n");
}

function shotBlocks(scanDesktop: string | null | undefined, scanMobile: string | null | undefined): Content {
  const out: Content = [];
  for (const [label, rel] of [
    ["CURRENT site — desktop:", scanDesktop],
    ["CURRENT site — mobile:", scanMobile],
  ] as const) {
    if (rel && fs.existsSync(path.join(config.dataDir, rel))) out.push(textBlock(label), imageBlock(readShotBase64(rel)));
  }
  return out;
}

async function photoBlocks(b: Business, ex: Extraction): Promise<Content> {
  const dir = assetsDirFor(b.id);
  const siteImages = ex.images.filter((i) => i.file);
  const out: Content = [];
  const imageSheet = await contactSheet(
    dir,
    siteImages.map((i) => ({ id: `#${i.index}`, file: i.file!, label: `${i.width}×${i.height} ${i.context || i.alt || ""}` })),
    "images",
    siteImages.length > 16 ? 190 : 240,
    siteImages.length > 16 ? 6 : 4,
  );
  const logoSheet = await contactSheet(
    dir,
    ex.logos.filter((l) => l.file).map((l) => ({ id: `#${l.index}`, file: l.file!, label: l.how })),
    "logos",
    200,
    4,
  );
  if (logoSheet) out.push(textBlock("Logo candidates (#index):"), imageBlock(logoSheet));
  else out.push(textBlock("No logo candidates found — logo_index must be null."));
  if (imageSheet) out.push(textBlock("The business's own photos, labelled #index with pixel size and nearby page text:"), imageBlock(imageSheet));
  else out.push(textBlock("The business has no usable photos of its own."));
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function normaliseHex(h: string): string {
  const m = h.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return h;
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${v.toUpperCase()}`;
}

/** Repair what can be repaired and return warnings for what you need to check. */
export function checkFoundation(f: Foundation, b: Business, ex: Extraction): string[] {
  const warnings: string[] = [];
  for (const c of f.visual_system.colours) {
    c.hex = normaliseHex(c.hex);
    if (!/^#[0-9A-F]{6}$/.test(c.hex)) warnings.push(`Colour "${c.name}" has an invalid hex value (${c.hex}).`);
  }
  const siteIdx = new Set(ex.images.filter((i) => i.file).map((i) => i.index));
  f.photography.site_photos = f.photography.site_photos.filter((p) => siteIdx.has(p.index));
  f.photography.stock = f.photography.stock.slice(0, 4);
  if (f.logo_index !== null && !ex.logos.some((l) => l.index === f.logo_index && l.file)) f.logo_index = null;

  const copy = [
    f.copy.headline,
    f.copy.subheadline,
    f.copy.primary_cta,
    f.copy.secondary_cta ?? "",
    ...f.positioning.differentiators,
    ...f.homepage.sections.flatMap((s) => [s.content.eyebrow, s.content.headline, s.content.body, s.content.cta, ...s.content.items]),
  ]
    .filter(Boolean)
    .join(" \n ");
  warnings.push(...checkClaims(copy, b, ex));

  for (const s of f.homepage.sections) {
    if (!/testimonial|review/i.test(`${s.id} ${s.name}`)) continue;
    for (const item of s.content.items) {
      const quote = item.replace(/\s+[—–-]\s*[^—–-]+$/, "").replace(/^["“]|["”]$/g, "");
      if (!isVerbatim(quote, b, ex)) warnings.push(`Testimonial not found word for word on their site: "${item.slice(0, 60)}…"`);
    }
  }
  return [...new Set(warnings)];
}

// ---------------------------------------------------------------------------
// Markdown export (foundation.md)
// ---------------------------------------------------------------------------

const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

export function foundationMarkdown(f: Foundation, research?: Research | null, audit?: Audit | null): string {
  const v = f.visual_system;
  const out = [
    `# ${f.business.name} — redesign foundation`,
    "",
    `${f.business.offer} · ${f.business.location}`,
    "",
    "## Existing position",
    `**Perceived today as:** ${f.diagnosis.current_perception}`,
    audit ? `\n${audit.first_impression}\n\n${audit.issues.map((i) => `- **${i.area}** (${i.severity}): ${i.observation}`).join("\n")}` : "",
    "",
    "## Redesign opportunity",
    `**Desired perception:** ${f.diagnosis.desired_perception}`,
    "",
    f.diagnosis.opportunity,
    "",
    "## Business & audience",
    research ? `${research.summary}\n` : "",
    `**Primary conversion:** ${f.business.primary_conversion}`,
    f.business.secondary_conversions.length ? `**Secondary:** ${f.business.secondary_conversions.join(", ")}` : "",
    "",
    `**Primary audience:** ${f.audience.primary}`,
    f.audience.secondary ? `**Secondary audience:** ${f.audience.secondary}` : "",
    "",
    "Needs:",
    list(f.audience.needs),
    "",
    "Anxieties:",
    list(f.audience.anxieties),
    "",
    "## Brand positioning",
    f.positioning.statement,
    "",
    `**Personality:** ${f.positioning.personality.join(", ")}`,
    "",
    `**Tone of voice:** ${f.positioning.tone_of_voice}`,
    "",
    f.positioning.differentiators.length ? `Differentiators:\n${list(f.positioning.differentiators)}` : "",
    "",
    `## Creative direction: ${f.creative_direction.concept}`,
    f.creative_direction.summary,
    "",
    "References:",
    list(f.creative_direction.references.map((r) => `**${r.name}**: ${r.why}`)),
    "",
    "Avoid:",
    list(f.creative_direction.avoid),
    "",
    "## Typography",
    `- **Display:** ${v.typography.display.family} (${v.typography.display.weights.join(", ")}): ${v.typography.display.usage}`,
    `- **Body/UI:** ${v.typography.body.family} (${v.typography.body.weights.join(", ")}): ${v.typography.body.usage}`,
    `- **Scale:** ${v.typography.scale}`,
    "",
    "## Colour system",
    "| Token | Hex | Role |",
    "|---|---|---|",
    ...v.colours.map((c) => `| ${c.name} | \`${c.hex}\` | ${c.role} |`),
    "",
    "## Visual language",
    `- **Grid:** ${v.layout.grid}`,
    `- **Spacing:** ${v.layout.spacing}`,
    `- **Radius:** ${v.layout.radius}`,
    `- **Density:** ${v.layout.density}`,
    `- **Motion:** ${v.motion}`,
    "",
    "Components:",
    list(v.components),
    "",
    "## Photography direction",
    f.photography.direction,
    "",
    `**Treatment:** ${f.photography.treatment}`,
    "",
    f.photography.site_photos.length ? `Their photos:\n${list(f.photography.site_photos.map((p) => `#${p.index}: ${p.use}`))}` : "No usable photos of their own.",
    "",
    f.photography.stock.length ? `Stock placeholders:\n${list(f.photography.stock.map((s) => `${s.slot}: "${s.query}"`))}` : "",
    "",
    "Avoid:",
    list(f.photography.avoid),
    "",
    "## Navigation",
    list(f.navigation.map((n) => `**${n.label}**: ${n.purpose}`)),
    "",
    "## Homepage structure",
    `**Goal:** ${f.homepage.goal}`,
    "",
    f.homepage.story,
    "",
    "## Section-by-section design",
    ...f.homepage.sections.flatMap((s, i) => [
      `### ${i + 1}. ${s.name}`,
      `*${s.purpose}*`,
      "",
      `- **Layout:** ${s.layout}`,
      `- **Imagery:** ${s.imagery}`,
      `- **Mobile:** ${s.mobile}`,
      s.content.eyebrow ? `- **Eyebrow:** ${s.content.eyebrow}` : "",
      s.content.headline ? `- **Headline:** ${s.content.headline}` : "",
      s.content.body ? `- **Body:** ${s.content.body}` : "",
      s.content.items.length ? `- **Items:**\n${s.content.items.map((x) => `  - ${x}`).join("\n")}` : "",
      s.content.cta ? `- **CTA:** ${s.content.cta}` : "",
      "",
    ]),
    "## Mobile experience",
    list(f.mobile),
    "",
    "## Conversion strategy",
    list(f.conversion),
    "",
    "## Copy direction",
    f.copy.voice,
    "",
    `- **Headline:** ${f.copy.headline}`,
    `- **Subheadline:** ${f.copy.subheadline}`,
    `- **Primary CTA:** ${f.copy.primary_cta}`,
    f.copy.secondary_cta ? `- **Secondary CTA:** ${f.copy.secondary_cta}` : "",
    `- **Words to avoid:** ${f.copy.words_to_avoid.join(", ")}`,
    "",
    "## What to remove",
    list(f.diagnosis.remove),
    "",
    "## What to keep",
    list(f.diagnosis.keep),
    "",
    "## What to elevate",
    list(f.diagnosis.elevate),
    "",
    "## Build requirements",
    list(f.build_requirements),
    "",
  ];
  return out.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

/** foundation.md + site-spec.json in data/foundations/<id>/ (served at /files/foundations/<id>/…). */
export function writeFoundationFiles(businessId: number, f: Foundation, research?: Research | null, audit?: Audit | null) {
  const dir = path.join(config.dataDir, "foundations", String(businessId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "foundation.md"), foundationMarkdown(f, research, audit));
  fs.writeFileSync(path.join(dir, "site-spec.json"), JSON.stringify(f, null, 2));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function createFoundation(businessId: number, opts: { instructions?: string; rescrape?: boolean } = {}): Promise<void> {
  const b = getBusiness(businessId);
  if (!b) throw new Error(`Business ${businessId} not found`);
  if (!b.website) throw new Error("Business has no website to analyse");
  const progress = (msg: string) => setBusinessStatus(b.id, "building", `Foundation: ${msg}`);
  const existing = getFoundation(b.id);
  const scan = getScan(b.id);
  const q = parseJSON<Qualification>(scan?.ai);
  const metrics = parseJSON<SiteMetrics>(scan?.metrics);
  const instructions = opts.instructions ?? existing?.instructions ?? undefined;

  let ex = parseJSON<Extraction>(existing?.extraction);
  if (!ex || opts.rescrape) {
    progress("Reading their site");
    ex = await extractSite(metrics?.finalUrl ?? b.website, b.id);
  }

  let industry: IndustryBrief | null = null;
  try {
    industry = await getIndustryBrief(b, progress);
  } catch {
    // The foundation still works without the cached industry research.
  }

  const facts = factsBlock(b, ex, q);
  const source = sourceBlock(ex);
  const shots = shotBlocks(scan?.desktop_shot, scan?.mobile_shot);
  const designerNote = instructions ? `\nINSTRUCTIONS FROM THE DESIGNER (these override your defaults):\n${instructions}` : "";

  progress("Researching the business + auditing the current site");
  const [research, audit] = await Promise.all([
    claudeJSON({
      system: SYSTEM_RESEARCH,
      schema: ResearchSchema,
      effort: "medium",
      maxTokens: 12000,
      content: `FACTS:\n${facts}\n\n${source}\n\nEstablish the facts about this business.`,
    }),
    claudeJSON({
      system: SYSTEM_AUDIT,
      schema: AuditSchema,
      effort: "medium",
      maxTokens: 12000,
      content: [
        ...shots,
        textBlock(
          [
            `FACTS:\n${facts}`,
            metrics
              ? `MEASUREMENTS: mobile viewport ${metrics.hasViewportMeta ? "yes" : "no"}, overflows on mobile ${metrics.mobileHorizontalOverflow ? "yes" : "no"}, CTA above the fold on mobile ${metrics.ctaAboveFoldMobile ? "yes" : "no"}, click-to-call links ${metrics.telLinks}, copyright year ${metrics.copyrightYear ?? "n/a"}, load ${(metrics.loadMs / 1000).toFixed(1)}s, broken links ${metrics.brokenLinks.length}/${metrics.checkedLinks}, tech ${metrics.tech.join(", ") || "n/a"}`
              : "",
            "Audit the current site.",
          ].join("\n\n"),
        ),
      ],
    }),
  ]);

  const standard = designStandard();
  const research_ = `RESEARCH (facts):\n${JSON.stringify(research, null, 1)}`;
  const audit_ = `UX AUDIT of the current site:\n${JSON.stringify(audit, null, 1)}`;

  progress("Creative direction");
  const photos = await photoBlocks(b, ex);
  const direction = await claudeJSON({
    system: `${SYSTEM_DIRECTION}\n\n${standard}`,
    schema: DirectionSchema,
    effort: "high",
    maxTokens: 24000,
    content: [
      ...(industry ? [textBlock(briefText(industry))] : []),
      ...shots,
      ...photos,
      textBlock(`FACTS:\n${facts}\n\n${research_}\n\n${audit_}${designerNote}\n\nSet the positioning, creative direction and visual system for this business.`),
    ],
  });

  progress("Homepage story + copy");
  const structure = await claudeJSON({
    system: `${SYSTEM_STRUCTURE}\n\n${standard}`,
    schema: StructureSchema,
    effort: "high",
    maxTokens: 24000,
    content: `FACTS:\n${facts}\n\n${research_}\n\nCREATIVE DIRECTION (decided):\n${JSON.stringify(direction, null, 1)}\n\n${source}${designerNote}\n\nDesign the navigation, the homepage narrative and every section's copy.`,
  });

  let foundation: Foundation = { ...direction, ...structure };

  progress("Critic pass");
  const critic = await claudeJSON({
    system: `${SYSTEM_CRITIC}\n\n${standard}`,
    schema: CritiqueSchema,
    effort: "high",
    maxTokens: 48000,
    content: [
      ...shots,
      textBlock(
        `FACTS:\n${facts}\n\n${research_}\n\n${audit_}${designerNote}\n\nTHE FOUNDATION:\n${JSON.stringify(foundation, null, 1)}\n\n${source}\n\nCritique it, then revise if it scores below 9.`,
      ),
    ],
  });
  if (critic.score < 9 && critic.revised) foundation = critic.revised;

  const warnings = checkFoundation(foundation, b, ex);
  const critique: FoundationCritique = { score: critic.score, verdict: critic.verdict, issues: critic.issues, revised: critic.score < 9 && !!critic.revised };

  saveFoundation(b.id, { extraction: ex, research, audit, foundation, critique, warnings, instructions: instructions ?? null });
  setBusinessStatus(b.id, "foundation_ready");
}

export function saveFoundation(
  businessId: number,
  v: {
    extraction?: Extraction;
    research?: Research | null;
    audit?: Audit | null;
    foundation: Foundation;
    critique?: FoundationCritique | null;
    warnings: string[];
    instructions?: string | null;
  },
) {
  const prev = getFoundation(businessId);
  const research = v.research ?? parseJSON<Research>(prev?.research);
  const audit = v.audit ?? parseJSON<Audit>(prev?.audit);
  db.prepare(
    `INSERT INTO foundations (business_id, status, extraction, research, audit, data, critique, warnings, instructions, created_at, approved_at)
     VALUES (@id, 'draft', @extraction, @research, @audit, @data, @critique, @warnings, @instructions, datetime('now'), NULL)
     ON CONFLICT(business_id) DO UPDATE SET status='draft', extraction=COALESCE(@extraction, extraction), research=@research, audit=@audit,
       data=@data, critique=COALESCE(@critique, critique), warnings=@warnings, instructions=COALESCE(@instructions, instructions),
       created_at=datetime('now'), approved_at=NULL`,
  ).run({
    id: businessId,
    extraction: v.extraction ? JSON.stringify(v.extraction) : null,
    research: research ? JSON.stringify(research) : null,
    audit: audit ? JSON.stringify(audit) : null,
    data: JSON.stringify(v.foundation),
    critique: v.critique ? JSON.stringify(v.critique) : null,
    warnings: JSON.stringify(v.warnings),
    instructions: v.instructions ?? null,
  });
  writeFoundationFiles(businessId, v.foundation, research, audit);
}
