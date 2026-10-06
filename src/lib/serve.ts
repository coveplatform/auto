import fs from "node:fs";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve a file from `root`, refusing anything that escapes it. */
export function serveFile(root: string, parts: string[], extraHeaders: Record<string, string> = {}): Response {
  const target = path.resolve(root, ...parts.map((p) => decodeURIComponent(p)));
  if (!target.startsWith(path.resolve(root) + path.sep)) return new Response("Not found", { status: 404 });
  let file = target;
  if (fs.existsSync(/*turbopackIgnore: true*/ file) && fs.statSync(/*turbopackIgnore: true*/ file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(fs.readFileSync(/*turbopackIgnore: true*/ file), {
    headers: { "Content-Type": type, "Cache-Control": "no-store", ...extraHeaders },
  });
}
