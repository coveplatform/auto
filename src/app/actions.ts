"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, enqueue, getBusiness, getDemo, getFoundation, parseJSON, setBusinessStatus } from "@/lib/db";
import { FoundationSchema, checkFoundation, saveFoundation } from "@/lib/foundation";
import type { Extraction } from "@/lib/templates/content";
import { hostOf } from "@/lib/places";
import { MANUAL_CAMPAIGN_STATUS } from "@/lib/stages";
import { STYLES, SitePlanSchema } from "@/lib/templates/plan";

// The dashboard is meant to run locally (bound to 127.0.0.1). If you ever host it,
// add authentication here before exposing these actions.

const refresh = () => revalidatePath("/", "layout");
const idOf = (fd: FormData) => {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Bad id");
  return id;
};

export async function createCampaign(fd: FormData) {
  const industry = String(fd.get("industry") ?? "").trim();
  const locations = String(fd.get("locations") ?? "").trim();
  const radius = Math.min(50, Math.max(0, Number(fd.get("radius") ?? 10)));
  const max = Math.min(300, Math.max(5, Number(fd.get("max") ?? 100)));
  if (!industry || !locations) throw new Error("Industry and location are required");
  const res = db
    .prepare("INSERT INTO campaigns (industry, locations, radius_km, max_results) VALUES (?, ?, ?, ?)")
    .run(industry, locations, radius, max);
  const id = Number(res.lastInsertRowid);
  enqueue("discover", { campaignId: id });
  redirect(`/campaigns/${id}`);
}

// ---- Leads you add by hand ----

function manualCampaignId(): number {
  const row = db.prepare("SELECT id FROM campaigns WHERE status = ?").get(MANUAL_CAMPAIGN_STATUS) as { id: number } | undefined;
  if (row) return row.id;
  return Number(
    db
      .prepare("INSERT INTO campaigns (industry, locations, radius_km, max_results, status) VALUES ('Added by you', '', 0, 0, ?)")
      .run(MANUAL_CAMPAIGN_STATUS).lastInsertRowid,
  );
}

/** Add a single website as a lead: look up its Google listing, scan it and score it. */
export async function addLead(fd: FormData) {
  const raw = String(fd.get("website") ?? "").trim();
  const host = hostOf(raw);
  if (!host || !host.includes(".")) redirect(`/leads?error=${encodeURIComponent("That doesn't look like a website address.")}`);
  const website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  const existing = (db.prepare("SELECT id, website FROM businesses WHERE website IS NOT NULL").all() as Array<{ id: number; website: string }>).find(
    (r) => hostOf(r.website) === host,
  );
  if (existing) redirect(`/business/${existing.id}?notice=${encodeURIComponent("You already have this one.")}`);

  const name = String(fd.get("name") ?? "").trim() || host;
  const area = String(fd.get("area") ?? "").trim() || null;
  const category = String(fd.get("category") ?? "").trim() || null;
  const campaignId = manualCampaignId();
  const id = Number(
    db
      .prepare(
        `INSERT INTO businesses (campaign_id, place_id, name, category, address, website, status, status_note)
         VALUES (?, ?, ?, ?, ?, ?, 'discovered', 'Added by you')`,
      )
      .run(campaignId, `manual:${host}`, name, category, area, website).lastInsertRowid,
  );
  enqueue("scan", { businessId: id, campaignId });
  refresh();
  redirect(`/business/${id}`);
}

export async function deleteLead(fd: FormData) {
  db.prepare("DELETE FROM businesses WHERE id = ?").run(idOf(fd));
  refresh();
  redirect("/leads");
}

export async function deleteCampaign(fd: FormData) {
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(idOf(fd));
  refresh();
  redirect("/");
}

// ---- Gate 1: prospects ----

export async function approveProspect(fd: FormData) {
  const id = idOf(fd);
  setBusinessStatus(id, "building", "Queued");
  enqueue("build", { businessId: id });
  refresh();
}

export async function skipProspect(fd: FormData) {
  setBusinessStatus(idOf(fd), "skipped");
  refresh();
}

export async function restoreProspect(fd: FormData) {
  const id = idOf(fd);
  const hasScan = db.prepare("SELECT 1 FROM scans WHERE business_id = ? AND ai IS NOT NULL").get(id);
  setBusinessStatus(id, hasScan ? "qualified" : "discovered");
  refresh();
}

export async function rescan(fd: FormData) {
  const id = idOf(fd);
  const campaign = db.prepare("SELECT campaign_id FROM businesses WHERE id = ?").get(id) as { campaign_id: number };
  setBusinessStatus(id, "discovered", "Re-scan queued");
  enqueue("scan", { businessId: id, campaignId: campaign.campaign_id });
  refresh();
}

// ---- Foundation (strategy + creative direction before a custom build) ----

/** Run the foundation passes. Optional designer direction; "rescrape" re-reads their site. */
export async function createFoundation(fd: FormData) {
  const id = idOf(fd);
  const instructions = String(fd.get("instructions") ?? "").trim() || undefined;
  setBusinessStatus(id, "building", "Foundation: queued");
  enqueue("foundation", { businessId: id, payload: { instructions, rescrape: fd.get("rescrape") === "on" } });
  refresh();
}

/** Save a hand-edited foundation (site-spec JSON) without calling the AI. */
export async function saveFoundationJSON(fd: FormData): Promise<void> {
  const id = idOf(fd);
  const b = getBusiness(id);
  const row = getFoundation(id);
  const ex = parseJSON<Extraction>(row?.extraction);
  if (!b || !row || !ex) throw new Error("No foundation");
  let parsed;
  try {
    parsed = FoundationSchema.parse(JSON.parse(String(fd.get("data") ?? "")));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(`/business/${id}?error=${encodeURIComponent("Foundation JSON is invalid: " + msg.slice(0, 300))}#foundation-edit`);
  }
  saveFoundation(id, { foundation: parsed, warnings: checkFoundation(parsed, b, ex) });
  if (b.status !== "building") setBusinessStatus(id, "foundation_ready");
  refresh();
  redirect(`/business/${id}#foundation`);
}

/** Gate 1.5: approve the foundation and hand it to the custom builder. */
export async function approveFoundation(fd: FormData) {
  const id = idOf(fd);
  if (!getFoundation(id)?.data) throw new Error("No foundation");
  db.prepare("UPDATE foundations SET status = 'approved', approved_at = datetime('now') WHERE business_id = ?").run(id);
  setBusinessStatus(id, "building", "Custom build: queued");
  enqueue("custom_build", { businessId: id });
  refresh();
}

/** Rebuild the custom page from the same foundation, with optional direction for this build. */
export async function rebuildCustom(fd: FormData) {
  const id = idOf(fd);
  const instructions = String(fd.get("instructions") ?? "").trim() || undefined;
  setBusinessStatus(id, "building", "Custom build: queued");
  enqueue("custom_build", { businessId: id, payload: { instructions } });
  refresh();
}

// ---- Owner report ----

/** Write (or rewrite) the owner-facing website review. */
export async function writeReport(fd: FormData) {
  enqueue("report", { businessId: idOf(fd) });
  refresh();
}

// ---- Gate 2: demos ----

export async function approveDemo(fd: FormData) {
  const id = idOf(fd);
  setBusinessStatus(id, "demo_approved");
  enqueue("outreach", { businessId: id });
  refresh();
}

export async function rejectDemo(fd: FormData) {
  setBusinessStatus(idOf(fd), "rejected");
  refresh();
}

/** Re-render the same plan in another style (no AI call). */
export async function changeStyle(fd: FormData) {
  const id = idOf(fd);
  const style = String(fd.get("style"));
  if (!(STYLES as readonly string[]).includes(style)) throw new Error("Unknown style");
  setBusinessStatus(id, "building", "Switching style");
  enqueue("rerender", { businessId: id, payload: { style } });
  refresh();
}

/** A fresh design pass from the saved scrape, with optional direction from you. */
export async function redesign(fd: FormData) {
  const id = idOf(fd);
  const instructions = String(fd.get("instructions") ?? "").trim() || undefined;
  setBusinessStatus(id, "building", "Redesigning");
  enqueue("redesign", { businessId: id, payload: { instructions } });
  refresh();
}

export async function rebuildFromScratch(fd: FormData) {
  const id = idOf(fd);
  setBusinessStatus(id, "building", "Rebuilding from scratch");
  enqueue("build", { businessId: id });
  refresh();
}

export async function saveContent(fd: FormData): Promise<void> {
  const id = idOf(fd);
  const raw = String(fd.get("content") ?? "");
  let parsed;
  try {
    parsed = SitePlanSchema.parse(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(`/business/${id}?error=${encodeURIComponent("Content JSON is invalid: " + msg.slice(0, 300))}#edit`);
  }
  if (!getDemo(id)) throw new Error("No demo");
  db.prepare("UPDATE demos SET content = ? WHERE business_id = ?").run(JSON.stringify(parsed), id);
  setBusinessStatus(id, "building", "Applying edits");
  enqueue("rerender", { businessId: id });
  refresh();
  redirect(`/business/${id}`);
}

// ---- Outreach ----

export async function publishPreview(fd: FormData) {
  enqueue("publish", { businessId: idOf(fd) });
  refresh();
}

export async function regenerateEmail(fd: FormData) {
  enqueue("outreach", { businessId: idOf(fd) });
  refresh();
}

export async function saveOutreach(fd: FormData) {
  const id = idOf(fd);
  db.prepare(
    "UPDATE outreach SET to_email = ?, subject = ?, body = ?, updated_at = datetime('now') WHERE business_id = ?",
  ).run(String(fd.get("to_email") ?? "").trim() || null, String(fd.get("subject") ?? ""), String(fd.get("body") ?? ""), id);
  refresh();
}

export async function markSent(fd: FormData) {
  const id = idOf(fd);
  db.prepare("UPDATE outreach SET status = 'sent', sent_at = datetime('now') WHERE business_id = ?").run(id);
  setBusinessStatus(id, "contacted");
  refresh();
}

// ---- Jobs ----

export async function retryJob(fd: FormData) {
  db.prepare("UPDATE jobs SET status = 'queued', error = NULL, started_at = NULL, finished_at = NULL WHERE id = ?").run(idOf(fd));
  refresh();
}
