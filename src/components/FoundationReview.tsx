import { parseJSON, type Business, type FoundationRow } from "@/lib/db";
import type { Audit, Foundation, FoundationCritique, Research } from "@/lib/foundation";
import { approveFoundation, createFoundation, saveFoundationJSON } from "@/app/actions";

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm text-black/80">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-black/40">—</p>;
  return (
    <ul className="list-disc pl-5">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

/** The redesign foundation: read it, edit it, regenerate it or approve it for a custom build. */
export function FoundationReview({ b, row, error }: { b: Business; row: FoundationRow; error?: string }) {
  const f = parseJSON<Foundation>(row.data);
  const research = parseJSON<Research>(row.research);
  const audit = parseJSON<Audit>(row.audit);
  const critique = parseJSON<FoundationCritique>(row.critique);
  const warnings = parseJSON<string[]>(row.warnings) ?? [];
  const building = b.status === "building";
  const files = `/files/foundations/${b.id}`;
  if (!f) return <p className="text-sm text-red-700">The saved foundation can&apos;t be read. Regenerate it.</p>;
  const v = f.visual_system;
  const fontsHref = `https://fonts.googleapis.com/css2?${[v.typography.display, v.typography.body]
    .map((t) => `family=${encodeURIComponent(t.family)}:wght@${[...new Set(t.weights)].sort((a, c) => a - c).join(";")}`)
    .join("&")}&display=swap`;

  return (
    <div className="grid gap-6">
      <link rel="stylesheet" href={fontsHref} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="label">
            Concept{critique && ` · critic ${critique.score}/10${critique.revised ? " (revised)" : ""}`} ·{" "}
            {row.status === "approved" ? `approved ${row.approved_at}` : "draft"}
          </div>
          <p className="text-xl font-semibold" style={{ fontFamily: `'${v.typography.display.family}', serif` }}>
            {f.creative_direction.concept}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <a href={`${files}/foundation.md`} target="_blank" className="text-indigo-600 hover:underline">
            foundation.md ↗
          </a>
          <a href={`${files}/site-spec.json`} target="_blank" className="text-indigo-600 hover:underline">
            site-spec.json ↗
          </a>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Block label="Diagnosis">
          <p>
            <span className="text-black/50">Today:</span> {f.diagnosis.current_perception}
          </p>
          <p>
            <span className="text-black/50">Target:</span> {f.diagnosis.desired_perception}
          </p>
          <p className="mt-2">{f.diagnosis.opportunity}</p>
        </Block>
        <Block label="Positioning">
          <p>{f.positioning.statement}</p>
          <p className="mt-2 text-black/60">
            {f.positioning.personality.join(" · ")} — {f.positioning.tone_of_voice}
          </p>
        </Block>
      </div>

      <Block label="Creative direction">
        <p>{f.creative_direction.summary}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-black/50">References</div>
            <Bullets items={f.creative_direction.references.map((r) => `${r.name}: ${r.why}`)} />
          </div>
          <div>
            <div className="text-xs font-medium text-black/50">Avoid</div>
            <Bullets items={f.creative_direction.avoid} />
          </div>
        </div>
      </Block>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <Block label="Colour">
          <div className="grid gap-1.5">
            {v.colours.map((c) => (
              <div key={c.name + c.hex} className="flex items-center gap-3">
                <span className="h-7 w-10 shrink-0 rounded ring-1 ring-black/10" style={{ background: c.hex }} />
                <span className="w-28 shrink-0 font-medium">{c.name}</span>
                <code className="w-20 shrink-0 text-xs text-black/50">{c.hex}</code>
                <span className="text-black/60">{c.role}</span>
              </div>
            ))}
          </div>
        </Block>
        <Block label="Typography">
          <p className="text-3xl leading-tight" style={{ fontFamily: `'${v.typography.display.family}', serif` }}>
            {f.copy.headline}
          </p>
          <p className="mt-2" style={{ fontFamily: `'${v.typography.body.family}', sans-serif` }}>
            {f.copy.subheadline}
          </p>
          <p className="mt-2 text-xs text-black/50">
            {v.typography.display.family} / {v.typography.body.family} · {v.typography.scale}
          </p>
        </Block>
      </div>

      <Block label={`Homepage story · ${f.homepage.sections.length} sections`}>
        <p className="mb-2">{f.homepage.story}</p>
        <ol className="grid gap-1.5">
          {f.homepage.sections.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[24px_1fr] gap-2">
              <span className="text-black/40">{i + 1}.</span>
              <span>
                <span className="font-medium">{s.name}</span>
                {s.content.headline && <span className="text-black/70"> — “{s.content.headline}”</span>}
                <span className="block text-xs text-black/50">{s.purpose}</span>
              </span>
            </li>
          ))}
        </ol>
      </Block>

      <div className="grid gap-6 md:grid-cols-3">
        <Block label="Keep">
          <Bullets items={f.diagnosis.keep} />
        </Block>
        <Block label="Remove">
          <Bullets items={f.diagnosis.remove} />
        </Block>
        <Block label="Photography">
          <p>{f.photography.direction}</p>
          <p className="mt-1 text-black/60">
            {f.photography.site_photos.length} of their photos · {f.photography.stock.length} stock slots
          </p>
        </Block>
      </div>

      {(audit || research) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Research &amp; UX audit</summary>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            {research && (
              <Block label="Research">
                <p>{research.summary}</p>
                <div className="mt-2 text-xs font-medium text-black/50">Unknowns (not guessed)</div>
                <Bullets items={research.unknowns} />
              </Block>
            )}
            {audit && (
              <Block label={`Audit: ${audit.current_perception}`}>
                <p>{audit.first_impression}</p>
                <ul className="mt-2 grid gap-1">
                  {audit.issues.map((i) => (
                    <li key={i.observation}>
                      <span className={i.severity === "high" ? "text-red-700" : i.severity === "medium" ? "text-amber-700" : "text-black/50"}>
                        {i.area}
                      </span>{" "}
                      {i.observation}
                    </li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        </details>
      )}

      {critique && critique.issues.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">What the critic changed</summary>
          <p className="mt-2 text-black/70">{critique.verdict}</p>
          <Bullets items={critique.issues} />
        </details>
      )}

      <div>
        <div className="label">Warnings: check these before approving</div>
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

      <div className="flex flex-wrap items-start gap-3 border-t border-black/5 pt-4">
        <form action={approveFoundation}>
          <input type="hidden" name="id" value={b.id} />
          <button className="btn btn-green" disabled={building}>
            {row.status === "approved" ? "Build again from this" : "Approve → custom build"}
          </button>
        </form>
        <form action={createFoundation} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={b.id} />
          <input
            name="instructions"
            className="input w-96 py-1.5"
            defaultValue={row.instructions ?? ""}
            placeholder="Direction, e.g. 'less luxury, it's a family business; lead with weddings'"
          />
          <label className="flex items-center gap-1 text-sm text-black/60">
            <input type="checkbox" name="rescrape" /> re-read site
          </label>
          <button className="btn btn-ghost" disabled={building}>
            Regenerate foundation
          </button>
        </form>
      </div>

      <details id="foundation-edit" open={!!error}>
        <summary className="cursor-pointer text-sm font-medium">Edit foundation (JSON)</summary>
        <form action={saveFoundationJSON} className="mt-3 grid gap-2">
          <input type="hidden" name="id" value={b.id} />
          <textarea name="data" className="input font-mono text-xs" rows={28} defaultValue={JSON.stringify(f, null, 2)} />
          <p className="text-xs text-black/50">
            Photo numbers refer to the scraped images. Saving re-runs the fact checks and rewrites foundation.md; it doesn&apos;t call the AI.
          </p>
          <button className="btn btn-primary w-fit">Save foundation</button>
        </form>
      </details>
    </div>
  );
}
