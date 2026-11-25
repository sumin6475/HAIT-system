// Decides where a reconnecting participant goes, from their ParticipantState.
// Rules are checked from the highest priority down; the first match wins.
// At a gate boundary, viaGate sends the participant to the waiting screen until
// the gate is approved (or straight on if the gate is approved or disabled).

import { ParticipantState } from "./api";
import { gateOpen, type GateId } from "./gates";

export type ChatPath =
  | "/chat/consent"
  | "/chat/demographics"
  | "/chat/info-cards"
  | "/chat/pre-discussion"
  | "/chat/waiting"
  | "/chat/room"
  | "/chat/team-decision"
  | "/chat/post-survey"
  | "/chat/debrief"
  | "/chat/complete"
  | `/chat/hold/${GateId}`;

// Closed gate: wait. Open gate (approved or disabled): go straight on.
function viaGate(state: ParticipantState, gate: GateId, direct: ChatPath): ChatPath {
  return gateOpen(gate, state.approvals) ? direct : (`/chat/hold/${gate}` as ChatPath);
}

export function resolveResumePath(state: ParticipantState): ChatPath {
  // 1. Fully finished.
  if (state.completedAt) {
    return "/chat/complete";
  }

  // 1.5 If the session is already running, go straight to the discussion room, even
  //     if progress still says waiting. A participant who rejoins while waiting at
  //     the end-of-discussion gate also lands here: if the timer has already run out,
  //     the first tick of the room's timer sends them on to the team-decision gate.
  if (state.sessionStatus === "in_progress") {
    return "/chat/room";
  }
  //     If the discussion is over, continue with the steps after it, starting at
  //     the team decision if the post-survey is not done yet.
  if (state.sessionStatus === "completed" || state.sessionStatus === "data_ready") {
    if (!state.progress.teamDecision) return "/chat/team-decision";
    if (!state.progress.postSurvey) return "/chat/post-survey";
    return viaGate(state, "debrief", "/chat/debrief"); // gate before the debrief interview
  }

  const p = state.progress;

  // 2. Post-survey done: only the debrief is left.
  if (p.postSurvey) return viaGate(state, "debrief", "/chat/debrief");

  // 3. Pre-discussion done: about to enter the discussion (gate before the discussion starts).
  if (p.preDiscussion) return viaGate(state, "waiting", "/chat/waiting");

  // 4. Info cards done (no gate: info cards lead straight to the pre-discussion choice).
  if (p.infoCards) return "/chat/pre-discussion";

  // 5. Demographics done (gate before the main study starts).
  if (p.demographics) return viaGate(state, "infoCards", "/chat/info-cards");

  // 6. Consent done.
  if (p.consent) return viaGate(state, "demographics", "/chat/demographics");

  // 7. New, or no progress yet (first gate: start once both participants have joined).
  return viaGate(state, "consent", "/chat/consent");
}
