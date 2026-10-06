import Link from "next/link";
import { connection } from "next/server";
import { db, type Business, type OutreachRow } from "@/lib/db";
import { config, previewUrl } from "@/lib/config";
import { markSent, publishPreview, regenerateEmail, saveOutreach } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CopyButton } from "@/components/CopyButton";
import { Stars, StatusPill } from "@/components/ui";

type Row = Business & {
  slug: string;
  published_url: string | null;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  o_status: OutreachRow["status"] | null;
};

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await connection();
  const { show = "drafts" } = await searchParams;
  const rows = db
    .prepare(
      `SELECT b.*, d.slug, d.published_url, o.to_email, o.subject, o.body, o.status AS o_status, o.sent_at
       FROM businesses b JOIN demos d ON d.business_id = b.id LEFT JOIN outreach o ON o.business_id = b.id
       WHERE b.status IN ('demo_approved','contacted') ORDER BY b.updated_at DESC`,
    )
    .all() as Row[];
  const visible = rows.filter((r) => (show === "sent" ? r.o_status === "sent" : r.o_status !== "sent"));
  const pendingJobs = (
    db.prepare("SELECT COUNT(*) n FROM jobs WHERE type IN ('outreach','publish') AND status IN ('queued','running')").get() as {
      n: number;
    }
  ).n;

  return (
    <div className="grid gap-6">
      <AutoRefresh active={pendingJobs > 0} />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-black/50">
            Emails are drafted, never sent automatically. Send from your own inbox, then mark as sent.
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          {["drafts", "sent"].map((k) => (
            <Link
              key={k}
              href={`?show=${k}`}
              className={`rounded-md px-3 py-1.5 ${show === k ? "bg-ink text-white" : "text-black/60 hover:bg-black/5"}`}
            >
              {k === "drafts" ? "To send" : "Sent"}
            </Link>
          ))}
        </div>
      </div>

      {!config.previewPublicBase && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          PREVIEW_PUBLIC_BASE is not set, so preview links point at this machine ({config.appUrl}). Set up preview hosting in
          .env.local before emailing anyone (see README).
        </p>
      )}

      {visible.length === 0 && <div className="card p-10 text-center text-black/50">Nothing here yet.</div>}

      {visible.map((r) => {
        const link = r.published_url ?? previewUrl(r.slug);
        const mailto = `mailto:${encodeURIComponent(r.to_email ?? "")}?subject=${encodeURIComponent(r.subject ?? "")}&body=${encodeURIComponent(r.body ?? "")}`;
        return (
          <section key={r.id} className="card grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
            <div className="text-sm">
              <Link href={`/business/${r.id}`} className="text-lg font-semibold hover:underline">
                {r.name}
              </Link>
              <div className="mt-1 grid gap-1 text-black/60">
                <StatusPill status={r.status} />
                <Stars rating={r.rating} count={r.review_count} />
                {r.phone && <span>{r.phone}</span>}
                <a href={`/preview/${r.slug}/`} target="_blank" className="text-indigo-600 hover:underline">
                  Local preview ↗
                </a>
                <span className="break-all">
                  Public:{" "}
                  {r.published_url ? (
                    <a href={r.published_url} className="text-indigo-600 hover:underline" target="_blank">
                      {r.published_url}
                    </a>
                  ) : (
                    "not published"
                  )}
                </span>
                {r.sent_at && <span>Sent {r.sent_at}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={publishPreview}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn btn-ghost">{r.published_url ? "Re-publish" : "Publish preview"}</button>
                </form>
                <form action={regenerateEmail}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn btn-ghost">Redraft email</button>
                </form>
              </div>
            </div>

            {r.body == null ? (
              <div className="grid place-items-center rounded-lg bg-black/[.03] p-8 text-sm text-black/50">Drafting email…</div>
            ) : (
              <form action={saveOutreach} className="grid gap-3">
                <input type="hidden" name="id" value={r.id} />
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="label">To</span>
                    <input name="to_email" className="input" defaultValue={r.to_email ?? ""} placeholder="No email found, check their contact page" />
                  </label>
                  <label>
                    <span className="label">Subject</span>
                    <input name="subject" className="input" defaultValue={r.subject ?? ""} />
                  </label>
                </div>
                <label>
                  <span className="label">Body</span>
                  <textarea name="body" className="input" rows={14} defaultValue={r.body ?? ""} />
                </label>
                {!(r.body ?? "").includes(link) && (
                  <p className="text-xs text-amber-700">
                    Heads up: the body does not contain the current preview link ({link}). Redraft or edit.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary">Save edits</button>
                  <CopyButton text={r.body ?? ""} label="Copy body" />
                  <a href={mailto} className="btn btn-ghost">
                    Open in mail app
                  </a>
                  {r.o_status !== "sent" && (
                    <button formAction={markSent} className="btn btn-green ml-auto">
                      Mark as sent
                    </button>
                  )}
                </div>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
