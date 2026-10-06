import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeJSON, imageBlock, textBlock } from "./claude";
import { desktopContext, mobileContext } from "./browser";
import { config } from "./config";
import type { Business } from "./db";
import type { Qualification } from "./qualify";
import { assetsDirFor } from "./extract";
import { fetchCandidate, searchStock, type StockCandidate } from "./stock";
import type { Extraction } from "./templates/content";
import {
  BODY_FONTS,
  HEADING_FONTS,
  SECTION_TYPES,
  STYLE_INFO,
  SitePlanSchema,
  VARIANTS,
  forEachImageRef,
  type ResolvedImage,
  type SitePlan,
} from "./templates/plan";
import { renderPlan, type ImageMap } from "./templates/render";

type Content = Anthropic.Beta.BetaContentBlockParam[];

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PLAYBOOKS = `
INDUSTRY PLAYBOOKS (adapt, don't copy blindly):
- Florists / gift shops: style "boutique" (Shopify Dawn feel). White or warm-white canvas, near-black text, ONE refined accent (deep green, plum, dusty rose, ink). Elegant serif headings (Playfair Display / Cormorant / Fraunces) + clean sans body (Assistant / DM Sans). Full-bleed hero photo of flowers. "Shop by occasion" (circles when 5+ occasions have photos, tiles for 3-4). A product grid of their real arrangements (prices only if the site states them). Feature blocks for Weddings and Sympathy/Funerals with soft copy. Delivery info. Testimonials centered and quiet. Never neon or loud colour blocks.
- Cafes / restaurants / bakeries: style "warm". Image-led, menu highlights as cards or tiles, hours and location prominent, booking/order CTA.
- Trades (plumber, electrician, builder, roofer, mechanic): style "bold". Phone-first hero, services as cards, trust points (licensing ONLY if stated), service areas, steps (how it works), strong call band.
- Home services (cleaning, painting, removals, pest, gardening): style "clean". Friendly, quote CTA, services, steps, areas, reviews.
- Health & beauty (clinics, physio, dental, salons, spa, fitness): style "soft". Calm palette, booking CTA, treatments as cards/list with prices if stated, practitioner/about feature, FAQ.
- Professional services (accountants, lawyers, consultants, real estate): style "editorial". Restrained, serif-led, numbered services, about/credentials feature, process steps.
`;

const SYSTEM_PLAN = `You are the creative director, UX designer and copywriter for a small studio that builds speculative redesign concepts for local Australian businesses.
Your concept must make the owner think "that's MY business, finally looking as good as it should" — specific to their trade, not a generic template.

Work like a real designer:
1. Think first (fill "thinking"): who the customers are, the one action the page must drive, the right look for this trade and this business, and what would look wrong or generic.
2. Choose the style, palette, fonts, hero and sections that serve that goal. Use 5-8 sections. Omit any section you can't fill with real, specific content — an empty-feeling section is worse than none.
3. Write tight, warm, specific copy from their real content.

STYLES:
${Object.entries(STYLE_INFO).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

SECTION TYPES and their variants:
- categories (circles | tiles): collections/occasions/menu groups with an image each.
- products (grid): real items they sell, image + name + price only if stated. Use ONLY the business's own photos.
- services (cards | list | numbered)
- feature / about (image-left | image-right | centered): one idea, a short body, optional highlights as items (titles only), optional cta.
- testimonials (centered | cards): VERBATIM quotes from their site only, author in meta.
- gallery (grid): their own work photos only.
- areas (default): suburbs they serve, only if stated.
- steps (default): how ordering/booking/working with them goes, 3-4 items, only if it reflects how they actually operate.
- faq (default): only answers the source supports.
- contact (default): always include, usually last or second last.
- cta_band (default): short closing call to action.
Allowed variant names: ${VARIANTS.join(", ")}. Section types: ${SECTION_TYPES.join(", ")}.
Fonts — heading: ${HEADING_FONTS.join(", ")}; body: ${BODY_FONTS.join(", ")}.
${PLAYBOOKS}
When an INDUSTRY RESEARCH BRIEF is provided, treat it as your primary expert reference for what this kind of site needs, then make deliberate choices for this particular business (its size, real assets, personality). Explain in "thinking" how you applied it and where you deviated and why.

COLOUR:
- Start from calm neutrals (white, warm white, off-black). Use the brand colour as an accent only if it's tasteful.
- If the brand colour is garish (neon magenta, pure saturated red/green, clashing rainbow), refine it: a deeper, less saturated version that still nods to the brand, used sparingly.
- Header is usually light; dark header only for "bold" trades. Announcement bar is a quiet dark or accent tone.
- All text must have strong contrast.

PHOTOS (think critically — wrong photos ruin the concept):
- You get a labelled contact sheet of the business's own photos with nearby text (e.g. which category a tile belongs to). Prefer them for products, categories, gallery and services — match by what the photo shows.
- Small or low-quality site photos are fine in product cards and circles, never as a full-bleed hero.
- Use source "stock" with a specific, on-brand stock_query when a slot needs a mood photo and they have nothing suitable (typically hero and feature images). Keep queries short and searchable, 3-6 words naming the subject and setting ("white roses bouquet linen", "latte art cafe counter", "electrician switchboard hands"). Never one-word generic ("flowers").
- Never use stock for products, gallery, "our work", team or the owner. For solo or home-based businesses avoid stock showing people who could be mistaken for the owner — prefer close-ups of the product or craft.
- Use "none" rather than a weak or irrelevant image; every layout works without photos.

FACTS (hard rules):
- Never invent qualifications, licences, years in business, awards, guarantees, prices, delivery promises, opening hours, service areas or testimonials.
- Only use facts from the source pages, structured data or Google listing. Prices in product/service meta only if the site states them.
- Testimonials must be copied verbatim with the name as shown.
- Home-based business or no public premises: show_address = false.
- Keep the business name exactly as the business writes it.

COPY: Australian English, plain and confident, no clichés ("look no further", "one-stop shop", "second to none"). Headline max ~9 words, subheadline max ~28 words.`;

export const SYSTEM_PICK = `You are a photo editor choosing placeholder stock photos for a small-business website concept.
For each slot you see candidates labelled with ids. Rank only candidates that genuinely fit the slot's purpose and the business: relevant subject, professional quality, good light, tasteful, no watermarks or text, no awkward or cheesy staging, nothing that misrepresents the business (e.g. a big retail store for a home-based florist, or people who could be mistaken for the owner).
Return an empty list for a slot if nothing is good enough — the layout will cope without a photo.`;

const SYSTEM_CRITIQUE = `You are a demanding senior web designer reviewing a homepage concept before it's shown to a small-business owner.
Judge the rendered screenshots against this bar: would a good studio charge $3,000 for this, and does it feel specific to THIS business and trade?
Use the INDUSTRY RESEARCH BRIEF (if provided) as the benchmark: does the page have what strong sites in this industry have, in the right order, with the right conventions?
Check: visual hierarchy, whitespace, typography pairing, colour (refined, not garish; enough contrast), photo choices (relevant, high quality, not repetitive, not misleading), section order and relevance, empty or weak sections, copy clarity, mobile layout, whether the primary action is obvious.
Score 1-10. If below 8, return a revised plan that fixes the problems (same schema; you may change style, palette, fonts, hero variant, section order/variants, remove weak sections, swap photos or stock queries, tighten copy). All factual rules still apply: never add facts that aren't in the source. If 8 or above, revised_plan may be null.`;

// ---------------------------------------------------------------------------
// Industry research brief (cached per industry, reused for every business in it)
// ---------------------------------------------------------------------------

export const IndustryBriefSchema = z.object({
  industry: z.string(),
  customers: z.string().describe("Who buys, what they're anxious about, what makes them choose one business over another."),
  conversion_goals: z.array(z.string()).describe("The actions the site must drive, most important first."),
  must_have_sections: z.array(z.string()).describe("Sections nearly every strong site in this industry has, and why."),
  nice_to_have: z.array(z.string()),
  layout_patterns: z.array(z.string()).describe("Concrete patterns from leading sites (hero type, navigation, grids, CTAs placement, mobile behaviour)."),
  visual_conventions: z.object({
    palette: z.string(),
    typography: z.string(),
    photography: z.string().describe("What great photos for this industry show, and what to avoid."),
    tone: z.string(),
  }),
  trust_signals: z.array(z.string()).describe("What builds trust here — only to be used when the business actually has them."),
  avoid: z.array(z.string()).describe("Common mistakes and clichés that make sites in this industry look cheap or generic."),
  reference_sites: z.array(z.string()).describe("Well-regarded example sites or brands you looked at, with what to learn from each."),
  recommended_style: z.enum(["boutique", "bold", "clean", "editorial", "soft", "warm"]),
  stock_photo_ideas: z.array(z.string()).describe("5-8 specific, tasteful stock search queries for mood photos in this industry."),
});
export type IndustryBrief = z.infer<typeof IndustryBriefSchema>;

const SYSTEM_RESEARCH = `You are a senior UX strategist preparing a design brief for small-business websites in one industry.
Research how the best websites in this industry work today — if you have web search, look at several leading and well-designed sites (including strong Australian independents and well-known brands) and note concrete patterns. Think about what customers in this industry actually need from a website and what makes them choose a business.
Be specific and practical: name real layout patterns, section types and conventions, not generic advice. The brief will guide designers building homepages for many different small businesses in this industry.`;

function industryKey(b: Business): string {
  return (b.category ?? "local business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

export async function getIndustryBrief(b: Business, onProgress?: (m: string) => void): Promise<IndustryBrief> {
  const dir = path.join(config.dataDir, "industry-briefs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${industryKey(b)}.json`);
  if (fs.existsSync(file)) {
    try {
      return IndustryBriefSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // Re-research if the cached brief is from an older format.
    }
  }
  onProgress?.(`Researching what great ${b.category ?? "business"} websites look like`);
  const brief = await claudeJSON({
    system: SYSTEM_RESEARCH,
    schema: IndustryBriefSchema,
    effort: "high",
    maxTokens: 16000,
    webResearch: true,
    content: `Industry: ${b.category ?? "local business"} (Google types: ${b.types ?? "n/a"}). Market: small local businesses in Australia.
Example business in this industry: ${b.name}.
Produce the design brief for this industry.`,
  });
  fs.writeFileSync(file, JSON.stringify(brief, null, 2));
  return brief;
}

export function briefText(brief: IndustryBrief): string {
  const v = brief.visual_conventions;
  return [
    `INDUSTRY RESEARCH BRIEF — ${brief.industry} (researched across leading sites; use it as your expert reference, then adapt to this specific business):`,
    `Customers: ${brief.customers}`,
    `Conversion goals: ${brief.conversion_goals.join("; ")}`,
    `Must-have sections: ${brief.must_have_sections.join("; ")}`,
    `Nice to have: ${brief.nice_to_have.join("; ")}`,
    `Layout patterns: ${brief.layout_patterns.join("; ")}`,
    `Palette: ${v.palette} | Typography: ${v.typography} | Photography: ${v.photography} | Tone: ${v.tone}`,
    `Trust signals (only if the business really has them): ${brief.trust_signals.join("; ")}`,
    `Avoid: ${brief.avoid.join("; ")}`,
    `References: ${brief.reference_sites.join("; ")}`,
    `Recommended style: ${brief.recommended_style}`,
    `Good stock photo directions: ${brief.stock_photo_ideas.join("; ")}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------

export async function contactSheet(
  dir: string,
  items: Array<{ id: string; file: string; label: string }>,
  name: string,
  cell: number,
  cols: number,
): Promise<string | null> {
  if (!items.length) return null;
  const html = `<!doctype html><html><body style="margin:0;padding:12px;background:#e5e7eb;font:13px sans-serif">
  <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:10px">${items
    .map(
      (i) => `<div style="background:#fff;padding:5px"><div style="height:${Math.round(cell * 0.75)}px;display:flex;align-items:center;justify-content:center;background:#f3f4f6">
      <img src="${encodeURI(i.file.replace(/\\/g, "/"))}" style="max-width:100%;max-height:100%;object-fit:contain"></div>
      <div style="font-weight:700;margin-top:3px">${i.id}</div><div style="color:#555;font-size:10.5px;line-height:1.25">${i.label.replace(/</g, "&lt;").slice(0, 70)}</div></div>`,
    )
    .join("")}</div></body></html>`;
  const htmlPath = path.join(dir, `_${name}.html`);
  fs.writeFileSync(htmlPath, html);
  const ctx = await desktopContext();
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: cell * cols + 24 + (cols - 1) * 10, height: 800 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForLoadState("load");
    const out = path.join(dir, `_${name}.jpg`);
    await page.screenshot({ path: out, type: "jpeg", quality: 72, fullPage: true });
    return fs.readFileSync(out).toString("base64");
  } finally {
    await ctx.close();
  }
}

export function corpus(ex: Extraction): string {
  return ex.pages.map((p) => `### PAGE: ${p.url}\nTitle: ${p.title}\n${p.text}`).join("\n\n").slice(0, 40000);
}

// ---------------------------------------------------------------------------
// Step 1: plan
// ---------------------------------------------------------------------------

interface DesignInputs {
  business: Business;
  extraction: Extraction;
  qualification: Qualification | null;
  industryBrief?: IndustryBrief | null;
  instructions?: string;
  styleOverride?: string;
}

async function briefContent(inp: DesignInputs): Promise<Content> {
  const { business: b, extraction: ex } = inp;
  const dir = assetsDirFor(b.id);
  const siteImages = ex.images.filter((i) => i.file);
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

  const facts = [
    `Business name (Google): ${b.name}`,
    `Category: ${b.category ?? "unknown"}`,
    `Address (Google): ${b.address ?? "unknown"}`,
    `Phone (Google): ${b.phone ?? "unknown"}`,
    `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews`,
    `Phones on site: ${ex.phones.join(", ") || "none"} | Emails on site: ${ex.emails.join(", ") || "none"}`,
    `Social links: ${ex.socialLinks.join(", ") || "none"}`,
    `Brand colours found in CSS (hex, weight, where): ${ex.colorCandidates.map((c) => `${c.color} (${c.weight}, ${c.where})`).join("; ") || "none"}`,
  ];
  if (inp.qualification) facts.push(`Problems with the current site: ${inp.qualification.problems.join("; ")}`);

  const content: Content = [];
  if (inp.industryBrief) content.push(textBlock(briefText(inp.industryBrief)));
  if (ex.homepageShot && fs.existsSync(path.join(config.dataDir, ex.homepageShot))) {
    content.push(textBlock("Their CURRENT homepage (for brand feel only — the new design should be far better):"));
    content.push(imageBlock(fs.readFileSync(path.join(config.dataDir, ex.homepageShot)).toString("base64")));
  }
  if (logoSheet) content.push(textBlock("Logo candidates (pick logo_index or null):"), imageBlock(logoSheet));
  else content.push(textBlock("No logo candidates — logo_index must be null (a wordmark is used)."));
  if (imageSheet) content.push(textBlock("The business's own photos, labelled #index with size and nearby page text:"), imageBlock(imageSheet));
  else content.push(textBlock("The business has no usable photos of its own."));
  content.push(
    textBlock(
      [
        "FACTS:",
        ...facts,
        "",
        "STRUCTURED DATA (JSON-LD):",
        JSON.stringify(ex.jsonLd).slice(0, 4000),
        "",
        "SOURCE PAGES:",
        corpus(ex),
        inp.styleOverride ? `\nThe designer wants style "${inp.styleOverride}" for this version.` : "",
        inp.instructions ? `\nINSTRUCTIONS FROM THE DESIGNER (follow them):\n${inp.instructions}` : "",
      ].join("\n"),
    ),
  );
  return content;
}

// ---------------------------------------------------------------------------
// Step 2: resolve photos (site files + stock search & pick)
// ---------------------------------------------------------------------------

function orientationFor(plan: SitePlan, slot: string): "landscape" | "portrait" | "square" {
  if (slot === "hero") return plan.hero.variant === "full-bleed" ? "landscape" : "portrait";
  if (slot.startsWith("hero.collage")) return "portrait";
  const m = slot.match(/^s(\d+)\./);
  const sec = m ? plan.sections[Number(m[1])] : undefined;
  if (sec?.type === "categories" && sec.variant === "circles") return "square";
  return "portrait";
}

async function resolveImages(
  plan: SitePlan,
  inp: DesignInputs,
  previous: { images: ImageMap; stockByQuery: Map<string, string[]> },
): Promise<{ images: ImageMap; stockByQuery: Map<string, string[]> }> {
  const { business: b, extraction: ex } = inp;
  const images: ImageMap = {};
  const dir = assetsDirFor(b.id);
  const stockDir = path.join(dir, "stock");
  fs.mkdirSync(stockDir, { recursive: true });

  // Site photos
  for (const img of ex.images) {
    if (img.file) images[`site:${img.index}`] = { file: img.file, credit: null, stock: false };
  }

  // Stock slots grouped by query (reuse earlier picks when the query is unchanged)
  const slotsByQuery = new Map<string, string[]>();
  forEachImageRef(plan, (ref, slot) => {
    if (ref.source !== "stock" || !ref.stock_query) return;
    const q = ref.stock_query.trim();
    slotsByQuery.set(q, [...(slotsByQuery.get(q) ?? []), slot]);
  });
  const stockByQuery = new Map(previous.stockByQuery);
  const queries = [...slotsByQuery.keys()].filter((q) => !stockByQuery.has(q)).slice(0, 6);

  if (queries.length) {
    const candidates = new Map<string, StockCandidate>();
    const sheets: Content = [];
    const topic = `${b.category ?? ""} ${b.name}`;
    let qi = 0;
    for (const q of queries) {
      qi++;
      const found = await searchStock(q, { orientation: orientationFor(plan, slotsByQuery.get(q)![0]), topic, n: 8 });
      const items: Array<{ id: string; file: string; label: string }> = [];
      let ci = 0;
      for (const c of found) {
        const id = `Q${qi}-${++ci}`;
        const file = await fetchCandidate(c, path.join(stockDir, `thumb-${id}`), "thumb");
        if (!file) continue;
        candidates.set(id, c);
        items.push({ id, file: `stock/${file}`, label: c.source });
      }
      const sheet = await contactSheet(dir, items, `stock-q${qi}`, 220, 4);
      if (sheet) sheets.push(textBlock(`Slot Q${qi} — query: "${q}" (used for: ${slotsByQuery.get(q)!.join(", ")})`), imageBlock(sheet));
      else stockByQuery.set(q, []);
    }
    if (sheets.length) {
      const picks = await claudeJSON({
        system: SYSTEM_PICK,
        effort: "low",
        maxTokens: 4000,
        schema: z.object({ picks: z.array(z.object({ slot: z.string(), ranked: z.array(z.string()) })) }),
        content: [
          textBlock(`Business: ${b.name} (${b.category ?? "local business"}). ${plan.thinking.design_direction}`),
          ...sheets,
          textBlock("For each slot (Q1, Q2, …) return the acceptable candidate ids, best first."),
        ],
      });
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        const ranked = picks.picks.find((p) => p.slot.toUpperCase() === `Q${i + 1}`)?.ranked ?? [];
        const files: string[] = [];
        for (const id of ranked) {
          const c = candidates.get(id.toUpperCase());
          if (!c) continue;
          const file = await fetchCandidate(c, path.join(stockDir, `full-${id.toUpperCase()}`), "full");
          if (file) files.push(JSON.stringify({ file: `stock/${file}`, credit: c.source === "library" ? null : c.credit }));
          if (files.length >= slotsByQuery.get(q)!.length) break;
        }
        stockByQuery.set(q, files);
      }
    }
  }

  // The hero matters most: if nothing fit its query, try the industry brief's photo ideas before giving up.
  const heroQ = plan.hero.image.source === "stock" ? plan.hero.image.stock_query?.trim() : undefined;
  if (heroQ && !(stockByQuery.get(heroQ) ?? []).length && inp.industryBrief?.stock_photo_ideas.length) {
    const alts = inp.industryBrief.stock_photo_ideas.slice(0, 3);
    const candidates = new Map<string, StockCandidate>();
    const sheets: Content = [];
    for (let a = 0; a < alts.length; a++) {
      const found = await searchStock(alts[a], { orientation: orientationFor(plan, "hero"), topic: `${b.category ?? ""}`, n: 6 });
      const items: Array<{ id: string; file: string; label: string }> = [];
      for (let ci = 0; ci < found.length; ci++) {
        const id = `H${a + 1}-${ci + 1}`;
        const file = await fetchCandidate(found[ci], path.join(stockDir, `thumb-${id}`), "thumb");
        if (!file) continue;
        candidates.set(id, found[ci]);
        items.push({ id, file: `stock/${file}`, label: found[ci].source });
      }
      const sheet = await contactSheet(dir, items, `stock-hero-${a + 1}`, 220, 4);
      if (sheet) sheets.push(textBlock(`Option set H${a + 1}: "${alts[a]}"`), imageBlock(sheet));
    }
    if (sheets.length) {
      const pick = await claudeJSON({
        system: SYSTEM_PICK,
        effort: "low",
        maxTokens: 2000,
        schema: z.object({ ranked: z.array(z.string()) }),
        content: [
          textBlock(`Business: ${b.name} (${b.category ?? ""}). Pick the best HERO photo for the homepage (wide, striking, on-brand). ${plan.thinking.design_direction}`),
          ...sheets,
          textBlock("Return acceptable candidate ids across all sets, best first. Empty if none are good enough."),
        ],
      });
      for (const id of pick.ranked) {
        const c = candidates.get(id.toUpperCase());
        const file = c ? await fetchCandidate(c, path.join(stockDir, `full-${id.toUpperCase()}`), "full") : null;
        if (c && file) {
          stockByQuery.set(heroQ, [JSON.stringify({ file: `stock/${file}`, credit: c.source === "library" ? null : c.credit })]);
          break;
        }
      }
    }
  }

  // Assign stock files to slots (different photo per slot when the query repeats)
  for (const [q, slots] of slotsByQuery) {
    const files = stockByQuery.get(q) ?? [];
    slots.forEach((slot, i) => {
      const f = files[i] ?? files[0];
      if (!f) return;
      const { file, credit } = JSON.parse(f) as { file: string; credit: string | null };
      images[`stock:${slot}`] = { file, credit, stock: true } satisfies ResolvedImage;
    });
  }
  return { images, stockByQuery };
}

// ---------------------------------------------------------------------------
// Step 3: render to a folder + screenshots
// ---------------------------------------------------------------------------

export async function writePreview(opts: {
  business: Business;
  slug: string;
  plan: SitePlan;
  images: ImageMap;
  extraction: Extraction;
}): Promise<{ desktopRel: string; mobileRel: string; desktopB64: string; mobileB64: string }> {
  const { business: b, plan } = opts;
  const outDir = path.join(config.previewsDir, opts.slug);
  const assetsOut = path.join(outDir, "assets");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(assetsOut, "stock"), { recursive: true });
  const srcDir = assetsDirFor(b.id);

  // Copy only the photos the plan uses.
  const used: ImageMap = {};
  forEachImageRef(plan, (ref, slot) => {
    const key = ref.source === "site" && ref.site_index !== null ? `site:${ref.site_index}` : ref.source === "stock" ? `stock:${slot}` : null;
    const hit = key ? opts.images[key] : undefined;
    if (!key || !hit) return;
    const dest = path.join(assetsOut, hit.file);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(srcDir, hit.file), dest);
    used[key] = { ...hit, file: `assets/${hit.file}` };
  });
  let logo: string | null = null;
  const logoCand = opts.extraction.logos.find((l) => l.index === plan.logo_index);
  if (logoCand?.file) {
    fs.copyFileSync(path.join(srcDir, logoCand.file), path.join(assetsOut, logoCand.file));
    logo = `assets/${logoCand.file}`;
  }

  const html = renderPlan(plan, used, {
    preparedBy: [config.sender.name, config.sender.business].filter(Boolean).join(", "),
    rating: b.rating,
    reviewCount: b.review_count,
    mapsUrl: b.maps_url,
    logo,
  });
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  return screenshotPreview(outDir, b.id);
}

/** Desktop + mobile screenshots of a rendered preview folder. */
export async function screenshotPreview(
  outDir: string,
  businessId: number,
): Promise<{ desktopRel: string; mobileRel: string; desktopB64: string; mobileB64: string }> {
  const fileUrl = pathToFileURL(path.join(outDir, "index.html")).href;
  const desktopRel = path.join("shots", `${businessId}-demo-desktop.jpg`);
  const mobileRel = path.join("shots", `${businessId}-demo-mobile.jpg`);
  for (const [ctxFn, rel, maxH] of [
    [desktopContext, desktopRel, 4200],
    [mobileContext, mobileRel, 3000],
  ] as const) {
    const ctx = await ctxFn();
    try {
      const page = await ctx.newPage();
      await page.goto(fileUrl, { waitUntil: "load", timeout: 45000 });
      await page.addStyleTag({ content: ".call-bar{display:none!important}" });
      await page.waitForTimeout(1200);
      const h = Number(await page.evaluate("document.documentElement.scrollHeight"));
      const w = page.viewportSize()?.width ?? 1440;
      await page.screenshot({
        path: path.join(config.dataDir, rel),
        type: "jpeg",
        quality: 75,
        fullPage: true,
        clip: { x: 0, y: 0, width: w, height: Math.min(h, maxH) },
      });
    } finally {
      await ctx.close();
    }
  }
  return {
    desktopRel,
    mobileRel,
    desktopB64: fs.readFileSync(path.join(config.dataDir, desktopRel)).toString("base64"),
    mobileB64: fs.readFileSync(path.join(config.dataDir, mobileRel)).toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Fact checks on the plan
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const RISKY = ["licensed", "licenced", "insured", "guarantee", "warranty", "award", "master", "certified", "accredited", "24/7", "emergency", "free quote", "family owned", "family-owned", "same day", "same-day", "fixed price", "free delivery", "next day"];
const NON_COPY_KEYS = new Set(["thinking", "palette", "fonts", "style", "variant", "source", "stock_query", "site_index", "action", "url", "logo_index"]);

function collectCopy(v: unknown, out: string[], key = "") {
  if (NON_COPY_KEYS.has(key)) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectCopy(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) collectCopy(x, out, k);
}

function sourceText(b: Business, ex: Extraction): string {
  return [ex.pages.map((p) => p.text).join("\n"), JSON.stringify(ex.jsonLd), b.name, b.address ?? "", b.phone ?? ""].join("\n");
}

/** True when the quote appears word for word (ignoring punctuation and case) in the scraped site. */
export function isVerbatim(quote: string, b: Business, ex: Extraction): boolean {
  return norm(quote).length > 8 && norm(sourceText(b, ex)).includes(norm(quote).slice(0, 80));
}

/** Warnings for numbers and risky claims in generated copy that the business's own site doesn't support. */
export function checkClaims(generated: string, b: Business, ex: Extraction): string[] {
  const source = sourceText(b, ex);
  const warnings: string[] = [];
  const allowed = new Set([String(b.rating ?? ""), String(b.review_count ?? ""), String(b.rating?.toFixed(1) ?? "")]);
  const digits = source.replace(/,/g, "");
  // Compare by value too, so "$19.90" in the copy matches "$19.9" on the site.
  const sourceValues = new Set([...digits.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));
  for (const m of generated.replace(/,/g, "").matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (allowed.has(m[0]) || digits.includes(m[0]) || sourceValues.has(Number(m[0]))) continue;
    warnings.push(`Number "${m[0]}" in the copy was not found on the current site. Check it.`);
  }
  const lower = generated.toLowerCase();
  const srcLower = source.toLowerCase();
  for (const c of RISKY) if (lower.includes(c) && !srcLower.includes(c)) warnings.push(`Claim "${c}" is in the copy but not on the current site. Verify or remove.`);

  return warnings;
}

function factCheck(plan: SitePlan, b: Business, ex: Extraction): string[] {
  const warnings: string[] = [];

  for (const s of plan.sections) {
    if (s.type !== "testimonials") continue;
    s.items = s.items.filter((t) => {
      const quote = t.text ?? t.title;
      const ok = isVerbatim(quote, b, ex);
      if (!ok) warnings.push(`Removed a testimonial not found word for word on the site: "${quote.slice(0, 60)}…"`);
      return ok;
    });
  }
  plan.sections = plan.sections.filter((s) => !(s.type === "testimonials" && s.items.length === 0));

  const copy: string[] = [];
  collectCopy({ ...plan, business: { name: plan.business.name } }, copy);
  warnings.push(...checkClaims(copy.join(" \n "), b, ex));

  const dig = (s: string | null) => (s ?? "").replace(/\D/g, "").replace(/^61/, "0");
  const known = [b.phone, ...ex.phones].map(dig).filter(Boolean);
  if (plan.business.phone && !known.includes(dig(plan.business.phone))) {
    warnings.push(`Phone ${plan.business.phone} doesn't match the listing or site, so I replaced it with the listed number.`);
    plan.business.phone = b.phone ?? ex.phones[0] ?? null;
  }
  if (!plan.business.phone && b.phone) plan.business.phone = b.phone;

  const siteIdx = new Set(ex.images.filter((i) => i.file).map((i) => i.index));
  forEachImageRef(plan, (ref) => {
    if (ref.source === "site" && (ref.site_index === null || !siteIdx.has(ref.site_index))) ref.source = "none";
  });
  if (plan.logo_index !== null && !ex.logos.some((l) => l.index === plan.logo_index && l.file)) plan.logo_index = null;
  if (!plan.sections.some((s) => s.type === "contact")) {
    plan.sections.push({ type: "contact", variant: "default", heading: "Get in touch", subheading: null, body: null, items: [], image: { source: "none", site_index: null, stock_query: null }, cta: null });
  }
  return [...new Set(warnings)];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface DesignResult {
  plan: SitePlan;
  images: ImageMap;
  warnings: string[];
  review: { score: number; issues: string[]; revised: boolean };
  shots: { desktopRel: string; mobileRel: string };
}

const CritiqueSchema = z.object({
  score: z.number().int(),
  issues: z.array(z.string()),
  revised_plan: SitePlanSchema.nullable(),
});

export async function designSite(
  inp: DesignInputs & { slug: string; onProgress?: (msg: string) => void; basePlan?: SitePlan | null },
): Promise<DesignResult> {
  const { business: b, extraction: ex } = inp;
  if (inp.industryBrief === undefined) {
    try {
      inp.industryBrief = await getIndustryBrief(b, inp.onProgress);
    } catch {
      inp.industryBrief = null; // Design still works from the built-in playbooks.
    }
  }
  const brief = await briefContent(inp);

  let plan: SitePlan;
  if (inp.basePlan) {
    plan = inp.basePlan;
  } else {
    inp.onProgress?.("Art direction + copy");
    plan = await claudeJSON({
      system: SYSTEM_PLAN,
      schema: SitePlanSchema,
      effort: "high",
      maxTokens: 32000,
      content: [...brief, textBlock("Design and write this business's new homepage. Think before you design.")],
    });
  }
  let warnings = factCheck(plan, b, ex);

  inp.onProgress?.("Choosing photos");
  let resolved = await resolveImages(plan, inp, { images: {}, stockByQuery: new Map() });
  inp.onProgress?.("Rendering");
  let shots = await writePreview({ business: b, slug: inp.slug, plan, images: resolved.images, extraction: ex });

  inp.onProgress?.("Design review");
  const critique = await claudeJSON({
    system: SYSTEM_CRITIQUE,
    schema: CritiqueSchema,
    effort: "medium",
    maxTokens: 32000,
    content: [
      ...brief,
      textBlock("Rendered concept — desktop:"),
      imageBlock(shots.desktopB64),
      textBlock("Rendered concept — mobile:"),
      imageBlock(shots.mobileB64),
      textBlock(`Current plan JSON:\n${JSON.stringify(plan)}`),
      textBlock("Review it. If the score is below 8, return the improved plan."),
    ],
  });

  let revised = false;
  if (critique.score < 8 && critique.revised_plan) {
    plan = critique.revised_plan;
    warnings = factCheck(plan, b, ex);
    inp.onProgress?.("Applying design review");
    resolved = await resolveImages(plan, inp, resolved);
    shots = await writePreview({ business: b, slug: inp.slug, plan, images: resolved.images, extraction: ex });
    revised = true;
  }

  const stockUsed = Object.keys(resolved.images).some((k) => k.startsWith("stock:"));
  let usesStock = false;
  forEachImageRef(plan, (ref, slot) => {
    if (ref.source === "stock" && resolved.images[`stock:${slot}`]) usesStock = true;
  });
  if (stockUsed && usesStock) warnings.unshift("Some photos are stock placeholders. Swap in the business's own photos before going live.");

  return {
    plan,
    images: resolved.images,
    warnings,
    review: { score: critique.score, issues: critique.issues, revised },
    shots: { desktopRel: shots.desktopRel, mobileRel: shots.mobileRel },
  };
}

/** Re-render an existing plan (after manual edits) without calling Claude, except to pick photos for new stock queries. */
export async function rerenderPlan(inp: DesignInputs & { slug: string; plan: SitePlan }) {
  const warnings = factCheck(inp.plan, inp.business, inp.extraction);
  const resolved = await resolveImages(inp.plan, inp, { images: {}, stockByQuery: new Map() });
  const shots = await writePreview({ business: inp.business, slug: inp.slug, plan: inp.plan, images: resolved.images, extraction: inp.extraction });
  return { plan: inp.plan, images: resolved.images, warnings, shots: { desktopRel: shots.desktopRel, mobileRel: shots.mobileRel } };
}
