// Renders a sample florist plan in every style (no API calls) so you can eyeball the renderer.
// Usage: npm run templates   → data/template-previews/<style>-desktop.jpg / -mobile.jpg
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../src/lib/config";
import { renderPlan, type ImageMap } from "../src/lib/templates/render";
import { STYLES, type SitePlan } from "../src/lib/templates/plan";
import { desktopContext, mobileContext, closeBrowser } from "../src/lib/browser";

const out = path.join(config.dataDir, "template-previews");
fs.mkdirSync(path.join(out, "assets"), { recursive: true });
const lib = path.join(config.libraryDir, "florist");
const photos = fs.existsSync(lib) ? fs.readdirSync(lib).filter((f) => /\.jpe?g$/i.test(f)) : [];
const images: ImageMap = {};
photos.forEach((f, i) => {
  fs.copyFileSync(path.join(lib, f), path.join(out, "assets", f));
  images[`site:${i}`] = { file: `assets/${f}`, credit: null, stock: false };
});
const site = (i: number) => ({ source: "site" as const, site_index: photos[i] ? i : null, stock_query: null });
const none = { source: "none" as const, site_index: null, stock_query: null };

const plan: SitePlan = {
  thinking: { audience: "Locals buying flowers for occasions", primary_goal: "Call to order", design_direction: "Dawn-like boutique", avoid: "Loud colour" },
  style: "boutique",
  palette: {
    background: "#ffffff",
    surface: "#f7f4ef",
    text: "#1c1c1c",
    muted: "#6b6b6b",
    accent: "#2f4a3a",
    header_background: "#ffffff",
    header_text: "#1c1c1c",
    announcement_background: "#2f4a3a",
    announcement_text: "#ffffff",
  },
  fonts: { heading: "Playfair Display", body: "Assistant" },
  logo_index: null,
  announcement: "Flowers for every occasion, delivered promptly. Call Angie on 0421 709 437",
  hero: {
    variant: "full-bleed",
    eyebrow: null,
    headline: "Flowers made with love in Thomastown",
    subheadline: "Bouquets and arrangements for birthdays, weddings and farewells, tailored to your budget.",
    primary_cta: { label: "Call to order", action: "call" },
    secondary_cta: { label: "Shop by occasion", action: "shop" },
    image: site(1),
    collage: [],
  },
  trust_points: ["5.0★ from 38 Google reviews", "Tailored to your budget", "Prompt delivery"],
  sections: [
    {
      type: "categories",
      variant: "circles",
      heading: "Shop by occasion",
      subheading: null,
      body: null,
      items: ["Birthday", "Anniversary", "Thank you", "Get well", "New baby", "Sympathy"].map((t, i) => ({ title: t, text: null, meta: null, image: site(i % photos.length) })),
      image: none,
      cta: null,
    },
    {
      type: "products",
      variant: "grid",
      heading: "Recent arrangements",
      subheading: null,
      body: null,
      items: [2, 3, 4, 5, 6, 7, 8, 0].map((i, n) => ({ title: `Arrangement ${n + 1}`, text: null, meta: "Call to order", image: site(i) })),
      image: none,
      cta: { label: "Call to order", action: "call" },
    },
    {
      type: "feature",
      variant: "image-left",
      heading: "Wedding flowers",
      subheading: "Bridal bouquets, bridesmaids, buttonholes and reception.",
      body: "Come and talk to Angie about your day. Every wedding is made to order, around your colours and budget.",
      items: [],
      image: site(2),
      cta: { label: "Enquire about weddings", action: "contact" },
    },
    {
      type: "feature",
      variant: "image-right",
      heading: "Funeral & sympathy",
      subheading: null,
      body: "Funeral flowers receive our special attention, because we know it's a sensitive time.",
      items: [],
      image: site(5),
      cta: { label: "Call Angie", action: "call" },
    },
    {
      type: "testimonials",
      variant: "centered",
      heading: "Kind words",
      subheading: null,
      body: null,
      items: [
        { title: "", text: "Thank you for the absolutely gorgeous bouquet, I will definitely recommend you!", meta: "Loren", image: none },
        { title: "", text: "Gorgeous flowers, she loves them!!!", meta: "Chloe", image: none },
      ],
      image: none,
      cta: null,
    },
    { type: "contact", variant: "default", heading: "Order flowers", subheading: null, body: "Call or send a message and Angie will get back to you.", items: [], image: none, cta: null },
  ],
  business: {
    name: "Angies for Flowers",
    phone: "0421 709 437",
    email: null,
    address: "Thomastown VIC",
    show_address: false,
    hours: [],
    service_areas: [],
    social: [],
  },
  seo_title: "Angies for Flowers — Florist in Thomastown",
};

for (const style of STYLES) {
  const file = path.join(out, `${style}.html`);
  fs.writeFileSync(file, renderPlan({ ...plan, style }, images, { preparedBy: "Kris", rating: 5, reviewCount: 38, mapsUrl: null, logo: null }));
  for (const [fn, label, h] of [
    [desktopContext, "desktop", 4500],
    [mobileContext, "mobile", 3200],
  ] as const) {
    const ctx = await fn();
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.addStyleTag({ content: ".call-bar{display:none!important}" });
    await page.waitForTimeout(600);
    const sh = Number(await page.evaluate("document.documentElement.scrollHeight"));
    const sw = Number(await page.evaluate("document.documentElement.scrollWidth"));
    if (sw > page.viewportSize()!.width + 1) console.log(`!! ${style} ${label} horizontal overflow ${sw}`);
    await page.screenshot({
      path: path.join(out, `${style}-${label}.jpg`),
      type: "jpeg",
      quality: 70,
      fullPage: true,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: Math.min(sh, h) },
    });
    await ctx.close();
  }
  console.log("rendered", style);
}
await closeBrowser();
