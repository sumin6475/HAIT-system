import { Session } from "../models/Session.js";

// Hands out each session's message sequence numbers, one higher each time.
// MongoDB's $inc changes one document atomically, so two calls at the same
// moment can never receive the same number.
export async function allocSeq(sessionId: string): Promise<number> {
  const s = await Session.findByIdAndUpdate(
    sessionId,
    { $inc: { seqCounter: 1 } },
    { returnDocument: "after", projection: { seqCounter: 1 } },
  ).lean();
  if (!s) throw new Error(`allocSeq: session ${sessionId} not found`);
  return (s as { seqCounter: number }).seqCounter;
}

export async function allocHumanSeq(sessionId: string): Promise<{
  seq: number;
  conversationEpoch: number;
}> {
  const session = await Session.findByIdAndUpdate(
    sessionId,
    {
      $inc: {
        seqCounter: 1,
        "aiState.conversationEpoch": 1,
      },
    },
    {
      returnDocument: "after",
      projection: { seqCounter: 1, "aiState.conversationEpoch": 1 },
    },
  ).lean();
  if (!session) throw new Error(`allocHumanSeq: session ${sessionId} not found`);
  const value = session as { seqCounter: number; aiState?: { conversationEpoch?: number } };
  return {
    seq: value.seqCounter,
    conversationEpoch: value.aiState?.conversationEpoch ?? 0,
  };
}
