import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db, parseJSON, type Business, type Campaign } from "@/lib/db";
import { STAGE_TABS as TABS } from "@/lib/stages";
import type { Qualification } from "@/lib/qualify";
import type { ScoreBreakdown } from "@/lib/scoring";
import type { PageSpeedResult } from "@/lib/scan";
import { createFoundation, deleteCampaign, restoreProspect, skipProspect } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Meter, ScoreBadge, Stars, StatusPill, shot } from "@/components/ui";

type Row = Business & {
  ai: string | null;
  score_breakdown: string | null;
  pagespeed: string | null;
  mobile_shot: string | null;
};

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; min?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { tab = "review", min = "0" } = await searchParams;
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(id)) as Campaign | undefined;
  if (!campaign) notFound();

  const rows = db
    .prepare(
      `SELECT b.*, s.ai, s.score_breakdown, s.pagespeed, s.mobile_shot
       FROM businesses b LEFT JOIN scans s ON s.business_id = b.id
       WHERE b.campaign_id = ?
       ORDER BY b.opportunity_score DESC NULLS LAST, b.review_count DESC`,
    )
    .all(campaign.id) as Row[];

  const counts = Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => t.statuses.includes(r.status)).length]));
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const minScore = Number(min) || 0;
  const visible = rows.filter((r) => active.statuses.includes(r.status) && (r.opportunity_score ?? 0) >= minScore);
  const busy = campaign.status === "discovering" || campaign.status === "queued" || counts.scanning > 0 || rows.some((r) => r.status === "building");

  return (
    <div className="grid gap-6">
      <AutoRefresh active={busy} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-black/50 hover:text-black">
            ← Campaigns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {campaign.industry} <span className="font-normal text-black/50">in {campaign.locations.split(/\n/).join(", ")}</span>
          </h1>
          <p className="text-sm text-black/50">
            {rows.length} businesses found · status: {campaign.status}
            {busy && " · updating live"}
          </p>
        </div>
        <form action={deleteCampaign}>
          <input type="hidden" name="id" value={campaign.id} />
          <button className="btn btn-red">Delete campaign</button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 pb-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            className={`rounded-md px-3 py-1.5 text-sm ${t.key === active.key ? "bg-ink text-white" : "text-black/60 hover:bg-black/5"}`}
          >
            {t.label} <span className="opacity-60">{counts[t.key]}</span>
          </Link>
        ))}
        {active.key === "review" && (
          <div className="ml-auto flex gap-1 text-sm">
            {[0, 50, 60, 70].map((m) => (
              <Link key={m} href={`?tab=review&min=${m}`} className={`rounded px-2 py-1 ${minScore === m ? "bg-black/10" : "text-black/50"}`}>
                {m === 0 ? "All" : `${m}+`}
              </Link>
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 && (
        <div className="card p-10 text-center text-black/50">
          {campaign.status === "discovering" || campaign.status === "queued" ? "Searching Google Places…" : "Nothing here."}
        </div>
      )}

      {active.key === "review" ? (
        <div className="grid gap-4">
          {visible.map((r) => (
            <ProspectCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-black/5">
          {visible.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <ScoreBadge score={r.opportunity_score} />
              <div className="min-w-0 flex-1">
                <Link href={`/business/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="truncate text-xs text-black/50">
                  {r.category} · {r.address}
                  {r.status_note && <> · {r.status_note}</>}
                </div>
              </div>
              <Stars rating={r.rating} count={r.review_count} />
              {r.phone && <span className="w-32 text-black/60">{r.phone}</span>}
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
  );
}

function ProspectCard({ r }: { r: Row }) {
  const q = parseJSON<Qualification>(r.ai);
  const s = parseJSON<ScoreBreakdown>(r.score_breakdown);
  const ps = parseJSON<PageSpeedResult>(r.pagespeed);
  const img = shot(r.mobile_shot);
  return (
    <article className="card grid grid-cols-[150px_1fr_260px] gap-6 p-5">
      <a href={img ?? "#"} target="_blank" className="block h-[260px] overflow-hidden rounded-lg bg-black/5 ring-1 ring-black/10">
        {img && <img src={img} alt="" className="w-full object-cover object-top" />}
      </a>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <ScoreBadge score={r.opportunity_score} size="lg" />
          <div className="min-w-0">
            <Link href={`/business/${r.id}`} className="text-lg font-semibold hover:underline">
              {r.name}
            </Link>
            <div className="text-sm text-black/60">
              {r.category} · <Stars rating={r.rating} count={r.review_count} />
              {r.distance_km != null && <> · {r.distance_km} km</>}
            </div>
            {r.website && (
              <a href={r.website} target="_blank" className="block truncate text-xs text-indigo-600 hover:underline">
                {r.website}
              </a>
            )}
          </div>
        </div>
        {q && (
          <>
            <p className="mt-3 text-sm text-black/80">{q.summary}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {q.problems.slice(0, 5).map((p) => (
                <li key={p} className="pill bg-red-50 text-red-800">
                  {p}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <form action={createFoundation}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn btn-green">Build demo</button>
          </form>
          <form action={skipProspect}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn btn-ghost">Skip</button>
          </form>
          <Link href={`/business/${r.id}`} className="btn btn-ghost">
            Details
          </Link>
        </div>
      </div>
      <div className="grid content-start gap-2.5">
        {q && (
          <>
            <Meter label="Redesign need" value={q.redesign_opportunity} invert />
            <Meter label="Visual age (dated)" value={q.visual_age} invert />
            <Meter label="Mobile quality" value={q.mobile_quality} />
            <Meter label="Conversion / CTA" value={q.conversion_quality} />
          </>
        )}
        {s && <Meter label="Business strength" value={s.business} />}
        {ps?.performance != null && <Meter label="PageSpeed (mobile)" value={ps.performance} />}
      </div>
    </article>
  );
}
