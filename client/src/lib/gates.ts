// Researcher-approval gates, defined in one place. The server only stores and
// reports arrivals and approvals for whatever gate ids it is given.
// To turn a gate on or off, change its `enabled` line. Each id names the step the gate unlocks.
// This file must not import api.ts (api.ts imports this file).

export type GateId =
  "consent" | "demographics" | "infoCards" | "waiting" | "teamDecision" | "debrief";
export type GateApprovals = Partial<Record<GateId, string>>;

export interface GateDef {
  id: GateId;
  enabled: boolean; // set to false to turn the gate off
  nextPath: string; // where to go once approved
  nextLabel: string; // shown on the waiting screen as "Next: ..."
  holdNote?: string; // one extra line of guidance for this gate
}

export const GATES: GateDef[] = [
  { id: "consent", enabled: true, nextPath: "/chat/consent", nextLabel: "Consent Form" },
  { id: "demographics", enabled: true, nextPath: "/chat/demographics", nextLabel: "Pre-Survey" },
  {
    id: "infoCards",
    enabled: true,
    nextPath: "/chat/info-cards",
    nextLabel: "Candidate Information",
  },
  { id: "waiting", enabled: true, nextPath: "/chat/waiting", nextLabel: "Team Discussion" },
  {
    id: "teamDecision",
    enabled: true,
    nextPath: "/chat/team-decision",
    nextLabel: "Team Decision",
    holdNote: "The discussion has ended.",
  },
  {
    id: "debrief",
    enabled: true,
    nextPath: "/chat/debrief",
    nextLabel: "Debrief",
    holdNote: "Please stay on the Zoom call — the researcher will speak with your team first.",
  },
];

export const gateById = (id: string) => GATES.find((g) => g.id === id);

// Whether a gate is passed. A disabled gate always is.
export const gateOpen = (id: GateId, approvals: GateApprovals | undefined) => {
  const g = gateById(id);
  return !g?.enabled || Boolean(approvals?.[id]);
};
