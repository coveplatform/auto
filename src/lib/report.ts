import fs from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";
import * as z from "zod/v4";
import { claudeJSON, imageBlock, textBlock } from "./claude";
import { config, previewUrl } from "./config";
import { db, getBusiness, getDemo, getFoundation, getReport, getScan, parseJSON, type Business, type Campaign } from "./db";
import { isManual } from "./stages";
import type { Audit, Research } from "./foundation";
import type { Qualification } from "./qualify";
import { readShotBase64, type PageSpeedResult, type SiteMetrics } from "./scan";

/**
 * The owner-facing website review: a short, personal page a business owner can read on their
 * phone in two minutes. The AI writes the words; every number and pass/fail comes from the scan.
 * Written to previews/<slug>/index.html so it publishes alongside the demos.
 */

// ---------------------------------------------------------------------------
// Copy (the only AI part)
// ---------------------------------------------------------------------------

export const ReportCopySchema = z.object({
  headline: z
    .string()
    .describe(
      "Max ~12 words. Name the gap between how good the business is and what its website shows, specific to them. E.g. 'People rate you 4.9 stars. Your website is sending them elsewhere.'",
    ),
  intro: z.string().describe("1-2 short sentences, max 35 words, in the designer's first person: why you looked and what this page shows. No sales pitch."),
  findings: z
    .array(
      z.object({
        title: z
          .string()
          .describe("Max 8 words. The consequence for customers, not the technical fault. E.g. 'Phone visitors can't call you in one tap'."),
        cost: z
          .string()
          .describe(
            "Max 26 words. The moment a real customer gives up, told concretely for THIS business, e.g. 'Someone after flowers for tonight finds you on Google, can't see a single bouquet, and taps back to the next florist.' No invented statistics.",
          ),
        observed: z.string().describe("Max 14 words. What is literally on screen at the spot you point to, as a caption for a crop of their site."),
        screen: z.enum(["phone", "computer"]).describe("Which screenshot shows the problem best. Prefer phone."),
        focus_pct: z
          .number()
          .int()
          .describe("Where on that full-page screenshot the problem is, 0 = very top, 100 = very bottom. 0 for anything on the first screen."),
        fix: z.string().describe("Max 12 words: what you'd do."),
        effort: z.enum(["quick", "half_day", "redesign"]),
      }),
    )
    .describe("Exactly 3 problems, the ones losing them the most enquiries or sales, biggest first."),
  strengths: z
    .array(z.object({ title: z.string().describe("Max 6 words"), detail: z.string().describe("Max 14 words") }))
    .describe("2-3 genuine things that already work and should be kept."),
  closing: z.string().describe("1 sentence, max 25 words, no pressure: what happens if they want help."),
});
export type ReportCopy = z.infer<typeof ReportCopySchema>;

const SYSTEM = `You are an Australian freelance web designer writing a short website review for the owner of a local business. They didn't ask for it, so every line must earn its place. Many owners built their site themselves or had a relative build it.

What makes this review work:
- Only problems that cost them customers: people who can't find what they sell, can't see their work, can't contact or book them, don't trust the site, or give up waiting. Pick the 3 that lose the most enquiries or sales for THIS kind of business.
- NEVER lead with technical or cosmetic issues: no "description for Google", copyright year, alt text, image sizes, code, HTTPS on its own, or design taste. Those are already listed in a checklist elsewhere on the page.
- Every problem must be visible in the screenshots, and you point to where it is.
- Describe the cost as a concrete customer moment for their business, not a generic warning. If nearby competitors do better (data below), you may say so plainly.
- Name what already works, fairly. If their Google reviews are strong, that's a strength.

Voice: plain Australian English, short sentences, first person ("I noticed…"), warm and direct. Laid out like an infographic: respect every word limit.
No jargon ("hierarchy", "CTA", "above the fold", "UX", "conversion", "responsive", "SEO", "LCP"). Never invent statistics, facts about the business, or urgency. No fear, no hype, no exclamation marks. Never mention AI, templates or prices.`;

// ---------------------------------------------------------------------------
// Measured facts (no AI)
// ---------------------------------------------------------------------------

type Status = "good" | "warn" | "poor";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

function checks(m: SiteMetrics): Check[] {
  const year = new Date().getFullYear();
  const out: Check[] = [
    {
      label: "Fits a phone screen",
      ok: m.hasViewportMeta && !m.mobileHorizontalOverflow,
      detail: !m.hasViewportMeta
        ? "The page is shown as a shrunken desktop page on phones."
        : m.mobileHorizontalOverflow
          ? "Part of the page sticks out sideways on a phone."
          : "The layout adjusts to the screen.",
    },
    {
      label: "Text readable without zooming",
      ok: m.mobileSmallTextRatio < 0.15,
      detail: m.mobileSmallTextRatio < 0.15 ? "Text is a comfortable size on a phone." : `About ${Math.round(m.mobileSmallTextRatio * 100)}% of the text is too small on a phone.`,
    },
    {
      label: "Phone number you can tap to call",
      ok: m.telLinks > 0,
      detail: m.telLinks > 0 ? "Customers can call straight from the page." : "Customers have to copy the number to call you.",
    },
    {
      label: "Clear next step on a phone's first screen",
      ok: m.ctaAboveFoldMobile,
      detail: m.ctaAboveFoldMobile ? "A button or link to get in touch is visible straight away." : "Visitors have to scroll to find how to call, book or buy.",
    },
    {
      label: "A way to send an enquiry",
      ok: m.formCount > 0 || m.emails.length > 0,
      detail: m.formCount > 0 ? "There's a contact form." : m.emails.length > 0 ? "There's an email address, but no form." : "No form or email address on the page.",
    },
    {
      label: "Secure connection",
      ok: m.https,
      detail: m.https ? "The address starts with https." : "Browsers label the site 'Not secure'.",
    },
    {
      label: "Links all work",
      ok: m.brokenLinks.length === 0,
      detail: m.checkedLinks
        ? m.brokenLinks.length === 0
          ? `All ${m.checkedLinks} links I checked work.`
          : `${m.brokenLinks.length} of ${m.checkedLinks} links I checked go nowhere.`
        : "No links to check.",
    },
    {
      label: "Has a description for Google",
      ok: !!m.metaDescription,
      detail: m.metaDescription ? "Google has a summary to show under your name." : "Google has to guess what to show under your name.",
    },
  ];
  if (m.copyrightYear) {
    out.push({
      label: "Looks recently updated",
      ok: m.copyrightYear >= year - 1,
      detail: `The footer says © ${m.copyrightYear}.`,
    });
  }
  return out;
}

const scoreStatus = (v: number): Status => (v >= 90 ? "good" : v >= 50 ? "warn" : "poor");
const speedStatus = (s: number): Status => (s <= 2.5 ? "good" : s <= 4 ? "warn" : "poor");
const STATUS_WORD: Record<Status, string> = { good: "Good", warn: "Needs work", poor: "Poor" };

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ICON: Record<"ok" | "no" | "warn", string> = {
  ok: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--good)"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  no: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--poor)"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  warn: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--warn)"/><path d="M8 4.2v4.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1.1" fill="#fff"/></svg>`,
};
const statusIcon = (s: Status) => (s === "good" ? ICON.ok : s === "warn" ? ICON.warn : ICON.no);

const EFFORT: Record<ReportCopy["findings"][number]["effort"], [number, string]> = {
  quick: [1, "Quick fix"],
  half_day: [2, "About half a day"],
  redesign: [3, "Part of a redesign"],
};

// ---------------------------------------------------------------------------
// Nearby competitors (from your own campaign scans)
// ---------------------------------------------------------------------------

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export interface PeerComparison {
  n: number;
  who: string; // "florists around Northcote"
  rows: Array<{ label: string; you: number; typical: number; unit: string; max: number; higherIsBetter: boolean }>;
  /** Basics you're missing that most competitors have. */
  gaps: Array<{ label: string; have: number }>;
}

const MIN_PEERS = 5;
const basicsPct = (list: Check[]) => Math.round((list.filter((c) => c.ok).length / list.length) * 100);

function peerComparison(b: Business, m: SiteMetrics, ps: PageSpeedResult | null): PeerComparison | null {
  type PeerRow = Business & { metrics: string; pagespeed: string | null };
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(b.campaign_id) as Campaign | undefined;
  let peers: PeerRow[];
  let who: string;
  if (!isManual(b) && campaign) {
    peers = db
      .prepare("SELECT b.*, s.metrics, s.pagespeed FROM businesses b JOIN scans s ON s.business_id = b.id WHERE b.campaign_id = ? AND b.id != ? AND s.metrics IS NOT NULL")
      .all(b.campaign_id, b.id) as PeerRow[];
    const where = campaign.locations.split(/[;\n]+/)[0]?.trim();
    who = `${campaign.industry.toLowerCase()}${where ? ` around ${where}` : " nearby"}`;
  } else if (b.category) {
    peers = (
      db
        .prepare("SELECT b.*, s.metrics, s.pagespeed FROM businesses b JOIN scans s ON s.business_id = b.id WHERE lower(b.category) = lower(?) AND b.id != ? AND s.metrics IS NOT NULL")
        .all(b.category, b.id) as PeerRow[]
    ).filter((p) => b.lat == null || b.lng == null || p.lat == null || p.lng == null || km({ lat: b.lat, lng: b.lng }, { lat: p.lat, lng: p.lng }) <= 25);
    who = `${b.category.toLowerCase()} businesses nearby`;
  } else return null;

  const data = peers
    .map((p) => ({ m: parseJSON<SiteMetrics>(p.metrics), ps: parseJSON<PageSpeedResult>(p.pagespeed) }))
    .filter((p): p is { m: SiteMetrics; ps: PageSpeedResult | null } => !!p.m);
  if (data.length < MIN_PEERS) return null;

  const rows: PeerComparison["rows"] = [];
  const speeds = data.map((p) => p.ps?.performance).filter((v): v is number => v != null);
  if (ps?.performance != null && speeds.length >= MIN_PEERS)
    rows.push({ label: "Google speed score", you: ps.performance, typical: Math.round(median(speeds)!), unit: "/100", max: 100, higherIsBetter: true });
  const loads = data.map((p) => p.ps?.lcpMs).filter((v): v is number => v != null);
  if (ps?.lcpMs != null && loads.length >= MIN_PEERS) {
    const you = Math.round(ps.lcpMs / 100) / 10;
    const typical = Math.round(median(loads)! / 100) / 10;
    rows.push({ label: "Seconds to load on a phone", you, typical, unit: "s", max: Math.max(you, typical) * 1.15, higherIsBetter: false });
  }
  const mine = checks(m);
  const theirs = data.map((p) => checks(p.m));
  rows.push({ label: "Website basics in place", you: basicsPct(mine), typical: Math.round(median(theirs.map(basicsPct))!), unit: "%", max: 100, higherIsBetter: true });

  const gaps = mine
    .filter((c) => !c.ok)
    .map((c) => ({ label: c.label, have: theirs.filter((t) => t.find((x) => x.label === c.label)?.ok).length }))
    .filter((g) => g.have / data.length >= 0.5)
    .sort((a, z2) => z2.have - a.have)
    .slice(0, 3);
  return { n: data.length, who, rows, gaps };
}

function peerText(p: PeerComparison | null): string {
  if (!p) return "";
  return [
    `Compared with ${p.n} other ${p.who} I scanned with the same tests:`,
    ...p.rows.map((r) => `${r.label}: them ${r.you}${r.unit}, typical competitor ${r.typical}${r.unit}`),
    ...p.gaps.map((g) => `${g.have} of ${p.n} competitors have "${g.label}"; they don't.`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Screenshot crops (CSS only: the full screenshot positioned inside a frame)
// ---------------------------------------------------------------------------

/** Width and height from a JPEG's frame header. */
function jpegSize(file: string): { w: number; h: number } | null {
  try {
    const buf = fs.readFileSync(file);
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch {}
  return null;
}

/** background-position-y (%) that shows the area around `pct` of the page in a window `ratio` (h/w) tall. */
function cropY(size: { w: number; h: number } | null, pct: number, ratio: number): number {
  if (!size) return 0;
  const win = size.w * ratio;
  const travel = size.h - win;
  if (travel <= 0) return 0;
  const top = Math.min(Math.max((Math.min(Math.max(pct, 0), 100) / 100) * size.h - win * 0.3, 0), travel);
  return Math.round((top / travel) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Google-style score ring. */
function ring(label: string, help: string, value: number): string {
  const st = scoreStatus(value);
  const c = 2 * Math.PI * 50;
  const len = (Math.max(1, value) / 100) * c;
  return `<figure class="ring" role="img" aria-label="${esc(label)}: ${value} out of 100, ${STATUS_WORD[st]}">
  <div class="ring-dial">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="50" class="t-${st}" />
      <circle cx="60" cy="60" r="50" class="arc s-${st}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)" />
    </svg>
    <span class="ring-num">${value}</span>
  </div>
  <figcaption><strong>${esc(label)}</strong><span class="status">${statusIcon(st)}${STATUS_WORD[st]}</span><span class="ring-help">${esc(help)}</span></figcaption>
</figure>`;
}

function speedChart(seconds: number, source: "lcp" | "load"): string {
  const st = speedStatus(seconds);
  const max = Math.min(20, Math.max(6, Math.ceil(seconds + 1)));
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  const ticks = [0, 2.5, 4, ...Array.from({ length: Math.floor(max / 2) }, (_, i) => (i + 1) * 2).filter((t) => t > 4 && t < max - 0.5), max];
  const shown = seconds > max ? `${max}s+` : `${seconds.toFixed(1)}s`;
  const what =
    source === "lcp"
      ? "How long a phone waits before the main part of your homepage appears, in Google's test."
      : "How long your homepage took to finish loading in my test.";
  return `<figure class="speed" role="img" aria-label="Your homepage: ${shown}. Google counts up to 2.5 seconds as good and over 4 seconds as slow.">
  <figcaption><strong>Time to load on a phone</strong><span>${esc(what)}</span></figcaption>
  <div class="speed-plot">
    <div class="bands">
      <span class="band b-good" style="width:${pct(2.5)}">Good</span>
      <span class="band b-warn" style="width:calc(${pct(4)} - ${pct(2.5)})">Okay</span>
      <span class="band b-poor" style="width:calc(100% - ${pct(4)})">Slow</span>
    </div>
    <div class="bar-row">
      <div class="bar s-${st}-bg" style="width:${pct(seconds)}"></div>
      <span class="bar-label" style="left:${pct(seconds)}">${shown}</span>
    </div>
    <div class="axis">${ticks.map((t) => `<span style="left:${pct(t)}">${t === max && seconds > max ? `${t}s+` : `${t}s`}</span>`).join("")}</div>
  </div>
</figure>`;
}

function compareChart(p: PeerComparison): string {
  const fmt = (v: number, unit: string) => (unit === "/100" ? `${v}` : `${v}${unit}`);
  return p.rows
    .map((r) => {
      const youBetter = r.higherIsBetter ? r.you >= r.typical : r.you <= r.typical;
      const w = (v: number) => `${Math.max(1.5, (v / r.max) * 100).toFixed(1)}%`;
      return `<div class="cmp" role="img" aria-label="${esc(r.label)}: you ${fmt(r.you, r.unit)}, typical competitor ${fmt(r.typical, r.unit)}">
      <div class="cmp-label">${esc(r.label)}${r.higherIsBetter ? "" : " <span>(lower is better)</span>"}</div>
      <div class="cmp-row"><span class="cmp-who">You</span><span class="cmp-track"><span class="cmp-bar you ${youBetter ? "" : "behind"}" style="width:${w(r.you)}"></span><span class="cmp-val">${fmt(r.you, r.unit)}</span></span></div>
      <div class="cmp-row"><span class="cmp-who">Typical nearby</span><span class="cmp-track"><span class="cmp-bar them" style="width:${w(r.typical)}"></span><span class="cmp-val">${fmt(r.typical, r.unit)}</span></span></div>
    </div>`;
    })
    .join("\n");
}

function copyFile(fromRel: string | null | undefined, outDir: string, name: string): string | null {
  if (!fromRel) return null;
  const src = path.join(config.dataDir, fromRel);
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, path.join(outDir, name));
  return name;
}

const longDate = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function reportHtml(opts: {
  b: Business;
  copy: ReportCopy;
  m: SiteMetrics;
  ps: PageSpeedResult | null;
  shots: { desktop: string | null; mobile: string | null; demo: string | null };
  /** Pixel sizes of the copied screenshots, for the crops. */
  sizes?: { desktop: { w: number; h: number } | null; mobile: { w: number; h: number } | null };
  peers?: PeerComparison | null;
  demoUrl: string | null;
  scannedAt: Date;
}): string {
  const { b, copy, m, ps, shots, demoUrl, scannedAt } = opts;
  const sizes = opts.sizes ?? { desktop: null, mobile: null };
  const peers = opts.peers ?? null;
  const s = config.sender;
  const from = s.business ? `${s.name}, ${s.business}` : s.name;
  const list = checks(m);
  const passed = list.filter((c) => c.ok).length;
  const seconds = ps?.lcpMs ? ps.lcpMs / 1000 : m.loadMs ? m.loadMs / 1000 : null;
  const scores = ps
    ? ([
        ["Speed", "How quickly it becomes usable", ps.performance],
        ["Accessibility", "Usable by everyone, including poor eyesight", ps.accessibility],
        ["Search basics", "Whether Google can read the page", ps.seo],
        ["Technical health", "Security and modern standards", ps.bestPractices],
      ] as Array<[string, string, number | null]>).filter((r): r is [string, string, number] => r[2] != null)
    : [];
  const strongReviews = b.rating != null && b.rating >= 4 && (b.review_count ?? 0) >= 5;
  const contact = [
    s.phone ? `call me on <a href="tel:${esc(s.phone.replace(/\s+/g, ""))}">${esc(s.phone)}</a>` : "",
    s.email ? `email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "",
  ].filter(Boolean);

  const glance = [
    strongReviews
      ? `<div class="stat">
        <div class="stat-fig">${esc(b.rating!.toFixed(1))}<span class="stars" aria-hidden="true">${"★".repeat(Math.round(b.rating!))}</span></div>
        <div class="stat-label">Google rating from ${esc(b.review_count)} reviews. Customers rate you.</div>
      </div>`
      : "",
    `<div class="stat">
        <div class="stat-fig">${passed}<span class="of">/${list.length}</span></div>
        <div class="units" role="img" aria-label="${passed} of ${list.length} basics in place">${list.map((c) => (c.ok ? ICON.ok : ICON.no)).join("")}</div>
        <div class="stat-label">Website basics in place${peers ? `. Typical nearby: ${Math.round((peers.rows.find((r) => r.unit === "%")!.typical / 100) * list.length)}/${list.length}` : ""}</div>
      </div>`,
    seconds
      ? `<div class="stat">
        <div class="stat-fig">${seconds > 20 ? "20+" : seconds.toFixed(1)}<span class="of">s</span></div>
        <div class="mini" role="img" aria-label="${seconds.toFixed(1)} seconds, against Google's goal of 2.5 seconds"><span class="mini-bar s-${speedStatus(seconds)}-bg" style="width:${(Math.min(seconds, 10) / 10) * 100}%"></span><i style="left:25%"></i></div>
        <div class="stat-label">To load on a phone. Google's goal is 2.5s, marked in white.</div>
      </div>`
      : "",
  ].filter(Boolean);

  const crop = (f: ReportCopy["findings"][number]) => {
    const phone = f.screen === "phone" && shots.mobile;
    const file = phone ? shots.mobile : shots.desktop;
    if (!file) return "";
    const y = cropY(phone ? sizes.mobile : sizes.desktop, f.focus_pct, phone ? 4 / 3 : 1 / 2);
    return `<figure class="evidence">
        <div class="crop ${phone ? "crop-phone" : "crop-computer"}" role="img" aria-label="${esc(f.observed)}" style="background-image:url(${file});background-position:50% ${y}%"></div>
        <figcaption>${esc(f.observed)}</figcaption>
      </figure>`;
  };

  const beforeAfter =
    demoUrl && shots.demo && shots.desktop
      ? `<section class="ba" aria-labelledby="ba">
    <h2 id="ba" class="sr">Your homepage today, and a concept for a new one</h2>
    <div class="ba-pair">
      <figure><div class="frame"><img src="${shots.desktop}" alt="Your homepage today" width="1440" height="900"></div><figcaption>Your homepage today</figcaption></figure>
      <figure><a class="frame" href="${esc(demoUrl)}"><img src="${shots.demo}" alt="A concept for a new ${esc(b.name)} homepage" width="1440" height="900"></a><figcaption>A concept I made for you, with your own words and photos</figcaption></figure>
    </div>
    <p class="ba-cta"><a class="button" href="${esc(demoUrl)}">See the full concept</a><span>Private, and no obligation.</span></p>
  </section>`
      : shots.desktop
        ? `<figure class="today">
    <div class="today-frames">
      <div class="desktop"><img src="${shots.desktop}" alt="Your current homepage on a computer" width="1440" height="810"></div>
      ${shots.mobile ? `<div class="phone"><img src="${shots.mobile}" alt="Your current homepage on a phone" width="390" height="823"></div>` : ""}
    </div>
    <figcaption>Your homepage on ${esc(longDate(scannedAt))}, on a computer and a phone.</figcaption>
  </figure>`
        : "";

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Website review for ${esc(b.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
:root {
  color-scheme: light;
  --paper: #f4f6f8;
  --surface: #ffffff;
  --ink: #18212f;
  --ink-2: #445063;
  --ink-3: #5f6a7a;
  --rule: #dde2e8;
  --accent: #2b4acb;
  --muted-bar: #aab3c0;
  --good: #1e7f55; --good-t: #d6ebe0; --good-w: #eef7f2;
  --warn: #c98a00; --warn-t: #f4e6c4;
  --poor: #b42335; --poor-t: #f3d5da; --poor-w: #fbeef0;
  --serif: "Newsreader", Georgia, serif;
  --sans: "Public Sans", system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1rem/1.55 var(--sans); }
img { display: block; max-width: 100%; }
a { color: var(--accent); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, .button:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.page { max-width: 64rem; margin: 0 auto; padding: 0 1.25rem 4rem; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ico { width: 1rem; height: 1rem; flex: none; }

/* Masthead + opening */
.masthead { display: flex; justify-content: space-between; gap: 0.25rem 1rem; flex-wrap: wrap; padding: 1.5rem 0; border-bottom: 1px solid var(--rule); font-size: 0.875rem; color: var(--ink-3); }
.masthead strong { color: var(--ink); font-weight: 600; }
.opening { max-width: 44rem; }
h1 { font: 500 clamp(2.4rem, 6.5vw, 4.25rem)/1.03 var(--serif); letter-spacing: -0.02em; margin: clamp(2.5rem, 7vw, 4rem) 0 1.25rem; text-wrap: balance; }
.intro { font: 400 1.25rem/1.55 var(--serif); color: var(--ink-2); margin: 0; max-width: 36em; }

/* At a glance: the one dark band */
.glance { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin-top: 2.5rem; background: var(--ink); color: #fff; border-radius: 14px; overflow: hidden; --good: #3fb37f; --poor: #e5546a; --warn: #e0a526; }
.stat { padding: 1.6rem 1.75rem 1.75rem; display: grid; align-content: start; gap: 0.75rem; }
.stat + .stat { border-left: 1px solid rgb(255 255 255 / 0.14); }
.stat-fig { font: 600 3.4rem/1 var(--sans); letter-spacing: -0.03em; display: flex; align-items: baseline; gap: 0.4rem; }
.stat-fig .of { font-size: 1.5rem; font-weight: 500; color: rgb(255 255 255 / 0.65); letter-spacing: 0; }
.stars { font-size: 1.1rem; letter-spacing: 0.12em; color: #f2c14e; }
.stat-label { font-size: 0.9375rem; color: rgb(255 255 255 / 0.78); max-width: 18rem; }
.units { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.units .ico { width: 1.15rem; height: 1.15rem; }
.mini { position: relative; height: 8px; border-radius: 4px; background: rgb(255 255 255 / 0.14); margin: 0.35rem 0 0.2rem; }
.mini-bar { display: block; height: 100%; border-radius: 4px; }
.mini i { position: absolute; top: -5px; bottom: -5px; width: 2px; background: #fff; }
.s-good-bg { background: var(--good); } .s-warn-bg { background: var(--warn); } .s-poor-bg { background: var(--poor); }

/* Before / after */
.ba { margin-top: 3rem; }
.ba-pair { display: grid; gap: 1.25rem; grid-template-columns: 1fr 1fr; }
.ba figure { margin: 0; }
.ba .frame { display: block; aspect-ratio: 16 / 10; border-radius: 12px; overflow: hidden; border: 1px solid var(--rule); background: var(--surface); }
.ba .frame img { width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform 0.4s ease; }
.ba a.frame { box-shadow: 0 22px 48px -24px rgb(24 33 47 / 0.5); }
.ba a.frame:hover img { transform: scale(1.015); }
.ba figcaption { margin-top: 0.6rem; font-size: 0.875rem; color: var(--ink-3); }
.ba-cta { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0 0; color: var(--ink-3); font-size: 0.9375rem; }

/* Their site today (no concept yet) */
.today { margin: 3rem 0 0; }
.today-frames { position: relative; padding-right: clamp(4.5rem, 16vw, 10rem); }
.today .desktop { border-radius: 10px; overflow: hidden; border: 1px solid var(--rule); background: var(--surface); aspect-ratio: 16 / 9; }
.today .desktop img, .today .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.today .phone { position: absolute; right: 0; bottom: -2rem; width: clamp(7rem, 22vw, 13rem); aspect-ratio: 9 / 19; border-radius: 18px; overflow: hidden; border: 5px solid var(--ink); background: var(--surface); box-shadow: 0 18px 40px -18px rgb(24 33 47 / 0.45); }
.today figcaption { margin-top: 2.75rem; font-size: 0.875rem; color: var(--ink-3); }

/* Sections */
section { margin-top: clamp(3.5rem, 9vw, 5.5rem); }
h2 { font: 500 clamp(1.75rem, 4.5vw, 2.4rem)/1.12 var(--serif); letter-spacing: -0.01em; margin: 0 0 0.4rem; }
.lede { color: var(--ink-3); margin: 0 0 1.75rem; }
.panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 14px; padding: clamp(1.25rem, 4vw, 2rem); }
.panel + .panel { margin-top: 1rem; }

/* Findings: ranked by impact, each with a crop of their own site */
.findings { list-style: none; margin: 0; padding: 0; }
.finding { display: grid; grid-template-columns: minmax(0, 20rem) minmax(0, 1fr); gap: 1.5rem 3rem; align-items: center; padding: 2.5rem 0; border-top: 1px solid var(--rule); }
.finding:last-child { border-bottom: 1px solid var(--rule); }
.evidence { margin: 0; display: grid; justify-items: center; gap: 0.6rem; }
.crop { width: 100%; background-color: var(--surface); background-repeat: no-repeat; background-size: 100% auto; }
.crop-phone { width: 14rem; aspect-ratio: 3 / 4; border-radius: 22px; border: 6px solid var(--ink); box-shadow: 0 16px 36px -20px rgb(24 33 47 / 0.5); }
.crop-computer { aspect-ratio: 2 / 1; border-radius: 10px; border: 1px solid var(--rule); box-shadow: 0 16px 36px -22px rgb(24 33 47 / 0.4); }
.evidence figcaption { font-size: 0.8125rem; color: var(--ink-3); text-align: center; max-width: 18rem; }
.rank { display: block; font: 600 0.9375rem/1 var(--sans); color: var(--accent); margin-bottom: 0.6rem; }
.finding h3 { font: 500 clamp(1.6rem, 3.6vw, 2.1rem)/1.12 var(--serif); letter-spacing: -0.01em; margin: 0 0 0.85rem; text-wrap: balance; }
.cost { font: 400 1.1875rem/1.55 var(--serif); color: var(--ink-2); margin: 0 0 1.25rem; max-width: 32em; }
.fix { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 1rem; margin: 0; font-size: 0.9375rem; }
.fix strong { font-weight: 600; }
.effort { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--ink-3); }
.pips { display: inline-flex; gap: 3px; }
.pips i { width: 14px; height: 6px; border-radius: 3px; background: var(--rule); }
.pips i.on { background: var(--accent); }

/* Nearby comparison */
.cmps { display: grid; gap: 1.75rem; }
.cmp-label { font-weight: 600; margin-bottom: 0.5rem; }
.cmp-label span { font-weight: 400; color: var(--ink-3); font-size: 0.875rem; }
.cmp-row { display: grid; grid-template-columns: 8.5rem 1fr; align-items: center; gap: 0.75rem; margin-top: 0.35rem; }
.cmp-who { font-size: 0.875rem; color: var(--ink-2); }
.cmp-track { display: flex; align-items: center; gap: 0.6rem; min-width: 0; padding-right: 3.5rem; }
.cmp-bar { height: 18px; border-radius: 0 4px 4px 0; flex: none; }
.cmp-bar.you { background: var(--accent); }
.cmp-bar.you.behind { background: var(--poor); }
.cmp-bar.them { background: var(--muted-bar); }
.cmp-val { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gaps { list-style: none; margin: 1.75rem 0 0; padding: 1.25rem 0 0; border-top: 1px solid var(--rule); display: grid; gap: 0.6rem; }
.gaps li { display: flex; gap: 0.6rem; align-items: baseline; }
.gaps .ico { transform: translateY(0.15rem); }
.gaps strong { font-weight: 600; }

/* Strengths */
.strengths { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem 2rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.strengths li { display: grid; grid-template-columns: 1.15rem 1fr; gap: 0.6rem; }
.strengths .ico { width: 1.15rem; height: 1.15rem; margin-top: 0.15rem; }
.strengths strong { display: block; font-weight: 600; }
.strengths span { color: var(--ink-2); font-size: 0.9375rem; }

/* Score rings */
.rings { display: grid; gap: 1.5rem 1rem; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); }
.ring { margin: 0; display: grid; align-content: start; justify-items: center; text-align: center; gap: 0.75rem; }
.ring-dial { position: relative; width: 7.5rem; height: 7.5rem; }
.ring-dial svg { width: 100%; height: 100%; }
.ring-dial circle { fill: none; stroke-width: 10; }
.ring-dial .arc { stroke-linecap: round; }
.ring-dial .t-good { stroke: var(--good-t); } .ring-dial .t-warn { stroke: var(--warn-t); } .ring-dial .t-poor { stroke: var(--poor-t); }
.ring-dial .s-good { stroke: var(--good); } .ring-dial .s-warn { stroke: var(--warn); } .ring-dial .s-poor { stroke: var(--poor); }
.ring-num { position: absolute; inset: 0; display: grid; place-items: center; font: 600 2.1rem/1 var(--sans); letter-spacing: -0.02em; }
.ring figcaption { display: grid; justify-items: center; gap: 0.2rem; }
.ring figcaption strong { font-weight: 600; }
.status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8125rem; font-weight: 500; color: var(--ink-2); }
.ring-help { font-size: 0.8125rem; color: var(--ink-3); max-width: 12rem; }
.source { margin: 1.75rem 0 0; padding-top: 1rem; border-top: 1px solid var(--rule); font-size: 0.8125rem; color: var(--ink-3); }

/* Speed */
.speed { margin: 0; }
.speed figcaption { display: grid; gap: 0.15rem; margin-bottom: 1.5rem; }
.speed figcaption span { font-size: 0.875rem; color: var(--ink-3); }
.speed-plot { padding-right: 3.75rem; }
.bands { display: flex; height: 1.6rem; font-size: 0.75rem; font-weight: 500; line-height: 1.6rem; color: var(--ink-2); }
.band { padding-left: 0.45rem; white-space: nowrap; overflow: hidden; border-left: 2px solid var(--surface); }
.band:first-child { border-left: 0; border-radius: 4px 0 0 4px; }
.band:last-child { border-radius: 0 4px 4px 0; }
.b-good { background: var(--good-t); } .b-warn { background: var(--warn-t); } .b-poor { background: var(--poor-t); }
.bar-row { position: relative; height: 3rem; display: flex; align-items: center; border-left: 1px solid var(--ink-3); }
.bar { height: 22px; border-radius: 0 4px 4px 0; }
.bar-label { position: absolute; top: 50%; transform: translate(0.55rem, -50%); font: 700 1.25rem/1 var(--sans); white-space: nowrap; }
.axis { position: relative; height: 1.3rem; border-top: 1px solid var(--rule); font-size: 0.75rem; line-height: 1.3rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.axis span { position: absolute; transform: translateX(-50%); }
.axis span:first-child { transform: none; }

/* The basics as tiles */
.tiles-head { margin: 0 0 1rem; color: var(--ink-2); }
.tiles-head strong { color: var(--ink); }
.tiles { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.tile { display: grid; align-content: start; grid-template-columns: 1.15rem 1fr; gap: 0.2rem 0.65rem; padding: 0.95rem 1rem; border-radius: 10px; }
.tile.ok { background: var(--good-w); }
.tile.no { background: var(--poor-w); }
.tile .ico { width: 1.15rem; height: 1.15rem; margin-top: 0.1rem; }
.tile strong { font-weight: 600; font-size: 0.9375rem; }
.tile > span { grid-column: 2; font-size: 0.875rem; color: var(--ink-2); }

/* Close */
.close { background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; padding: clamp(1.75rem, 5vw, 3rem); }
.close h2 { margin-bottom: 1rem; }
.close p { font: 400 1.25rem/1.55 var(--serif); margin: 0 0 1.5rem; max-width: 34em; }
.button { display: inline-block; padding: 0.85rem 1.4rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
.button:hover { background: #2240b3; }
.close .signature { font: 400 1rem/1.5 var(--sans); color: var(--ink-2); margin: 1.75rem 0 0; }
.signature strong { color: var(--ink); font-weight: 600; }

@media (max-width: 44rem) {
  .finding { grid-template-columns: 1fr; padding: 2rem 0; }
  .crop-phone { width: 12rem; }
  .ba-pair { grid-template-columns: 1fr; }
}
@media (max-width: 40rem) {
  .stat + .stat { border-left: 0; border-top: 1px solid rgb(255 255 255 / 0.14); }
  .stat-fig { font-size: 2.9rem; }
  .rings { grid-template-columns: 1fr 1fr; }
  .ring-dial { width: 6.5rem; height: 6.5rem; }
  .ring-num { font-size: 1.8rem; }
  .cmp-row { grid-template-columns: 6.5rem 1fr; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media print { body { background: #fff; } }
</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    <span>Website review for <strong>${esc(b.name)}</strong></span>
    <span>${esc(from)}, ${esc(longDate(scannedAt))}</span>
  </header>

  <div class="opening">
    <h1>${esc(copy.headline)}</h1>
    <p class="intro">${esc(copy.intro)}</p>
  </div>

  <div class="glance" aria-label="At a glance">
    ${glance.join("\n    ")}
  </div>

  ${beforeAfter}

  <section aria-labelledby="fix">
    <h2 id="fix">What's costing you customers</h2>
    <p class="lede">The three things I'd fix first, biggest first. The pictures are from your own site.</p>
    <ol class="findings">
      ${copy.findings
        .map((f, i) => {
          const [pips, effort] = EFFORT[f.effort];
          return `<li class="finding">
      ${crop(f)}
      <div>
        <span class="rank">${i + 1} of ${copy.findings.length}</span>
        <h3>${esc(f.title)}</h3>
        <p class="cost">${esc(f.cost)}</p>
        <p class="fix"><span><strong>The fix:</strong> ${esc(f.fix)}</span><span class="effort"><span class="pips" aria-hidden="true">${[1, 2, 3].map((n) => `<i${n <= pips ? ' class="on"' : ""}></i>`).join("")}</span>${effort}</span></p>
      </div>
    </li>`;
        })
        .join("\n    ")}
    </ol>
  </section>

  ${
    peers
      ? `<section aria-labelledby="compare">
    <h2 id="compare">How you compare nearby</h2>
    <p class="lede">Against ${peers.n} other ${esc(peers.who)}, using the same tests.</p>
    <div class="panel">
      <div class="cmps">
        ${compareChart(peers)}
      </div>
      ${
        peers.gaps.length
          ? `<ul class="gaps">${peers.gaps.map((g) => `<li>${ICON.no}<span><strong>${g.have} of ${peers.n}</strong> nearby have “${esc(g.label.toLowerCase())}”. You don't yet.</span></li>`).join("")}</ul>`
          : ""
      }
    </div>
  </section>`
      : ""
  }

  <section aria-labelledby="working">
    <h2 id="working">What's already working</h2>
    <p class="lede">Worth keeping, whatever you decide to change.</p>
    <ul class="strengths">
      ${copy.strengths.map((x) => `<li>${ICON.ok}<div><strong>${esc(x.title)}</strong><span>${esc(x.detail)}</span></div></li>`).join("\n      ")}
    </ul>
  </section>

  <section aria-labelledby="measured">
    <h2 id="measured">The full check-up</h2>
    <p class="lede">Measured on a phone, the way most of your customers see it.</p>
    ${
      scores.length
        ? `<div class="panel">
      <div class="rings">
        ${scores.map(([l, h, v]) => ring(l, h, Math.round(v))).join("\n        ")}
      </div>
      <p class="source">Scores out of 100 from Google PageSpeed Insights, mobile test, ${esc(longDate(scannedAt))}. Google rates 90 and above as good, 50 to 89 as needing work, and under 50 as poor.</p>
    </div>`
        : ""
    }
    ${seconds ? `<div class="panel">${speedChart(seconds, ps?.lcpMs ? "lcp" : "load")}</div>` : ""}
    <div class="panel">
      <p class="tiles-head"><strong>The basics:</strong> ${passed} of ${list.length} in place</p>
      <ul class="tiles">
        ${list
          .map(
            (c) =>
              `<li class="tile ${c.ok ? "ok" : "no"}">${c.ok ? ICON.ok : ICON.no}<strong><span class="sr">${c.ok ? "Yes: " : "No: "}</span>${esc(c.label)}</strong><span>${esc(c.detail)}</span></li>`,
          )
          .join("\n        ")}
      </ul>
    </div>
  </section>

  <section class="close" aria-labelledby="next">
    <h2 id="next">Want these fixed?</h2>
    <p>${esc(copy.closing)}${contact.length ? ` Reply to my email or ${contact.join(", or ")}.` : " Just reply to my email."}</p>
    ${demoUrl ? `<a class="button" href="${esc(demoUrl)}">See the concept I made for you</a>` : ""}
    <p class="signature"><strong>${esc(s.name)}</strong>${s.business ? `<br>${esc(s.business)}` : ""}${s.phone ? `<br>${esc(s.phone)}` : ""}${s.email ? `<br>${esc(s.email)}` : ""}</p>
  </section>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const slugSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);
function slugFor(name: string) {
  const base = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
  return `${base || "business"}-review-${slugSuffix()}`;
}

/** Write the report page from saved copy + the latest scan, demo and competitor data. No AI call. */
export function renderReport(businessId: number): string {
  const b = getBusiness(businessId);
  const row = getReport(businessId);
  const scan = getScan(businessId);
  const copy = ReportCopySchema.safeParse(parseJSON(row?.data));
  const m = parseJSON<SiteMetrics>(scan?.metrics);
  if (!b || !row || !scan || !m) throw new Error("Nothing to render: write the report first.");
  if (!copy.success) throw new Error("This report was written by an older version. Click Rewrite.");
  const ps = parseJSON<PageSpeedResult>(scan.pagespeed);
  const demo = getDemo(businessId);

  const outDir = path.join(config.previewsDir, row.slug);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const shots = {
    desktop: copyFile(scan.desktop_shot, outDir, "today-desktop.jpg"),
    mobile: copyFile(scan.mobile_shot, outDir, "today-phone.jpg"),
    demo: demo ? copyFile(demo.desktop_shot, outDir, "concept.jpg") : null,
  };
  const html = reportHtml({
    b,
    copy: copy.data,
    m,
    ps,
    shots,
    sizes: {
      desktop: shots.desktop ? jpegSize(path.join(outDir, shots.desktop)) : null,
      mobile: shots.mobile ? jpegSize(path.join(outDir, shots.mobile)) : null,
    },
    peers: peerComparison(b, m, ps),
    demoUrl: demo ? (demo.published_url ?? previewUrl(demo.slug)) : null,
    scannedAt: new Date(`${scan.scanned_at.replace(" ", "T")}Z`),
  });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  db.prepare("UPDATE reports SET built_at = datetime('now') WHERE business_id = ?").run(businessId);
  return previewUrl(row.slug);
}

/** Write the owner-facing copy with Claude, then render the page. */
export async function createReport(businessId: number): Promise<string> {
  const b = getBusiness(businessId);
  const scan = getScan(businessId);
  const m = parseJSON<SiteMetrics>(scan?.metrics);
  if (!b || !scan || !m) throw new Error("Scan the site before writing a report.");
  const ps = parseJSON<PageSpeedResult>(scan.pagespeed);
  const q = parseJSON<Qualification>(scan.ai);
  const fRow = getFoundation(businessId);
  const audit = parseJSON<Audit>(fRow?.audit);
  const research = parseJSON<Research>(fRow?.research);

  const shots = [];
  for (const [label, rel] of [
    ["Their homepage on a computer (full page, top to bottom):", scan.desktop_shot],
    ["Their homepage on a phone (full page, top to bottom):", scan.mobile_shot],
  ] as const) {
    if (rel && fs.existsSync(path.join(config.dataDir, rel))) shots.push(textBlock(label), imageBlock(readShotBase64(rel)));
  }
  const failing = checks(m).filter((c) => !c.ok);
  const facts = [
    `Business: ${b.name} (${b.category ?? "local business"}), ${b.address ?? ""}`,
    `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews`,
    `Website: ${m.finalUrl}`,
    `Measured problems: ${failing.map((c) => `${c.label}: ${c.detail}`).join(" | ") || "none"}`,
    ps
      ? `Google PageSpeed (mobile): speed ${ps.performance}, accessibility ${ps.accessibility}, search basics ${ps.seo}, technical ${ps.bestPractices}; main content appears after ${ps.lcpMs ? (ps.lcpMs / 1000).toFixed(1) + "s" : "?"}`
      : `Load time in our test: ${(m.loadMs / 1000).toFixed(1)}s`,
    `Calls to action found: ${m.ctas.join(", ") || "none"} | Click-to-call links: ${m.telLinks} | Forms: ${m.formCount}`,
    peerText(peerComparison(b, m, ps)),
    q ? `Designer's quick notes. Problems: ${q.problems.join("; ")}. Strengths: ${q.strengths.join("; ")}.` : "",
    audit ? `Detailed UX audit: ${audit.first_impression} Issues: ${audit.issues.map((i) => `${i.observation} (${i.severity})`).join("; ")}. Works: ${audit.what_works.join("; ")}` : "",
    research ? `About the business: ${research.summary} Main action for customers: ${research.primary_conversion}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const copy = await claudeJSON({
    system: SYSTEM,
    schema: ReportCopySchema,
    effort: "medium",
    maxTokens: 6000,
    content: [...shots, textBlock(`${facts}\n\nWrite the website review for the owner.`)],
  });
  copy.findings = copy.findings.slice(0, 3);
  copy.strengths = copy.strengths.slice(0, 3);

  const slug = getReport(businessId)?.slug ?? slugFor(b.name);
  db.prepare(
    `INSERT INTO reports (business_id, slug, data, built_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(business_id) DO UPDATE SET data = excluded.data, built_at = excluded.built_at`,
  ).run(businessId, slug, JSON.stringify(copy));
  return renderReport(businessId);
}
