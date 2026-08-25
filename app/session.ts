import { randomUUID } from "node:crypto";
import type { SubmitResult } from "./authority/commit.js";
import { submitCandidates } from "./authority/commit.js";
import type { NpcVoice } from "./chat/npc.js";
import { stubNpcVoice } from "./chat/npc.js";
import { lastAddresseeId, recentSceneBodies, recordOpeningScene, recordResolvedScene } from "./context/recent.js";
import { recall } from "./context/recall.js";
import type { Narrator } from "./narrator/client.js";
import { committedProjection, uncommittedProjection, type NarratorEnvelope } from "./narrator/envelope.js";
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
    if (trimmed && !interpreted.parsed) return this.failedInterpretation(trimmed, turnId, raw, prompt, initialPack.observer, recentForPlayer);

    const strategy = resolveStrategy(raw, trimmed, before);
    const recovered = this.store.getLifecycleState(worldId);
    const resume = recovered?.turnId === turnId ? recovered : null;
    if (!resume) this.store.setLifecycleState({ worldId, turnId, strategy, nextStepIndex: 0, elapsedMinutes: 0, terminalReason: null });
    const intended = trimmed ? continueAddressee(before, this.compiled.playerId, trimmed, lastAddresseeId(this.store, worldId, this.compiled.playerId)) : null;
    const rawForCommit = strategy?.kind === "follow_route" ? { ...raw, proposals: raw.proposals.filter((row) => row.type !== "character_move") } : raw;
    const interpretation = applyInterpretation(this.store, { worldId, playerId: this.compiled.playerId, addresseeId: intended?.id ?? null, parsed: interpreted.parsed, interpretation: rawForCommit, routes: before.routes, idempotencyKey: `turn:${turnId}:player` });

    const stepResults: SubmitResult[] = [];
    let elapsedMinutes = resume?.elapsedMinutes ?? 0;
    let autoSteps = resume?.nextStepIndex ?? 0;
    let terminalReason: TerminalReason = null;
    let routeId: string | null = null;
    const selectedRoute = strategy?.kind === "follow_route" && strategy.routeId ? before.routes.find((row) => row.id === strategy.routeId) : null;
    if (selectedRoute) {
      if (selectedRoute.travelMinutes > MAX_AUTO_DURATION_MINUTES) terminalReason = "budget_cap";
      else if (resume && resume.nextStepIndex > 0) routeId = selectedRoute.id;
      else if (!abortSignal?.aborted) {
        const player = this.store.snapshot(worldId).characters.find((row) => row.id === this.compiled.playerId);
        const destination = player?.locationId === selectedRoute.toLocationId && selectedRoute.bidirectional ? selectedRoute.fromLocationId : selectedRoute.toLocationId;
        if (!player || (player.locationId !== selectedRoute.fromLocationId && !(selectedRoute.bidirectional && player.locationId === selectedRoute.toLocationId))) terminalReason = "no_safe_progress";
        else {
          const snap = this.store.snapshot(worldId);
          const result = submitCandidates(this.store, { producer: "system", idempotencyKey: `turn:${turnId}:step:0:route`, candidates: [
            { type: "character_move", worldId, expectedRevision: snap.world.revision, characterId: this.compiled.playerId, locationId: destination },
            { type: "time_advance", worldId, expectedRevision: snap.world.revision + 1, toTime: addMinutes(snap.world.time, selectedRoute.travelMinutes) },
          ] });
          stepResults.push(result);
          if (!result.accepted) terminalReason = "no_safe_progress";
          else {
            routeId = selectedRoute.id; elapsedMinutes = selectedRoute.travelMinutes; autoSteps = 1;
            this.store.setLifecycleState({ worldId, turnId, strategy, nextStepIndex: autoSteps, elapsedMinutes, terminalReason: null });
          }
        }
      }
    } else if (!abortSignal?.aborted) {
      const duration = trimmed ? resolveDuration(raw, interpretation, before) : 0;
      if (duration > 0) {
        const snap = this.store.snapshot(worldId);
        const result = submitCandidates(this.store, { producer: "system", idempotencyKey: `turn:${turnId}:step:0:time`, candidates: [{ type: "time_advance", worldId, expectedRevision: snap.world.revision, toTime: addMinutes(snap.world.time, duration) }] });
        stepResults.push(result);
        if (result.accepted) elapsedMinutes += duration;
      }
      if (strategy?.kind === "continue_current_task") {
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
    const background = terminalReason === "cancelled" ? { exposures: [] as DeliveredExposure[], executedBeatIds: [] as string[] } : advanceDueBackgroundThreads({ store: this.store, compiled: this.compiled, playerId: this.compiled.playerId, routeId });
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

    const hardStopReason = chooseHardStop(background.exposures, Boolean(selectedRoute), interpretation);
    const visible = assemblePrompt({ snapshot: after, observerId: this.compiled.playerId, query: trimmed, ambient: this.ambient, recentScenes: recentForPlayer, playerProfile: profile });
    let stopDecision: SceneStopDecision | null = null;
    if (terminalReason !== "cancelled" && terminalReason !== "budget_cap") {
      const decided = await this.stopDecider.decide({ visibleContext: visible.prompt, hardStopReason, evidence: [...this.ambient, ...uncommittedProjection(rawForCommit, interpretation)], strategyComplete: Boolean(selectedRoute) });
      if (!decided || (hardStopReason && (!decided.shouldStop || decided.stopReason !== hardStopReason))) terminalReason = "structured_failure";
      else stopDecision = groundStopDecision(decided, after, this.compiled, this.compiled.playerId);
    }
    if (!terminalReason && !stopDecision?.shouldStop) terminalReason = "no_safe_progress";

    const committed = committedProjection(interpretation, this.compiled.playerId, after);
    if (selectedRoute && routeId) committed.push(`你沿已选择的「${selectedRoute.name}」行进 ${selectedRoute.travelMinutes} 分钟，并到达${after.locations.find((row) => row.id === player?.locationId)?.name ?? "目的地"}。`);
    const envelope: NarratorEnvelope = { playerContribution: trimmed, observerContext: visible.prompt, committed, uncommitted: uncommittedProjection(rawForCommit, interpretation), npcReply: dialogue ? { name: dialogue.addresseeName, line: dialogue.npcReply } : null, ephemeral: { recentScenes: recentForPlayer, ambient: this.ambient } };
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
    this.store.setLifecycleState({ worldId, turnId, strategy: terminalReason === "cancelled" ? strategy : null, nextStepIndex: autoSteps, elapsedMinutes, terminalReason });
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

  private failedInterpretation(line: string, turnId: string, raw: SceneInterpretation, prompt: string, observer: ObserverContext, recentScenes: string[]): TurnView {
    const interpretation = applyInterpretation(this.store, { worldId: this.compiled.seed.world.id, playerId: this.compiled.playerId, parsed: false, interpretation: raw });
    const envelope: NarratorEnvelope = { playerContribution: line, observerContext: prompt, committed: [], uncommitted: [], npcReply: null, ephemeral: { recentScenes, ambient: [] } };
    return { text: UNPARSED_HINT, observer, prompt, rawInterpretation: raw, interpretation, dialogue: null, envelope, parsed: false, stopDecision: null, receipt: { turnId, autoSteps: 0, elapsedMinutes: 0, terminalReason: "structured_failure", stopReason: "none", cancelled: false, capReached: false, backgroundBeatIds: [] } };
  }
}

function resolveStrategy(raw: SceneInterpretation, line: string, snapshot: ReturnType<WorldStore["snapshot"]>): NonNullable<SceneInterpretation["strategyIntent"]> | null {
  const declared = raw.strategyIntent ?? null;
  if (declared?.kind === "follow_route" && declared.routeId && snapshot.routes.some((row) => row.id === declared.routeId && row.visibility === "public")) return declared;
  const route = snapshot.routes.find((row) => row.visibility === "public" && ((/远路|老街/.test(line) && /远路|老街/.test(row.name)) || (/近路|老码头/.test(line) && /近路|老码头/.test(row.name))));
  return route ? { kind: "follow_route", targetLocationId: route.toLocationId, routeId: route.id, untilTime: null, completionCondition: `到达${route.toLocationId}` } : declared;
}

function resolveDuration(raw: SceneInterpretation, interpretation: BoundInterpretation, before: ReturnType<WorldStore["snapshot"]>): number {
  const policy = raw.timePolicy;
  if (policy?.kind === "explicit_wait") return Math.min(policy.minutes ?? 0, MAX_AUTO_DURATION_MINUTES);
  if (policy?.kind === "bounded_action") return Math.min(policy.minutes ?? 1, 10);
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

export function openWorld(path: string, narrator: Narrator, compiled: CompiledWorld = SYNTHETIC, interpreter?: SceneInterpreter, npcVoice?: NpcVoice, stopDecider?: SceneStopDecider): Session {
  const store = new WorldStore(path);
  seedCompiled(store, compiled);
  return new Session(store, narrator, compiled, interpreter, npcVoice, stopDecider);
}
