import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import type {
  ConditionCode,
  CommunicativeAct,
  Candidate,
  InterventionDecisionStage,
  MainJudgeDecision,
  PriorityRoute,
  RouteKind,
} from "../types.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { Message } from "../models/Message.js";
import { Session } from "../models/Session.js";
import { allocSeq } from "./seq.js";
import { getRoutePrompt } from "./routePromptRegistry.js";
import {
  buildRouteUserContext,
  forbidsQuestionOutput,
  formatDeterministicSummary,
  type RequestIntent,
  type RouteOutputScopeGuard,
  type SelectedOpportunityGenerationContext,
  type TranscriptMessage,
} from "./routeContext.js";
import type { ConversationLedgerState, ReducerTransitionAudit } from "./conversationLedger.js";
import { transcriptLabel } from "./labels.js";
import { extractHumanTraitsFast, verifyHumanTraitCandidates } from "./poolingExtractor.js";
import { updateAiSurfaced } from "./poolingDV.js";
import { contributesToBoard } from "../types.js";
import { log } from "./log.js";
import { allSurfacedIds } from "./informationPools.js";
import {
  generateScopedRouteMessage,
  outputScopeViolation,
  type OutputRepairAudit,
} from "./routeScopedGeneration.js";
import { LEADER_OPENING, PEER_OPENING } from "./fixedLines.js";
import {
  describeConversationSituation,
  waitForConversationObservation,
} from "./conversationObserver.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export interface RouteTurnInput {
  io: IO;
  sessionCode: string;
  sessionId: string;
  conditionCode: ConditionCode;
  routeKind: RouteKind;
  source: string;
  reservationId?: string;
  anchorSeq: number;
  floorMs: number;
  priorityRoute?: PriorityRoute;
  priorityEvidence?: string;
  mainJudgeDecision?: MainJudgeDecision | null;
  judgeEvidence?: string | null;
  /** Exactly what this turn may disclose, named by the Judge. */
  discloseTraitIds?: string[];
  /** The Judge's one-sentence instruction to the writer. */
  judgeBrief?: string;
  decisionStage?: InterventionDecisionStage;
  routeReason?: string;
  mediationLatched?: boolean;
  mediationEvidence?: string[];
  buildOnsSinceMediation?: number;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons";
  mediationFocusCandidate?: Candidate | null;
  postGenerationReevaluation?: boolean;
  requestIntentOverride?: RequestIntent;
  communicativeAct?: CommunicativeAct;
  conversationSituation?: string;
  /** The observation's literal candidate mentions, when the caller already holds them. */
  observedMentionedCandidates?: Candidate[];
  judgeEvidenceSeqs?: number[];
  selectedOpportunity?: SelectedOpportunityGenerationContext;
  onBroadcastSuccess?: (input: { messageSeq: number }) => Promise<{
    stateAfter: ConversationLedgerState;
    transition: ReducerTransitionAudit;
  }>;
  commitGuard?: () => boolean;
  /**
   * Resolves when the conversational floor pause has elapsed. Generation runs
   * during the pause; nothing is persisted or broadcast until this settles, so
   * the participant-visible timing is unchanged.
   */
  floorGate?: Promise<void>;
  /** True when a cancelled turn's audit record has already been written elsewhere. */
  supersededRecordOwnedElsewhere?: () => boolean;
}

export function blocksConsecutiveAITurn(input: {
  lastSenderRole?: string;
  routeKind: RouteKind;
  postGenerationReevaluation?: boolean;
}): boolean {
  return (
    input.lastSenderRole === "ai" &&
    input.routeKind !== "closing" &&
    input.routeKind !== "greeting" &&
    !input.postGenerationReevaluation
  );
}

export interface RouteTurnResult {
  ok: boolean;
  messageId?: string;
  messageSeq?: number;
  response?: string;
  ledgerStateAfter?: ConversationLedgerState;
  ledgerTransition?: ReducerTransitionAudit;
  error?: string;
}

export function routeGenerationLimits(
  routeKind: RouteKind,
  requestIntent?: RequestIntent,
): { maxOutputTokens: number | null; maxContentChars: number | null; timeoutMs: number } {
  if (routeKind === "summary") {
    return { maxOutputTokens: null, maxContentChars: null, timeoutMs: 60_000 };
  }
  if (routeKind === "closing") {
    return { maxOutputTokens: null, maxContentChars: null, timeoutMs: 60_000 };
  }
  // Complete-list turns enumerate every match and miss; the content schema cap
  // rejects oversized output outright, so give these turns room up front
  // instead of losing the turn to a parse failure or a repair loop.
  if (
    requestIntent?.kind === "complete_single_candidate" ||
    requestIntent?.kind === "complete_all_candidates"
  ) {
    return { maxOutputTokens: 600, maxContentChars: 2_400, timeoutMs: 45_000 };
  }
  // Every other turn gets the same room as a complete list. The prompt keeps
  // ordinary turns to one or two sentences, so the extra room only matters when a
  // turn legitimately runs long; without it such a turn would be cut off
  // mid-sentence by the 800-character limit. The 45-second timeout gives a long
  // reply time to finish. Length is set by the prompt, not by a model setting.
  return { maxOutputTokens: 600, maxContentChars: 2_400, timeoutMs: 45_000 };
}

/**
 * The guard the generation call is checked against.
 *
 * It is the list of facts the Judge named for this turn, on every route. A
 * direct answer keeps it too: it is the one limit on which facts a turn may add.
 */
export function routeGenerationGuard(
  _routeKind: RouteKind,
  guard: RouteOutputScopeGuard | undefined,
): RouteOutputScopeGuard | undefined {
  return guard;
}

/**
 * The silence a lost turn is recorded as.
 *
 * Exhausted repair is not an API failure and must not be filed as one: the model
 * answered, the answer broke a bound, and the turn was spent rather than an
 * oversized message broadcast. Everything else keeps its own reason.
 */
export function silenceReasonForGenerationFailure(error: string): string | undefined {
  if (error.startsWith("output_violation_after_repair")) return "output_violation_after_repair";
  if (error.startsWith("output_repair_failed")) return "output_repair_failed";
  return undefined;
}

export function deterministicGreetingContent(conditionCode: ConditionCode): string {
  const leader = conditionCode === "C2" || conditionCode === "C4";
  return leader ? LEADER_OPENING : PEER_OPENING;
}

function defaultCommunicativeAct(routeKind: RouteKind): CommunicativeAct | undefined {
  switch (routeKind) {
    case "address":
      return "answer";
    case "followup":
      return "follow";
    case "build_on":
    case "long_silence":
      return "contribute";
    case "mediation":
      return "mediate";
    case "backchannel":
      return "acknowledge";
    default:
      return undefined;
  }
}

export async function executeRouteTurn(input: RouteTurnInput): Promise<RouteTurnResult> {
  const [session, docs] = await Promise.all([
    Session.findById(input.sessionId).select("revealStats aiState").lean(),
    Message.find({ sessionId: input.sessionId }).sort({ seq: 1 }).lean(),
  ]);
  if (!session) return { ok: false, error: "session_not_found" };
  const lifecycle = (session as any).aiState?.lifecycle ?? "active";
  if (lifecycle !== "active" && input.routeKind !== "closing") {
    return { ok: false, error: "ai_not_active" };
  }

  const last = docs.at(-1);
  if (
    blocksConsecutiveAITurn({
      lastSenderRole: last?.senderRole,
      routeKind: input.routeKind,
      postGenerationReevaluation: input.postGenerationReevaluation,
    })
  ) {
    return { ok: false, error: "anti_double_post" };
  }

  const messages: TranscriptMessage[] = docs.map((message: any) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: transcriptLabel(message.senderRole),
    content: message.content,
  }));
  const observerSnapshot =
    !input.conversationSituation && !["greeting", "summary", "closing"].includes(input.routeKind)
      ? await waitForConversationObservation({
          sessionId: input.sessionId,
          anchorSeq: input.anchorSeq,
        })
      : null;
  const conversationSituation =
    input.conversationSituation ??
    (observerSnapshot ? describeConversationSituation(observerSnapshot) : undefined);
  const prompt = getRoutePrompt(input.conditionCode, input.routeKind);
  const context = buildRouteUserContext({
    routeKind: input.routeKind,
    conditionCode: input.conditionCode,
    messages,
    revealStats: (session as any).revealStats,
    anchorSeq: input.anchorSeq,
    judgeEvidence: input.judgeEvidence,
    // Every route carries the facts the Judge named. A request such as "list what
    // you have on C" is the turn that most needs to share facts, and it is not a
    // build_on turn.
    discloseTraitIds: input.discloseTraitIds,
    judgeBrief: input.judgeBrief,
    mediationTrigger: input.mediationTrigger,
    mediationFocusCandidate: input.mediationFocusCandidate,
    mediationEvidence: input.mediationEvidence,
    buildOnsSinceMediation: input.buildOnsSinceMediation,
    requestIntentOverride: input.requestIntentOverride,
    communicativeAct: input.communicativeAct ?? defaultCommunicativeAct(input.routeKind),
    conversationSituation,
    // The task-grounding route branches on this; every other route ignores it.
    // A caller that already awaited the observation passes it, so the route is
    // not made to re-read the raw text for a fact the observation states.
    observedMentionedCandidates:
      input.observedMentionedCandidates ?? observerSnapshot?.observation.mentionedCandidates,
    judgeEvidenceSeqs: input.judgeEvidenceSeqs,
    selectedOpportunity: input.selectedOpportunity,
  });
  const previouslySurfacedTraitIds = [
    ...new Set([
      ...allSurfacedIds((session as any).revealStats),
      ...docs.flatMap((message: any) => message.sharedInfoIds ?? []),
    ]),
  ];
  const generationGuard = routeGenerationGuard(input.routeKind, context.outputScopeGuard);
  const focusDepthAudit = {
    focusCandidate: context.focusDepthState.candidate ?? undefined,
    focusBasis: context.focusDepthState.basis,
    focusHumanConfirmedCount: context.focusDepthState.humanConfirmedCount,
    focusDepthThreshold: context.focusDepthState.threshold,
    focusDirective: context.focusDepthState.directive,
    focusGuarded: generationGuard?.reason === "focus_depth",
  };
  const ledgerControllerAudit = {
    selectedOpportunityId: input.selectedOpportunity?.id,
  };

  const recordGenerationFailure = async (
    error: string,
    model?: string,
    repairAudit?: OutputRepairAudit,
  ) => {
    await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      decision: "stay_silent",
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "generation_failed",
      silenceReason: silenceReasonForGenerationFailure(error),
      promptKey: prompt.promptKey,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      ...focusDepthAudit,
      requestIntentKind: context.requestIntent.kind,
      requestIntentSource: context.requestIntent.source,
      generationSucceeded: false,
      broadcastSucceeded: false,
      ...ledgerControllerAudit,
      repairAudit,
      model,
      error,
    });
  };

  if (input.routeKind === "build_on" && input.judgeEvidence === "relevant_unsurfaced_information") {
    const buildOnTraitId = input.discloseTraitIds?.[0];
    if (!buildOnTraitId || context.outputScopeGuard?.reason !== "selected_note_contribution") {
      await recordGenerationFailure("selected_trait_missing_or_invalid");
      return { ok: false, error: "selected_trait_missing_or_invalid" };
    }
    if (previouslySurfacedTraitIds.includes(buildOnTraitId)) {
      await recordGenerationFailure("selected_trait_no_longer_unsurfaced");
      return { ok: false, error: "selected_trait_no_longer_unsurfaced" };
    }
  }

  // Greeting and summary are fixed-format turns, not free-form generation tasks.
  // Use the strategy-neutral, role-specific opening constants and the exact summary
  // layout so neither can drift or be truncated. Every other route keeps the
  // existing model generation and repair path unchanged.
  const greetingContent =
    input.routeKind === "greeting" ? deterministicGreetingContent(input.conditionCode) : null;
  const summaryContent =
    input.routeKind === "summary"
      ? formatDeterministicSummary((session as any).revealStats, input.conditionCode)
      : null;
  const deterministicContent =
    greetingContent ?? summaryContent ?? context.deterministicResponse ?? null;
  const deterministicModel = greetingContent
    ? "server-deterministic-greeting"
    : summaryContent
      ? "server-deterministic-summary"
      : context.taskGroundingSignal !== "none"
        ? "server-deterministic-task-grounding"
        : context.requestIntent.kind === "known_count_request"
          ? "server-deterministic-known-count"
          : "server-deterministic-peer-complete";
  const generated = deterministicContent
    ? {
        result: {
          ok: true as const,
          parsed: { content: deterministicContent },
          requestId: deterministicModel,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          systemFingerprint: null,
          model: deterministicModel,
        },
      }
    : await generateScopedRouteMessage({
        systemPrompt: prompt.systemPrompt,
        developerPrompt: context.developerPrompt,
        userPrompt: context.transcriptPrompt,
        limits: routeGenerationLimits(input.routeKind, context.requestIntent),
        guard: generationGuard,
        previouslySurfacedTraitIds,
        // The human message this turn answers. Traits Alex repeats back from it are
        // taking up what was said, not sharing something new, and the prompts ask for
        // that.
        repliedToContent: messages.find(
          (message) => message.seq === input.anchorSeq && message.senderRole !== "ai",
        )?.content,
        // Kept apart from `generationGuard`: a turn with no guard must still be checked
        // for this.
        forbidQuestion: forbidsQuestionOutput(input.conditionCode),
        logContext:
          `stage=${input.decisionStage ?? "system"} route=${input.routeKind} ` +
          `reason=${input.routeReason ?? "none"} anchor=${input.anchorSeq} session=${input.sessionCode}`,
      });
  const result = generated.result;
  if (!result.ok) {
    await recordGenerationFailure(result.error, result.model, generated.repairAudit);
    return { ok: false, error: result.error };
  }
  const extractedAiIds = generated.extractedIds;

  const recordSupersededDuringGeneration = async () => {
    await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      decision: "stay_silent",
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "cancelled",
      silenceReason: "superseded_during_generation",
      promptKey: prompt.promptKey,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      ...focusDepthAudit,
      generationSucceeded: true,
      broadcastSucceeded: false,
      ...ledgerControllerAudit,
      repairAudit: generated.repairAudit,
      model: result.model,
    });
  };

  // Hold the finished message until the floor pause is over. Everything after
  // this point — the lifecycle re-read, the second commit check, the seq
  // allocation — runs on the far side of the pause exactly as before.
  if (input.floorGate) await input.floorGate;

  if (input.commitGuard && !input.commitGuard()) {
    if (!input.supersededRecordOwnedElsewhere?.()) await recordSupersededDuringGeneration();
    return { ok: false, error: "superseded_during_generation" };
  }

  // The session may close (deadline or manual) while the model call is running.
  // Check again just before saving, so an ordinary turn never appears after the closing.
  if (input.routeKind !== "closing") {
    const fresh = await Session.findById(input.sessionId).select("aiState.lifecycle").lean();
    if ((fresh as any)?.aiState?.lifecycle !== "active") {
      await AIIntervention.create({
        sessionId: input.sessionId,
        turnIndex: input.anchorSeq,
        triggerReason: input.source,
        decision: "stay_silent",
        routeKind: input.routeKind,
        source: input.source,
        reservationId: input.reservationId,
        anchorSeq: input.anchorSeq,
        decisionStage: input.decisionStage ?? "system",
        routeReason: input.routeReason,
        outcome: "cancelled",
        silenceReason: "lifecycle_changed_during_generation",
        promptKey: prompt.promptKey,
        contextFromSeq: context.contextFromSeq ?? undefined,
        contextToSeq: context.contextToSeq ?? undefined,
        floorMs: input.floorMs,
        ...focusDepthAudit,
        generationSucceeded: true,
        broadcastSucceeded: false,
        ...ledgerControllerAudit,
        repairAudit: generated.repairAudit,
        model: result.model,
      });
      return { ok: false, error: "lifecycle_changed_during_generation" };
    }
  }

  // A lifecycle change can race with the read above; check the runtime guard
  // once more immediately before committing the message.
  if (input.commitGuard && !input.commitGuard()) {
    if (!input.supersededRecordOwnedElsewhere?.()) await recordSupersededDuringGeneration();
    return { ok: false, error: "superseded_during_generation" };
  }

  // What the matcher found in the message that is about to go out. Computed once
  // here, then reused by the ledger update below, so recording the guard's
  // evidence costs no extra pass and — because the matcher is deterministic and
  // network-free — puts no model call back on the broadcast path.
  const broadcastExtraction = extractedAiIds
    ? {
        acceptedIds: extractedAiIds,
        // Near matches go to the verifier on a guarded turn too. The guard still decides
        // on the exact ids alone: a near match must not cost a turn, and settling it
        // needs a model call, which must not sit before the broadcast. The board then
        // gets the same late correction as unguarded and human turns.
        verificationCandidates: generated.unresolvedCandidates ?? [],
      }
    : extractHumanTraitsFast({ messageText: result.parsed.content });
  const broadcastTraitIds = [...new Set(broadcastExtraction.acceptedIds)];

  const nextSeq = await allocSeq(input.sessionId);
  const savedMessage = await Message.create({
    sessionId: input.sessionId,
    sender: "ai",
    senderRole: "ai",
    content: result.parsed.content,
    seq: nextSeq,
    sharedInfoIds: [],
  });

  let interventionSaved = false;
  let interventionId: string | undefined;
  try {
    const intervention = await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      cue: input.routeKind,
      decision: "speak",
      generateMessageId: savedMessage._id,
      responseId: result.requestId,
      response: result.parsed.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      systemFingerprint: result.systemFingerprint,
      model: result.model,
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "saved",
      promptKey: prompt.promptKey,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      generationSucceeded: true,
      interventionSaved: true,
      broadcastSucceeded: false,
      mediationLatched: input.mediationLatched,
      mediationEvidence: input.mediationEvidence,
      buildOnsSinceMediation: input.buildOnsSinceMediation,
      outputScopeCandidate: generationGuard?.candidate,
      requestIntentKind: context.requestIntent.kind,
      requestIntentSource: context.requestIntent.source,
      outputScopeRepaired: Boolean(generated.scopeRepair),
      outputScopeViolation: generated.scopeRepair?.violation,
      internalMetadataRepaired: Boolean(generated.internalMetadataRepair),
      repairAudit: generated.repairAudit,
      ...focusDepthAudit,
      ...ledgerControllerAudit,
    });
    interventionId = intervention._id.toString();
    interventionSaved = true;
  } catch (error) {
    log.error("[route-turn] intervention log failed after message save:", error);
  }

  try {
    input.io.to(input.sessionCode).emit("new-message", {
      seq: savedMessage.seq,
      sender: savedMessage.sender,
      senderRole: savedMessage.senderRole,
      content: savedMessage.content,
      createdAt: (savedMessage as any).createdAt.toISOString(),
    });
  } catch (error: any) {
    if (interventionId) {
      await AIIntervention.updateOne(
        { _id: interventionId },
        {
          $set: {
            outcome: "broadcast_failed",
            broadcastSucceeded: false,
            error: error?.message ?? String(error),
          },
        },
      );
    }
    return { ok: false, error: "broadcast_failed" };
  }

  /**
   * Checks what the delivered message actually carried, once the verifier has
   * settled the near matches.
   *
   * The guard decided before the broadcast, when only the network-free matcher
   * could run. This re-runs the same limits against the settled trait list. A
   * limit broken here is only logged: the message is already out and cannot be
   * taken back.
   */
  const recordSurfaced = async (ids: string[]) => {
    if (!interventionId) return;
    const surfacedTraitIds = [...new Set(ids)];
    const postBroadcastViolation = generationGuard
      ? outputScopeViolation(
          result.parsed.content,
          surfacedTraitIds,
          generationGuard,
          previouslySurfacedTraitIds,
          // The same echo set the guard decided on, so this check and the earlier one
          // agree: a turn that correctly took up a participant's own words must not be
          // logged as breaking its limit.
          generated.echoedTraitIds ?? [],
        )
      : null;
    if (postBroadcastViolation) {
      log.warn(
        `[route-turn] delivered message broke ${postBroadcastViolation} ` +
          `guard=${generationGuard?.reason ?? "none"} surfaced=${surfacedTraitIds.length} ` +
          `guardSaw=${broadcastTraitIds.length} session=${input.sessionCode} seq=${savedMessage.seq}`,
      );
    }
  };

  if (contributesToBoard(input.routeKind)) {
    // What Alex put on the board, recorded only after the message is out.
    //
    // A turn becomes real when it is broadcast, not when it is written. A failed
    // generation, a blocked floor, or a cancelled turn leaves the board untouched,
    // and a broadcast that fails must not leave traits counted as said.
    //
    // The matcher here is deterministic and network-free, so it adds no delay to the
    // broadcast. Model verification of near matches runs in the background, as the
    // same late correction the human path uses.
    try {
      const contributedTraitId = input.discloseTraitIds?.[0];
      const deterministic =
        input.routeKind === "build_on" &&
        input.judgeEvidence === "relevant_unsurfaced_information" &&
        contributedTraitId
          ? {
              // The selected note always goes on the board, whatever the matcher made of the
              // wording; that is what this branch is for. Anything else the matcher plainly
              // accepted is kept too, so a second trait in the same message is not lost.
              //
              // Only the selected note is forced. The Judge may name several facts, and a fact
              // reaches the board only by actually being in the message.
              acceptedIds: [...new Set([contributedTraitId, ...broadcastExtraction.acceptedIds])],
              verificationCandidates: broadcastExtraction.verificationCandidates,
            }
          : broadcastExtraction;
      const ids = deterministic.acceptedIds;
      await Promise.all([
        updateAiSurfaced(input.sessionId, ids, savedMessage.seq),
        ids.length
          ? Message.updateOne(
              { _id: savedMessage._id },
              { $addToSet: { sharedInfoIds: { $each: ids } } },
            )
          : Promise.resolve(),
      ]);
      if (deterministic.verificationCandidates.length) {
        void (async () => {
          try {
            const verified = await verifyHumanTraitCandidates({
              messageText: result.parsed.content,
              candidates: deterministic.verificationCandidates,
            });
            const extra = verified.ids.filter((id) => !ids.includes(id));
            if (!extra.length) return await recordSurfaced(ids);
            await Promise.all([
              updateAiSurfaced(input.sessionId, extra, savedMessage.seq),
              Message.updateOne(
                { _id: savedMessage._id },
                { $addToSet: { sharedInfoIds: { $each: extra } } },
              ),
            ]);
            await recordSurfaced([...ids, ...extra]);
          } catch (error) {
            log.error("[pooling] AI late verification error:", error);
            await recordSurfaced(ids);
          }
        })();
      } else {
        await recordSurfaced(ids);
      }
    } catch (error) {
      log.error("[pooling] AI update error:", error);
    }
  }

  let ledgerCommit:
    { stateAfter: ConversationLedgerState; transition: ReducerTransitionAudit } | undefined;
  if (input.onBroadcastSuccess) {
    try {
      ledgerCommit = await input.onBroadcastSuccess({ messageSeq: savedMessage.seq });
    } catch (error) {
      // The visible broadcast cannot be rolled back. Keep the failure loud so
      // recovery can reconcile the selected opportunity from this audit row.
      log.error("[route-turn] ledger consumption persistence failed after broadcast:", error);
    }
  }
  if (interventionId) {
    try {
      await AIIntervention.updateOne(
        { _id: interventionId },
        {
          $set: {
            outcome: "broadcast",
            broadcastSucceeded: true,
            ...(input.selectedOpportunity
              ? { selectedOpportunityAlexBroadcastSeq: savedMessage.seq }
              : {}),
            ...(ledgerCommit ? { selectedOpportunityTransition: ledgerCommit.transition } : {}),
          },
        },
      );
    } catch (error) {
      log.error("[route-turn] post-broadcast intervention update failed:", error);
    }
  }

  if (!interventionSaved) {
    log.warn(`[route-turn] message broadcast without intervention row (${input.sessionCode})`);
  }
  return {
    ok: true,
    messageId: savedMessage._id.toString(),
    messageSeq: savedMessage.seq,
    response: result.parsed.content,
    ledgerStateAfter: ledgerCommit?.stateAfter,
    ledgerTransition: ledgerCommit?.transition,
  };
}
