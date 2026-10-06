import Link from "next/link";
import { connection } from "next/server";
import { db, type Business } from "@/lib/db";
import { STAGE_TABS, isManual } from "@/lib/stages";
import { addLead, restoreProspect } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScoreBadge, Stars, StatusPill } from "@/components/ui";

type Row = Business & { source: string; campaign_status: string };

const ALL = { key: "all", label: "All", statuses: [] as string[] };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; error?: string }>;
}) {
  await connection();
  const { tab = "all", q = "", error } = await searchParams;
  const rows = db
    .prepare(
      `SELECT b.*, c.industry || CASE WHEN c.locations != '' THEN ' in ' || replace(c.locations, char(10), ', ') ELSE '' END AS source,
              c.status AS campaign_status
       FROM businesses b JOIN campaigns c ON c.id = b.campaign_id
       ORDER BY b.updated_at DESC`,
    )
    .all() as Row[];

  const term = q.trim().toLowerCase();
  const matching = term
    ? rows.filter((r) => [r.name, r.website, r.category, r.address].some((v) => v?.toLowerCase().includes(term)))
    : rows;
  const tabs = [ALL, ...STAGE_TABS];
  const active = tabs.find((t) => t.key === tab) ?? ALL;
  const inTab = (r: Row, t: typeof active) => t.key === "all" || (t.statuses as string[]).includes(r.status);
  const counts = Object.fromEntries(tabs.map((t) => [t.key, matching.filter((r) => inTab(r, t)).length]));
  const visible = matching.filter((r) => inTab(r, active));
  const busy = rows.some((r) => r.status === "discovered" || r.status === "scanning" || r.status === "building");
  const qs = (t: string) => `?tab=${t}${term ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="grid gap-6">
      <AutoRefresh active={busy} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-black/50">Every business you&apos;re tracking, from your campaigns and the ones you add yourself.</p>
        </div>

        <form action={addLead} className="card grid gap-3 p-5 lg:row-span-2">
          <div>
            <h2 className="font-semibold">Add a lead</h2>
            <p className="text-sm text-black/50">Paste their website. I&apos;ll find their Google listing, scan the site and score it.</p>
          </div>
          <label>
            <span className="label">Website</span>
            <input name="website" className="input" placeholder="bloomandco.com.au" required autoComplete="off" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">Business name</span>
              <input name="name" className="input" placeholder="Optional" />
            </label>
            <label>
              <span className="label">Suburb</span>
              <input name="area" className="input" placeholder="Optional" />
            </label>
          </div>
          <label>
            <span className="label">Industry</span>
            <input name="category" className="input" placeholder="Optional, e.g. Florist" />
          </label>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button className="btn btn-primary">Add and scan</button>
          <p className="text-xs text-black/40">The name and suburb help match the right Google listing. Leads you add are never auto-skipped.</p>
        </form>

        <div className="grid gap-3">
          <form className="flex gap-2">
            <input type="hidden" name="tab" value={active.key} />
            <input name="q" defaultValue={q} className="input" placeholder="Search by name, website, industry or suburb" />
            <button className="btn btn-ghost">Search</button>
            {term && (
              <Link href={`?tab=${active.key}`} className="btn btn-ghost">
                Clear
              </Link>
            )}
          </form>

          <div className="flex flex-wrap gap-2 border-b border-black/10 pb-3">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={qs(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm ${t.key === active.key ? "bg-ink text-white" : "text-black/60 hover:bg-black/5"}`}
              >
                {t.label} <span className="opacity-60">{counts[t.key]}</span>
              </Link>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="card p-10 text-center text-sm text-black/50">
              {rows.length === 0
                ? "No leads yet. Add a website on the right, or start a campaign to find businesses."
                : term
                  ? `No leads match "${q}".`
                  : "No leads at this stage."}
            </div>
          ) : (
            <div className="card divide-y divide-black/5">
              {visible.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                  <ScoreBadge score={r.opportunity_score} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/business/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="truncate text-xs text-black/50">
                      {[r.category, r.website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), r.status_note].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="w-44 truncate text-xs text-black/50">{isManual(r) ? "Added by you" : r.source}</span>
                  <Stars rating={r.rating} count={r.review_count} />
                  <StatusPill status={r.status} />
                  {(r.status === "skipped" || r.status === "rejected") && (
                    <form action={restoreProspect}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn btn-ghost">Restore</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
