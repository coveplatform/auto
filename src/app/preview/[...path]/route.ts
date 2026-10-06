import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { serveFile } from "@/lib/serve";

const ROBOTS = { "X-Robots-Tag": "noindex, nofollow, noarchive" };

// Local copy of the static previews in ./previews (exactly what gets deployed).
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  if (parts.length === 1) {
    // Next strips trailing slashes, so add a <base> to make relative asset URLs resolve.
    const slug = parts[0].replace(/[^a-z0-9-_]/gi, "");
    const file = path.join(/*turbopackIgnore: true*/ config.previewsDir, slug, "index.html");
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return new Response("Not found", { status: 404 });
    const html = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").replace("<head>", `<head><base href="/preview/${slug}/">`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...ROBOTS } });
  }
  return serveFile(config.previewsDir, parts, ROBOTS);
}
