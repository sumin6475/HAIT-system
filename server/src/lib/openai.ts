//OpenAI Responses API
import OpenAI from "openai";
import { config } from "../config.js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });

// Reasoning models (such as gpt-5-mini) do not accept temperature or top_p, and
// their hidden reasoning tokens count against max_output_tokens, which can cut a
// reply short. So temperature is left out, reasoning_effort is set to "minimal",
// and extra room is added to the token limit.
const REASONING_MODEL = /^(o1|o3|o4|gpt-5)/i;
// The schema already limits the visible reply to 800 characters, so this extra room is only for reasoning tokens.
const REASONING_TOKEN_HEADROOM = 1024;

/**
 * The request fields that differ between a reasoning model and a plain one.
 *
 * A reasoning model rejects `temperature`, so every model call asks here
 * instead of hard-coding either shape. For a non-reasoning model the result is
 * `temperature: 0` and the requested cap.
 */
export function modelRequestParams(model: string, maxOutputTokens: number) {
  return REASONING_MODEL.test(model)
    ? {
        reasoning: { effort: "minimal" as const },
        max_output_tokens: maxOutputTokens + REASONING_TOKEN_HEADROOM,
      }
    : { temperature: 0 as const, max_output_tokens: maxOutputTokens };
}

// Result of one model call.
export type AICallResult =
  | {
      ok: true;
      content: string;
      requestId: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }
  | { ok: false; reason: "timeout" | "rate_limit" | "parse_error" | "unknown"; error: string };

interface CallAIOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
}

// Non-streaming call. Returns a result object instead of throwing.
export async function callAI({
  systemPrompt,
  userPrompt,
  model = "gpt-4o-mini",
  timeoutMs = 15_000,
}: CallAIOptions): Promise<AICallResult> {
  const start = Date.now();

  // Timeout through AbortController.
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await client.responses.create(
      {
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      { signal: ctrl.signal },
    );

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    // Pull out the response text.
    const content = response.output_text?.trim() ?? "";
    if (!content) {
      return {
        ok: false,
        reason: "parse_error",
        error: "Empty response from model",
      };
    }
    return {
      ok: true,
      content,
      requestId: response.id,
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (
      error.name === "AbortError" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("aborted")
    ) {
      return {
        ok: false,
        reason: "timeout",
        error: `Timeout after ${timeoutMs}ms`,
      };
    }
    if (error.status === 429) {
      return {
        ok: false,
        reason: "rate_limit",
        error: error.message,
      };
    }
    return {
      ok: false,
      reason: "unknown",
      error: error.message ?? String(error),
    };
  }
}

export type AIResponseParsed = { content: string };
// Result of a structured-output call.
export type AIStructuredResult =
  | {
      ok: true;
      parsed: AIResponseParsed;
      requestId: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
      systemFingerprint: string | null;
      model: string;
    }
  | {
      ok: false;
      reason: "timeout" | "rate_limit" | "parsed_error" | "unknown";
      error: string;
      model: string;
    };

interface CallAIStructuredOptions {
  systemPrompt: string;
  /** Server-authored, per-turn control/state. Kept separate from the human transcript. */
  developerPrompt?: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
  // null deliberately removes the API/schema cap for long readable recap routes.
  maxOutputTokens?: number | null; // default 140
  maxContentChars?: number | null;
}

export async function callAIStructured({
  systemPrompt,
  developerPrompt,
  userPrompt,
  model = "gpt-5-mini", // model name in the U-M GPT Toolkit catalogue
  timeoutMs = 30_000,
  maxOutputTokens = 140,
  maxContentChars = 800,
}: CallAIStructuredOptions): Promise<AIStructuredResult> {
  const start = Date.now();
  const isReasoning = REASONING_MODEL.test(model);
  // Reasoning models start with extra room for reasoning tokens, or the first try is cut short.
  let cap =
    maxOutputTokens === null
      ? null
      : isReasoning
        ? maxOutputTokens + REASONING_TOKEN_HEADROOM
        : maxOutputTokens;

  // 2 attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const responseSchema = z.object({
        content: maxContentChars === null ? z.string() : z.string().max(maxContentChars),
      });
      const response = await client.responses.parse(
        {
          model,
          // Reasoning models take no temperature, so it is left out and reasoning is kept minimal.
          ...(isReasoning ? { reasoning: { effort: "minimal" } } : { temperature: 0 }),
          ...(cap === null ? {} : { max_output_tokens: cap }),
          input: [
            { role: "system", content: systemPrompt },
            ...(developerPrompt
              ? ([{ role: "developer" as const, content: developerPrompt }] as const)
              : []),
            { role: "user", content: userPrompt },
          ],
          text: {
            format: zodTextFormat(responseSchema, "ai_response"),
          },
        },
        { signal: ctrl.signal },
      );
      clearTimeout(timeoutId);

      // A null parsed output means the schema was broken or the model refused.
      const parsed = response.output_parsed;
      if (parsed) {
        return {
          ok: true,
          parsed,
          requestId: response.id,
          latencyMs: Date.now() - start,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          systemFingerprint: (response as any).system_fingerprint ?? null,
          model,
        };
      }

      //null parse -> truncation by the cap, or a genuine schema/refusal?
      const truncated =
        response.status === "incomplete" &&
        response.incomplete_details?.reason === "max_output_tokens";

      if (attempt === 0) {
        // If the reply was cut short, raise the limit before trying again. Non-reasoning
        // models double it, so a retry always has more room than the first try.
        if (truncated && cap !== null) {
          cap = isReasoning ? cap + REASONING_TOKEN_HEADROOM * 2 : cap * 2;
        }
        continue;
      }
      return {
        ok: false,
        reason: "parsed_error",
        error: truncated
          ? "truncated at max_output_tokens(after retry)"
          : "output_parsed is null - schema/refusal (after retry)",
        model,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (
        error.name === "AbortError" ||
        error.code === "ETIMEDOUT" ||
        error.message?.includes("aborted")
      ) {
        return { ok: false, reason: "timeout", error: `Timeout after ${timeoutMs}ms`, model };
      }
      if (error.status === 429) {
        return { ok: false, reason: "rate_limit", error: error.message, model };
      }
      return { ok: false, reason: "unknown", error: error.message ?? String(error), model };
    }
  }
  return { ok: false, reason: "parsed_error", error: "exhausted retries", model };
}
