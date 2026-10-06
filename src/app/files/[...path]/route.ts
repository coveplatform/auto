import { config } from "@/lib/config";
import { serveFile } from "@/lib/serve";

// Screenshots and scraped assets stored under ./data
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return serveFile(config.dataDir, path);
}
