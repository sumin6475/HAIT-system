import assert from "node:assert/strict";
import { forceGuardsOnForTest } from "../lib/guardFlags.js";
// Tests for the rule-based trait matcher (poolingExtractor) and the trait
// keyword registry. No network and no database.
//
// A comparison run may switch checks off in `server/.env`, which this suite
// loads. Force them on first, so the suite always tests the normal behaviour.
forceGuardsOnForTest();
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { load } from "js-yaml";
import { Responses } from "openai/resources/responses/responses";
import {
  extractHumanTraitsFast,
  validateExtractedTraitMentions,
  verifyHumanTraitCandidates,
} from "../lib/poolingExtractor.js";
import { TRAIT_KEYWORD_REGISTRY } from "../lib/traitKeywordRegistry.js";
import { TRAIT_BY_ID } from "../lib/traitData.js";

const ids = (messageText: string, assignedProfile?: "X" | "Y" | "Z") =>
  extractHumanTraitsFast({ messageText, assignedProfile }).acceptedIds;

assert.deepEqual(ids("Candidate B keeps a cool head in crisis situations.", "X"), ["B_p1"]);
assert.deepEqual(ids("Candidate A is well organised.", "Y"), ["A_p4"]);
assert.deepEqual(ids("Candidate C is stress resistant.", "Y"), []);
assert.deepEqual(ids("I think Candidate B has a cool head?", "X"), []);
assert.deepEqual(ids("If Candidate B had a cool head, that would help.", "X"), []);
assert.deepEqual(ids('They said Candidate B is "considered arrogant".', "Z"), []);
assert.deepEqual(ids("Candidate D is very responsible for passengers.", "X"), []);
assert.deepEqual(ids("Being responsible is important for this job.", "X"), []);
assert.deepEqual(ids("Candidate A and Candidate D are considered arrogant.", "Z"), []);
assert.deepEqual(ids("Candidate B has a below-average memory for numbers.", "Y"), ["B_n3"]);
assert.deepEqual(ids("The pilot is a very conscientious person.", "Y"), ["C_p4"]);
assert.deepEqual(ids("A very conscientious person would be useful.", "Y"), []);
assert.deepEqual(ids("We need a well organized person for this job.", "Y"), []);
assert.deepEqual(ids("The crew was very well organized during the drill.", "Y"), []);
assert.deepEqual(ids("Candidate A does not tolerate criticism.", "X"), ["A_n1"]);
assert.deepEqual(ids("Candidate B is not very cooperative.", "X"), ["B_n2"]);
assert.deepEqual(ids("Candidate A is very  well organized.", "Y"), ["A_p4"]);
assert.deepEqual(ids("Candidate C isn't verbally skillful.", "Y"), ["C_n1"]);
assert.deepEqual(ids("Candidate C is verbally skillfull.", "Y"), []);
assert.deepEqual(
  ids("For this role we need teamwork, but Candidate A is very well organized.", "Y"),
  ["A_p4"],
);
assert.deepEqual(ids("I prefer B. The same point is 'considered arrogant'.", "X"), []);
assert.deepEqual(
  ids(
    "Candidate A cannot assess weather conditions, but Candidate B can assess weather conditions very well.",
    "X",
  ),
  ["B_p3"],
);
assert.deepEqual(ids("Candidate B cannot assess weather conditions very well.", "X"), []);
assert.deepEqual(ids("Candidate D is not arrogant.", "X"), []);
const quotedNote = extractHumanTraitsFast({
  messageText: 'My note says: "Candidate A is very well organized."',
  assignedProfile: "Y",
});
assert.deepEqual(quotedNote.acceptedIds, []);
assert.deepEqual(
  quotedNote.verificationCandidates.map((candidate) => candidate.traitId),
  ["A_p4"],
);
assert.deepEqual(ids('"Candidate A is very well organized."', "Y"), ["A_p4"]);
assert.deepEqual(ids("I heard Candidate B is good at multitasking.", "X"), []);

// --- A quotation is not automatically reported speech -----------------------
//
// A participant may quote a phrase off their own card with no attribution.
// That is a disclosure: only an attribution makes a quote reported speech.
assert.deepEqual(
  ids(
    'My pick is still Candidate B. The one minus I hold is that B "has a below-average memory for numbers".',
    "Y",
  ),
  ["B_n3"],
  "a participant quoting their own card is disclosing it",
);
// Attribution is what makes a quote reported speech, and it still suppresses.
assert.deepEqual(ids('They said Candidate B is "considered arrogant".', "Z"), []);
assert.deepEqual(
  ids('Candidate B, according to my notes, "gossips about coworkers".', "X"),
  [],
  "an explicit attribution still defers",
);
const quotedWithVerb = extractHumanTraitsFast({
  messageText: 'My note says: "Candidate A is very well organized."',
  assignedProfile: "Y",
});
assert.deepEqual(quotedWithVerb.acceptedIds, [], "a reporting verb still defers, quote or not");

// --- An ordinary inflection is the same trait --------------------------------
//
// "not tolerating criticism" must match the registered "not tolerate criticism".
assert.deepEqual(ids("Candidate A not tolerating criticism is the real risk here.", "X"), ["A_n1"]);
assert.deepEqual(
  ids("Candidate A does not tolerate criticism.", "X"),
  ["A_n1"],
  "the form that already worked still works",
);
// A hypothetical question is still not a disclosure.
assert.deepEqual(
  ids("And what if A makes a mistake and he does not tolerate criticism?! then what?", "X"),
  [],
  "a hypothetical question surfaces nothing, quote rule or no quote rule",
);
const typoCandidate = extractHumanTraitsFast({
  messageText: "Candidate D is arogant.",
  assignedProfile: "X",
});
assert.deepEqual(typoCandidate.acceptedIds, []);
assert.deepEqual(typoCandidate.verificationCandidates, [
  { traitId: "D_n1", evidenceQuote: "is arogant", reason: "lexical_near_match" },
]);
assert.deepEqual(
  extractHumanTraitsFast({
    messageText: "Candidate D can react adequately to unforseen events.",
    assignedProfile: "Y",
  }).verificationCandidates,
  // The quote spans the trait's own wording: a trait's card text is always in
  // its phrase list, so the longest matching phrase is normally the sentence
  // the participant read off the card.
  [
    {
      traitId: "D_p1",
      evidenceQuote: "can react adequately to unforseen events",
      reason: "lexical_near_match",
    },
  ],
);
assert.deepEqual(
  extractHumanTraitsFast({ messageText: "Candidate B is arogant.", assignedProfile: "X" }),
  { acceptedIds: [], verificationCandidates: [] },
);
assert.deepEqual(
  ids("If we're doing completeness — I've got this: Candidate C is stress-resistant.", "X"),
  ["C_p2"],
);
assert.deepEqual(
  ids(
    "If Candidate B had a cool head, that would help. Candidate B keeps a cool head in crisis situations.",
    "X",
  ),
  ["B_p1"],
);
assert.deepEqual(
  ids("Candidate D is responsible for passengers. Candidate D is very responsible.", "X"),
  ["D_p4"],
);
assert.deepEqual(ids("I have A, which has a good overview of complex context.", "Y"), ["A_p2"]);
assert.deepEqual(ids("I have B. You can rely on him 100%.", "Y"), ["B_p2"]);
assert.deepEqual(ids("I have B, which is considered to be nagging.", "X"), ["B_n1"]);
assert.deepEqual(ids("Candidate B gossips about his co-workers.", "Y"), ["B_n4"]);
assert.deepEqual(ids("I have C, can make the right decision very quickly.", "X"), ["C_p1"]);
assert.deepEqual(ids("Candidate D is not very well suited for leading a team.", "X"), ["D_n2"]);
assert.deepEqual(ids("Candidate C only has two misses on my card.", "X"), []);
assert.deepEqual(
  ids("I would go with Candidate A since those strengths feel more important.", "X"),
  [],
);
assert.deepEqual(
  ids("The cockpit should be very organized and tidy, so Candidate A can get distracted.", "X"),
  [],
);
assert.deepEqual(ids("No, Candidate D is not moody according to me.", "Z"), []);
assert.deepEqual(ids("Gossiping doesn't mean Candidate B will not cooperate.", "X"), []);
assert.deepEqual(ids("Candidate B is both nagging and not cooperative.", "X"), ["B_n1", "B_n2"]);
assert.deepEqual(ids("Candidate B is cooperative.", "X"), []);
assert.deepEqual(ids("Candidate A is open to new ideas.", "Y"), []);
assert.deepEqual(ids("Candidate D is suited to lead a team.", "X"), []);
const positiveMemory = extractHumanTraitsFast({
  messageText: "Candidate B has a good memory for numbers.",
  assignedProfile: "Y",
});
assert.deepEqual(positiveMemory.acceptedIds, []);
assert.deepEqual(
  positiveMemory.verificationCandidates.map((candidate) => candidate.traitId),
  ["B_n3"],
);

/**
 * The registry phrases that reach only bounded verification, never acceptance.
 *
 * Being reachable is not enough, because the matcher also reads Alex's own
 * messages. The output check reads `acceptedIds` only, so a phrase that falls to
 * `verificationCandidates` is a trait the check cannot see. Pinning this set
 * means a change that pushes more phrases into it has to say so.
 *
 * All four here are correct: each is a bare noun phrase carrying no assertion of
 * the negative the trait states. "memory for numbers" is not "below-average
 * memory for numbers"; "verbally skillful" is not "not verbally skillful".
 * `hasRequiredTraitSemantics` withholds them on that ground, and the fuller
 * phrasings of both traits are accepted.
 */
const VERIFICATION_ONLY_PHRASES = new Set([
  "B_n3|memory for numbers",
  "C_n1|verbally skillful",
  "C_n1|verbally skilful",
  "C_n1|verbally skillfull",
]);

for (const entry of TRAIT_KEYWORD_REGISTRY) {
  const profile = entry.profiles[0];
  const phrase = entry.corePhrases[0]!;
  for (const registeredPhrase of [...entry.corePhrases, ...entry.acceptedVariants]) {
    const direct = extractHumanTraitsFast({
      messageText: `Candidate ${entry.candidate} ${registeredPhrase}.`,
      assignedProfile: profile,
    });
    assert.ok(
      direct.acceptedIds.includes(entry.traitId) ||
        direct.verificationCandidates.some((candidate) => candidate.traitId === entry.traitId),
      `${entry.traitId} must remain reachable from registered phrase: ${registeredPhrase}`,
    );
    assert.equal(
      direct.acceptedIds.includes(entry.traitId),
      !VERIFICATION_ONLY_PHRASES.has(`${entry.traitId}|${registeredPhrase}`),
      `${entry.traitId} changed whether the matcher accepts "${registeredPhrase}" outright; ` +
        "a phrase the matcher only defers is invisible to the output check",
    );
  }
  assert.ok(
    !extractHumanTraitsFast({
      messageText: `If Candidate ${entry.candidate} ${phrase}, would that help?`,
      assignedProfile: profile,
    }).acceptedIds.includes(entry.traitId),
    `${entry.traitId} hypothetical must not enter the fast ledger`,
  );
  assert.ok(
    !extractHumanTraitsFast({
      messageText: `I heard Candidate ${entry.candidate} ${phrase}.`,
      assignedProfile: profile,
    }).acceptedIds.includes(entry.traitId),
    `${entry.traitId} reported claim must not enter the fast ledger`,
  );
  const ineligibleProfile = (["X", "Y", "Z"] as const).find(
    (candidate) => !entry.profiles.includes(candidate),
  );
  if (ineligibleProfile) {
    const ineligible = extractHumanTraitsFast({
      messageText: `Candidate ${entry.candidate} ${phrase}.`,
      assignedProfile: ineligibleProfile,
    });
    assert.ok(!ineligible.acceptedIds.includes(entry.traitId));
    assert.ok(
      !ineligible.verificationCandidates.some((candidate) => candidate.traitId === entry.traitId),
    );
  }
}

// Longer messages that mix a preference, a match and a miss.
const mixedMessage = extractHumanTraitsFast({
  messageText:
    "Candidate B appeals to me too, since you can rely on him/her 100%. Candidate B gossips about co-workers, but that seems milder than the other candidates' minuses.",
  assignedProfile: "Y",
});
assert.deepEqual(mixedMessage.acceptedIds, ["B_p2", "B_n4"]);
assert.deepEqual(mixedMessage.verificationCandidates, []);

const comparisonMessage = extractHumanTraitsFast({
  messageText:
    "He has good points, sure. I ruled out Candidate C quickly and the other three were close. I went with B because of the cool head and his reliability. To me Candidate A's \"recognizing dangerous situations\" is close to Candidate B's cool head, so they tie there.",
  assignedProfile: "Y",
});
// The participant quotes the trait phrase and makes a claim about Candidate A
// with no attribution anywhere, so it is a disclosure.
assert.deepEqual(comparisonMessage.acceptedIds, ["A_p1", "B_p1", "B_p2"]);
assert.deepEqual(comparisonMessage.verificationCandidates, []);

const quotedCardMessage = extractHumanTraitsFast({
  messageText:
    'Not being open to new ideas (Candidate A) worries me more than gossip does, so Candidate B is still my pick. The other minus I have for B, "has a below-average memory for numbers", is the only real concern.',
  assignedProfile: "Y",
});
// Quoting one's own card is a disclosure, so `B_n3` is accepted.
assert.deepEqual(quotedCardMessage.acceptedIds, ["A_n4", "B_n3"]);
assert.deepEqual(quotedCardMessage.verificationCandidates, []);

const parentheticalMessage = extractHumanTraitsFast({
  messageText:
    "Candidate D's strengths feel general rather than pilot-specific, and his weak points would be bad in a cockpit (quick-tempered).",
  assignedProfile: "Y",
});
assert.deepEqual(parentheticalMessage.acceptedIds, []);
assert.deepEqual(
  parentheticalMessage.verificationCandidates.map((candidate) => candidate.traitId),
  ["D_n4"],
);

assert.deepEqual(
  ids("being moody when lives depend on you is not something to brush off", "X"),
  [],
);
assert.deepEqual(
  ids(
    "on the other hand, a cockpit must be very organized and tidy, so candidate A could get distracted in flight and that is risky",
    "X",
  ),
  [],
);

const cN1Lexical = extractHumanTraitsFast({
  messageText: "Candidate C is verbally skillfull.",
  assignedProfile: "Y",
});
assert.equal(cN1Lexical.verificationCandidates[0]?.traitId, "C_n1");

assert.deepEqual(
  validateExtractedTraitMentions(
    "I went with Candidate A because his positive points seem vital.",
    [
      {
        traitId: "A_p1",
        evidenceQuote: "his positive points seem vital",
        assertionType: "asserted",
        confidence: 0.99,
      },
    ],
  ),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("I heard Candidate B is good at multitasking.", [
    {
      traitId: "B_p4",
      evidenceQuote: "good at multitasking",
      assertionType: "asserted",
      confidence: 0.99,
    },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("Candidate B cannot assess weather conditions very well.", [
    {
      traitId: "B_p3",
      evidenceQuote: "assess weather conditions very well",
      assertionType: "asserted",
      confidence: 0.99,
    },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("Candidate B has a good memory for numbers.", [
    {
      traitId: "B_n3",
      evidenceQuote: "memory for numbers",
      assertionType: "asserted",
      confidence: 0.99,
    },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions(
    "If Candidate B had a cool head, that would help. Candidate B keeps a cool head in crisis situations.",
    [{ traitId: "B_p1", evidenceQuote: "cool head", assertionType: "asserted", confidence: 0.99 }],
  ),
  ["B_p1"],
);

assert.deepEqual(
  validateExtractedTraitMentions(
    "And if A makes a mistake, a co-worker points it out, and he does not tolerate criticism?! what then?",
    [
      {
        traitId: "A_n1",
        evidenceQuote: "he does not tolerate criticism",
        assertionType: "asserted",
        confidence: 0.99,
      },
    ],
  ),
  [],
);

const parseMock = mock.method(
  Responses.prototype,
  "parse",
  async () =>
    ({
      output_parsed: {
        mentions: [
          {
            traitId: "A_n4",
            evidenceQuote: "not open to new ideas",
            assertionType: "asserted",
            confidence: 0.99,
          },
          {
            traitId: "B_n3",
            evidenceQuote: "below-average memory for numbers",
            assertionType: "asserted",
            confidence: 0.99,
          },
        ],
      },
    }) as any,
);
try {
  const bounded = await verifyHumanTraitCandidates({
    messageText:
      "Candidate A is not open to new ideas, and Candidate B has a below-average memory for numbers.",
    candidates: [
      {
        traitId: "B_n3",
        evidenceQuote: "below-average memory for numbers",
        reason: "assertion_context",
      },
    ],
  });
  assert.deepEqual(bounded.ids, ["B_n3"]);
  assert.equal(bounded.status, "verified");
} finally {
  parseMock.mock.restore();
}
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate D's weak points would be bad in a cockpit (quick-tempered).",
    [
      {
        traitId: "D_n4",
        evidenceQuote: "quick-tempered",
        assertionType: "asserted",
        confidence: 0.99,
      },
    ],
  ),
  ["D_n4"],
);
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate A does not tolerate criticism.",
    [
      {
        traitId: "A_n1",
        evidenceQuote: "does not tolerate criticism",
        assertionType: "asserted",
        confidence: 0.99,
      },
    ],
    new Set(["B_p1"]),
  ),
  [],
);

// The reviewed registry, compared entry by entry against the runtime copy.
//
// `trait_keyword_registry.yaml` records what each entry was reviewed and
// approved to contain. The comparison covers ownership and trait text as well
// as the keyword lists: `traitData.ts` is the source of truth for those, and an
// entry that disagrees with it was approved against a different pool.
type ReviewedRegistry = {
  traits: Array<{
    trait_id: string;
    candidate: string;
    valence: string;
    profiles: string[];
    canonical_text: string;
    core_phrases: string[];
    accepted_variants: string[];
    fuzzy_policy: string;
    review_status: string;
  }>;
};
const reviewed = load(
  readFileSync(new URL("../eval/trait_keyword_registry.yaml", import.meta.url), "utf8"),
) as ReviewedRegistry;
const approvedEntries = reviewed.traits.filter((entry) => entry.review_status === "approved");
assert.equal(approvedEntries.length, TRAIT_KEYWORD_REGISTRY.length);
for (const runtimeEntry of TRAIT_KEYWORD_REGISTRY) {
  const approved = approvedEntries.find((entry) => entry.trait_id === runtimeEntry.traitId);
  assert.ok(approved, `missing approved registry entry ${runtimeEntry.traitId}`);
  assert.deepEqual(
    runtimeEntry.corePhrases,
    approved.core_phrases,
    `${runtimeEntry.traitId} core phrases drifted`,
  );
  assert.deepEqual(
    runtimeEntry.acceptedVariants,
    approved.accepted_variants,
    `${runtimeEntry.traitId} variants drifted`,
  );
  assert.equal(
    runtimeEntry.candidate,
    approved.candidate,
    `${runtimeEntry.traitId} candidate drifted`,
  );
  assert.equal(runtimeEntry.valence, approved.valence, `${runtimeEntry.traitId} valence drifted`);
  assert.deepEqual(
    [...runtimeEntry.profiles].sort(),
    [...approved.profiles].sort(),
    `${runtimeEntry.traitId} profiles drifted`,
  );
  assert.equal(
    runtimeEntry.fuzzyPolicy,
    approved.fuzzy_policy,
    `${runtimeEntry.traitId} fuzzy policy drifted`,
  );
  assert.equal(
    TRAIT_BY_ID.get(runtimeEntry.traitId)?.text,
    approved.canonical_text,
    `${runtimeEntry.traitId} was approved against different trait text than the pool now holds`,
  );
}

const ambiguous = extractHumanTraitsFast({
  messageText: "Should we trust Candidate B's reliability?",
  assignedProfile: "X",
});
assert.deepEqual(ambiguous.acceptedIds, []);
assert.equal(ambiguous.verificationCandidates[0]?.traitId, "B_p2");
// --- The matcher also reads Alex's own messages ------------------------------
//
// Alex's messages are matched with the same rule-based matcher, with no model
// call. The output rules ask Alex to keep each trait's key wording, so its
// messages fit the matcher well. No profile filter is applied, because Alex may
// restate a trait a human put on the table.
const alexDisclosure = extractHumanTraitsFast({
  messageText:
    "You already shared that Candidate C is considered egocentric and is reluctant to take part in training. From my notes, Candidate C can make the right decisions very quickly, puts the safety of people in their care above everything else, and performs very well in terms of sustained attention. I also have that Candidate C is not verbally skillful.",
});
assert.deepEqual(
  [...alexDisclosure.acceptedIds].sort(),
  ["C_n1", "C_n2", "C_n3", "C_p1", "C_p6", "C_p7"],
  "every trait Alex names in its own message is recorded without a model call",
);

// Misses Alex lists after its matches must be recorded too.
const alexMisses = extractHumanTraitsFast({
  messageText:
    "From my notes, Candidate D matches on reacting adequately to unforeseen events, concentrating very well, being very resilient, and being very responsible, and misses on being considered moody and having strong prejudices.",
});
assert.ok(
  alexMisses.acceptedIds.includes("D_n5") && alexMisses.acceptedIds.includes("D_n6"),
  "misses Alex discloses are recorded",
);

// --- Short, informal ways of stating a trait ---------------------------------
//
// Participants often state a trait loosely: a short form ("bragging"), a
// paraphrase ("keeps their cool"), or a noun phrase ("B's gossiping").
for (const [message, profile, traitId] of [
  ["I like candidate A, he does his job well even though he's bragging sometimes.", "Y", "A_n3"],
  [
    "Candidate B keeps their cool, is 100 percent reliable and can assess weather conditions very well.",
    "X",
    "B_p1",
  ],
  ["Candidate C being reluctant to participate in training is a big warning sign", "X", "C_n3"],
  ["What about B's gossiping others", "Y", "B_n4"],
] as const) {
  const said = extractHumanTraitsFast({ messageText: message, assignedProfile: profile });
  assert.ok(
    said.acceptedIds.includes(traitId),
    `${traitId} was stated and must reach the board: ${message}`,
  );
}

// The bare forms carry the trait only when the sentence names the candidate.
for (const message of [
  "Someone in that pile is always bragging.",
  "There is too much gossiping on that crew.",
]) {
  const unattributed = extractHumanTraitsFast({ messageText: message, assignedProfile: "Y" });
  assert.deepEqual(unattributed.acceptedIds, [], `no candidate is named: ${message}`);
}

// --- The one trait pair the words cannot separate ------------------------------
//
// B_n5 and D_n1 are both "Is considered arrogant". The verifier is given an id
// and a quote but no position, so it may return both for a sentence that says
// it once, about B. The message itself decides which candidate was meant.
const bothSides =
  "I see both sides: B\u2019s operational strengths\u2014keeps a cool head in crisis, is 100% reliable, can assess weather well, and is good at multitasking\u2014are clear matches. Those sit against interpersonal misses: considered arrogant, sometimes abusive in tone, and described as nagging or not very cooperative. D\u2019s interpersonal risks are different: considered moody and having strong prejudices.";
const arrogantMention = (traitId: string) =>
  validateExtractedTraitMentions(
    bothSides,
    [
      {
        traitId,
        evidenceQuote: "considered arrogant",
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
    ],
    new Set([traitId]),
  );
assert.deepEqual(arrogantMention("B_n5"), ["B_n5"], "the sentence names B before the phrase");
assert.deepEqual(arrogantMention("D_n1"), [], "nobody called D arrogant in that message");

// The attribution check runs before the duplicate-quote rule. Asked about "is
// considered arrogant", the verifier returns B_n5 and D_n1 with the same quote;
// attribution keeps only the candidate the message names, so the duplicate rule
// no longer sees one quote on two ids.
const bothIdsOneQuote = (message: string, quote: string) =>
  validateExtractedTraitMentions(
    message,
    [
      {
        traitId: "B_n5",
        evidenceQuote: quote,
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
      {
        traitId: "D_n1",
        evidenceQuote: quote,
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
    ],
    new Set(["B_n5", "D_n1"]),
  );
assert.deepEqual(
  bothIdsOneQuote(
    "Candidate B — Strengths: keeps a cool head in crisis situations. Weaknesses: is considered arrogant and is sometimes abusive in tone.\n\nCandidate D — Strengths: can concentrate very well. Weaknesses: is considered moody and has strong prejudices.",
    "considered arrogant",
  ),
  ["B_n5"],
  "the overview names B before the phrase and never calls D arrogant",
);
// The name the quote itself carries settles it, and wins over a letter in an
// earlier clause.
assert.deepEqual(
  bothIdsOneQuote(
    "I agree we\u2019re leaning to D. I have one more item: Candidate B is considered arrogant. Anything else the team wants to cover before we choose?",
    "B is considered arrogant",
  ),
  ["B_n5"],
);
// The duplicate-quote rule still does the job it was written for: one generic
// span spread across two ids is not evidence for either.
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate B is good at multitasking and keeps a cool head in crisis situations.",
    [
      {
        traitId: "B_p4",
        evidenceQuote: "Candidate B",
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
      {
        traitId: "B_p1",
        evidenceQuote: "Candidate B",
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
    ],
    new Set(["B_p1", "B_p4"]),
  ),
  [],
);

// The same check must not cost a trait the message does attribute.
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate D is considered arrogant and quick-tempered.",
    [
      {
        traitId: "D_n1",
        evidenceQuote: "considered arrogant",
        assertionType: "asserted" as const,
        confidence: 0.95,
      },
    ],
    new Set(["D_n1"]),
  ),
  ["D_n1"],
  "an attributed arrogance claim still counts for D",
);

console.log("pooling extractor fast-path tests passed");
