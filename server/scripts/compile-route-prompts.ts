// Builds the runtime prompt file from the blocks in `src/prompts/blocks/`.
//
// Every route of a condition gets the same prompt text: the blocks below,
// joined in this order. Run with `npm run prompts:compile` after editing a block.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  common,
  conditionBehavioral,
  conditionRefinements,
  routeContracts,
} from "../src/prompts/blocks/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const snapshotPath = resolve(serverDir, "src/prompts/route-prompts.json");

const requiredCommon = [
  "taskEnvironment",
  "instructionPriority",
  "internalControlDiscipline",
  "outputDiscipline",
  "unifiedInteractionPolicy",
  "buildOnConversationPolicy",
] as const;
for (const key of requiredCommon) {
  if (typeof common[key] !== "string" || !common[key].trim()) {
    throw new Error(`Missing common.${key}`);
  }
}

const prompts: Record<string, unknown> = {};
for (const [condition, routes] of Object.entries(routeContracts)) {
  if (!["C1", "C2", "C3", "C4"].includes(condition)) {
    throw new Error(`Unknown condition in route source: ${condition}`);
  }
  const behavioral = conditionBehavioral[condition];
  if (!behavioral?.trim()) throw new Error(`Missing behavioral block for ${condition}`);
  const refinement = conditionRefinements[condition];
  if (typeof refinement !== "string" || !refinement.trim()) {
    throw new Error(`Missing behavioral refinement for ${condition}`);
  }
  for (const [routeKind, routeContract] of Object.entries(routes)) {
    // A route contract is not added to the prompt text; it only lists the
    // routes a condition has. An empty one is a mistake in the source.
    if (typeof routeContract !== "string" || !routeContract.trim()) {
      throw new Error(`Empty route contract: ${condition}.${routeKind}`);
    }
    const promptKey = `${condition}.${routeKind}`;
    const prompt = [
      common.taskEnvironment,
      common.instructionPriority,
      behavioral,
      refinement,
      common.buildOnConversationPolicy,
      common.internalControlDiscipline,
      common.outputDiscipline,
      common.unifiedInteractionPolicy,
    ]
      .map((block) =>
        block
          .replaceAll("Route Contract", "Turn Metadata")
          .replaceAll("route contract", "turn metadata"),
      )
      .join("\n\n");
    prompts[promptKey] = {
      condition,
      routeKind,
      hash: createHash("sha256").update(prompt).digest("hex"),
      prompt,
    };
  }
}

if (Object.keys(prompts).length !== 30) {
  throw new Error(`Expected 30 prompt snapshots, received ${Object.keys(prompts).length}.`);
}

writeFileSync(snapshotPath, `${JSON.stringify({ prompts }, null, 2)}\n`, "utf8");
console.log(`Compiled ${Object.keys(prompts).length} route keys from four condition prompts.`);
