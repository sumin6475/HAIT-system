import assert from "node:assert/strict";
import { forceGuardsOnForTest } from "../lib/guardFlags.js";
// Tests for the Observer's output normalisation, recovery after failed
// observations, message generation and output checks, and supersession when a
// newer human message arrives. No network and no database: model calls and
// storage are replaced with test doubles.
//
// A comparison run may switch checks off in `server/.env`, which this suite
// loads. Force them on first, so the suite always tests the normal behaviour.
forceGuardsOnForTest();
import { mock } from "node:test";
import { Responses } from "openai/resources/responses/responses";
import { generateScopedRouteMessage } from "../lib/routeScopedGeneration.js";
import { config } from "../config.js";
import { ConversationObservation } from "../models/ConversationObservation.js";
import { Message } from "../models/Message.js";
import { Participant } from "../models/Participant.js";
import {
  CONVERSATION_OBSERVER_OUTPUT_SCHEMA,
  alexQuestionAwaitingReply,
  conversationObserverReviewReason,
  observationRosterConflicts,
  enqueueConversationObservation,
  liveObservationAnchorSeq,
  normalizeConversationObservation,
  reduceConversationStateAfter,
  type ConversationObserverResult,
} from "../lib/conversationObserver.js";
import {
  observerDeltaFromTurn,
  reduceConversationLedger,
  withOpportunityTransition,
  type ConversationLedgerState,
} from "../lib/conversationLedger.js";
import { validateConversationLedgerJudgeDecision } from "../lib/interventionJudge.js";
import {
  buildRouteUserContext,
  type SelectedOpportunityGenerationContext,
} from "../lib/routeContext.js";

const roster = ["alex", "humanX", "humanY"] as const;
const observation: ConversationObserverResult = {
  addressees: ["alex"],
  replyToSeq: null,
  speechAct: "question",
  activeCandidates: ["A", "B"],
  mentionedCandidates: ["A", "B"],
  scopeCandidates: ["A", "B"],
  focusCandidate: "B",
  focusBasis: "carried_thread",
  threadGoal: "compare",
  requestedScope: "multiple_candidates",
  requestExplicitness: "explicit",
  transitionState: "transition_available",
  relationToPendingAlexQuestion: "unrelated",
  expectedHumanResponder: null,
  conversationPhase: "comparison",
  alexRelation: "explicit_addressee",
  activeThread: {
    threadId: "thread-1",
    rootSeq: 1,
    status: "open",
    goal: "compare_information",
    requestedAction: "compare A and B",
    requestedScope: "multiple_candidates",
    candidates: ["A", "B"],
    participants: [...roster],
    expectedResponders: ["alex"],
    alexParticipation: "required",
    evidenceSeqs: [1],
  },
  floor: { holder: "open", expectedNext: [], transition: "available" },
  fieldConfidence: { threading: 1, addressee: 1, floor: 1, alexRelation: 1 },
  confidence: 1,
  requestIntent: {
    kind: "compare_request",
    candidate: null,
    candidates: ["A", "B"],
    source: "visible_board",
    countKind: "all",
  },
  opportunityTransitions: [],
};
function reduce(
  previous: ConversationLedgerState | null,
  seq: number,
  patch: Partial<ConversationObserverResult> = {},
) {
  return reduceConversationLedger(
    previous,
    observerDeltaFromTurn({
      sessionKey: "recovery-test",
      roster,
      sourceRole: "humanX",
      currentTriggerSeq: seq,
      contextThroughSeq: seq,
      observation: { ...observation, ...patch },
    }),
  ).state;
}
const initial = reduce(null, 1);
const id = initial.opportunities[0]!.id;
const quiet: Partial<ConversationObserverResult> = {
  speechAct: "other",
  addressees: [],
  requestExplicitness: "none",
  requestIntent: null,
  alexRelation: "unrelated",
  activeThread: null,
};
for (const content of [
  "Alex, thanks.",
  "Alex, let's hear from Y first.",
  "Don't let Y answer; Alex, please answer now.",
]) {
  const semantic = { ...observation, ...quiet };
  const normalized = normalizeConversationObservation(
    semantic,
    false,
    "humanX",
    content,
    2,
    new Set([1, 2]),
  );
  assert.equal(
    reduce(null, 2, normalized).opportunities.length,
    0,
    "normalization cannot invent a question from wording",
  );
}
// A turn that addresses Alex makes the floor shared, not Alex's. The human keeps
// first position; Alex is only allowed to answer the request addressed to it. If
// the floor still excluded Alex, the ledger would open an opportunity for Alex and
// forbid Alex to take it at the same time. The exclusive-floor case is checked
// separately below, on a turn that does not address Alex.
const shared = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["alex", "humanY"],
    expectedHumanResponder: "humanY",
    floor: { holder: "humanY", expectedNext: ["humanY"], transition: "held" },
  },
  false,
);
assert.equal(
  shared.floor.holder,
  "open",
  "a request addressed to Alex cannot leave a human holding an exclusive floor",
);
assert.deepEqual(
  shared.floor.expectedNext,
  ["humanY", "alex"],
  "the solicited human still goes first; Alex gets parity, not priority",
);

// The Observer may list only a human in `addressees` while calling Alex the
// explicit addressee. That signal opens an Alex opportunity, so the floor must not
// close to Alex at the same time.
const contradictoryAddress = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanY"],
    alexRelation: "explicit_addressee",
    speechAct: "proposal",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanY",
    floor: { holder: "humanY", expectedNext: ["humanY"], transition: "held" },
  },
  false,
  "humanX",
  "Hi! Maybe we should start by going through the information we have on each candidate",
  3,
  new Set([1, 2, 3]),
  roster,
);
assert.equal(
  contradictoryAddress.floor.holder,
  "open",
  "an explicit-addressee relation opens the floor for Alex just as it opens an opportunity",
);
assert.ok(
  contradictoryAddress.floor.expectedNext.includes("alex"),
  "Alex is expected next alongside the named human",
);

// A second-person plural invitation ("both of you") in a room of one speaker, one
// other human and Alex addresses Alex too. If it were resolved to the other human
// alone, it would open no Alex opportunity and create a human-only floor that
// blocks Alex: an explicit invitation would become a prohibition. Address
// resolution here is structural, not a reading of intent.
const pluralInvitation = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanX"],
    alexRelation: "group_participant",
    speechAct: "question",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanX",
    floor: { holder: "humanX", expectedNext: ["humanX"], transition: "held" },
  },
  false,
  "humanY",
  "Is this what the two of you are feeling also?",
  28,
  new Set([28]),
  roster,
);
assert.ok(
  pluralInvitation.addressees.includes("alex") && pluralInvitation.addressees.includes("humanX"),
  "a second-person plural address names every other participant",
);
assert.equal(
  pluralInvitation.floor.holder,
  "open",
  "a request that addresses Alex too cannot leave a human holding an exclusive floor",
);
assert.ok(
  pluralInvitation.floor.expectedNext.includes("alex"),
  "both addressed participants are expected next",
);
const singularQuestion = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanX"],
    alexRelation: "group_participant",
    speechAct: "question",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanX",
    floor: { holder: "humanX", expectedNext: ["humanX"], transition: "held" },
  },
  false,
  "humanY",
  "humanX, do you agree with that?",
  28,
  new Set([28]),
  roster,
);
assert.equal(
  singularQuestion.floor.holder,
  "humanX",
  "an ordinary human-to-human question still reserves that human's turn",
);
assert.ok(
  !singularQuestion.addressees.includes("alex"),
  "the plural rule does not fire on a singular address",
);
let priorState = reduceConversationStateAfter({
  anchorSeq: 1,
  conversationEpoch: 1,
  observation: { ...observation, focusCandidate: null },
});
for (let seq = 2; seq <= 4; seq++) {
  const normalized = normalizeConversationObservation(
    observation,
    false,
    "humanX",
    "Let's keep talking about that one.",
    seq,
    new Set([1, 2, 3, 4]),
    roster,
  );
  assert.equal(normalized.focusCandidate, "B");
  priorState = reduceConversationStateAfter({
    previous: priorState,
    anchorSeq: seq,
    conversationEpoch: seq,
    observation: normalized,
  });
}
assert.equal(
  normalizeConversationObservation(
    { ...observation, focusCandidate: null },
    false,
    "humanX",
    "B",
    5,
    undefined,
  ).focusCandidate,
  null,
  "explicit semantic null clears focus",
);
assert.deepEqual(
  normalizeConversationObservation(
    { ...observation, mentionedCandidates: ["B"] },
    false,
    "humanX",
    "A good point about B.",
  ).mentionedCandidates,
  ["B"],
);
// "This answers Alex", worked out from position: only the message immediately
// before, and only when it was a question. It means "Alex asked and this is the
// message that followed", never "Alex asked at some point".
const alexTurns = (content: string, senderRole = "ai") => [
  { seq: 14, senderRole: "humanY", content: "earlier human turn" },
  { seq: 16, senderRole, content },
];
assert.equal(
  alexQuestionAwaitingReply(alexTurns("Do you want me to share A or D next?") as any, 17),
  16,
);
assert.equal(
  alexQuestionAwaitingReply(alexTurns("Which candidate should we take next") as any, 17),
  16,
  "a question-word opening counts without the mark",
);
assert.equal(
  alexQuestionAwaitingReply(alexTurns("I'll add one note on Candidate A.") as any, 17),
  undefined,
  "a statement is not a question",
);
assert.equal(
  alexQuestionAwaitingReply(alexTurns("Do you want A or D?", "humanX") as any, 17),
  undefined,
  "another human's question is not Alex's",
);
assert.equal(
  alexQuestionAwaitingReply(
    [...alexTurns("Do you want A or D?"), { seq: 17, senderRole: "humanY", content: "A" }] as any,
    18,
  ),
  undefined,
  "a human already answered, so this turn is not the reply to Alex",
);
// The candidate-name detector, and the article it must keep refusing.
//
// Salience ranks a candidate's claim on Alex's attention because it is exact and
// defined on every turn. The detector must find a bare letter in any ordinary
// sentence position ("Let's lay out A first"), not only before a comma or
// conjunction.
const mentioned = (anchorContent: string) =>
  normalizeConversationObservation(
    { ...observation, mentionedCandidates: [] },
    false,
    "humanX",
    anchorContent,
  ).mentionedCandidates;
assert.deepEqual(
  mentioned("Let's lay out A first."),
  ["A"],
  "a bare A in an ordinary sentence position is a name",
);
assert.deepEqual(mentioned("I would drop A honestly"), ["A"]);
assert.deepEqual(mentioned("Between the two I prefer A."), ["A"]);
assert.deepEqual(mentioned("What do you have on A?"), ["A"]);
assert.deepEqual(
  mentioned("A is the one I keep coming back to."),
  ["A"],
  "a sentence-initial A with a verb after it is a name",
);
assert.deepEqual(mentioned("A's notes are thin."), ["A"]);
assert.deepEqual(mentioned("A and B are close."), ["A", "B"]);
// The English article "A" is capitalised only at the start of a sentence, which
// is the one position the detector still has to treat as ambiguous.
assert.deepEqual(
  mentioned("A good point about B."),
  ["B"],
  "a sentence-initial article is not a name",
);
assert.deepEqual(mentioned("A lot of that depends on C."), ["C"]);
assert.deepEqual(
  mentioned("I agree. A fair summary of where we are."),
  [],
  "the article after a sentence boundary is still an article",
);
assert.deepEqual(
  mentioned("a bit hectic is what my notes say"),
  [],
  "the lower-case article was never a name and still is not",
);
const normalizedAssertion = normalizeConversationObservation(
  {
    ...observation,
    speechAct: "answer",
    addressees: ["alex"],
    alexRelation: "explicit_addressee",
    replyToSeq: null,
    mentionedCandidates: ["A", "B"],
    focusCandidate: "A",
    focusBasis: "current_explicit",
    requestExplicitness: "explicit",
    requestedScope: "multiple_candidates",
  },
  false,
  "humanX",
  "I'm torn between A and B.",
);
assert.deepEqual(
  normalizedAssertion.addressees,
  [],
  "Alex is not an explicit addressee without a name or reply target",
);
assert.equal(
  normalizedAssertion.requestExplicitness,
  "none",
  "a preference assertion is not normalized into a request",
);
assert.equal(normalizedAssertion.requestIntent, null);
assert.equal(
  normalizedAssertion.focusCandidate,
  null,
  "a multi-candidate assertion has no single explicit focus",
);
assert.equal(normalizedAssertion.focusBasis, "none");
assert.deepEqual(normalizedAssertion.mentionedCandidates, ["A", "B"]);
const normalizedAvailableFloor = normalizeConversationObservation(
  {
    ...observation,
    floor: { holder: "open", expectedNext: ["humanX", "alex"], transition: "available" },
  },
  false,
  "humanX",
  "Candidate B is stronger.",
);
assert.deepEqual(
  normalizedAvailableFloor.floor.expectedNext,
  ["alex"],
  "the completed speaker is removed from an available floor prediction",
);
const closed = reduce(initial, 2, {
  ...quiet,
  activeThread: { ...observation.activeThread!, status: "resolved", evidenceSeqs: [1, 2] },
});
assert.equal(closed.opportunities[0]!.status, "resolved_by_human");
assert.equal(reduce(closed, 3, quiet).foregroundThreadId, null);
assert.equal(
  validateConversationLedgerJudgeDecision({
    state: { ...closed, opportunities: initial.opportunities },
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 2]),
    decision: {
      decision: "speak",
      act: "answer",
      selectedOpportunityId: id,
      evidence: "selected_open_opportunity",
      evidenceSeqs: [1],
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer the open request",
    },
  }).ok,
  false,
  "open opportunities left on closed threads cannot be selected",
);
for (const status of ["resolved_by_human", "withdrawn", "superseded", "deferred"] as const) {
  const state = reduce(initial, 2, {
    ...quiet,
    opportunityTransitions: [
      {
        opportunityId: id,
        toStatus: status,
        reason: "observed resolution",
        evidenceSeqs: [2],
        correctedThreadId: null,
      },
    ],
  });
  assert.equal(
    state.opportunities[0]!.status,
    status,
    "lifecycle is applied even with no foreground thread",
  );
  const reopened = reduce(state, 3, {
    ...quiet,
    activeThread: observation.activeThread,
    opportunityTransitions: [
      {
        opportunityId: id,
        toStatus: "open",
        reason: "corrected interpretation",
        evidenceSeqs: [3],
        correctedThreadId: null,
      },
    ],
  });
  assert.equal(reopened.opportunities[0]!.status, "open");
}
const corrected = reduce(initial, 1, {
  activeThread: { ...observation.activeThread!, threadId: "corrected" },
});
assert.equal(corrected.opportunities[0]!.threadId, "corrected");
const relinked = reduce(initial, 2, {
  ...quiet,
  activeThread: { ...observation.activeThread!, threadId: "corrected" },
  opportunityTransitions: [
    {
      opportunityId: id,
      toStatus: "open",
      reason: "repair old association",
      evidenceSeqs: [2],
      correctedThreadId: "corrected",
    },
  ],
});
assert.equal(relinked.opportunities[0]!.threadId, "corrected");
const consumed = withOpportunityTransition(initial, {
  opportunityId: id,
  toStatus: "consumed_by_alex",
  reason: "sent",
  broadcastSucceeded: true,
  alexBroadcastSeq: 2,
}).state;
assert.equal(
  reduce(consumed, 3, {
    ...quiet,
    opportunityTransitions: [
      {
        opportunityId: id,
        toStatus: "open",
        reason: "bad reinterpretation",
        evidenceSeqs: [3],
        correctedThreadId: null,
      },
    ],
  }).opportunities[0]!.status,
  "consumed_by_alex",
);
const invalid = reduce(initial, 2, {
  ...quiet,
  opportunityTransitions: [
    {
      opportunityId: id,
      toStatus: "withdrawn",
      reason: "future evidence",
      evidenceSeqs: [99],
      correctedThreadId: null,
    },
  ],
});
assert.equal(invalid.opportunities[0]!.status, "open");

const context: SelectedOpportunityGenerationContext = {
  id,
  kind: "direct_question",
  expectation: "required",
  sourceSeq: 1,
  currentTriggerSeq: 1,
  threadId: "thread-1",
  targets: ["alex"],
  requestedAction: "compare A and B",
  sourceContent: "",
  evidenceSeqs: [1],
  requestIntent: initial.opportunities[0]!.requestIntent,
};
const intents = ["Alex, compare A and B.", "Alex, how do A and B stack up against each other?"].map(
  (content) =>
    buildRouteUserContext({
      routeKind: "address",
      conditionCode: "C2",
      messages: [{ seq: 1, senderRole: "humanX", speaker: "X", content }],
      revealStats: {},
      anchorSeq: 1,
      selectedOpportunity: { ...context, sourceContent: content },
    }).requestIntent,
);
assert.deepEqual(intents[0], intents[1]);
assert.equal(intents[0]!.source, "visible_board");

// Runs the real queued observation pipeline with test doubles for the model and
// storage. No network or database access. A failed observation is deliberately
// the latest record.
const records: any[] = [
  { sessionId: "recovery-test", anchorSeq: 1, stateAfter: priorState, ledgerStateAfter: initial },
];
const messages = [1, 3, 4].map((seq) => ({
  seq,
  senderRole: "humanX",
  content: seq === 1 ? "Compare A and B" : "Never mind that request",
}));
const query = (value: unknown) => ({
  sort() {
    return this;
  },
  select() {
    return this;
  },
  lean: async () => value,
});
let parseCalls = 0;
const oldMode = config.conversationObserverMode;
const oldKey = config.openaiApiKey;
try {
  config.conversationObserverMode = "active";
  config.openaiApiKey = "test-no-network";
  mock.method(
    Message,
    "find",
    (filter: any) => query(messages.filter((message) => message.seq <= filter.seq.$lte)) as any,
  );
  mock.method(Participant, "find", () => query([{ role: "humanX" }, { role: "humanY" }]) as any);
  mock.method(
    ConversationObservation,
    "findOne",
    (filter: any) =>
      query(
        [...records]
          .reverse()
          .find(
            (record) =>
              record.anchorSeq < filter.anchorSeq.$lt &&
              (!filter.stateAfter || record.stateAfter) &&
              (!filter.ledgerStateAfter || record.ledgerStateAfter),
          ),
      ) as any,
  );
  mock.method(ConversationObservation, "updateOne", async (filter: any, update: any) => {
    let record = records.find((item) => item.anchorSeq === filter.anchorSeq);
    if (!record) {
      record = { ...filter };
      records.push(record);
    }
    Object.assign(record, update.$set);
    return {} as any;
  });
  mock.method(Responses.prototype, "parse", (async (request: any) => {
    parseCalls++;
    if (parseCalls === 1) throw new Error("injected transient observer failure");
    assert.match(
      request.input[1].content,
      /opp:1:direct_question:alex/,
      "last successful ledger reaches the recovering observer",
    );
    assert.match(request.input[1].content, /\[3\]/, "missed turn remains in the transcript");
    // The transcript, which only grows, comes first so it forms a cacheable prefix;
    // the per-turn state follows it.
    assert.ok(
      request.input[1].content.indexOf("Complete conversation transcript") <
        request.input[1].content.indexOf("Previous cumulative state"),
      "the transcript precedes the volatile state in the observer prompt",
    );
    return {
      model: "test",
      output_parsed: {
        ...observation,
        ...quiet,
        opportunityTransitions: [
          {
            opportunityId: id,
            toStatus: "withdrawn",
            reason: "request withdrawn during missed turn",
            evidenceSeqs: [3, 4],
            correctedThreadId: null,
          },
        ],
      },
    };
  }) as any);
  assert.equal(
    await enqueueConversationObservation({
      sessionId: "recovery-test",
      anchorSeq: 3,
      conversationEpoch: 3,
      explicitAlexDefer: false,
    }),
    null,
  );
  const recovered = await enqueueConversationObservation({
    sessionId: "recovery-test",
    anchorSeq: 4,
    conversationEpoch: 4,
    explicitAlexDefer: false,
  });
  assert.equal(recovered?.ledgerStateAfter?.opportunities[0]?.status, "withdrawn");
  assert.equal(recovered?.ledgerStateAfter?.foregroundThreadId, null);
  assert.equal(recovered?.ledgerStateAfter?.degradedMode, false);
  assert.equal(parseCalls, 2);
} finally {
  mock.restoreAll();
  config.conversationObserverMode = oldMode;
  config.openaiApiKey = oldKey;
}
// --- One live observation per session ------------------------------------------
//
// Observations for a session run one at a time, so a burst of human messages
// would otherwise cost the sum of their observation times before the only turn
// whose answer is still wanted. A newer human message cancels the older
// observation, whether it is still queued or already running.
{
  const burstRecords: any[] = [
    { sessionId: "burst-test", anchorSeq: 1, stateAfter: priorState, ledgerStateAfter: initial },
  ];
  const burstMessages = [1, 5, 6].map((seq) => ({
    seq,
    senderRole: "humanX",
    content: seq === 1 ? "Compare A and B" : `burst message ${seq}`,
  }));
  const bq = (value: unknown) => ({
    sort() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => value,
  });
  const anchorsParsed: number[] = [];
  const oldMode2 = config.conversationObserverMode;
  const oldKey2 = config.openaiApiKey;
  try {
    config.conversationObserverMode = "active";
    config.openaiApiKey = "test-no-network";
    mock.method(
      Message,
      "find",
      (filter: any) => bq(burstMessages.filter((m) => m.seq <= filter.seq.$lte)) as any,
    );
    mock.method(Participant, "find", () => bq([{ role: "humanX" }, { role: "humanY" }]) as any);
    mock.method(
      ConversationObservation,
      "findOne",
      (filter: any) =>
        bq(
          [...burstRecords]
            .reverse()
            .find(
              (r) =>
                r.anchorSeq < filter.anchorSeq.$lt &&
                (!filter.stateAfter || r.stateAfter) &&
                (!filter.ledgerStateAfter || r.ledgerStateAfter),
            ),
        ) as any,
    );
    mock.method(ConversationObservation, "updateOne", async (filter: any, update: any) => {
      let record = burstRecords.find((item) => item.anchorSeq === filter.anchorSeq);
      if (!record) {
        record = { ...filter };
        burstRecords.push(record);
      }
      Object.assign(record, update.$set);
      return {} as any;
    });
    mock.method(Responses.prototype, "parse", (async (request: any, options: any) => {
      const anchor = Number(/Current anchor: \[(\d+)\]/.exec(request.input[1].content)?.[1] ?? 0);
      anchorsParsed.push(anchor);
      if (anchor === 5) {
        // Stand in for a call that is still in flight when the next human
        // message lands: it settles only when the request is aborted.
        return await new Promise((_resolve, reject) => {
          // Match the SDK: an already-aborted signal rejects at once rather
          // than waiting for an abort event that has already fired.
          if (options.signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return { model: "test", output_parsed: { ...observation, ...quiet } };
    }) as any);

    // Case 1 — superseded while still queued: the call is never made at all.
    const queued5 = enqueueConversationObservation({
      sessionId: "burst-test",
      anchorSeq: 5,
      conversationEpoch: 5,
      explicitAlexDefer: false,
    });
    const queued6 = enqueueConversationObservation({
      sessionId: "burst-test",
      anchorSeq: 6,
      conversationEpoch: 6,
      explicitAlexDefer: false,
    });
    assert.equal(
      await queued5,
      null,
      "an observation superseded before it starts resolves to nothing",
    );
    assert.ok(await queued6, "the newest anchor is still observed");
    assert.deepEqual(anchorsParsed, [6], "a superseded queued observation costs no model call");
    assert.equal(
      burstRecords.some((record) => record.anchorSeq === 5),
      false,
      "a superseded turn leaves no error row in the audit",
    );

    // Case 2 — superseded while in flight: the request is aborted, which is
    // what returns the serial queue slot to the turn that matters.
    anchorsParsed.length = 0;
    const inflight5 = enqueueConversationObservation({
      sessionId: "burst-test",
      anchorSeq: 5,
      conversationEpoch: 5,
      explicitAlexDefer: false,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(anchorsParsed, [5], "the first observation did start");
    const newer6 = enqueueConversationObservation({
      sessionId: "burst-test",
      anchorSeq: 6,
      conversationEpoch: 6,
      explicitAlexDefer: false,
    });
    assert.equal(
      await inflight5,
      null,
      "an in-flight observation is abandoned when a newer message arrives",
    );
    assert.ok(await newer6, "the newer anchor completes behind it");
    assert.deepEqual(
      anchorsParsed,
      [5, 6],
      "the newer observation is not blocked by the abandoned one",
    );
    assert.equal(
      burstRecords.some((record) => record.anchorSeq === 5),
      false,
      "an aborted observation still writes no row",
    );

    // A re-observation of the same anchor must never cancel the observation it
    // is refining, so the guard is strictly-newer only.
    assert.equal(
      liveObservationAnchorSeq("burst-test"),
      null,
      "the live handle is released when the queue drains",
    );
  } finally {
    mock.restoreAll();
    config.conversationObserverMode = oldMode2;
    config.openaiApiKey = oldKey2;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The model's output contract and the observation shape consumers read are two
// different shapes.
// ─────────────────────────────────────────────────────────────────────────────

const b1Shape = CONVERSATION_OBSERVER_OUTPUT_SCHEMA.shape;

// `mentionedCandidates` and `activeThread.participants` are requested from the
// model even though the normaliser works both out again and replaces the model's
// answers. Structured output is written in schema order, and these fields act as
// reasoning steps for the fields after them (`alexRelevance` and
// `alexParticipation`); without them those later answers stop varying. These
// assertions keep the fields in the requested contract.
assert.equal(
  Object.hasOwn(b1Shape, "mentionedCandidates"),
  true,
  "the model is asked for mentionedCandidates — removing it destabilized the fields after it",
);
// The normaliser still replaces the value from the message text; asking for it is
// about what the model reasons through, not about trusting its answer.
const b1Normalized = normalizeConversationObservation(
  { ...observation, mentionedCandidates: [] },
  false,
  "humanX",
  "Let us compare Candidate C and Candidate D",
  9,
  new Set([1, 9]),
  roster,
);
assert.deepEqual(
  b1Normalized.mentionedCandidates,
  ["C", "D"],
  "mentionedCandidates is derived from the anchor text, not from model output",
);

const b1ThreadShape = (b1Shape.activeThread as any)._def.innerType.shape;
assert.equal(
  Object.hasOwn(b1ThreadShape, "participants"),
  true,
  "the model is asked for activeThread.participants — alexParticipation follows it in schema order",
);
assert.deepEqual(
  b1Normalized.activeThread?.participants,
  [...roster],
  "participants still reaches consumers, filtered to the session roster",
);

// activeThread.evidenceSeqs carries only the current message. The reducer joins
// thread evidence itself, so repeating the whole history would only make the
// Observer's output grow without limit.
const b1Base = { ...observation } as any;
assert.equal(
  CONVERSATION_OBSERVER_OUTPUT_SCHEMA.safeParse({
    ...b1Base,
    activeThread: { ...b1Base.activeThread, evidenceSeqs: [1, 2, 3, 4] },
  }).success,
  true,
  "four evidence seqs is the current-turn budget and parses",
);
assert.equal(
  CONVERSATION_OBSERVER_OUTPUT_SCHEMA.safeParse({
    ...b1Base,
    activeThread: { ...b1Base.activeThread, evidenceSeqs: [1, 2, 3, 4, 5] },
  }).success,
  false,
  "a whole accumulated evidence history is rejected by the contract",
);

// ─────────────────────────────────────────────────────────────────────────────
// A review is a second full Observer call, roughly doubling that turn's time, so
// it is kept for contradictions the rule-based normaliser cannot settle.
// ─────────────────────────────────────────────────────────────────────────────

const b8Normalize = (patch: Partial<ConversationObserverResult>) =>
  normalizeConversationObservation(
    { ...observation, ...patch } as ConversationObserverResult,
    false,
    "humanX",
    "Alex, what next?",
    9,
    new Set([9]),
    roster,
  );

// A floor marked "available" with a named holder never needs a review:
// normalisation turns it into an open floor (or "unclear" when the holder is not
// in the room) before reviews are considered.
for (const holder of ["humanY", "alex"] as const) {
  const normalized = b8Normalize({
    floor: { holder, expectedNext: [holder], transition: "available" },
  });
  assert.equal(
    normalized.floor.holder,
    "open",
    "an available transition means nobody holds the floor",
  );
  assert.equal(
    conversationObserverReviewReason(normalized, []),
    null,
    "a floor the normalizer already resolved never buys a second model call",
  );
}

// A roster conflict is repaired by the normaliser's filtering, so nothing is left
// to conflict. End to end: an observation naming someone outside the room must
// cost one model call, not two, and must not put the controller into degraded
// mode (which would forbid all inferred speech).
const b8Raw = {
  ...observation,
  addressees: ["alex", "humanZ"],
  floor: { holder: "humanZ", expectedNext: ["humanZ"], transition: "held" },
} as ConversationObserverResult;
assert.ok(
  observationRosterConflicts(b8Raw, roster).length > 0,
  "the raw model output really does name an off-roster actor",
);
{
  const b8Records: any[] = [
    { sessionId: "b8-test", anchorSeq: 1, stateAfter: priorState, ledgerStateAfter: initial },
  ];
  const b8Messages = [1, 4].map((seq) => ({
    seq,
    senderRole: "humanX",
    content: seq === 1 ? "Compare A and B" : "and what do you make of that?",
  }));
  const bq8 = (value: unknown) => ({
    sort() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => value,
  });
  let b8ParseCalls = 0;
  const oldMode8 = config.conversationObserverMode;
  const oldKey8 = config.openaiApiKey;
  try {
    config.conversationObserverMode = "active";
    config.openaiApiKey = "test-no-network";
    mock.method(
      Message,
      "find",
      (filter: any) => bq8(b8Messages.filter((m) => m.seq <= filter.seq.$lte)) as any,
    );
    mock.method(Participant, "find", () => bq8([{ role: "humanX" }, { role: "humanY" }]) as any);
    mock.method(
      ConversationObservation,
      "findOne",
      (filter: any) =>
        bq8(
          [...b8Records]
            .reverse()
            .find(
              (r) =>
                r.anchorSeq < filter.anchorSeq.$lt &&
                (!filter.stateAfter || r.stateAfter) &&
                (!filter.ledgerStateAfter || r.ledgerStateAfter),
            ),
        ) as any,
    );
    mock.method(ConversationObservation, "updateOne", async (filter: any, update: any) => {
      let record = b8Records.find((item) => item.anchorSeq === filter.anchorSeq);
      if (!record) {
        record = { ...filter };
        b8Records.push(record);
      }
      Object.assign(record, update.$set);
      return {} as any;
    });
    mock.method(Responses.prototype, "parse", (async () => {
      b8ParseCalls++;
      return {
        model: "test",
        output_parsed: {
          ...observation,
          ...quiet,
          addressees: ["alex", "humanZ"],
          floor: { holder: "humanZ", expectedNext: ["humanZ"], transition: "held" },
        },
      };
    }) as any);
    const b8Result = await enqueueConversationObservation({
      sessionId: "b8-test",
      anchorSeq: 4,
      conversationEpoch: 4,
      explicitAlexDefer: false,
    });
    assert.equal(
      b8ParseCalls,
      1,
      "an off-roster actor the normalizer strips costs one model call, not two",
    );
    assert.equal(
      b8Records.find((r) => r.anchorSeq === 4)?.observerReviewed,
      false,
      "and does not send the turn through the review path",
    );
    assert.deepEqual(
      b8Result?.observation.addressees,
      ["alex"],
      "the off-roster actor is filtered out",
    );
    assert.equal(
      b8Result?.ledgerStateAfter?.degradedMode,
      false,
      "an already-repaired output is not a material contradiction and must not degrade the controller",
    );
    assert.ok(
      (b8Result?.repairCodes ?? []).some((code: string) =>
        code.startsWith("roster_conflicts_normalized:"),
      ),
      "the raw conflict stays visible in the audit as a repair",
    );
  } finally {
    mock.restoreAll();
    config.conversationObserverMode = oldMode8;
    config.openaiApiKey = oldKey8;
  }
}

// A thread that requires Alex does not by itself trigger a second observation,
// and an unresolved conflict still does. Both directions are checked.
const b8ParticipationRequired = b8Normalize({
  activeThread: { ...observation.activeThread!, alexParticipation: "required" },
});
assert.equal(
  conversationObserverReviewReason(b8ParticipationRequired, []),
  null,
  "a thread requiring Alex is not by itself a contradiction worth a second call",
);
assert.equal(
  conversationObserverReviewReason(b8ParticipationRequired, ["something_unresolved"]),
  "unresolved_conflict",
);

// ─────────────────────────────────────────────────────────────────────────────
// The output check must see what the message actually shared. A failed extraction
// must never read as "nothing was shared", or every check would pass. This runs
// the real generation path, so it fails if the wiring stops using the rule-based
// matcher.
// ─────────────────────────────────────────────────────────────────────────────
{
  const d2Draft =
    "Noting those additions, my notes for Candidate A still list: matches\u2014very good at recognizing dangerous situations, good overview of complex contexts, excellent spatial awareness, very well organized; misses\u2014unfriendly and transmits restlessness. From my perspective, the new comments about not tolerating criticism, being a show-off, or not open to new ideas align with the pattern that A\u2019s interpersonal misses are consistent but do not add new confirmed operational strengths.";
  const oldKeyD2 = config.openaiApiKey;
  let d2Calls = 0;
  try {
    config.openaiApiKey = "test-no-network";
    mock.method(Responses.prototype, "parse", (async () => {
      d2Calls++;
      return { model: "test", output_parsed: { content: d2Draft } };
    }) as any);
    const generated = await generateScopedRouteMessage({
      systemPrompt: "system",
      userPrompt: "user",
      limits: { maxOutputTokens: 600, maxContentChars: 2400, timeoutMs: 45_000 } as any,
      guard: { candidate: "A", allowedTraitIds: ["A_p1"], reason: "focus_depth" },
      previouslySurfacedTraitIds: [],
      logContext: "d2-test",
    });
    const d2Initial = generated.repairAudit?.attempts.find((a) => a.stage === "initial");
    assert.ok(
      (d2Initial?.extractedTraitIds ?? []).length > 5,
      "the guard sees the traits the message really discloses, without a model call",
    );
    assert.deepEqual(
      d2Initial?.violations,
      ["trait_outside_selected_contribution"],
      "and records the violation rather than accepting on empty evidence",
    );
    assert.equal(
      generated.result.ok,
      false,
      "a draft reciting the board is rejected instead of passing on empty evidence",
    );
    assert.match(
      String((generated.result as any).error ?? ""),
      /trait_outside_selected_contribution/,
      "and it is rejected for saying what it was not permitted to say, not for something incidental",
    );
    assert.equal(d2Calls, 2, "one draft plus one repair attempt; extraction adds no model call");
  } finally {
    mock.restoreAll();
    config.openaiApiKey = oldKeyD2;
  }
}

console.log(
  "[conversation-recovery] semantic authority, lifecycle, generation, observer failure recovery and burst supersession passed",
);
