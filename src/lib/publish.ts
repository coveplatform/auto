import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config, previewUrl } from "./config";
import { db, getDemo } from "./db";

const run = promisify(exec);

/** Files that keep the whole preview host private-ish: no indexing, no directory listing. */
function writeHostFiles() {
  const dir = config.previewsDir;
  fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  // Netlify / Cloudflare Pages header rules.
  fs.writeFileSync(path.join(dir, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n");
  // Vercel static config.
  fs.writeFileSync(
    path.join(dir, "vercel.json"),
    JSON.stringify(
      { headers: [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }] },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<!doctype html><meta name="robots" content="noindex"><title>Nothing here</title><p>Nothing to see here.</p>',
  );
}

export async function publishPreview(businessId: number): Promise<string> {
  const demo = getDemo(businessId);
  if (!demo) throw new Error("No demo to publish");
  writeHostFiles();
  if (config.previewDeployCmd) {
    const { stdout, stderr } = await run(config.previewDeployCmd, { cwd: config.root, timeout: 10 * 60 * 1000 });
    if (process.env.DEBUG_DEPLOY) console.log(stdout, stderr);
  }
  const url = previewUrl(demo.slug);
  db.prepare("UPDATE demos SET published_url = ? WHERE business_id = ?").run(url, businessId);
  return url;
}
