// poolingTally: writes what a human message adds to the board ($addToSet).
// What the board means when read is defined in informationPools.
import { Session } from "../models/Session.js";
import { TRAIT_BY_ID, type Cand } from "./traitData.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { recordFirstSurfacer } from "./poolingDV.js";
import { humanSurfacedIds } from "./informationPools.js";

// Adds trait ids with an atomic $addToSet: safe when several extractions run at
// once, and duplicates are dropped. Counts are not stored; they are read from
// revealedIds, which avoids a read-then-write race. Returns how many distinct ids
// were new. Two extractions finishing together may both count the same id as
// new; that only ever overcounts.
export async function updateRevealStats(
  sessionId: string,
  ids: string[],
  seq: number,
): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return 0;
  const sess = await Session.findById(sessionId).select("revealStats").lean();
  const rs = (sess as any)?.revealStats;
  const already = humanSurfacedIds(rs);
  const newIds = new Set(valid.filter((id) => !already.has(id)));
  const add: Record<string, { $each: string[] }> = {};
  for (const id of valid) {
    const c = TRAIT_BY_ID.get(id)!.candidate;
    const path = `revealStats.byCandidate.${c}.revealedIds`;
    (add[path] ??= { $each: [] }).$each.push(id);
  }
  // Keep the human-confirmed set in step with the traits humans put in view.
  add["revealStats.humanConfirmedIds"] = { $each: [...new Set([...already, ...valid])] };
  await Session.updateOne({ _id: sessionId }, { $addToSet: add });
  const candidates = new Set(valid.map((id) => TRAIT_BY_ID.get(id)!.candidate));
  if (candidates.size === 1) {
    await Session.updateOne(
      {
        _id: sessionId,
        $or: [
          { "revealStats.lastHumanDiscussion.seq": { $exists: false } },
          { "revealStats.lastHumanDiscussion.seq": { $lt: seq } },
        ],
      },
      {
        $set: {
          "revealStats.lastHumanDiscussion": { candidate: [...candidates][0], seq },
        },
      },
    );
  }
  await recordFirstSurfacer(sessionId, valid, "human", seq);
  return newIds.size;
}

// Finds the one candidate the humans are talking about right now, from their
// recent messages (pattern-based, no side effects). It looks back from the newest
// human message, up to the lookback limit; the first message that names any
// candidate decides: one candidate returns it, two or more (a comparison) returns
// null, none moves further back. Returns null if nothing names a candidate. A
// sentence starting with the article "A" can be misread as candidate A; this is
// accepted, since the task names candidates by letter.
const CAND_EXPLICIT = /\bCandidate\s+([ABCD])\b/gi; // "Candidate A", any letter case
const CAND_TOKEN = /\b([ABCD])(?:'s)?\b/g; // a capital letter on its own, with an optional possessive ("A", "C's"); the lower-case article "a" is excluded
export function currentTopicCandidate(
  msgs: { sender: string; content: string }[],
  aiLabel = "Alex",
  lookback = TRIGGER_CONFIG.DEPTH_LOOKBACK_MSGS,
): Cand | null {
  const recent = msgs
    .filter((m) => m.sender !== aiLabel)
    .slice(-lookback)
    .reverse(); // humans only, newest first
  for (const m of recent) {
    const found = new Set<Cand>();
    let mm: RegExpExecArray | null;
    CAND_EXPLICIT.lastIndex = 0;
    while ((mm = CAND_EXPLICIT.exec(m.content))) found.add(mm[1]!.toUpperCase() as Cand);
    CAND_TOKEN.lastIndex = 0;
    while ((mm = CAND_TOKEN.exec(m.content))) found.add(mm[1]! as Cand);
    if (found.size === 0) continue; // no candidate named, look further back
    return found.size === 1 ? [...found][0]! : null; // one candidate returns it; two or more is a comparison, so null
  }
  return null;
}
