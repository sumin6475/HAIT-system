// Shared types. Keep in step with client/src/types/index.ts.

// Experiment conditions.
export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type AIStatus = "peer" | "leader";
export type CommStrategy = "xai" | "aci";

// Participants and sessions.
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";

// Candidates A to D.
export type Candidate = "A" | "B" | "C" | "D";

// Information cards (profiles).
export type ProfileSlot = "X" | "Y" | "Z";

// Who sent a message.
export type SenderRole = ParticipantRole | "ai";

// Whether Alex speaks.
export type AIDecision = "speak" | "stay_silent";

// Researcher-approval gates. Each id names the step the gate unlocks.
export type GateId =
  "consent" | "demographics" | "infoCards" | "waiting" | "teamDecision" | "debrief";
export const GATE_ORDER: GateId[] = [
  "consent",
  "demographics",
  "infoCards",
  "waiting",
  "teamDecision",
  "debrief",
];

// Steps of the study flow, used to send a reconnecting participant to the right page.
export type ProgressStep =
  | "consent"
  | "demographics"
  | "infoCards"
  | "preDiscussion"
  | "waiting"
  | "teamDecision"
  | "postSurvey"
  | "debrief"
  | "complete";

// How a turn was routed.
export type PriorityRoute = "address" | "followup" | "long_silence" | null;
export type MainJudgeDecision = "contribute" | "acknowledge" | "silent";
export type CommunicativeAct =
  | "answer"
  | "participate"
  | "follow"
  | "contribute"
  | "acknowledge"
  | "mediate"
  /**
   * Put the board back in front of the group, as it stands, adding nothing.
   *
   * Chair conditions only, and at most once a session.
   */
  | "recap";
// Where a turn was decided. Kept apart from the Judge's own answer so that a
// silence caused by the cooldown, a timer, a priority rule, or a route gate can
// each be told apart.
export type InterventionDecisionStage =
  | "priority"
  | "cooldown"
  | "main_judge"
  | "route_gate"
  | "long_silence_timer"
  | "lifecycle"
  | "system";
export type RouteKind =
  | "address"
  | "followup"
  | "long_silence"
  | "build_on"
  | "mediation"
  | "backchannel"
  | "greeting"
  | "summary"
  | "closing";

/**
 * The routes that do not move the board.
 *
 * A greeting and a backchannel carry no trait; a summary and a closing repeat
 * what is already in view instead of adding to it. Three rules follow from this
 * one fact and must stay in step: these turns are not counted as pooling, they
 * are not given the list of Alex's unsaid notes, and they are not expected to
 * record a disclosure.
 */
export const NON_CONTRIBUTING_ROUTES: readonly RouteKind[] = [
  "greeting",
  "backchannel",
  "summary",
  "closing",
];

export function contributesToBoard(routeKind: string): boolean {
  return !NON_CONTRIBUTING_ROUTES.includes(routeKind as RouteKind);
}

/**
 * The values the turn path writes to `AIIntervention.outcome`. That field has no
 * schema enum, so this is the one list of them, kept for the export's readers.
 */
export type TurnOutcome =
  "cancelled" | "stay_silent" | "generation_failed" | "saved" | "broadcast" | "broadcast_failed";
