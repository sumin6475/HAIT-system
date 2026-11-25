// Concurrency test for message sequence numbers. Run: npm run test:seq
// Calls allocSeq N times at once on one temporary session; passes when every
// number is distinct and they run 1..N with no gaps.
// Needs a real MongoDB (config.mongodbUri); the temporary session is deleted afterwards.
import mongoose from "mongoose";
import { config } from "../config.js";
import { Session } from "../models/Session.js";
import { allocHumanSeq, allocSeq } from "../lib/seq.js";

import { forceGuardsOnForTest } from "../lib/guardFlags.js";

// A comparison run may switch checks off in `server/.env`. Force them on, so the
// test always runs against the normal behaviour.
forceGuardsOnForTest();

const N = 50;

await mongoose.connect(config.mongodbUri);
const tmp = await Session.create({ sessionCode: `TMP_SEQ_${process.pid}`, conditionCode: "C1" });
const sid = tmp._id.toString();
try {
  const results = await Promise.all(Array.from({ length: N }, () => allocSeq(sid)));
  const distinct = new Set(results).size === N;
  const contiguous = Math.min(...results) === 1 && Math.max(...results) === N;
  console.log(`allocSeq x${N} concurrent: distinct=${distinct} contiguous(1..${N})=${contiguous}`);
  if (!distinct || !contiguous) {
    console.error("FAIL — duplicates or gaps:", [...results].sort((a, b) => a - b).join(","));
    process.exitCode = 1;
  } else {
    console.log("PASS");
  }

  const human = await allocHumanSeq(sid);
  if (human.seq !== N + 1 || human.conversationEpoch !== 1) {
    throw new Error(`unexpected human allocation: ${JSON.stringify(human)}`);
  }
  const secondHuman = await allocHumanSeq(sid);
  if (secondHuman.seq !== N + 2 || secondHuman.conversationEpoch !== 2) {
    throw new Error(`unexpected second human allocation: ${JSON.stringify(secondHuman)}`);
  }
  console.log("conversationEpoch tracking: first=1 second=2");
} finally {
  await Session.deleteOne({ _id: sid });
  await mongoose.disconnect();
}
