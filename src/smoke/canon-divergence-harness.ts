import type { CommittedEvent } from "../domain/types.js";
import { CommitKernel, type CommitResult } from "../engine/commit-kernel.js";
import { ContextBuilder } from "../engine/context-builder.js";
import { rebuildState } from "../engine/projector.js";
import { SimulationAdapter, type SimulationModelClient } from "../engine/simulation-adapter.js";
import { TurnOrchestrator, type TurnResult } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  CANON_DIVERGENCE_T1,
  CANON_DIVERGENCE_T2,
  CANON_DIVERGENCE_T3,
  CANON_DIVERGENCE_T4,
  seedCanonDivergenceWorld,
  type CanonDivergenceFixtureIds,
} from "../testkit/canon-divergence-world.js";
import { canonicalSnapshot } from "./closed-inn-harness.js";

export const DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT =
  "只能根据当前合法可见的地点选项，决定是否前往西塔阻止旧命令；不要声称任何未提交的客观事实。";

export interface CanonDivergenceHarnessOptions {
  store: SqliteWorldStore;
  simulationModel: SimulationModelClient;
  fixtureSuffix?: string;
  playerIntent?: string;
}

export interface SafeCanonEventTrace {
  type: CommittedEvent["type"];
  worldRevision: number;
}

export interface CanonDivergenceRunResult {
  fixture: {
    worldId: string;
    playerId: string;
    interventionLocationId: string;
  };
  playerTurn: {
    status: TurnResult["status"];
    committedEvents: SafeCanonEventTrace[];
    rejection: {
      kind: string;
      code: string;
    } | null;
  };
  authoredConsequence: {
    triggered: boolean;
    sourceEventWorldRevision: number | null;
    committedEventWorldRevision: number | null;
  };
  oldCanonAttempt: {
    committed: boolean;
    rejectionCode: string | null;
    rejectionLeftStateUnchanged: boolean | null;
  };
  independentEvent: SafeCanonEventTrace;
  finalWorldRevision: number;
  committedEventCount: number;
  replayConsistent: boolean;
}

interface CanonTrustedCommitKernel {
  commit(input: unknown): CommitResult;
}

export function commitAuthoredInterventionFromEvent(
  store: SqliteWorldStore,
  commitKernel: CanonTrustedCommitKernel,
  fixture: CanonDivergenceFixtureIds,
  sourceEventId: string,
): CommitResult | null {
  const sourceEvent = store.getEvent(sourceEventId);
  if (!sourceEvent) {
    return null;
  }
  const snapshot = store.getSnapshot(fixture.worldId);
  const player = snapshot.characters.find((character) => character.id === fixture.playerId);
  if (
    sourceEvent.worldId !== fixture.worldId ||
    sourceEvent.worldRevision !== snapshot.world.revision ||
    sourceEvent.type !== "character.move" ||
    sourceEvent.actorIds.length !== 1 ||
    sourceEvent.actorIds[0] !== fixture.playerId ||
    sourceEvent.payload.actorId !== fixture.playerId ||
    sourceEvent.payload.toLocationId !== fixture.westTowerId ||
    player?.locationId !== fixture.westTowerId
  ) {
    return null;
  }

  return commitKernel.commit({
    type: "fact.assert",
    worldId: fixture.worldId,
    expectedWorldRevision: snapshot.world.revision,
    factId: `fact-intervention-b-prime-${fixture.worldId}`,
    actorId: fixture.playerId,
    subject: fixture.npcAId,
    predicate: "watch_route",
    object: "west_tower",
    validFrom: CANON_DIVERGENCE_T2,
    occurredAt: CANON_DIVERGENCE_T2,
    causeEventIds: [sourceEvent.id],
  });
}

export async function runCanonDivergenceScenario(
  options: CanonDivergenceHarnessOptions,
): Promise<CanonDivergenceRunResult> {
  const suffix = options.fixtureSuffix ?? "action-binding";
  const fixture = seedCanonDivergenceWorld(options.store, suffix);
  const initialSnapshot = options.store.getSnapshot(fixture.worldId);
  let nextEventId = 0;
  const commitKernel = new CommitKernel(options.store, {
    clock: () => CANON_DIVERGENCE_T4,
    idFactory: () => `event-canon-binding-${suffix}-${String(++nextEventId).padStart(2, "0")}`,
  });

  const baselineB = requireCommitted(commitTrustedFact(options.store, commitKernel, {
    worldId: fixture.worldId,
    factId: `fact-baseline-b-${fixture.worldId}`,
    subject: fixture.npcAId,
    predicate: "watch_route",
    object: "east_gate",
    validFrom: CANON_DIVERGENCE_T1,
    occurredAt: CANON_DIVERGENCE_T1,
  }), "baseline B");

  const orchestrator = new TurnOrchestrator({
    stateReader: options.store,
    contextBuilder: new ContextBuilder(options.store),
    simulationAdapter: new SimulationAdapter(options.simulationModel, {
      modelId: "canon-divergence-injected-model",
    }),
    commitKernel,
  });
  const playerTurn = await orchestrator.runActorTurn({
    worldId: fixture.worldId,
    actorCharacterId: fixture.playerId,
    intent: options.playerIntent ?? DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT,
  });

  let authoredConsequenceEvent: CommittedEvent | null = null;
  let authoredConsequenceSource: CommittedEvent | null = null;
  for (const event of playerTurn.committedEvents) {
    const consequence = commitAuthoredInterventionFromEvent(options.store, commitKernel, fixture, event.id);
    if (consequence === null) {
      continue;
    }
    authoredConsequenceEvent = requireCommitted(consequence, "authored B' consequence");
    authoredConsequenceSource = event;
    break;
  }

  const beforeOldCanonState = options.store.getSnapshot(fixture.worldId);
  const beforeOldCanonEvents = options.store.listEvents(fixture.worldId);
  const oldCanonAttempt = commitTrustedFact(options.store, commitKernel, {
    worldId: fixture.worldId,
    factId: `fact-old-c-${fixture.worldId}`,
    subject: fixture.npcCId,
    predicate: "delivery_outcome",
    object: "old_canon_arrest",
    validFrom: CANON_DIVERGENCE_T3,
    occurredAt: CANON_DIVERGENCE_T3,
    causeEventIds: [baselineB.id],
  });
  const afterOldCanonState = options.store.getSnapshot(fixture.worldId);
  const afterOldCanonEvents = options.store.listEvents(fixture.worldId);
  const rejectionLeftStateUnchanged = oldCanonAttempt.ok
    ? null
    : canonicalEqual(beforeOldCanonState, afterOldCanonState) &&
      JSON.stringify(beforeOldCanonEvents) === JSON.stringify(afterOldCanonEvents);

  const independentEvent = requireCommitted(commitTrustedFact(options.store, commitKernel, {
    worldId: fixture.worldId,
    factId: `fact-independent-d-${fixture.worldId}`,
    subject: fixture.npcBId,
    predicate: "dawn_market_status",
    object: "open",
    validFrom: CANON_DIVERGENCE_T4,
    occurredAt: CANON_DIVERGENCE_T4,
  }), "independent D");

  const finalSnapshot = options.store.getSnapshot(fixture.worldId);
  const committedEvents = options.store.listEvents(fixture.worldId);
  const rebuilt = rebuildState(initialSnapshot, committedEvents);

  return {
    fixture: {
      worldId: fixture.worldId,
      playerId: fixture.playerId,
      interventionLocationId: fixture.westTowerId,
    },
    playerTurn: {
      status: playerTurn.status,
      committedEvents: playerTurn.committedEvents.map(toSafeEventTrace),
      rejection: playerTurn.rejection
        ? { kind: playerTurn.rejection.kind, code: playerTurn.rejection.code }
        : null,
    },
    authoredConsequence: {
      triggered: authoredConsequenceEvent !== null,
      sourceEventWorldRevision: authoredConsequenceSource?.worldRevision ?? null,
      committedEventWorldRevision: authoredConsequenceEvent?.worldRevision ?? null,
    },
    oldCanonAttempt: {
      committed: oldCanonAttempt.ok,
      rejectionCode: oldCanonAttempt.ok ? null : oldCanonAttempt.error.code,
      rejectionLeftStateUnchanged,
    },
    independentEvent: toSafeEventTrace(independentEvent),
    finalWorldRevision: finalSnapshot.world.revision,
    committedEventCount: committedEvents.length,
    replayConsistent: canonicalEqual(rebuilt, finalSnapshot),
  };
}

function commitTrustedFact(
  store: SqliteWorldStore,
  commitKernel: CanonTrustedCommitKernel,
  input: {
    worldId: string;
    factId: string;
    subject: string;
    predicate: string;
    object: string;
    validFrom: string;
    occurredAt: string;
    causeEventIds?: string[];
  },
): CommitResult {
  return commitKernel.commit({
    type: "fact.assert",
    expectedWorldRevision: store.getSnapshot(input.worldId).world.revision,
    causeEventIds: [],
    ...input,
  });
}

function requireCommitted(result: CommitResult, label: string): CommittedEvent {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

function toSafeEventTrace(event: CommittedEvent): SafeCanonEventTrace {
  return {
    type: event.type,
    worldRevision: event.worldRevision,
  };
}

function canonicalEqual(
  first: ReturnType<SqliteWorldStore["getSnapshot"]>,
  second: ReturnType<SqliteWorldStore["getSnapshot"]>,
): boolean {
  return JSON.stringify(canonicalSnapshot(first)) === JSON.stringify(canonicalSnapshot(second));
}
