// Signal Judge: one language-model call that works out two values for the Main
// Judge, the candidate in focus (focusCandidate) and the kind of exchange
// (exchangeClass). If the call fails, the rule-based version in routeContext.ts
// is used instead. Whether Alex holds an unsaid note is a database lookup, not
// part of this call.
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { Cand } from "./traitData.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 60;
const TIMEOUT_MS = 5_000;
const CONTEXT_WINDOW = 16; // the same window the Main Judge reads: the last 16 lines

export type JudgeExchangeClass =
  "substantive" | "acknowledgment" | "preference" | "procedural" | "unclear";

export interface SignalJudgeResult {
  focusCandidate: Cand | null;
  exchangeClass: JudgeExchangeClass;
}

const Schema = z.object({
  focusCandidate: z.enum(["A", "B", "C", "D"]).nullable(),
  exchangeClass: z.enum(["substantive", "acknowledgment", "preference", "procedural", "unclear"]),
});

const SYSTEM = `You analyze a live small-team chat. Two humans and an AI teammate named Alex are comparing candidates A, B, C, D for a group decision. You are given the recent chat and one anchor message: the human message that triggered this check. Return two fields.

focusCandidate — which single candidate the discussion is currently centered on:
- Track the topic, not just names. Pronouns ("he", "his salary"), phrases like "the second one", or an unbroken continuation of an earlier candidate topic still count as that candidate.
- Return exactly one of A, B, C, D when one candidate is the clear current topic.
- Return null when two or more candidates are actively being compared, when no candidate is actually under discussion, or when the topic cannot be determined.

exchangeClass — the nature of the anchor message itself:
- "substantive": real content about a candidate — facts, traits, evidence, analysis, reasoning, or a question asking for such substance. This is the common case when the people are discussing candidates.
- "acknowledgment": a low-signal social reaction with no content ("ok", "yeah", "same here", "got it").
- "preference": the speaker states their own pick or leaning ("I think B is best", "I'd go with C").
- "procedural": about the process of the discussion ("let's decide", "time to wrap up", "let's look at D next").
- "unclear": only when the message is genuinely indecipherable. A question with real substance is "substantive", not "unclear".

Output JSON only.`;

export async function deriveSignalFromLLM(input: {
  messages: Array<{ speaker: string; content: string }>;
  anchorMessage: { speaker: string; content: string };
}): Promise<SignalJudgeResult | null> {
  if (!input.messages.length || !input.anchorMessage.content.trim()) return null;

  const recentChat = input.messages
    .slice(-CONTEXT_WINDOW)
    .map((t) => `${t.speaker}: ${t.content}`)
    .join("\n");
  const anchor = `${input.anchorMessage.speaker}: ${input.anchorMessage.content}`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await client.responses.parse(
      {
        model: MODEL,
        temperature: 0,
        max_output_tokens: MAX_TOKENS,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Recent chat:\n${recentChat}\n\nAnchor message (the human message that triggered this check):\n${anchor}\n\nOutput JSON only.`,
          },
        ],
        text: { format: zodTextFormat(Schema, "signal_decision") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(to);
    return resp.output_parsed ?? null;
  } catch {
    clearTimeout(to);
    return null; // on failure the rule-based version is used
  }
}
