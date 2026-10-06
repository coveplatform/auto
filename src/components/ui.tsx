import type { BusinessStatus } from "@/lib/db";

export function shot(rel: string | null | undefined) {
  return rel ? `/files/${rel.replaceAll("\\", "/")}` : null;
}

export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  if (score == null) return <span className="text-black/30">—</span>;
  const color = score >= 70 ? "bg-emerald-600" : score >= 50 ? "bg-amber-500" : "bg-zinc-400";
  const dims = size === "lg" ? "h-14 w-14 text-xl" : "h-10 w-10 text-sm";
  return <div className={`${color} ${dims} grid shrink-0 place-items-center rounded-full font-bold text-white`}>{Math.round(score)}</div>;
}

const STATUS: Record<BusinessStatus, [string, string]> = {
  discovered: ["Queued for scan", "bg-zinc-100 text-zinc-600"],
  no_website: ["No website", "bg-sky-50 text-sky-700"],
  scanning: ["Scanning", "bg-indigo-50 text-indigo-700"],
  scan_failed: ["Site failed", "bg-red-50 text-red-700"],
  qualified: ["To review", "bg-amber-50 text-amber-800"],
  skipped: ["Skipped", "bg-zinc-100 text-zinc-500"],
  building: ["Building demo", "bg-indigo-50 text-indigo-700"],
  build_failed: ["Build failed", "bg-red-50 text-red-700"],
  foundation_ready: ["Foundation ready", "bg-sky-50 text-sky-800"],
  demo_ready: ["Demo ready", "bg-violet-50 text-violet-700"],
  demo_approved: ["Approved", "bg-emerald-50 text-emerald-700"],
  rejected: ["Rejected", "bg-zinc-100 text-zinc-500"],
  contacted: ["Contacted", "bg-emerald-600 text-white"],
};

export function StatusPill({ status }: { status: BusinessStatus }) {
  const [label, cls] = STATUS[status] ?? [status, "bg-zinc-100"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function Meter({ label, value, invert = false }: { label: string; value: number | null | undefined; invert?: boolean }) {
  if (value == null) return null;
  // invert: high value = bad (e.g. visual age)
  const good = invert ? 100 - value : value;
  const color = good >= 70 ? "bg-emerald-500" : good >= 45 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="text-xs">
      <div className="mb-1 flex justify-between text-black/60">
        <span>{label}</span>
        <span className="font-semibold text-black">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(3, value)}%` }} />
      </div>
    </div>
  );
}

export function Stars({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating == null) return <span className="text-black/40">No reviews</span>;
  return (
    <span>
      <span className="text-amber-500">★</span> {rating.toFixed(1)} <span className="text-black/50">({count ?? 0})</span>
    </span>
  );
}
