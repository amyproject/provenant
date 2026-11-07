// Claude client (live mode only — ANTHROPIC_API_KEY set). AI extracts and explains; it never decides.
// Every caller has a deterministic fallback, so any API error or refusal degrades to fixture behaviour.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../env";
import { ExtractedFieldsSchema, type ExtractedFields } from "./schema";

export const CLAUDE_MODEL = "claude-sonnet-5-5";

const g = globalThis as unknown as { __provenantClaude?: Anthropic };

export function claude(): Anthropic | null {
  if (!env.anthropicLive()) return null;
  g.__provenantClaude ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return g.__provenantClaude;
}

const EXTRACT_SYSTEM = [
  "You extract supply-chain compliance evidence from supplier documents into typed fields.",
  "Copy values exactly as written; use null when a field is absent. Countries as ISO-3166 alpha-2.",
  "Only list disclosedSubtierChanges the document explicitly states; 'none declared' means an empty list.",
].join(" ");

/** PDF (base64) -> typed fields via structured output. Null on any failure. */
export async function claudeExtract(input: { base64: string; filename: string; kindHint: string }): Promise<ExtractedFields | null> {
  const client = claude();
  if (!client) return null;
  try {
    const res = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: EXTRACT_SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(ExtractedFieldsSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } },
            { type: "text", text: `Filename: ${input.filename}. The supplier labelled it as: ${input.kindHint}. Extract the fields.` },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") return null;
    return res.parsed_output ?? null;
  } catch (err) {
    console.warn("[claude] extraction failed, using fixture:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Short plain-text generation (flag explanations, supplier emails). Null on any failure. */
export async function claudeText(system: string, prompt: string, maxTokens = 800): Promise<string | null> {
  const client = claude();
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    console.warn("[claude] text generation failed, using template:", err instanceof Error ? err.message : err);
    return null;
  }
}
