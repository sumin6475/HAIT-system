import { callAIStructured, type AIStructuredResult } from "./openai.js";
import { guardEnabled } from "./guardFlags.js";
import { extractHumanTraitsFast, type FastTraitCandidate } from "./poolingExtractor.js";
import type { RouteOutputScopeGuard } from "./routeContext.js";
import { log } from "./log.js";
import { TRAIT_BY_ID } from "./traitData.js";

interface GenerationLimits {
  maxOutputTokens: number | null;
  maxContentChars: number | null;
  timeoutMs: number;
}

type SuccessfulStructuredResult = Extract<AIStructuredResult, { ok: true }>;

export interface OutputRepairAttemptAudit {
  stage: "initial" | "repair";
  outcome: "accepted" | "rejected" | "failed";
  content?: string;
  responseId?: string;
  model: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  systemFingerprint?: string | null;
  extractedTraitIds?: string[];
  violations?: string[];
  softViolations?: string[];
  error?: string;
}

export interface OutputRepairAudit {
  version: 1;
  guard?: {
    candidate: RouteOutputScopeGuard["candidate"];
    reason: RouteOutputScopeGuard["reason"];
    allowedTraitIds?: string[];
    requiredTraitId?: string;
  };
  attempts: OutputRepairAttemptAudit[];
}

/** The guard as the audit records it. Two call sites had a byte-identical copy. */
function auditedGuard(guard: RouteOutputScopeGuard | undefined): OutputRepairAudit["guard"] {
  if (!guard) return undefined;
  return {
    candidate: guard.candidate,
    reason: guard.reason,
    allowedTraitIds: guard.allowedTraitIds,
    requiredTraitId: guard.requiredTraitId,
  };
}

function successfulAttemptAudit(input: {
  stage: "initial" | "repair";
  outcome: "accepted" | "rejected";
  result: SuccessfulStructuredResult;
  extractedTraitIds?: string[];
  violations?: string[];
  softViolations?: string[];
}): OutputRepairAttemptAudit {
  return {
    stage: input.stage,
    outcome: input.outcome,
    content: input.result.parsed.content,
    responseId: input.result.requestId,
    model: input.result.model,
    latencyMs: input.result.latencyMs,
    inputTokens: input.result.inputTokens,
    outputTokens: input.result.outputTokens,
    systemFingerprint: input.result.systemFingerprint,
    extractedTraitIds: input.extractedTraitIds,
    violations: input.violations,
    softViolations: input.softViolations,
  };
}

const INTERNAL_METADATA_PATTERNS = [
  /\binternal (?:conversation )?control\b/i,
  /\bserver[- ]derived\b/i,
  /\bserver[- ]calculated\b/i,
  /\binternal preference cue\b/i,
  /\bpreference decision state\b/i,
  // Every token the preference cues can produce. This list and the cue builders in
  // `routeContext` must agree, so a label such as NO_CURRENT_PREFERENCE can never
  // be repeated back to a participant.
  /\b(?:NO_CURRENT_PREFERENCE|CURRENT_CO_PREFERENCE|CURRENT_PREFERENCE)\b/i,
  /\b(?:NO_SCOPED_PREFERENCE|SCOPED_CO_PREFERENCE|SCOPED_PREFERENCE)\b/i,
  /\bdepth threshold\b/i,
  /\bfocus (?:directive|calculation)\b/i,
  /\bhuman[- ]confirmed (?:trait )?count\b/i,
  /\brouting count\b/i,
  /\bexplicit[_ -]human[_ -]focus\b/i,
  /\bconversational target:\s*Candidate\b/i,
];

const SOFT_METADATA_PATTERNS = [
  /\b(?:your|my|the) (?:prompt|instructions?|rules?|policy|system message)\b/i,
  /\b(?:prompt|instruction|policy|scope) (?:scope|limits?|restriction|prevents?|allows?)\b/i,
  /\b(?:cannot|can['’]?t|unable to) (?:share|reveal|follow|answer).{0,48}\b(?:prompt|instructions?|rules?|policy|scope)\b/i,
];

export function internalMetadataLeak(content: string): string | null {
  return INTERNAL_METADATA_PATTERNS.some((pattern) => pattern.test(content))
    ? "internal_metadata_leak"
    : null;
}

export function internalMetadataSoftViolations(content: string): string[] {
  return SOFT_METADATA_PATTERNS.some((pattern) => pattern.test(content))
    ? ["metadata_reference"]
    : [];
}

/**
 * What this turn shared, for the output checks.
 *
 * Uses the deterministic matcher over the closed trait pool. It runs without the
 * network, so it cannot time out, and it has no failure that looks like "nothing
 * was shared"; an empty result from a failed model call would let every check
 * pass silently. Alex's own wording stays close to the trait text because the
 * output rules ask it to keep each trait's key wording, so the matcher fits
 * Alex's messages well.
 *
 * It also keeps model calls off the generation path.
 */
function disclosedTraitIds(
  content: string,
  guard?: RouteOutputScopeGuard,
): { ids: string[]; unresolvedCandidates: FastTraitCandidate[] } {
  const extraction = extractHumanTraitsFast({ messageText: content });
  const disclosed = new Set(extraction.acceptedIds);
  // Alex's message is a closed question and a human's is an open one. A
  // participant's sentence could be about any of the forty traits or none, so a
  // near match goes to the verifier. Alex was told what it may share, so a near
  // match on one of those ids is that id and nothing else; there is nothing for the
  // verifier to settle. Without this, a trait Alex stated in slightly different
  // words would fail `selected_trait_missing` and the turn would be lost.
  //
  // Not filtered to profile Z: this pass also counts Alex repeating a human's
  // trait, which is outside Alex's notes by definition.
  const permitted = new Set(
    [...(guard?.allowedTraitIds ?? []), guard?.requiredTraitId].filter(
      (id): id is string => typeof id === "string",
    ),
  );
  if (permitted.size) {
    for (const candidate of extraction.verificationCandidates) {
      if (permitted.has(candidate.traitId)) disclosed.add(candidate.traitId);
    }
  }
  // What is left is a near match on an id this turn was not allowed to say. The
  // guard cannot act on it: a near match is not enough evidence to cost a turn, and
  // settling it needs a model call, which may not sit before the broadcast. It is
  // kept as a verification candidate, so the board can still get it from the late
  // check.
  return {
    ids: [...disclosed],
    unresolvedCandidates: extraction.verificationCandidates.filter(
      (candidate) => !disclosed.has(candidate.traitId),
    ),
  };
}

/**
 * What is wrong with a generated message, factually.
 *
 * Two questions. The Judge names what this turn may put on the board, so "did
 * anything else appear" is the whole factual check. Counting traits, repeats,
 * sentences or words is not used: once the content is named such counts add
 * nothing, and a count limit asks the model to "say less about the same thing",
 * which it can rarely do without failing the task.
 */
export function outputScopeViolation(
  content: string,
  extractedIds: string[],
  guard: RouteOutputScopeGuard,
  previouslySurfacedTraitIds: readonly string[] = [],
  /**
   * The traits already in the message Alex is replying to.
   *
   * A trait the other person just said, repeated in the reply to them, is neither
   * sharing nor reciting; it is taking up what was said, which every route prompt
   * asks for. If the participant introduced it, Alex echoing it is not Alex
   * introducing it.
   */
  echoedTraitIds: readonly string[] = [],
): string | null {
  const previouslySurfaced = new Set(previouslySurfacedTraitIds);
  const echoed = new Set(echoedTraitIds);
  const contributedIds = extractedIds.filter((id) => !echoed.has(id));
  const newlyIntroducedIds = contributedIds.filter((id) => !previouslySurfaced.has(id));
  // Nothing outside what the Judge named.
  if (
    guard.allowedTraitIds &&
    newlyIntroducedIds.some((id) => !guard.allowedTraitIds!.includes(id))
  ) {
    return "trait_outside_selected_contribution";
  }
  // When the Judge named exactly one fact, the turn exists to say it.
  //
  // Not applied to longer lists: requiring every id of six would lose the turn to
  // one paraphrase the matcher did not recognise. Catching a turn that leaves out
  // its one assigned fact is worth that cost; catching a turn that says five of six
  // is not.
  if (guard.requiredTraitId && !extractedIds.includes(guard.requiredTraitId)) {
    return "selected_trait_missing";
  }
  return null;
}

/**
 * Whether a generated message asks the reader something.
 *
 * Just a question mark and nothing cleverer. The rule it enforces is the
 * prompt's own sentence ("do not ask a question, end with a question mark, or
 * request information"), so matching it exactly makes the output check and the
 * prompt the same rule.
 *
 * It guards the manipulation, not the prose: the Judge decides what a turn says,
 * never how it is punctuated, and an explanatory Alex that asks for
 * clarification is acting out the condition it is contrasted with.
 */
export function outputAsksAQuestion(content: string): boolean {
  return content.includes("?");
}

/**
 * The three independent reasons a draft can be rejected, folded into one
 * verdict.
 *
 * Extracted because the folding is where a new check gets lost. The question
 * post-condition has to reach the repair loop on turns with **no guard**, and
 * the guard is what the scope branch keys off — so "does a lone question
 * violation trigger a repair" is a real question with a wrong answer available,
 * and one that needs no model call to ask.
 *
 * `primary` is what the repair prompt and the log name. Metadata leaks lead
 * because they are the only class that can make a message unusable rather than
 * merely wrong.
 */
export function outputVerdict(input: {
  metadata: string | null;
  question: string | null;
  scope: string | null;
}): { needsRepair: boolean; violations: string[]; primary: string | null } {
  const violations = [input.metadata, input.question, input.scope].filter(
    (value): value is string => Boolean(value),
  );
  return { needsRepair: violations.length > 0, violations, primary: violations[0] ?? null };
}

export interface DraftEvaluation {
  extractedIds?: string[];
  /**
   * The traits already in the message being replied to, as this check read them.
   * Returned rather than recomputed later, so the check after the broadcast uses
   * the same echo set.
   */
  echoedTraitIds?: string[];
  /**
   * Near matches on ids this turn was not permitted to say, left for the same
   * bounded verifier the human path uses. They are settled after the broadcast
   * and never before it, so they cost the turn no latency and can only correct
   * the record — never block a message.
   */
  unresolvedCandidates?: FastTraitCandidate[];
  metadata: string | null;
  question: string | null;
  scope: string | null;
  violations: string[];
  softViolations: string[];
  primary: string | null;
  needsRepair: boolean;
}

/**
 * Everything that can be wrong with one generated message.
 *
 * The first draft and the rewritten one are checked by this same function, so
 * the rewrite is tested against every rule the first draft was.
 */
export function evaluateDraft(input: {
  content: string;
  guard?: RouteOutputScopeGuard;
  previouslySurfacedTraitIds?: readonly string[];
  /**
   * The text Alex is replying to. The echo set is worked out from it here, with
   * the same extractor the draft is measured by, so both sides of the comparison
   * always match.
   */
  repliedToContent?: string;
  forbidQuestion?: boolean;
}): DraftEvaluation {
  const disclosed = input.guard ? disclosedTraitIds(input.content, input.guard) : undefined;
  const extractedIds = disclosed?.ids;
  // The echo set is read with no guard, deliberately. Alex's own draft is a
  // closed question — the turn named what it was permitted to say — but the
  // message being replied to is a participant's, and a participant's sentence
  // could be about any of the forty traits or none. That is the open rule, and
  // it is the same rule the human path applies to the same text.
  const echoedTraitIds =
    input.guard && input.repliedToContent ? disclosedTraitIds(input.repliedToContent).ids : [];
  const metadata = internalMetadataLeak(input.content);
  const question =
    input.forbidQuestion && outputAsksAQuestion(input.content) ? "answered_with_a_question" : null;
  // When the scope-check flag is off, the message is sent instead of the turn
  // being dropped, so the two runs can be compared. `extractedIds` is still worked
  // out, so a comparison run still shows what the check would have caught.
  const scope =
    input.guard && guardEnabled("outputScope")
      ? outputScopeViolation(
          input.content,
          extractedIds ?? [],
          input.guard,
          input.previouslySurfacedTraitIds,
          echoedTraitIds,
        )
      : null;
  const verdict = outputVerdict({ metadata, question, scope });
  return {
    extractedIds,
    echoedTraitIds: input.guard ? echoedTraitIds : undefined,
    unresolvedCandidates: disclosed?.unresolvedCandidates,
    metadata,
    question,
    scope,
    // Only the metadata signals are observed without being repaired.
    softViolations: internalMetadataSoftViolations(input.content),
    violations: verdict.violations,
    primary: verdict.primary,
    needsRepair: verdict.needsRepair,
  };
}

/** What the rewrite is told it did wrong, before it is told the bounds. */
// The two violations `outputScopeViolation` can produce.
const VIOLATION_LEAD: Record<string, string> = {
  trait_outside_selected_contribution:
    "Your message included a trait outside the one point this turn may contribute.",
  selected_trait_missing: "Your message left out the point this turn was supposed to make.",
};

/**
 * The instruction a rejected draft is sent back with.
 *
 * The violation comes first, so the model knows what it got wrong, followed by
 * every limit in force, because the rewrite is checked against all of them.
 * There is only one rewrite attempt (`MAX_REPAIR_ATTEMPTS` is 1), so it has to be
 * fully informed.
 */
export function repairCorrectionFor(input: {
  violation: string;
  guard?: RouteOutputScopeGuard;
}): string {
  const guard = input.guard;
  if (!guard) return VIOLATION_LEAD[input.violation] ?? "";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lines: (string | null)[] = [
    VIOLATION_LEAD[input.violation] ?? null,
    guard.reason === "mediation_no_new_traits"
      ? "Do not introduce any candidate trait that was not already visible in the conversation. You may briefly refer to already-visible points while stating only the discussion state and next direction."
      : null,
    guard.candidate
      ? `Write about Candidate ${guard.candidate} only and do not mention another candidate.`
      : null,
    guard.requiredTraitId
      ? `The only candidate trait you may mention is: "${TRAIT_BY_ID.get(guard.requiredTraitId)?.text ?? guard.requiredTraitId}". Include that exact point and no other candidate trait, even if another trait was already discussed.`
      : null,
    // The rewrite is told every limit in force, and there is one: the list of facts.
    // Naming the facts is also what makes the instruction possible to follow; "share
    // at most one" would leave the model choosing which to cut.
    guard.allowedTraitIds && !guard.requiredTraitId
      ? guard.allowedTraitIds.length
        ? `The only candidate facts you may introduce are: ${guard.allowedTraitIds
            .map((id) => `"${TRAIT_BY_ID.get(id)?.text ?? id}"`)
            .join("; ")}. Introduce no other candidate fact.`
        : "Introduce no candidate fact that is not already visible in the conversation. You may refer to what has already been said."
      : null,
  ];
  return lines.filter((line): line is string => Boolean(line)).join(" ");
}

export const MAX_REPAIR_ATTEMPTS = 1;

export async function generateScopedRouteMessage(input: {
  systemPrompt: string;
  developerPrompt?: string;
  userPrompt: string;
  limits: GenerationLimits;
  guard?: RouteOutputScopeGuard;
  previouslySurfacedTraitIds?: string[];
  /**
   * The message this turn is replying to, for the echo exemption.
   */
  repliedToContent?: string;
  /**
   * Set for the explanatory (XAI) conditions. Checked outside `guard` because it
   * must hold on every turn, including turns that have no guard.
   */
  forbidQuestion?: boolean;
  logContext: string;
}): Promise<{
  result: AIStructuredResult;
  extractedIds?: string[];
  /** Near matches the guard could not settle, for the post-broadcast verifier. */
  unresolvedCandidates?: FastTraitCandidate[];
  /** The echo set the guard used, so the post-broadcast record can reuse it. */
  echoedTraitIds?: string[];
  scopeRepair?: { violation: string; candidate?: string };
  internalMetadataRepair?: { violation: string };
  repairAudit?: OutputRepairAudit;
}> {
  let result = await callAIStructured({
    systemPrompt: input.systemPrompt,
    developerPrompt: input.developerPrompt,
    userPrompt: input.userPrompt,
    ...input.limits,
  });
  if (!result.ok) return { result };

  const evaluate = (content: string) =>
    evaluateDraft({
      content,
      guard: input.guard,
      previouslySurfacedTraitIds: input.previouslySurfacedTraitIds,
      repliedToContent: input.repliedToContent,
      forbidQuestion: input.forbidQuestion,
    });
  const initial = evaluate(result.parsed.content);
  let extractedIds = initial.extractedIds;
  // Always the evaluation of the draft that is actually returned, so a repaired
  // message never carries the initial draft's leftovers.
  let unresolvedCandidates = initial.unresolvedCandidates;
  // The message being replied to does not change between drafts, so this is
  // constant across the repair loop; carried anyway so every return path has it.
  const echoedTraitIds = initial.echoedTraitIds;
  const metadataViolation = initial.metadata;
  const questionViolation = initial.question;
  const scopeViolation = initial.scope;
  let softViolations = initial.softViolations;
  const verdict = initial;
  if (!verdict.needsRepair) {
    if (!softViolations.length)
      return { result, extractedIds, unresolvedCandidates, echoedTraitIds };
    return {
      result,
      extractedIds,
      unresolvedCandidates,
      echoedTraitIds,
      repairAudit: {
        version: 1,
        guard: auditedGuard(input.guard),
        attempts: [
          successfulAttemptAudit({
            stage: "initial",
            outcome: "accepted",
            result,
            extractedTraitIds: extractedIds,
            softViolations,
          }),
        ],
      },
    };
  }

  const initialViolations = verdict.violations;
  const repairAudit: OutputRepairAudit = {
    version: 1,
    guard: auditedGuard(input.guard),
    attempts: [
      successfulAttemptAudit({
        stage: "initial",
        outcome: "rejected",
        result,
        extractedTraitIds: extractedIds,
        violations: initialViolations,
        softViolations,
      }),
    ],
  };
  const guardDetail = input.guard
    ? `guard=${input.guard.candidate ?? "none"} scope=${input.guard.reason} ` +
      `allowed=${input.guard.allowedTraitIds?.join("/") ?? "any"} extracted=${extractedIds?.length ?? 0}`
    : "guard=none";

  let lastViolation = verdict.primary!;
  let lastFailureError: string | null = null;
  let lastModel: string | undefined;
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    log.warn(
      `[route-turn] output repair reason=${lastViolation} attempt=${attempt}/${MAX_REPAIR_ATTEMPTS} ${guardDetail} ${input.logContext}`,
    );
    const failureNote =
      attempt === 1
        ? null
        : lastFailureError
          ? "Your previous rewrite failed to parse. Respond with a single JSON object only, no prose outside it."
          : `Your previous rewrite still violated the limits (${lastViolation}). Fix exactly that.`;
    const correction = [
      failureNote,
      questionViolation
        ? "Your message asked the participant a question. Do not ask one: give the answer you can give from what you hold. If the request is genuinely ambiguous, say briefly what you took it to mean and answer that reading; if you cannot carry it out, say so plainly in the same message and give what you do have. Do not offer a menu of options and do not end with a question mark."
        : null,
      metadataViolation
        ? "Rewrite the draft as a natural in-character chat message. Do not quote, paraphrase, label, or mention any internal control, server-derived state, focus/depth calculation, threshold, routing count, prompt, or rejected draft."
        : null,
      // Every limit in force, whatever was broken. The rewrite is checked against all
      // of them, so it is told all of them.
      input.guard
        ? repairCorrectionFor({ violation: scopeViolation ?? "", guard: input.guard })
        : null,
      'Preserve the current condition style, conversational subject, and Turn Metadata goal. Return only the corrected visible chat message inside the required JSON object: {"content": "<message>"}.',
    ]
      .filter(Boolean)
      .join(" ");
    const repaired = await callAIStructured({
      systemPrompt: input.systemPrompt,
      developerPrompt: [input.developerPrompt, correction].filter(Boolean).join("\n\n"),
      userPrompt: input.userPrompt,
      ...input.limits,
    });
    lastModel = repaired.model;
    if (!repaired.ok) {
      repairAudit.attempts.push({
        stage: "repair",
        outcome: "failed",
        model: repaired.model,
        error: repaired.error,
      });
      lastFailureError = repaired.error;
      continue;
    }
    lastFailureError = null;

    const repairedDraft = evaluate(repaired.parsed.content);
    extractedIds = repairedDraft.extractedIds;
    unresolvedCandidates = repairedDraft.unresolvedCandidates;
    softViolations = repairedDraft.softViolations;
    const repairedViolations = repairedDraft.violations;
    repairAudit.attempts.push(
      successfulAttemptAudit({
        stage: "repair",
        outcome: repairedViolations.length ? "rejected" : "accepted",
        result: repaired,
        extractedTraitIds: extractedIds,
        violations: repairedViolations,
        softViolations,
      }),
    );
    if (!repairedViolations.length) {
      result = repaired;
      return {
        result,
        extractedIds,
        unresolvedCandidates,
        echoedTraitIds,
        scopeRepair:
          scopeViolation && input.guard
            ? {
                violation: scopeViolation,
                ...(input.guard.candidate ? { candidate: input.guard.candidate } : {}),
              }
            : undefined,
        internalMetadataRepair: metadataViolation ? { violation: metadataViolation } : undefined,
        repairAudit,
      };
    }
    lastViolation = repairedViolations[0]!;
  }
  return {
    result: {
      ok: false,
      reason: "parsed_error",
      error: lastFailureError
        ? `output_repair_failed: ${lastFailureError}`
        : `output_violation_after_repair: ${lastViolation}`,
      ...(lastModel !== undefined ? { model: lastModel } : {}),
    } as AIStructuredResult,
    repairAudit,
  };
}
