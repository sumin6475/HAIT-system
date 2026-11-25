// Message — one chat message, from a participant or from Alex.

import mongoose from "mongoose";
import type { SenderRole } from "../types.js";

const messageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    // The name shown in the chat.
    sender: { type: String, required: true },

    senderRole: {
      type: String,
      enum: ["humanX", "humanY", "humanZ", "ai"] as SenderRole[],
      required: true,
    },

    content: { type: String, required: true },

    // Order of the message in the session. Given out by the server, one higher
    // than the message before it.
    seq: { type: Number, required: true },

    // The traits this message put in view, as trait ids (for example "C_p6").
    sharedInfoIds: [{ type: String }],
  },
  { timestamps: true },
);

messageSchema.index({ sessionId: 1, seq: 1 });

export const Message = mongoose.model("Message", messageSchema);
