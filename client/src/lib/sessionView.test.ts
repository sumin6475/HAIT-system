// Tests for the session list tabs. Main holds only study sessions
// (S-<condition>-<seq>), and every session is in exactly one of Main and Test.

import { describe, expect, it } from "vitest";
import { isMainSession, parseSessionView, sessionsInView } from "./sessionView";

const session = (sessionCode: string, isTest: boolean) => ({ sessionCode, isTest });
const codes = (list: { sessionCode: string }[]) => list.map((item) => item.sessionCode);

const list = [
  session("T-C3-012", true),
  session("S-C2-001", false),
  session("S-Test-1726000000000", false),
  session("T-C2-053", true),
  session("S-CTRL-002", false),
];

describe("sessionsInView", () => {
  it("All keeps every session in the order the server sent", () => {
    expect(codes(sessionsInView(list, "all"))).toEqual(codes(list));
  });

  it("Main keeps only experiment sessions", () => {
    expect(codes(sessionsInView(list, "main"))).toEqual(["S-C2-001", "S-CTRL-002"]);
  });

  it("Test keeps T- sessions and the harness sessions", () => {
    expect(codes(sessionsInView(list, "test"))).toEqual([
      "T-C3-012",
      "S-Test-1726000000000",
      "T-C2-053",
    ]);
  });

  it("puts every session in exactly one of Main and Test", () => {
    for (const item of list) {
      const inMain = sessionsInView([item], "main").length;
      const inTest = sessionsInView([item], "test").length;
      expect(inMain + inTest).toBe(1);
    }
  });
});

describe("isMainSession", () => {
  it("never calls a session flagged as test a main session", () => {
    expect(isMainSession(session("S-C1-003", true))).toBe(false);
  });
});

describe("parseSessionView", () => {
  it("reads main and test, and falls back to all", () => {
    expect(parseSessionView("main")).toBe("main");
    expect(parseSessionView("test")).toBe("test");
    expect(parseSessionView(null)).toBe("all");
    expect(parseSessionView("MAIN")).toBe("all");
  });
});
