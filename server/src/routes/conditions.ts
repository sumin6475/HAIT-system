// Admin API for conditions (read only).
//
// Endpoints:
//   GET  /api/conditions           every condition's prompts
//   POST /api/conditions/test-chat one Alex reply for the dashboard's test chat
// Every request needs the x-admin-token header; participants never reach these.
//
// The prompts come from the same compiled file the live sessions use.

import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth.js";
import type { ConditionCode, RouteKind } from "../types.js";
import { getRoutePrompt, getRoutePromptRegistryView } from "../lib/routePromptRegistry.js";
import { buildRouteUserContext } from "../lib/routeContext.js";
import { transcriptLabel } from "../lib/labels.js";
import { routeGenerationLimits } from "../lib/routeTurn.js";
import {
  extractHumanTraitsFast,
  extractSurfacedTraits,
  verifyHumanTraitCandidates,
} from "../lib/poolingExtractor.js";
import { TRAIT_BY_ID } from "../lib/traitData.js";
import { generateScopedRouteMessage } from "../lib/routeScopedGeneration.js";

export const conditionsRouter = Router();

conditionsRouter.get("/", requireAdmin, async (_req, res) => {
  res.json(getRoutePromptRegistryView());
});

// POST /api/conditions/test-chat: one Alex reply for the dashboard's test chat.
// Separate from the session path.
conditionsRouter.post("/test-chat", requireAdmin, async (req, res) => {
  const { conditionCode, routeKind, transcript } = req.body as {
    conditionCode?: ConditionCode;
    routeKind?: RouteKind;
    transcript?: { sender: string; content: string; assignedProfile?: "X" | "Y" | "Z" }[];
  };

  // CTRL has no AI participant.
  if (!conditionCode || conditionCode === "CTRL") {
    return res.status(400).json({ error: "Valid AI conditionCode (C1-C4) required" });
  }
  if (!Array.isArray(transcript)) {
    return res.status(400).json({ error: "transcript array required" });
  }
  if (!routeKind) {
    return res.status(400).json({ error: "routeKind required" });
  }

  try {
    const resolved = getRoutePrompt(conditionCode, routeKind);
    const messages = transcript.map((message, index) => ({
      seq: index + 1,
      senderRole: message.sender,
      speaker: transcriptLabel(message.sender as any),
      content: message.content,
    }));
    const extractedByMessage = await Promise.all(
      transcript.map(async (message, index) => ({
        index,
        sender: message.sender,
        ids: await (message.sender === "ai"
          ? extractSurfacedTraits(message.content)
          : (() => {
              const fast = extractHumanTraitsFast({
                messageText: message.content,
                assignedProfile: message.assignedProfile,
              });
              return verifyHumanTraitCandidates({
                messageText: message.content,
                candidates: fast.verificationCandidates,
              }).then((verified) => [...new Set([...fast.acceptedIds, ...verified.ids])]);
            })()),
      })),
    );
    const humanSurfacedIds = [
      ...new Set(
        extractedByMessage
          .filter((message) => message.sender !== "ai")
          .flatMap((message) => message.ids),
      ),
    ];
    const aiSurfacedIds = [
      ...new Set(
        extractedByMessage
          .filter((message) => message.sender === "ai")
          .flatMap((message) => message.ids),
      ),
    ];
    const byCandidate: Record<string, { revealedIds: string[] }> = {
      A: { revealedIds: [] },
      B: { revealedIds: [] },
      C: { revealedIds: [] },
      D: { revealedIds: [] },
    };
    for (const id of humanSurfacedIds) {
      const candidate = TRAIT_BY_ID.get(id)?.candidate;
      if (candidate) byCandidate[candidate].revealedIds.push(id);
    }
    const lastSingleCandidateHuman = [...extractedByMessage].reverse().find((message) => {
      if (message.sender === "ai") return false;
      const candidates = new Set(
        message.ids.map((id) => TRAIT_BY_ID.get(id)?.candidate).filter(Boolean),
      );
      return candidates.size === 1;
    });
    const lastCandidate = lastSingleCandidateHuman
      ? TRAIT_BY_ID.get(lastSingleCandidateHuman.ids[0]!)?.candidate
      : undefined;
    const context = buildRouteUserContext({
      routeKind,
      conditionCode,
      messages,
      revealStats: {
        byCandidate,
        humanConfirmedIds: humanSurfacedIds,
        aiSurfacedIds,
        lastHumanDiscussion: lastCandidate
          ? { candidate: lastCandidate, seq: lastSingleCandidateHuman!.index + 1 }
          : undefined,
      },
      anchorSeq: messages.at(-1)?.seq ?? 0,
    });
    const deterministicModel =
      context.requestIntent.kind === "known_count_request"
        ? "server-deterministic-known-count"
        : "server-deterministic-peer-complete";
    const generated = context.deterministicResponse
      ? {
          result: {
            ok: true as const,
            parsed: { content: context.deterministicResponse },
            requestId: deterministicModel,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            systemFingerprint: null,
            model: deterministicModel,
          },
        }
      : await generateScopedRouteMessage({
          systemPrompt: resolved.systemPrompt,
          userPrompt: context.userPrompt,
          limits: routeGenerationLimits(routeKind, context.requestIntent),
          guard: context.outputScopeGuard,
          previouslySurfacedTraitIds: [...new Set([...humanSurfacedIds, ...aiSurfacedIds])],
          logContext: `route=${routeKind} anchor=${messages.at(-1)?.seq ?? 0} source=admin_test_chat`,
        });
    const result = generated.result;

    if (!result.ok) {
      return res.status(502).json({ error: `AI call failed: ${result.reason}` });
    }

    return res.json({
      content: result.parsed.content,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      promptKey: resolved.promptKey,
      outputScopeRepaired: Boolean(generated.scopeRepair),
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});
