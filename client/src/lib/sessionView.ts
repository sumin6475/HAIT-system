// Session list tabs (All / Main / Test).
// - Main: study sessions only. Their code has the server's form S-<condition>-<seq>
//   (server/src/lib/codeGen.ts) and isTest is false.
// - Test: every other session, including T- sessions and the harness sessions
//   (S-Test-<timestamp>, server/src/routes/test.ts). The list API's isTest only
//   checks for a "T-" prefix, so it is not enough on its own.

import type { SessionSummary } from "./api";

export type SessionView = "all" | "main" | "test";

export const SESSION_VIEWS: { value: SessionView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "main", label: "Main" },
  { value: "test", label: "Test" },
];

const MAIN_SESSION_CODE = /^S-[A-Z0-9]+-\d{3}$/;

type Classifiable = Pick<SessionSummary, "sessionCode" | "isTest">;

export function isMainSession(session: Classifiable): boolean {
  return !session.isTest && MAIN_SESSION_CODE.test(session.sessionCode);
}

export function sessionsInView<T extends Classifiable>(
  sessions: readonly T[],
  view: SessionView,
): T[] {
  if (view === "all") return [...sessions];
  return sessions.filter((session) => isMainSession(session) === (view === "main"));
}

// The ?view= value in the address -> tab. Unknown values mean All.
export function parseSessionView(value: string | null): SessionView {
  return value === "main" || value === "test" ? value : "all";
}
