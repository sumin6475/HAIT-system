// Wrapper for the server API.
//
// Environment variables:
//   VITE_SERVER_URL    for example http://localhost:3001
//   VITE_ADMIN_TOKEN   must equal ADMIN_TOKEN in server/.env
//
// Every admin call sends the x-admin-token header.
// Errors are thrown; React Query catches and handles them.

import type { GateApprovals, GateId } from "./gates";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "";

// --- Types (keep in step with the server's responses) ---

export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type ProfileSlot = "X" | "Y" | "Z";
export type Candidate = "A" | "B" | "C" | "D";
export type SenderRole = ParticipantRole | "ai";
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
export interface ProgressState {
  consent?: boolean;
  demographics?: boolean;
  infoCards?: boolean;
  preDiscussion?: boolean;
  waiting?: boolean;
  teamDecision?: boolean;
  postSurvey?: boolean;
  debrief?: boolean;
  complete?: boolean;
}
export interface ParticipantState {
  participantCode: string;
  role: ParticipantRole;
  assignedProfile: ProfileSlot;
  sessionCode: string;
  conditionCode: ConditionCode;
  progress: ProgressState;
  preDiscussionChoice?: Candidate | null;
  completedAt?: string | null;
  sessionStatus: SessionStatus;
  approvals?: GateApprovals; // researcher gate approvals (gateId -> ISO time; only whether each is set is used)
}

export interface SessionSummary {
  sessionCode: string;
  conditionCode: ConditionCode;
  status: SessionStatus;
  isTest: boolean;
  participantCount: number;
  gates: { approvals: GateApprovals; arrivals: Record<GateId, number> };
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
}

export interface ParticipantInfo {
  participantCode: string;
  role: ParticipantRole;
  assignedProfile: ProfileSlot;
  lastSeenAt?: string | null;
}

export interface SessionDetail {
  session: {
    sessionCode: string;
    conditionCode: ConditionCode;
    status: SessionStatus;
    isTest: boolean;
    startedAt?: string | null;
    endedAt?: string | null;
    createdAt: string;
  };
  participants: ParticipantInfo[];
  messages: Array<{
    seq: number;
    sender: string;
    senderRole: SenderRole;
    content: string;
    createdAt: string;
  }>;
}

export interface CreateSessionResponse {
  isTest: boolean;
  session: SessionDetail["session"];
  participants: ParticipantInfo[];
}

// --- Internal fetch helper ---
// Adds the common headers to each admin call.

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    // Admin token header.
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_TOKEN,
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }

  return data as T;
}

// --- Public fetch (no admin token), used by the participant pages ---
async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  // res.ok === false (HTTP error) or data?.ok === false (server error)
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  return data as T;
}

// --- API functions ---

// Session list.
export async function listSessions(): Promise<SessionSummary[]> {
  const data = await adminFetch<{ ok: true; sessions: SessionSummary[] }>("/api/sessions");
  return data.sessions;
}

// One session with its participants.
export async function getSession(sessionCode: string): Promise<SessionDetail> {
  const data = await adminFetch<{ ok: true } & SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionCode)}`,
  );
  return { session: data.session, participants: data.participants, messages: data.messages };
}

// Everything about one session (messages and every Alex decision), for the test harness download.
export interface InterventionLog {
  turnIndex: number;
  decision: "speak" | "stay_silent";
  triggerReason: string;
  cue?: string | null;
  routeKind?: import("@/types").RouteKind | null;
  source?: string | null;
  reservationId?: string | null;
  anchorSeq?: number | null;
  priorityRoute?: "address" | "followup" | "long_silence" | null;
  priorityEvidence?: string | null;
  mainJudgeDecision?: "contribute" | "acknowledge" | "silent" | null;
  judgeEvidence?: string | null;
  decisionStage?: import("@/types").InterventionDecisionStage | null;
  routeReason?: string | null;
  outcome?: string | null;
  silenceReason?: string | null;
  promptKey?: string | null;
  contextFromSeq?: number | null;
  contextToSeq?: number | null;
  floorMs?: number | null;
  generationSucceeded?: boolean | null;
  interventionSaved?: boolean | null;
  broadcastSucceeded?: boolean | null;
  mediationLatched?: boolean | null;
  mediationEvidence?: string[] | null;
  buildOnsSinceMediation?: number | null;
  focusCandidate?: "A" | "B" | "C" | "D" | null;
  focusBasis?: string | null;
  focusHumanConfirmedCount?: number | null;
  focusDepthThreshold?: number | null;
  focusDirective?: "stay" | "free" | null;
  focusGuarded?: boolean | null;
  internalMetadataRepaired?: boolean | null;
  outputScopeCandidate?: "A" | "B" | "C" | "D" | null;
  outputScopeRepaired?: boolean | null;
  outputScopeViolation?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
  createdAt: string;
}
export interface SessionExport {
  session: SessionDetail["session"] & {
    aiState?: {
      lifecycle?: "active" | "closing" | "muted";
      closingReason?: string;
      closingAt?: string;
      summaryStatus?: "not_eligible" | "pending" | "generating" | "done";
      summaryMessageId?: string;
      closingMessageId?: string;
      mediationLatched?: boolean;
      mediationEvidence?: string[];
      buildOnsSinceMediation?: number;
      buildOnFocusCandidate?: "A" | "B" | "C" | "D";
      lastBackchannelAt?: string;
    } | null;
  };
  participants: Array<{
    participantCode: string;
    role: ParticipantRole;
    assignedProfile: ProfileSlot;
  }>;
  messages: SessionDetail["messages"];
  interventions: InterventionLog[];
  conversationObservations: Array<Record<string, unknown>>;
}

export async function exportSession(sessionCode: string): Promise<SessionExport> {
  const data = await adminFetch<{ ok: true } & SessionExport>(
    `/api/sessions/${encodeURIComponent(sessionCode)}/export`,
  );
  return {
    session: data.session,
    participants: data.participants,
    messages: data.messages,
    interventions: data.interventions,
    conversationObservations: data.conversationObservations ?? [],
  };
}

// Create a session.
export async function createSession(input: {
  conditionCode: ConditionCode;
  isTest?: boolean;
}): Promise<CreateSessionResponse> {
  const data = await adminFetch<{ ok: true } & CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    isTest: data.isTest,
    session: data.session,
    participants: data.participants,
  };
}

// Delete a session.
export async function deleteSession(sessionCode: string): Promise<void> {
  await adminFetch(`/api/sessions/${encodeURIComponent(sessionCode)}`, {
    method: "DELETE",
  });
}

// === Conditions (the compiled prompts, read only) ===
// GET /api/conditions
export interface CompiledCondition {
  sourceCondition: string;
  routes: Partial<
    Record<import("@/types").RouteKind, { promptKey: string; prompt: string; hash: string }>
  >;
}

export interface CompiledPromptsResponse {
  conditions: Record<string, CompiledCondition>;
}

// Every condition's prompts.
export async function getConditions(): Promise<CompiledPromptsResponse> {
  return adminFetch<CompiledPromptsResponse>("/api/conditions");
}

// Test chat: one Alex reply for the transcript so far (nothing is saved).
export interface TestChatResult {
  content: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function postTestChat(input: {
  conditionCode: ConditionCode;
  routeKind: import("@/types").RouteKind;
  transcript: { sender: string; content: string }[];
}): Promise<TestChatResult> {
  return adminFetch<TestChatResult>("/api/conditions/test-chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

//=== Participant API (public) ===

// Mark a progress step as finished; called when each page is completed.
export async function markProgress(
  participantCode: string,
  step: ProgressStep,
): Promise<ProgressState> {
  const data = await publicFetch<{ ok: true; progress: ProgressState }>(
    `/api/participants/${encodeURIComponent(participantCode)}/progress`,
    {
      method: "PATCH",
      body: JSON.stringify({ step }),
    },
  );
  return data.progress;
}

// Save the pre-discussion choice.
export async function setPreChoice(participantCode: string, choice: Candidate): Promise<Candidate> {
  const data = await publicFetch<{ ok: true; preDiscussionChoice: Candidate }>(
    `/api/participants/${encodeURIComponent(participantCode)}/pre-choice`,
    {
      method: "PATCH",
      body: JSON.stringify({ choice }),
    },
  );
  return data.preDiscussionChoice;
}

// Record arrival at a gate; called when the waiting screen opens (safe to repeat).
export async function markGateArrival(participantCode: string, gate: GateId): Promise<void> {
  await publicFetch(`/api/participants/${encodeURIComponent(participantCode)}/gate-arrival`, {
    method: "PATCH",
    body: JSON.stringify({ gate }),
  });
}

// Approve a gate from the dashboard (safe to repeat).
export async function approveGate(sessionCode: string, gate: GateId): Promise<GateApprovals> {
  const data = await adminFetch<{ ok: true; approvals: GateApprovals }>(
    `/api/sessions/${encodeURIComponent(sessionCode)}/gates/${encodeURIComponent(gate)}/approve`,
    { method: "PATCH" },
  );
  return data.approvals;
}

// Current state, used on reconnect.
export async function getParticipantState(participantCode: string): Promise<ParticipantState> {
  const data = await publicFetch<{ ok: true; state: ParticipantState }>(
    `/api/participants/${encodeURIComponent(participantCode)}/state`,
  );
  return data.state;
}

// Mute Alex for this session (researcher stop switch). The humans, chat and timer carry on.
export async function stopAI(sessionCode: string): Promise<{ muted: boolean }> {
  const data = await adminFetch<{ ok: true; sessionCode: string; muted: boolean }>(
    `/api/sessions/${encodeURIComponent(sessionCode)}/stop-ai`,
    { method: "POST" },
  );
  return { muted: data.muted };
}

// Save the team decision (called by the participant; status in_progress -> completed).
export async function submitTeamDecision(
  sessionCode: string,
  participantCode: string,
  decision: Candidate,
): Promise<{
  teamDecision: Candidate[];
  status: SessionStatus;
  submittedCount: number;
  expected: number;
}> {
  const data = await publicFetch<{
    ok: true;
    sessionCode: string;
    teamDecision: Candidate[];
    status: SessionStatus;
    submittedCount: number;
    expected: number;
  }>(`/api/sessions/${encodeURIComponent(sessionCode)}/team-decision`, {
    method: "PATCH",
    body: JSON.stringify({ participantCode, decision }),
  });
  return {
    teamDecision: data.teamDecision,
    status: data.status,
    submittedCount: data.submittedCount,
    expected: data.expected,
  };
}

// Finalize (called by the participant; status completed -> data_ready).
export async function finalizeSession(sessionCode: string): Promise<{ status: SessionStatus }> {
  const data = await publicFetch<{
    ok: true;
    sessionCode: string;
    status: SessionStatus;
  }>(`/api/sessions/${encodeURIComponent(sessionCode)}/finalize`, {
    method: "PATCH",
  });
  return {
    status: data.status,
  };
}
