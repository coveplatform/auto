import Link from "next/link";
import { connection } from "next/server";
import { db, type Campaign } from "@/lib/db";
import { config } from "@/lib/config";
import { createCampaign } from "./actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LocationPicker } from "@/components/LocationPicker";

const INDUSTRIES = [
  "Florists",
  "Plumbers",
  "Electricians",
  "Builders",
  "Landscapers",
  "Cleaners",
  "Painters",
  "Cafes",
  "Restaurants",
  "Bakeries",
  "Hair salons",
  "Beauty salons",
  "Physiotherapists",
  "Dentists",
  "Accountants",
  "Mechanics",
  "Removalists",
  "Pest control",
  "Dog groomers",
  "Gyms",
];

interface CampaignRow extends Campaign {
  total: number;
  scanned: number;
  to_review: number;
  no_site: number;
  demos: number;
  contacted: number;
}

export default async function Home() {
  await connection();
  const campaigns = db
    .prepare(
      `SELECT c.*,
        COUNT(b.id) AS total,
        SUM(b.status NOT IN ('discovered','scanning','no_website')) AS scanned,
        SUM(b.status = 'qualified') AS to_review,
        SUM(b.status = 'no_website') AS no_site,
        SUM(b.status IN ('demo_ready','demo_approved','contacted')) AS demos,
        SUM(b.status = 'contacted') AS contacted
       FROM campaigns c LEFT JOIN businesses b ON b.campaign_id = c.id
       WHERE c.status != 'manual'
       GROUP BY c.id ORDER BY c.id DESC`,
    )
    .all() as CampaignRow[];
  const pending = (db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get() as { n: number }).n;
  const workerSeen = db.prepare("SELECT MAX(started_at) t FROM jobs").get() as { t: string | null };

  const missing = [
    config.claudeProvider === "vertex"
      ? !(config.vertexProjectId && process.env.GOOGLE_APPLICATION_CREDENTIALS) && "VERTEX_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS"
      : config.claudeProvider !== "claude-code" && !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
    !config.googleApiKey && "GOOGLE_API_KEY",
  ].filter(Boolean);

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
      <AutoRefresh active={pending > 0} intervalMs={4000} />
      <section>
        <form action={createCampaign} className="card sticky top-20 grid gap-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">New prospect search</h1>
            <p className="text-sm text-black/50">Find businesses, scan their sites and score them.</p>
          </div>
          <label>
            <span className="label">Industry</span>
            <input name="industry" className="input" placeholder="Florists" list="industries" required />
            <datalist id="industries">
              {INDUSTRIES.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </label>
          <LocationPicker />
          <label>
            <span className="label">Max businesses</span>
            <input name="max" type="number" className="input" defaultValue={20} min={5} max={300} />
            <span className="mt-1 block text-xs text-black/40">Start small: every scanned site uses some of your Claude usage.</span>
          </label>
          <button className="btn btn-primary py-2.5">Find prospects</button>
          {missing.length > 0 && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
              Missing in <code>.env.local</code>: {missing.join(", ")}. See README.
            </p>
          )}
          {pending > 0 && (
            <p className="text-xs text-black/50">
              {pending} job{pending === 1 ? "" : "s"} in queue.{" "}
              {!workerSeen.t && "If nothing moves, make sure the worker is running (npm run dev)."}
            </p>
          )}
        </form>
      </section>

      <section className="grid content-start gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50">Campaigns</h2>
        {campaigns.length === 0 && <div className="card p-10 text-center text-black/50">No searches yet. Start one on the left.</div>}
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="card flex items-center gap-6 p-5 transition hover:ring-black/20">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {c.industry} <span className="font-normal text-black/50">· {c.locations.split(/\n/).join(", ")} · {c.radius_km} km</span>
              </div>
              <div className="mt-1 text-xs text-black/50">
                {new Date(c.created_at + "Z").toLocaleString("en-AU")} ·{" "}
                <span className={c.status === "failed" ? "text-red-600" : ""}>{c.status}</span>
              </div>
            </div>
            <Stat n={c.total} label="found" />
            <Stat n={c.scanned ?? 0} label="scanned" />
            <Stat n={c.to_review ?? 0} label="to review" strong />
            <Stat n={c.demos ?? 0} label="demos" />
            <Stat n={c.contacted ?? 0} label="contacted" />
          </Link>
        ))}
      </section>
    </div>
  );
}

function Stat({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className="w-16 text-center">
      <div className={`text-lg font-semibold ${strong && n > 0 ? "text-amber-600" : ""}`}>{n}</div>
      <div className="text-[11px] text-black/50">{label}</div>
    </div>
  );
}
