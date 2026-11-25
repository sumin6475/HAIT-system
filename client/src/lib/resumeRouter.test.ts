// Tests for where a reconnecting participant is sent (resumeRouter).
// Covers rule 1.5 (a running session goes straight to the room) and, for each
// gate, waiting before approval and going straight on after it.

import { describe, expect, it } from "vitest";
import type { ParticipantState, ProgressState } from "./api";
import type { GateApprovals } from "./gates";
import { resolveResumePath } from "./resumeRouter";

function buildState(overrides: {
  progress?: ProgressState;
  approvals?: GateApprovals;
  sessionStatus?: ParticipantState["sessionStatus"];
  completedAt?: string | null;
}): ParticipantState {
  return {
    participantCode: "T-C1-001-X",
    role: "humanX",
    assignedProfile: "X",
    sessionCode: "T-C1-001",
    conditionCode: "C1",
    sessionStatus: overrides.sessionStatus ?? "waiting",
    progress: overrides.progress ?? {},
    completedAt: overrides.completedAt ?? null,
    approvals: overrides.approvals,
  };
}

describe("resolveResumePath (Step 32 gates)", () => {
  it("rule 1.5: in_progress → /chat/room, whatever the progress", () => {
    expect(
      resolveResumePath(buildState({ sessionStatus: "in_progress", progress: { waiting: true } })),
    ).toBe("/chat/room");
    expect(resolveResumePath(buildState({ sessionStatus: "in_progress" }))).toBe("/chat/room");
  });

  it("completedAt set → /chat/complete", () => {
    expect(resolveResumePath(buildState({ completedAt: "2026-06-12T00:00:00Z" }))).toBe(
      "/chat/complete",
    );
  });

  it("G1: new → hold/consent, straight on once approved", () => {
    expect(resolveResumePath(buildState({}))).toBe("/chat/hold/consent");
    expect(resolveResumePath(buildState({ approvals: { consent: "2026-06-12" } }))).toBe(
      "/chat/consent",
    );
  });

  it("G2: consent done → hold/demographics, straight on once approved", () => {
    const progress = { consent: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/demographics");
    expect(
      resolveResumePath(buildState({ progress, approvals: { demographics: "2026-06-12" } })),
    ).toBe("/chat/demographics");
  });

  it("G3: demographics done → hold/infoCards, straight on once approved", () => {
    const progress = { consent: true, demographics: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/infoCards");
    expect(
      resolveResumePath(buildState({ progress, approvals: { infoCards: "2026-06-12" } })),
    ).toBe("/chat/info-cards");
  });

  it("infoCards done → /chat/pre-discussion (no gate)", () => {
    expect(
      resolveResumePath(
        buildState({ progress: { consent: true, demographics: true, infoCards: true } }),
      ),
    ).toBe("/chat/pre-discussion");
  });

  it("G4: preDiscussion done → hold/waiting, straight on once approved", () => {
    const progress = { consent: true, demographics: true, infoCards: true, preDiscussion: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/waiting");
    expect(resolveResumePath(buildState({ progress, approvals: { waiting: "2026-06-12" } }))).toBe(
      "/chat/waiting",
    );
  });

  it("G6: completed + postSurvey done → hold/debrief, straight on once approved", () => {
    const progress = { teamDecision: true, postSurvey: true };
    expect(resolveResumePath(buildState({ sessionStatus: "completed", progress }))).toBe(
      "/chat/hold/debrief",
    );
    expect(
      resolveResumePath(
        buildState({ sessionStatus: "completed", progress, approvals: { debrief: "2026-06-12" } }),
      ),
    ).toBe("/chat/debrief");
  });

  it("completed + postSurvey not done → /chat/post-survey (no gate)", () => {
    expect(
      resolveResumePath(
        buildState({ sessionStatus: "completed", progress: { teamDecision: true } }),
      ),
    ).toBe("/chat/post-survey");
    expect(resolveResumePath(buildState({ sessionStatus: "completed", progress: {} }))).toBe(
      "/chat/team-decision",
    );
  });
});
