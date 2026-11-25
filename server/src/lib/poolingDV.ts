// poolingDV: the information pooling measures.
// byProfile.X / Y: how much of their own card (unshared traits) each human put in
//   view. The main measure, read from byCandidate.revealedIds.
// byProfile.Z: how much of its own card Alex put in view. A separate measure,
//   read from aiSurfacedIds.
// Counts are not stored; they are worked out from the sets of trait ids, so two
// writes at the same moment cannot spoil them. The two sources stay separate, and
// a combined "said by anyone" set can always be rebuilt from them.
import { Session } from "../models/Session.js";
import { TRAIT_DB, TRAIT_BY_ID, OPTIMAL_CANDIDATE, type Cand } from "./traitData.js";
import { aiSurfacedIds, humanSurfacedIds } from "./informationPools.js";

// Records who first put each trait in view. For each trait id the smaller message
// number wins, not whoever was written first: Alex's traits are extracted in the
// background, so the record for message 7 can arrive before the record for
// message 6. Comparing message numbers in the update makes arrival order irrelevant.
export async function recordFirstSurfacer(
  sessionId: string,
  ids: string[],
  by: "human" | "ai",
  seq: number,
): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  let recorded = 0;
  for (const id of valid) {
    const path = `revealStats.firstBy.${id}`;
    const res = await Session.updateOne(
      {
        _id: sessionId,
        $or: [{ [path]: { $exists: false } }, { [`${path}.seq`]: { $gt: seq } }],
      },
      { $set: { [path]: { by, seq } } },
    );
    if (res.modifiedCount) recorded++;
  }
  return recorded; // how many traits were put in view for the first time on this turn
}

// Adds to the set of traits Alex has put in view. Atomic $addToSet, safe when several extractions finish at once.
export async function updateAiSurfaced(
  sessionId: string,
  ids: string[],
  seq: number,
): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return 0;
  await Session.updateOne(
    { _id: sessionId },
    { $addToSet: { "revealStats.aiSurfacedIds": { $each: valid } } },
  );
  return recordFirstSurfacer(sessionId, valid, "ai", seq); // returns how many traits were new on this turn
}

// Which traits are unique to each card and which are shared (worked out once, at load).
type Prof = "X" | "Y" | "Z";
const UNIQUE: Record<Prof, Set<string>> = { X: new Set(), Y: new Set(), Z: new Set() };
const SHARED: Set<string> = new Set();
for (const t of TRAIT_DB) {
  if (t.profiles.length === 1) UNIQUE[t.profiles[0] as Prof].add(t.id);
  else SHARED.add(t.id); // in this data set a shared trait is on all three cards; no trait is on exactly two
}

export interface ProfileDV {
  totalUnique: number;
  uniqueRevealed: number;
  totalShared: number;
  sharedRevealed: number;
}
export interface PoolingDV {
  X: ProfileDV;
  Y: ProfileDV;
  Z: ProfileDV;
}

function dvFor(p: Prof, surfaced: Set<string>): ProfileDV {
  const uniq = UNIQUE[p];
  let uniqueRevealed = 0;
  for (const id of uniq) if (surfaced.has(id)) uniqueRevealed++;
  let sharedRevealed = 0;
  for (const id of SHARED) if (surfaced.has(id)) sharedRevealed++;
  return { totalUnique: uniq.size, uniqueRevealed, totalShared: SHARED.size, sharedRevealed };
}

// Decision accuracy: did the group choose C, the pooled answer? Worked out once,
// when the session completes. teamChoice is the most common choice (null on a
// tie); unanimous means everyone chose the same.
export interface DecisionAccuracy {
  optimal: Cand;
  teamChoice: string | null;
  correct: boolean;
  unanimous: boolean;
}

export function computeDecisionAccuracy(choices: string[]): DecisionAccuracy {
  const counts = choices.reduce<Record<string, number>>(
    (m, c) => ((m[c] = (m[c] ?? 0) + 1), m),
    {},
  );
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const tie = top.length > 1 && top[0]![1] === top[1]![1];
  const teamChoice = tie ? null : (top[0]?.[0] ?? null);
  const unanimous = choices.length > 0 && new Set(choices).size === 1;
  return {
    optimal: OPTIMAL_CANDIDATE,
    teamChoice,
    correct: teamChoice === OPTIMAL_CANDIDATE,
    unanimous,
  };
}

// X and Y are what the humans put in view; Z is what Alex put in view. They are
// kept apart on purpose: Alex's contribution is a measure of its own and must not
// mix with the humans'. Each set is defined in informationPools.
export function computePoolingDV(revealStats: any): PoolingDV {
  return {
    X: dvFor("X", humanSurfacedIds(revealStats)),
    Y: dvFor("Y", humanSurfacedIds(revealStats)),
    Z: dvFor("Z", aiSurfacedIds(revealStats)),
  };
}
