// The system prompts Alex is given, one per condition and turn kind.
//
// The prompts are built ahead of time by `npm run prompts:compile` and read
// from a file, so a running server never changes them.

import { createHash } from "node:crypto";
import compiled from "../prompts/route-prompts.json" with { type: "json" };
import type { ConditionCode, RouteKind } from "../types.js";

interface PromptEntry {
  condition: string;
  routeKind: string;
  hash: string;
  prompt: string;
}

const entries = compiled.prompts as Record<string, PromptEntry>;

// Refuse to start if a prompt was edited by hand without being recompiled.
for (const [key, entry] of Object.entries(entries)) {
  const actual = createHash("sha256").update(entry.prompt).digest("hex");
  if (entry.hash !== actual) throw new Error(`Prompt hash mismatch for ${key}`);
}
if (Object.keys(entries).length !== 30) {
  throw new Error(`Expected 30 route prompts, received ${Object.keys(entries).length}`);
}

export interface ResolvedPrompt {
  promptKey: string;
  systemPrompt: string;
}

export function getRoutePrompt(conditionCode: ConditionCode, routeKind: RouteKind): ResolvedPrompt {
  if (conditionCode === "CTRL") throw new Error("CTRL must never resolve an AI prompt");
  const promptKey = `${conditionCode}.${routeKind}`;
  const entry = entries[promptKey];
  if (!entry) throw new Error(`Missing route prompt: ${promptKey}`);
  return { promptKey, systemPrompt: entry.prompt };
}

export function listRoutePromptKeys(): string[] {
  return Object.keys(entries).sort();
}

// Every prompt, grouped by condition, for the researcher dashboard.
export function getRoutePromptRegistryView() {
  const conditionNames: Record<string, string> = {
    C1: "peer_xai",
    C2: "leader_xai",
    C3: "peer_aci",
    C4: "leader_aci",
  };
  const conditions: Record<string, any> = {};
  for (const [key, entry] of Object.entries(entries)) {
    const condition = entry.condition;
    conditions[condition] ??= {
      sourceCondition: conditionNames[condition],
      routes: {},
    };
    conditions[condition].routes[entry.routeKind] = {
      promptKey: key,
      hash: entry.hash,
      prompt: entry.prompt,
    };
  }
  return { conditions };
}
