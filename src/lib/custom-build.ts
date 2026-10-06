import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { customAlphabet } from "nanoid";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeJSON, imageBlock, textBlock } from "./claude";
import { config } from "./config";
import { db, getBusiness, getDemo, getFoundation, parseJSON, setBusinessStatus, type Business } from "./db";
import { SYSTEM_PICK, checkClaims, contactSheet, isVerbatim, screenshotPreview } from "./design";
import { assetsDirFor } from "./extract";
import { FoundationSchema, designStandard, type Foundation } from "./foundation";
import { fetchCandidate, searchStock, type StockCandidate } from "./stock";
import type { Extraction } from "./templates/content";

/**
 * Custom build: Claude writes a one-off homepage (single HTML file, inline CSS) from the
 * approved foundation, then looks at screenshots of its own work and fixes it.
 * No templates — the foundation is the only constraint.
 */

type Content = Anthropic.Beta.BetaContentBlockParam[];

const MAX_REVIEW_ROUNDS = 2;

const SYSTEM_BUILD = `You are a senior designer-developer at a small, opinionated web studio. You hand-build a homepage concept for a local business from an APPROVED redesign foundation.
The foundation is the source of truth: its positioning, creative concept, visual system, section order, layouts and copy are decided. Execute them with real craft — the result should feel like a studio designed it for this business, not like a template.

OUTPUT: one complete HTML document (<!doctype html> … </html>).
- All CSS in a single <style> in <head>. Define the foundation's colour tokens as CSS custom properties on :root and use them.
- Fonts: load the foundation's display and body families from Google Fonts with one <link> (css2 API, display=swap). No other external requests: no CDNs, frameworks, icon fonts or remote images. Icons, if any, are small inline SVG.
- Images: use ONLY the asset paths listed to you, exactly as written (relative, e.g. "assets/img-4.jpg"). Use object-fit and intentional crops. If a slot has no suitable asset, design it without a photo. Every <img> has meaningful alt text, width/height attributes, and loading="lazy" below the fold.
- JavaScript: optional, small, vanilla, inline at the end of <body>. Content must be fully visible without JS and without scrolling — never start content at opacity:0 or off-screen waiting for scroll/IntersectionObserver reveals (the page is reviewed from full-page screenshots). Motion is limited to hover/focus states and short load-in of the hero, and respects prefers-reduced-motion.
- Responsive: design the 390px phone layout on purpose (as the foundation describes), plus tablet and wide desktop (max content width ~1280-1440px). No horizontal overflow at any width. A sticky mobile action bar, if the foundation calls for one, must have class "call-bar".
- Accessibility: semantic landmarks (header, nav, main, section with aria-labelledby, footer), one h1, logical heading order, visible focus styles, WCAG AA contrast.
- Navigation: the foundation's nav items. Items for pages that don't exist in this one-page concept link to the matching section anchor, or "#".
- Actions: phone CTAs use tel: links with the real number; email uses mailto:; booking/ordering links go to the business's existing booking URL if the source shows one, otherwise to the contact section. Any form is visual only (action="#", no backend).
- Each section starts with an HTML comment <!-- section: id --> and has the foundation's id as its id attribute.
- Testimonials: verbatim from the foundation/source only, each wrapped in <blockquote data-testimonial> with the name in <cite>.
- Do NOT add a "concept" banner, noindex tag, or <base> tag — those are added automatically.

FACTS (hard rules): use only the foundation's copy and facts from the source. Never invent qualifications, years, awards, guarantees, prices, hours, areas, client names or testimonials. Phone numbers, emails, addresses and hours exactly as given. Business name exactly as written.`;

const SYSTEM_REVIEW = `You are the studio's demanding creative director reviewing a hand-built homepage concept against its approved foundation, before it is shown to the business owner.
You see full-page desktop and mobile screenshots plus the HTML source.

Judge against the bar: "would a respected independent studio put this in its portfolio, and does it unmistakably belong to THIS business?"
Check, concretely:
- Fidelity to the foundation: creative concept, colour tokens, typography (are the fonts actually rendering? is the scale confident?), section order, layouts, copy.
- Craft: hierarchy, alignment, rhythm and spacing, line lengths, image crops and quality (stretched/pixelated photos, repetition), contrast, empty-feeling or weak sections, awkward breaks.
- Mobile: designed, not merely stacked; tap targets; the primary action is easy to reach.
- Slop: generic AI patterns (gradient blobs, three identical cards, pill buttons everywhere, emoji icons, "Elevate…" copy) and anything that feels templated.
- Broken things: missing images, overflow, overlapping text, invisible content, layout bugs.
Score 1-10. If below 8, return the COMPLETE corrected HTML document that fixes every issue (same rules as the original build: inline CSS, listed assets only, no hidden-until-scroll content, facts unchanged). If 8 or above, html may be null.`;

const BuildSchema = z.object({
  html: z.string().describe("The complete HTML document."),
  notes: z.string().describe("2-4 sentences: key design decisions and anything you couldn't do."),
});

const ReviewSchema = z.object({
  score: z.number().int(),
  issues: z.array(z.string()),
  html: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

interface Asset {
  path: string; // as referenced in the HTML, e.g. "assets/img-3.jpg"
  label: string;
  credit: string | null;
}

const stockId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);

/** Search, let Claude pick, and download one stock photo per foundation stock slot. */
async function pickStock(b: Business, f: Foundation): Promise<Asset[]> {
  if (!f.photography.stock.length) return [];
  const dir = assetsDirFor(b.id);
  const stockDir = path.join(dir, "stock");
  fs.mkdirSync(stockDir, { recursive: true });
  const candidates = new Map<string, StockCandidate>();
  const sheets: Content = [];
  const slots = f.photography.stock.slice(0, 4);
  for (let si = 0; si < slots.length; si++) {
    const { slot, query } = slots[si];
    const found = await searchStock(query, { orientation: /hero|banner|wide/i.test(slot) ? "landscape" : "portrait", topic: `${b.category ?? ""} ${b.name}`, n: 8 });
    const items: Array<{ id: string; file: string; label: string }> = [];
    for (let ci = 0; ci < found.length; ci++) {
      const id = `S${si + 1}-${ci + 1}`;
      const file = await fetchCandidate(found[ci], path.join(stockDir, `thumb-${id}`), "thumb");
      if (!file) continue;
      candidates.set(id, found[ci]);
      items.push({ id, file: `stock/${file}`, label: found[ci].source });
    }
    const sheet = await contactSheet(dir, items, `stock-s${si + 1}`, 220, 4);
    if (sheet) sheets.push(textBlock(`Slot S${si + 1} "${slot}" — query: "${query}"`), imageBlock(sheet));
  }
  if (!sheets.length) return [];

  const picks = await claudeJSON({
    system: SYSTEM_PICK,
    effort: "low",
    maxTokens: 4000,
    schema: z.object({ picks: z.array(z.object({ slot: z.string(), ranked: z.array(z.string()) })) }),
    content: [
      textBlock(`Business: ${b.name} (${b.category ?? "local business"}). Creative direction: ${f.creative_direction.summary}\nPhotography: ${f.photography.direction} ${f.photography.treatment}\nAvoid: ${f.photography.avoid.join("; ")}`),
      ...sheets,
      textBlock("For each slot (S1, S2, …) return the acceptable candidate ids, best first."),
    ],
  });

  const out: Asset[] = [];
  for (let si = 0; si < slots.length; si++) {
    const ranked = picks.picks.find((p) => p.slot.toUpperCase() === `S${si + 1}`)?.ranked ?? [];
    for (const id of ranked) {
      const c = candidates.get(id.toUpperCase());
      if (!c) continue;
      const file = await fetchCandidate(c, path.join(stockDir, `${slots[si].slot.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stockId()}`), "full");
      if (!file) continue;
      out.push({ path: `assets/stock/${file}`, label: `STOCK for slot "${slots[si].slot}" (${slots[si].query})`, credit: c.source === "openverse" ? c.credit : null });
      break;
    }
  }
  return out;
}

function siteAssets(ex: Extraction, f: Foundation): Asset[] {
  const planned = new Map(f.photography.site_photos.map((p) => [p.index, p.use]));
  const out: Asset[] = [];
  const logo = ex.logos.find((l) => l.index === f.logo_index && l.file);
  if (logo?.file) out.push({ path: `assets/${logo.file}`, label: `LOGO (${logo.width}×${logo.height})`, credit: null });
  for (const img of ex.images) {
    if (!img.file) continue;
    const use = planned.get(img.index);
    out.push({
      path: `assets/${img.file}`,
      label: `#${img.index} ${img.width}×${img.height}${use ? ` — PLANNED: ${use}` : ""} ${img.context || img.alt || ""}`.trim(),
      credit: null,
    });
  }
  return out;
}

async function assetSheet(b: Business, assets: Asset[]): Promise<Content> {
  if (!assets.length) return [textBlock("No image assets are available. Design without photos.")];
  const dir = assetsDirFor(b.id);
  const items = assets.map((a, i) => ({ id: `A${i + 1}`, file: a.path.replace(/^assets\//, ""), label: a.path.replace(/^assets\//, "") }));
  const sheet = await contactSheet(dir, items, "build-assets", assets.length > 16 ? 190 : 230, assets.length > 16 ? 6 : 4);
  const listText = `AVAILABLE IMAGE ASSETS (use these exact paths):\n${assets.map((a, i) => `A${i + 1}: ${a.path} — ${a.label}`).join("\n")}`;
  return sheet ? [textBlock("Contact sheet of the available assets (A-numbers match the list):"), imageBlock(sheet), textBlock(listText)] : [textBlock(listText)];
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Add the concept banner, noindex, footer note and photo credits; copy referenced assets. */
function finalise(html: string, b: Business, outDir: string, credits: string[]): { html: string; missing: string[] } {
  const preparedBy = [config.sender.name, config.sender.business].filter(Boolean).join(", ");
  let out = html.replace(/<head(\s[^>]*)?>/i, "<head>");
  if (!/<head>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}<head></head>`);
  out = out.replace(/<base[^>]*>/gi, "").replace(/<meta[^>]+name=["']robots["'][^>]*>/gi, "");
  out = out.replace("<head>", `<head>\n<meta name="robots" content="noindex, nofollow, noarchive">`);
  out = out.replace(/<title>([\s\S]*?)<\/title>/i, (_m, t: string) => `<title>${t.trim()} — concept preview</title>`);
  const bar = `<div style="background:#0b0b0c;color:#d4d4d8;font:500 12px/1.4 system-ui,sans-serif;text-align:center;padding:7px 16px;position:relative;z-index:9999"><strong style="color:#fff">Design concept</strong> for ${esc(b.name)} · prepared by ${esc(preparedBy)} · not the live website</div>`;
  out = out.replace(/<body([^>]*)>/i, (m) => `${m}\n${bar}`);
  const note = `<div style="background:#0b0b0c;color:#a1a1aa;font:400 12px/1.5 system-ui,sans-serif;text-align:center;padding:14px 16px">Design concept prepared by ${esc(preparedBy)}. Not the official ${esc(b.name)} website.${credits.length ? ` ${esc(credits.join(" · "))}` : ""}</div>`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${note}\n</body>`) : out + note;

  // Copy every referenced asset into the preview folder.
  const srcDir = assetsDirFor(b.id);
  const missing: string[] = [];
  const refs = new Set([...out.matchAll(/assets\/[A-Za-z0-9._\-/]+/g)].map((m) => m[0]));
  for (const ref of refs) {
    const rel = ref.replace(/^assets\//, "");
    const src = path.join(srcDir, rel);
    if (rel.includes("..") || !fs.existsSync(src)) {
      missing.push(ref);
      continue;
    }
    const dest = path.join(outDir, ref);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return { html: out, missing };
}

function checkHtml(html: string, b: Business, ex: Extraction): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  warnings.push(...checkClaims(text, b, ex));

  $("blockquote[data-testimonial]").each((_i, el) => {
    const q = $(el).clone();
    q.find("cite").remove();
    const quote = q.text().replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
    if (!isVerbatim(quote, b, ex)) warnings.push(`Testimonial not found word for word on their site: "${quote.slice(0, 60)}…"`);
  });

  const dig = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^61/, "0");
  const known = new Set([b.phone, ...ex.phones].map(dig).filter(Boolean));
  const listed = b.phone ?? ex.phones[0] ?? null;
  let out = html;
  const tels = new Set([...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]));
  for (const tel of tels) {
    if (known.has(dig(tel))) continue;
    if (listed) {
      out = out.split(`tel:${tel}`).join(`tel:${listed.replace(/\s+/g, "")}`);
      warnings.push(`Phone link ${tel} doesn't match the listing or site, so I pointed it at ${listed}. Check the visible number too.`);
    } else warnings.push(`Phone link ${tel} doesn't match anything on the listing or site.`);
  }
  return { html: out, warnings };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const slugSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 5);
function slugFor(name: string) {
  const base = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base || "business"}-${slugSuffix()}`;
}

export async function buildCustom(businessId: number, opts: { instructions?: string } = {}): Promise<void> {
  const b = getBusiness(businessId);
  if (!b) throw new Error(`Business ${businessId} not found`);
  const row = getFoundation(b.id);
  const parsed = FoundationSchema.safeParse(parseJSON(row?.data));
  const ex = parseJSON<Extraction>(row?.extraction);
  if (!parsed.success || !ex) throw new Error("No valid foundation to build from. Create one first.");
  const f = parsed.data;
  const progress = (msg: string) => setBusinessStatus(b.id, "building", `Custom build: ${msg}`);

  const existing = getDemo(b.id);
  const slug = existing?.slug ?? slugFor(b.name);
  const outDir = path.join(config.previewsDir, slug);

  progress("Choosing photos");
  const stock = await pickStock(b, f);
  const assets = [...siteAssets(ex, f), ...stock];
  const credits = stock.map((s) => s.credit).filter((c): c is string => !!c);
  const sheet = await assetSheet(b, assets);

  const standard = designStandard();
  const facts = [
    `Business name: ${f.business.name}`,
    `Phone (Google): ${b.phone ?? "none"} | Phones on site: ${ex.phones.join(", ") || "none"}`,
    `Emails on site: ${ex.emails.join(", ") || "none"}`,
    `Address (Google): ${b.address ?? "unknown"}`,
    `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews${b.maps_url ? ` (${b.maps_url})` : ""}`,
    `Social links: ${ex.socialLinks.join(", ") || "none"}`,
    `Current website: ${ex.sourceUrl}`,
    `Structured data (hours etc.): ${JSON.stringify(ex.jsonLd).slice(0, 3000)}`,
  ].join("\n");
  const brief: Content = [
    ...sheet,
    textBlock(`APPROVED FOUNDATION:\n${JSON.stringify(f, null, 1)}`),
    textBlock(`FACTS:\n${facts}`),
    ...(opts.instructions ? [textBlock(`INSTRUCTIONS FROM THE DESIGNER FOR THIS BUILD (follow them):\n${opts.instructions}`)] : []),
  ];

  progress("Building the page");
  const built = await claudeJSON({
    system: `${SYSTEM_BUILD}\n\n${standard}`,
    schema: BuildSchema,
    effort: "high",
    maxTokens: 64000,
    content: [...brief, textBlock("Build the homepage now.")],
  });

  const render = (html: string) => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const checked = checkHtml(html, b, ex);
    const fin = finalise(checked.html, b, outDir, credits);
    fs.writeFileSync(path.join(outDir, "index.html"), fin.html);
    const warnings = [...checked.warnings, ...fin.missing.map((m) => `The page references ${m}, which doesn't exist.`)];
    return { source: checked.html, warnings };
  };

  let current = render(built.html);
  let shots = await screenshotPreview(outDir, b.id);
  const allIssues: string[] = [];
  let score = 0;
  let rounds = 0;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    progress(round === 1 ? "Design review" : `Design review (round ${round})`);
    const review = await claudeJSON({
      system: `${SYSTEM_REVIEW}\n\n${standard}`,
      schema: ReviewSchema,
      effort: "high",
      maxTokens: 64000,
      content: [
        ...brief,
        textBlock("Rendered — desktop:"),
        imageBlock(shots.desktopB64),
        textBlock("Rendered — mobile (390px):"),
        imageBlock(shots.mobileB64),
        textBlock(`HTML source:\n${current.source}`),
        ...(current.warnings.length ? [textBlock(`Automated checks flagged:\n- ${current.warnings.join("\n- ")}`)] : []),
        textBlock("Review it. If the score is below 8, return the complete corrected HTML."),
      ],
    });
    score = review.score;
    allIssues.push(...review.issues.map((i) => (round > 1 ? `(round ${round}) ${i}` : i)));
    if (review.score >= 8 || !review.html) break;
    progress(`Applying review (round ${round})`);
    current = render(review.html);
    shots = await screenshotPreview(outDir, b.id);
    rounds = round;
  }

  const warnings = [...new Set(current.warnings)];
  if (stock.length) warnings.unshift("Some photos are stock placeholders. Swap in the business's own photos before going live.");

  db.prepare(
    `INSERT INTO demos (business_id, slug, template, extraction, content, warnings, review, desktop_shot, mobile_shot, built_at)
     VALUES (@id, @slug, 'custom', @extraction, NULL, @warnings, @review, @d, @m, datetime('now'))
     ON CONFLICT(business_id) DO UPDATE SET template='custom', extraction=@extraction, content=NULL,
       warnings=@warnings, review=@review, desktop_shot=@d, mobile_shot=@m, built_at=datetime('now')`,
  ).run({
    id: b.id,
    slug,
    extraction: JSON.stringify(ex),
    warnings: JSON.stringify(warnings),
    review: JSON.stringify({ score, issues: allIssues, revised: rounds > 0, rounds, notes: built.notes }),
    d: shots.desktopRel,
    m: shots.mobileRel,
  });
  db.prepare("UPDATE foundations SET status = 'approved', approved_at = COALESCE(approved_at, datetime('now')) WHERE business_id = ?").run(b.id);
  setBusinessStatus(b.id, "demo_ready");
}
