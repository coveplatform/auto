import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

/**
 * Runs one structured-output request through the locally installed Claude Code CLI
 * (`claude -p`), so usage comes out of the user's Claude plan instead of API billing.
 * Images are written to a temp folder and Claude reads them with its Read tool.
 */

function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "$schema" || k === "minimum" || k === "maximum") continue;
      out[k] = cleanSchema(v);
    }
    return out;
  }
  return schema;
}

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  api_error_status?: number | null;
}

function runCli(args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Drop any API key so Claude Code uses the logged-in Claude plan.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(config.claudeCodeBin, args, { cwd, windowsHide: true, env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Claude Code (${config.claudeCodeBin}): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(`Claude Code exited with code ${code}: ${err.slice(0, 800)}`));
    });
    child.stdin.end(stdin);
  });
}

export async function claudeCodeJSON<S extends z.ZodType>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  schema: S;
  effort?: string;
  /** Let Claude browse the web (WebSearch + WebFetch) before answering. */
  webResearch?: boolean;
}): Promise<z.infer<S>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prospect-cc-"));
  try {
    const blocks = typeof opts.content === "string" ? [{ type: "text" as const, text: opts.content }] : opts.content;
    const parts: string[] = [];
    let n = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        parts.push(block.text);
      } else if (block.type === "image" && block.source.type === "base64") {
        const file = path.join(dir, `image-${++n}.jpg`);
        fs.writeFileSync(file, Buffer.from(block.source.data, "base64"));
        parts.push(`[Image ${n}: use the Read tool to view ${file.replace(/\\/g, "/")}]`);
      }
    }
    if (n > 0) parts.unshift(`Before answering, use the Read tool to look at all ${n} image file(s) referenced below.`);

    const tools = [...(n > 0 ? ["Read"] : []), ...(opts.webResearch ? ["WebSearch", "WebFetch"] : [])];
    const schema = JSON.stringify(cleanSchema(z.toJSONSchema(opts.schema)));
    const args = [
      "-p",
      "--output-format", "json",
      "--no-session-persistence",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--model", config.anthropicModel,
      "--effort", opts.effort ?? "medium",
      "--system-prompt", opts.system,
      "--json-schema", schema,
      "--tools", tools.join(","),
      ...(tools.length ? ["--allowedTools", ...tools] : []),
      ...(n > 0 ? ["--add-dir", dir] : []),
    ];

    const raw = await runCli(args, parts.join("\n\n"), dir, 10 * 60 * 1000);
    let parsed: CliResult;
    try {
      parsed = JSON.parse(raw) as CliResult;
    } catch {
      throw new Error(`Claude Code returned non-JSON output: ${raw.slice(0, 500)}`);
    }
    if (parsed.is_error || parsed.subtype !== "success") {
      throw new Error(
        `Claude Code error (${parsed.subtype ?? "unknown"}${parsed.api_error_status ? `, HTTP ${parsed.api_error_status}` : ""}): ${String(parsed.result ?? "").slice(0, 500)}`,
      );
    }
    const output = parsed.structured_output ?? (parsed.result ? JSON.parse(parsed.result) : null);
    return opts.schema.parse(output) as z.infer<S>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
