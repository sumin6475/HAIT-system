import {
  contributesToBoard,
  type CommunicativeAct,
  type ConditionCode,
  type RouteKind,
} from "../types.js";
import { guardEnabled } from "./guardFlags.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";
import { coverageGapNote } from "./candidateList.js";
import { currentTopicCandidate } from "./poolingTally.js";
import {
  CANDIDATES,
  aiSurfacedIds,
  allSurfacedIds,
  humanConfirmedIds,
  lastHumanDiscussionCandidate,
} from "./informationPools.js";
import { deriveSignalFromLLM, type JudgeExchangeClass } from "./signalJudge.js";
// The one detector that guards against the English article "a". `candidateMentions`
// below is the request classifier's looser reading.
import { literalCandidateMentions } from "./conversationObserver.js";

export interface TranscriptMessage {
  seq: number;
  senderRole: string;
  speaker: string;
  content: string;
}

// The Chair conditions are defined here and only here (interventionEngine uses this too).
/**
 * Whether this condition's Alex must not put a question in its message.
 *
 * The XAI prompts say "Do not ask a question, end with a question mark, or
 * request information", and a prompt rule alone is not always followed, so this
 * is also checked on the output, like the trait limit.
 *
 * It depends on the communication strategy, not the role: asking questions is
 * the ACI manipulation, so an XAI Alex that asks for clarification is acting out
 * the condition it is contrasted with. That is why this reads the condition and
 * not the route.
 */
export function forbidsQuestionOutput(conditionCode: ConditionCode): boolean {
  return conditionCode === "C1" || conditionCode === "C2";
}

export function isLeaderCondition(conditionCode: ConditionCode): boolean {
  return conditionCode === "C2" || conditionCode === "C4";
}

export type TaskGroundingSignal =
  "none" | "task_standard_drift" | "distributed_information_question";

/**
 * Deterministic guard for the two task facts that must not be negotiated by
 * the conversational model: equal criterion weight and distributed files.
 */
export function taskGroundingSignal(content: string): TaskGroundingSignal {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (
    /\b(?:my|your|our)\s+(?:list|notes?)\b/i.test(normalized) &&
    /\b(?:differ|different|don'?t have|do not have|not (?:on|in)|why)\b/i.test(normalized)
  ) {
    return "distributed_information_question";
  }
  const explicitlyEqual = /\b(?:all|every|each)\b.{0,35}\bequally important\b/i.test(normalized);
  if (
    !explicitlyEqual &&
    (/\b(?:more|most|less|least)\s+(?:important|relevant|valuable)\b/i.test(normalized) ||
      /\b(?:communication|resilience|stress|human (?:quality|qualities|abilit(?:y|ies)))\b.{0,30}\b(?:key|essential|important|matter|should|must)\b/i.test(
        normalized,
      ) ||
      /\b(?:looking for|need|want)\b.{0,35}\b(?:human (?:quality|qualities|abilit(?:y|ies))|pilot qualities)\b/i.test(
        normalized,
      ) ||
      /\bqualit(?:y|ies)\b.{0,35}\bmore human\b/i.test(normalized) ||
      /\bsomething\b.{0,40}\b(?:computer|AI|autopilot)\b.{0,20}\b(?:cannot|can not|can'?t)\b/i.test(
        normalized,
      ) ||
      /\b(?:role|captain|pilot)\b.{0,80}\bshould be able\b/i.test(normalized))
  ) {
    return "task_standard_drift";
  }
  return "none";
}

/**
 * Whether Alex has already grounded the group during this window.
 *
 * Matched against Alex's own earlier messages, never a participant's. The forms
 * below are fixed strings, so a signature over their invariant wording is exact
 * enough for the one thing it decides: which of two forms this turn takes.
 *
 * The intervention record already stores `taskGroundingSignal` per turn and would
 * answer this more directly, but this seam receives the transcript and not the
 * audit rows. Reading them here would put a database round trip on the context
 * build for a choice between two sentences.
 */
const TASK_GROUNDING_SIGNATURE =
  /extra weight|counting equally|counts the same|does not outweigh|distributed across the board/i;

function taskGroundingAlreadyDelivered(
  window: readonly TranscriptMessage[],
  anchorSeq: number,
): boolean {
  return window.some(
    (message) =>
      message.senderRole === "ai" &&
      message.seq < anchorSeq &&
      TASK_GROUNDING_SIGNATURE.test(message.content),
  );
}

function deterministicTaskGroundingResponse(input: {
  signal: TaskGroundingSignal;
  conditionCode: ConditionCode;
  content: string;
  /**
   * True when Alex has grounded the group before in this window. The facts are
   * the same either way; only the form changes, so the correction does not
   * arrive twice as the identical sentence.
   */
  repeat: boolean;
}): string | null {
  if (input.signal === "distributed_information_question") {
    return input.repeat
      ? "As before, the files are distributed across the board, so a difference between our lists is expected rather than an error. Shall we put the parts that differ side by side?"
      : "The candidate files are distributed across the board, so different members can legitimately have different traits for the same candidate. Our lists can differ without either one being wrong.";
  }
  if (input.signal === "task_standard_drift") {
    // Task-standard correction is a leader responsibility. Peer conditions
    // retain their ordinary response path and do not mediate the group's frame.
    if (!isLeaderCondition(input.conditionCode)) return null;
    const humanQualityFrame = /\b(?:human|computer|AI|autopilot)\b/i.test(input.content);
    const communicationFrame = /\bcommunication\b/i.test(input.content);
    const candidate = (["A", "B", "C", "D"] as Cand[]).find((item) =>
      new RegExp(`\\b(?:candidate\\s+)?${item}\\b`).test(input.content),
    );
    if (input.conditionCode === "C4") {
      // The Chair's repeat is a question in C4 and a statement in C2, matching the
      // difference the two conditions already have: C4 ends its turns by drawing the
      // team out, C2 does not. Giving C2 a question would change a manipulated
      // variable, so C2 varies within its own statement style instead.
      if (input.repeat) {
        return "The standard has not moved: no item weighs more than another. With every MATCH and MISS counting equally, whose complete profile should the team take next?";
      }
      return humanQualityFrame
        ? "Human qualities are still individual MATCH or MISS items and do not receive extra weight. Which candidate's complete profile should the team compare under the same standard first?"
        : communicationFrame
          ? `Communication is one item in the complete profile, but it does not outweigh the other MATCH or MISS items. Which other parts of ${candidate ? `Candidate ${candidate}'s` : "that candidate's"} profile should the team place beside it?`
          : "No single item receives extra weight. Which candidate's complete MATCH-and-MISS profile should the team compare first?";
    }
    return input.repeat
      ? "The standard is the same as before: no quality weighs more than another, so each candidate's complete profile stands or falls on every MATCH and MISS counting equally."
      : "No single quality receives extra weight. The team should compare each candidate's complete profile with every MATCH and MISS counting equally.";
  }
  return null;
}

/**
 * How many of Alex's own disclosures the generator is told about.
 *
 * The set this is drawn from grows for the whole session, and an unbounded
 * prompt addition would keep raising the cost of each turn. Twelve points is
 * roughly 120 tokens and does not grow with session length. Most recent first, because the recital shape restates what is freshest.
 */
const ALREADY_STATED_LIMIT = 12;

/**
 * What Alex has already put in view, told to the message writer.
 *
 * The writer is told what it has already said, so it has a reason not to say it
 * again.
 *
 * It covers Alex's own disclosures only. A trait a human put on the board is not
 * in it, so Alex never presents a human's trait as "my notes".
 *
 * The set is Alex's own surfaced traits and nothing else. Surfaced means said
 * aloud, by anyone, and its only use is avoiding repetition; it must never stand
 * in for `humanConfirmedIds`, which is what Alex may treat as grounded. So this
 * reads `aiSurfacedIds` directly, and nothing downstream reads this block.
 */
function formatAlreadyStatedByYou(revealStats: any): string | null {
  const surfaced = [...aiSurfacedIds(revealStats)].reverse();
  if (!surfaced.length) return null;
  const shown = surfaced.slice(0, ALREADY_STATED_LIMIT);
  const points = shown
    .map((id) => {
      const trait = TRAIT_BY_ID.get(id)!;
      return `Candidate ${trait.candidate}: ${trait.text}`;
    })
    .join("; ");
  return [
    `Already stated by you (server-derived): you have already put these points in view — ${points}.`,
    surfaced.length > shown.length
      ? `Those are your ${ALREADY_STATED_LIMIT} most recent; you have said more earlier.`
      : null,
    "Do not restate them as if they were new and do not recite them back. Refer to one only if this turn genuinely needs it, and prefer a point you have not made yet.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The task correction as an instruction to the message writer, for turns where
 * the fixed sentence must not be used.
 *
 * The fixed sentence is a whole reply, so using it gives up everything else the
 * turn needed to answer. When a message both drifts from the task standard and,
 * for example, sets a candidate aside, this block lets the turn correct the
 * drift and still answer the rest.
 *
 * The role gate matches the fixed sentence's exactly. This is a second form of
 * the same correction, never a second way to trigger it: a Member gains nothing
 * here, and nothing in this function affects the decision to speak. It runs only
 * after a turn has been routed.
 */
function taskGroundingInstructionBlock(input: {
  signal: TaskGroundingSignal;
  conditionCode: ConditionCode;
}): string | null {
  if (input.signal === "distributed_information_question") {
    return "Task standard (server-derived): a participant is treating a difference between the lists as an error. Say briefly that the candidate files are distributed across the board, so members can legitimately hold different traits for the same candidate, and that every match and miss counts the same. Then also respond to what else their message put on the table — do not drop their point in order to make the correction.";
  }
  if (input.signal !== "task_standard_drift" || !isLeaderCondition(input.conditionCode))
    return null;
  return "Task standard (server-derived): a participant has just weighted one quality above another. Say plainly, once, that no item receives extra weight and that every match and miss counts the same. Then also respond to what else their message put on the table — do not drop their point in order to make the correction.";
}

/**
 * Compact, server-derived input for the Main Judge. This intentionally carries
 * only a focus, an exchange class, and the eligible unsurfaced Alex-note ids—not
 * raw tally state or a second interpretation of the conversation.
 */
export interface MainJudgeSignal {
  focusCandidate: Cand | null;
  exchangeClass: JudgeExchangeClass;
  privateContributionAvailable: boolean;
  privateContributionIds: string[];
}

const ACKNOWLEDGMENT_ONLY =
  /^\s*(?:ok(?:ay)?|yeah|yep|right|same here|me too|i agree|exactly|got it|thanks|fair enough)[.!\s]*$/i;
const PROCEDURAL_MESSAGE =
  /\b(?:let'?s|we should|we need to|time to|move on|sum up|wrap up|decide|vote|pick|choose|go through)\b/i;
const PREFERENCE_MESSAGE =
  /\b(?:i think|i prefer|i choose|i'?m leaning|my pick|best|worst|strongest|weakest)\b/i;
const QUESTION_LIKE = /\?\s*$|^\s*(?:what|which|who|how|why|can|could|would|do|does|is|are)\b/i;

function judgeAnchorHumanMessage(
  messages: TranscriptMessage[],
  anchorSeq: number,
): TranscriptMessage | undefined {
  return (
    messages.find((message) => message.seq === anchorSeq && message.senderRole !== "ai") ??
    [...messages].reverse().find((message) => message.senderRole !== "ai")
  );
}

function classifyJudgeExchange(message?: TranscriptMessage): JudgeExchangeClass {
  const content = message?.content.trim() ?? "";
  if (!content) return "unclear";
  if (ACKNOWLEDGMENT_ONLY.test(content)) return "acknowledgment";
  if (PROCEDURAL_MESSAGE.test(content)) return "procedural";
  if (PREFERENCE_MESSAGE.test(content)) return "preference";
  if (QUESTION_LIKE.test(content)) return "unclear";
  return "substantive";
}

function privateContributionIdsFor(focusCandidate: Cand | null, revealStats: any): string[] {
  if (!focusCandidate) return [];
  const surfaced = allSurfacedIds(revealStats);
  return ALEX_Z_IDS.filter(
    (id) => TRAIT_BY_ID.get(id)?.candidate === focusCandidate && !surfaced.has(id),
  );
}

/**
 * Rule-based signal: used when the language-model call fails, and as a
 * synchronous path for unit tests.
 */
export function deriveMainJudgeSignalFromRules(input: {
  messages: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
}): MainJudgeSignal {
  const topicFromTranscript = currentTopicCandidate(
    input.messages.map((message) => ({ sender: message.speaker, content: message.content })),
  );
  const recentSeqFloor = Math.max(0, input.anchorSeq - 8);
  const focusCandidate =
    topicFromTranscript ?? lastHumanDiscussionCandidate(input.revealStats, recentSeqFloor);
  const privateContributionIds = privateContributionIdsFor(focusCandidate, input.revealStats);
  return {
    focusCandidate,
    exchangeClass: classifyJudgeExchange(judgeAnchorHumanMessage(input.messages, input.anchorSeq)),
    privateContributionAvailable: privateContributionIds.length > 0,
    privateContributionIds,
  };
}

/**
 * Main Judge signal: the language model first, the rules if it fails. If the
 * human message is missing or empty, the rules are used without a model call.
 * privateContributionAvailable is always worked out by the server, whatever the
 * source of the focus.
 */
export async function deriveMainJudgeSignal(input: {
  messages: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
}): Promise<MainJudgeSignal> {
  const anchor = judgeAnchorHumanMessage(input.messages, input.anchorSeq);
  if (anchor && anchor.content.trim()) {
    const llmSignal = await deriveSignalFromLLM({
      messages: input.messages.map(({ speaker, content }) => ({ speaker, content })),
      anchorMessage: { speaker: anchor.speaker, content: anchor.content },
    });
    if (llmSignal) {
      const privateContributionIds = privateContributionIdsFor(
        llmSignal.focusCandidate,
        input.revealStats,
      );
      return {
        ...llmSignal,
        privateContributionAvailable: privateContributionIds.length > 0,
        privateContributionIds,
      };
    }
  }
  return deriveMainJudgeSignalFromRules(input);
}

function formatCoverageFromIds(surfaced: Set<string>, includeUntouched = true): string {
  const blocks: string[] = [];
  const untouched: Cand[] = [];
  for (const candidate of CANDIDATES) {
    const traits = [...surfaced]
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait) => trait?.candidate === candidate);
    if (!traits.length) {
      untouched.push(candidate);
      continue;
    }
    const matches = traits.filter((trait) => trait?.valence === "pos");
    const misses = traits.filter((trait) => trait?.valence === "neg");
    blocks.push(
      [
        `Candidate ${candidate} — ${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${misses.length} ${misses.length === 1 ? "miss" : "misses"}`,
        `  Matches: ${matches.map((trait) => trait!.text).join("; ") || "—"}`,
        `  Misses: ${misses.map((trait) => trait!.text).join("; ") || "—"}`,
      ].join("\n"),
    );
  }
  if (includeUntouched && untouched.length) blocks.push(`Still to cover: ${untouched.join(", ")}`);
  return blocks.join("\n\n") || "No confirmed candidate information is on the table yet.";
}

/** Human-grounded board used for depth, eligibility, preference, and intervention judgment. */
export function formatConfirmedCoverage(revealStats: any): string {
  return formatCoverageFromIds(humanConfirmedIds(revealStats));
}

/** Everything visibly stated in chat, used for participant-facing summary and closing recaps. */
export function formatVisibleBoardCoverage(revealStats: any): string {
  return formatCoverageFromIds(
    new Set([...allSurfacedIds(revealStats), ...humanConfirmedIds(revealStats)]),
  );
}

/** Everything Alex can use for a personal read: complete Z notes plus shared facts. */
export function knownTraitIds(revealStats: any): Set<string> {
  return new Set([
    ...ALEX_Z_IDS,
    ...allSurfacedIds(revealStats),
    ...humanConfirmedIds(revealStats),
  ]);
}

/**
 * The summary participants see, built entirely from the visible board in a
 * fixed layout. Keeping the facts out of model generation prevents omissions,
 * candidate swaps, and cut-off text.
 */
export function formatDeterministicSummary(revealStats: any, conditionCode: ConditionCode): string {
  const surfaced = new Set([...allSurfacedIds(revealStats), ...humanConfirmedIds(revealStats)]);
  const coverage = formatCoverageFromIds(surfaced);
  const untouched = CANDIDATES.filter(
    (candidate) => ![...surfaced].some((id) => TRAIT_BY_ID.get(id)?.candidate === candidate),
  );
  const factualBody = coverage.startsWith("No confirmed candidate information")
    ? `Still to cover: ${CANDIDATES.join(", ")}`
    : coverage.includes("Still to cover:")
      ? coverage
      : `${coverage}\n\nAll candidates have at least one confirmed point on the table.`;
  const ending =
    conditionCode === "C4"
      ? untouched.length
        ? `Which of the still-uncovered candidates should the team put on the table next?`
        : "Which of these candidate differences should we resolve next to move toward a decision?"
      : untouched.length
        ? `Remaining coverage: ${untouched.map((candidate) => `Candidate ${candidate}`).join(", ")} ${untouched.length === 1 ? "is" : "are"} not yet on the table; the next step is to add that coverage before deliberating across the full field.`
        : "All finalists now have some on-table information; the next step is to resolve the most relevant differences in these visible profiles.";

  return `Quick check-in\n\n${factualBody}\n\n${ending}`;
}

export interface PreferenceDecision {
  eligible: boolean;
  scope: "none" | "partial" | "full";
  comparedCandidates: Cand[];
  /**
   * Every compared candidate, best first, tied candidates grouped together.
   * `leaders` is its first group; nothing reads past that group today except
   * the Judge's own-read sentence, which needs the order to answer a narrowing
   * the humans made ("between B and D, which?").
   */
  ranking: Cand[][];
  leaders: Cand[];
  candidate: Cand | null;
  reason: "insufficient_comparable_coverage" | "top_ratio_tie" | "unique_top_ratio";
  rows: Record<Cand, { matches: number; misses: number; total: number; ratio: number | null }>;
}

export function decidePreferenceFromKnownCoverage(revealStats: any): PreferenceDecision {
  // Alex's preference uses everything Alex can legitimately know: the complete
  // Z profile plus every trait that has entered the shared conversation.
  const surfaced = knownTraitIds(revealStats);
  const rows = {} as PreferenceDecision["rows"];

  for (const candidate of CANDIDATES) {
    const traits = [...surfaced]
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait) => trait?.candidate === candidate);
    const matches = traits.filter((trait) => trait?.valence === "pos").length;
    const misses = traits.filter((trait) => trait?.valence === "neg").length;
    rows[candidate] = {
      matches,
      misses,
      total: matches + misses,
      ratio: misses === 0 ? null : matches / misses,
    };
  }

  // Compare only profiles with enough two-sided known information. Alex's own
  // profile normally makes all four candidates eligible; the threshold remains
  // as a defensive guard for malformed or incomplete datasets.
  const comparedCandidates = CANDIDATES.filter(
    (candidate) =>
      rows[candidate].matches > 0 && rows[candidate].misses > 0 && rows[candidate].total >= 3,
  );
  if (comparedCandidates.length < 2) {
    return {
      eligible: false,
      scope: "none",
      comparedCandidates,
      ranking: [],
      leaders: [],
      candidate: null,
      reason: "insufficient_comparable_coverage",
      rows,
    };
  }

  // The full order, by the same exact-fraction comparison as the leaders below,
  // so the two can never disagree about who is ahead of whom.
  const ahead = (left: Cand, right: Cand) =>
    rows[left].matches * rows[right].misses - rows[right].matches * rows[left].misses;
  const ranking: Cand[][] = [];
  for (const candidate of [...comparedCandidates].sort((left, right) => ahead(right, left))) {
    const last = ranking.at(-1);
    if (last && ahead(candidate, last[0]!) === 0) last.push(candidate);
    else ranking.push([candidate]);
  }

  // Compare fractions exactly so floating-point rounding cannot create or hide a tie.
  let leaders: Cand[] = [];
  for (const candidate of comparedCandidates) {
    if (!leaders.length) {
      leaders = [candidate];
      continue;
    }
    const row = rows[candidate];
    const leader = rows[leaders[0]!];
    const comparison = row.matches * leader.misses - leader.matches * row.misses;
    if (comparison > 0) leaders = [candidate];
    else if (comparison === 0) leaders.push(candidate);
  }

  if (leaders.length > 1) {
    return {
      eligible: true,
      scope: comparedCandidates.length === CANDIDATES.length ? "full" : "partial",
      comparedCandidates,
      ranking,
      leaders,
      candidate: null,
      reason: "top_ratio_tie",
      rows,
    };
  }
  return {
    eligible: true,
    scope: comparedCandidates.length === CANDIDATES.length ? "full" : "partial",
    comparedCandidates,
    ranking,
    leaders,
    candidate: leaders[0]!,
    reason: "unique_top_ratio",
    rows,
  };
}

export function preferredCandidateFromKnownCoverage(revealStats: any): Cand | null {
  return decidePreferenceFromKnownCoverage(revealStats).candidate;
}

function formatCandidateList(candidates: Cand[]): string {
  const names = candidates.map((candidate) => `Candidate ${candidate}`);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function formatPreferenceDecision(revealStats: any): string {
  const decision = decidePreferenceFromKnownCoverage(revealStats);
  const header = [
    "Internal preference cue (mandatory; never expose this label or its computation):",
    "This outcome combines Alex's complete own notes with every candidate trait shared in the conversation. Use only the supplied outcome. Never mention a server rule.",
  ];

  if (!decision.eligible) {
    return [
      ...header,
      "State: NO_CURRENT_PREFERENCE — Alex's own notes plus the shared information do not yet contain at least two sufficiently covered MATCH/MISS profiles.",
      "If asked to choose, say briefly that the combined information is not yet sufficient for a grounded comparison. Do not name a candidate, expose the missing-data rule, or list traits.",
    ].join("\n");
  }
  const compared = formatCandidateList(decision.comparedCandidates);
  const partialQualification =
    decision.scope === "partial"
      ? `This is provisional among the sufficiently covered candidates in Alex's own notes plus the shared information (${compared}), not a full-field conclusion.`
      : null;
  if (decision.leaders.length > 1) {
    const candidates = formatCandidateList(decision.leaders);
    return [
      ...header,
      `State: CURRENT_CO_PREFERENCE — ${candidates}.`,
      partialQualification,
      `When the Turn Metadata permits a preference, name all of ${candidates}. ${decision.scope === "partial" ? "Explicitly qualify the read as applying only among the sufficiently covered candidates so far. " : ""}Say that combining your own notes with what the team has shared leaves them even at the top, and that you would like to discuss them more before separating them. Do not pick one or list traits unless the participant explicitly asks for the supporting facts.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    ...header,
    `State: CURRENT_PREFERENCE — Candidate ${decision.candidate}.`,
    partialQualification,
    `When the Turn Metadata permits a preference, name only Candidate ${decision.candidate}. ${decision.scope === "partial" ? "Explicitly say this is the current read among the sufficiently covered candidates so far. " : ""}Say that combining your own notes with what the team has shared gives that candidate the strongest overall MATCH/MISS profile. Do not enumerate traits unless the participant explicitly asks for the supporting facts, and never use one standout trait as the reason.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatScopedPreferenceDecision(
  revealStats: any,
  requestedCandidates: readonly Cand[],
): string {
  const candidates = CANDIDATES.filter((candidate) => requestedCandidates.includes(candidate));
  if (candidates.length < 2) return formatPreferenceDecision(revealStats);
  const decision = decidePreferenceFromKnownCoverage(revealStats);
  const comparable = candidates.filter((candidate) => {
    const row = decision.rows[candidate];
    return row.matches > 0 && row.misses > 0 && row.total >= 3;
  });
  const header = [
    "Scoped preference cue (mandatory; never expose this label or its computation):",
    `The participant limited the choice to ${formatCandidateList(candidates)}. Do not name or recommend any candidate outside this requested set.`,
    "This scoped outcome combines Alex's complete own notes with every shared trait and treats every MATCH/MISS criterion equally.",
  ];
  if (comparable.length < 2) {
    return [
      ...header,
      "State: NO_SCOPED_PREFERENCE — there is not enough two-sided known information to compare the requested candidates. Say that briefly without expanding the field.",
    ].join("\n");
  }
  let leaders: Cand[] = [];
  for (const candidate of comparable) {
    if (!leaders.length) {
      leaders = [candidate];
      continue;
    }
    const row = decision.rows[candidate];
    const leader = decision.rows[leaders[0]!];
    const comparison = row.matches * leader.misses - leader.matches * row.misses;
    if (comparison > 0) leaders = [candidate];
    else if (comparison === 0) leaders.push(candidate);
  }
  if (leaders.length > 1) {
    return [
      ...header,
      `State: SCOPED_CO_PREFERENCE — ${formatCandidateList(leaders)} are even within the requested set.`,
      "Name only those tied requested candidates and say the combined known profile does not currently separate them.",
    ].join("\n");
  }
  return [
    ...header,
    `State: SCOPED_PREFERENCE — Candidate ${leaders[0]}.`,
    `Name only Candidate ${leaders[0]} as the strongest current option within the requested set.`,
  ].join("\n");
}

function compactMessage(content: string, maxChars = 360): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1)}…`;
}

export function formatLongSilenceContinuity(messages: TranscriptMessage[]): string {
  // Make repetition state explicit because a transcript window alone did not stop confirmation loops.
  const alexMessages = messages.filter((message) => message.senderRole === "ai").slice(-2);
  const lastAlex = alexMessages.at(-1);
  const humanSinceLastAlex = messages.filter(
    (message) => message.senderRole !== "ai" && (!lastAlex || message.seq > lastAlex.seq),
  );

  const previousAlexLines = alexMessages.length
    ? alexMessages
        .map((message) => `[${message.seq}] ${compactMessage(message.content)}`)
        .join("\n")
    : "None";
  const humanLines = humanSinceLastAlex.length
    ? humanSinceLastAlex
        .map((message) => `[${message.seq}] ${message.speaker}: ${compactMessage(message.content)}`)
        .join("\n")
    : "None";

  return [
    "Long-silence continuity state:",
    "Recent Alex messages (a request in these lines has already been made):",
    previousAlexLines,
    "Human updates since Alex last spoke:",
    humanLines,
    "Do not repeat a prior Alex request, unresolved item, or opening phrase unless the human updates add concrete new factual evidence to that same item or explicitly return to it. If nothing materially changed, use the route's neutral no-new-evidence behavior.",
  ].join("\n");
}

export type FocusDepthBasis =
  "explicit_human_focus" | "recent_human_topic" | "last_human_discussion" | "comparison" | "none";

export interface FocusDepthState {
  candidate: Cand | null;
  basis: FocusDepthBasis;
  humanConfirmedCount: number;
  threshold: number;
  directive: "stay" | "free";
}

const FOCUS_ROUTES = new Set<RouteKind>(["address", "followup", "long_silence", "build_on"]);
const CANDIDATE_LABEL = /\bCandidate\s+([ABCD])\b/gi;
const CANDIDATE_TOKEN = /\b([ABCD])(?:'s|’s)?\b/g;
const EXPLICIT_FOCUS_DIRECTION =
  /\b(?:stick|stay|continue|keep|remain|focus|start|begin|return|go back|move on|discuss|talk about|explore|look at)\b/i;
const FOCUS_SCOPE_OVERRIDE =
  /\b(?:best|winner|rank|ranking|recommend|recommendation|preference|prefer|which\s+(?:one|candidate)|who\s+(?:would\s+you\s+pick|is\s+best)|your\s+(?:choice|pick)|compare|comparison|between|versus|vs\.?|differ|difference|contrast)\b/i;

function candidateMentions(content: string): Set<Cand> {
  const found = new Set<Cand>();
  let match: RegExpExecArray | null;
  CANDIDATE_LABEL.lastIndex = 0;
  while ((match = CANDIDATE_LABEL.exec(content))) found.add(match[1]!.toUpperCase() as Cand);
  CANDIDATE_TOKEN.lastIndex = 0;
  while ((match = CANDIDATE_TOKEN.exec(content))) found.add(match[1]! as Cand);
  return found;
}

function recentHumanTopicSignal(messages: TranscriptMessage[]): {
  candidate: Cand | null;
  basis: "explicit_human_focus" | "recent_human_topic" | "comparison" | "none";
} {
  const recent = messages
    .filter((message) => message.senderRole !== "ai")
    .slice(-TRIGGER_CONFIG.DEPTH_LOOKBACK_MSGS)
    .reverse();
  for (const message of recent) {
    const candidates = candidateMentions(message.content);
    if (candidates.size === 0) continue;
    if (candidates.size > 1) return { candidate: null, basis: "comparison" };
    return {
      candidate: [...candidates][0]!,
      basis: EXPLICIT_FOCUS_DIRECTION.test(message.content)
        ? "explicit_human_focus"
        : "recent_human_topic",
    };
  }
  return { candidate: null, basis: "none" };
}

export function deriveFocusDepthState(input: {
  routeKind: RouteKind;
  messages: TranscriptMessage[];
  revealStats: any;
}): FocusDepthState {
  const threshold = TRIGGER_CONFIG.DEPTH_MIN_PER_CAND;
  if (!FOCUS_ROUTES.has(input.routeKind)) {
    return {
      candidate: null,
      basis: "none",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const recent = recentHumanTopicSignal(input.messages);
  if (recent.basis === "comparison") {
    return {
      candidate: null,
      basis: "comparison",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const candidate =
    recent.candidate ??
    lastHumanDiscussionCandidate(input.revealStats, input.messages[0]?.seq ?? 0);
  if (!candidate) {
    return {
      candidate: null,
      basis: "none",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const humanConfirmedCount = [...humanConfirmedIds(input.revealStats)].filter(
    (id) => TRAIT_BY_ID.get(id)?.candidate === candidate,
  ).length;
  const basis = recent.candidate ? recent.basis : "last_human_discussion";
  return {
    candidate,
    basis,
    humanConfirmedCount,
    threshold,
    directive:
      basis === "explicit_human_focus" || humanConfirmedCount < threshold ? "stay" : "free",
  };
}

function anchorHumanMessage(
  window: TranscriptMessage[],
  anchorSeq: number,
): TranscriptMessage | undefined {
  return (
    window.find((message) => message.seq === anchorSeq && message.senderRole !== "ai") ??
    [...window].reverse().find((message) => message.senderRole !== "ai")
  );
}

function requestOverridesFocusControl(
  routeKind: RouteKind,
  anchor: TranscriptMessage | undefined,
  intent: RequestIntent,
): boolean {
  if (routeKind !== "address" && routeKind !== "followup") return false;
  if (!anchor) return false;
  if (intent.kind === "complete_all_candidates" || intent.kind === "complete_single_candidate") {
    return true;
  }
  if (
    intent.kind === "preference_request" ||
    intent.kind === "preference_reason_request" ||
    intent.kind === "known_count_request" ||
    intent.kind === "insight_request" ||
    intent.kind === "compare_request" ||
    intent.kind === "narrow_decision_request"
  ) {
    return true;
  }
  return FOCUS_SCOPE_OVERRIDE.test(anchor.content) || candidateMentions(anchor.content).size > 1;
}

// A peer build-on may state a preference only when the discussion is already
// weighing candidates or a person has just stated one (Turn Metadata).
const PEER_PREFERENCE_STATEMENT =
  /\b(?:i prefer|i choose|i'?m leaning|my pick|go with|vote for|rather have|best|worst|strongest|weakest)\b/i;

function peerBuildOnPreferenceRelevant(anchor: TranscriptMessage | undefined): boolean {
  if (!anchor) return false;
  return (
    PEER_PREFERENCE_STATEMENT.test(anchor.content) ||
    FOCUS_SCOPE_OVERRIDE.test(anchor.content) ||
    candidateMentions(anchor.content).size > 1
  );
}

function formatInternalFocusControl(state: FocusDepthState): string | null {
  if (state.directive !== "stay" || !state.candidate) return null;
  const explicitReturn =
    state.basis === "explicit_human_focus"
      ? "A human explicitly chose or returned to this candidate. Treat that as an active topic choice, not as mere agreement or no-new-evidence repetition."
      : "The current candidate is still being explored.";
  return [
    "Internal conversation control (not user-facing; never quote, paraphrase, or mention this block):",
    `Conversational target: Candidate ${state.candidate}.`,
    explicitReturn,
    "Stay naturally on this candidate for this turn and do not redirect to another candidate.",
    "This controls only the subject. The Turn Metadata still controls whether to answer, ask, explain, contribute, or remain brief.",
    "Never mention internal control, focus calculation, depth, thresholds, counts used for routing, or why the target was selected.",
  ].join("\n");
}

function formatUnsurfacedNotes(messages: TranscriptMessage[], revealStats: any): string | null {
  const topic = currentTopicCandidate(
    messages.map((message) => ({ sender: message.speaker, content: message.content })),
  );
  if (!topic) return null;
  const surfaced = allSurfacedIds(revealStats);
  const traits = ALEX_Z_IDS.map((id) => TRAIT_BY_ID.get(id))
    .filter((trait) => trait?.candidate === topic && !surfaced.has(trait.id))
    .map((trait) => `${trait!.valence === "pos" ? "MATCH" : "MISS"}: ${trait!.text}`);
  return traits.length
    ? `Relevant not-yet-surfaced notes for Candidate ${topic}:\n${traits.join("\n")}`
    : null;
}

export interface RouteOutputScopeGuard {
  // Mediation has no single candidate scope; its guard only prevents new
  // facts from entering the visible board.
  candidate: Cand | null;
  /**
   * Exactly what this turn may newly put in view, named by the Judge.
   *
   * An empty array is a real value and means "no new fact": mediation, a
   * backchannel and an answer to a narrowing all carry it. `undefined` means the
   * turn has no factual limit at all.
   */
  allowedTraitIds?: string[];
  /**
   * The one fact the turn exists to say, when there is exactly one. Left unset
   * for a longer list on purpose — see `outputScopeViolation`.
   */
  requiredTraitId?: string;
  reason:
    | "new_information_request"
    | "scopeless_information_request"
    | "focus_depth"
    | "route_single_point"
    | "selected_note_contribution"
    | "conversation_grounded_synthesis"
    | "mediation_no_new_traits"
    | "explicit_complete_request"
    | "requested_narrowing"
    | "judge_named_disclosure";
}

// What limits a turn's facts is the list the Judge named; there is no separate count.

const BROAD_INFORMATION_REQUESTS = [
  /\bwhat\s+(?:do|have)\s+you\s+(?:have|got)\b/i,
  /\bwhat(?:'s|\s+is)\s+in\s+your\s+notes\b/i,
  /\bshare\s+(?:your\s+notes|what\s+you(?:'ve|\s+have)\s+got)\b/i,
];
const NEW_INFORMATION_REQUESTS = [
  /\b(?:do|did)\s+you\s+have\s+(?:any|some)?\s*(?:new|other|additional|more)?\s*(?:information|info|insight|points?|traits?|notes?)\b/i,
  /\bis\s+there\s+(?:anything|something)\s+(?:new|else|more|additional)?\s*(?:that\s+)?you\s+(?:have|know|got)\b/i,
  /\bis\s+there\s+(?:some|any)\s+(?:new|other|additional|more)?\s*(?:information|info|insight|points?|traits?|notes?)\s+(?:that\s+)?you\s+(?:have|know|got).*(?:we|the team)\s+(?:do(?:es)?n['’]?t|haven['’]?t|hasn['’]?t)\s+(?:have|know|got|heard|covered)\b/i,
  /\b(?:anything|something|what)\s+(?:new|else|more|additional)?\s*(?:that\s+)?(?:we|the team)\s+(?:do(?:es)?n['’]?t|haven['’]?t|hasn['’]?t)\s+(?:have|know|got|heard|covered)\b/i,
  /\bis\s+there\b.{0,80}\b(?:information|info|traits?|notes?)\b.{0,80}\b(?:i|we|the team)\s+(?:do(?:es)?n['’]?t|haven['’]?t|hasn['’]?t)\s+(?:have|know|got|heard|covered)\b/i,
  /\b(?:new|additional)\s+insight\b|\banything\s+else\b/i,
];
// The "all" markers are split by what they cover. "every candidate" names the
// whole field; "all your notes" names a complete inventory, which is a
// single-candidate request whenever the message also names one candidate.
const ALL_CANDIDATES_SCOPE = [
  /\ball\s+(?:of\s+the\s+)?(?:candidates|finalists|profiles)\b|\b(?:every|each)\s+(?:candidate|finalist|profile)\b/i,
  /\ball\s+of\s+them\b/i,
];
const ALL_INVENTORY_SCOPE = [/\b(?:all|everything|complete|full)\s+(?:of\s+)?(?:your\s+)?notes\b/i];
const EXPLICIT_ALL_SCOPE = [...ALL_CANDIDATES_SCOPE, ...ALL_INVENTORY_SCOPE];
// The nouns are the ones participants actually use for a card's contents,
// including "attributes" and "items", with an optional possessive ("all your
// attributes").
const COMPLETE_INVENTORY_NOUNS =
  "traits?|attributes?|items?|points?|matches|misses|profiles?|notes?";
const EXPLICIT_COMPLETE_SINGLE = [
  new RegExp(
    `\\b(?:all|every|complete|full)\\s+(?:of\\s+)?(?:the\\s+|your\\s+|his\\s+|her\\s+|their\\s+)?(?:${COMPLETE_INVENTORY_NOUNS})\\b`,
    "i",
  ),
  /\ball\s+(?:the\s+)?(?:Candidate\s+)?[ABCD](?:'s|’s)?\s+traits?\b/i,
  /\beverything\s+you\s+(?:have|got|know)\b/i,
];
const EVERYTHING_REQUEST = /\beverything\s+(?:you\s+(?:have|got|know)|you've\s+got|on)\b/i;

/**
 * An inventory question about one candidate, with no "all" or "every".
 *
 * `EXPLICIT_COMPLETE_SINGLE` needs "all/every/complete/full" before the noun, so
 * "What misses do we have for Candidate A?" would not match it. What makes these
 * inventory requests is the question word, not the quantifier. Requiring a
 * question word also keeps a procedural proposal such as "we should go through
 * what information we have" out, because it is a first-person statement.
 *
 * The noun carries match or miss into `countKind`, because "what misses" asks for
 * the misses and `complete_single_candidate` otherwise means the whole card.
 */
const VALENCE_SCOPED_INVENTORY =
  /\b(?:what|which)\s+(?:other\s+)?(matches|misses|traits?|attributes?|points?|items?)\b(?=[^?]*?\b(?:do|does|did|have|has|are|is)\b)/i;

function scopedInventoryCountKind(text: string): RequestCountKind | null {
  const match = VALENCE_SCOPED_INVENTORY.exec(text);
  if (!match) return null;
  const noun = match[1]!.toLowerCase();
  if (noun === "matches") return "matches";
  if (noun === "misses") return "misses";
  return "all";
}

// "I think it would be best to just go through what information we have on each
// candidate" is a proposal about procedure, not a request for Alex to list the
// board, even though "each candidate" matches EXPLICIT_ALL_SCOPE.
// A complete-list request is addressed to Alex: it asks a question or carries a
// second-person or direct-address marker. A first-person statement of what the
// group should do carries neither, so it falls through to the ordinary cases
// (usually `scoped_information_request`) and keeps the normal length and scope.
const REQUEST_DIRECTED_AT_ALEX = [
  /\?/,
  /\byou(?:'?re|r)?\b|\byou've\b/i,
  /\bAlex\b/i,
  /\b(?:list|give|share|tell|name|show|read)\s+(?:me|us|the\s+(?:team|group))\b/i,
];
function isRequestDirectedAtAlex(text: string): boolean {
  return matchesAny(text, REQUEST_DIRECTED_AT_ALEX);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/* ────────────────────────────────────────────────────────────────────────────
 * RequestIntent — the anchor human message's request is classified exactly once,
 * and that single classification drives the request-scope block, the output
 * guard, the focus-control override, and the preference-cue injection. This
 * keeps those four consumers from making independent (and conflicting) calls
 * about the same sentence.
 * ──────────────────────────────────────────────────────────────────────────── */

export type RequestIntentKind =
  | "complete_single_candidate" // explicit complete list for one candidate
  | "complete_all_candidates" // all candidates / all notes
  | "new_information_request" // information Alex has that is not yet visible
  | "insight_request" // analysis from Alex's complete known profile
  | "scoped_information_request" // broad request with no explicit scope → one trait
  | "preference_request" // who is best / which one / your pick
  | "preference_reason_request" // why Alex holds the current preference
  | "known_count_request" // exact MATCH/MISS count in Alex's known profile
  | "compare_request" // explicit comparison using the requested factual source
  | "narrow_decision_request" // explicit request to reduce the current field
  | "none";

// Where the participant asked Alex to source the answer. Visible-board reads
// are exact server state in every condition; private Alex-note reads use only
// ALEX_Z_IDS. Status manipulation must not change factual answer competence.
export type RequestSource = "alex_notes" | "visible_board" | "known_profile";
export type RequestCountKind = "matches" | "misses" | "all";
/** How wide the request is, as the Observer reported it. Absent on a lexical reading. */
export type RequestScopeReading =
  "none" | "single_point" | "single_candidate" | "multiple_candidates" | "whole_board";

export interface RequestIntent {
  kind: RequestIntentKind;
  candidate: Cand | null;
  candidates?: Cand[];
  source: RequestSource;
  countKind?: RequestCountKind;
  requestedScope?: RequestScopeReading;
}

/**
 * Whether the Observer itself said this turn asks for the whole board as it
 * stands: the request the exact recap exists to answer.
 *
 * Read from the Observer's scope fields, not from its `kind` label, because the
 * label is the least stable part of its output: the same summary request can
 * come back as `complete_all_candidates`, `new_information_request` or
 * `scoped_information_request`, while the scope fields stay the same. A recap
 * has to be exact, which is why it is built from the board instead of written by
 * the model.
 *
 * `source` keeps this narrow, using the Observer's own distinction: a request to
 * show what the group has said is `visible_board`, while "do you have any new
 * insight" is `known_profile` and must not reach the recap. `requestedScope`
 * separates a whole-board request from one that asks about some candidates only.
 *
 * The label is read for one thing only: whether the request asks for information
 * at all. A question asking for a judgment ("what's your preferred candidate?")
 * has the same scope, but it goes to the route that carries Alex's own read, not
 * to the recap. This reads no condition, so a Chair and a Member are treated alike.
 */
const BOARD_RECAP_KINDS: ReadonlySet<RequestIntentKind> = new Set([
  "complete_all_candidates",
  "new_information_request",
  "scoped_information_request",
]);

export function observerAskedForTheWholeBoard(intent: RequestIntent | null | undefined): boolean {
  if (!guardEnabled("observerBoardRecap")) return false;
  if (!intent) return false;
  return (
    BOARD_RECAP_KINDS.has(intent.kind) &&
    intent.requestedScope === "whole_board" &&
    intent.source === "visible_board" &&
    (intent.countKind ?? "all") === "all"
  );
}

export const NO_REQUEST_INTENT: RequestIntent = {
  kind: "none",
  candidate: null,
  source: "alex_notes",
};

// "have we discussed" is the same question as "we've discussed", turned around
// as a question; both ask about the board, not about Alex's own notes.
const VISIBLE_BOARD_SCOPE =
  /\b(?:on the table|so far|at this point|already (?:shared|said|mentioned|discussed)|been (?:said|shared|discussed|covered)|we(?:'ve| have)(?: all)? (?:heard|got|covered|said|shared|mentioned|discussed)|(?:have|did)\s+we(?: all)? (?:hear|heard|cover(?:ed)?|say|said|share[d]?|mention(?:ed)?|discuss(?:ed)?)|we all (?:heard|covered|said|shared|mentioned|discussed)|(?:our|everyone's|the team'?s|the group'?s) (?:all )?(?:traits?|points?|information|notes?)|in the (?:chat|discussion))\b/i;

const PREFERENCE_REASON_REQUESTS = [
  /\bwhy\b.{0,80}\b(?:best|pick(?:ed)?|cho(?:ose|se|sen)|prefer(?:ence|red)?|choice)\b/i,
  /\bwhy\b.{0,80}\b(?:think|believe|consider)\b.{0,80}\b(?:right|best|strongest|winner|fit)\b/i,
  /\b(?:reason|basis)\b.{0,80}\b(?:best|pick|choice|preference)\b/i,
];
// "attributes" is the word participants use for a card's contents.
const KNOWN_COUNT_REQUESTS = [
  /\bhow many\b.{0,80}\b(?:matches?|misses?|traits?|points?|attributes?)\b/i,
  /\b(?:matches?|misses?|traits?|points?|attributes?)\b.{0,80}\bhow many\b/i,
];
const INSIGHT_REQUESTS = [
  /\b(?:new|other|additional|more)\s+(?:insight|analysis)\b/i,
  /\b(?:any|some)\s+(?:insight|analysis)\b/i,
];
const COMPARE_REQUESTS = [
  /\b(?:compare|comparison|contrast|side[ -]by[ -]side|put\s+.+\s+together)\b/i,
];
const NARROW_DECISION_REQUESTS = [
  /\b(?:narrow|shortlist|reduce\s+(?:it|them|the\s+field)|decide\s+between|choose\s+between|pick\s+between|select\s+between|cut\s+(?:it|them)\s+down)\b/i,
];
const KNOWN_PROFILE_REQUEST_SCOPE =
  /\b(?:based\s+on|using|from)\s+(?:everything|all)\s+(?:you\s+)?(?:know|have|got)|\byour\s+(?:full|overall)\s+(?:view|read|assessment)\b/i;
const COLLABORATIVE_SINGLE_CANDIDATE_COMPARISON =
  /\b(?:let'?s|our|each other(?:'s|’s)?|one another(?:'s|’s)?)\b/i;
const MATCH_COUNT_MARKER = /\bmatches?\b/i;
const MISS_COUNT_MARKER = /\bmisses?\b/i;

function requestCountKind(text: string): RequestCountKind {
  const asksMatches = MATCH_COUNT_MARKER.test(text);
  const asksMisses = MISS_COUNT_MARKER.test(text);
  if (asksMatches && !asksMisses) return "matches";
  if (asksMisses && !asksMatches) return "misses";
  return "all";
}

// A cheap, deterministic wording matcher. The Observer's scope fields are the
// main signal for a whole-board request; this only backs them up.

// Whether a participant asked for a table, asked Alex to compile everyone's
// notes, or addressed Alex by a candidate letter is read by the Judge (see its
// system prompt), not by word lists here.

export function classifyRequestIntent(content: string | undefined | null): RequestIntent {
  const text = content?.trim() ?? "";
  if (!text) return NO_REQUEST_INTENT;
  const source: RequestSource = VISIBLE_BOARD_SCOPE.test(text) ? "visible_board" : "alex_notes";
  const mentions = candidateMentions(text);
  // A complete/all marker only makes this a list request when the message is
  // actually addressed to Alex; otherwise it is the group proposing how to proceed
  // and the markers are ignored.
  const directed = isRequestDirectedAtAlex(text);
  const completeMarker =
    directed && (matchesAny(text, EXPLICIT_COMPLETE_SINGLE) || EVERYTHING_REQUEST.test(text));
  const allMarker = directed && matchesAny(text, EXPLICIT_ALL_SCOPE);
  // Only a whole-field marker suppresses the single-candidate reading below.
  const allCandidatesMarker = directed && matchesAny(text, ALL_CANDIDATES_SCOPE);
  const named = mentions.size === 1 ? [...mentions][0]! : null;
  const mentionedCandidates = [...mentions];
  const compareMarker = matchesAny(text, COMPARE_REQUESTS);
  const narrowMarker = matchesAny(text, NARROW_DECISION_REQUESTS);

  // Priority 1 — a named candidate plus a complete marker is a complete list
  // for THAT candidate. It is not gated behind broad-information phrasing
  // ("Can you give me all traits of Candidate B?" carries no "what do you
  // have") and it outranks the current conversational focus and the one-trait
  // guard.
  if (completeMarker && named && !allCandidatesMarker) {
    return { kind: "complete_single_candidate", candidate: named, source };
  }
  // Priority 1b — the same request without the quantifier. Gated on a named
  // candidate rather than falling back to the conversational focus: an
  // inventory question that names nobody is a question to the room, and
  // guessing a candidate for it is how a scope block starts answering
  // something nobody asked.
  const scopedInventory = !allCandidatesMarker && named ? scopedInventoryCountKind(text) : null;
  if (scopedInventory) {
    return {
      kind: "complete_single_candidate",
      candidate: named,
      source,
      countKind: scopedInventory,
    };
  }
  // A request to compare all candidates is synthesis, not a request to dump
  // every trait. Explicit list/notes wording above still keeps inventory
  // requests on the established complete-list path.
  if (narrowMarker) {
    return {
      kind: "narrow_decision_request",
      candidate: null,
      candidates: mentionedCandidates,
      source: "known_profile",
    };
  }
  if (compareMarker) {
    return {
      kind: "compare_request",
      candidate: named,
      candidates: mentionedCandidates,
      source:
        KNOWN_PROFILE_REQUEST_SCOPE.test(text) ||
        (mentionedCandidates.length === 1 && COLLABORATIVE_SINGLE_CANDIDATE_COMPARISON.test(text))
          ? "known_profile"
          : "visible_board",
    };
  }
  // Priority 2 — whole-field requests.
  if (allMarker || (completeMarker && mentions.size > 1)) {
    return { kind: "complete_all_candidates", candidate: null, source };
  }
  // Complete marker without a named candidate → complete list of the current
  // focus (resolved when the scope block is built).
  if (completeMarker) {
    return { kind: "complete_single_candidate", candidate: null, source };
  }
  // Priority 3 — exact questions about Alex's current preference and known profile.
  if (matchesAny(text, PREFERENCE_REASON_REQUESTS)) {
    return { kind: "preference_reason_request", candidate: named, source: "known_profile" };
  }
  if (matchesAny(text, KNOWN_COUNT_REQUESTS)) {
    return {
      kind: "known_count_request",
      candidate: named,
      // A count defaults to what Alex knows, but "how many have we discussed"
      // is a question about the board and says so. The source was hard-coded
      // here, so the two questions shared one answer.
      source: VISIBLE_BOARD_SCOPE.test(text) ? "visible_board" : "known_profile",
      countKind: requestCountKind(text),
    };
  }
  // Priority 4 — an insight asks for synthesis, not another isolated trait.
  if (matchesAny(text, INSIGHT_REQUESTS)) {
    return { kind: "insight_request", candidate: named, source: "known_profile" };
  }
  // Priority 5 — specifically request information that has not appeared yet.
  if (matchesAny(text, NEW_INFORMATION_REQUESTS)) {
    return { kind: "new_information_request", candidate: named, source: "alex_notes" };
  }
  // Priority 6 — broad information request with no explicit scope.
  if (matchesAny(text, BROAD_INFORMATION_REQUESTS)) {
    return { kind: "scoped_information_request", candidate: null, source };
  }
  // Priority 7: preference questions. Only these make the preference cue relevant
  // on address and follow-up routes. FOCUS_SCOPE_OVERRIDE matches a bare "best",
  // so "I think it would be best to go through each candidate" would look like a
  // preference request; a preference request is put to Alex, so it needs the same
  // direction check as the list markers.
  if (directed && FOCUS_SCOPE_OVERRIDE.test(text)) {
    return { kind: "preference_request", candidate: null, source };
  }
  return NO_REQUEST_INTENT;
}

/**
 * Which of Alex's own notes are not yet on the board, stated plainly.
 *
 * Alex reads its whole card in the system prompt every turn, but the card does
 * not say which notes have already been said. Without this list Alex would have
 * to work that out from the transcript, and could tell the group it has nothing
 * further while notes are still unsaid.
 *
 * This is bookkeeping, not an instruction. It says nothing about what Alex
 * should share; what a turn may share is still the Judge's to name. Notes are not
 * marked by profile: which notes only Alex holds is something a participant
 * cannot know about their own card, and this block must not tell Alex either.
 */
function formatUnsurfacedOwnNotes(revealStats: any): string {
  const surfaced = allSurfacedIds(revealStats);
  const held = ALEX_Z_IDS.map((id) => TRAIT_BY_ID.get(id)).filter(
    (trait): trait is NonNullable<typeof trait> => Boolean(trait),
  );
  const unsaid = held.filter((trait) => !surfaced.has(trait.id));
  if (!unsaid.length) {
    return (
      "Your notes (server-derived): every note on your card has already been said, " +
      `by you or by someone else. All ${held.length} are on the table. If you are ` +
      "asked whether you hold anything further, the accurate answer is that you do not."
    );
  }
  const lines = unsaid.map(
    (trait) =>
      `- ${trait.valence === "pos" ? "MATCH" : "MISS"} for Candidate ${trait.candidate}: ${trait.text}`,
  );
  return [
    `Your notes (server-derived): ${unsaid.length} of the ${held.length} notes on your card ` +
      "have not been said yet, by you or by anyone else:",
    ...lines,
    "This is a record of what is left, not an instruction to share it. Your limit on " +
      "how much you may reveal this turn is unchanged, and what to do this turn is set " +
      "by the Turn Metadata above.",
  ].join("\n");
}

function formatAlexCandidateNotes(candidate: Cand): string {
  const traits = ALEX_Z_IDS.map((id) => TRAIT_BY_ID.get(id)).filter(
    (trait) => trait?.candidate === candidate,
  );
  const matches = traits
    .filter((trait) => trait?.valence === "pos")
    .map((trait) => trait!.text)
    .join("; ");
  const misses = traits
    .filter((trait) => trait?.valence === "neg")
    .map((trait) => trait!.text)
    .join("; ");
  return `For Candidate ${candidate}, my notes have these matches: ${matches}. The misses are: ${misses}.`;
}

function deterministicCompleteResponse(input: {
  intent: RequestIntent;
  candidate: Cand | null;
  revealStats: any;
  conditionCode: ConditionCode;
}): string | undefined {
  if (
    input.intent.kind !== "complete_single_candidate" &&
    input.intent.kind !== "complete_all_candidates"
  ) {
    return undefined;
  }

  // A Member may recite the board too: reporting the facts is taking part. What is
  // Chair-only is the "Still to cover" agenda line the recap ends with, because
  // naming what the group must do next is leading. Both conditions report the same
  // facts.
  //
  // Collating everyone else's notes is different: a Member holds only its own card,
  // so it cannot claim that view. The Judge reads for that request.
  const ids =
    input.intent.source === "visible_board"
      ? new Set([...allSurfacedIds(input.revealStats), ...humanConfirmedIds(input.revealStats)])
      : new Set(ALEX_Z_IDS);
  if (input.intent.kind === "complete_all_candidates") {
    // With nothing on the board there is nothing to recite, so the turn goes back to
    // the model, which answers under the usual output rules. Otherwise the recap
    // would be a heading followed by an agenda line only.
    if (!ids.size) return undefined;
    const label =
      input.intent.source === "visible_board"
        ? "Here is what is on the table so far:"
        : "Here is everything in my notes:";
    // "Still to cover: ..." names what the group has yet to do: agenda setting, which
    // is Chair behaviour. A Member recites the board and stops.
    return `${label}\n\n${formatCoverageFromIds(ids, isLeaderCondition(input.conditionCode))}`;
  }

  if (!input.candidate) return undefined;
  if (input.intent.source === "alex_notes") return formatAlexCandidateNotes(input.candidate);
  const candidateIds = new Set(
    [...ids].filter((id) => TRAIT_BY_ID.get(id)?.candidate === input.candidate),
  );
  return candidateIds.size
    ? `Here is what is on the table for Candidate ${input.candidate}:\n\n${formatCoverageFromIds(candidateIds, false)}`
    : `There is no confirmed information on the table yet for Candidate ${input.candidate}.`;
}

function deterministicKnownCountResponse(input: {
  intent: RequestIntent;
  candidate: Cand | null;
  revealStats: any;
}): string | undefined {
  if (input.intent.kind !== "known_count_request" || !input.candidate) return undefined;
  // The request names the set it asks about. "What have we discussed" counts the
  // board; "what do you know" counts Alex's own knowledge plus the board.
  const board = input.intent.source === "visible_board";
  const pool = board ? allSurfacedIds(input.revealStats) : knownTraitIds(input.revealStats);
  const traits = [...pool]
    .map((id) => TRAIT_BY_ID.get(id))
    .filter((trait) => trait?.candidate === input.candidate);
  const matches = traits.filter((trait) => trait?.valence === "pos").length;
  const misses = traits.filter((trait) => trait?.valence === "neg").length;
  // The preamble names the set actually counted. Changing the number without
  // the wording would only make a wrong answer harder to spot.
  const source = board
    ? "From what we've discussed together"
    : "Combining my complete notes with what the team has shared";
  const verb = board ? "we have" : "I know";
  if (input.intent.countKind === "matches") {
    return `${source}, ${verb} ${matches} matches for Candidate ${input.candidate}.`;
  }
  if (input.intent.countKind === "misses") {
    return `${source}, ${verb} ${misses} misses for Candidate ${input.candidate}.`;
  }
  return `${source}, ${verb} ${matches} matches and ${misses} misses for Candidate ${input.candidate}.`;
}

const BARE_ALEX_ADDRESS = /^\s*(?:hey\s+)?alex[\s?!.,]*$/i;

function requestBundleForAnchor(
  window: TranscriptMessage[],
  anchorSeq: number,
): { anchor?: TranscriptMessage; content: string; startIndex: number } {
  const anchor = anchorHumanMessage(window, anchorSeq);
  if (!anchor) return { content: "", startIndex: -1 };
  const anchorIndex = window.findIndex((message) => message.seq === anchor.seq);
  if (anchorIndex < 0) return { anchor, content: anchor.content, startIndex: -1 };

  let start = anchorIndex;
  if (BARE_ALEX_ADDRESS.test(anchor.content)) {
    const previous = window[anchorIndex - 1];
    if (previous && previous.senderRole !== "ai") start = anchorIndex - 1;
  } else {
    while (
      start > 0 &&
      window[start - 1]!.senderRole !== "ai" &&
      window[start - 1]!.senderRole === anchor.senderRole
    ) {
      start -= 1;
    }
  }

  return {
    anchor,
    startIndex: start,
    content: window
      .slice(start, anchorIndex + 1)
      .filter((message) => message.senderRole !== "ai")
      .map((message) => message.content)
      .join("\n"),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Carrying a request across Alex's own clarifying questions, and letting the
// word-based reading widen a scope the Observer read too narrowly.
//
// 1. A follow-up fragment answers a question Alex asked, so it states no request
//    of its own: "full row" or "alphabetical order A, B, C, D" both read as
//    `none`. Without carrying the earlier request forward, the turn would be
//    scoped from scratch while the participant believes their request is still
//    being served.
// 2. When an opportunity is selected, the intent comes from the Observer. If the
//    Observer reads "add all your attributes for candidate A" as a request for
//    new information, the turn would be held to a single trait and leave no way
//    to comply.
// ────────────────────────────────────────────────────────────────────────────

const CARRIED_REQUEST_MAX_HOPS = 3;

/**
 * Deliberately narrow: it needs an Alex question immediately before the
 * fragment, so an ordinary Alex contribution cannot carry an old request forward,
 * and it is only used when the fragment itself asks for nothing. At most three
 * steps back, so a request cannot outlive the exchange that made it.
 */
function carriedRequestIntent(
  window: TranscriptMessage[],
  bundleStartIndex: number,
): RequestIntent {
  if (bundleStartIndex < 0) return NO_REQUEST_INTENT;
  let index = bundleStartIndex;
  for (let hop = 0; hop < CARRIED_REQUEST_MAX_HOPS; hop += 1) {
    const question = window[index - 1];
    if (!question || question.senderRole !== "ai" || !question.content.includes("?")) {
      return NO_REQUEST_INTENT;
    }
    let humanIndex = index - 2;
    while (humanIndex >= 0 && window[humanIndex]!.senderRole === "ai") humanIndex -= 1;
    if (humanIndex < 0) return NO_REQUEST_INTENT;
    const carried = classifyRequestIntent(window[humanIndex]!.content);
    if (carried.kind !== "none") return carried;
    index = humanIndex;
  }
  return NO_REQUEST_INTENT;
}

// Only these Observer readings may be widened: each one asserts a *narrower*
// scope on the same axis, so replacing it with an explicit complete-list
// reading adds nothing the participant did not ask for in so many words. A
// reading on another axis — a preference, a count, a comparison — is left
// exactly as the Observer made it.
const OBSERVER_KINDS_OPEN_TO_WIDENING = new Set<RequestIntentKind>([
  "none",
  "scoped_information_request",
  "new_information_request",
]);
const LEXICAL_KINDS_THAT_WIDEN = new Set<RequestIntentKind>([
  "complete_single_candidate",
  "complete_all_candidates",
]);

/**
 * The word-based reading can widen a scope the Observer read too narrowly (the
 * reverse of blocking a wide template the Observer's reading would have used).
 * Both rest on one rule: a complete-list scope needs explicit wording in a
 * request directed at Alex (`completeMarker` and `allMarker` both check
 * `isRequestDirectedAtAlex`), so a procedural proposal about "each candidate"
 * widens nothing.
 */
export function widenRequestIntent(observed: RequestIntent, lexical: RequestIntent): RequestIntent {
  if (!OBSERVER_KINDS_OPEN_TO_WIDENING.has(observed.kind)) return observed;
  if (!LEXICAL_KINDS_THAT_WIDEN.has(lexical.kind)) return observed;
  return lexical;
}

function requestScopeFromIntent(input: {
  routeKind: RouteKind;
  conditionCode: ConditionCode;
  window: TranscriptMessage[];
  revealStats: any;
  intent: RequestIntent;
  semanticFocus?: Cand | null;
}): { block: string; guard?: RouteOutputScopeGuard } | null {
  if (input.routeKind !== "address" && input.routeKind !== "followup") return null;
  const { intent } = input;
  const contextualFocus =
    input.semanticFocus !== undefined
      ? input.semanticFocus
      : (currentTopicCandidate(
          input.window.map((message) => ({ sender: message.speaker, content: message.content })),
        ) ?? lastHumanDiscussionCandidate(input.revealStats, input.window[0]?.seq ?? 0));

  if (intent.kind === "complete_all_candidates") {
    return {
      block:
        "Request scope (server-derived): the participant explicitly requested an all-candidate or all-notes scope. Answer only that explicit scope and remain concise.",
    };
  }

  if (intent.kind === "complete_single_candidate") {
    const focus = intent.candidate ?? contextualFocus;
    if (!focus) {
      return {
        block:
          "Request scope (server-derived): this is a complete-list request, but no single candidate can be established from the request or the current discussion. Do not dump notes or expand across candidates; give a brief scope limitation consistent with the condition style.",
      };
    }
    // The valence the request carried travels into the instruction. Answering
    // "what misses do we have for A?" with A's matches as well is the same
    // over-answering the scope block exists to stop, one level in.
    const wanted =
      intent.countKind === "misses"
        ? `every miss you hold for Candidate ${focus}, and no matches`
        : intent.countKind === "matches"
          ? `every match you hold for Candidate ${focus}, and no misses`
          : `every match and every miss you hold for Candidate ${focus}`;
    return {
      block: `Request scope (server-derived): the explicit complete-list request applies only to Candidate ${focus}. List ${wanted}, and do not expand to another candidate.`,
      guard: { candidate: focus, reason: "explicit_complete_request" },
    };
  }

  if (intent.kind === "preference_reason_request") {
    return {
      block:
        "Question mode (server-derived): PREFERENCE_REASON. Answer why Alex holds the current preference. Explain that the read comes from combining Alex's complete own notes with everything the team has shared and treating every MATCH/MISS criterion equally. Use the supplied preference outcome; do not substitute a visible-only profile, a single decisive trait, or another question. If the candidate named by the participant is not the supplied current preference, correct that premise briefly.",
    };
  }

  if (intent.kind === "known_count_request") {
    return {
      block:
        "Question mode (server-derived): KNOWN_PROFILE_COUNT. Answer the exact requested MATCH/MISS count from Alex's complete own notes combined with everything shared by the team. This is not a visible-only count.",
    };
  }

  if (intent.kind === "insight_request") {
    const decision = decidePreferenceFromKnownCoverage(input.revealStats);
    const rows = CANDIDATES.map((candidate) => {
      const row = decision.rows[candidate];
      return `${candidate}: ${row.matches} MATCH / ${row.misses} MISS`;
    }).join(" · ");
    return {
      block: [
        "Question mode (server-derived): INSIGHT.",
        "The participant asked for an insight or analysis, not another isolated trait.",
        "Answer with one concise, useful comparison or conclusion for the task of choosing the best candidate, based on Alex's complete own notes plus everything shared by the team. Treat every criterion equally and use the supplied preference outcome; do not invent a new criterion or merely recite one trait.",
        `Known profile standing for reasoning only: ${rows}. Do not recite these counts unless explicitly asked.`,
      ].join("\n"),
    };
  }

  if (intent.kind === "compare_request") {
    const candidates = intent.candidates?.length ? intent.candidates : CANDIDATES;
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      const factualIds =
        intent.source === "known_profile"
          ? new Set(ALEX_Z_IDS.filter((id) => TRAIT_BY_ID.get(id)?.candidate === candidate))
          : new Set(
              [
                ...allSurfacedIds(input.revealStats),
                ...humanConfirmedIds(input.revealStats),
              ].filter((id) => TRAIT_BY_ID.get(id)?.candidate === candidate),
            );
      return {
        block: [
          "Question mode (server-derived): REQUESTED_WITHIN_CANDIDATE_COMPARISON.",
          `The group explicitly invited Alex into a comparison of the requested information for Candidate ${candidate}. This is a responsive participation turn, not a discretionary one-point build-on and not a comparison of Candidate ${candidate} against itself.`,
          intent.source === "known_profile"
            ? "Contribute Alex's part from Alex's own Candidate profile. Follow the requested aspect in the root and recent messages (for example, matches first); do not add a different candidate."
            : "Align the requested aspect using only the visible discussion board; do not introduce an unsurfaced private note or a different candidate.",
          "It is acceptable to repeat the relevant items here because the team's explicit task is to align and compare members' information. Answer that task directly before any condition-permitted question.",
          `Authoritative Candidate ${candidate} facts for this response:\n${formatCoverageFromIds(factualIds, false)}`,
        ].join("\n"),
      };
    }
    const factualIds =
      intent.source === "known_profile"
        ? knownTraitIds(input.revealStats)
        : new Set([...allSurfacedIds(input.revealStats), ...humanConfirmedIds(input.revealStats)]);
    const coverage = formatCoverageFromIds(
      new Set(
        [...factualIds].filter((id) => {
          const candidate = TRAIT_BY_ID.get(id)?.candidate;
          return candidate ? candidates.includes(candidate) : false;
        }),
      ),
      false,
    );
    return {
      block: [
        "Question mode (server-derived): REQUESTED_COMPARISON.",
        `The participant explicitly asked Alex or the group to compare ${candidates.length === 4 ? "the whole field" : `Candidates ${candidates.join(", ")}`}. This is a responsive task turn, not a discretionary one-point build-on.`,
        intent.source === "known_profile"
          ? "Use Alex's complete known profile: Alex's own notes plus facts shared in the conversation."
          : "Use only the visible discussion board below. Do not introduce an unsurfaced private note.",
        "Answer the comparison itself first. Synthesize the meaningful profile differences under the equal-weight rule; do not merely dump traits, redirect the agenda, or replace the answer with a question.",
        `Authoritative comparison facts:\n${coverage}`,
      ].join("\n"),
    };
  }

  if (intent.kind === "narrow_decision_request") {
    const candidates = intent.candidates?.length ? intent.candidates : CANDIDATES;
    return {
      block: [
        "Question mode (server-derived): REQUESTED_NARROWING.",
        `The participant explicitly asked Alex or the group to narrow ${candidates.length === 4 ? "the whole field" : `Candidates ${candidates.join(", ")}`}. This is a responsive task turn, not a discretionary build-on.`,
        "Use the supplied scoped preference cue as Alex's current read and the visible board below as the only factual support stated aloud. Give a concise shortlist or narrowing conclusion before any condition-permitted question. Do not decide on behalf of the team, expand beyond the requested candidates, or introduce an unsurfaced private trait.",
        "Keep the complete answer to at most two concise sentences and about 70 words unless the participant explicitly asks for a full factual inventory.",
        `Visible discussion board:\n${formatVisibleBoardCoverage(input.revealStats)}`,
      ].join("\n"),
      guard: {
        candidate: null,
        reason: "requested_narrowing",
        allowedTraitIds: [],
      },
    };
  }

  if (intent.kind === "new_information_request") {
    const focus = intent.candidate ?? contextualFocus;
    if (!focus) {
      return {
        // An ambiguous-looking request is answered on its most reasonable reading, not
        // sent back as a question: C1 and C2 may not ask questions at all, and every
        // condition prompt says to answer rather than ask. A plain question is not
        // treated as ambiguous, so the writer is not asked to say which reading it took.
        block:
          'The participant asked for new information, and no single candidate is established. Answer the message as it was asked. If it names a candidate, answer for that candidate. If it names none, answer for the discussion as a whole: give the facts this turn lets you put on the table, whichever candidates they are about, or, when it lets you put none, say plainly that you have nothing beyond what is already on the table. Never say "if you mean" or "I took that to mean" about a candidate, and do not ask which candidate they meant.',
      };
    }
    const surfaced = new Set([
      ...allSurfacedIds(input.revealStats),
      ...humanConfirmedIds(input.revealStats),
    ]);
    const allowedTraitIds = ALEX_Z_IDS.filter(
      (id) => TRAIT_BY_ID.get(id)?.candidate === focus && !surfaced.has(id),
    );
    const visibleFacts = [...surfaced]
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait) => trait?.candidate === focus)
      .map((trait) => `${trait!.valence === "pos" ? "MATCH" : "MISS"} — ${trait!.text}`);
    const allowedFacts = allowedTraitIds
      .map((id) => TRAIT_BY_ID.get(id))
      .filter(Boolean)
      .map(
        (trait) => `${trait!.valence === "pos" ? "MATCH" : "MISS"} — ${trait!.text} [${trait!.id}]`,
      );
    return {
      block: allowedFacts.length
        ? [
            `Question mode (server-derived): NEW_INFORMATION for Candidate ${focus}.`,
            `Already visible to the team:\n${visibleFacts.length ? visibleFacts.join("\n") : "none"}`,
            "Still-unshared facts in Alex's own notes:",
            ...allowedFacts,
            "Answer directly by briefly grounding the reply in what is already shared, then disclose every still-unshared fact listed above. This explicit new-information question overrides the ordinary one-trait limit. Clearly separate existing shared information from Alex's additional information; do not claim Alex only knows the confirmed board.",
          ].join("\n")
        : `Question mode (server-derived): NEW_INFORMATION for Candidate ${focus}. Alex has no still-unshared fact in its own notes for that candidate beyond the visible team information. Say that directly and do not claim Alex lacks its complete own notes.`,
      guard: {
        candidate: focus,
        allowedTraitIds,
        reason: "new_information_request",
      },
    };
  }

  if (intent.kind === "scoped_information_request") {
    const focus = intent.candidate ?? contextualFocus;
    if (!focus) {
      return {
        block:
          "Request scope (server-derived): this is not an all-candidate request, but no single current candidate focus can be established. Do not dump notes or expand across candidates; give a brief scope limitation consistent with the condition style.",
      };
    }
    return {
      // The candidate is stated to the generator. The guard below carries it only
      // for the repair prose and the audit record, because the output check reads
      // the Judge's list alone. No trait count either: the Judge decides that,
      // and its named disclosure
      // outranks this guard, so a sentence here promising "at most one trait"
      // could contradict the facts the Judge put in front of the generator on
      // the same turn. It names the scope it can actually hold and stops there.
      block: `Request scope (server-derived; mandatory): this is not an all-candidate or complete-list request. The current discussion focus is Candidate ${focus}. Answer only about Candidate ${focus} and do not expand to another candidate.`,
      guard: {
        candidate: focus,
        reason: "scopeless_information_request",
      },
    };
  }

  return null;
}

function routePrimaryGoal(routeKind: RouteKind): string {
  switch (routeKind) {
    case "greeting":
      return "Open the live discussion briefly and naturally in the assigned peer or leader status.";
    case "address":
      return "Answer the person's direct question or request first, using only the supplied factual scope.";
    case "followup":
      return "Respond directly to the person's reply, challenge, or clarification on the same thread.";
    case "build_on":
      return "Engage the latest human point and add exactly the supplied non-redundant contribution in natural conversation.";
    case "mediation":
      return "Make the current discussion state clear and give the team one useful direction for what to resolve or cover next.";
    case "backchannel":
      return "Give one brief social reaction without adding candidate information or changing the direction.";
    case "long_silence":
      return "Re-enter the quiet discussion naturally with one grounded continuation that does not repeat Alex's prior move.";
    case "summary":
      return "Present the exact supplied visible-board checkpoint without changing its facts or scope.";
    case "closing":
      return "Present the exact final visible board, then express only the supplied preference state and hand the decision to the humans.";
  }
}

export interface SelectedOpportunityGenerationContext {
  focusCandidate?: Cand | null;
  requestIntent?: RequestIntent;
  id: string;
  kind: "direct_question" | "invitation" | "group_request" | "uptake";
  expectation: "required" | "invited";
  sourceSeq: number;
  currentTriggerSeq: number;
  threadId: string;
  targets: string[];
  requestedAction: string;
  sourceContent: string;
  evidenceSeqs: number[];
}

export function buildRouteUserContext(input: {
  routeKind: RouteKind;
  conditionCode: ConditionCode;
  messages: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
  judgeEvidence?: string | null;
  /** Exactly what this turn may disclose, named by the Judge. */
  discloseTraitIds?: string[];
  /** The Judge's one-sentence instruction to the writer. */
  judgeBrief?: string;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons" | null;
  mediationFocusCandidate?: Cand | null;
  mediationEvidence?: string[];
  buildOnsSinceMediation?: number;
  requestIntentOverride?: RequestIntent;
  conversationSituation?: string;
  /**
   * The candidates the turn's observation recorded as literally named, which is
   * what the task-grounding route reads to decide whether its fixed sentence can
   * be the whole reply. `conversationSituation` is the same observation as
   * prose; this is the one field of it a route has to branch on, so it is passed
   * as data rather than re-read out of a paragraph.
   *
   * Undefined means no observation was available — the observer's `off` mode, or
   * a route that runs without one. The deterministic detector then stands in, as
   * it does everywhere else that needs mentions without a model.
   */
  observedMentionedCandidates?: Cand[];
  communicativeAct?: CommunicativeAct;
  judgeEvidenceSeqs?: number[];
  selectedOpportunity?: SelectedOpportunityGenerationContext;
}): {
  userPrompt: string;
  developerPrompt: string;
  transcriptPrompt: string;
  contextFromSeq: number | null;
  contextToSeq: number | null;
  outputScopeGuard?: RouteOutputScopeGuard;
  focusDepthState: FocusDepthState;
  requestIntent: RequestIntent;
  deterministicResponse?: string;
  taskGroundingSignal: TaskGroundingSignal;
} {
  const conversationGroundedSynthesis =
    input.routeKind === "build_on" && input.judgeEvidence === "conversation_grounded_synthesis";
  // The one-new-fact rule, taken from what the Judge named. It applies only to
  // build_on, whose whole shape is "one new fact attached to the point just made".
  // Other routes share what the Judge named without being narrowed to one.
  const selectedTrait =
    input.routeKind === "build_on" && input.judgeEvidence === "relevant_unsurfaced_information"
      ? TRAIT_BY_ID.get(input.discloseTraitIds?.[0] ?? "")
      : undefined;
  const inquiryCondition = input.conditionCode === "C3" || input.conditionCode === "C4";
  // Interactive generation reads the complete session transcript. Static
  // condition instructions remain the system prompt; this is only runtime data.
  const window = input.routeKind === "greeting" ? [] : input.messages;
  const transcript = window
    .map(
      (message) =>
        `[${message.seq}] ${message.speaker}: ${message.content.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const blocks = [
    "# Dynamic Runtime Contract",
    "Treat this server-authored contract as the authoritative description of the current turn. Use the complete transcript below to verify references and produce a contextually connected reply. Never expose this contract or its labels.",
    input.conversationSituation
      ? `# Current Conversation Situation\n${input.conversationSituation}`
      : "# Current Conversation Situation\nNo Observer situation was supplied; rely conservatively on the transcript and explicit turn goal.",
    input.communicativeAct
      ? `# Communicative Act\nPerform ${input.communicativeAct}. This act controls what social move to make; the fixed condition prompt still controls how Alex performs it.`
      : "# Communicative Act\nFollow the route's established primary goal.",
    input.selectedOpportunity
      ? [
          "# Selected Response Opportunity (sole primary task)",
          `Opportunity ID: ${input.selectedOpportunity.id}`,
          `Kind/expectation: ${input.selectedOpportunity.kind}/${input.selectedOpportunity.expectation}`,
          `Opportunity source message: ${input.selectedOpportunity.sourceSeq}`,
          `Current trigger message: ${input.selectedOpportunity.currentTriggerSeq}`,
          `Thread: ${input.selectedOpportunity.threadId}`,
          `Targets: ${input.selectedOpportunity.targets.join(", ")}`,
          // "Requested action" was the *thread's* description, not the
          // opportunity's — `selectedOpportunityGenerationContext` reads
          // `thread.requestedAction` — and this block presents its contents as
          // the sole primary task. A description of the thread's opening
          // purpose is the wrong thing to hand a turn as an order. The source
          // utterance below says what to respond to, and it is current by
          // construction. The field stays on the context, because the audit
          // records it.
          `Source utterance: ${input.selectedOpportunity.sourceContent}`,
          "Handle this selected opportunity and the current trigger together. Other open opportunities are context only; do not answer or consume them.",
        ].join("\n")
      : "# Selected Response Opportunity\nNone. Follow only the selected voluntary communicative act, if any.",
    input.judgeEvidenceSeqs?.length
      ? `# Decision Evidence\nGround this turn especially in transcript messages ${input.judgeEvidenceSeqs.join(", ")}. Read them in their full conversational context; do not quote sequence numbers.`
      : "# Decision Evidence\nNo specific evidence messages were selected.",
    "# Turn Metadata",
    `Route kind: ${input.routeKind}`,
    `Primary goal: ${routePrimaryGoal(input.routeKind)}`,
    `Anchor message sequence: ${input.anchorSeq}`,
    "Session language: English. Return Alex's visible message in English.",
  ];
  if (input.routeKind === "build_on") {
    blocks.push(
      conversationGroundedSynthesis
        ? "Contribution mode (server-derived): CONVERSATION_GROUNDED_SYNTHESIS. Use only points already stated by the humans in the recent conversation; do not introduce a new candidate fact or private note."
        : selectedTrait
          ? [
              "Contribution mode (server-derived): NOTE_CONTRIBUTION.",
              `Selected new factual contribution (mandatory): ${selectedTrait.valence === "pos" ? "MATCH" : "MISS"} — ${selectedTrait.text}.`,
              inquiryCondition
                ? "Use this as the only new fact, then ask one short alignment question about that same fact. You may refer naturally to an already-spoken human point for coherence, but do not introduce, weigh, or combine another new fact."
                : "Use this as the only new fact. Add at most one short clause explaining how it connects to the latest point; do not recap the candidate's overall profile or restate the equal-weight rule. You may refer naturally to an already-spoken human point for coherence, but do not introduce another new fact.",
              "Respond to the substance of the latest human message before or while adding this note. Because this note was not previously on the table, present it as an additional or separate fact; never falsely call the selected note 'that point' as though the person just said it.",
              "Use complete conversational prose. Do not use mechanical meta-language such as 'Acknowledging that point,' 'Noted,' or 'Taking that in,' and do not emit a bare 'MATCH:' or 'MISS:' record.",
              "Do not invent an operational scenario, causal effect, job-performance consequence, or tradeoff that is absent from the recent conversation.",
            ].join("\n")
          : "Contribution mode (server-derived): NOTE_CONTRIBUTION.",
    );
  }
  // The same sentence the build-on turn carries, on the direct-reply routes too.
  //
  // Alex may not invent job criteria, a rule in the shared output block. A Chair
  // turn is also asked to end on "one clear next-step move", and a next step that
  // proposes a new way of judging the candidates (for example, made-up scenarios
  // to test them against) adds no trait but changes how traits are weighed, which
  // is exactly what the rule forbids.
  if (input.routeKind === "address" || input.routeKind === "followup") {
    blocks.push(
      "Do not invent an operational scenario, causal effect, job-performance consequence, or tradeoff that is absent from the recent conversation, and do not propose an exercise, role-play, vote, or decision procedure of your own. Answer what was actually asked; where this turn's purpose is to point the discussion somewhere, point it at the candidates and what has or has not been said about them.",
      // Alex must not ask the group for evidence that does not exist in this task:
      // "concrete examples", "specific incidents", "mitigation steps" and the like.
      // The cards are all there is, so such a question can only be answered by
      // inventing something. The rule is the principle, not a list of nouns.
      "The only thing anybody here can be asked for is a note on somebody's card. Nobody holds anything else — not an example, an incident, a source or a witness, and not a remedy, a mitigation, a management plan, a training programme, a policy or a way of coping with a trait. Never ask for any of it and never supply one yourself.",
      "If you have nothing left of your own to add, say so plainly about your own notes, or ask what the others still hold in their own notes on a candidate. Do not invent something for the group to work on instead.",
    );
  }
  if (input.routeKind === "mediation") {
    const currentFocus = input.mediationFocusCandidate
      ? `Current discussion focus: Candidate ${input.mediationFocusCandidate}.`
      : "Current discussion focus: a cross-candidate comparison or no single candidate.";
    const conditionMove =
      input.conditionCode === "C4"
        ? "After briefly making the state clear, ask at most one inclusive, grounded question that lets the team address the most useful unresolved comparison or coverage gap."
        : "Use one or two concise declarative sentences: make the state clear and state the most useful unresolved comparison or coverage gap to address next. Ask no question.";
    blocks.push(
      [
        `Mediation trigger: ${input.mediationTrigger ?? "process-state evidence"}.`,
        `Successful leader build-ons since the last mediation: ${input.buildOnsSinceMediation ?? 0}.`,
        currentFocus,
        input.mediationEvidence?.length
          ? `Observed process evidence: ${input.mediationEvidence.join(", ")}.`
          : "Observed process evidence: cadence checkpoint.",
        conditionMove,
        "Add no new candidate trait. Mediation means orienting the team's discussion state and next direction; it does not require conflict, does not require switching candidates, and must not tell the team which candidate to choose.",
        // The same rule the direct-reply routes carry. Mediation is the turn most likely
        // to reach for a procedure, because naming a next direction is its purpose. The
        // direction it names is a candidate or a gap.
        "Name the direction as a candidate or an uncovered area, never as a method: no vote, round, exercise, scenario, ranking rule, scoring scheme, or stopping rule, and no invented criterion for weighing traits against one another.",
        "Keep the whole mediation to two short sentences and aim for 45 words or fewer. Name only the current focus and the coverage gap; do not enumerate discussed traits, counts, or lettered options. Put the next-step sentence or question on a new line.",
      ].join("\n"),
    );
  }
  const focusDepthState = deriveFocusDepthState({
    routeKind: input.routeKind,
    messages: window,
    revealStats: input.revealStats,
  });

  if (input.routeKind === "summary" || input.routeKind === "closing") {
    blocks.push(
      `Visible on-table coverage (human and Alex disclosures; deduplicated):\n${formatVisibleBoardCoverage(input.revealStats)}`,
    );
  } else if (input.routeKind === "mediation") {
    // Mediation describes the live discussion state, so both human and Alex
    // disclosures must be visible. Human-only coverage would erase the two
    // build-ons that triggered this checkpoint.
    blocks.push(
      `Visible on-table coverage (human and Alex disclosures; deduplicated):\n${formatVisibleBoardCoverage(input.revealStats)}`,
    );
    // The visible board shows what has been said, not who said it, so a candidate
    // Alex covered alone looks the same as one the room covered. The sentence below
    // is the one the Judge reads, from the same function, so the brief and the
    // message always name the same gap.
    // Gated on the condition, not the route, for the same reason as
    // `leaderCoverageNote`: owning the candidate list is the status manipulation.
    // Mediation is already a Chair-only route; this also blocks any direct call.
    if (isLeaderCondition(input.conditionCode)) {
      blocks.push(
        `Who still owes notes (the only source for the coverage gap; the board above cannot tell you this):\n${coverageGapNote(input.revealStats)}\nAsk only for what this sentence leaves uncovered. A candidate it names as already covered is covered, however much the room has argued about it.`,
      );
    }
  } else if (
    input.routeKind === "long_silence" ||
    input.routeKind === "address" ||
    input.routeKind === "followup"
  ) {
    // Chair: gets the whole visible board, so it can pull the picture together; a
    // Chair that did not know the whole picture would not come across as a leader.
    // Member: gets only its own unsaid notes, so its turns stay its own point of
    // view. Giving a Member the team's coverage would make it sound like a mediator.
    if (isLeaderCondition(input.conditionCode)) {
      const coverage =
        input.routeKind === "long_silence"
          ? formatConfirmedCoverage(input.revealStats)
          : formatVisibleBoardCoverage(input.revealStats);
      const label =
        input.routeKind === "long_silence"
          ? "Confirmed on-table coverage (human-grounded; AI-only disclosures excluded)"
          : "Visible on-table coverage (human and Alex disclosures; deduplicated)";
      blocks.push(`${label}:\n${coverage}`);
    } else {
      const notes = formatUnsurfacedNotes(window, input.revealStats);
      if (notes) blocks.push(notes);
    }
  }
  if (input.routeKind === "long_silence") {
    blocks.push(formatLongSilenceContinuity(window));
  }
  // The anchor human message is classified exactly once; the same intent
  // drives the focus-control override, the preference cue, and the scope block.
  const requestBundle = requestBundleForAnchor(window, input.anchorSeq);
  const anchor = requestBundle.anchor;
  const groundingSignal = taskGroundingSignal(requestBundle.content);
  // One lexical reading per turn, carried across Alex's own clarifying questions
  // when the fragment states no request of its own. Both the intent below and
  // the deterministic bypass read this same value; classifying twice is what let
  // the two disagree silently in the first place.
  const requestReadable = input.routeKind === "address" || input.routeKind === "followup";
  const directLexicalIntent = requestReadable
    ? classifyRequestIntent(requestBundle.content)
    : NO_REQUEST_INTENT;
  const lexicalIntent =
    requestReadable && directLexicalIntent.kind === "none"
      ? carriedRequestIntent(window, requestBundle.startIndex)
      : directLexicalIntent;
  // A selected opportunity's stored intent is the Observer's reading of the
  // message that made the request, so it is checked against the word-based reading
  // of that same message, not only against the latest message, which on a
  // carried-over request often asks nothing at all.
  //
  // The widening rules are narrow: only a too-narrow reading may be widened, only
  // a complete-list reading widens it, and that reading must itself be directed at
  // Alex. This runs first, and the widening from the latest message still runs on
  // top of it.
  const observedIntent = input.selectedOpportunity
    ? widenRequestIntent(
        input.selectedOpportunity.requestIntent ?? NO_REQUEST_INTENT,
        requestReadable
          ? classifyRequestIntent(input.selectedOpportunity.sourceContent)
          : NO_REQUEST_INTENT,
      )
    : (input.requestIntentOverride ?? lexicalIntent);
  // The Observer's own scope fields decide a whole-board recap, over its `kind`
  // label and over the word list; see `observerAskedForTheWholeBoard`.
  const observerWholeBoard =
    requestReadable && observerAskedForTheWholeBoard(input.selectedOpportunity?.requestIntent);
  const widenedIntent = requestReadable
    ? widenRequestIntent(observedIntent, lexicalIntent)
    : NO_REQUEST_INTENT;
  const requestIntent: RequestIntent = observerWholeBoard
    ? {
        ...widenedIntent,
        kind: "complete_all_candidates",
        candidate: null,
        candidates: [...CANDIDATES],
      }
    : widenedIntent;
  const focusControlOverridden =
    Boolean(input.selectedOpportunity) ||
    requestOverridesFocusControl(input.routeKind, anchor, requestIntent);
  const focusControl = focusControlOverridden ? null : formatInternalFocusControl(focusDepthState);
  if (focusControl) blocks.push(focusControl);
  // Inject the preference cue only where the Turn Metadata can actually spend
  // it: closing always; address/followup on explicit preference requests;
  // peer build-on while the discussion is already weighing candidates. A
  // leader build-on must not state a preference, so the cue is noise there.
  const preferenceCueWanted =
    input.routeKind === "closing" ||
    ((input.routeKind === "address" || input.routeKind === "followup") &&
      (["preference_request", "preference_reason_request", "insight_request"].includes(
        requestIntent.kind,
      ) ||
        requestIntent.kind === "narrow_decision_request")) ||
    (input.routeKind === "build_on" &&
      !isLeaderCondition(input.conditionCode) &&
      peerBuildOnPreferenceRelevant(anchor));
  if (preferenceCueWanted) {
    blocks.push(
      requestIntent.kind === "narrow_decision_request" &&
        requestIntent.candidates &&
        requestIntent.candidates.length >= 2
        ? formatScopedPreferenceDecision(input.revealStats, requestIntent.candidates)
        : formatPreferenceDecision(input.revealStats),
    );
  }
  const requestScope = requestScopeFromIntent({
    routeKind: input.routeKind,
    conditionCode: input.conditionCode,
    window,
    revealStats: input.revealStats,
    intent: requestIntent,
    semanticFocus: input.selectedOpportunity
      ? (input.selectedOpportunity.focusCandidate ?? null)
      : undefined,
  });
  const resolvedRequestCandidate =
    requestIntent.candidate ??
    (input.selectedOpportunity
      ? (input.selectedOpportunity.focusCandidate ?? null)
      : (currentTopicCandidate(
          window.map((message) => ({ sender: message.speaker, content: message.content })),
        ) ?? lastHumanDiscussionCandidate(input.revealStats, window[0]?.seq ?? 0)));
  const completeRequestCandidate =
    requestIntent.kind === "complete_single_candidate" ? resolvedRequestCandidate : null;
  // The fixed complete-list answers step aside for the Judge: a turn it named
  // facts for is a turn whose content it decided, and reciting the whole board
  // instead would be a different turn.
  const judgeNamedTheFacts = Boolean(input.discloseTraitIds?.length);
  // The fixed task-correction sentence is a whole reply, so it may only answer a
  // message that asked for nothing else. A message that also names a candidate is
  // making a point about the board, so it gets the correction as an instruction
  // block instead (see `taskGroundingInstructionBlock`).
  const groundingTurnNamesCandidate =
    (input.observedMentionedCandidates ?? literalCandidateMentions(requestBundle.content)).length >
    0;
  const groundingInstruction =
    groundingSignal !== "none" && groundingTurnNamesCandidate
      ? taskGroundingInstructionBlock({
          signal: groundingSignal,
          conditionCode: input.conditionCode,
        })
      : null;
  if (groundingInstruction) blocks.push(groundingInstruction);
  const deterministicResponse =
    (groundingTurnNamesCandidate
      ? null
      : deterministicTaskGroundingResponse({
          signal: groundingSignal,
          conditionCode: input.conditionCode,
          content: requestBundle.content,
          repeat: taskGroundingAlreadyDelivered(window, input.anchorSeq),
        })) ??
    // When an opportunity is selected, the intent comes from the Observer. The fixed
    // answer is used only when the Observer's reading and the word-based reading
    // agree; when they disagree, the turn goes to the model, never to a wider fixed
    // answer. The exception is the Observer's scope fields for a whole-board recap,
    // because a word list has no say about wording it does not contain.
    (!judgeNamedTheFacts && (observerWholeBoard || lexicalIntent.kind === requestIntent.kind)
      ? deterministicCompleteResponse({
          intent: requestIntent,
          candidate: completeRequestCandidate,
          revealStats: input.revealStats,
          conditionCode: input.conditionCode,
        })
      : undefined) ??
    deterministicKnownCountResponse({
      intent: requestIntent,
      candidate: resolvedRequestCandidate,
      revealStats: input.revealStats,
    });
  if (requestScope) blocks.push(requestScope.block);
  // Direct replies must not repeat a question Alex already asked. build_on already
  // says "don't restate what you've already said" and long_silence says "vary the
  // opening"; this covers the two direct-reply routes, in every condition.
  // The routes on which Alex contributes content of its own. Greeting, summary and
  // closing have a fixed format; a backchannel says nothing to repeat; mediation
  // may not name traits, so a trait list would work against it.
  if (["address", "followup", "build_on", "long_silence"].includes(input.routeKind)) {
    const alreadyStated = formatAlreadyStatedByYou(input.revealStats);
    if (alreadyStated) blocks.push(alreadyStated);
  }
  // Rules that do not change from turn to turn (do not repeat your own question,
  // you cannot draw a table, you cannot compile everyone's notes, A to D are
  // candidates and not your name) live in the four condition prompts. Whether a
  // message triggers them is read by the Judge, not by word lists.

  // What Alex still holds. Every route that can disclose a trait gets it; a
  // greeting and a backchannel cannot, and the summary and closing recaps are
  // assembled deterministically from the board rather than from the card.
  if (contributesToBoard(input.routeKind)) {
    blocks.push(formatUnsurfacedOwnNotes(input.revealStats));
  }
  // The "# Your Notes" section uses + and - symbols, while every other block uses
  // the words match and miss. This tells Alex to use the words. The summary is
  // exempt, because its fixed format uses the "+:" and "-:" shape.
  if (input.routeKind !== "summary") {
    blocks.push(
      "Notation (server-derived): the + and − signs exist only for reading your notes. In your visible message never write '+', '−', or a plus/minus list — describe each trait in words as a match or a miss.",
    );
  }
  // The Judge's instruction, and the exact wording of the facts it named. The
  // stage that read the message says what the turn is for, in one sentence, and
  // the writer works from that.
  //
  // Placed last so it sits nearest the transcript, and stated as the turn's
  // purpose rather than as a rule: it is neither a limit nor a style, and the four
  // condition prompts own how Alex sounds.
  if (input.judgeBrief?.trim()) {
    const namedFacts = (input.discloseTraitIds ?? [])
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait): trait is NonNullable<typeof trait> => Boolean(trait))
      .map(
        (trait) =>
          `- ${trait.valence === "pos" ? "MATCH" : "MISS"} for Candidate ${trait.candidate}: ${trait.text}`,
      );
    blocks.push(
      [
        `This turn: ${input.judgeBrief.trim()}`,
        namedFacts.length
          ? `Facts you may put on the table this turn, in these words:\n${namedFacts.join("\n")}\nDo not add a candidate fact beyond these.`
          : "Add no candidate fact this turn. You may refer to what has already been said.",
      ].join("\n\n"),
    );
  }
  const developerPrompt = blocks.join("\n\n");
  const transcriptPrompt = [
    "# Complete Conversation Transcript",
    transcript || "No visible conversation messages.",
    "",
    "Return only Alex's next visible chat message. Do not mention runtime metadata or sequence numbers.",
  ].join("\n");
  const focusGuard: RouteOutputScopeGuard | undefined =
    focusControl && focusDepthState.candidate
      ? {
          candidate: focusDepthState.candidate,
          reason: "focus_depth",
        }
      : undefined;
  // Build-on is a one-point route by contract even after depth has been met.
  // Keep that output limit separate from focus depth so direct answers can
  // satisfy their exact request without being clipped to one trait.
  const routeSinglePointGuard: RouteOutputScopeGuard | undefined =
    input.routeKind === "build_on" && focusDepthState.candidate
      ? {
          candidate: focusDepthState.candidate,
          // A grounded synthesis adds no new fact, so its list is empty; an
          // ordinary one-point build-on carries no list of its own and takes
          // whatever the Judge named. The key is omitted rather than set to
          // undefined so the guard compares equal to one built without it.
          ...(conversationGroundedSynthesis ? { allowedTraitIds: [] as string[] } : {}),
          reason: conversationGroundedSynthesis
            ? "conversation_grounded_synthesis"
            : "route_single_point",
        }
      : undefined;
  const selectedContributionGuard: RouteOutputScopeGuard | undefined = selectedTrait
    ? {
        candidate: selectedTrait.candidate,
        allowedTraitIds: [selectedTrait.id],
        requiredTraitId: selectedTrait.id,
        reason: "selected_note_contribution",
      }
    : undefined;
  const mediationNoNewTraitsGuard: RouteOutputScopeGuard | undefined =
    input.routeKind === "mediation"
      ? {
          candidate: null,
          allowedTraitIds: [],
          reason: "mediation_no_new_traits",
        }
      : undefined;
  // The Judge's list is the turn's factual limit; nothing counts traits, sentences
  // or words. An explicit complete-list request carries no list of its own, so it
  // adds no limit either.
  // Only the routes the Judge actually decides. A greeting, a summary and a
  // closing are built elsewhere and never pass through it, so a missing list there
  // means "no Judge ran", not "say nothing".
  const judgeNamedGuard: RouteOutputScopeGuard | undefined =
    input.discloseTraitIds && contributesToBoard(input.routeKind)
      ? {
          candidate: null,
          allowedTraitIds: input.discloseTraitIds,
          ...(input.discloseTraitIds.length === 1
            ? { requiredTraitId: input.discloseTraitIds[0]! }
            : {}),
          reason: "judge_named_disclosure",
        }
      : undefined;
  // The Judge's list comes first. Everything below it is a rule-based reading of
  // the participant's words, and the stage that read the message decides: a later
  // layer that did not see that decision does not overrule it.
  // The first three are the Judge's own list in a route's shape: they read
  // `discloseTraitIds` and add what that route needs, so they are not competing
  // decisions. `judgeNamedGuard` is the same list for every other route. The
  // request scope comes after all of them.
  const outputScopeGuard =
    selectedContributionGuard ??
    routeSinglePointGuard ??
    mediationNoNewTraitsGuard ??
    judgeNamedGuard ??
    requestScope?.guard ??
    focusGuard;
  return {
    // Kept as a combined audit/test view. Model calls use the separated
    // developerPrompt + transcriptPrompt fields below.
    userPrompt: `${developerPrompt}\n\n${transcriptPrompt}`,
    developerPrompt,
    transcriptPrompt,
    contextFromSeq: window[0]?.seq ?? null,
    contextToSeq: window.at(-1)?.seq ?? null,
    outputScopeGuard,
    focusDepthState,
    requestIntent,
    deterministicResponse,
    taskGroundingSignal: groundingSignal,
  };
}
