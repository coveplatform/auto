import * as z from "zod/v4";
import { claudeJSON, imageBlock, textBlock } from "./claude";
import type { Business } from "./db";
import type { PageSpeedResult, SiteMetrics } from "./scan";
import { readShotBase64 } from "./scan";
import { STYLES } from "./templates/plan";

export const QualificationSchema = z.object({
  redesign_opportunity: z.number().int().describe("0-100. How much a modern redesign would visibly improve this site."),
  visual_age: z.number().int().describe("0-100. 100 = looks very dated (e.g. 2008-era), 0 = looks current."),
  mobile_quality: z.number().int().describe("0-100. 100 = excellent mobile experience."),
  conversion_quality: z.number().int().describe("0-100. Clear CTAs, phone prominence, trust signals, easy enquiry."),
  brand_quality: z.number().int().describe("0-100. Logo, consistent colours, professional imagery."),
  commercial_clarity: z.number().int().describe("0-100. How clearly this is a real commercial service business with defined services."),
  ability_to_pay: z.number().int().describe("0-100. Apparent ability to pay ~$1-2k for a website (size, fleet, premises, service value)."),
  brand_assets_available: z.number().int().describe("0-100. Usable logo, photos and content exist to build a demo from."),
  confidence: z.number().int().describe("0-100. Your confidence in this assessment."),
  problems: z.array(z.string()).describe("Short, specific problems a business owner would recognise. Max 6."),
  strengths: z.array(z.string()).describe("What already works and should be kept. Max 4."),
  summary: z.string().describe("2 sentences for the salesperson: the business and why it is or isn't a good redesign prospect."),
  suggested_style: z.enum(STYLES),
  worth_mocking_up: z
    .boolean()
    .describe("true ONLY if the site is truly awful (see system prompt). Merely average or slightly dated sites are false."),
});

export type Qualification = z.infer<typeof QualificationSchema>;

const SYSTEM = `You assess small-business websites for a freelance web designer in Australia who builds speculative redesign demos.
You receive desktop and mobile screenshots of a homepage plus automated measurements.
Judge like an experienced designer: visual era, mobile usability, hierarchy, calls to action, trust signals, and brand.
Base every judgement on what is visible or measured. Do not guess at facts you cannot see.
The designer only wants TRULY AWFUL websites. Be harsh about what counts:
- Truly awful = obviously 2000s/early-2010s era, broken or unusable on mobile (no responsive layout, tiny text, sideways scrolling), visibly broken layout/images, cluttered amateur DIY design, or no clear way to contact the business.
- NOT awful = any reasonably modern template (Wix, Squarespace, WordPress themes, etc.) that works on mobile, even if bland, generic, slow or a little dated.
Reserve redesign_opportunity >= 70 and visual_age >= 70 for truly awful sites. An average or "could be better" site belongs under 50.
Set worth_mocking_up to true only for truly awful sites.
Problems must be concrete and phrased so the business owner would agree ("phone number is hard to find on mobile"), not jargon.

Suggest the closest site style for this business: boutique (retail/florists/gifts), bold (trades), clean (home services), editorial (professional services), soft (health & beauty), warm (hospitality).`;

function metricsSummary(b: Business, m: SiteMetrics, ps: PageSpeedResult | null): string {
  const lines = [
    `Business: ${b.name}`,
    `Category: ${b.category ?? "unknown"} | Address: ${b.address ?? "unknown"}`,
    `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews`,
    `URL: ${m.finalUrl} (HTTP ${m.httpStatus ?? "?"}, ${m.https ? "HTTPS" : "no HTTPS"}, loaded in ${(m.loadMs / 1000).toFixed(1)}s)`,
    `Title: ${m.title || "(none)"} | Meta description: ${m.metaDescription ? "present" : "missing"}`,
    `Viewport meta: ${m.hasViewportMeta ? "yes" : "NO (not mobile-friendly)"} | Mobile horizontal overflow: ${m.mobileHorizontalOverflow ? "YES" : "no"}`,
    `Mobile small-text ratio: ${Math.round(m.mobileSmallTextRatio * 100)}% | Small tap targets near top: ${m.mobileTapTargetsTooSmall}`,
    `CTA above fold: desktop ${m.ctaAboveFoldDesktop ? "yes" : "no"}, mobile ${m.ctaAboveFoldMobile ? "yes" : "no"} | CTAs found: ${m.ctas.join(", ") || "none"}`,
    `Click-to-call links: ${m.telLinks} | Forms: ${m.formCount} | Emails visible: ${m.emails.length}`,
    `Copyright year: ${m.copyrightYear ?? "not found"} | Tech: ${m.tech.join(", ") || "unknown"}`,
    `H1 count: ${m.h1Count} | Words: ${m.wordCount} | Images: ${m.imageCount} (${m.imagesMissingAlt} missing alt)`,
    `Broken internal links: ${m.brokenLinks.length}/${m.checkedLinks} | Console errors: ${m.consoleErrors}`,
  ];
  if (ps) {
    lines.push(
      `PageSpeed (mobile): performance ${ps.performance}, accessibility ${ps.accessibility}, SEO ${ps.seo}, best practices ${ps.bestPractices}; LCP ${ps.lcpMs ? (ps.lcpMs / 1000).toFixed(1) + "s" : "?"}, CLS ${ps.cls?.toFixed(2) ?? "?"}`,
    );
  }
  lines.push("", "Visible homepage text (truncated):", m.visibleText.slice(0, 2500));
  return lines.join("\n");
}

export async function qualify(
  business: Business,
  metrics: SiteMetrics,
  pagespeed: PageSpeedResult | null,
  shots: { desktop: string; mobile: string },
): Promise<Qualification> {
  return claudeJSON({
    system: SYSTEM,
    schema: QualificationSchema,
    effort: "medium",
    maxTokens: 8000,
    content: [
      textBlock("Desktop homepage screenshot:"),
      imageBlock(readShotBase64(shots.desktop)),
      textBlock("Mobile homepage screenshot (390px wide):"),
      imageBlock(readShotBase64(shots.mobile)),
      textBlock(metricsSummary(business, metrics, pagespeed)),
      textBlock("Assess this website as a redesign prospect."),
    ],
  });
}
