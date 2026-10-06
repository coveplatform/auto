import * as z from "zod/v4";

/**
 * A SitePlan is the art-directed page: design decisions + copy + which photos go where.
 * Claude writes it, the critique pass revises it, and the renderer turns it into HTML.
 */

export const STYLES = ["boutique", "bold", "clean", "editorial", "soft", "warm"] as const;
export type StyleId = (typeof STYLES)[number];

export const STYLE_INFO: Record<StyleId, string> = {
  boutique:
    "Shopify-Dawn-like retail: white canvas, crisp square buttons, centered serif section titles, product grids and occasion tiles. Florists, gift shops, bakeries selling products, boutiques.",
  bold: "Dark high-contrast header/hero, chunky sans headings, phone-first. Plumbers, electricians, builders, roofers, mechanics.",
  clean: "Light, friendly, rounded cards, soft tints. Cleaners, painters, removalists, pest control, home services.",
  editorial: "Restrained, serif-led, thin rules, lots of whitespace, left-aligned. Accountants, lawyers, architects, consultants.",
  soft: "Calm, airy, pill buttons, arches and soft neutrals. Clinics, physio, dental, beauty, salons, yoga.",
  warm: "Image-led, warm neutrals, elegant serif, full-bleed photography. Cafes, restaurants, bars, caterers, venues.",
};

export const HEADING_FONTS = [
  "Playfair Display",
  "Cormorant Garamond",
  "Fraunces",
  "DM Serif Display",
  "Libre Caslon Text",
  "Instrument Serif",
  "Archivo",
  "Plus Jakarta Sans",
  "Space Grotesk",
  "Outfit",
  "Bricolage Grotesque",
  "Manrope",
] as const;

export const BODY_FONTS = ["Assistant", "DM Sans", "Work Sans", "Source Sans 3", "Manrope", "Karla", "Nunito Sans", "Archivo"] as const;

export const SECTION_TYPES = [
  "categories",
  "products",
  "services",
  "feature",
  "about",
  "testimonials",
  "gallery",
  "areas",
  "steps",
  "faq",
  "contact",
  "cta_band",
] as const;

export const VARIANTS = [
  "circles",
  "tiles",
  "cards",
  "list",
  "numbered",
  "grid",
  "image-left",
  "image-right",
  "centered",
  "default",
] as const;

export const ImageRefSchema = z.object({
  source: z.enum(["site", "stock", "none"]),
  site_index: z.number().int().nullable().describe("Index from the site image contact sheet when source=site."),
  stock_query: z
    .string()
    .nullable()
    .describe("When source=stock: a specific photo search, e.g. 'florist hands arranging pastel roses, natural light'."),
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

const CtaSchema = z.object({
  label: z.string(),
  action: z.enum(["call", "contact", "shop", "book", "directions"]),
});

export const SectionSchema = z.object({
  type: z.enum(SECTION_TYPES),
  variant: z.enum(VARIANTS),
  heading: z.string(),
  subheading: z.string().nullable(),
  body: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      text: z.string().nullable(),
      meta: z.string().nullable().describe("Price ('From $55') only if stated on the site, or testimonial author, or step number."),
      image: ImageRefSchema,
    }),
  ),
  image: ImageRefSchema,
  cta: CtaSchema.nullable(),
});
export type Section = z.infer<typeof SectionSchema>;

const hex = () => z.string().describe("Hex colour like #1f3a2e");

export const SitePlanSchema = z.object({
  thinking: z.object({
    audience: z.string().describe("Who visits this site and what they want, in one or two sentences."),
    primary_goal: z.string().describe("The one action the page must drive (call, order, book, visit)."),
    design_direction: z.string().describe("The look and why it fits THIS business and its customers."),
    avoid: z.string().describe("What would look wrong or generic for this business, and how you avoided it."),
  }),
  style: z.enum(STYLES),
  palette: z.object({
    background: hex(),
    surface: hex().describe("Alternate section background, subtle."),
    text: hex(),
    muted: hex(),
    accent: hex().describe("Buttons/links. Tasteful, derived from the brand but refined if the brand colour is garish."),
    header_background: hex(),
    header_text: hex(),
    announcement_background: hex(),
    announcement_text: hex(),
  }),
  fonts: z.object({ heading: z.enum(HEADING_FONTS), body: z.enum(BODY_FONTS) }),
  logo_index: z.number().int().nullable(),
  announcement: z.string().nullable().describe("Thin top bar text, facts only (e.g. a delivery promise stated on the site). null if nothing true to say."),
  hero: z.object({
    variant: z.enum(["full-bleed", "split", "centered", "collage"]),
    eyebrow: z.string().nullable(),
    headline: z.string(),
    subheadline: z.string(),
    primary_cta: CtaSchema,
    secondary_cta: CtaSchema.nullable(),
    image: ImageRefSchema,
    collage: z.array(ImageRefSchema).describe("2-3 extra images when variant=collage, else empty."),
  }),
  trust_points: z.array(z.string()).describe("0-4 short verifiable facts."),
  sections: z.array(SectionSchema),
  business: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    show_address: z.boolean().describe("false for home-based businesses or when the address shouldn't be public."),
    hours: z.array(z.object({ days: z.string(), hours: z.string() })),
    service_areas: z.array(z.string()),
    social: z.array(z.object({ platform: z.string(), url: z.string() })),
  }),
  seo_title: z.string(),
});
export type SitePlan = z.infer<typeof SitePlanSchema>;

/** A resolved photo ready to render. */
export interface ResolvedImage {
  file: string; // relative to preview root, e.g. assets/img-3.jpg
  credit: string | null; // attribution for stock photos
  stock: boolean;
}

export function refKey(ref: ImageRef, slot: string): string | null {
  if (ref.source === "site" && ref.site_index !== null) return `site:${ref.site_index}`;
  if (ref.source === "stock" && ref.stock_query) return `stock:${slot}`;
  return null;
}

/** Walk every ImageRef in a plan with a stable slot id (used to key stock picks). */
export function forEachImageRef(plan: SitePlan, fn: (ref: ImageRef, slot: string) => void) {
  fn(plan.hero.image, "hero");
  plan.hero.collage.forEach((r, i) => fn(r, `hero.collage.${i}`));
  plan.sections.forEach((s, si) => {
    fn(s.image, `s${si}.image`);
    s.items.forEach((it, ii) => fn(it.image, `s${si}.item${ii}`));
  });
}
