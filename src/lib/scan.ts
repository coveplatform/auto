import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { desktopContext, mobileContext, gotoSettled } from "./browser";

export interface SiteMetrics {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  https: boolean;
  loadMs: number;
  title: string;
  metaDescription: string;
  hasViewportMeta: boolean;
  h1Count: number;
  wordCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  formCount: number;
  telLinks: number;
  emails: string[];
  ctas: string[];
  ctaAboveFoldDesktop: boolean;
  ctaAboveFoldMobile: boolean;
  copyrightYear: number | null;
  tech: string[];
  socialLinks: string[];
  mobileHorizontalOverflow: boolean;
  mobileSmallTextRatio: number;
  mobileTapTargetsTooSmall: number;
  consoleErrors: number;
  brokenLinks: string[];
  checkedLinks: number;
  visibleText: string;
}

export interface ScanResult {
  metrics: SiteMetrics;
  desktopShot: string; // relative to data dir
  mobileShot: string;
}

// Browser-side scripts are plain strings so the bundler/tsx can't inject helpers into them.
const COLLECT_SCRIPT = `(() => {
  const text = document.body ? document.body.innerText : "";
  const html = document.documentElement.outerHTML;
  const q = (s) => Array.from(document.querySelectorAll(s));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const ctaRe = /(call|quote|book|contact|enquir|get started|request|free quote|schedule|appointment|shop now)/i;
  const ctaEls = q("a, button, input[type=submit]").filter((el) => visible(el) && ctaRe.test((el.innerText || el.value || "").trim()) && (el.innerText || el.value || "").trim().length < 40);
  const ctas = Array.from(new Set(ctaEls.map((el) => (el.innerText || el.value).trim().replace(/\\s+/g, " ")))).slice(0, 12);
  const aboveFold = ctaEls.some((el) => el.getBoundingClientRect().top < window.innerHeight);
  const years = Array.from(text.matchAll(/(?:©|copyright|\\(c\\))\\s*(?:[^0-9]{0,20})?((?:19|20)\\d{2})(?:\\s*[-–]\\s*((?:19|20)\\d{2}))?/gi)).map((m) => Number(m[2] || m[1]));
  const tech = [];
  const gen = document.querySelector('meta[name="generator"]');
  if (gen && gen.content) tech.push("generator: " + gen.content);
  const checks = [
    [/wp-content|wp-includes/i, "WordPress"], [/wixstatic|wix\\.com/i, "Wix"], [/squarespace/i, "Squarespace"],
    [/cdn\\.shopify|myshopify/i, "Shopify"], [/weebly/i, "Weebly"], [/wsimg\\.com|godaddy/i, "GoDaddy Website Builder"],
    [/joomla/i, "Joomla"], [/drupal/i, "Drupal"], [/elementor/i, "Elementor"], [/et_pb_|themes.Divi/, "Divi"],
    [/webflow/i, "Webflow"], [/bootstrap(\\.min)?\\.css|class="[^"]*\\bcol-(xs|sm|md|lg)-/i, "Bootstrap"],
    [/\\.swf/i, "Flash (obsolete)"], [/jquery-1\\.|jquery\\/1\\./i, "jQuery 1.x (old)"], [/googletagmanager|gtag\\(/i, "Google Analytics/GTM"],
    [/fonts\\.googleapis/i, "Google Fonts"], [/recaptcha/i, "reCAPTCHA"], [/hotjar/i, "Hotjar"], [/facebook\\.net\\/.*fbevents/i, "Meta Pixel"]
  ];
  for (const [re, name] of checks) if (re.test(html)) tech.push(name);
  if (window.jQuery && window.jQuery.fn) tech.push("jQuery " + window.jQuery.fn.jquery);
  if (q("table table").length > 0) tech.push("Nested table layout (very old)");
  const origin = location.origin;
  const internal = Array.from(new Set(q("a[href]").map((a) => a.href).filter((h) => h.startsWith(origin) && !h.includes("#") && !/\\.(pdf|jpg|jpeg|png|gif|zip|docx?)$/i.test(h)))).slice(0, 40);
  const social = Array.from(new Set(q("a[href]").map((a) => a.href).filter((h) => /facebook\\.com|instagram\\.com|linkedin\\.com|youtube\\.com|tiktok\\.com|x\\.com|twitter\\.com/i.test(h)))).slice(0, 8);
  const emails = Array.from(new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || []).concat(q('a[href^="mailto:"]').map((a) => a.href.replace(/^mailto:/i, "").split("?")[0])))).map((e) => e.toLowerCase()).slice(0, 5);
  const imgs = q("img");
  return {
    title: document.title || "",
    metaDescription: (document.querySelector('meta[name="description"]') || {}).content || "",
    hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
    h1Count: q("h1").length,
    wordCount: text.split(/\\s+/).filter(Boolean).length,
    imageCount: imgs.length,
    imagesMissingAlt: imgs.filter((i) => !i.getAttribute("alt")).length,
    formCount: q("form").length,
    telLinks: q('a[href^="tel:"]').length,
    emails, ctas, aboveFold,
    copyrightYear: years.length ? Math.max(...years) : null,
    tech, social, internal,
    visibleText: text.replace(/\\n{3,}/g, "\\n\\n").slice(0, 6000)
  };
})()`;

const MOBILE_SCRIPT = `(() => {
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 5;
  let small = 0, total = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; let count = 0;
  while ((n = walker.nextNode()) && count < 3000) {
    count++;
    if (!n.textContent || n.textContent.trim().length < 3 || !n.parentElement) continue;
    const r = n.parentElement.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    total++;
    if (parseFloat(getComputedStyle(n.parentElement).fontSize) < 13) small++;
  }
  const taps = Array.from(document.querySelectorAll("a, button")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight * 3 && (r.height < 32 || r.width < 32);
  }).length;
  const ctaRe = /(call|quote|book|contact|enquir|get started|request|appointment)/i;
  const aboveFold = Array.from(document.querySelectorAll("a, button")).some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top < window.innerHeight && ctaRe.test(el.innerText || "");
  });
  return { overflow, smallRatio: total ? small / total : 0, taps, aboveFold };
})()`;

function normaliseUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

async function checkLinks(urls: string[]): Promise<string[]> {
  const broken: string[] = [];
  await Promise.all(
    urls.slice(0, 15).map(async (u) => {
      try {
        const ctrl = AbortSignal.timeout(10000);
        let res = await fetch(u, { method: "HEAD", redirect: "follow", signal: ctrl });
        if (res.status === 405 || res.status === 403) {
          res = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000) });
        }
        if (res.status >= 400) broken.push(`${u} (${res.status})`);
      } catch {
        broken.push(`${u} (unreachable)`);
      }
    }),
  );
  return broken;
}

async function shoot(page: import("playwright").Page, file: string, maxHeight: number) {
  const height = await page.evaluate("document.documentElement.scrollHeight").catch(() => 900);
  const width = page.viewportSize()?.width ?? 1440;
  await page.screenshot({
    path: file,
    type: "jpeg",
    quality: 72,
    fullPage: true,
    clip: { x: 0, y: 0, width, height: Math.min(Number(height) || 900, maxHeight) },
  });
}

export async function scanWebsite(url: string, businessId: number): Promise<ScanResult> {
  const requestedUrl = normaliseUrl(url);
  const desktopRel = path.join("shots", `${businessId}-desktop.jpg`);
  const mobileRel = path.join("shots", `${businessId}-mobile.jpg`);

  const dctx = await desktopContext();
  const mctx = await mobileContext();
  try {
    const page = await dctx.newPage();
    let consoleErrors = 0;
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors++;
    });
    const { response, loadMs } = await gotoSettled(page, requestedUrl);
    const collected = (await page.evaluate(COLLECT_SCRIPT)) as {
      title: string;
      metaDescription: string;
      hasViewportMeta: boolean;
      h1Count: number;
      wordCount: number;
      imageCount: number;
      imagesMissingAlt: number;
      formCount: number;
      telLinks: number;
      emails: string[];
      ctas: string[];
      aboveFold: boolean;
      copyrightYear: number | null;
      tech: string[];
      social: string[];
      internal: string[];
      visibleText: string;
    };
    await shoot(page, path.join(config.dataDir, desktopRel), 2400);

    const mpage = await mctx.newPage();
    await gotoSettled(mpage, page.url());
    const mobile = (await mpage.evaluate(MOBILE_SCRIPT)) as {
      overflow: boolean;
      smallRatio: number;
      taps: number;
      aboveFold: boolean;
    };
    await shoot(mpage, path.join(config.dataDir, mobileRel), 1800);

    const brokenLinks = await checkLinks(collected.internal);

    const finalUrl = page.url();
    return {
      desktopShot: desktopRel,
      mobileShot: mobileRel,
      metrics: {
        requestedUrl,
        finalUrl,
        httpStatus: response?.status() ?? null,
        https: finalUrl.startsWith("https://"),
        loadMs,
        title: collected.title,
        metaDescription: collected.metaDescription,
        hasViewportMeta: collected.hasViewportMeta,
        h1Count: collected.h1Count,
        wordCount: collected.wordCount,
        imageCount: collected.imageCount,
        imagesMissingAlt: collected.imagesMissingAlt,
        formCount: collected.formCount,
        telLinks: collected.telLinks,
        emails: collected.emails,
        ctas: collected.ctas,
        ctaAboveFoldDesktop: collected.aboveFold,
        ctaAboveFoldMobile: mobile.aboveFold,
        copyrightYear: collected.copyrightYear,
        tech: collected.tech,
        socialLinks: collected.social,
        mobileHorizontalOverflow: mobile.overflow,
        mobileSmallTextRatio: Math.round(mobile.smallRatio * 100) / 100,
        mobileTapTargetsTooSmall: mobile.taps,
        consoleErrors,
        brokenLinks,
        checkedLinks: Math.min(collected.internal.length, 15),
        visibleText: collected.visibleText,
      },
    };
  } finally {
    await dctx.close().catch(() => {});
    await mctx.close().catch(() => {});
  }
}

// ---------- PageSpeed Insights ----------

export interface PageSpeedResult {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
}

export async function runPageSpeed(url: string): Promise<PageSpeedResult | null> {
  if (!config.runPagespeed) return null;
  const params = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["performance", "accessibility", "seo", "best-practices"]) params.append("category", c);
  if (config.pagespeedApiKey) params.set("key", config.pagespeedApiKey);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories: Record<string, { score: number | null }>;
        audits: Record<string, { numericValue?: number }>;
      };
    };
    const lh = data.lighthouseResult;
    if (!lh) return null;
    const cat = (k: string) => (lh.categories[k]?.score == null ? null : Math.round(lh.categories[k].score! * 100));
    return {
      performance: cat("performance"),
      accessibility: cat("accessibility"),
      seo: cat("seo"),
      bestPractices: cat("best-practices"),
      lcpMs: lh.audits["largest-contentful-paint"]?.numericValue ?? null,
      cls: lh.audits["cumulative-layout-shift"]?.numericValue ?? null,
      tbtMs: lh.audits["total-blocking-time"]?.numericValue ?? null,
    };
  } catch {
    return null;
  }
}

// ---------- Optional: Wappalyzer API ----------

export async function wappalyzerLookup(url: string): Promise<string[]> {
  if (!config.wappalyzerApiKey) return [];
  try {
    const res = await fetch(`https://api.wappalyzer.com/v2/lookup/?urls=${encodeURIComponent(url)}`, {
      headers: { "x-api-key": config.wappalyzerApiKey },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ technologies?: Array<{ name: string; versions?: string[] }> }>;
    return (data[0]?.technologies ?? []).map((t) => (t.versions?.length ? `${t.name} ${t.versions[0]}` : t.name));
  } catch {
    return [];
  }
}

export function readShotBase64(rel: string): string {
  return fs.readFileSync(path.join(config.dataDir, rel)).toString("base64");
}
