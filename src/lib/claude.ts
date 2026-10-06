import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { config } from "./config";
import { claudeCodeJSON } from "./claude-code";

// "vertex" bills Claude to Google Cloud (auth via GOOGLE_APPLICATION_CREDENTIALS service-account JSON).
const onVertex = config.claudeProvider === "vertex";
const client = onVertex
  ? new AnthropicVertex({ projectId: config.vertexProjectId, region: config.vertexRegion })
  : new Anthropic();

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * One structured-output call to Claude. Returns the parsed object validated
 * against `schema`. Uses server-side refusal fallbacks ("default" routing).
 */
export async function claudeJSON<S extends z.ZodType>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
  /** Claude Code only: allow live web research. Ignored on the API route. */
  webResearch?: boolean;
}): Promise<z.infer<S>> {
  if (config.claudeProvider === "claude-code") {
    return claudeCodeJSON({ system: opts.system, content: opts.content, schema: opts.schema, effort: opts.effort, webResearch: opts.webResearch });
  }
  const response = await client.beta.messages.parse({
    model: config.anthropicModel,
    max_tokens: opts.maxTokens ?? 16000,
    // Server-side refusal fallbacks exist only on the Claude API, not on Vertex.
    ...(onVertex ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: {
      effort: opts.effort ?? "medium",
      format: betaZodOutputFormat(opts.schema),
    },
  });

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unknown";
    throw new Error(`Claude declined the request (category: ${category})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude response hit max_tokens before finishing the JSON");
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned output that did not match the schema");
  }
  return response.parsed_output as z.infer<S>;
}

export function imageBlock(base64Jpeg: string): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg } };
}

export function textBlock(text: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: "text", text };
}
