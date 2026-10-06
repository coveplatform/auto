import Link from "next/link";
import { parseJSON, type Business, type DemoRow, type ScanRow } from "@/lib/db";
import type { Extraction } from "@/lib/templates/content";
import { STYLES, forEachImageRef, type SitePlan } from "@/lib/templates/plan";
import { approveDemo, changeStyle, rebuildCustom, rebuildFromScratch, redesign, rejectDemo } from "@/app/actions";
import { shot } from "./ui";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? "text-emerald-700" : "text-black/40"}>
      {ok ? "✓" : "✗"} {label}
    </li>
  );
}

/** Gate 2: existing vs proposed, the design reasoning, warnings, and the review actions. */
export function DemoReview({ b, demo, scan, compact = false }: { b: Business; demo: DemoRow; scan?: ScanRow; compact?: boolean }) {
  const plan = parseJSON<SitePlan>(demo.content);
  const ex = parseJSON<Extraction>(demo.extraction);
  const warnings = parseJSON<string[]>(demo.warnings) ?? [];
  const review = parseJSON<{ score: number; issues: string[]; revised: boolean; rounds?: number; notes?: string }>(demo.review);
  const custom = demo.template === "custom";
  const building = b.status === "building";
  const v = encodeURIComponent(demo.built_at ?? "");
  const previewHref = `/preview/${demo.slug}/`;

  let sitePhotos = 0;
  let stockPhotos = 0;
  if (plan) {
    forEachImageRef(plan, (r) => {
      if (r.source === "site") sitePhotos++;
      if (r.source === "stock") stockPhotos++;
    });
  }
  const testimonials = plan?.sections.find((s) => s.type === "testimonials")?.items.length ?? 0;

  return (
    <div className="grid gap-5">
      <div className={`grid gap-4 ${compact ? "grid-cols-[1fr_1fr_260px]" : "grid-cols-[1fr_1fr_260px]"}`}>
        <figure>
          <figcaption className="label">Existing</figcaption>
          <a href={b.website ?? "#"} target="_blank" className="block h-[460px] overflow-hidden rounded-lg ring-1 ring-black/10">
            {shot(scan?.desktop_shot) && <img src={shot(scan?.desktop_shot)!} alt="" className="w-full" />}
          </a>
        </figure>
        <figure>
          <figcaption className="label !flex justify-between gap-2">
            <span>Proposed · {custom ? "custom build" : (plan?.style ?? demo.template)}</span>
            <a href={previewHref} target="_blank" className="normal-case text-indigo-600 hover:underline">
              Open preview ↗
            </a>
          </figcaption>
          <a href={previewHref} target="_blank" className="relative block h-[460px] overflow-y-auto rounded-lg ring-1 ring-black/10">
            {shot(demo.desktop_shot) && <img src={`${shot(demo.desktop_shot)}?v=${v}`} alt="" className="w-full" />}
            {building && <div className="sticky inset-0 grid h-full place-items-center bg-white/75 font-medium">Working… {b.status_note}</div>}
          </a>
        </figure>
        <figure>
          <figcaption className="label">Proposed mobile</figcaption>
          <div className="h-[460px] overflow-y-auto rounded-lg ring-1 ring-black/10">
            {shot(demo.mobile_shot) && <img src={`${shot(demo.mobile_shot)}?v=${v}`} alt="" className="w-full" />}
          </div>
        </figure>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr_1fr]">
        {custom ? (
          <div>
            <div className="label">Built from</div>
            <ul className="grid gap-1 text-sm">
              <Check ok={(ex?.images.length ?? 0) > 0} label={`${ex?.images.length ?? 0} site photos found`} />
              <li className="text-black/70">Approved foundation</li>
              <li>
                <a href={`/business/${b.id}#foundation`} className="text-indigo-600 hover:underline">
                  View foundation
                </a>
              </li>
            </ul>
          </div>
        ) : (
        <div>
          <div className="label">Built from</div>
          <ul className="grid gap-1 text-sm">
            <Check ok={(ex?.images.length ?? 0) > 0} label={`${ex?.images.length ?? 0} site photos found`} />
            <Check ok={sitePhotos > 0} label={`${sitePhotos} of their photos used`} />
            <li className={stockPhotos ? "text-amber-700" : "text-black/40"}>
              {stockPhotos ? "◐" : "–"} {stockPhotos} stock placeholders
            </li>
            <Check ok={plan?.logo_index != null} label="Logo" />
            <Check ok={!!plan?.business.phone} label="Phone" />
            <Check ok={!!plan?.business.hours.length} label="Opening hours" />
            <Check ok={testimonials > 0} label={`${testimonials} testimonials`} />
            <Check ok={!!plan?.sections.length} label={`${plan?.sections.length ?? 0} sections`} />
          </ul>
        </div>
        )}
        <div>
          <div className="label">
            Design reasoning
            {review &&
              ` · self-review ${review.score}/10${review.revised ? (review.rounds && review.rounds > 1 ? ` (revised ${review.rounds}×)` : " (revised once)") : ""}`}
          </div>
          {plan && (
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-medium">Audience</dt>
                <dd className="text-black/70">{plan.thinking.audience}</dd>
              </div>
              <div>
                <dt className="font-medium">Goal</dt>
                <dd className="text-black/70">{plan.thinking.primary_goal}</dd>
              </div>
              <div>
                <dt className="font-medium">Direction</dt>
                <dd className="text-black/70">{plan.thinking.design_direction}</dd>
              </div>
            </dl>
          )}
          {custom && review?.notes && <p className="text-sm text-black/70">{review.notes}</p>}
          {review && review.issues.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-black/60">Issues the review found</summary>
              <ul className="mt-1 list-disc pl-5 text-black/70">
                {review.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div>
          <div className="label">Warnings: check these before sending</div>
          {warnings.length === 0 ? (
            <p className="text-sm text-black/50">None.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {warnings.map((w) => (
                <li key={w} className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3 border-t border-black/5 pt-4">
        <form action={approveDemo}>
          <input type="hidden" name="id" value={b.id} />
          <button className="btn btn-green" disabled={building}>
            Approve → draft email
          </button>
        </form>
        {custom ? (
          <>
            <Link href={`/business/${b.id}#foundation`} className="btn btn-ghost">
              Foundation
            </Link>
            <form action={rebuildCustom} className="flex gap-1">
              <input type="hidden" name="id" value={b.id} />
              <input name="instructions" className="input w-80 py-1.5" placeholder="Fixes for this build, e.g. 'hero image too dark, tighter mobile nav'" />
              <button className="btn btn-ghost" disabled={building}>
                Rebuild
              </button>
            </form>
          </>
        ) : (
        <>
        {compact ? (
          <Link href={`/business/${b.id}#edit`} className="btn btn-ghost">
            Edit
          </Link>
        ) : (
          <a href="#edit" className="btn btn-ghost">
            Edit
          </a>
        )}
        <form action={changeStyle} className="flex gap-1">
          <input type="hidden" name="id" value={b.id} />
          <select name="style" defaultValue={plan?.style ?? "boutique"} className="input w-auto py-1.5">
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" disabled={building}>
            Try style
          </button>
        </form>
        <form action={redesign} className="flex gap-1">
          <input type="hidden" name="id" value={b.id} />
          <input name="instructions" className="input w-80 py-1.5" placeholder="Direction, e.g. 'darker, more luxe, hero on weddings'" />
          <button className="btn btn-ghost" disabled={building}>
            Redesign
          </button>
        </form>
        <form action={rebuildFromScratch}>
          <input type="hidden" name="id" value={b.id} />
          <button className="btn btn-ghost" disabled={building}>
            Re-scrape
          </button>
        </form>
        </>
        )}
        <form action={rejectDemo} className="ml-auto">
          <input type="hidden" name="id" value={b.id} />
          <button className="btn btn-red">Reject</button>
        </form>
      </div>
    </div>
  );
}
