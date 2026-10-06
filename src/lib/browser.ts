import { chromium, type Browser, type BrowserContext } from "playwright";
import { config } from "./config";

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const channel = config.browserChannel === "chromium" ? undefined : config.browserChannel;
      try {
        return await chromium.launch({ channel, headless: true });
      } catch (err) {
        if (!channel) throw err;
        // Fall back to Playwright's bundled Chromium if the system browser isn't available.
        return await chromium.launch({ headless: true });
      }
    })();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function desktopContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA_DESKTOP,
    ignoreHTTPSErrors: true,
    locale: "en-AU",
  });
}

export async function mobileContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: UA_MOBILE,
    ignoreHTTPSErrors: true,
    locale: "en-AU",
  });
}

/** Navigate and give late-loading content a moment, without hanging on chatty sites. */
export async function gotoSettled(page: import("playwright").Page, url: string) {
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  // Trigger lazy-loaded images.
  await page
    .evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight && y < 6000; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(400);
  return { response, loadMs: Date.now() - started };
}
