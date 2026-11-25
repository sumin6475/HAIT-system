// Display names, kept in one place: the name shown on screen and the speaker
// label Alex sees in the transcript come from here. `Message.sender` still
// stores the participant code; these labels are only for display and prompts.
import type { ConditionCode, SenderRole } from "../types.js";

export const PARTICIPANT_LABEL: Record<string, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
};

// The name shown for Alex, by condition. Chair conditions show "Chair" and
// Member conditions show "Member", so a Member never looks like it leads.
export function aiDisplayName(c: ConditionCode): string | undefined {
  if (c === "C2" || c === "C4") return "Alex — Chair";
  if (c === "C1" || c === "C3") return "Alex — Member";
  return undefined; // CTRL has no AI participant
}

// The speaker labels in the transcript Alex reads. They must match the on-screen
// labels, or a participant naming someone would not reach Alex correctly.
export function transcriptLabel(senderRole: SenderRole): string {
  return senderRole === "ai" ? "Alex" : (PARTICIPANT_LABEL[senderRole] ?? senderRole);
}
