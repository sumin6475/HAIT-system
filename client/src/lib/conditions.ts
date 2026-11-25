import type { ConditionCode } from "./api";

// The five condition codes, in display order.
export const CONDITION_CODES: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

// Readable label for each condition.
// A 2 x 2 design: AI status x communication strategy.
export const conditionLabel: Record<ConditionCode, string> = {
  C1: "Peer × XAI",
  C2: "Leader × XAI",
  C3: "Peer × ACI",
  C4: "Leader × ACI",
  CTRL: "Control",
};

// What each condition means in the 2 x 2 design.
// status: whether Alex is the Chair (leader) or a Member (peer); null in CTRL (no AI).
// strategy: XAI (explanatory) or ACI (asks questions); null in CTRL.
export const conditionMeta: Record<
  ConditionCode,
  { status: "leader" | "peer" | null; strategy: "xai" | "aci" | null }
> = {
  C1: { status: "peer", strategy: "xai" },
  C2: { status: "leader", strategy: "xai" },
  C3: { status: "peer", strategy: "aci" },
  C4: { status: "leader", strategy: "aci" },
  CTRL: { status: null, strategy: null },
};
