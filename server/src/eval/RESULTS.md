# Model evaluation results

Results of the model test cases in this folder.

## Conditions

- Run on 2026-11-25, once.
- Test data: synthetic messages (see the case files in this folder).
- API: OpenAI, called directly (`https://api.openai.com/v1`). The study itself
  used the U-M GPT Toolkit gateway with the same model names.
- Each case is called three times; a case passes when at least two of the three
  answers match the expected one.

| Command                  | What it tests              | Model       | Cases |
| ------------------------ | -------------------------- | ----------- | ----- |
| `npm run observer:cases` | Observer                   | gpt-5-mini  | 9     |
| `npm run judge:rules`    | Rule-based Main Judge      | gpt-5-mini  | 7     |
| `npm run judge:cases`    | Ledger Judge (with Observer) | gpt-5-mini | 5    |
| `npm run eval:followup`  | Follow-up judge            | gpt-4o-mini | 116   |

## Results

| Command          | Result                                                     | Failed cases                     |
| ---------------- | ---------------------------------------------------------- | -------------------------------- |
| `observer:cases` | 8 / 9 passed                                               | O7                               |
| `judge:rules`    | 6 / 7 passed                                               | J5                               |
| `judge:cases`    | 3 / 5 passed                                               | UJ3, UJ4                         |
| `eval:followup`  | recall 14 / 19 (target ≥ 12: met); false "yes" 6 / 87 (target ≤ 5: not met) | see below |

Failed cases:

- **O7**: a question to a named human was read as also addressed to Alex.
- **J5**: a short exchange between the humans was answered with `acknowledge`
  instead of silence (all three calls).
- **UJ3**: a human answer to Alex's own question was treated as a direct question.
- **UJ4**: one of the three calls returned a Judge error; the other two chose
  different acts.
- **Follow-up**, missed "yes": F003, F046, F049, F070, F089.
  False "yes": F014, F016, F061, F071, F094, F116 (F071, F094 and F116 in all
  three calls).

## Limitations

- The case sets are small (5 to 9 cases for the Observer and Judge), so one case
  moves the pass rate by 10 to 20 percentage points.
- The follow-up labels were assigned by one person; there is no agreement measure.
- One run only; results near the threshold may change between runs, and the
  model snapshot behind each model name is not fixed.
- These are starting test sets, not a full evaluation of the system.
