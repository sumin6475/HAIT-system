import type { ProfileSlot } from "@/lib/api";
import type { Candidate, InfoCard } from "@/types";

// === Shared cards (16, on every participant's card) ===
// Traits that appear on profiles X, Y and Z alike.
export const sharedInfoCards: InfoCard[] = [
  //Candidate A — 4 positive
  {
    id: "A_p_01",
    candidate: "A",
    attribute: "Has a very good sense for recognizing dangerous situations",
    valence: "positive",
  },
  {
    id: "A_p_02",
    candidate: "A",
    attribute: "Has a good overview of complex contexts",
    valence: "positive",
  },
  {
    id: "A_p_03",
    candidate: "A",
    attribute: "Has excellent spatial awareness",
    valence: "positive",
  },
  { id: "A_p_04", candidate: "A", attribute: "Is very well organized", valence: "positive" },

  //Candidate B — 4 positive
  {
    id: "B_p_01",
    candidate: "B",
    attribute: "Keeps a cool head in crisis situations",
    valence: "positive",
  },
  { id: "B_p_02", candidate: "B", attribute: "You can rely on him/her 100%", valence: "positive" },
  {
    id: "B_p_03",
    candidate: "B",
    attribute: "Can assess weather conditions very well",
    valence: "positive",
  },
  { id: "B_p_04", candidate: "B", attribute: "Is good at multitasking", valence: "positive" },

  //Candidate C — 1 positive + 3 negative
  {
    id: "C_p_01",
    candidate: "C",
    attribute: "Can make the right decisions very quickly",
    valence: "positive",
  },
  { id: "C_n_01", candidate: "C", attribute: "Is not verbally skillful", valence: "negative" },
  { id: "C_n_02", candidate: "C", attribute: "Is considered egocentric", valence: "negative" },
  {
    id: "C_n_03",
    candidate: "C",
    attribute: "Is reluctant to take part in training",
    valence: "negative",
  },

  //Candidate D — 4 positive
  {
    id: "D_p_01",
    candidate: "D",
    attribute: "Can react adequately to unforeseen events",
    valence: "positive",
  },
  { id: "D_p_02", candidate: "D", attribute: "Can concentrate very well", valence: "positive" },
  { id: "D_p_03", candidate: "D", attribute: "Is very resilient", valence: "positive" },
  { id: "D_p_04", candidate: "D", attribute: "Is very responsible", valence: "positive" },
];

// === Profile X only (8 cards) ===
// Two misses per candidate, except C, which gets two matches: the key clue of the hidden profile.
export const xExclusiveCards: InfoCard[] = [
  {
    id: "A_n_01",
    candidate: "A",
    attribute: "Sometimes does not tolerate criticism",
    valence: "negative",
  },
  { id: "A_n_02", candidate: "A", attribute: "Is sometimes a bit hectic", valence: "negative" },
  { id: "B_n_01", candidate: "B", attribute: "Is considered to be nagging", valence: "negative" },
  {
    id: "B_n_02",
    candidate: "B",
    attribute: "Is not considered very cooperative",
    valence: "negative",
  },
  { id: "C_p_02", candidate: "C", attribute: "Is stress resistant", valence: "positive" },
  {
    id: "C_p_03",
    candidate: "C",
    attribute: "Promotes a good atmosphere within the crew",
    valence: "positive",
  },
  { id: "D_n_01", candidate: "D", attribute: "Is considered arrogant", valence: "negative" },
  {
    id: "D_n_02",
    candidate: "D",
    attribute: "Is not very well suited for leading a team",
    valence: "negative",
  },
];

// === Profile Y only (8 cards) ===
export const yExclusiveCards: InfoCard[] = [
  { id: "A_n_03", candidate: "A", attribute: "Is considered a show-off", valence: "negative" },
  { id: "A_n_04", candidate: "A", attribute: "Is not open to new ideas", valence: "negative" },
  {
    id: "B_n_03",
    candidate: "B",
    attribute: "Has a below-average memory for numbers",
    valence: "negative",
  },
  {
    id: "B_n_04",
    candidate: "B",
    attribute: "Gossips about his/her coworkers",
    valence: "negative",
  },
  { id: "C_p_04", candidate: "C", attribute: "Is very conscientious", valence: "positive" },
  {
    id: "C_p_05",
    candidate: "C",
    attribute: "Is very skilled in dealing with complicated technology",
    valence: "positive",
  },
  {
    id: "D_n_03",
    candidate: "D",
    attribute: "Is considered to be a know-all",
    valence: "negative",
  },
  { id: "D_n_04", candidate: "D", attribute: "Is quick-tempered", valence: "negative" },
];

// === Profile Z only (8 cards). In CTRL these go to the third human. ===

export const zExclusiveCards: InfoCard[] = [
  { id: "A_n_05", candidate: "A", attribute: "Is unfriendly", valence: "negative" },
  { id: "A_n_06", candidate: "A", attribute: "Transmits restlessness", valence: "negative" },
  { id: "B_n_05", candidate: "B", attribute: "Is considered arrogant", valence: "negative" },
  { id: "B_n_06", candidate: "B", attribute: "Is sometimes abusive in tone", valence: "negative" },
  {
    id: "C_p_06",
    candidate: "C",
    attribute: "Puts the safety of people in his/her care above everything else",
    valence: "positive",
  },
  {
    id: "C_p_07",
    candidate: "C",
    attribute: "Performs very well in terms of sustained attention",
    valence: "positive",
  },
  { id: "D_n_05", candidate: "D", attribute: "Is considered moody", valence: "negative" },
  { id: "D_n_06", candidate: "D", attribute: "Has strong prejudices", valence: "negative" },
];

export const CANDIDATES: Candidate[] = ["A", "B", "C", "D"];

export const candidateColors: Record<Candidate, string> = {
  A: "bg-chart-1/15 text-chart-1",
  B: "bg-chart-2/15 text-chart-2",
  C: "bg-chart-3/15 text-chart-3",
  D: "bg-chart-4/15 text-chart-4",
};

export function getExclusiveCardsForProfile(profile: ProfileSlot): InfoCard[] {
  switch (profile) {
    case "X":
      return xExclusiveCards;
    case "Y":
      return yExclusiveCards;
    case "Z":
      return zExclusiveCards;
    default:
      return [];
  }
}

export function getInfoCardsForProfile(profile: ProfileSlot): InfoCard[] {
  const exclusiveCards = getExclusiveCardsForProfile(profile);
  if (exclusiveCards.length === 0) {
    console.warn(`[infoCards] unknown profile "${profile}", showing shared cards only`);
  }
  return [...sharedInfoCards, ...exclusiveCards];
}

export function groupInfoCardsByCandidate(cards: InfoCard[]): Record<Candidate, InfoCard[]> {
  return CANDIDATES.reduce(
    (acc, candidate) => {
      acc[candidate] = cards.filter((card) => card.candidate === candidate);
      return acc;
    },
    {} as Record<Candidate, InfoCard[]>,
  );
}

export function sortCardsByValence(cards: InfoCard[]): InfoCard[] {
  return [
    ...cards.filter((card) => card.valence === "positive"),
    ...cards.filter((card) => card.valence === "negative"),
  ];
}
