import type { ImageRef, ResolvedImage, Section, SitePlan, StyleId } from "./plan";

/**
 * Renders a SitePlan to one self-contained static HTML page.
 * Design system: palette + fonts come from the plan; a "style" sets shape and rhythm;
 * every section has a few layout variants and degrades gracefully without photos.
 */

export interface RenderMeta {
  preparedBy: string;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  logo: string | null; // relative path to logo file
}

/** slot key ("site:3" or "stock:<slot>") -> resolved file */
export type ImageMap = Record<string, ResolvedImage>;

// ---------- utils ----------

export const esc = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const HEX = /^#[0-9a-f]{6}$/i;
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export function mix(a: string, b: string, t: number) {
  const A = rgb(a);
  const B = rgb(b);
  return "#" + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, "0")).join("");
}
const inkOn = (bg: string) => (contrast(bg, "#111111") >= contrast(bg, "#ffffff") ? "#111111" : "#ffffff");
/** Push `fg` darker/lighter until it reaches `min` contrast on `bg`. */
function ensure(fg: string, bg: string, min: number) {
  let c = fg;
  const toward = lum(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.12);
  return c;
}

const ICON = {
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
};

// ---------- styles ----------

interface StyleTokens {
  radius: string;
  btnRadius: string;
  headWeight: number;
  headTracking: string;
  titleAlign: "center" | "left";
  sectionPad: string;
  headScale: number;
  upperButtons: boolean;
  css: string;
}

const STYLE: Record<StyleId, StyleTokens> = {
  boutique: {
    radius: "0px",
    btnRadius: "0px",
    headWeight: 400,
    headTracking: "0",
    titleAlign: "center",
    sectionPad: "72px",
    headScale: 1,
    upperButtons: false,
    css: `.btn{letter-spacing:.06em;font-size:.95rem}.site-header{border-bottom:1px solid var(--line)}.product .p-media{background:var(--surface)}`,
  },
  bold: {
    radius: "6px",
    btnRadius: "6px",
    headWeight: 800,
    headTracking: "-0.03em",
    titleAlign: "left",
    sectionPad: "88px",
    headScale: 1.05,
    upperButtons: false,
    css: `.section-title h2:before{content:"";display:block;width:48px;height:4px;background:var(--accent);margin-bottom:16px}.section-title.center h2:before{margin-inline:auto}`,
  },
  clean: {
    radius: "16px",
    btnRadius: "12px",
    headWeight: 700,
    headTracking: "-0.02em",
    titleAlign: "left",
    sectionPad: "84px",
    headScale: 1,
    upperButtons: false,
    css: `.card,.tile,.product .p-media img,.feature-media img{border-radius:var(--radius)}.card{box-shadow:0 1px 2px rgba(0,0,0,.04)}`,
  },
  editorial: {
    radius: "2px",
    btnRadius: "0px",
    headWeight: 400,
    headTracking: "-0.01em",
    titleAlign: "left",
    sectionPad: "96px",
    headScale: 1.08,
    upperButtons: true,
    css: `.btn{font-size:.82rem;letter-spacing:.14em}.section{border-top:1px solid var(--line)}.eyebrow{letter-spacing:.2em}`,
  },
  soft: {
    radius: "24px",
    btnRadius: "999px",
    headWeight: 400,
    headTracking: "-0.01em",
    titleAlign: "center",
    sectionPad: "84px",
    headScale: 1.04,
    upperButtons: false,
    css: `.hero-split .hero-media img{border-radius:999px 999px 24px 24px}.card,.tile,.product .p-media img,.feature-media img{border-radius:var(--radius)}`,
  },
  warm: {
    radius: "4px",
    btnRadius: "2px",
    headWeight: 500,
    headTracking: "-0.01em",
    titleAlign: "center",
    sectionPad: "88px",
    headScale: 1.1,
    upperButtons: true,
    css: `.btn{font-size:.82rem;letter-spacing:.16em}`,
  },
};

// ---------- rendering context ----------

interface Ctx {
  plan: SitePlan;
  images: ImageMap;
  meta: RenderMeta;
  tel: string | null;
  shopAnchor: string;
}

function img(ctx: Ctx, ref: ImageRef, slot: string): ResolvedImage | undefined {
  if (ref.source === "site" && ref.site_index !== null) return ctx.images[`site:${ref.site_index}`];
  if (ref.source === "stock" && ref.stock_query) return ctx.images[`stock:${slot}`];
  return undefined;
}

function ctaHref(ctx: Ctx, action: string): string {
  switch (action) {
    case "call":
      return ctx.tel ?? "#contact";
    case "shop":
      return ctx.shopAnchor;
    case "directions":
      return ctx.meta.mapsUrl ?? "#contact";
    default:
      return "#contact";
  }
}

function button(ctx: Ctx, cta: { label: string; action: string } | null, cls = "btn-primary") {
  if (!cta) return "";
  const href = ctaHref(ctx, cta.action);
  const icon = href.startsWith("tel:") ? ICON.phone : "";
  return `<a class="btn ${cls}" href="${esc(href)}">${icon}<span>${esc(cta.label)}</span></a>`;
}

function stars(r: number) {
  return `<span class="stars">${Array.from({ length: 5 }, (_, i) => (i < Math.round(r) ? ICON.star : "")).join("")}</span>`;
}

function title(ctx: Ctx, s: { heading: string; subheading: string | null }, alignOverride?: "center" | "left") {
  const align = alignOverride ?? STYLE[ctx.plan.style].titleAlign;
  return `<div class="section-title ${align}"><h2>${esc(s.heading)}</h2>${s.subheading ? `<p>${esc(s.subheading)}</p>` : ""}</div>`;
}

// ---------- sections ----------

function hero(ctx: Ctx): string {
  const h = ctx.plan.hero;
  const main = img(ctx, h.image, "hero");
  const collage = h.collage.map((r, i) => img(ctx, r, `hero.collage.${i}`)).filter(Boolean) as ResolvedImage[];
  let variant = h.variant;
  if ((variant === "full-bleed" || variant === "split") && !main) variant = "centered";
  if (variant === "collage" && !main && collage.length < 2) variant = "centered";

  const eyebrow = h.eyebrow ? `<div class="eyebrow">${esc(h.eyebrow)}</div>` : "";
  const rating =
    ctx.meta.rating && ctx.meta.reviewCount && ctx.meta.rating >= 4.3
      ? `<div class="rating">${stars(ctx.meta.rating)}<span>${ctx.meta.rating.toFixed(1)} from ${ctx.meta.reviewCount} Google reviews</span></div>`
      : "";
  const copy = (light: boolean) => `${eyebrow}<h1>${esc(h.headline)}</h1><p class="lede">${esc(h.subheadline)}</p>
    <div class="actions">${button(ctx, h.primary_cta, light ? "btn-light" : "btn-primary")}${button(ctx, h.secondary_cta, light ? "btn-outline-light" : "btn-outline")}</div>${rating}`;

  if (variant === "full-bleed") {
    return `<section class="hero hero-full" id="top"><img class="hero-bg" src="${esc(main!.file)}" alt=""><div class="hero-shade"></div>
      <div class="wrap hero-inner">${copy(true)}</div></section>`;
  }
  if (variant === "split") {
    return `<section class="hero hero-split" id="top"><div class="wrap hero-grid"><div class="hero-copy">${copy(false)}</div>
      <div class="hero-media"><img src="${esc(main!.file)}" alt=""></div></div></section>`;
  }
  if (variant === "collage") {
    const pics = [main, ...collage].filter(Boolean).slice(0, 3) as ResolvedImage[];
    return `<section class="hero hero-split hero-collage" id="top"><div class="wrap hero-grid"><div class="hero-copy">${copy(false)}</div>
      <div class="collage c${pics.length}">${pics.map((p) => `<img src="${esc(p.file)}" alt="">`).join("")}</div></div></section>`;
  }
  return `<section class="hero hero-centered" id="top"><div class="wrap hero-inner">${copy(false)}</div></section>`;
}

function trust(ctx: Ctx) {
  const t = ctx.plan.trust_points.slice(0, 4);
  if (!t.length) return "";
  return `<div class="trust"><div class="wrap trust-inner">${t.map((p) => `<div class="trust-item">${ICON.check}<span>${esc(p)}</span></div>`).join("")}</div></div>`;
}

function categories(ctx: Ctx, s: Section, si: number) {
  const items = s.items.map((it, ii) => ({ it, pic: img(ctx, it.image, `s${si}.item${ii}`) }));
  const withPics = items.filter((x) => x.pic).length;
  const variant = s.variant === "circles" && withPics >= Math.ceil(items.length * 0.75) ? "circles" : withPics ? "tiles" : "text";
  if (variant === "circles") {
    return `${title(ctx, s)}<div class="circles">${items
      .map(
        ({ it, pic }) => `<a class="circle" href="#contact"><span class="circle-img">${pic ? `<img src="${esc(pic.file)}" alt="">` : ""}</span>
        <strong>${esc(it.title)}</strong>${it.meta ? `<small>${esc(it.meta)}</small>` : ""}</a>`,
      )
      .join("")}</div>`;
  }
  if (variant === "tiles") {
    return `${title(ctx, s)}<div class="tiles n${Math.min(items.length, 4)}">${items
      .map(
        ({ it, pic }) => `<a class="tile-card" href="#contact"><span class="tile ${pic ? "" : "tile-plain"}">${pic ? `<img src="${esc(pic.file)}" alt="">` : ""}
        <span class="tile-label"><strong>${esc(it.title)}</strong></span></span>${it.text ? `<small class="tile-text">${esc(it.text)}</small>` : ""}</a>`,
      )
      .join("")}</div>`;
  }
  return services(ctx, { ...s, variant: "cards" }, si);
}

function products(ctx: Ctx, s: Section, si: number) {
  const items = s.items.map((it, ii) => ({ it, pic: img(ctx, it.image, `s${si}.item${ii}`) })).filter((x) => x.pic);
  if (items.length < 2) return "";
  return `${title(ctx, s)}<div class="products">${items
    .slice(0, 8)
    .map(
      ({ it, pic }) => `<a class="product" href="#contact"><div class="p-media"><img src="${esc(pic!.file)}" alt="${esc(it.title)}"></div>
      <div class="p-title">${esc(it.title)}</div>${it.meta ? `<div class="p-meta">${esc(it.meta)}</div>` : ""}</a>`,
    )
    .join("")}</div>${s.cta ? `<div class="center-cta">${button(ctx, s.cta, "btn-primary")}</div>` : ""}`;
}

function services(ctx: Ctx, s: Section, si: number) {
  const items = s.items.map((it, ii) => ({ it, pic: img(ctx, it.image, `s${si}.item${ii}`) }));
  if (s.variant === "list" && items.some(({ it }) => it.meta)) {
    // Priced items read like a printed menu: name ..... price, description underneath.
    return `${title(ctx, s)}${s.body ? `<p class="body menu-intro">${esc(s.body)}</p>` : ""}<div class="menu">${items
      .map(
        ({ it }) => `<div class="menu-item"><div class="menu-row"><strong>${esc(it.title)}</strong><span class="menu-dots"></span>${it.meta ? `<span class="menu-price">${esc(it.meta)}</span>` : ""}</div>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`,
      )
      .join("")}</div>`;
  }
  if (s.variant === "list") {
    return `<div class="split-head">${title(ctx, s, "left")}${s.body ? `<p class="body">${esc(s.body)}</p>` : ""}</div>
      <ul class="svc-list">${items.map(({ it }) => `<li>${ICON.check}<div><strong>${esc(it.title)}</strong>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div></li>`).join("")}</ul>`;
  }
  if (s.variant === "numbered") {
    return `${title(ctx, s)}<div class="numbered">${items
      .map(({ it }, i) => `<div class="num-item"><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`)
      .join("")}</div>`;
  }
  return `${title(ctx, s)}<div class="cards n${items.length === 4 ? 4 : Math.min(items.length, 3)}">${items
    .map(
      ({ it, pic }) => `<article class="card">${pic ? `<img src="${esc(pic.file)}" alt="${esc(it.title)}">` : ""}<div class="card-body">
      <h3>${esc(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}${it.meta ? `<div class="p-meta">${esc(it.meta)}</div>` : ""}</div></article>`,
    )
    .join("")}</div>`;
}

function feature(ctx: Ctx, s: Section, si: number) {
  const pic = img(ctx, s.image, `s${si}.image`);
  // Items with values (hours, prices) render as a tidy table; plain items as a checklist.
  const highlights = !s.items.length
    ? ""
    : s.items.some((it) => it.meta)
      ? `<table class="info-table">${s.items.map((it) => `<tr><td>${esc(it.title)}${it.text ? `<small>${esc(it.text)}</small>` : ""}</td><td>${esc(it.meta ?? "")}</td></tr>`).join("")}</table>`
      : `<ul class="highlights">${s.items.map((it) => `<li>${ICON.check}<span>${esc(it.title)}</span></li>`).join("")}</ul>`;
  const copy = `<div class="feature-copy"><h2>${esc(s.heading)}</h2>${s.subheading ? `<p class="sub">${esc(s.subheading)}</p>` : ""}
    ${s.body ? `<p class="body">${esc(s.body)}</p>` : ""}${highlights}${s.cta ? `<div class="actions">${button(ctx, s.cta, "btn-outline")}</div>` : ""}</div>`;
  if (!pic || s.variant === "centered") return `<div class="feature-centered">${copy}</div>`;
  return `<div class="feature ${s.variant === "image-right" ? "img-right" : ""}"><div class="feature-media"><img src="${esc(pic.file)}" alt=""></div>${copy}</div>`;
}

function testimonials(ctx: Ctx, s: Section) {
  if (!s.items.length) return "";
  const r = ctx.meta;
  const sub = r.rating && r.reviewCount ? `${r.rating.toFixed(1)} average from ${r.reviewCount} Google reviews` : s.subheading;
  if (s.variant === "centered" || s.items.length === 1) {
    const t = s.items[0];
    return `<div class="quote-centered">${r.rating ? stars(r.rating) : ""}<blockquote>“${esc(t.text ?? t.title)}”</blockquote><cite>${esc(t.meta ?? "")}</cite>
      ${s.items.length > 1 ? `<div class="quote-more">${s.items.slice(1, 4).map((x) => `<p>“${esc(x.text ?? x.title)}” <cite>— ${esc(x.meta ?? "")}</cite></p>`).join("")}</div>` : ""}</div>`;
  }
  return `${title(ctx, { heading: s.heading, subheading: sub })}<div class="quotes">${s.items
    .slice(0, 3)
    .map((t) => `<figure class="quote">${r.rating ? stars(5) : ""}<blockquote>“${esc(t.text ?? t.title)}”</blockquote><figcaption>${esc(t.meta ?? "")}</figcaption></figure>`)
    .join("")}</div>`;
}

function gallery(ctx: Ctx, s: Section, si: number) {
  const pics = s.items.map((it, ii) => img(ctx, it.image, `s${si}.item${ii}`)).filter(Boolean) as ResolvedImage[];
  if (pics.length < 3) return "";
  return `${title(ctx, s)}<div class="gallery">${pics.slice(0, 8).map((p) => `<img src="${esc(p.file)}" alt="">`).join("")}</div>`;
}

function areas(ctx: Ctx, s: Section) {
  const list = s.items.length ? s.items.map((i) => i.title) : ctx.plan.business.service_areas;
  if (!list.length) return "";
  return `${title(ctx, s)}<div class="chips ${STYLE[ctx.plan.style].titleAlign}">${list.map((a) => `<span class="chip">${ICON.pin}${esc(a)}</span>`).join("")}</div>`;
}

function steps(ctx: Ctx, s: Section) {
  return `${title(ctx, s)}<div class="steps n${Math.min(s.items.length, 4)}">${s.items
    .map((it, i) => `<div class="step"><span class="num">${i + 1}</span><h3>${esc(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>`)
    .join("")}</div>`;
}

function faq(ctx: Ctx, s: Section) {
  return `${title(ctx, s)}<div class="faq">${s.items
    .map((it) => `<details><summary>${esc(it.title)}${ICON.plus}</summary><p>${esc(it.text ?? "")}</p></details>`)
    .join("")}</div>`;
}

function contact(ctx: Ctx, s: Section) {
  const b = ctx.plan.business;
  return `<div class="contact">
    <div>${title(ctx, s, "left")}${s.body ? `<p class="body">${esc(s.body)}</p>` : ""}
      <ul class="contact-list">
        ${b.phone ? `<li>${ICON.phone}<div><span>Phone</span><a href="${esc(ctx.tel ?? "#")}">${esc(b.phone)}</a></div></li>` : ""}
        ${b.email ? `<li>${ICON.mail}<div><span>Email</span><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div></li>` : ""}
        ${b.address && b.show_address ? `<li>${ICON.pin}<div><span>Visit</span>${ctx.meta.mapsUrl ? `<a href="${esc(ctx.meta.mapsUrl)}" target="_blank" rel="noopener">${esc(b.address)}</a>` : esc(b.address)}</div></li>` : ""}
      </ul>
      ${b.hours.length ? `<div class="hours"><div class="hours-title">${ICON.clock}<span>Opening hours</span></div><table>${b.hours.map((h) => `<tr><td>${esc(h.days)}</td><td>${esc(h.hours)}</td></tr>`).join("")}</table></div>` : ""}
    </div>
    <form class="enquiry" onsubmit="event.preventDefault();this.querySelector('.note').hidden=false">
      <h3>Send an enquiry</h3>
      <label>Name<input name="name" autocomplete="name"></label>
      <div class="row"><label>Phone<input name="phone" autocomplete="tel"></label><label>Email<input name="email" type="email" autocomplete="email"></label></div>
      <label>Message<textarea name="message" rows="4"></textarea></label>
      <button class="btn btn-primary" type="submit">Send enquiry</button>
      <p class="note" hidden>This is a design preview, so the form isn't connected yet.</p>
    </form></div>`;
}

function ctaBand(ctx: Ctx, s: Section) {
  return `<div class="band-inner"><div><h2>${esc(s.heading)}</h2>${s.body ? `<p>${esc(s.body)}</p>` : ""}</div>${button(ctx, s.cta ?? { label: ctx.plan.hero.primary_cta.label, action: ctx.plan.hero.primary_cta.action }, "btn-light")}</div>`;
}

function renderSection(ctx: Ctx, s: Section, si: number): string {
  const id = s.type === "contact" ? "contact" : `s${si}`;
  let inner = "";
  switch (s.type) {
    case "categories":
      inner = categories(ctx, s, si);
      break;
    case "products":
      inner = products(ctx, s, si);
      break;
    case "services":
      inner = services(ctx, s, si);
      break;
    case "feature":
    case "about":
      inner = feature(ctx, s, si);
      break;
    case "testimonials":
      inner = testimonials(ctx, s);
      break;
    case "gallery":
      inner = gallery(ctx, s, si);
      break;
    case "areas":
      inner = areas(ctx, s);
      break;
    case "steps":
      inner = steps(ctx, s);
      break;
    case "faq":
      inner = faq(ctx, s);
      break;
    case "contact":
      inner = contact(ctx, s);
      break;
    case "cta_band":
      return `<section class="band" id="${id}">${ctaBand(ctx, s)}</section>`;
  }
  if (!inner) return "";
  const alt = ["testimonials", "about", "areas"].includes(s.type) ? " alt" : "";
  return `<section class="section sec-${s.type}${alt}" id="${id}"><div class="wrap">${inner}</div></section>`;
}

const NAV_LABEL: Partial<Record<Section["type"], string>> = {
  categories: "Shop",
  products: "Shop",
  services: "Services",
  about: "About",
  testimonials: "Reviews",
  gallery: "Gallery",
  faq: "FAQ",
  contact: "Contact",
};

// ---------- page ----------

const BASE_CSS = `
*,*:before,*:after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font-body);color:var(--text);background:var(--bg);font-size:16.5px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block;max-width:100%}
a{color:inherit}
h1,h2,h3{font-family:var(--font-head);font-weight:var(--head-weight);letter-spacing:var(--head-tracking);line-height:1.12;margin:0;color:var(--text)}
p{margin:0}
.wrap{max-width:1200px;margin:0 auto;padding:0 32px}
.concept-bar{background:#0b0b0c;color:#d4d4d8;font:500 12px/1.4 system-ui,sans-serif;text-align:center;padding:7px 16px}
.concept-bar strong{color:#fff}
.announce{background:var(--ann-bg);color:var(--ann-text);text-align:center;font-size:.88rem;padding:9px 16px}
.site-header{background:var(--header-bg);color:var(--header-text);position:sticky;top:0;z-index:30}
.header-inner{display:flex;align-items:center;gap:36px;height:78px}
.brand{text-decoration:none;display:flex;align-items:center;margin-right:auto}
.brand img{max-height:52px;max-width:210px;width:auto;object-fit:contain}
.wordmark{font-family:var(--font-head);font-size:1.45rem;font-weight:var(--head-weight);letter-spacing:var(--head-tracking)}
.nav{display:flex;gap:28px}
.nav a{text-decoration:none;font-size:.95rem;opacity:.85}
.nav a:hover{opacity:1;text-decoration:underline;text-underline-offset:6px}
.header-call{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600;font-size:.95rem}
.header-call svg{width:18px;height:18px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:15px 28px;border-radius:var(--btn-radius);text-decoration:none;font-weight:600;border:1.5px solid transparent;cursor:pointer;font-family:var(--font-body);font-size:1rem;transition:transform .15s,background .15s,color .15s;text-transform:var(--btn-case)}
.btn svg{width:17px;height:17px}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-outline{border-color:var(--text);color:var(--text);background:transparent}
.btn-outline:hover{background:var(--text);color:var(--bg)}
.btn-light{background:#fff;color:#111}
.btn-outline-light{border-color:rgba(255,255,255,.85);color:#fff}
.btn-outline-light:hover{background:#fff;color:#111}
.actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:30px}
.eyebrow{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-bottom:16px;opacity:.85}
.lede{font-size:1.15rem;margin-top:18px;max-width:46ch;opacity:.9}
.rating{display:flex;align-items:center;gap:10px;margin-top:26px;font-size:.92rem;opacity:.9}
.stars{display:inline-flex;gap:2px;color:#e0a93b}
.stars svg{width:15px;height:15px}
.hero h1{font-size:calc(clamp(2.5rem,5.2vw,4.4rem) * var(--head-scale))}
.hero-full{position:relative;min-height:min(78vh,720px);display:flex;align-items:center;color:#fff;overflow:hidden}
.hero-full h1{color:#fff;max-width:16ch;margin:0 auto}
.hero-full .hero-inner{position:relative;z-index:2;text-align:center;padding:96px 32px;width:100%}
.hero-full .lede{margin-inline:auto}
.hero-full .actions,.hero-full .rating{justify-content:center}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.45))}
.hero-split{background:var(--bg)}
.hero-grid{display:grid;grid-template-columns:1.05fr 1fr;gap:64px;align-items:center;padding-block:72px}
.hero-media img{width:100%;aspect-ratio:4/4.4;object-fit:cover;border-radius:var(--radius)}
.collage{display:grid;gap:14px;grid-template-columns:1fr 1fr;grid-template-rows:240px 240px}
.collage img{width:100%;height:100%;object-fit:cover;border-radius:var(--radius)}
.collage.c3 img:first-child{grid-row:span 2}
.collage.c2 img{grid-row:span 2}
.hero-centered{background:var(--surface);text-align:center}
.hero-centered .hero-inner{padding:120px 32px 112px;max-width:900px}
.hero-centered h1{margin:0 auto;max-width:18ch}
.hero-centered .lede{margin-inline:auto}
.hero-centered .actions,.hero-centered .rating{justify-content:center}
.trust{border-bottom:1px solid var(--line);background:var(--bg)}
.trust-inner{display:flex;flex-wrap:wrap;justify-content:center;gap:14px 40px;padding:20px 32px;font-size:.93rem}
.trust-item{display:flex;align-items:center;gap:10px}
.trust-item svg{width:18px;height:18px;color:var(--accent-text);flex:none}
.section{padding:var(--section-pad) 0}
.section.alt{background:var(--surface)}
.section-title{margin-bottom:44px}
.section-title.center{text-align:center}
.section-title.center p{margin-inline:auto}
.section-title h2{font-size:calc(clamp(1.9rem,3.2vw,2.6rem) * var(--head-scale))}
.section-title p{margin-top:12px;color:var(--muted);max-width:60ch;font-size:1.05rem}
.circles{display:flex;gap:28px;justify-content:center;flex-wrap:wrap}
.circle{text-decoration:none;text-align:center;width:128px;display:grid;gap:4px;justify-items:center}
.circle-img{width:128px;height:128px;border-radius:50%;overflow:hidden;background:var(--surface);margin-bottom:10px;display:block}
.circle-img img{width:100%;height:100%;object-fit:cover;transition:transform .4s}
.circle:hover img{transform:scale(1.06)}
.circle strong{font-weight:500}
.circle small{color:var(--muted);font-size:.85rem}
.tiles{display:grid;gap:16px;grid-template-columns:repeat(4,1fr)}
.tiles.n2{grid-template-columns:repeat(2,1fr)}.tiles.n3{grid-template-columns:repeat(3,1fr)}
.tile{position:relative;display:block;aspect-ratio:3/4;overflow:hidden;text-decoration:none;color:#fff;background:var(--surface)}
.tile img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.tile:hover img{transform:scale(1.05)}
.tile:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(0,0,0,.5))}
.tile-label{position:absolute;left:22px;right:22px;bottom:20px;z-index:2;display:grid;gap:2px}
.tile-label strong{font-family:var(--font-head);font-size:1.45rem;font-weight:var(--head-weight)}
.tile-card{text-decoration:none;display:grid;gap:10px;align-content:start}
.tile-text{color:var(--muted);font-size:.92rem;line-height:1.45}
.tile-plain{color:var(--text);aspect-ratio:auto;min-height:180px;border:1px solid var(--line)}
.tile-plain:after{display:none}
.products{display:grid;grid-template-columns:repeat(4,1fr);gap:28px 20px}
.product{text-decoration:none}
.p-media{aspect-ratio:3/4;overflow:hidden;margin-bottom:14px}
.p-media img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.product:hover img{transform:scale(1.04)}
.p-title{font-size:1rem}
.p-meta{color:var(--muted);font-size:.92rem;margin-top:2px}
.center-cta{text-align:center;margin-top:44px}
.cards{display:grid;gap:22px;grid-template-columns:repeat(3,1fr)}
.cards.n2{grid-template-columns:repeat(2,1fr)}
.cards.n4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--bg);border:1px solid var(--line);overflow:hidden;display:flex;flex-direction:column}
.section.alt .card{background:var(--bg)}
.card img{width:100%;aspect-ratio:16/10;object-fit:cover}
.card-body{padding:26px}
.card h3{font-size:1.3rem;margin-bottom:8px}
.card p{color:var(--muted);font-size:.98rem}
.split-head{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:end;margin-bottom:36px}
.split-head .section-title{margin:0}
.svc-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 48px}
.svc-list li{display:flex;gap:14px;padding:20px 0;border-top:1px solid var(--line)}
.svc-list svg{width:20px;height:20px;color:var(--accent-text);flex:none;margin-top:3px}
.svc-list p{color:var(--muted);font-size:.95rem}
.menu{display:grid;grid-template-columns:1fr 1fr;gap:6px 64px;max-width:1040px;margin:0 auto}
.menu-intro{text-align:center;color:var(--muted);margin:-28px auto 36px;max-width:60ch}
.menu-item{padding:16px 0;border-bottom:1px solid var(--line)}
.menu-row{display:flex;align-items:baseline;gap:10px}
.menu-row strong{font-family:var(--font-head);font-weight:var(--head-weight);font-size:1.15rem}
.menu-dots{flex:1;border-bottom:1px dotted var(--line);transform:translateY(-4px)}
.menu-price{color:var(--accent-text);font-weight:600;white-space:nowrap}
.menu-item p{color:var(--muted);font-size:.93rem;margin-top:4px}
.numbered{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid var(--line)}
.num-item{padding:32px 32px 32px 0;border-bottom:1px solid var(--line)}
.num-item:nth-child(even){padding-left:32px;border-left:1px solid var(--line)}
.num{font-size:.8rem;letter-spacing:.14em;color:var(--accent-text);font-weight:600}
.num-item h3{font-size:1.35rem;margin:8px 0}
.num-item p{color:var(--muted)}
.feature{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center}
.feature.img-right .feature-media{order:2}
.feature-media img{width:100%;aspect-ratio:4/4.6;object-fit:cover}
.feature-copy h2{font-size:calc(clamp(1.9rem,3vw,2.5rem) * var(--head-scale))}
.feature-copy .sub{color:var(--muted);margin-top:10px;font-size:1.05rem}
.feature-copy .body{margin-top:20px;font-size:1.06rem;opacity:.9}
.feature-centered{max-width:760px;margin:0 auto;text-align:center}
.feature-centered .highlights{justify-items:center}
.feature-centered .actions{justify-content:center}
.info-table{width:100%;max-width:460px;border-collapse:collapse;margin-top:24px;text-align:left}
.feature-centered .info-table{margin-inline:auto}
.info-table td{padding:12px 0;border-bottom:1px solid var(--line);vertical-align:top}
.info-table td:last-child{text-align:right;font-weight:600;white-space:nowrap;padding-left:24px}
.info-table small{display:block;color:var(--muted);font-size:.88rem}
.highlights{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:10px}
.highlights li{display:flex;gap:10px;align-items:center}
.highlights svg{width:18px;height:18px;color:var(--accent-text)}
.quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.quote{margin:0;background:var(--bg);border:1px solid var(--line);padding:30px;border-radius:var(--radius)}
.quote blockquote{margin:10px 0 16px;font-size:1.04rem}
.quote figcaption{font-weight:600;color:var(--muted)}
.quote-centered{max-width:820px;margin:0 auto;text-align:center}
.quote-centered blockquote{font-family:var(--font-head);font-size:clamp(1.5rem,2.6vw,2.1rem);line-height:1.3;margin:18px 0}
.quote-centered cite{font-style:normal;color:var(--muted);letter-spacing:.06em}
.quote-more{margin-top:36px;display:grid;gap:10px;color:var(--muted)}
.quote-more cite{font-style:normal}
.gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chips.center{justify-content:center}
.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);padding:9px 16px;border-radius:999px;background:var(--bg)}
.chip svg{width:15px;height:15px;color:var(--accent-text)}
.steps{display:grid;gap:28px;grid-template-columns:repeat(4,1fr)}
.steps.n3{grid-template-columns:repeat(3,1fr)}.steps.n2{grid-template-columns:repeat(2,1fr)}
.step .num{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:1rem;margin-bottom:14px}
.step h3{font-size:1.2rem;margin-bottom:6px}
.step p{color:var(--muted)}
.faq{max-width:820px;margin:0 auto;border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line);padding:20px 0}
.faq summary{display:flex;justify-content:space-between;gap:20px;cursor:pointer;font-weight:600;list-style:none}
.faq summary svg{width:18px;height:18px;flex:none}
.faq p{margin-top:12px;color:var(--muted)}
.contact{display:grid;grid-template-columns:1fr 1.05fr;gap:72px;align-items:start}
.contact .body{color:var(--muted);margin:-24px 0 28px}
.contact-list{list-style:none;padding:0;margin:0 0 28px;display:grid;gap:20px}
.contact-list li{display:flex;gap:16px}
.contact-list svg{width:22px;height:22px;color:var(--accent-text);flex:none;margin-top:3px}
.contact-list span{display:block;font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.contact-list a{font-weight:600;font-size:1.08rem;text-decoration:none}
.hours{border:1px solid var(--line);padding:20px 24px;border-radius:var(--radius)}
.hours-title{display:flex;gap:10px;align-items:center;font-weight:600;margin-bottom:8px}
.hours-title svg{width:18px;height:18px;color:var(--accent-text)}
.hours table{width:100%;border-collapse:collapse}
.hours td{padding:7px 0;border-top:1px solid var(--line)}
.hours td:last-child{text-align:right}
.enquiry{background:var(--surface);padding:36px;display:grid;gap:16px;border-radius:var(--radius)}
.enquiry h3{font-size:1.5rem}
.enquiry label{display:grid;gap:6px;font-size:.88rem;font-weight:600}
.enquiry input,.enquiry textarea{font:inherit;padding:13px 14px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:calc(var(--radius) / 2)}
.enquiry .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.enquiry .note{color:var(--muted);font-size:.9rem}
.band{background:var(--accent);color:var(--accent-ink)}
.band h2{color:var(--accent-ink);font-size:calc(clamp(1.8rem,3vw,2.4rem) * var(--head-scale))}
.band p{margin-top:8px;opacity:.88}
.band-inner{max-width:1200px;margin:0 auto;padding:64px 32px;display:flex;align-items:center;justify-content:space-between;gap:32px}
.site-footer{background:var(--footer-bg);color:var(--footer-text);padding:64px 0 40px;font-size:.93rem}
.footer-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:40px}
.site-footer h4{font-family:var(--font-body);font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;margin:0 0 14px;opacity:.7;font-weight:600}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.site-footer a{text-decoration:none}
.footer-brand{font-family:var(--font-head);font-size:1.4rem}
.footer-note{margin-top:44px;padding-top:20px;border-top:1px solid rgba(127,127,127,.25);font-size:.8rem;opacity:.7;display:grid;gap:4px}
.call-bar{display:none}
@media (max-width:1000px){.nav{display:none}}
@media (max-width:900px){
  body{font-size:16px}
  .wrap{padding:0 20px}
  .header-inner{height:64px;gap:16px}
  .header-call span{display:none}
  .hero-grid,.feature,.contact,.split-head{grid-template-columns:1fr;gap:32px}
  .hero-grid{padding-block:40px 56px}
  .feature.img-right .feature-media{order:0}
  .hero-full{min-height:72vh}
  .hero-centered .hero-inner{padding:80px 20px}
  .section{padding:60px 0}
  .tiles,.tiles.n3,.tiles.n2{grid-template-columns:1fr 1fr}
  .products{grid-template-columns:1fr 1fr;gap:22px 14px}
  .menu{grid-template-columns:1fr}
  .cards,.cards.n2,.cards.n4,.quotes,.svc-list,.numbered,.steps,.steps.n3,.steps.n2{grid-template-columns:1fr}
  .num-item,.num-item:nth-child(even){padding:24px 0;border-left:none}
  .gallery{grid-template-columns:1fr 1fr}
  .trust-inner{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;padding:16px 20px;font-size:.85rem;justify-content:stretch}
  .trust-item{align-items:flex-start}
  .tile-label strong{font-size:1.15rem}
  .tile-label{left:14px;right:14px;bottom:12px}
  .circles{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;padding-bottom:8px;scroll-snap-type:x mandatory;margin:0 -20px;padding-inline:20px}
  .circle{flex:none;width:104px;scroll-snap-align:start}
  .circle-img{width:104px;height:104px}
  .enquiry{padding:24px}
  .enquiry .row{grid-template-columns:1fr}
  .band-inner{flex-direction:column;align-items:flex-start;padding:48px 20px}
  .footer-grid{grid-template-columns:1fr 1fr}
  .site-footer{padding-bottom:110px}
  .call-bar.on{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:50;gap:10px}
  .call-bar a{flex:1;box-shadow:0 10px 30px -10px rgba(0,0,0,.45)}
}
`;

export function renderPlan(plan: SitePlan, images: ImageMap, meta: RenderMeta): string {
  const st = STYLE[plan.style] ?? STYLE.boutique;
  const p = plan.palette;
  const bg = HEX.test(p.background) ? p.background : "#ffffff";
  const text = ensure(HEX.test(p.text) ? p.text : "#1a1a1a", bg, 7);
  const surface = HEX.test(p.surface) ? p.surface : mix(bg, text, 0.04);
  const muted = ensure(HEX.test(p.muted) ? p.muted : mix(text, bg, 0.4), bg, 4.5);
  const accent = ensure(HEX.test(p.accent) ? p.accent : text, bg, 3);
  const headerBg = HEX.test(p.header_background) ? p.header_background : bg;
  const headerText = ensure(HEX.test(p.header_text) ? p.header_text : inkOn(headerBg), headerBg, 4.5);
  const annBg = HEX.test(p.announcement_background) ? p.announcement_background : text;
  const annText = ensure(HEX.test(p.announcement_text) ? p.announcement_text : inkOn(annBg), annBg, 4.5);
  const footerBg = lum(bg) > 0.5 ? mix(text, "#000000", 0.2) : mix(bg, "#000000", 0.35);

  const b = plan.business;
  const tel = b.phone ? `tel:${b.phone.replace(/[^\d+]/g, "")}` : null;
  const firstShop = plan.sections.findIndex((s) => s.type === "products" || s.type === "categories");
  const ctx: Ctx = { plan, images, meta, tel, shopAnchor: firstShop >= 0 ? `#s${firstShop}` : "#contact" };

  const sectionsHtml = plan.sections.map((s, i) => renderSection(ctx, s, i)).join("\n");
  const navSeen = new Set<string>();
  const nav = plan.sections
    .map((s, i) => ({ label: NAV_LABEL[s.type], href: s.type === "contact" ? "#contact" : `#s${i}` }))
    .filter((n) => n.label && !navSeen.has(n.label) && navSeen.add(n.label))
    .slice(0, 5);

  const fonts = [...new Set([plan.fonts.heading, plan.fonts.body])]
    .map((f) => `family=${f.replace(/ /g, "+")}:ital,wght@0,400;0,500;0,600;0,700;1,400`)
    .join("&");

  const credits = [...new Set(Object.values(images).filter((i) => i.stock && i.credit).map((i) => i.credit!))];
  const usesCall = !!tel;

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(plan.seo_title)} — concept preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fonts}&display=swap" rel="stylesheet">
<style>
:root{--bg:${bg};--surface:${surface};--text:${text};--muted:${muted};--line:${mix(bg, text, 0.12)};
--accent:${accent};--accent-ink:${inkOn(accent)};--accent-text:${ensure(accent, bg, 3)};
--header-bg:${headerBg};--header-text:${headerText};--ann-bg:${annBg};--ann-text:${annText};
--footer-bg:${footerBg};--footer-text:${mix("#ffffff", footerBg, 0.15)};
--font-head:'${plan.fonts.heading}',Georgia,serif;--font-body:'${plan.fonts.body}',system-ui,sans-serif;
--head-weight:${st.headWeight};--head-tracking:${st.headTracking};--head-scale:${st.headScale};
--radius:${st.radius};--btn-radius:${st.btnRadius};--section-pad:${st.sectionPad};--btn-case:${st.upperButtons ? "uppercase" : "none"}}
${BASE_CSS}${st.css}
${lum(headerBg) < 0.3 && meta.logo ? ".brand img{background:#fff;padding:7px 12px;border-radius:var(--btn-radius);max-height:58px}" : ""}
</style>
</head>
<body>
<div class="concept-bar"><strong>Design concept</strong> for ${esc(b.name)} · prepared by ${esc(meta.preparedBy)} · not the live website</div>
${plan.announcement ? `<div class="announce">${esc(plan.announcement)}</div>` : ""}
<header class="site-header"><div class="wrap header-inner">
  <a class="brand" href="#top">${meta.logo ? `<img src="${esc(meta.logo)}" alt="${esc(b.name)}">` : `<span class="wordmark">${esc(b.name)}</span>`}</a>
  <nav class="nav">${nav.map((n) => `<a href="${n.href}">${esc(n.label!)}</a>`).join("")}</nav>
  ${tel ? `<a class="header-call" href="${tel}">${ICON.phone}<span>${esc(b.phone)}</span></a>` : ""}
</div></header>
<main>
${hero(ctx)}
${trust(ctx)}
${sectionsHtml}
</main>
<footer class="site-footer"><div class="wrap">
  <div class="footer-grid">
    <div><div class="footer-brand">${esc(b.name)}</div>${plan.hero.subheadline ? `<p style="margin-top:10px;opacity:.8;max-width:34ch">${esc(plan.hero.subheadline)}</p>` : ""}</div>
    <div><h4>Explore</h4><ul>${nav.map((n) => `<li><a href="${n.href}">${esc(n.label!)}</a></li>`).join("")}</ul></div>
    <div><h4>Contact</h4><ul>${b.phone ? `<li><a href="${tel}">${esc(b.phone)}</a></li>` : ""}${b.email ? `<li><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>` : ""}${b.address && b.show_address ? `<li>${esc(b.address)}</li>` : ""}</ul></div>
    <div>${b.hours.length ? `<h4>Hours</h4><ul>${b.hours.map((h) => `<li>${esc(h.days)}: ${esc(h.hours)}</li>`).join("")}</ul>` : b.social.length ? `<h4>Follow</h4><ul>${b.social.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.platform)}</a></li>`).join("")}</ul>` : ""}</div>
  </div>
  <div class="footer-note"><span>Design concept prepared by ${esc(meta.preparedBy)}. Not the official ${esc(b.name)} website.</span>
  ${credits.length ? `<span>Some photos are placeholders: ${credits.map(esc).join(" · ")}</span>` : ""}</div>
</div></footer>
${usesCall ? `<div class="call-bar ${["call", "book"].includes(plan.hero.primary_cta.action) || plan.style === "bold" ? "on" : ""}"><a class="btn btn-primary" href="${tel}">${ICON.phone}<span>Call</span></a><a class="btn btn-outline" style="background:var(--bg)" href="#contact"><span>Enquire</span></a></div>` : ""}
</body>
</html>`;
}
