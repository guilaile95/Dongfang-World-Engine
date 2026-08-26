import { randomUUID } from "node:crypto";
import type { SubmitResult } from "./authority/commit.js";
import { submitCandidates } from "./authority/commit.js";
import type { NpcVoice } from "./chat/npc.js";
import { stubNpcVoice } from "./chat/npc.js";
import { lastAddresseeId, recentSceneBodies, recordOpeningScene, recordResolvedScene } from "./context/recent.js";
import { recall } from "./context/recall.js";
import type { Narrator } from "./narrator/client.js";
import { committedProjection, uncommittedProjection, type NarratorEnvelope, type PromptComposition } from "./narrator/envelope.js";
import { WorldStore } from "./persist/store.js";
import { continueAddressee, reachableAddressee } from "./scene/address.js";
import { advanceDueBackgroundThreads, type DeliveredExposure } from "./scene/background.js";
import { applyInterpretation, ephemeralInterpretation, type BoundInterpretation, type SceneInterpretation } from "./scene/interpretation.js";
import { fixedInterpreter, type SceneInterpreter } from "./scene/interpreter.js";
import { fixedStopDecider, groundStopDecision, type SceneStopDecider, type SceneStopDecision, type StopReason } from "./scene/stop.js";
import { addMinutes } from "./scene/time.js";
import { assemblePrompt } from "./visibility/assemble.js";
import type { ObserverContext } from "./visibility/context.js";
import type { CompiledWorld } from "./world/compile.js";
import { seedCompiled } from "./world/load.js";
import { SYNTHETIC } from "./world/seed.js";

export const MAX_AUTO_STEPS = 3;
export const MAX_AUTO_DURATION_MINUTES = 60;
export const UNPARSED_HINT = "这一句没有被可靠理解，请换一种说法。";
export type TerminalReason = "cancelled" | "budget_cap" | "structured_failure" | "no_safe_progress" | null;

export interface DialogueTurn {
  addresseeId: string;
  addresseeName: string;
  stimulus: string;
  npcReply: string;
  npcPrompt: string;
}

export interface TurnReceipt {
  turnId: string;
  autoSteps: number;
  elapsedMinutes: number;
  terminalReason: TerminalReason;
  stopReason: StopReason;
  cancelled: boolean;
  capReached: boolean;
  backgroundBeatIds: string[];
}

export interface TurnView {
  text: string;
  observer: ObserverContext;
  prompt: string;
  rawInterpretation: SceneInterpretation;
  interpretation: BoundInterpretation;
  dialogue: DialogueTurn | null;
  envelope: NarratorEnvelope;
  parsed: boolean;
  stopDecision: SceneStopDecision | null;
  receipt: TurnReceipt;
}

interface RouteProgress {
  kind: "follow_route";
  targetLocationId: string | null;
  routeId: string;
  untilTime: string | null;
  completionCondition: string;
  direction: "forward" | "reverse";
  nextSegmentIndex: number;
}

export class Session {
  private ambient: string[] = [];

  public constructor(
    public readonly store: WorldStore,
    private readonly narrator: Narrator,
    public readonly compiled: CompiledWorld,
    private readonly interpreter: SceneInterpreter = fixedInterpreter(ephemeralInterpretation()),
    private readonly npcVoice: NpcVoice = stubNpcVoice(),
    private readonly stopDecider: SceneStopDecider = fixedStopDecider(),
  ) {}

  public contextFor(observerId: string = this.compiled.playerId): ObserverContext {
    return assemblePrompt({ snapshot: this.store.snapshot(this.compiled.seed.world.id), observerId, ambient: this.ambient }).observer;
  }

  public playTurn(playerLine: string, onChunk?: (text: string) => void): Promise<TurnView> {
    return this.handlePlayerTurn(playerLine, `local-${randomUUID()}`, undefined, onChunk);
  }

  public async handlePlayerTurn(playerLine: string, turnId: string, abortSignal?: AbortSignal, onChunk?: (text: string) => void): Promise<TurnView> {
    const trimmed = playerLine.trim();
    const worldId = this.compiled.seed.world.id;
    const before = this.store.snapshot(worldId);
    const profile = this.store.getPlayerProfile(worldId);
    const recentForPlayer = recentSceneBodies(this.store, worldId, this.compiled.playerId);
    const initialPack = assemblePrompt({ snapshot: before, observerId: this.compiled.playerId, query: trimmed, ambient: this.ambient, recentScenes: recentForPlayer, playerProfile: profile });
    const routePrompt = before.routes.filter((route) => route.visibility === "public").map((route) => `${route.id}=${route.name}（${route.travelMinutes}分钟）`).join("；");
    const prompt = routePrompt ? `${initialPack.prompt}\n【可用路线】${routePrompt}` : initialPack.prompt;

    if (/^\/ooc\b/i.test(trimmed)) return this.nonWorldTurn(trimmed, turnId, prompt, initialPack.observer, "已收到场外说明；本轮世界没有推进。");

    const interpreted = trimmed
      ? await this.interpreter.interpret({ playerLine: trimmed, observerPack: prompt, worldId, playerId: this.compiled.playerId })
      : { interpretation: ephemeralInterpretation(), parsed: true };
    const raw = interpreted.interpretation;
    const parseFailed = Boolean(trimmed && !interpreted.parsed);
    const safeInterpretation = parseFailed
      ? { ...ephemeralInterpretation(), timePolicy: { kind: "none" as const, minutes: null, routeId: null, untilTime: null } }
      : raw;

    const recovered = this.store.getLifecycleState(worldId);
    const resume = recovered?.turnId === turnId ? recovered : null;
    const declaredStrategy = resolveStrategy(safeInterpretation, before);
    const pendingRoute = routeProgressFrom(recovered?.strategy);
    let routeProgress = routeProgressFrom(resume?.strategy)
      ?? (declaredStrategy?.kind === "follow_route" ? startRouteProgress(declaredStrategy, before, this.compiled.playerId) : null)
      ?? (declaredStrategy?.kind === "continue_current_task" ? pendingRoute : null);
    const strategy = routeProgress ?? declaredStrategy;
    if (!resume) this.store.setLifecycleState({ worldId, turnId, strategy, nextStepIndex: 0, elapsedMinutes: 0, terminalReason: null });
    const intended = trimmed ? continueAddressee(before, this.compiled.playerId, trimmed, lastAddresseeId(this.store, worldId, this.compiled.playerId)) : null;
    const rawForCommit = strategy?.kind === "follow_route" ? { ...safeInterpretation, proposals: safeInterpretation.proposals.filter((row) => row.type !== "character_move") } : safeInterpretation;
    const interpretation = applyInterpretation(this.store, { worldId, playerId: this.compiled.playerId, addresseeId: intended?.id ?? null, parsed: interpreted.parsed, interpretation: rawForCommit, routes: before.routes, idempotencyKey: `turn:${turnId}:player` });

    const stepResults: SubmitResult[] = [];
    let elapsedMinutes = resume?.elapsedMinutes ?? 0;
    let autoSteps = resume?.nextStepIndex ?? 0;
    let terminalReason: TerminalReason = null;
    let routeId: string | null = null;
    let routeComplete = false;
    let checkpointStopDecision: SceneStopDecision | null = null;
    const background = { exposures: [] as DeliveredExposure[], executedBeatIds: [] as string[] };
    const routeProgressId = routeProgress?.routeId;
    const selectedRoute = routeProgressId ? before.routes.find((row) => row.id === routeProgressId && row.visibility === "public") : null;
    if (selectedRoute && routeProgress) {
      if (selectedRoute.travelMinutes > MAX_AUTO_DURATION_MINUTES) terminalReason = "budget_cap";
      else if (!abortSignal?.aborted) {
        const segments = routeSegments(selectedRoute, before, routeProgress.direction);
        const player = this.store.snapshot(worldId).characters.find((row) => row.id === this.compiled.playerId);
        if (!segments || !player || routeProgress.nextSegmentIndex > segments.length || (segments[routeProgress.nextSegmentIndex] && player.locationId !== segments[routeProgress.nextSegmentIndex]!.fromLocationId)) terminalReason = "no_safe_progress";
        else while (routeProgress.nextSegmentIndex < segments.length && autoSteps < MAX_AUTO_STEPS && !abortSignal?.aborted) {
          const segment = segments[routeProgress.nextSegmentIndex]!;
          if (elapsedMinutes + segment.minutes > MAX_AUTO_DURATION_MINUTES) { terminalReason = "budget_cap"; break; }
          const snap = this.store.snapshot(worldId);
          const result = submitCandidates(this.store, { producer: "system", idempotencyKey: `turn:${turnId}:route:${selectedRoute.id}:segment:${routeProgress.nextSegmentIndex}`, candidates: [
            { type: "character_move", worldId, expectedRevision: snap.world.revision, characterId: this.compiled.playerId, locationId: segment.toLocationId },
            { type: "time_advance", worldId, expectedRevision: snap.world.revision + 1, toTime: addMinutes(snap.world.time, segment.minutes) },
          ] });
          stepResults.push(result);
          if (!result.accepted) { terminalReason = "no_safe_progress"; break; }
          routeId = selectedRoute.id;
          elapsedMinutes += segment.minutes;
          autoSteps += 1;
          routeProgress = { ...routeProgress, nextSegmentIndex: routeProgress.nextSegmentIndex + 1 };
          this.store.setLifecycleState({ worldId, turnId, strategy: routeProgress, nextStepIndex: autoSteps, elapsedMinutes, terminalReason: null });
          const advanced = advanceDueBackgroundThreads({ store: this.store, compiled: this.compiled, playerId: this.compiled.playerId, routeId, routeLocationIds: [segment.toLocationId] });
          background.exposures.push(...advanced.exposures);
          background.executedBeatIds.push(...advanced.executedBeatIds);
          const completeAtCheckpoint = routeProgress.nextSegmentIndex === segments.length;
          if (!shouldEvaluateCheckpointStop(advanced.exposures, completeAtCheckpoint, interpretation)) continue;
          const checkpointHardStop = chooseHardStop(advanced.exposures, completeAtCheckpoint, interpretation);
          const checkpointAmbient = advanced.exposures.map((row) => row.presentationDirective);
          const checkpointVisible = assemblePrompt({ snapshot: this.store.snapshot(worldId), observerId: this.compiled.playerId, query: trimmed, ambient: checkpointAmbient, recentScenes: recentForPlayer, playerProfile: profile });
          const decided = await this.stopDecider.decide({ visibleContext: checkpointVisible.prompt, hardStopReason: checkpointHardStop, evidence: [...checkpointAmbient, ...uncommittedProjection(rawForCommit, interpretation)], strategyComplete: completeAtCheckpoint });
          if (!decided || (checkpointHardStop && (!decided.shouldStop || decided.stopReason !== checkpointHardStop))) { terminalReason = "structured_failure"; break; }
          if (decided.shouldStop) { checkpointStopDecision = groundStopDecision(decided, this.store.snapshot(worldId), this.compiled, this.compiled.playerId); break; }
        }
        routeComplete = routeProgress.nextSegmentIndex === segments?.length;
        if (!routeComplete && !terminalReason && autoSteps >= MAX_AUTO_STEPS && background.exposures.length === 0) terminalReason = "budget_cap";
      }
    } else if (!abortSignal?.aborted) {
      const duration = trimmed ? resolveDuration(safeInterpretation, interpretation, before) : 0;
      if (duration > 0) {
        const snap = this.store.snapshot(worldId);
        const result = submitCandidates(this.store, { producer: "system", idempotencyKey: `turn:${turnId}:step:0:time`, candidates: [{ type: "time_advance", worldId, expectedRevision: snap.world.revision, toTime: addMinutes(snap.world.time, duration) }] });
        stepResults.push(result);
        if (result.accepted) elapsedMinutes += duration;
      }
      if (declaredStrategy?.kind === "continue_current_task") {
        while (autoSteps < MAX_AUTO_STEPS && elapsedMinutes < MAX_AUTO_DURATION_MINUTES && !abortSignal?.aborted) {
          const snap = this.store.snapshot(worldId);
          const result = submitCandidates(this.store, { producer: "system", idempotencyKey: `turn:${turnId}:step:${autoSteps}:continue`, candidates: [{ type: "time_advance", worldId, expectedRevision: snap.world.revision, toTime: addMinutes(snap.world.time, 1) }] });
          stepResults.push(result);
          if (!result.accepted) break;
          autoSteps += 1;
          elapsedMinutes += 1;
        }
        if (autoSteps >= MAX_AUTO_STEPS) terminalReason = "budget_cap";
      }
    }

    if (abortSignal?.aborted) terminalReason = "cancelled";
    if (terminalReason !== "cancelled" && !selectedRoute) {
      const advanced = advanceDueBackgroundThreads({ store: this.store, compiled: this.compiled, playerId: this.compiled.playerId });
      background.exposures.push(...advanced.exposures);
      background.executedBeatIds.push(...advanced.executedBeatIds);
    }
    this.ambient = background.exposures.map((row) => row.presentationDirective);
    const after = this.store.snapshot(worldId);
    const player = after.characters.find((row) => row.id === this.compiled.playerId);
    const addressee = reachableAddressee(after, this.compiled.playerId, intended);
    let dialogue: DialogueTurn | null = null;
    if (addressee && terminalReason !== "cancelled") {
      const npcPack = assemblePrompt({ snapshot: after, observerId: addressee.id, query: trimmed, recentScenes: recentSceneBodies(this.store, worldId, addressee.id) });
      const npcReply = await this.npcVoice.reply({ name: addressee.name, pack: npcPack.prompt, stimulus: trimmed });
      dialogue = { addresseeId: addressee.id, addresseeName: addressee.name, stimulus: trimmed, npcReply, npcPrompt: npcPack.prompt };
    }

    const hardStopReason = chooseHardStop(background.exposures, routeComplete, interpretation);
    const visible = assemblePrompt({ snapshot: after, observerId: this.compiled.playerId, query: trimmed, ambient: this.ambient, recentScenes: recentForPlayer, playerProfile: profile });
    let stopDecision: SceneStopDecision | null = checkpointStopDecision;
    if (!parseFailed && !stopDecision && terminalReason !== "cancelled" && terminalReason !== "budget_cap" && terminalReason !== "structured_failure") {
      const decided = await this.stopDecider.decide({ visibleContext: visible.prompt, hardStopReason, evidence: [...this.ambient, ...uncommittedProjection(rawForCommit, interpretation)], strategyComplete: routeComplete });
      if (!decided || (hardStopReason && (!decided.shouldStop || decided.stopReason !== hardStopReason))) terminalReason = "structured_failure";
      else stopDecision = groundStopDecision(decided, after, this.compiled, this.compiled.playerId);
    }
    if (!terminalReason && !stopDecision?.shouldStop) terminalReason = "no_safe_progress";

    const committed = committedProjection(interpretation, this.compiled.playerId, after);
    if (selectedRoute && routeId) committed.push(`你沿已选择的「${selectedRoute.name}」行进 ${elapsedMinutes} 分钟，并到达${after.locations.find((row) => row.id === player?.locationId)?.name ?? "路线节点"}。`);
    const envelope: NarratorEnvelope = { playerContribution: trimmed, observerContext: visible.prompt, committed, uncommitted: uncommittedProjection(rawForCommit, interpretation), npcReply: dialogue ? { name: dialogue.addresseeName, line: dialogue.npcReply } : null, ephemeral: { recentScenes: recentForPlayer, ambient: this.ambient }, promptComposition: composePromptComposition(this.compiled, profile, visible.prompt, recentForPlayer, this.ambient, trimmed) };
    let text = terminalReason === "cancelled" ? "已在安全边界停止；先前已经完成的行动仍然保留。" : "";
    if (!text) {
      try { text = await this.narrator.project(envelope, onChunk); }
      catch { text = "世界状态已经保存，但这一段叙述暂时没有生成。"; }
    } else onChunk?.(text);

    if (trimmed) {
      const resolved = { playerLine: trimmed, addresseeId: dialogue?.addresseeId ?? null, addresseeName: dialogue?.addresseeName ?? null, npcReply: dialogue?.npcReply ?? null };
      recordResolvedScene(this.store, worldId, this.compiled.playerId, resolved, "player");
      if (dialogue) recordResolvedScene(this.store, worldId, dialogue.addresseeId, resolved, "npc");
    }
    const receipt: TurnReceipt = { turnId, autoSteps, elapsedMinutes, terminalReason, stopReason: stopDecision?.stopReason ?? "none", cancelled: terminalReason === "cancelled", capReached: terminalReason === "budget_cap", backgroundBeatIds: background.executedBeatIds };
    const pendingStrategy = selectedRoute && !routeComplete ? routeProgress : terminalReason === "cancelled" ? strategy : null;
    this.store.setLifecycleState({ worldId, turnId, strategy: pendingStrategy, nextStepIndex: autoSteps, elapsedMinutes, terminalReason });
    return { text, observer: visible.observer, prompt: visible.prompt, rawInterpretation: raw, interpretation, dialogue, envelope, parsed: interpreted.parsed, stopDecision, receipt };
  }

  public async projectOpening(profile: import("./persist/store.js").PlayerProfile, onChunk?: (text: string) => void): Promise<import("./narrator/project.js").ParsedOpening> {
    const worldId = this.compiled.seed.world.id;
    const snapshot = this.store.snapshot(worldId);
    const player = snapshot.characters.find((row) => row.id === this.compiled.playerId);
    const location = snapshot.locations.find((row) => row.id === player?.locationId);
    const opening = advanceDueBackgroundThreads({ store: this.store, compiled: this.compiled, playerId: this.compiled.playerId });
    const exposure = opening.exposures[0];
    const plan = exposure ? { kind: "ephemeral_event" as const, situationSummary: exposure.presentationDirective, narrativeDirective: exposure.presentationDirective } : undefined;
    const loreHits = recall(this.store, worldId, this.compiled.playerId, [location?.name, profile.startingLocation, profile.background].filter(Boolean).join(" "), { kinds: ["lore"], limit: 4 });
    const input: import("./narrator/project.js").OpeningPromptInput = {
      worldTitle: this.compiled.packageTitle, era: this.compiled.chronology.era, timeLabel: this.compiled.chronology.timeLabel, publicPremise: this.compiled.chronology.publicPremise,
      locationName: location?.name || profile.startingLocation || "普通城市", presentCharacters: snapshot.characters.filter((row) => row.id !== this.compiled.playerId && row.locationId === player?.locationId).map((row) => row.name),
      publicRules: snapshot.world.rules, publicLore: loreHits.map((hit) => hit.body), publicBeat: exposure?.presentationDirective ?? "", profile, ...(plan ? { plannedHook: plan } : {}),
      characterization: `${profile.background || "普通学生"}；${profile.personality || "务实"}。`,
      styleAnchors: ["第二人称、每段有新信息、一次只推进一个可感知变化。", "NPC 使用自然短句，不透露不可见秘密。", "真正出现决定点时把行动权交还玩家。"],
      recentHistory: recentSceneBodies(this.store, worldId, this.compiled.playerId),
    };
    let parsed: import("./narrator/project.js").ParsedOpening;
    if (this.narrator.projectOpening) parsed = await this.narrator.projectOpening(input, onChunk);
    else {
      const narrative = await this.narrator.project({ playerContribution: "", observerContext: `【世界】${input.worldTitle}【地点】${input.locationName}`, committed: [], uncommitted: [], npcReply: null, ephemeral: { recentScenes: [], ambient: exposure ? [exposure.presentationDirective] : [] } }, onChunk);
      const m = await import("./narrator/project.js");
      parsed = m.parseOpeningOutput(narrative, input.locationName, plan);
    }
    if (exposure) {
      const grounded = groundStopDecision({
        shouldStop: true,
        stopReason: exposure.stopReason,
        decisionSummary: parsed.currentSituation || exposure.presentationDirective,
        options: parsed.suggestions.length === 6 ? parsed.suggestions.map((row) => ({ key: row.key, text: row.label, type: row.type })) : null,
      }, this.store.snapshot(worldId), this.compiled, this.compiled.playerId);
      parsed = { ...parsed, suggestions: grounded.options?.map((row) => ({ key: row.key, label: row.text, type: row.type })) ?? [] };
    }
    this.store.transaction(() => { this.store.setPlayerSituation(worldId, this.compiled.playerId, parsed.currentSituation || plan?.situationSummary || ""); recordOpeningScene(this.store, worldId, this.compiled.playerId, parsed.narrative); });
    return parsed;
  }

  public close(): void { this.store.close(); }

  private nonWorldTurn(line: string, turnId: string, prompt: string, observer: ObserverContext, text: string): TurnView {
    const raw = ephemeralInterpretation();
    const interpretation = applyInterpretation(this.store, { worldId: this.compiled.seed.world.id, playerId: this.compiled.playerId, interpretation: raw });
    const envelope: NarratorEnvelope = { playerContribution: line, observerContext: prompt, committed: [], uncommitted: [], npcReply: null, ephemeral: { recentScenes: [], ambient: [] } };
    return { text, observer, prompt, rawInterpretation: raw, interpretation, dialogue: null, envelope, parsed: true, stopDecision: null, receipt: { turnId, autoSteps: 0, elapsedMinutes: 0, terminalReason: "no_safe_progress", stopReason: "none", cancelled: false, capReached: false, backgroundBeatIds: [] } };
  }

}

function resolveStrategy(raw: SceneInterpretation, snapshot: ReturnType<WorldStore["snapshot"]>): NonNullable<SceneInterpretation["strategyIntent"]> | null {
  const declared = raw.strategyIntent ?? null;
  if (declared?.kind === "follow_route" && declared.routeId && snapshot.routes.some((row) => row.id === declared.routeId && row.visibility === "public")) return declared;
  return declared?.kind === "follow_route" ? null : declared;
}

function startRouteProgress(strategy: NonNullable<SceneInterpretation["strategyIntent"]>, snapshot: ReturnType<WorldStore["snapshot"]>, playerId: string): RouteProgress | null {
  if (strategy.kind !== "follow_route" || !strategy.routeId) return null;
  const route = snapshot.routes.find((row) => row.id === strategy.routeId && row.visibility === "public");
  const locationId = snapshot.characters.find((row) => row.id === playerId)?.locationId;
  if (!route || !locationId) return null;
  const direction = locationId === route.toLocationId && route.bidirectional ? "reverse" : "forward";
  return { kind: "follow_route", targetLocationId: strategy.targetLocationId, routeId: route.id, untilTime: strategy.untilTime, completionCondition: strategy.completionCondition, direction, nextSegmentIndex: 0 };
}

function routeProgressFrom(value: unknown): RouteProgress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<RouteProgress>;
  return row.kind === "follow_route" && typeof row.routeId === "string" && (row.direction === "forward" || row.direction === "reverse") && Number.isInteger(row.nextSegmentIndex) && (row.nextSegmentIndex ?? -1) >= 0
    ? row as RouteProgress
    : null;
}

function routeSegments(route: ReturnType<WorldStore["snapshot"]>["routes"][number], snapshot: ReturnType<WorldStore["snapshot"]>, direction: RouteProgress["direction"]): Array<{ fromLocationId: string; toLocationId: string; minutes: number }> | null {
  const nodes = [route.fromLocationId, ...route.viaLocationIds, route.toLocationId];
  if (direction === "reverse") nodes.reverse();
  const segments = nodes.slice(0, -1).map((fromLocationId, index) => {
    const toLocationId = nodes[index + 1]!;
    const edge = snapshot.routes.find((candidate) => candidate.id !== route.id && candidate.visibility === "public" && candidate.viaLocationIds.length === 0 && ((candidate.fromLocationId === fromLocationId && candidate.toLocationId === toLocationId) || (candidate.bidirectional && candidate.toLocationId === fromLocationId && candidate.fromLocationId === toLocationId)));
    return { fromLocationId, toLocationId, minutes: edge?.travelMinutes ?? 0 };
  });
  const missing = segments.filter((row) => row.minutes === 0);
  const remaining = route.travelMinutes - segments.reduce((sum, row) => sum + row.minutes, 0);
  if (remaining < missing.length || (missing.length === 0 && remaining !== 0)) return null;
  missing.forEach((row, index) => { row.minutes = Math.floor(remaining / missing.length) + (index < remaining % missing.length ? 1 : 0); });
  return segments;
}

function resolveDuration(raw: SceneInterpretation, interpretation: BoundInterpretation, before: ReturnType<WorldStore["snapshot"]>): number {
  const policy = raw.timePolicy;
  if (policy?.kind === "explicit_wait") return Math.min(policy.minutes ?? 0, MAX_AUTO_DURATION_MINUTES);
  if (policy?.kind === "bounded_action") return Math.min(policy.minutes ?? 1, 10);
  if (policy?.kind === "route_travel") return 0;
  const move = interpretation.result.events.find((event) => event.type === "character_move");
  if (move && typeof move.payload.locationId === "string") {
    const player = before.characters.find((row) => row.kind === "player");
    return before.routes.find((route) => player && ((route.fromLocationId === player.locationId && route.toLocationId === move.payload.locationId) || (route.bidirectional && route.toLocationId === player.locationId && route.fromLocationId === move.payload.locationId)))?.travelMinutes ?? 1;
  }
  if (policy?.kind === "none") return 0;
  return raw.contributions.includes("observe") ? 0 : 1;
}

function chooseHardStop(exposures: DeliveredExposure[], routeComplete: boolean, interpretation: BoundInterpretation): Exclude<StopReason, "none"> | null {
  const exposure = exposures.at(-1);
  if (exposure) return exposure.stopReason;
  if (interpretation.result.reasons.length > 0 || interpretation.outcome === "clarify" || interpretation.outcome === "fail") return "obstacle";
  return routeComplete ? "destination_reached" : null;
}

function shouldEvaluateCheckpointStop(exposures: DeliveredExposure[], routeComplete: boolean, interpretation: BoundInterpretation): boolean {
  return exposures.length > 0 || routeComplete || interpretation.result.reasons.length > 0 || interpretation.outcome === "clarify" || interpretation.outcome === "fail";
}

function composePromptComposition(compiled: CompiledWorld, profile: import("./persist/store.js").PlayerProfile | null, visibleWorld: string, recentHistory: string[], ambient: string[], currentInput: string): PromptComposition {
  const persona = profile
    ? [profile.name && `名字=${profile.name}`, profile.age && `年龄=${profile.age}岁`, profile.gender && `性别=${profile.gender}`, profile.background && `背景=${profile.background}`, profile.personality && `性格=${profile.personality}`].filter(Boolean).join("；")
    : "普通玩家。";
  return {
    longTermSetting: compiled.packageTitle,
    scenario: `${compiled.chronology.era}；${compiled.chronology.timeLabel}；${compiled.chronology.publicPremise}`,
    characterization: profile?.background || "普通人，保持当前世界的知识边界。",
    playerPersona: persona,
    styleAnchors: [
      "第二人称；每段有新信息；一次只推进一个可感知变化。",
      "NPC 使用自然短句，不替 NPC 透露不可见秘密。",
      "示例 NPC 语气：「先别急，先看看眼前发生了什么。」",
      "真正出现新决定时，把行动权交还玩家。",
    ],
    sceneReinforcement: ambient.join(" "),
    visibleWorld,
    recentHistory,
    currentInput,
  };
}

export function openWorld(path: string, narrator: Narrator, compiled: CompiledWorld = SYNTHETIC, interpreter?: SceneInterpreter, npcVoice?: NpcVoice, stopDecider?: SceneStopDecider): Session {
  const store = new WorldStore(path);
  seedCompiled(store, compiled);
  return new Session(store, narrator, compiled, interpreter, npcVoice, stopDecider);
}
