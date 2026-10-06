import { db, enqueue, getBusiness, setBusinessStatus, type Campaign } from "./db";
import { discoverBusinesses, findPlaceForWebsite, hostOf } from "./places";
import { isManual } from "./stages";
import { scanWebsite, runPageSpeed, wappalyzerLookup } from "./scan";
import { qualify } from "./qualify";
import { computeScore, isTrulyAwful } from "./scoring";

const NOT_A_REAL_SITE = /facebook\.com|instagram\.com|linktr\.ee|business\.site|google\.com|yellowpages|hipages|oneflare|airtasker|truelocal/i;

export async function runDiscovery(campaignId: number) {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as Campaign | undefined;
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  db.prepare("UPDATE campaigns SET status = 'discovering' WHERE id = ?").run(campaignId);

  const places = await discoverBusinesses({
    industry: campaign.industry,
    locations: campaign.locations
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    radiusKm: campaign.radius_km,
    maxResults: campaign.max_results,
  });

  const insert = db.prepare(
    `INSERT OR IGNORE INTO businesses
      (campaign_id, place_id, name, category, types, address, phone, website, rating, review_count, maps_url, lat, lng, distance_km, status, status_note)
     VALUES (@campaign_id, @place_id, @name, @category, @types, @address, @phone, @website, @rating, @review_count, @maps_url, @lat, @lng, @distance_km, @status, @note)`,
  );
  let added = 0;
  for (const p of places) {
    const realSite = p.website && !NOT_A_REAL_SITE.test(p.website);
    const res = insert.run({
      campaign_id: campaignId,
      place_id: p.placeId,
      name: p.name,
      category: p.category,
      types: JSON.stringify(p.types),
      address: p.address,
      phone: p.phone,
      website: p.website,
      rating: p.rating,
      review_count: p.reviewCount,
      maps_url: p.mapsUrl,
      lat: p.lat,
      lng: p.lng,
      distance_km: p.distanceKm,
      status: realSite ? "discovered" : "no_website",
      note: realSite ? null : p.website ? `Only has ${new URL(p.website).hostname}` : "No website listed",
    });
    if (res.changes > 0) {
      added++;
      if (realSite) enqueue("scan", { businessId: Number(res.lastInsertRowid), campaignId });
    }
  }
  db.prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(added ? "scanning" : "done", campaignId);
  return { found: places.length, added };
}



/** Leads you added by hand: attach their Google listing (rating, phone, address) when one matches the domain. */
async function enrichManualLead(id: number) {
  const b = getBusiness(id)!;
  const named = b.name !== hostOf(b.website ?? "");
  let place = null;
  try {
    place = await findPlaceForWebsite({ website: b.website!, name: named ? b.name : null, area: b.address });
  } catch (err) {
    console.warn(`[lead ${id}] Google lookup failed:`, err instanceof Error ? err.message : err);
  }
  if (!place) return;
  db.prepare(
    `UPDATE businesses SET name = @name, category = COALESCE(category, @category), types = @types, address = @address, phone = @phone,
       rating = @rating, review_count = @reviews, maps_url = @maps, lat = @lat, lng = @lng, updated_at = datetime('now') WHERE id = @id`,
  ).run({
    id,
    name: named ? b.name : place.name,
    category: place.category,
    types: JSON.stringify(place.types),
    address: place.address,
    phone: place.phone,
    rating: place.rating,
    reviews: place.reviewCount,
    maps: place.mapsUrl,
    lat: place.lat,
    lng: place.lng,
  });
}

export async function runScan(businessId: number) {
  let b = getBusiness(businessId);
  if (!b?.website) throw new Error("Business has no website");
  const website = b.website;
  if (isManual(b)) {
    setBusinessStatus(b.id, "scanning", "Looking up their Google listing");
    await enrichManualLead(b.id);
    b = getBusiness(businessId)!;
  }
  setBusinessStatus(b.id, "scanning", "Loading website");

  const pagespeedPromise = runPageSpeed(website);
  const wappalyzerPromise = wappalyzerLookup(website);
  let scan;
  try {
    scan = await scanWebsite(website, b.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    db.prepare(
      `INSERT INTO scans (business_id, error) VALUES (?, ?)
       ON CONFLICT(business_id) DO UPDATE SET error = excluded.error, scanned_at = datetime('now')`,
    ).run(b.id, msg);
    setBusinessStatus(b.id, "scan_failed", `Website failed to load: ${msg.slice(0, 160)}`);
    return;
  }
  setBusinessStatus(b.id, "scanning", "Running PageSpeed + AI review");
  const [pagespeed, wappalyzer] = await Promise.all([pagespeedPromise, wappalyzerPromise]);
  if (wappalyzer.length) scan.metrics.tech = [...new Set([...scan.metrics.tech, ...wappalyzer])];

  const q = await qualify(b, scan.metrics, pagespeed, { desktop: scan.desktopShot, mobile: scan.mobileShot });
  const score = computeScore(b, scan.metrics, pagespeed, q);

  db.prepare(
    `INSERT INTO scans (business_id, metrics, pagespeed, ai, score_breakdown, desktop_shot, mobile_shot, error, scanned_at)
     VALUES (@id, @metrics, @pagespeed, @ai, @score, @d, @m, NULL, datetime('now'))
     ON CONFLICT(business_id) DO UPDATE SET metrics=@metrics, pagespeed=@pagespeed, ai=@ai, score_breakdown=@score,
       desktop_shot=@d, mobile_shot=@m, error=NULL, scanned_at=datetime('now')`,
  ).run({
    id: b.id,
    metrics: JSON.stringify(scan.metrics),
    pagespeed: pagespeed ? JSON.stringify(pagespeed) : null,
    ai: JSON.stringify(q),
    score: JSON.stringify(score),
    d: scan.desktopShot,
    m: scan.mobileShot,
  });
  // A hand-added lead with no Google listing is named after its domain; the page title is better.
  if (isManual(b) && b.name === hostOf(website) && scan.metrics.title) {
    const title = scan.metrics.title.split(/\s+[|\-–—:]\s+/)[0].trim().slice(0, 80);
    if (title) db.prepare("UPDATE businesses SET name = ? WHERE id = ?").run(title, b.id);
  }

  const awful = isTrulyAwful(q, score.websiteHard);
  // Leads you added yourself are never auto-skipped: you already decided they're worth a look.
  const keep = awful || isManual(b);
  db.prepare("UPDATE businesses SET opportunity_score = ?, status = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?").run(
    score.total,
    keep ? "qualified" : "skipped",
    keep ? null : `Auto-skipped: website not bad enough (redesign ${q.redesign_opportunity}, hard ${score.websiteHard})`,
    b.id,
  );
}

/** Mark a campaign done once nothing is left in flight. */
export function refreshCampaignStatus(campaignId: number) {
  const pending = db
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE campaign_id = ? AND type IN ('discover','scan') AND status IN ('queued','running')")
    .get(campaignId) as { n: number };
  if (pending.n === 0) db.prepare("UPDATE campaigns SET status = 'done' WHERE id = ? AND status NOT IN ('failed', 'manual')").run(campaignId);
}
