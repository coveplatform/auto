import Link from "next/link";
import { connection } from "next/server";
import { db, getDemo, getScan, type Business } from "@/lib/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DemoReview } from "@/components/DemoReview";
import { ScoreBadge, Stars, StatusPill } from "@/components/ui";

export default async function DemosPage() {
  await connection();
  const ready = db
    .prepare(
      "SELECT * FROM businesses WHERE status = 'demo_ready' OR (status = 'building' AND id IN (SELECT business_id FROM demos)) ORDER BY updated_at DESC",
    )
    .all() as Business[];
  const building = db
    .prepare(
      "SELECT * FROM businesses WHERE (status IN ('building','build_failed') AND id NOT IN (SELECT business_id FROM demos)) OR status = 'foundation_ready' ORDER BY updated_at DESC",
    )
    .all() as Business[];

  return (
    <div className="grid gap-6">
      <AutoRefresh active={building.some((b) => b.status === "building") || ready.some((b) => b.status === "building")} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demo review</h1>
        <p className="text-sm text-black/50">Second gate: check each concept before any outreach is drafted.</p>
      </div>

      {building.length > 0 && (
        <div className="card divide-y divide-black/5">
          {building.map((b) => (
            <div key={b.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <Link href={`/business/${b.id}`} className="flex-1 font-medium hover:underline">
                {b.name}
              </Link>
              <span className="text-black/50">{b.status_note}</span>
              <StatusPill status={b.status} />
            </div>
          ))}
        </div>
      )}

      {ready.length === 0 && <div className="card p-10 text-center text-black/50">No demos waiting for review.</div>}

      {ready.map((b) => {
        const demo = getDemo(b.id)!;
        return (
          <section key={b.id} className="card p-6">
            <div className="mb-4 flex items-center gap-3">
              <ScoreBadge score={b.opportunity_score} />
              <div>
                <Link href={`/business/${b.id}`} className="text-lg font-semibold hover:underline">
                  {b.name}
                </Link>
                <div className="text-sm text-black/60">
                  {b.category} · <Stars rating={b.rating} count={b.review_count} />
                </div>
              </div>
            </div>
            <DemoReview b={b} demo={demo} scan={getScan(b.id)} compact />
          </section>
        );
      })}
    </div>
  );
}
