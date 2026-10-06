import type { BusinessStatus } from "./db";

/** How businesses are grouped into tabs on the campaign and leads pages. */
export const STAGE_TABS: Array<{ key: string; label: string; statuses: BusinessStatus[] }> = [
  { key: "review", label: "To review", statuses: ["qualified"] },
  { key: "pipeline", label: "In pipeline", statuses: ["building", "foundation_ready", "demo_ready", "demo_approved", "contacted", "build_failed"] },
  { key: "scanning", label: "Scanning", statuses: ["discovered", "scanning"] },
  { key: "nosite", label: "Needs a website", statuses: ["no_website"] },
  { key: "failed", label: "Site down / failed", statuses: ["scan_failed"] },
  { key: "skipped", label: "Skipped / rejected", statuses: ["skipped", "rejected"] },
];

/** Hand-added leads live in one hidden campaign with this status. */
export const MANUAL_CAMPAIGN_STATUS = "manual";

/** True for a lead you added by hand rather than one found by a campaign. */
export const isManual = (b: { place_id: string }) => b.place_id.startsWith("manual:");
