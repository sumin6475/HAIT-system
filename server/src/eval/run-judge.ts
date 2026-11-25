// run-judge.ts: test cases for the rule-based Main Judge (`judgeIntervention`).
// Checks only the three-way decision and its evidence; no Alex message is written.
// Each case is called three times and passes when at least two agree. Any failure
// exits with code 1.
import "dotenv/config"; // loads OPENAI_API_KEY from server/.env
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { judgeIntervention } from "../lib/interventionJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JudgeCase {
  id: string;
  desc: string;
  msgs_since_alex: number;
  context: { speaker: string; text: string }[];
  signal: {
    focusCandidate: "A" | "B" | "C" | "D" | null;
    exchangeClass: "substantive" | "acknowledgment" | "preference" | "procedural" | "unclear";
    privateContributionIds: string[];
  };
  expect: {
    decision: "contribute" | "acknowledge" | "silent";
    evidence?: string;
    selectedTraitId?: string | null;
  };
}
interface JudgeFile {
  cases: JudgeCase[];
}

// ── Environment check ──────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error("[judge] OPENAI_API_KEY not set — check server/.env");
  process.exit(1);
}

// ── Load cases ─────────────────────────────────────────────────
const FIXTURE_PATH = resolve(__dirname, "judge_cases.yaml");
const doc = yaml.load(readFileSync(FIXTURE_PATH, "utf8")) as JudgeFile;

const RUNS = 3; // three calls per case smooth out model variation; two matches pass
console.log(
  `\n[judge] ${doc.cases.length} cases × ${RUNS} = ${doc.cases.length * RUNS} mini calls (gpt-4o-mini, temp 0)\n`,
);

// ── Run ────────────────────────────────────────────────────────
let passed = 0;
for (const c of doc.cases) {
  const transcript = c.context.map((m) => ({ speaker: m.speaker, content: m.text }));

  const results: ({
    decision: "contribute" | "acknowledge" | "silent";
    evidence: string;
    selectedTraitId?: string | null;
  } | null)[] = [];
  for (let r = 0; r < RUNS; r++) {
    const decision = await judgeIntervention(transcript, c.msgs_since_alex, {
      ...c.signal,
      privateContributionAvailable: c.signal.privateContributionIds.length > 0,
    });
    results.push(decision);
  }

  // A null result (parse failure or timeout) does not match. The decision is always
  // compared; evidence and trait only when the case sets them.
  const matches = results.filter(
    (d) =>
      d != null &&
      d.decision === c.expect.decision &&
      (c.expect.evidence === undefined || d.evidence === c.expect.evidence) &&
      (c.expect.selectedTraitId === undefined ||
        (d.selectedTraitId ?? null) === c.expect.selectedTraitId),
  ).length;
  const pass = matches >= 2;
  if (pass) passed++;

  const got = results
    .map((d) => (d == null ? "null" : `${d.decision}:${d.evidence}:${d.selectedTraitId ?? "none"}`))
    .join(" ");
  const want =
    `decision=${c.expect.decision}` +
    (c.expect.evidence ? ` evidence=${c.expect.evidence}` : "") +
    (c.expect.selectedTraitId !== undefined
      ? ` selected=${c.expect.selectedTraitId ?? "none"}`
      : "");
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(3)} ${c.desc}`);
  console.log(`        want ${want} · got [${got}] (${matches}/${RUNS})`);
}

// ── Summary ────────────────────────────────────────────────────
const total = doc.cases.length;
console.log(`\n[judge] ${passed}/${total} passed.\n`);
if (passed < total) process.exit(1);
