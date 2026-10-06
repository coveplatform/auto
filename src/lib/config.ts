import path from "node:path";
import fs from "node:fs";

const root = process.cwd();

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  root,
  dataDir: path.join(root, "data"),
  shotsDir: path.join(root, "data", "shots"),
  assetsDir: path.join(root, "data", "assets"),
  previewsDir: path.join(root, "previews"),
  // Your own curated stock photos: library/<topic>/*.jpg (folder name matched against the industry)
  libraryDir: path.join(root, "library"),

  anthropicModel: env("CLAUDE_MODEL", "claude-opus-5-5"),
  // "anthropic" (ANTHROPIC_API_KEY), "vertex" (Google Cloud Vertex AI) or "claude-code" (local Claude Code CLI, uses your Claude plan)
  claudeProvider: env("CLAUDE_PROVIDER", "anthropic"),
  claudeCodeBin: env("CLAUDE_CODE_BIN", "claude"),
  vertexProjectId: env("VERTEX_PROJECT_ID"),
  vertexRegion: env("VERTEX_REGION", "global"),
  googleApiKey: env("GOOGLE_API_KEY"),
  pagespeedApiKey: env("PAGESPEED_API_KEY", env("GOOGLE_API_KEY")),
  wappalyzerApiKey: env("WAPPALYZER_API_KEY"),
  pexelsApiKey: env("PEXELS_API_KEY"),

  // Playwright: "msedge" / "chrome" use the locally installed browser; "chromium" uses Playwright's bundled one.
  browserChannel: env("BROWSER_CHANNEL", "msedge"),
  scanConcurrency: Number(env("SCAN_CONCURRENCY", "3")),
  runPagespeed: env("RUN_PAGESPEED", "true") !== "false",

  appUrl: env("APP_URL", "http://127.0.0.1:3000"),
  // Public base URL where /previews is deployed, e.g. https://preview.yourcompany.com
  previewPublicBase: env("PREVIEW_PUBLIC_BASE"),
  // Shell command that deploys ./previews (e.g. `npx wrangler pages deploy previews --project-name my-previews`)
  previewDeployCmd: env("PREVIEW_DEPLOY_CMD"),

  sender: {
    name: env("SENDER_NAME", "Kris"),
    business: env("SENDER_BUSINESS", ""),
    email: env("SENDER_EMAIL", ""),
    phone: env("SENDER_PHONE", ""),
    abn: env("SENDER_ABN", ""),
    price: env("OFFER_PRICE", "$1,200"),
  },
};

for (const dir of [config.dataDir, config.shotsDir, config.assetsDir, config.previewsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function previewUrl(slug: string): string {
  if (config.previewPublicBase) return `${config.previewPublicBase.replace(/\/$/, "")}/${slug}/`;
  return `${config.appUrl}/preview/${slug}/`;
}
