import Link from "next/link";
import { connection } from "next/server";
import { db, type JobRow } from "@/lib/db";
import { retryJob } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function JobsPage() {
  await connection();
  const jobs = db
    .prepare(
      `SELECT j.*, b.name AS business_name FROM jobs j LEFT JOIN businesses b ON b.id = j.business_id
       ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, j.id DESC LIMIT 200`,
    )
    .all() as Array<JobRow & { business_name: string | null }>;
  const counts = db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all() as Array<{ status: string; n: number }>;
  const active = jobs.some((j) => j.status === "running" || j.status === "queued");

  return (
    <div className="grid gap-6">
      <AutoRefresh active={active} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-black/50">{counts.map((c) => `${c.n} ${c.status}`).join(" · ") || "No jobs yet"}</p>
      </div>
      <div className="card divide-y divide-black/5 text-sm">
        {jobs.map((j) => (
          <div key={j.id} className="grid grid-cols-[60px_90px_1fr_90px_80px] items-start gap-3 px-5 py-2.5">
            <span className="text-black/40">#{j.id}</span>
            <span className="font-medium">{j.type}</span>
            <div className="min-w-0">
              {j.business_id ? (
                <Link href={`/business/${j.business_id}`} className="hover:underline">
                  {j.business_name}
                </Link>
              ) : j.campaign_id ? (
                <Link href={`/campaigns/${j.campaign_id}`} className="hover:underline">
                  Campaign {j.campaign_id}
                </Link>
              ) : null}
              {j.error && <div className="mt-1 whitespace-pre-wrap break-words text-xs text-red-700">{j.error}</div>}
            </div>
            <span
              className={
                j.status === "failed"
                  ? "text-red-600"
                  : j.status === "running"
                    ? "text-indigo-600"
                    : j.status === "done"
                      ? "text-emerald-700"
                      : "text-black/50"
              }
            >
              {j.status}
            </span>
            {j.status === "failed" ? (
              <form action={retryJob}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn btn-ghost py-1">Retry</button>
              </form>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
