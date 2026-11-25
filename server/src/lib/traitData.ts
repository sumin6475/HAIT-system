// traitData: the forty traits, the one source of truth for trait text, owner
// candidate, and which profiles hold each trait. Used by the trait matcher
// (poolingExtractor), the board writer (poolingTally) and the measures (poolingDV).
//
// Checks that hold for this data set (a failure means a typo):
//   All forty traits:  A, B and D have 4 matches / 6 misses; C has 7 / 3 (C is the pooled answer).
//   Alex's card (Z):   A, B and D have 4 / 2; C has 3 / 3.

export type Cand = "A" | "B" | "C" | "D";
export type Valence = "pos" | "neg";
export interface Trait {
  id: string;
  candidate: Cand;
  valence: Valence;
  text: string;
  profiles: ("X" | "Y" | "Z")[];
}

// A trait's `text` must match, letter for letter, the sentence participants
// read on their cards and the sentence on Alex's card in the prompt. If the
// three copies differ, the matcher looks for a sentence nobody says. Phrases
// used for matching live separately in traitKeywordRegistry; `text` is for display.
export const TRAIT_DB: Trait[] = [
  // A: 4 matches (shared) / 6 misses (split across cards)
  {
    id: "A_p1",
    candidate: "A",
    valence: "pos",
    text: "Has a very good sense for recognizing dangerous situations",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "A_p2",
    candidate: "A",
    valence: "pos",
    text: "Has a good overview of complex contexts",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "A_p3",
    candidate: "A",
    valence: "pos",
    text: "Has excellent spatial awareness",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "A_p4",
    candidate: "A",
    valence: "pos",
    text: "Is very well organized",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "A_n1",
    candidate: "A",
    valence: "neg",
    text: "Sometimes does not tolerate criticism",
    profiles: ["X"],
  },
  {
    id: "A_n2",
    candidate: "A",
    valence: "neg",
    text: "Is sometimes a bit hectic",
    profiles: ["X"],
  },
  { id: "A_n3", candidate: "A", valence: "neg", text: "Is considered a show-off", profiles: ["Y"] },
  { id: "A_n4", candidate: "A", valence: "neg", text: "Is not open to new ideas", profiles: ["Y"] },
  { id: "A_n5", candidate: "A", valence: "neg", text: "Is unfriendly", profiles: ["Z"] },
  { id: "A_n6", candidate: "A", valence: "neg", text: "Transmits restlessness", profiles: ["Z"] },
  // B: 4 matches (shared) / 6 misses (split across cards)
  {
    id: "B_p1",
    candidate: "B",
    valence: "pos",
    text: "Keeps a cool head in crisis situations",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "B_p2",
    candidate: "B",
    valence: "pos",
    text: "You can rely on him/her 100%",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "B_p3",
    candidate: "B",
    valence: "pos",
    text: "Can assess weather conditions very well",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "B_p4",
    candidate: "B",
    valence: "pos",
    text: "Is good at multitasking",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "B_n1",
    candidate: "B",
    valence: "neg",
    text: "Is considered to be nagging",
    profiles: ["X"],
  },
  {
    id: "B_n2",
    candidate: "B",
    valence: "neg",
    text: "Is not considered very cooperative",
    profiles: ["X"],
  },
  {
    id: "B_n3",
    candidate: "B",
    valence: "neg",
    text: "Has a below-average memory for numbers",
    profiles: ["Y"],
  },
  {
    id: "B_n4",
    candidate: "B",
    valence: "neg",
    text: "Gossips about his/her coworkers",
    profiles: ["Y"],
  },
  { id: "B_n5", candidate: "B", valence: "neg", text: "Is considered arrogant", profiles: ["Z"] },
  {
    id: "B_n6",
    candidate: "B",
    valence: "neg",
    text: "Is sometimes abusive in tone",
    profiles: ["Z"],
  },
  // C: 7 matches (split across cards) / 3 misses (shared). The pooled answer.
  {
    id: "C_p1",
    candidate: "C",
    valence: "pos",
    text: "Can make the right decisions very quickly",
    profiles: ["X", "Y", "Z"],
  },
  { id: "C_p2", candidate: "C", valence: "pos", text: "Is stress resistant", profiles: ["X"] },
  {
    id: "C_p3",
    candidate: "C",
    valence: "pos",
    text: "Promotes a good atmosphere within the crew",
    profiles: ["X"],
  },
  { id: "C_p4", candidate: "C", valence: "pos", text: "Is very conscientious", profiles: ["Y"] },
  {
    id: "C_p5",
    candidate: "C",
    valence: "pos",
    text: "Is very skilled in dealing with complicated technology",
    profiles: ["Y"],
  },
  {
    id: "C_p6",
    candidate: "C",
    valence: "pos",
    text: "Puts the safety of people in his/her care above everything else",
    profiles: ["Z"],
  },
  {
    id: "C_p7",
    candidate: "C",
    valence: "pos",
    text: "Performs very well in terms of sustained attention",
    profiles: ["Z"],
  },
  {
    id: "C_n1",
    candidate: "C",
    valence: "neg",
    text: "Is not verbally skillful",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "C_n2",
    candidate: "C",
    valence: "neg",
    text: "Is considered egocentric",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "C_n3",
    candidate: "C",
    valence: "neg",
    text: "Is reluctant to take part in training",
    profiles: ["X", "Y", "Z"],
  },
  // D: 4 matches (shared) / 6 misses (split across cards)
  {
    id: "D_p1",
    candidate: "D",
    valence: "pos",
    text: "Can react adequately to unforeseen events",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "D_p2",
    candidate: "D",
    valence: "pos",
    text: "Can concentrate very well",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "D_p3",
    candidate: "D",
    valence: "pos",
    text: "Is very resilient",
    profiles: ["X", "Y", "Z"],
  },
  {
    id: "D_p4",
    candidate: "D",
    valence: "pos",
    text: "Is very responsible",
    profiles: ["X", "Y", "Z"],
  },
  { id: "D_n1", candidate: "D", valence: "neg", text: "Is considered arrogant", profiles: ["X"] },
  {
    id: "D_n2",
    candidate: "D",
    valence: "neg",
    text: "Is not very well suited for leading a team",
    profiles: ["X"],
  },
  {
    id: "D_n3",
    candidate: "D",
    valence: "neg",
    text: "Is considered to be a know-all",
    profiles: ["Y"],
  },
  { id: "D_n4", candidate: "D", valence: "neg", text: "Is quick-tempered", profiles: ["Y"] },
  { id: "D_n5", candidate: "D", valence: "neg", text: "Is considered moody", profiles: ["Z"] },
  { id: "D_n6", candidate: "D", valence: "neg", text: "Has strong prejudices", profiles: ["Z"] },
];

export const ALEX_Z_IDS = TRAIT_DB.filter((t) => t.profiles.includes("Z")).map((t) => t.id);
export const TRAIT_BY_ID = new Map(TRAIT_DB.map((t) => [t.id, t]));
export const OPTIMAL_CANDIDATE: Cand = "C"; // the pooled answer: 7 matches, 3 misses
