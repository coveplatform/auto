import { customAlphabet } from "nanoid";
import { db, getBusiness, getDemo, getScan, parseJSON, setBusinessStatus } from "./db";
import { extractSite } from "./extract";
import { designSite, rerenderPlan } from "./design";
import type { Qualification } from "./qualify";
import type { SiteMetrics } from "./scan";
import type { Extraction } from "./templates/content";
import { STYLES, SitePlanSchema, type SitePlan, type StyleId } from "./templates/plan";

const suffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 5);

function slugFor(name: string) {
  const base = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "business"}-${suffix()}`;
}

const isStyle = (s: unknown): s is StyleId => typeof s === "string" && (STYLES as readonly string[]).includes(s);

export interface BuildOptions {
  /** full: scrape + design; redesign: new design from the saved scrape; rerender: render the saved (edited) plan */
  mode: "full" | "redesign" | "rerender";
  style?: string;
  instructions?: string;
}

export async function buildDemo(businessId: number, opts: BuildOptions): Promise<void> {
  const b = getBusiness(businessId);
  if (!b) throw new Error(`Business ${businessId} not found`);
  if (!b.website) throw new Error("Business has no website to build from");
  const progress = (msg: string) => setBusinessStatus(b.id, "building", msg);
  progress(opts.mode === "full" ? "Scraping their site" : "Rebuilding");

  const existing = getDemo(b.id);
  const scan = getScan(b.id);
  const qualification = parseJSON<Qualification>(scan?.ai);
  const metrics = parseJSON<SiteMetrics>(scan?.metrics);
  const slug = existing?.slug ?? slugFor(b.name);

  let extraction = parseJSON<Extraction>(existing?.extraction);
  if (opts.mode === "full" || !extraction) extraction = await extractSite(metrics?.finalUrl ?? b.website, b.id);

  const savedPlan = SitePlanSchema.safeParse(parseJSON(existing?.content));
  let plan: SitePlan;
  let warnings: string[];
  let review: { score: number; issues: string[]; revised: boolean } | null = parseJSON(existing?.review) ?? null;
  let shots: { desktopRel: string; mobileRel: string };

  if (opts.mode === "rerender" && savedPlan.success) {
    const p = savedPlan.data;
    if (isStyle(opts.style)) p.style = opts.style;
    progress("Rendering");
    const r = await rerenderPlan({ business: b, extraction, qualification, slug, plan: p });
    ({ plan, warnings, shots } = r);
  } else {
    const r = await designSite({
      business: b,
      extraction,
      qualification,
      slug,
      instructions: opts.instructions,
      styleOverride: isStyle(opts.style) ? opts.style : undefined,
      onProgress: progress,
    });
    ({ plan, warnings, shots, review } = r);
  }

  db.prepare(
    `INSERT INTO demos (business_id, slug, template, extraction, content, warnings, review, desktop_shot, mobile_shot, built_at)
     VALUES (@id, @slug, @style, @extraction, @content, @warnings, @review, @d, @m, datetime('now'))
     ON CONFLICT(business_id) DO UPDATE SET template=@style, extraction=@extraction, content=@content,
       warnings=@warnings, review=@review, desktop_shot=@d, mobile_shot=@m, built_at=datetime('now')`,
  ).run({
    id: b.id,
    slug,
    style: plan.style,
    extraction: JSON.stringify(extraction),
    content: JSON.stringify(plan),
    warnings: JSON.stringify(warnings),
    review: review ? JSON.stringify(review) : null,
    d: shots.desktopRel,
    m: shots.mobileRel,
  });
  setBusinessStatus(b.id, "demo_ready");
}
