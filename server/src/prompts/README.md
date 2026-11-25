# Route prompts

`blocks/` is the editable source of Alex's system prompts, one file per block.

| Block                                   | Used by                 |
| --------------------------------------- | ----------------------- |
| `common.task-environment.ts`            | all four conditions     |
| `common.instruction-priority.ts`        | all four conditions     |
| `c1..c4.behavioral.ts`                  | one condition each      |
| `c1..c4.refinement.ts`                  | one condition each      |
| `common.build-on-conversation-policy.ts`| all four conditions     |
| `common.internal-control-discipline.ts` | all four conditions     |
| `common.output-discipline.ts`           | all four conditions     |
| `common.unified-interaction-policy.ts`  | all four conditions     |

The compiler joins the blocks in the order above into one prompt per condition.
`route-contracts.ts` only lists each condition's routes; it is not added to the
prompt text. Members (C1, C3) have six routes; Chairs (C2, C4) also have
mediation, summary and closing, which gives 30 keys such as `C2.build_on`. Every
route of a condition carries the same prompt text, so the 30 keys hold four
prompts.

`route-prompts.json` is the compiled file the server reads. The server checks
every prompt's SHA-256 hash at start-up and refuses to run if the file was
edited by hand. After editing a block:

```sh
cd server
npm run prompts:compile
```

## How a prompt is used

The condition prompt is sent as the system message and never changes during a
session. For each turn the server adds a developer message (the conversation
situation, the Judge's act and brief, the facts the turn may share, the request
scope and the evidence messages) and a user message holding the full transcript.
Keeping the transcript in its own message stops participant text from passing as
server instructions.

The Observer and the Judge use their own prompts, kept in
`lib/conversationObserver.ts` and `lib/interventionJudge.ts`; they do not use
these blocks.

## Rules the prompts and the code share

- Every MATCH and MISS counts the same. No prompt or server message ranks one
  trait above another or reports a score, ratio or count to participants.
- XAI conditions do not ask questions; this is also checked on each message.
- SAI conditions ask small questions tied to Alex's own point or the reply just
  given. Every condition answers a direct question, and an unclear request is
  answered on its most reasonable reading rather than sent back as a question.
- A Member takes up what was said about the candidates and lets a procedural
  proposal (narrowing, setting a candidate aside) pass; directing the
  discussion is the Chair's move.
- When the server supplies a preference cue, it is the only source of Alex's
  current choice; the prompt never lets Alex pick from its own notes.
