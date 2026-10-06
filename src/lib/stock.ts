import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * Stock photo search for slots the business has no good photo for.
 * Order of preference: your own curated ./library/<topic>/ folders, Pexels (free key,
 * no attribution needed), then Openverse (no key, Creative Commons — needs attribution).
 * Claude then looks at the candidates and picks (or rejects) them.
 */

export interface StockCandidate {
  id: string;
  thumb: string; // URL or absolute local path
  full: string;
  width: number;
  height: number;
  credit: string | null;
  source: "library" | "pexels" | "openverse";
}

const IMG_EXT = /\.(jpe?g|png|webp)$/i;

function libraryCandidates(topicText: string): StockCandidate[] {
  const dir = config.libraryDir;
  if (!fs.existsSync(dir)) return [];
  const words = topicText.toLowerCase();
  const out: StockCandidate[] = [];
  for (const folder of fs.readdirSync(dir)) {
    const full = path.join(dir, folder);
    if (!fs.statSync(full).isDirectory()) continue;
    const keys = folder.toLowerCase().split(/[-_ ]+/);
    if (!keys.some((k) => k.length > 2 && words.includes(k))) continue;
    for (const f of fs.readdirSync(full)) {
      if (!IMG_EXT.test(f)) continue;
      const p = path.join(full, f);
      out.push({ id: `lib:${folder}/${f}`, thumb: p, full: p, width: 0, height: 0, credit: null, source: "library" });
    }
  }
  return out;
}

async function pexels(query: string, orientation: string, n: number): Promise<StockCandidate[]> {
  if (!config.pexelsApiKey) return [];
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: String(n), orientation, size: "large" })}`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsApiKey }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    photos: Array<{ id: number; width: number; height: number; photographer: string; src: { medium: string; large2x: string } }>;
  };
  return data.photos.map((p) => ({
    id: `pexels:${p.id}`,
    thumb: p.src.medium,
    full: p.src.large2x,
    width: p.width,
    height: p.height,
    credit: `Photo: ${p.photographer} / Pexels`,
    source: "pexels" as const,
  }));
}

async function openverse(query: string, orientation: string, n: number): Promise<StockCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(n * 2),
    license_type: "commercial,modification",
    mature: "false",
  });
  if (orientation === "landscape") params.set("aspect_ratio", "wide");
  if (orientation === "portrait") params.set("aspect_ratio", "tall");
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: Array<{ id: string; url: string; thumbnail: string; width: number | null; height: number | null; creator: string | null; license: string; license_version: string | null }>;
  };
  return data.results
    .filter((r) => (r.width ?? 0) >= 900 && /\.(jpe?g|png|webp)(\?|$)/i.test(r.url))
    .slice(0, n)
    .map((r) => ({
      id: `openverse:${r.id}`,
      thumb: r.thumbnail,
      full: r.url,
      width: r.width ?? 0,
      height: r.height ?? 0,
      credit: `Photo: ${r.creator ?? "unknown"} (CC ${r.license.toUpperCase()}${r.license_version ? " " + r.license_version : ""})`,
      source: "openverse" as const,
    }));
}

export async function searchStock(
  query: string,
  opts: { orientation: "landscape" | "portrait" | "square"; topic: string; n?: number },
): Promise<StockCandidate[]> {
  const n = opts.n ?? 8;
  const lib = libraryCandidates(`${opts.topic} ${query}`);
  // Long, art-directed queries often return nothing, so fall back to simpler versions.
  const firstClause = query.split(/[,;(]/)[0].trim();
  const keyWords = firstClause
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(and|with|the|for|on|in|of|at|a|an|from|into|over|soft|warm|natural|light|close|up)$/i.test(w))
    .slice(0, 3)
    .join(" ");
  const attempts = [...new Set([query, firstClause, keyWords].filter((q) => q.length > 2))];
  const remote: StockCandidate[] = [];
  for (const q of attempts) {
    try {
      const found = config.pexelsApiKey ? await pexels(q, opts.orientation, n) : await openverse(q, opts.orientation, n);
      for (const c of found) if (!remote.some((r) => r.id === c.id)) remote.push(c);
    } catch {
      // try the next, simpler query
    }
    if (remote.length >= Math.min(6, n)) break;
  }
  return [...lib.slice(0, 6), ...remote].slice(0, n + 6);
}

/** Copy/download a candidate to `destNoExt` + extension. Returns the file name or null. */
export async function fetchCandidate(c: StockCandidate, destNoExt: string, which: "thumb" | "full"): Promise<string | null> {
  const src = which === "thumb" ? c.thumb : c.full;
  try {
    if (c.source === "library") {
      const ext = path.extname(src).toLowerCase() || ".jpg";
      fs.copyFileSync(src, destNoExt + ext);
      return path.basename(destNoExt + ext);
    }
    const res = await fetch(src, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null;
    fs.writeFileSync(destNoExt + ext, buf);
    return path.basename(destNoExt + ext);
  } catch {
    return null;
  }
}
