import type { CandidateEvent } from "./candidate.js";
import type { CommitKernel, CommitResult } from "./commit-kernel.js";
import type { CharacterContext, ContextBuilder } from "./context-builder.js";
import type { CommittedEvent, WorldSnapshot } from "../domain/types.js";
import {
  toNarrativeOutcomes,
  type NarrativeEnvelope,
  type NarrativeOutcomeProjection,
} from "./narrative.js";
import type { SceneInterpreter } from "./scene-interpreter.js";
import {
  DEFAULT_SCENE_TURN_MINUTES,
  hasOocPrefix,
  isContiguousSubstring,
  type EphemeralBeat,
  type ResolvedSceneEnvelope,
  type SceneTurnPlan,
  type SceneTurnStatus,
  type TargetedStimulus,
  type TimePolicy,
  type WithheldStimulus,
} from "./scene-turn.js";
import type { CandidateProposal } from "./simulation-adapter.js";
import type { TurnOrchestrator, TurnResult } from "./turn-orchestrator.js";

export interface ResolveSceneInput {
  worldId: string;
  actorCharacterId: string;
  contribution: string;
  contextBudget?: number;
}

export interface SceneContinuation {
  run(input: { worldId: string; actorCharacterId: string }): Promise<TurnResult>;
  chooseActor(worldId: string): string;
}

export class SceneResolver {
  public constructor(
    private readonly contextBuilder: ContextBuilder,
    private readonly interpreter: SceneInterpreter,
    private readonly commitKernel: CommitKernel,
    private readonly stateReader: { getSnapshot(worldId: string): WorldSnapshot },
    private readonly continuation?: SceneContinuation,
  ) {}

  public async resolve(input: ResolveSceneInput): Promise<ResolvedSceneEnvelope> {
    const contribution = input.contribution.trim();
    const context = this.contextBuilder.buildCharacterContext({
      worldId: input.worldId,
      observerCharacterId: input.actorCharacterId,
      ...(input.contextBudget === undefined ? {} : { budget: input.contextBudget }),
    });
    const draft = await this.interpreter.interpret({
      context,
      actorCharacterId: input.actorCharacterId,
      intent: contribution,
    });

    let channel = draft.channel;
    if (hasOocPrefix(contribution)) {
      channel = "ooc_meta";
    }

    const plan: SceneTurnPlan = {
      playerContribution: contribution,
      channel,
      ephemeralBeats: [],
      targetedStimuli: channel === "ooc_meta" ? [] : draft.targetedStimuli.map((stimulus) => ({
        ...stimulus,
        persistence: "ephemeral",
      })),
      persistentCandidates: [],
      unsupportedMaterial: draft.unsupportedMaterial,
      timePolicy: channel === "ooc_meta" ? { kind: "none" } : draft.timePolicy,
    };

    if (channel !== "ooc_meta") {
      plan.ephemeralBeats = normalizeEphemeralBeats(draft.ephemeralBeats, contribution);
      plan.persistentCandidates = stripPlayerPersistents(
        draft.persistentCandidates,
        plan.targetedStimuli,
      );
    }

    const before = this.stateReader.getSnapshot(input.worldId);
    const committedEvents: CommittedEvent[] = [];
    let rejection: ResolvedSceneEnvelope["rejection"] = null;
    let lastState = before;

    for (const proposal of plan.persistentCandidates) {
      const result = this.commitProposal(
        proposal,
        input.worldId,
        lastState.world.revision,
        lastState.world.currentTime,
      );
      if (!result.ok) {
        rejection = {
          kind: "kernel_rejection",
          code: result.error.code,
          message: result.error.message,
          proposalIndex: committedEvents.length,
        };
        break;
      }
      committedEvents.push(result.event);
      lastState = result.state;
    }

    let timeCommitted = false;
    if (!rejection && plan.timePolicy.kind === "consume_scene_time" && channel !== "ooc_meta") {
      const minutes = plan.timePolicy.minutes ?? DEFAULT_SCENE_TURN_MINUTES;
      const toTime = new Date(Date.parse(lastState.world.currentTime) + minutes * 60_000).toISOString();
      const timeResult = this.commitKernel.commit({
        type: "world.time_advance",
        worldId: input.worldId,
        expectedWorldRevision: lastState.world.revision,
        occurredAt: lastState.world.currentTime,
        causeEventIds: [],
        toTime,
      });
      if (timeResult.ok) {
        committedEvents.push(timeResult.event);
        lastState = timeResult.state;
        timeCommitted = true;
      } else {
        rejection = {
          kind: "kernel_rejection",
          code: timeResult.error.code,
          message: timeResult.error.message,
          proposalIndex: committedEvents.length,
        };
      }
    }

    const snapshotOk = snapshotGate(before, lastState, committedEvents);
    let approvedEphemeralBeats = snapshotOk && !rejection ? plan.ephemeralBeats : [];
    if (!snapshotOk && !rejection) {
      rejection = {
        kind: "kernel_rejection",
        code: "EPHEMERAL_SNAPSHOT_MISMATCH",
        message: "Materialized fields changed without a matching committed Event",
        proposalIndex: null,
      };
    }

    const { delivered, withheld } = deliverStimuli(plan.targetedStimuli, input.actorCharacterId, context);

    let npcWorldOutcomes: NarrativeOutcomeProjection[] = [];
    let continuationRan = false;
    const shouldContinue = channel === "in_world"
      && !rejection
      && this.continuation !== undefined
      && (
        timeCommitted
        || plan.persistentCandidates.length > 0
        || delivered.length > 0
      );
    if (shouldContinue && this.continuation) {
      const actorId = this.continuation.chooseActor(input.worldId);
      const continuation = await this.continuation.run({
        worldId: input.worldId,
        actorCharacterId: actorId,
      });
      continuationRan = true;
      npcWorldOutcomes = visibilityFilterNpcOutcomes(
        toNarrativeOutcomes(continuation.committedEvents),
        input.actorCharacterId,
      );
    }

    const observerContext = this.contextBuilder.buildCharacterContext({
      worldId: input.worldId,
      observerCharacterId: input.actorCharacterId,
      ...(input.contextBudget === undefined ? {} : { budget: input.contextBudget }),
    });

    const turnStatus = resolveStatus({
      channel,
      rejection,
      committedEvents,
      approvedEphemeralBeats,
      delivered,
    });

    return {
      playerContribution: contribution,
      channel,
      observerContext,
      approvedEphemeralBeats,
      deliveredStimuli: delivered,
      withheldStimuli: withheld,
      committedEffects: toNarrativeOutcomes(committedEvents),
      rejectedEffects: rejection ? [{ kind: rejection.kind, code: rejection.code }] : [],
      npcWorldOutcomes,
      unsupportedMaterial: plan.unsupportedMaterial,
      timePolicy: plan.timePolicy,
      timeCommitted,
      continuationRan,
      turnStatus,
      rejection,
    };
  }

  private commitProposal(
    proposal: CandidateProposal,
    worldId: string,
    expectedWorldRevision: number,
    occurredAt: string,
  ): CommitResult {
    const candidate = {
      ...proposal,
      worldId,
      expectedWorldRevision,
      occurredAt,
      causeEventIds: [],
    } as CandidateEvent;
    return this.commitKernel.commit(candidate);
  }
}

export function toNarrativeEnvelope(resolved: ResolvedSceneEnvelope): NarrativeEnvelope {
  return {
    intent: resolved.playerContribution,
    turnStatus: resolved.turnStatus,
    observerContext: resolved.observerContext,
    outcomes: resolved.committedEffects,
    rejection: resolved.rejection
      ? { kind: resolved.rejection.kind, code: resolved.rejection.code }
      : null,
    ephemeralBeats: resolved.approvedEphemeralBeats,
    deliveredStimuli: resolved.deliveredStimuli.map((stimulus) => ({
      targetCharacterId: stimulus.targetCharacterId,
      surfaceText: stimulus.surfaceText,
      speechAct: stimulus.speechAct,
    })),
    npcWorldOutcomes: resolved.npcWorldOutcomes,
    timeCommitted: resolved.timeCommitted,
  };
}

export function normalizeEphemeralBeats(
  beats: Array<{ surface?: string | undefined; kind: EphemeralBeat["kind"] }>,
  contribution: string,
): EphemeralBeat[] {
  const approved: EphemeralBeat[] = [];
  for (const beat of beats) {
    const surface = beat.surface?.length ? beat.surface : contribution;
    if (!isContiguousSubstring(surface, contribution)) {
      continue;
    }
    approved.push({ surface, kind: beat.kind });
  }
  return approved;
}

export function stripPlayerPersistents(
  proposals: CandidateProposal[],
  stimuli: TargetedStimulus[],
): CandidateProposal[] {
  const hasAsk = stimuli.some((stimulus) => stimulus.speechAct === "ask");
  const hasTell = stimuli.some((stimulus) => stimulus.speechAct === "tell");
  const askOnly = hasAsk && !hasTell;
  return proposals.filter((proposal) => {
    if (proposal.type === "world.time_advance") {
      return false;
    }
    if (proposal.type === "claim.record") {
      return false;
    }
    if (askOnly && (proposal.type === "claim.transmit" || proposal.type === "character.learn_claim")) {
      return false;
    }
    return true;
  });
}

function deliverStimuli(
  stimuli: TargetedStimulus[],
  speakerId: string,
  context: CharacterContext,
): { delivered: TargetedStimulus[]; withheld: WithheldStimulus[] } {
  const delivered: TargetedStimulus[] = [];
  const withheld: WithheldStimulus[] = [];
  const coLocated = new Set(context.coLocatedCharacters.map((character) => character.id));
  for (const stimulus of stimuli) {
    if (stimulus.speakerCharacterId !== speakerId) {
      withheld.push({ stimulus, reason: "speaker_mismatch" });
      continue;
    }
    if (!coLocated.has(stimulus.targetCharacterId)) {
      withheld.push({ stimulus, reason: "target_not_colocated" });
      continue;
    }
    delivered.push({ ...stimulus, persistence: "ephemeral" });
  }
  return { delivered, withheld };
}

function snapshotGate(
  before: WorldSnapshot,
  after: WorldSnapshot,
  events: CommittedEvent[],
): boolean {
  const types = new Set(events.map((event) => event.type));
  if (!types.has("character.move") && locationsChanged(before, after)) {
    return false;
  }
  if (!types.has("character.die") && aliveChanged(before, after)) {
    return false;
  }
  if (
    !types.has("character.learn_claim")
    && !types.has("claim.record")
    && !types.has("claim.transmit")
    && knowledgeChanged(before, after)
  ) {
    return false;
  }
  if (!types.has("relationship.change") && relationshipsChanged(before, after)) {
    return false;
  }
  if (!types.has("world.time_advance") && before.world.currentTime !== after.world.currentTime) {
    return false;
  }
  return true;
}

function locationsChanged(before: WorldSnapshot, after: WorldSnapshot): boolean {
  const previous = new Map(before.characters.map((character) => [character.id, character.locationId]));
  return after.characters.some((character) => previous.get(character.id) !== character.locationId);
}

function aliveChanged(before: WorldSnapshot, after: WorldSnapshot): boolean {
  const previous = new Map(before.characters.map((character) => [character.id, character.alive]));
  return after.characters.some((character) => previous.get(character.id) !== character.alive);
}

function knowledgeChanged(before: WorldSnapshot, after: WorldSnapshot): boolean {
  return JSON.stringify(before.knowledge) !== JSON.stringify(after.knowledge)
    || JSON.stringify(before.claims) !== JSON.stringify(after.claims);
}

function relationshipsChanged(before: WorldSnapshot, after: WorldSnapshot): boolean {
  return JSON.stringify(before.relationships) !== JSON.stringify(after.relationships);
}

function visibilityFilterNpcOutcomes(
  outcomes: NarrativeOutcomeProjection[],
  playerId: string,
): NarrativeOutcomeProjection[] {
  return outcomes.filter((outcome) => {
    if (outcome.type === "relationship.change") {
      return outcome.sourceCharacterId === playerId || outcome.targetCharacterId === playerId;
    }
    if (outcome.type === "claim.transmit") {
      return outcome.sourceCharacterId === playerId || outcome.targetCharacterId === playerId;
    }
    if (outcome.type === "character.learn_claim" || outcome.type === "character.move" || outcome.type === "character.die") {
      return outcome.actorId === playerId;
    }
    if (outcome.type === "world.time_advance") {
      return false;
    }
    return true;
  });
}

function resolveStatus(input: {
  channel: "in_world" | "ooc_meta";
  rejection: ResolvedSceneEnvelope["rejection"];
  committedEvents: CommittedEvent[];
  approvedEphemeralBeats: EphemeralBeat[];
  delivered: TargetedStimulus[];
}): SceneTurnStatus {
  if (input.channel === "ooc_meta") {
    return "ooc";
  }
  if (input.rejection) {
    return input.committedEvents.length === 0 ? "rejected" : "partial";
  }
  if (input.committedEvents.some((event) => event.type !== "world.time_advance")) {
    return "success";
  }
  if (input.approvedEphemeralBeats.length > 0 || input.delivered.length > 0) {
    return "ephemeral_success";
  }
  if (input.committedEvents.length > 0) {
    return "success";
  }
  return "empty";
}
