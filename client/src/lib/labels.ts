// Participant display names, kept in one place.
// The participant code (TP-X-C2-010) shows the condition, so it is never shown on screen.
import type { ParticipantRole } from "@/types";

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
};
