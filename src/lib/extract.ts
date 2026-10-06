import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { desktopContext, gotoSettled } from "./browser";
import type { Extraction, ImageAsset, LogoCandidate } from "./templates/content";

const IMG_COLLECT = `
  const __ctx = (el) => {
    let n = el;
    for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
      const t = (n.innerText || "").trim().replace(/\\s+/g, " ");
      if (t && t.length < 120) return t;
    }
    const a = el.closest("a");
    return a ? (a.getAttribute("title") || a.href.split("/").filter(Boolean).pop() || "") : "";
  };
  const __skip = /icon|sprite|badge|payment|visa|mastercard|paypal|afterpay|spinner|loader|pixel|tracking|emoji|flag/i;
  const __imgs = [];
  Array.from(document.querySelectorAll("img")).forEach((img) => {
    const w = img.naturalWidth, h = img.naturalHeight;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:") || /\\.svg(\\?|$)/i.test(src) || __skip.test(src)) return;
    if (Math.min(w, h) < 200 || w * h < 60000) return;
    __imgs.push({ src, alt: img.alt || "", width: w, height: h, context: __ctx(img).slice(0, 100) });
  });
  Array.from(document.querySelectorAll("section, div, header, figure, a, li")).slice(0, 2500).forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || !bg.startsWith("url(")) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 200) return;
    const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
    if (m && m[1] && !m[1].startsWith("data:") && !__skip.test(m[1])) {
      let src; try { src = new URL(m[1], location.href).href; } catch { return; }
      __imgs.push({ src, alt: "", width: Math.round(r.width), height: Math.round(r.height), context: __ctx(el).slice(0, 100) });
    }
  });
`;

const HOME_SCRIPT = `(() => {
  const q = (s, root) => Array.from((root || document).querySelectorAll(s));
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

  // ---- logos ----
  const logos = [];
  const pushLogo = (src, how, w, h) => { if (src && !logos.some((l) => l.src === src)) logos.push({ src, how, width: w || 0, height: h || 0 }); };
  const header = document.querySelector("header") || document.querySelector("nav") || document.body;
  q("img", document).forEach((img) => {
    const attrs = [img.src, img.alt, img.className, img.id, img.parentElement && img.parentElement.className].join(" ");
    const inHeader = header.contains(img);
    if (/logo/i.test(attrs)) pushLogo(img.currentSrc || img.src, inHeader ? "img with 'logo' in header" : "img with 'logo'", img.naturalWidth, img.naturalHeight);
  });
  const firstHeaderImg = header.querySelector("img");
  if (firstHeaderImg) pushLogo(firstHeaderImg.currentSrc || firstHeaderImg.src, "first image in header", firstHeaderImg.naturalWidth, firstHeaderImg.naturalHeight);
  let inlineSvg = null;
  const svg = header.querySelector('a[href="/"] svg, [class*="logo" i] svg, svg[class*="logo" i]');
  if (svg && svg.outerHTML.length < 200000) {
    const r = svg.getBoundingClientRect();
    inlineSvg = { markup: svg.outerHTML, width: Math.round(r.width), height: Math.round(r.height) };
  }
  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) pushLogo(abs(og.content), "og:image", 0, 0);
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) pushLogo(abs(touch.getAttribute("href")), "apple-touch-icon", 180, 180);

  // ---- images ----
  ${IMG_COLLECT}
  const images = __imgs.filter((i) => !logos.some((l) => l.src === i.src));

  // ---- colours ----
  const counts = {};
  const add = (c, w, where) => {
    const m = c && c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?/);
    if (!m) return;
    if (m[4] !== undefined && Number(m[4]) < 0.5) return;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    if (s < 0.18 && !(l < 0.25 && s > 0.08)) return;
    if (l > 0.95 || l < 0.04) return;
    const hex = "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    counts[hex] = counts[hex] || { weight: 0, where: new Set() };
    counts[hex].weight += w;
    counts[hex].where.add(where);
  };
  q("header, nav, footer, section, div, a, button, .btn, h1, h2, h3, span").slice(0, 3000).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const area = Math.min(r.width * r.height, 400000) / 10000;
    add(cs.backgroundColor, tag === "a" || tag === "button" ? area * 4 + 5 : area, tag + " background");
    if (/^(a|button|h1|h2|h3)$/.test(tag)) add(cs.color, 3, tag + " text");
  });
  const colorCandidates = Object.entries(counts)
    .map(([color, v]) => ({ color, weight: Math.round(v.weight), where: Array.from(v.where).slice(0, 3).join(", ") }))
    .sort((a, b) => b.weight - a.weight).slice(0, 10);
  const theme = document.querySelector('meta[name="theme-color"]');

  // ---- structured data ----
  const jsonLd = [];
  q('script[type="application/ld+json"]').forEach((s) => { try { jsonLd.push(JSON.parse(s.textContent)); } catch {} });

  // ---- links to crawl ----
  const origin = location.origin;
  const links = q("a[href]").map((a) => ({ href: a.href.split("#")[0], text: (a.innerText || "").trim().slice(0, 60) }))
    .filter((l) => l.href.startsWith(origin) && l.href !== location.href && !/\\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(l.href));

  const text = document.body.innerText;
  const phones = Array.from(new Set(text.match(/(?:\\+?61\\s?|0)[2-478](?:[ -]?\\d){8}|1[38]00(?:[ -]?\\d){6}|13(?:[ -]?\\d){4}/g) || [])).slice(0, 4);
  const emails = Array.from(new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || []).concat(q('a[href^="mailto:"]').map((a) => a.href.replace(/^mailto:/i, "").split("?")[0])))).map((e) => e.toLowerCase()).slice(0, 4);
  const social = Array.from(new Set(q("a[href]").map((a) => a.href).filter((h) => /facebook\\.com|instagram\\.com|linkedin\\.com|youtube\\.com|tiktok\\.com/i.test(h)))).slice(0, 6);

  return { logos, inlineSvg, images, colorCandidates, themeColor: theme ? theme.content : null, jsonLd, links, phones, emails, social };
})()`;

const PAGE_SCRIPT = `(() => {
  ${IMG_COLLECT}
  return { title: document.title, text: document.body.innerText.replace(/\\n{3,}/g, "\\n\\n").slice(0, 7000), images: __imgs };
})()`;

const PAGE_KEYWORDS = /about|service|what-we-do|our-work|project|gallery|portfolio|contact|testimonial|review|area|team|menu|treatment|price|pricing|faq|shop|product|collection|occasion|wedding|funeral|sympathy|catalog|range/i;

function pickSubpages(links: Array<{ href: string; text: string }>, limit = 8): string[] {
  const chosen: string[] = [];
  const seenKinds = new Set<string>();
  for (const l of links) {
    const key = (l.href + " " + l.text).toLowerCase();
    const m = key.match(PAGE_KEYWORDS);
    if (!m) continue;
    if (chosen.includes(l.href)) continue;
    // Allow a couple of service pages, but otherwise one page per kind.
    const kind = m[0];
    if (seenKinds.has(kind) && !/service|occasion|product|collection/.test(kind)) continue;
    seenKinds.add(kind);
    chosen.push(l.href);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

async function download(url: string, destNoExt: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0", Referer: new URL(url).origin },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png")
      ? "png"
      : type.includes("webp")
        ? "webp"
        : type.includes("svg")
          ? "svg"
          : type.includes("gif")
            ? "gif"
            : type.includes("avif")
              ? "avif"
              : type.includes("jpeg") || type.includes("jpg")
                ? "jpg"
                : null;
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024 || buf.length < 500) return null;
    const file = `${destNoExt}.${ext}`;
    fs.writeFileSync(file, buf);
    return path.basename(file);
  } catch {
    return null;
  }
}

export function assetsDirFor(businessId: number) {
  const dir = path.join(config.assetsDir, String(businessId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function extractSite(url: string, businessId: number): Promise<Extraction> {
  const ctx = await desktopContext();
  const dir = assetsDirFor(businessId);
  try {
    const page = await ctx.newPage();
    await gotoSettled(page, url);
    const home = (await page.evaluate(HOME_SCRIPT)) as {
      logos: Array<{ src: string; how: string; width: number; height: number }>;
      inlineSvg: { markup: string; width: number; height: number } | null;
      images: Array<{ src: string; alt: string; width: number; height: number; context: string }>;
      colorCandidates: Array<{ color: string; weight: number; where: string }>;
      themeColor: string | null;
      jsonLd: unknown[];
      links: Array<{ href: string; text: string }>;
      phones: string[];
      emails: string[];
      social: string[];
    };
    const homeText = (await page.evaluate(PAGE_SCRIPT)) as { title: string; text: string };
    const homepageShot = path.join("assets", String(businessId), "_home.jpg");
    await page.screenshot({ path: path.join(config.dataDir, homepageShot), type: "jpeg", quality: 70 });

    const pages = [{ url: page.url(), title: homeText.title, text: homeText.text }];
    const rawImages: Array<{ src: string; alt: string; width: number; height: number; context: string; page: string }> = home.images.map(
      (i) => ({ ...i, page: page.url() }),
    );
    const phones = new Set(home.phones);
    const emails = new Set(home.emails);

    for (const sub of pickSubpages(home.links)) {
      try {
        const p = await ctx.newPage();
        await gotoSettled(p, sub);
        const data = (await p.evaluate(PAGE_SCRIPT)) as {
          title: string;
          text: string;
          images: Array<{ src: string; alt: string; width: number; height: number; context: string }>;
        };
        pages.push({ url: p.url(), title: data.title, text: data.text });
        for (const img of data.images) rawImages.push({ ...img, page: p.url() });
        const extra = (await p.evaluate(HOME_SCRIPT).catch(() => null)) as { phones: string[]; emails: string[] } | null;
        extra?.phones.forEach((x) => phones.add(x));
        extra?.emails.forEach((x) => emails.add(x));
        await p.close();
      } catch {
        // Skip pages that fail to load.
      }
    }

    // De-duplicate images by URL (ignoring size query params) and keep the biggest 24.
    const byKey = new Map<string, (typeof rawImages)[number]>();
    for (const img of rawImages) {
      const key = img.src.replace(/[-_]\d+x\d+(?=\.\w+$)/, "").split("?")[0];
      const prev = byKey.get(key);
      if (!prev || img.width * img.height > prev.width * prev.height) byKey.set(key, img);
    }
    const sorted = [...byKey.values()].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 36);

    const images: ImageAsset[] = [];
    await Promise.all(
      sorted.map(async (img, i) => {
        // WordPress/Shopify serve resized copies (photo-400x536.jpg, _300x.jpg); try the original first.
        const original = img.src.replace(/-\d+x\d+(?=\.\w+(\?|$))/, "").replace(/_\d+x\d*(?=\.\w+(\?|$))/, "");
        const file =
          (original !== img.src ? await download(original, path.join(dir, `img-${i}`)) : null) ??
          (await download(img.src, path.join(dir, `img-${i}`)));
        images.push({ index: i, src: img.src, file, alt: img.alt, context: img.context, width: img.width, height: img.height, page: img.page });
      }),
    );
    images.sort((a, b) => a.index - b.index);

    const logos: LogoCandidate[] = [];
    if (home.inlineSvg) {
      fs.writeFileSync(path.join(dir, "logo-inline.svg"), home.inlineSvg.markup);
      logos.push({
        index: 0,
        src: "(inline svg)",
        file: "logo-inline.svg",
        how: "inline SVG in header",
        width: home.inlineSvg.width,
        height: home.inlineSvg.height,
      });
    }
    for (const l of home.logos.slice(0, 5)) {
      const index = logos.length;
      const file = await download(l.src, path.join(dir, `logo-${index}`));
      logos.push({ index, src: l.src, file, how: l.how, width: l.width, height: l.height });
    }

    return {
      sourceUrl: page.url(),
      pages,
      jsonLd: home.jsonLd,
      images: images.filter((i) => i.file),
      logos: logos.filter((l) => l.file),
      colorCandidates: home.colorCandidates,
      themeColor: home.themeColor,
      socialLinks: home.social,
      emails: [...emails],
      phones: [...phones],
      homepageShot,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}
