import path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopContext, mobileContext, closeBrowser } from "../src/lib/browser";
(async () => {
  const url = pathToFileURL(path.resolve("previews/leona-test/index.html")).href;
  for (const [fn, name] of [[desktopContext, "desk.jpg"], [mobileContext, "mob.jpg"]] as const) {
    const ctx = await fn(); const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1500);
    await p.screenshot({ path: name, fullPage: true, type: "jpeg", quality: 80 }); await ctx.close();
  }
  await closeBrowser();
})();
