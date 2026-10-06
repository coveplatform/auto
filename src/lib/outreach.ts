import * as z from "zod/v4";
import { claudeJSON } from "./claude";
import { config, previewUrl } from "./config";
import { db, getBusiness, getDemo, getFoundation, getReport, getScan, parseJSON } from "./db";
import type { Foundation } from "./foundation";
import type { Qualification } from "./qualify";
import type { SiteMetrics } from "./scan";
import type { Extraction } from "./templates/content";
import type { SitePlan } from "./templates/plan";

const EmailSchema = z.object({
  greeting_name: z.string().nullable().describe("Owner/contact first name ONLY if the site clearly names them; otherwise null."),
  subject: z.string(),
  body: z.string(),
});

const SYSTEM = `You write short, personal cold emails from an Australian freelance web designer to a local business owner.
The designer has already built a private concept of a redesigned homepage for them.

Rules:
- Under 120 words in the body. Casual, warm, plain Australian English. No marketing hype, no exclamation-mark spam, no emojis.
- One genuine, specific compliment (e.g. their reviews) and one specific, gentle observation about the current site (from the problems list). Never insult the current site.
- Say clearly it's just a concept they can look at, include the preview link on its own line, and state the price once.
- Only use the owner's first name if the source text clearly identifies them as owner/director; otherwise greet with "Hi there" or "Hi <business name> team".
- Never claim things about the business that aren't in the facts. Never imply the designer was asked to do this.
- End with the sign-off block exactly as provided (it carries legally required sender identification and an opt-out line). Do not remove or alter it.
- Subject: short and specific, lowercase-ish, no clickbait (e.g. "a fresh look for Preston Plumbing's website").`;

export function pickEmail(candidates: string[], website: string | null): string | null {
  const unique = [...new Set(candidates.map((e) => e.toLowerCase()))].filter(
    (e) => !/(example|sentry|wixpress|domain\.com|email\.com|yourname|\.png|\.jpg)/.test(e),
  );
  if (!unique.length) return null;
  let domain = "";
  try {
    domain = new URL(website ?? "").hostname.replace(/^www\./, "");
  } catch {}
  const score = (e: string) => (domain && e.endsWith(domain) ? 2 : 0) + (/^(info|hello|contact|admin|office|enquir)/.test(e) ? 1 : 0);
  return unique.sort((a, b) => score(b) - score(a))[0];
}

export async function draftOutreach(businessId: number) {
  const b = getBusiness(businessId);
  const demo = getDemo(businessId);
  if (!b || !demo) throw new Error("Business or demo not found");
  const scan = getScan(businessId);
  const q = parseJSON<Qualification>(scan?.ai);
  const metrics = parseJSON<SiteMetrics>(scan?.metrics);
  const ex = parseJSON<Extraction>(demo.extraction);
  const content = parseJSON<SitePlan>(demo.content);
  const foundation = demo.template === "custom" ? parseJSON<Foundation>(getFoundation(businessId)?.data) : null;

  const s = config.sender;
  const signOff = [
    "Cheers,",
    s.name,
    [s.business, s.abn ? `ABN ${s.abn}` : ""].filter(Boolean).join(" · "),
    [s.phone, s.email].filter(Boolean).join(" · "),
    "",
    "P.S. If you'd rather not hear from me again, just reply \"no thanks\" and I won't contact you again.",
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");

  const link = demo.published_url ?? previewUrl(demo.slug);
  const report = getReport(businessId);
  const reportLink = report ? previewUrl(report.slug) : null;
  const aboutText = (ex?.pages ?? [])
    .filter((p) => /about|team|contact/i.test(p.url) || p === ex?.pages[0])
    .map((p) => p.text)
    .join("\n")
    .slice(0, 6000);

  const result = await claudeJSON({
    system: SYSTEM,
    schema: EmailSchema,
    effort: "medium",
    maxTokens: 4000,
    content: [
      {
        type: "text",
        text: [
          `Business: ${b.name} (${b.category ?? "local business"}, ${b.address ?? ""})`,
          `Google rating: ${b.rating ?? "n/a"} from ${b.review_count ?? 0} reviews`,
          `Problems with current site: ${(q?.problems ?? []).join("; ") || "dated design on mobile"}`,
          `Strengths: ${(q?.strengths ?? []).join("; ")}`,
          `Concept headline: ${content?.hero.headline ?? foundation?.copy.headline ?? ""}`,
          foundation ? `Concept direction: ${foundation.creative_direction.concept}. ${foundation.diagnosis.opportunity}` : "",
          `Preview link: ${link}`,
          reportLink ? `Website review link (a short written review of their current site; mention it in one sentence and put it on its own line): ${reportLink}` : "",
          `Price for the finished site: ${s.price}`,
          `Designer name: ${s.name}`,
          "",
          "Sign-off block (use verbatim at the end):",
          signOff,
          "",
          "Source text from their About/Contact pages (to find an owner name only):",
          aboutText,
        ].join("\n"),
      },
    ],
  });

  const toEmail = pickEmail([...(ex?.emails ?? []), ...(metrics?.emails ?? [])], b.website);
  let body = result.body.trim();
  if (!body.includes(link)) body += `\n\n${link}`;
  if (reportLink && !body.includes(reportLink)) body += `\n\nA short review of your current site: ${reportLink}`;
  if (!body.includes("no thanks")) body += `\n\n${signOff}`;

  db.prepare(
    `INSERT INTO outreach (business_id, to_email, subject, body, status, updated_at)
     VALUES (?, ?, ?, ?, 'draft', datetime('now'))
     ON CONFLICT(business_id) DO UPDATE SET to_email=COALESCE(outreach.to_email, excluded.to_email),
       subject=excluded.subject, body=excluded.body, updated_at=datetime('now')`,
  ).run(b.id, toEmail, result.subject, body);
}
