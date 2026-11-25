// Experiment condition types
export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type AIStatus = "peer" | "leader";
export type CommStrategy = "xai" | "aci";
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";
export type Candidate = "A" | "B" | "C" | "D";
export type SenderRole = ParticipantRole | "ai";
export type InterventionDecisionStage =
  | "priority"
  | "cooldown"
  | "main_judge"
  | "route_gate"
  | "long_silence_timer"
  | "summary"
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

// A message as shown in the UI.
export interface ChatMessage {
  id: string;
  sender: string;
  senderRole: "you" | "other" | "ai";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  senderName: string; // humans: "Participant X/Y/Z"; Alex: "" (the aiName state is used when rendering)
}

export interface InfoCard {
  id: string;
  candidate: Candidate;
  attribute: string;
  valence: "positive" | "negative";
}
