import { describe, expect, it } from "vitest";
import { ContextBuilder, type BuildCharacterContextInput } from "../../src/engine/context-builder.js";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { KernelError } from "../../src/engine/errors.js";
import {
  SimulationAdapterError,
  type CandidateProposal,
  type SimulationPlan,
  type SimulationRequest,
} from "../../src/engine/simulation-adapter.js";
import {
  TurnOrchestrator,
  type TurnCommitKernel,
  type TurnContextBuilder,
  type TurnSimulationAdapter,
  type TurnOrchestratorOptions,
} from "../../src/engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import type { CharacterRecord, LocationRecord, SeedRecord, WorldRecord } from "../../src/domain/types.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";

const FUTURE_TIME = "2019-03-12T13:00:00.000Z";

class FakePlanner implements TurnSimulationAdapter {
  public readonly calls: SimulationRequest[] = [];

  public constructor(
    private readonly respond: (request: SimulationRequest, attempt: number) => SimulationPlan | Promise<SimulationPlan>,
  ) {}

  public async generate(request: SimulationRequest): Promise<SimulationPlan> {
    this.calls.push(request);
    return this.respond(request, this.calls.length);
  }
}

class RecordingContextBuilder implements TurnContextBuilder {
  public readonly calls: BuildCharacterContextInput[] = [];

  public constructor(private readonly delegate: ContextBuilder) {}

  public buildCharacterContext(input: BuildCharacterContextInput) {
    this.calls.push(input);
    return this.delegate.buildCharacterContext(input);
  }
}

class RecordingCommitKernel implements TurnCommitKernel {
  public readonly inputs: unknown[] = [];

  public constructor(private readonly delegate: (input: unknown) => CommitResult) {}

  public commit(input: unknown): CommitResult {
    this.inputs.push(input);
    return this.delegate(input);
  }
}

function createKernel(store: SqliteWorldStore, prefix: string): CommitKernel {
  let nextId = 0;
  return new CommitKernel(store, {
    clock: () => TEST_TIME,
    idFactory: () => `${prefix}-${String(++nextId).padStart(4, "0")}`,
  });
}

function createOrchestrator(
  store: SqliteWorldStore,
  planner: TurnSimulationAdapter,
  commitKernel: TurnCommitKernel,
  contextBuilder: TurnContextBuilder = new ContextBuilder(store),
  options: TurnOrchestratorOptions = {},
): TurnOrchestrator {
  return new TurnOrchestrator(
    {
      stateReader: store,
      contextBuilder,
      simulationAdapter: planner,
      commitKernel,
    },
    options,
  );
}

function makePlan(...proposals: CandidateProposal[]): SimulationPlan {
  return {
    proposals,
    diagnostics: {
      modelId: "fake-planner",
      attempts: 1,
      proposalCount: proposals.length,
      repaired: false,
      status: proposals.length === 0 ? "empty" : "success",
    },
  };
}

function makeMove(actorId: string, toLocationId: string): CandidateProposal {
  return {
    type: "character.move",
    actorId,
    toLocationId,
  };
}

function makeDie(actorId: string): CandidateProposal {
  return {
    type: "character.die",
    actorId,
  };
}

function makeRelationship(sourceCharacterId: string, targetCharacterId: string, trustDelta = 1): CandidateProposal {
  return {
    type: "relationship.change",
    sourceCharacterId,
    targetCharacterId,
    trustDelta,
  };
}

function makeTimeAdvance(toTime: string): CandidateProposal {
  return {
    type: "world.time_advance",
    toTime,
  };
}

function commitExternalRelationship(
  store: SqliteWorldStore,
  worldId: string,
  sourceCharacterId: string,
  targetCharacterId: string,
  prefix: string,
): void {
  const result = createKernel(store, prefix).commit({
    ...makeRelationship(sourceCharacterId, targetCharacterId),
    worldId,
    expectedWorldRevision: store.getSnapshot(worldId).world.revision,
    occurredAt: store.getSnapshot(worldId).world.currentTime,
    causeEventIds: [],
  });
  expect(result.ok).toBe(true);
}

function expectNoActionFailedEvent(store: SqliteWorldStore, worldId: string): void {
  expect(store.listEvents(worldId).some((event) => (event.type as string) === "action.failed")).toBe(false);
}

function seedForeignWorld(store: SqliteWorldStore): CharacterRecord {
  const world: WorldRecord = {
    id: "world-foreign",
    name: "Foreign World",
    currentTime: TEST_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: "seed-foreign",
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "tests/engine/turn-orchestrator.test.ts",
    metadata: "{}",
  };
  const location: LocationRecord = {
    id: "location-foreign",
    worldId: world.id,
    name: "Foreign Location",
    parentId: null,
    type: "city",
  };
  const character: CharacterRecord = {
    id: "character-foreign",
    worldId: world.id,
    name: "Foreign Character",
    type: "npc",
    alive: true,
    locationId: location.id,
    identity: "foreign",
    currentGoal: "test world boundary",
  };
  store.seedWorld({ world, seed, locations: [location], characters: [character] });
  return character;
}

describe("Turn Orchestrator MVP", () => {
  it("builds Context from the turn identity and ignores a caller-supplied Context", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const contextBuilder = new RecordingContextBuilder(new ContextBuilder(store));
    const planner = new FakePlanner((request) => {
      expect(request.context.observer.id).toBe(ids.characters.player.id);
      expect(request.context.world.revision).toBe(0);
      return makePlan();
    });
    const orchestrator = createOrchestrator(
      store,
      planner,
      new RecordingCommitKernel(() => {
        throw new Error("empty turn must not commit");
      }),
      contextBuilder,
    );

    const result = await orchestrator.runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "观察周围",
      contextBudget: 7,
      ...( { context: { world: { revision: 999 } } } as Record<string, unknown> ),
    } as never);

    expect(result.status).toBe("empty");
    expect(contextBuilder.calls).toEqual([{
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 7,
    }]);
    expect(planner.calls).toHaveLength(1);
    store.close();
  });

  it("returns empty without writing when the planner returns zero proposals", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const beforeEvents = store.listEvents(ids.world.id);
    const planner = new FakePlanner(() => makePlan());
    const commitKernel = new RecordingCommitKernel(() => {
      throw new Error("empty turn must not commit");
    });
    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "等待",
    });

    expect(result.status).toBe("empty");
    expect(result.committedEvents).toEqual([]);
    expect(result.rejection).toBeNull();
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    expect(store.listEvents(ids.world.id)).toEqual(beforeEvents);
    store.close();
  });

  it("binds trusted envelope fields and commits through the Kernel", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const planner = new FakePlanner(() => makePlan(makeMove(ids.characters.player.id, ids.locations.tokyo.id)));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到东京",
    });

    expect(result.status).toBe("success");
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]!.worldRevision).toBe(1);
    expect(result.committedEvents[0]!.eventTime).toBe(TEST_TIME);
    expect(commitKernel.inputs[0]).toEqual({
      type: "character.move",
      actorId: ids.characters.player.id,
      toLocationId: ids.locations.tokyo.id,
      worldId: ids.world.id,
      expectedWorldRevision: 0,
      occurredAt: TEST_TIME,
      causeEventIds: [],
    });
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    store.close();
  });

  it("prevalidates the whole plan before committing any proposal", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const forbiddenFactAssert = {
      type: "fact.assert",
      factId: "fact-actor-forbidden",
      actorId: ids.characters.player.id,
      subject: ids.characters.zhao.id,
      predicate: "objective_status",
      object: "guilty",
      validFrom: TEST_TIME,
    } as never;
    const planner = new FakePlanner(() => makePlan(
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
      forbiddenFactAssert,
    ));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "合法移动后尝试越权事实写入",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "proposal_invalid",
      code: "MODEL_OUTPUT_INVALID",
      proposalIndex: 1,
    });
    expect(result.committedEvents).toEqual([]);
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    store.close();
  });

  it("rejects a plan above the configured execution cap before Kernel invocation", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const maxProposalsPerTurn = 2;
    const planner = new FakePlanner(() => makePlan(
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
      makeMove(ids.characters.player.id, ids.locations.beijing.id),
      makeMove(ids.characters.player.id, ids.locations.office.id),
    ));

    const result = await createOrchestrator(
      store,
      planner,
      commitKernel,
      new ContextBuilder(store),
      { maxProposalsPerTurn },
    ).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "超出单回合 Proposal 安全上限",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "execution_limit",
      code: "PROPOSAL_LIMIT_EXCEEDED",
      proposalIndex: null,
    });
    expect(result.committedEvents).toEqual([]);
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    store.close();
  });

  it("chains revisions in proposal order and never accepts model envelope fields", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const planner = new FakePlanner(() => makePlan(
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
      makeDie(ids.characters.player.id),
    ));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "先移动，再结束行动",
    });

    expect(result.status).toBe("success");
    expect(result.committedEvents.map((event) => event.worldRevision)).toEqual([1, 2]);
    expect(result.committedEvents.map((event) => event.type)).toEqual(["character.move", "character.die"]);
    expect(commitKernel.inputs.map((input) => (input as { expectedWorldRevision: number }).expectedWorldRevision))
      .toEqual([0, 1]);
    expect(commitKernel.inputs.every((input) => !(input as Record<string, unknown>).modelRevision)).toBe(true);
    store.close();
  });

  it("binds later proposals to the authoritative time after time advance", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const planner = new FakePlanner(() => makePlan(
      makeTimeAdvance(FUTURE_TIME),
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
    ));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "让时间流逝后移动",
    });

    expect(result.status).toBe("success");
    expect(commitKernel.inputs[0]).toMatchObject({
      type: "world.time_advance",
      toTime: FUTURE_TIME,
      occurredAt: TEST_TIME,
      expectedWorldRevision: 0,
      causeEventIds: [],
    });
    expect(commitKernel.inputs[1]).toMatchObject({
      type: "character.move",
      occurredAt: FUTURE_TIME,
      expectedWorldRevision: 1,
      causeEventIds: [],
    });
    expect(result.committedEvents.map((event) => event.eventTime)).toEqual([FUTURE_TIME, FUTURE_TIME]);
    expect(result.state?.world.currentTime).toBe(FUTURE_TIME);
    store.close();
  });

  it("returns rejected on the first non-stale Kernel rejection without re-simulation", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const planner = new FakePlanner(() => makePlan(makeMove(ids.characters.player.id, "location-missing")));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到不存在的位置",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "kernel_rejection",
      code: "LOCATION_NOT_FOUND",
      proposalIndex: 0,
    });
    expect(result.simulationAttempts).toBe(1);
    expect(result.contextBuilds).toBe(1);
    expect(result.committedEvents).toEqual([]);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    expectNoActionFailedEvent(store, ids.world.id);
    store.close();
  });

  it("preserves a committed prefix and stops at the first later rejection", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const planner = new FakePlanner(() => makePlan(
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
      makeMove(ids.characters.player.id, "location-missing"),
      makeMove(ids.characters.player.id, ids.locations.beijing.id),
    ));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "按顺序执行移动",
    });

    expect(result.status).toBe("partial");
    expect(result.committedEvents.map((event) => event.type)).toEqual(["character.move"]);
    expect(result.committedEvents[0]!.worldRevision).toBe(1);
    expect(result.rejection).toMatchObject({
      kind: "kernel_rejection",
      code: "LOCATION_NOT_FOUND",
      proposalIndex: 1,
    });
    expect(commitKernel.inputs).toHaveLength(2);
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(store.getSnapshot(ids.world.id).characters.find((character) => character.id === ids.characters.player.id)?.locationId)
      .toBe(ids.locations.tokyo.id);
    expectNoActionFailedEvent(store, ids.world.id);
    store.close();
  });

  it("rebuilds and re-simulates at most once when the world changes before the first commit", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const planner = new FakePlanner((request, attempt) => {
      if (attempt === 1) {
        commitExternalRelationship(
          store,
          ids.world.id,
          ids.characters.player.id,
          ids.characters.zhao.id,
          "external",
        );
      }
      expect(request.context.world.revision).toBe(attempt - 1);
      return makePlan(makeMove(ids.characters.player.id, ids.locations.tokyo.id));
    });
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));
    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "在外部变化后移动",
    });

    expect(result.status).toBe("success");
    expect(result.contextBuilds).toBe(2);
    expect(result.simulationAttempts).toBe(2);
    expect(planner.calls).toHaveLength(2);
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]!.worldRevision).toBe(2);
    expect(store.listEvents(ids.world.id)).toHaveLength(2);
    store.close();
  });

  it("returns stable stale context after a second pre-commit world change", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const planner = new FakePlanner((request, attempt) => {
      commitExternalRelationship(
        store,
        ids.world.id,
        ids.characters.player.id,
        ids.characters.zhao.id,
        `external-${attempt}`,
      );
      return makePlan(makeMove(ids.characters.player.id, ids.locations.tokyo.id));
    });
    const rawKernel = createKernel(store, "turn");
    const commitKernel = new RecordingCommitKernel((input) => rawKernel.commit(input));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "持续变化时不要无限重试",
    });

    expect(result.status).toBe("stale");
    expect(result.rejection).toMatchObject({
      kind: "stale_context",
      code: "STALE_CONTEXT",
      proposalIndex: 0,
    });
    expect(result.contextBuilds).toBe(2);
    expect(result.simulationAttempts).toBe(2);
    expect(result.committedEvents).toEqual([]);
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(2);
    expectNoActionFailedEvent(store, ids.world.id);
    store.close();
  });

  it("uses the same single retry budget for a stale first Kernel commit", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    let commitAttempts = 0;
    const commitKernel: TurnCommitKernel = {
      commit(input: unknown): CommitResult {
        commitAttempts += 1;
        if (commitAttempts === 1) {
          return {
            ok: false,
            error: new KernelError("STALE_WORLD_STATE", "injected stale first commit"),
          };
        }
        return rawKernel.commit(input);
      },
    };
    const planner = new FakePlanner(() => makePlan(makeMove(ids.characters.player.id, ids.locations.tokyo.id)));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "首次提交发生陈旧冲突",
    });

    expect(result.status).toBe("success");
    expect(result.contextBuilds).toBe(2);
    expect(result.simulationAttempts).toBe(2);
    expect(commitAttempts).toBe(2);
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    store.close();
  });

  it("stops on stale conflict after a committed prefix without re-simulation or revision adoption", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const rawKernel = createKernel(store, "turn");
    let commitAttempts = 0;
    const recordedInputs: unknown[] = [];
    const commitKernel: TurnCommitKernel = {
      commit(input: unknown): CommitResult {
        recordedInputs.push(input);
        commitAttempts += 1;
        if (commitAttempts === 2) {
          commitExternalRelationship(
            store,
            ids.world.id,
            ids.characters.player.id,
            ids.characters.zhao.id,
            "external",
          );
        }
        return rawKernel.commit(input);
      },
    };
    const planner = new FakePlanner(() => makePlan(
      makeMove(ids.characters.player.id, ids.locations.tokyo.id),
      makeDie(ids.characters.player.id),
    ));

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "第二个提案发生并发冲突",
    });

    expect(result.status).toBe("partial");
    expect(result.rejection).toMatchObject({
      kind: "stale_after_partial",
      code: "STALE_WORLD_STATE",
      proposalIndex: 1,
    });
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]!.worldRevision).toBe(1);
    expect(result.state?.world.revision).toBe(1);
    expect(planner.calls).toHaveLength(1);
    expect(recordedInputs).toHaveLength(2);
    expect((recordedInputs[1] as { expectedWorldRevision: number }).expectedWorldRevision).toBe(1);
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(2);
    expect(store.listEvents(ids.world.id)).toHaveLength(2);
    store.close();
  });

  it("does not write when Simulation Adapter transport fails", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const planner = new FakePlanner(() => {
      throw new SimulationAdapterError(
        "MODEL_TRANSPORT_ERROR",
        "transport unavailable",
        {
          modelId: "fake-model",
          attempts: 1,
          proposalCount: 0,
          errorCategory: "transport",
        },
      );
    });
    const commitKernel = new RecordingCommitKernel(() => {
      throw new Error("transport failure must not commit");
    });

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "观察",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "simulation",
      code: "MODEL_TRANSPORT_ERROR",
    });
    expect(result.committedEvents).toEqual([]);
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    store.close();
  });

  it("rejects cross-world actor references through Context authority", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const foreignCharacter = seedForeignWorld(store);
    const planner = new FakePlanner(() => makePlan());
    const commitKernel = new RecordingCommitKernel(() => {
      throw new Error("cross-world Context must not commit");
    });

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: foreignCharacter.id,
      intent: "跨世界行动",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "context",
      code: "CROSS_WORLD_REFERENCE",
    });
    expect(planner.calls).toHaveLength(0);
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    store.close();
  });

  it("rejects fact.assert even when an injected planner bypasses the Adapter schema", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const unsupportedPlan = makePlan({
      type: "fact.assert",
      factId: "fact-actor-forbidden",
      actorId: ids.characters.player.id,
      subject: ids.characters.zhao.id,
      predicate: "objective_status",
      object: "guilty",
      validFrom: TEST_TIME,
    } as never);
    const planner = new FakePlanner(() => unsupportedPlan);
    const commitKernel = new RecordingCommitKernel(() => {
      throw new Error("unsupported actor proposal must not reach Kernel");
    });

    const result = await createOrchestrator(store, planner, commitKernel).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "把猜测直接变成事实",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({
      kind: "proposal_invalid",
      code: "MODEL_OUTPUT_INVALID",
      proposalIndex: 0,
    });
    expect(commitKernel.inputs).toHaveLength(0);
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    store.close();
  });

  it("produces the same Turn result with deterministic planner and Kernel", async () => {
    async function runOnce() {
      const store = new SqliteWorldStore();
      const ids = seedTestWorld(store);
      const planner = new FakePlanner(() => makePlan(makeMove(ids.characters.player.id, ids.locations.tokyo.id)));
      const result = await createOrchestrator(store, planner, createKernel(store, "turn")).runActorTurn({
        worldId: ids.world.id,
        actorCharacterId: ids.characters.player.id,
        intent: "确定性移动",
      });
      const events = store.listEvents(ids.world.id);
      store.close();
      return { result, events };
    }

    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
  });
});
