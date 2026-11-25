# Architecture

What the system is made of, what runs when, and why the main design choices
were made. [CONTEXT.md](CONTEXT.md) defines the vocabulary used here. Where this
file and the code disagree, the code is right.

---

## 1. The experiment, as far as the code needs it

Three participants discuss four airline-captain candidates and pick one. Two
are human; the third, **Alex**, is the AI participant under study. Forty traits
exist, ten per candidate, and each participant is dealt a 24-trait **profile**:
X, Y or Z. Alex always holds Z.

| Candidate | Traits | Shared by all three profiles | Score from shared traits | Score from all forty |
| --------- | ------ | ---------------------------- | ------------------------ | -------------------- |
| A         | 10     | 4                            | +4                       | −2                   |
| B         | 10     | 4                            | +4                       | −2                   |
| C         | 10     | 4                            | −2                       | **+4**               |
| D         | 10     | 4                            | +4                       | −2                   |

Each profile holds 24 traits, 8 of them unique to it. **C is the pooled answer,
and the shared traits rank it last.** Any measure that reads the board as merit
is therefore upside down until unshared traits arrive, which is why nothing in
the controller treats the board's score as a ranking (§4.6).

Four AI conditions cross role with communication strategy; CTRL has three humans
and no AI, and every AI code path checks for it and returns early.

|              | XAI (explains) | SAI (asks; code label `aci`) |
| ------------ | -------------- | ---------------------------- |
| **Member** (`peer`)  | C1     | C3                           |
| **Chair** (`leader`) | C2     | C4                           |

**Condition orthogonality** is the property every part of the system keeps:
conditions differ only in what is manipulated. The facts a turn may share, the
trait matchers, the board, the pacing rules, and the decision of when Alex may
speak are the same in every condition. The role reaches the Judge as a goal
(what to do), never as timing (when to speak).

---

## 2. Processes and models

```
client/   React + Vite + Tailwind      → :8080   participant screens, researcher dashboard
server/   Express + Socket.IO + tsx    → :3001
            ├── MongoDB (Mongoose)
            └── OpenAI-compatible gateway (U-M GPT Toolkit)
```

`server/src/index.ts` is the only entry point. It connects to MongoDB, mounts
the REST routers, attaches Socket.IO, and registers the socket handlers. There
is no queue, worker or cron: everything happens inside the handler for a human
message, or on a timer that handler starts.

| Stage                       | Model        | Output cap* | Time limit | Code                              |
| --------------------------- | ------------ | ----------- | ---------- | --------------------------------- |
| Observer (interpretation)   | gpt-5-mini   | 3,424       | 15 s       | `lib/conversationObserver.ts`     |
| Judge (turn decision)       | gpt-5-mini   | 1,724       | 20 s       | `lib/interventionJudge.ts`        |
| Message writer              | gpt-5-mini   | 1,624       | 45 s       | `lib/routeScopedGeneration.ts`    |
| Trait verifier              | gpt-4o-mini  | 500         | 8 s        | `lib/poolingExtractor.ts`         |

\*gpt-5-mini caps include 1,024 tokens of reasoning room. Reasoning models are
called with minimal reasoning effort and no temperature; the verifier uses
temperature 0 (`lib/openai.ts` `modelRequestParams`).

### Collections

| Collection                 | Written by                                   |
| -------------------------- | -------------------------------------------- |
| `Session`                  | sockets, seq, pooling, engine, routes        |
| `Participant`              | sockets, routes                              |
| `Message`                  | sockets, route turn, engine                  |
| `AIIntervention`           | engine, route turn                           |
| `ConversationObservation`  | Observer, engine                             |

`ConversationObservation` is working memory, not only a log: each turn the
Observer reads the previous row's state back before it interprets the newest
message.

---

## 3. What happens when a human sends a message

`sockets/index.ts`, `send-message`, in order. Everything after the broadcast is
off the path participants see.

```
 1  validate (non-empty, ≤ 2000 characters)
 2  hold the session's write turn
 3  give out the next sequence number (and conversation epoch), atomically
 4  save the message
 5  broadcast it                           ← participants see it here
 6  note the arrival (may cancel or queue Alex's pending turn)
 7  rule-based trait matching              synchronous, no network
 8  in the background:
      a  write accepted traits to the board; release the write turn
      b  send near matches to the verifier (model call)
      c  write verified traits to the board
 9  queue the Observer (one at a time per session)
10  decide whether Alex speaks (§4)
```

Participants never wait for trait accounting. The rule-based matcher cannot
time out, so its result is ready at step 7; the verifier's correction lands when
it lands. The decision in step 10 is given the fast trait ids directly, because
the board write in 8a may not have finished.

---

## 4. How Alex decides to speak

`lib/interventionEngine.ts` keeps one in-memory state per session. The parts
that must survive a restart are stored in `Session.aiState` and read back on
start-up.

### 4.1 Controller modes

`CONVERSATION_CONTROLLER_MODE` selects one of three; `ledger_active` is the
default and the mode the study uses.

| Mode            | Behaviour                                                              |
| --------------- | ---------------------------------------------------------------------- |
| `ledger_active` | The ledger Judge decides; the pacing vetoes apply.                      |
| `ledger_shadow` | The ledger runs and is stored; speech uses the rule-based path.         |
| `rule_based`    | Rule-based routing only (`lib/interventionRouting.ts`). Comparison mode. |

In `ledger_active`, a turn whose observation cannot be obtained, even after one
re-observation, stays silent.

### 4.2 The ledger path

```
onHumanMessage
  ├ superseded by a newer human message?        → drop
  ├ Alex busy writing?                            → queue; re-evaluate afterwards
  ├ wait for the Observer's reading               (gpt-5-mini)
  ├ update the Chair's mediation latch
  └ judge the turn
        ├ fold the reading into the ledger        threads, opportunities, floor (program rules)
        ├ pacing veto before the Judge            human floor held | cooldown
        └ Judge                                   act + evidence + facts + brief
             → reserve the turn (floor pause), then write, check and broadcast
```

Reserving a turn starts a short **floor pause** (2–3 s) with the typing
indicator on. The message is written during the pause, but nothing is saved or
sent until it ends, and a newer human message during the pause cancels the
turn. After the pause the turn is committed; a human message arriving then is
held and evaluated once the reply is out. Two Alex turns in a row are therefore
impossible by construction.

### 4.3 Pacing

- **Cooldown**: after Alex speaks, at least two human messages must arrive
  before a voluntary turn. A question addressed to Alex, and taking up a direct
  answer to Alex's own question, may speak through it.
- **Human floor**: when the conversation expects a particular human to speak
  next, Alex waits. One function (`floorHeldForDecisions`) answers this for
  every reader.
- **Long silence**: after 60 s of silence (and at least two human messages
  since Alex last spoke), Alex may re-enter; at most three times per session,
  five minutes apart.

These rules read the transcript, never the condition.

### 4.4 Opportunities

The ledger turns what the Observer read into **opportunities**: openings for
Alex to speak.

- A **request** (a direct question, an invitation, or a request to the group)
  is somebody asking Alex for something. It stays takeable until it is
  answered, superseded by Alex answering later on the same thread, the thread
  closes, or it expires. Only a question addressed to Alex is `required`; a
  required opportunity bypasses the cooldown, never expires, and the Judge may
  not stay silent on one opened by the current message.
- A proposal opens a request only when the Observer marked it an explicit
  request; an opinion opens nothing (`proposalOpensRequest`).
- An **uptake** is not a request: it exists while a human's reply to Alex is
  the current message, and lets Alex carry that reply one step further.

The Judge sees only the opportunities it may actually take
(`conversationLedgerDecisionProjection`), so the prompt never offers a choice validation would
reject. Unanswered requests are listed oldest first, because a request outranks
any act Alex chooses for itself.

### 4.5 The Judge

The Judge reads the full transcript, the ledger, the moves available this turn,
Alex's eligible unsaid facts, and a **role goal** for Member or Chair. It
returns:

- an **act**: answer, participate, follow, contribute, acknowledge, and for the
  Chair also `mediate` and `recap` (a Member's schema cannot express those two);
- the message numbers it rests on;
- the exact trait ids the turn may share (`discloseTraitIds`), which may be
  empty;
- a one-sentence **brief** for the message writer.

It is also told, as facts beside the opportunities:

- which human messages have arrived since Alex last spoke: what the turn
  replies to;
- Alex's own read of the candidates, as an order with no numbers, computed from
  Alex's card plus the board (every condition);
- which candidates Alex has nothing further to say about (every condition);
- for the Chair only, which candidates no human has yet brought their own notes
  on (`leaderCoverageNote`).

The Judge never sees a counter of time or messages: a counter reads as a budget,
and a role-dependent budget would change when Alex speaks by condition.

A decision that breaks a rule is retried once with the broken rules and the
eligible ids named; if the retry still fails, the turn is silent.

### 4.6 The candidate list (Chair)

A candidate leaves the list when a **human** has put on the board a trait about
it that Alex does not hold. Alex's own disclosures never move the list, because
Alex holds six traits per candidate and could otherwise clear it alone. Coverage
and score are worked out beside it and decide nothing; the list measures
attention, not merit. It reaches only the Chair's Judge and mediation writer,
as a sentence without numbers.

### 4.7 The Chair's recap and mediation

- **Recap** puts the board back in front of the group, built from the board with
  no model call. It is offered when the condition is a Chair's, the board has
  something on it, the Chair has not recapped yet, and the cooldown is open.
- **Mediation** is offered when the discussion has circled one or two
  candidates, gone over the same ground, or moved to settle early
  (`updateMediationState`, a latch that lapses after 3 minutes or 8 human
  messages). It names a direction (a candidate or a gap), never a trait.

Both are voluntary acts, so both wait for the cooldown. Neither is scheduled by
a clock.

### 4.8 Other ways Alex speaks

| Route         | Source                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| greeting      | fixed line at session start (Chair opens the agenda; Member only greets) |
| long_silence  | silence timer (§4.3)                                                    |
| closing       | discussion deadline or researcher; Chair recaps and hands over, Member sends a fixed line |
| summary       | the Chair's recap act                                                   |

---

## 5. Writing one message

`lib/routeTurn.ts` → `lib/routeContext.ts` → `lib/routeScopedGeneration.ts`.

### 5.1 Three layers

| Role      | Content                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| system    | the fixed condition prompt (`src/prompts/route-prompts.json`)                            |
| developer | server-written context for this turn: situation, act, evidence, request scope, the named facts and the brief |
| user      | the complete transcript and a request for Alex's next message                            |

Keeping participant text in its own layer stops transcript text from passing
as server instructions.

The condition prompts are compiled from `src/prompts/blocks/`: six blocks shared
by all four conditions, plus a behavioral block and a refinement block per
condition. Every route of a condition uses the same prompt text; the server
checks each prompt's SHA-256 hash at start-up.

### 5.2 Output checks

Every draft is checked before it is sent:

- **Facts**: the message may introduce only the traits the Judge named; when the
  Judge named exactly one, the message must say it. Traits the person being
  answered just said are exempt (repeating them is taking up what was said).
- **Questions**: in the XAI conditions (C1, C2) the message may not end with a
  question mark.
- **Internal text**: no leaked labels or internal block names.

A failed draft gets one rewrite, told the violation and every limit in force. If
the rewrite also fails, the turn is silent. Greetings, summaries, closings and
complete-list answers are built from the board in fixed formats and skip the
model.

---

## 6. Trait accounting

| Set                     | Meaning                                          | Used for                                      |
| ----------------------- | ------------------------------------------------ | --------------------------------------------- |
| `byCandidate.*.revealedIds` / `humanConfirmedIds` | traits a human put in view | the board, the candidate list, measures |
| `aiSurfacedIds`         | traits Alex put in view                          | avoiding repetition, Alex's pooling measure   |
| `firstBy`               | who first put each trait in view, and at which message | telling contribution from repetition |
| `Message.sharedInfoIds` | traits one message put in view                   | the per-message record                        |

Human and Alex sets are kept apart: Alex's contribution is a measure of its own.
Matching is deterministic first (`extractHumanTraitsFast`, phrases in
`traitKeywordRegistry`), and only near matches go to the verifier. Two traits
share identical wording ("Is considered arrogant", B and D), so they count only
when the sentence says which candidate is meant.

Alex's traits are written to the board only after its message is broadcast, so
a turn that is cancelled or fails leaves the board untouched.

These runtime tags support the conversation. They are not a substitute for
reviewed behavioural coding.

---

## 7. Configuration

| Variable                       | Default         | Effect                                   |
| ------------------------------ | --------------- | ---------------------------------------- |
| `MONGODB_URI`                  | required        |                                          |
| `OPENAI_API_KEY` / `OPENAI_API_BASE` | required  | U-M GPT Toolkit gateway                  |
| `ADMIN_TOKEN`                  | required        | `x-admin-token` on every admin route     |
| `PORT`                         | 3001            |                                          |
| `CORS_ORIGIN`                  | all             | comma-separated                          |
| `CONVERSATION_CONTROLLER_MODE` | `ledger_active` | §4.1                                     |
| `CONVERSATION_OBSERVER_MODE`   | `active`        | `shadow` stores readings without steering |
| `HAIT_GUARD_*`                 | on              | comparison-run switches (`lib/guardFlags.ts`); any that are off are printed at start-up |

Timing values live in `server/src/config/triggers.ts`. The discussion length
there must equal `client/src/lib/sessionConfig.ts`.

---

## 8. Tests

| Command                              | Checks                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `npm run test:conversation-ledger`   | the ledger reducer, opportunity rules, Judge inputs and validation |
| `npm run test:conversation-recovery` | Observer normalisation, recovery, generation and supersession |
| `npm run test:pooling-extractor`     | the rule-based trait matcher                                  |
| `npm run test:seq`                   | atomic sequence numbers (needs MongoDB)                       |
| `npx tsc --noEmit`                   | types                                                        |

Model test cases (call the live model): `judge:cases`, `judge:rules`,
`observer:cases`, `eval:followup`.
