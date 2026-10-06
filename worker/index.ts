/**
 * Background worker: claims queued jobs from SQLite and runs them.
 * Run alongside the dashboard with `npm run dev` (or `npm run worker` alone).
 */
import "./env";
import { config } from "../src/lib/config";
import { db, parseJSON, setBusinessStatus, type JobRow } from "../src/lib/db";
import { runDiscovery, runScan, refreshCampaignStatus } from "../src/lib/pipeline";
import { buildDemo, type BuildOptions } from "../src/lib/build";
import { createFoundation } from "../src/lib/foundation";
import { buildCustom } from "../src/lib/custom-build";
import { draftOutreach } from "../src/lib/outreach";
import { createReport, renderReport } from "../src/lib/report";
import { getReport } from "../src/lib/db";
import { publishPreview } from "../src/lib/publish";
import { closeBrowser } from "../src/lib/browser";

const SLOTS = Math.max(1, config.scanConcurrency);
let running = 0;
let stopping = false;

// Jobs left "running" by a crashed worker go back in the queue.
db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run();
db.prepare("UPDATE businesses SET status = 'discovered', status_note = 'Re-queued after restart' WHERE status = 'scanning'").run();

const claim = db.prepare(`
  UPDATE jobs SET status = 'running', started_at = datetime('now')
  WHERE id = (
    SELECT id FROM jobs WHERE status = 'queued'
    ORDER BY CASE type WHEN 'scan' THEN 2 WHEN 'discover' THEN 1 ELSE 0 END, id
    LIMIT 1
  )
  RETURNING *`);

/** Re-render an existing report (no AI) so it shows the newest concept. */
function refreshReport(businessId: number) {
  if (!getReport(businessId)) return;
  try {
    renderReport(businessId);
  } catch (err) {
    console.warn(`[report] couldn't refresh report for ${businessId}:`, err);
  }
}

async function execute(job: JobRow) {
  const payload = parseJSON<Record<string, unknown>>(job.payload) ?? {};
  switch (job.type) {
    case "discover": {
      const r = await runDiscovery(job.campaign_id!);
      console.log(`[discover] campaign ${job.campaign_id}: ${r.found} found, ${r.added} new`);
      break;
    }
    case "scan":
      await runScan(job.business_id!);
      break;
    case "build":
    case "redesign":
    case "rerender": {
      const mode: BuildOptions["mode"] = job.type === "build" ? "full" : job.type === "redesign" ? "redesign" : "rerender";
      try {
        await buildDemo(job.business_id!, {
          mode,
          style: payload.style as string | undefined,
          instructions: payload.instructions as string | undefined,
        });
      } catch (err) {
        setBusinessStatus(job.business_id!, "build_failed", err instanceof Error ? err.message.slice(0, 300) : String(err));
        throw err;
      }
      refreshReport(job.business_id!);
      break;
    }
    case "foundation":
    case "custom_build":
      try {
        if (job.type === "foundation") {
          await createFoundation(job.business_id!, {
            instructions: payload.instructions as string | undefined,
            rescrape: payload.rescrape === true,
          });
        } else {
          await buildCustom(job.business_id!, { instructions: payload.instructions as string | undefined });
        }
      } catch (err) {
        setBusinessStatus(job.business_id!, "build_failed", err instanceof Error ? err.message.slice(0, 300) : String(err));
        throw err;
      }
      if (job.type === "custom_build") refreshReport(job.business_id!);
      break;
    case "report":
      await createReport(job.business_id!);
      break;
    case "outreach":
      await draftOutreach(job.business_id!);
      break;
    case "publish":
      await publishPreview(job.business_id!);
      break;
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

function tick() {
  while (!stopping && running < SLOTS) {
    const job = claim.get() as JobRow | undefined;
    if (!job) break;
    running++;
    const started = Date.now();
    console.log(`[job ${job.id}] ${job.type} business=${job.business_id ?? "-"} campaign=${job.campaign_id ?? "-"}`);
    execute(job)
      .then(() => {
        db.prepare("UPDATE jobs SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(job.id);
        console.log(`[job ${job.id}] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[job ${job.id}] failed: ${msg}`);
        db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?").run(msg.slice(0, 2000), job.id);
        if (job.type === "discover") db.prepare("UPDATE campaigns SET status = 'failed' WHERE id = ?").run(job.campaign_id);
        if (job.type === "scan" && job.business_id) {
          setBusinessStatus(job.business_id, "scan_failed", msg.slice(0, 300));
        }
      })
      .finally(() => {
        running--;
        if (job.campaign_id) refreshCampaignStatus(job.campaign_id);
      });
  }
}

const timer = setInterval(tick, 1000);
console.log(`Worker started with ${SLOTS} slots. Waiting for jobs…`);

async function shutdown() {
  stopping = true;
  clearInterval(timer);
  console.log("Stopping worker…");
  const deadline = Date.now() + 15000;
  while (running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
