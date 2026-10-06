import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getBusiness, getDemo, getFoundation, getOutreach, getReport, getScan, parseJSON } from "@/lib/db";
import { previewUrl } from "@/lib/config";
import type { Qualification } from "@/lib/qualify";
import { WEIGHTS, type ScoreBreakdown } from "@/lib/scoring";
import type { PageSpeedResult, SiteMetrics } from "@/lib/scan";
import { createFoundation, deleteLead, rescan, saveContent, skipProspect, writeReport } from "@/app/actions";
import { isManual } from "@/lib/stages";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DemoReview } from "@/components/DemoReview";
import { FoundationReview } from "@/components/FoundationReview";
import { Meter, ScoreBadge, Stars, StatusPill, shot } from "@/components/ui";

export default async function BusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { error, notice } = await searchParams;
  const b = getBusiness(Number(id));
  if (!b) notFound();
  const scan = getScan(b.id);
  const demo = getDemo(b.id);
  const outreach = getOutreach(b.id);
  const foundation = getFoundation(b.id);
  const report = getReport(b.id);
  const q = parseJSON<Qualification>(scan?.ai);
  const s = parseJSON<ScoreBreakdown>(scan?.score_breakdown);
  const m = parseJSON<SiteMetrics>(scan?.metrics);
  const ps = parseJSON<PageSpeedResult>(scan?.pagespeed);
  const busy = b.status === "building" || b.status === "scanning" || b.status === "discovered";

  return (
    <div className="grid gap-6">
      <AutoRefresh active={busy} />
      <div className="flex flex-wrap items-start gap-4">
        <ScoreBadge score={b.opportunity_score} size="lg" />
        <div className="min-w-0 flex-1">
          {isManual(b) ? (
            <Link href="/leads" className="text-sm text-black/50 hover:text-black">
              ← Leads
            </Link>
          ) : (
            <Link href={`/campaigns/${b.campaign_id}`} className="text-sm text-black/50 hover:text-black">
              ← Campaign
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-black/60">
            <StatusPill status={b.status} />
            <span>{b.category}</span>
            <Stars rating={b.rating} count={b.review_count} />
            {b.phone && <span>{b.phone}</span>}
            {b.website && (
              <a href={b.website} target="_blank" className="text-indigo-600 hover:underline">
                {b.website}
              </a>
            )}
            {b.maps_url && (
              <a href={b.maps_url} target="_blank" className="text-indigo-600 hover:underline">
                Google Maps
              </a>
            )}
          </div>
          {b.status_note && <p className="mt-1 text-sm text-black/50">{b.status_note}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {b.website && !foundation && b.status !== "building" && b.status !== "scanning" && b.status !== "discovered" && (
            <form action={createFoundation} title="Writes a creative brief (the foundation) for you to approve, then builds the page from it.">
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-green">Build demo</button>
            </form>
          )}
          {b.status === "qualified" && (
            <form action={skipProspect}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-ghost">Skip</button>
            </form>
          )}
          {b.website && (
            <form action={rescan}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-ghost">Re-scan</button>
            </form>
          )}
          {isManual(b) && (
            <form action={deleteLead}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-ghost">Delete lead</button>
            </form>
          )}
        </div>
      </div>

      {!demo && !foundation && b.website && (b.status === "qualified" || b.status === "skipped" || b.status === "scan_failed") && (
        <p className="-mt-2 text-sm text-black/50">
          Build demo starts with a creative brief (the foundation) for you to check and approve. The page is built from it after that.
        </p>
      )}

      {notice && <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{notice}</div>}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {m && (
        <section className="card flex flex-wrap items-center gap-4 p-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Owner report</h2>
            <p className="text-sm text-black/60">
              {report
                ? `A short, plain-English review of their current site. Last written ${report.built_at}.`
                : "A short, plain-English review of their current site you can send them: what to fix first, what works, and Google's measurements."}
            </p>
          </div>
          {report && (
            <a href={previewUrl(report.slug)} target="_blank" className="btn btn-ghost">
              Open report ↗
            </a>
          )}
          <form action={writeReport}>
            <input type="hidden" name="id" value={b.id} />
            <button className={report ? "btn btn-ghost" : "btn btn-primary"}>{report ? "Rewrite" : "Write report"}</button>
          </form>
        </section>
      )}

      {foundation && (
        <section id="foundation" className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Redesign foundation</h2>
          <FoundationReview b={b} row={foundation} error={error?.startsWith("Foundation") ? error : undefined} />
        </section>
      )}

      {demo && (
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Demo</h2>
          <DemoReview b={b} demo={demo} scan={scan} />
          {demo.template !== "custom" && (
          <details id="edit" className="mt-6" open={!!error?.startsWith("Content")}>
            <summary className="cursor-pointer text-sm font-medium">Edit content (JSON)</summary>
            <form action={saveContent} className="mt-3 grid gap-2">
              <input type="hidden" name="id" value={b.id} />
              <textarea
                name="content"
                className="input font-mono text-xs"
                rows={28}
                defaultValue={JSON.stringify(parseJSON(demo.content), null, 2)}
              />
              <p className="text-xs text-black/50">
                Image/logo indexes refer to the scraped images. Saving re-renders the preview without calling the AI.
              </p>
              <button className="btn btn-primary w-fit">Save &amp; re-render</button>
            </form>
          </details>
          )}
        </section>
      )}

      {b.status === "building" && !demo && (
        <div className="card p-6 text-sm">Working… {b.status_note}</div>
      )}

      {outreach && (
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Outreach</h2>
            <Link href="/outreach" className="text-sm text-indigo-600 hover:underline">
              Open in outreach →
            </Link>
          </div>
          <div className="mt-2 text-sm text-black/60">
            {outreach.status === "sent" ? `Sent ${outreach.sent_at}` : "Draft ready"} · to {outreach.to_email ?? "(no email found)"}
          </div>
        </section>
      )}

      {scan && (
        <section className="card grid gap-6 p-6 lg:grid-cols-[1fr_300px]">
          <div>
            <h2 className="text-lg font-semibold">Why selected</h2>
            {scan.error && <p className="mt-2 text-sm text-red-700">Scan error: {scan.error}</p>}
            {q && (
              <>
                <p className="mt-2 text-sm">{q.summary}</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="label">Problems</div>
                    <ul className="list-disc pl-5 text-sm">
                      {q.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="label">Keep</div>
                    <ul className="list-disc pl-5 text-sm">
                      {q.strengths.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
            <div className="mt-6 grid grid-cols-[1fr_150px] gap-4">
              <div className="overflow-hidden rounded-lg ring-1 ring-black/10">
                {shot(scan.desktop_shot) && <img src={shot(scan.desktop_shot)!} alt="" />}
              </div>
              <div className="overflow-hidden rounded-lg ring-1 ring-black/10">
                {shot(scan.mobile_shot) && <img src={shot(scan.mobile_shot)!} alt="" />}
              </div>
            </div>
          </div>
          <div className="grid content-start gap-3">
            {s && (
              <>
                <div className="label">Opportunity score breakdown</div>
                <Meter label={`Website opportunity (${WEIGHTS.website * 100}%)`} value={s.website} />
                <Meter label={`Business quality (${WEIGHTS.business * 100}%)`} value={s.business} />
                <Meter label={`Commercial clarity (${WEIGHTS.commercial * 100}%)`} value={s.commercial} />
                <Meter label={`Ability to pay (${WEIGHTS.ability * 100}%)`} value={s.ability} />
                <Meter label={`Contactability (${WEIGHTS.contact * 100}%)`} value={s.contact} />
                <Meter label={`Brand assets (${WEIGHTS.assets * 100}%)`} value={s.assets} />
              </>
            )}
            {q && (
              <>
                <div className="label mt-3">AI judgement (confidence {q.confidence})</div>
                <Meter label="Visual age (dated)" value={q.visual_age} invert />
                <Meter label="Mobile quality" value={q.mobile_quality} />
                <Meter label="Conversion" value={q.conversion_quality} />
                <Meter label="Brand" value={q.brand_quality} />
              </>
            )}
            {ps && (
              <>
                <div className="label mt-3">PageSpeed (mobile)</div>
                <Meter label="Performance" value={ps.performance} />
                <Meter label="Accessibility" value={ps.accessibility} />
                <Meter label="SEO" value={ps.seo} />
              </>
            )}
            {m && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-black/50">HTTPS</dt>
                <dd>{m.https ? "yes" : "no"}</dd>
                <dt className="text-black/50">Mobile viewport</dt>
                <dd>{m.hasViewportMeta ? "yes" : "no"}</dd>
                <dt className="text-black/50">Overflows on mobile</dt>
                <dd>{m.mobileHorizontalOverflow ? "yes" : "no"}</dd>
                <dt className="text-black/50">CTA above fold (mob.)</dt>
                <dd>{m.ctaAboveFoldMobile ? "yes" : "no"}</dd>
                <dt className="text-black/50">Click-to-call</dt>
                <dd>{m.telLinks}</dd>
                <dt className="text-black/50">Copyright year</dt>
                <dd>{m.copyrightYear ?? "—"}</dd>
                <dt className="text-black/50">Load time</dt>
                <dd>{(m.loadMs / 1000).toFixed(1)}s</dd>
                <dt className="text-black/50">Broken links</dt>
                <dd>
                  {m.brokenLinks.length}/{m.checkedLinks}
                </dd>
                <dt className="text-black/50">Emails</dt>
                <dd className="truncate">{m.emails.join(", ") || "—"}</dd>
                <dt className="text-black/50">Tech</dt>
                <dd>{m.tech.join(", ") || "—"}</dd>
              </dl>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
