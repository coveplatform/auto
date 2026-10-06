import type { Business } from "./db";
import type { Qualification } from "./qualify";
import type { PageSpeedResult, SiteMetrics } from "./scan";

/**
 * Opportunity Score — not "worst website" score.
 *   35% website improvement opportunity
 *   20% business quality / review activity
 *   15% clear commercial service
 *   15% apparent ability to pay
 *   10% contactability
 *    5% existing brand / assets available
 */
export const WEIGHTS = {
  website: 0.35,
  business: 0.2,
  commercial: 0.15,
  ability: 0.15,
  contact: 0.1,
  assets: 0.05,
} as const;

export interface ScoreBreakdown {
  total: number;
  website: number;
  websiteHard: number;
  business: number;
  commercial: number;
  ability: number;
  contact: number;
  assets: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Website weakness from hard measurements only (0 = fine, 100 = clearly broken/dated). */
export function hardWebsiteScore(m: SiteMetrics, ps: PageSpeedResult | null): number {
  let s = 0;
  if (!m.hasViewportMeta) s += 25;
  if (m.mobileHorizontalOverflow) s += 15;
  s += clamp(m.mobileSmallTextRatio * 30, 0, 15);
  if (!m.ctaAboveFoldMobile) s += 10;
  if (m.telLinks === 0) s += 8;
  if (!m.https) s += 10;
  if (m.brokenLinks.length > 0) s += Math.min(10, m.brokenLinks.length * 3);
  const year = new Date().getFullYear();
  if (m.copyrightYear && year - m.copyrightYear >= 3) s += Math.min(15, (year - m.copyrightYear) * 2);
  if (m.tech.some((t) => /obsolete|old\)|Nested table/i.test(t))) s += 10;
  if (ps?.performance != null) s += (100 - ps.performance) * 0.2;
  if (m.loadMs > 6000) s += 5;
  return Math.round(clamp(s));
}

/**
 * Only truly awful sites are prospects. Claude has to call it awful and back it with a
 * high redesign score, or the hard measurements must show the site is objectively broken.
 */
export const AWFUL_MIN_REDESIGN = 70;
export const AWFUL_MIN_HARD = 60;

export function isTrulyAwful(q: Qualification, websiteHard: number): boolean {
  if (websiteHard >= AWFUL_MIN_HARD && q.redesign_opportunity >= 50) return true;
  return q.worth_mocking_up && q.redesign_opportunity >= AWFUL_MIN_REDESIGN;
}

function reviewActivity(b: Business): number {
  const count = b.review_count ?? 0;
  return clamp((Math.log10(count + 1) / Math.log10(200)) * 100);
}

function businessQuality(b: Business): number {
  if (b.rating == null) return 25;
  const ratingPart = clamp(((b.rating - 3.5) / 1.5) * 100);
  return Math.round(ratingPart * 0.5 + reviewActivity(b) * 0.5);
}

export function computeScore(
  b: Business,
  m: SiteMetrics,
  ps: PageSpeedResult | null,
  q: Qualification,
): ScoreBreakdown {
  const websiteHard = hardWebsiteScore(m, ps);
  const website = Math.round(clamp(q.redesign_opportunity) * 0.7 + websiteHard * 0.3);
  const business = businessQuality(b);
  const commercial = clamp(q.commercial_clarity);
  const ability = Math.round(clamp(q.ability_to_pay) * 0.6 + reviewActivity(b) * 0.4);
  const contact = clamp((m.emails.length ? 50 : 0) + (b.phone ? 30 : 0) + (m.formCount ? 20 : 0));
  const assets = clamp(q.brand_assets_available);

  let total =
    website * WEIGHTS.website +
    business * WEIGHTS.business +
    commercial * WEIGHTS.commercial +
    ability * WEIGHTS.ability +
    contact * WEIGHTS.contact +
    assets * WEIGHTS.assets;

  // A great business with an already-great website is not a redesign lead.
  if (q.redesign_opportunity < 25) total *= 0.6;

  return {
    total: Math.round(total),
    website,
    websiteHard,
    business,
    commercial,
    ability,
    contact,
    assets,
  };
}
