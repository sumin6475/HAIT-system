// candidateList: which candidates still need the group's attention, worked out
// from the board once per turn.
//
// Routing, pacing, and message writing do not read it. Its one reader is the
// Chair's coverage sentence (`leaderCoverageNote`), which turns the list into a
// line in the Judge's facts for the turn; a Member gets nothing.
//
// The list measures attention, not merit. It does not read `score`, which is
// worked out here only for the one move that needs it.

import { CANDIDATES, allSurfacedIds, humanPooledIds } from "./informationPools.js";
import { TRAIT_BY_ID, TRAIT_DB, type Cand } from "./traitData.js";

/**
 * The most traits for any one candidate that every profile can see.
 *
 * Derived rather than written down, so it stays true to the dataset. It is 4:
 * each candidate has exactly four traits carried by all three profiles.
 */
const SHARED_PER_CANDIDATE = Math.max(
  ...CANDIDATES.map(
    (candidate) =>
      TRAIT_DB.filter((trait) => trait.candidate === candidate && trait.profiles.length === 3)
        .length,
  ),
);

/**
 * The fewest traits any one candidate has that Alex does not hold.
 *
 * Derived, like the number above, and it is 4: each candidate carries ten
 * traits, Alex's profile holds six of them — the four every card shows plus two
 * of its own — and the remaining four sit on exactly one human's card. The same
 * four for every candidate, so the bar below falls identically on all of them
 * and no candidate is easier or harder to retire than another.
 */
const HUMAN_ONLY_PER_CANDIDATE = Math.min(
  ...CANDIDATES.map(
    (candidate) =>
      TRAIT_DB.filter((trait) => trait.candidate === candidate && !trait.profiles.includes("Z"))
        .length,
  ),
);

/**
 * How much a human has to have pooled before a candidate leaves the list.
 *
 * One. Below it, nothing a participant holds privately about that candidate has
 * reached the group; at or above it, something has.
 *
 * The count is over human contributions only. Alex holds six traits per
 * candidate, so a bar counted over the whole board could be passed by Alex alone,
 * and the Chair would be told the group had covered a candidate when no human had
 * brought anything to it.
 *
 * A higher bar is not possible. Participants are never told how many traits a
 * candidate has, and a bar that reasoned about what is still missing would give
 * Alex knowledge the design does not allow. One is the largest claim the board
 * can support.
 */
export const POOLED_ENOUGH = 1;

export interface CandidateListState {
  /** Distinct traits on the board for each candidate, matches and misses together. */
  coverage: Record<Cand, number>;
  /**
   * Matches minus misses on the board. Worked out, but not used to build the list.
   *
   * While the board holds mostly shared traits this ranks the candidates
   * backwards, so it must never decide what the group works on next.
   */
  score: Record<Cand, number>;
  /**
   * Traits on the board for each candidate that a human put there and Alex does
   * not hold. This is the quantity the list is built on.
   */
  pooled: Record<Cand, number>;
  /** Candidates no human has yet brought anything of their own about, in candidate order. */
  live: Cand[];
  /** Candidates a human has pooled something about, in candidate order. */
  covered: Cand[];
}

/**
 * The list for one turn, worked out from the board and nothing else.
 *
 * "The board" is what has actually been put in view: traits a human surfaced,
 * plus traits Alex has said. Alex's unspoken notes are in neither set.
 *
 * A candidate leaves the list when a human has put something about it on the
 * board that Alex does not hold, and for no other reason. Coverage and score are
 * worked out beside it and decide nothing. There is no ranking and nothing is
 * carried between turns; the pooled count never falls, so the list only shrinks.
 * An empty list means every candidate has had something brought to it from
 * somebody's own notes, which is what a Chair can act on.
 */
export function computeCandidateList(revealStats: unknown): CandidateListState {
  const coverage = {} as Record<Cand, number>;
  const score = {} as Record<Cand, number>;
  const pooled = {} as Record<Cand, number>;
  for (const candidate of CANDIDATES) {
    coverage[candidate] = 0;
    score[candidate] = 0;
    pooled[candidate] = 0;
  }
  for (const id of allSurfacedIds(revealStats)) {
    const trait = TRAIT_BY_ID.get(id)!;
    coverage[trait.candidate] += 1;
    score[trait.candidate] += trait.valence === "pos" ? 1 : -1;
  }
  for (const id of humanPooledIds(revealStats)) {
    pooled[TRAIT_BY_ID.get(id)!.candidate] += 1;
  }

  const live: Cand[] = [];
  const covered: Cand[] = [];
  for (const candidate of CANDIDATES) {
    (pooled[candidate]! >= POOLED_ENOUGH ? covered : live).push(candidate);
  }
  return { coverage, score, pooled, live, covered };
}

/**
 * Kept so the two derivations stay visible next to each other and a test can pin
 * them. Neither decides the list any more; `POOLED_ENOUGH` does.
 */
export const DERIVED_COUNTS = {
  sharedPerCandidate: SHARED_PER_CANDIDATE,
  humanOnlyPerCandidate: HUMAN_ONLY_PER_CANDIDATE,
} as const;

/**
 * Which candidates nobody has brought their own notes on, as one sentence.
 *
 * It lives here, beside the list it reads, because two parts of the turn need the
 * same words: the Judge and the writer of a mediation turn. Without it the writer
 * sees only the visible board and can ask for notes on a candidate the humans
 * have already covered.
 *
 * No numbers appear, for the reason `leaderCoverageNote` gives: a writer given
 * coverage numbers can leak one.
 */
export function coverageGapNote(revealStats: unknown): string {
  const { live, covered } = computeCandidateList(revealStats);
  if (!live.length) {
    return "Every candidate now has something on the table that a participant brought from their own notes. There is no coverage gap to name.";
  }
  if (!covered.length) {
    return `Nobody has brought anything from their own notes about any candidate so far: ${live.join(", ")}.`;
  }
  return `Nobody has brought anything from their own notes about ${live.join(" and ")} so far, next to ${covered.join(", ")}.`;
}
