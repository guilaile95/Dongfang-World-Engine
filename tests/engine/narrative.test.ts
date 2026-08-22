import { describe, expect, it } from "vitest";
import {
  ContextBuilder,
  type BuildCharacterContextInput,
  type CharacterContext,
} from "../../src/engine/context-builder.js";
import { CommitKernel } from "../../src/engine/commit-kernel.js";
import {
  DEFAULT_MAX_NARRATIVE_CHARACTERS,
  DEFAULT_NARRATIVE_INSTRUCTIONS,
  NarrativeEnvelopeBuilder,
  NarrativeError,
  Narrator,
  OpenAICompatibleNarrativeModelClient,
  type NarrativeEnvelope,
  type NarrativeModelClient,
  type NarrativeModelRequest,
} from "../../src/engine/narrative.js";
import { OpenAICompatibleSimulationModelClient } from "../../src/engine/openai-compatible-simulation-client.js";
import { SimulationAdapter, type SimulationPlan } from "../../src/engine/simulation-adapter.js";
import { TurnOrchestrator, type TurnResult } from "../../src/engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import type { CommittedEvent, EventType, WorldSnapshot } from "../../src/domain/types.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";

class FakeNarrativeModel implements NarrativeModelClient {
  public readonly calls: NarrativeModelRequest[] = [];

  public constructor(private readonly response: unknown) {}

  public async generate(request: NarrativeModelRequest): Promise<string> {
    this.calls.push(request);
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response as string;
  }
}

interface FetchCall {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
}

function assistantResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(...responses: Response[]): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("fake fetch response exhausted");
    }
    return response;
  };
  return { calls, fetchImpl };
}

function makeTurnResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    status: "empty",
    worldId: "world-1",
    actorCharacterId: "character-player",
    committedEvents: [],
    state: null,
    rejection: null,
    contextBuilds: 1,
    simulationAttempts: 1,
    ...overrides,
  };
}

function makeEvent(
  type: EventType,
  payload: Record<string, unknown>,
  id = "event-internal-secret",
): CommittedEvent {
  return {
    id,
    sequence: 1,
    worldId: "world-1",
    worldRevision: 1,
    eventTime: TEST_TIME,
    type,
    locationId: null,
    actorIds: ["character-player"],
    targetIds: [],
    causeEventIds: ["cause-internal-secret"],
    payload,
    createdAt: TEST_TIME,
  };
}

function makeContext(): CharacterContext {
  return {
    world: {
      id: "world-1",
      currentTime: TEST_TIME,
      revision: 0,
      status: "active",
    },
    observer: {
      id: "character-player",
      worldId: "world-1",
      name: "玩家",
      type: "player",
      alive: true,
      locationId: "location-office",
      identity: "普通来客",
      currentGoal: "观察",
    },
    location: {
      id: "location-office",
      worldId: "world-1",
      name: "办公室",
      parentId: null,
      type: "building",
    },
    coLocatedCharacters: [],
    knowledge: [],
    relationships: [],
    packing: {
      budget: 10,
      visibleUnits: 0,
      usedUnits: 0,
      truncated: false,
    },
  };
}

function makeEnvelope(overrides: Partial<NarrativeEnvelope> = {}): NarrativeEnvelope {
  return {
    intent: "观察",
    turnStatus: "empty",
    observerContext: makeContext(),
    outcomes: [],
    rejection: null,
    ...overrides,
  };
}

function requestBody(call: FetchCall): Record<string, unknown> {
  expect(call.init?.body).toBeTypeOf("string");
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

describe("Narrative projection MVP", () => {
  it("rebuilds observer Context and never reads TurnResult.state", () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const calls: BuildCharacterContextInput[] = [];
    const delegate = new ContextBuilder(store);
    const contextBuilder = {
      buildCharacterContext(input: BuildCharacterContextInput): CharacterContext {
        calls.push(input);
        return delegate.buildCharacterContext(input);
      },
    };
    const rawState = {
      ...store.getSnapshot(ids.world.id),
      facts: [{ id: "raw-world-secret", worldId: ids.world.id }],
    } as unknown as WorldSnapshot;

    const envelope = new NarrativeEnvelopeBuilder(contextBuilder).build({
      intent: "观察",
      turnResult: makeTurnResult({
        worldId: ids.world.id,
        actorCharacterId: ids.characters.player.id,
        state: rawState,
      }),
    });

    expect(calls).toEqual([{
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
    }]);
    expect(envelope.observerContext.world.revision).toBe(0);
    expect(JSON.stringify(envelope)).not.toContain("raw-world-secret");
    expect(JSON.stringify(envelope)).not.toContain("TurnResult.state");
    store.close();
  });

  it("projects committed actor outcomes through an explicit allowlist", () => {
    const store = new SqliteWorldStore();
    seedTestWorld(store);
    const events: CommittedEvent[] = [
      makeEvent("character.move", { actorId: "character-player", toLocationId: "location-tokyo", rawSecret: "hidden" }),
      makeEvent("character.die", { actorId: "character-player" }),
      makeEvent("character.learn_claim", {
        actorId: "character-player",
        claimId: "claim-1",
        knowledgeState: "rumor",
        source: { kind: "event", eventId: "source-secret" },
      }),
      makeEvent("relationship.change", {
        sourceCharacterId: "character-player",
        targetCharacterId: "character-zhao",
        trustDelta: 1,
        hostilityDelta: 0,
        closenessDelta: -1,
        relationshipType: "ally",
        updatedByEventId: "updated-by-secret",
      }),
      makeEvent("claim.record", {
        actorId: "character-player",
        claimId: "claim-2",
        subject: "character-zhao",
        predicate: "reported_status",
        object: "uncertain",
      }),
      makeEvent("world.time_advance", { toTime: "2019-03-12T13:00:00.000Z" }),
      makeEvent("fact.assert", {
        factId: "fact-hidden",
        sourceEventId: "fact-source-secret",
        sourceSeedId: "seed-secret",
        subject: "character-zhao",
        predicate: "secret",
        object: "hidden",
      }),
    ];
    const envelope = new NarrativeEnvelopeBuilder(new ContextBuilder(store)).build({
      intent: "执行一组结果",
      turnResult: makeTurnResult({ status: "success", committedEvents: events }),
    });

    expect(envelope.outcomes.map((outcome) => outcome.type)).toEqual([
      "character.move",
      "character.die",
      "character.learn_claim",
      "relationship.change",
      "claim.record",
      "world.time_advance",
    ]);
    const serializedOutcomes = JSON.stringify(envelope.outcomes);
    for (const forbidden of [
      "event-internal-secret",
      "cause-internal-secret",
      "rawSecret",
      "source-secret",
      "updated-by-secret",
      "sourceEventId",
      "sourceSeedId",
      "fact-hidden",
    ]) {
      expect(serializedOutcomes).not.toContain(forbidden);
    }
    store.close();
  });

  it("can narrate an empty Turn without writing World state", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const beforeEvents = store.listEvents(ids.world.id);
    const emptyPlan: SimulationPlan = {
      proposals: [],
      diagnostics: {
        modelId: "fake",
        attempts: 1,
        proposalCount: 0,
        repaired: false,
        status: "empty",
      },
    };
    const turnResult = await new TurnOrchestrator({
      stateReader: store,
      contextBuilder: new ContextBuilder(store),
      simulationAdapter: { generate: async () => emptyPlan },
      commitKernel: new CommitKernel(store),
    }).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "观察",
    });
    const model = new FakeNarrativeModel("你静静观察着周围，没有新的行动发生。");
    const narrative = await new Narrator(model).generate(
      new NarrativeEnvelopeBuilder(new ContextBuilder(store)).build({ intent: "观察", turnResult }),
    );

    expect(turnResult.status).toBe("empty");
    expect(narrative).toContain("没有新的行动");
    expect(model.calls[0]!.envelope.outcomes).toEqual([]);
    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    expect(store.listEvents(ids.world.id)).toEqual(beforeEvents);
    store.close();
  });

  it("passes only committed prefix outcomes and safe rejection for partial Turns", () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const envelope = new NarrativeEnvelopeBuilder(new ContextBuilder(store)).build({
      intent: "按顺序执行",
      turnResult: makeTurnResult({
        worldId: ids.world.id,
        actorCharacterId: ids.characters.player.id,
        status: "partial",
        committedEvents: [makeEvent("character.move", {
          actorId: ids.characters.player.id,
          toLocationId: ids.locations.tokyo.id,
        })],
        rejection: {
          kind: "kernel_rejection",
          code: "LOCATION_NOT_FOUND",
          message: "internal diagnostic not for narrator",
          proposalIndex: 1,
        },
      }),
    });

    expect(envelope.outcomes).toHaveLength(1);
    expect(envelope.outcomes[0]).toMatchObject({ type: "character.move" });
    expect(envelope.rejection).toEqual({ kind: "kernel_rejection", code: "LOCATION_NOT_FOUND" });
    expect(envelope.rejection).not.toHaveProperty("message");
    store.close();
  });

  it("does not fabricate outcomes for rejected or stale Turns", () => {
    const store = new SqliteWorldStore();
    seedTestWorld(store);
    const builder = new NarrativeEnvelopeBuilder(new ContextBuilder(store));
    for (const status of ["rejected", "stale"] as const) {
      const envelope = builder.build({
        intent: "尝试行动",
        turnResult: makeTurnResult({
          status,
          rejection: {
            kind: status === "stale" ? "stale_context" : "kernel_rejection",
            code: status === "stale" ? "STALE_CONTEXT" : "LOCATION_NOT_FOUND",
            message: "not exposed",
            proposalIndex: 0,
          },
        }),
      });
      expect(envelope.outcomes).toEqual([]);
      expect(envelope.rejection?.code).toBe(status === "stale" ? "STALE_CONTEXT" : "LOCATION_NOT_FOUND");
    }
    store.close();
  });

  it("publishes the major narrative negative boundaries", () => {
    for (const phrase of [
      "plain player-facing text",
      "authoritative outcomes",
      "observer-visible context",
      "new named characters",
      "secret histories",
      "ownership",
      "deaths",
      "permanent injuries",
      "item locations",
      "locks",
      "factions",
      "resources",
      "major abilities",
      "hidden Truth",
      "private thoughts or knowledge",
      "Ephemeral sensory",
      "empty",
      "rejected",
      "stale",
      "partial",
      "chain-of-thought",
    ]) {
      expect(DEFAULT_NARRATIVE_INSTRUCTIONS).toContain(phrase);
    }
  });

  it("rejects blank and overlong narrator output without World writes", async () => {
    const store = new SqliteWorldStore();
    seedTestWorld(store);
    const beforeSnapshot = store.getSnapshot("world-1");
    const beforeEvents = store.listEvents("world-1");
    const envelope = makeEnvelope();

    await expect(new Narrator(new FakeNarrativeModel("   ")).generate(envelope)).rejects.toMatchObject({
      code: "NARRATIVE_OUTPUT_INVALID",
    });
    await expect(new Narrator(new FakeNarrativeModel("x".repeat(11)), { maxCharacters: 10 }).generate(envelope))
      .rejects.toMatchObject({
        code: "NARRATIVE_OUTPUT_INVALID",
        context: { maxCharacters: 10 },
      });

    expect(store.getSnapshot("world-1")).toEqual(beforeSnapshot);
    expect(store.listEvents("world-1")).toEqual(beforeEvents);
    store.close();
  });

  it("runs a deterministic fake-HTTP narrated turn without exposing raw state", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const simulationOutput = JSON.stringify({
      proposals: [{
        type: "character.move",
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
      }],
    });
    const { calls, fetchImpl } = makeFetch(
      assistantResponse(simulationOutput),
      assistantResponse("你走到了东京，新的位置已被世界记录。"),
    );
    const options = {
      baseUrl: "https://provider.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl,
    };
    const contextBuilder = new ContextBuilder(store);
    const simulationAdapter = new SimulationAdapter(
      new OpenAICompatibleSimulationModelClient(options),
      { modelId: "fake-simulation" },
    );
    let nextEventId = 0;
    const turnResult = await new TurnOrchestrator({
      stateReader: store,
      contextBuilder,
      simulationAdapter,
      commitKernel: new CommitKernel(store, {
        clock: () => TEST_TIME,
        idFactory: () => `narrative-event-${String(++nextEventId).padStart(4, "0")}`,
      }),
    }).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到东京",
    });
    const envelope = new NarrativeEnvelopeBuilder(contextBuilder).build({
      intent: "移动到东京",
      turnResult,
    });
    const narrative = await new Narrator(
      new OpenAICompatibleNarrativeModelClient(options),
    ).generate(envelope);

    expect(turnResult.status).toBe("success");
    expect(turnResult.committedEvents).toHaveLength(1);
    expect(envelope.observerContext.world.revision).toBe(1);
    expect(envelope.outcomes).toEqual([{
      type: "character.move",
      actorId: ids.characters.player.id,
      toLocationId: ids.locations.tokyo.id,
      eventTime: TEST_TIME,
    }]);
    expect(narrative).toContain("东京");
    expect(calls).toHaveLength(2);

    const narratorBody = requestBody(calls[1]!);
    const narratorMessages = narratorBody.messages as Array<Record<string, unknown>>;
    const narratorPayload = JSON.parse(String(narratorMessages[1]?.content)) as Record<string, unknown>;
    expect(narratorPayload).toEqual(envelope);
    expect(narratorPayload).not.toHaveProperty("state");
    expect(narratorPayload).not.toHaveProperty("store");
    expect(narratorPayload).not.toHaveProperty("commitKernel");
    const serialized = JSON.stringify(narratorPayload);
    for (const forbidden of [
      "raw-world-secret",
      "event-internal-secret",
      "cause-internal-secret",
      "sourceEventId",
      "sourceSeedId",
      "FactRecord",
      "WorldSnapshot",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const observerContext = narratorPayload.observerContext as Record<string, unknown>;
    expect(observerContext).not.toHaveProperty("facts");
    const coLocatedCharacters = observerContext.coLocatedCharacters as Array<Record<string, unknown>>;
    for (const character of coLocatedCharacters) {
      expect(character).not.toHaveProperty("currentGoal");
      expect(character).not.toHaveProperty("identity");
    }
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(1);
    store.close();
  });

  it("wraps narrator transport failures without exposing provider details", async () => {
    const envelope = makeEnvelope();
    const model = new FakeNarrativeModel(new Error("provider secret should not escape"));

    let caught: unknown;
    try {
      await new Narrator(model).generate(envelope);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NarrativeError);
    if (caught instanceof NarrativeError) {
      expect(caught.code).toBe("NARRATIVE_TRANSPORT_ERROR");
      expect(caught.message).not.toContain("provider secret");
    }
  });

  it("keeps the default narrative output bound to a reasonable size", () => {
    expect(DEFAULT_MAX_NARRATIVE_CHARACTERS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_NARRATIVE_CHARACTERS).toBeLessThanOrEqual(10_000);
  });
});
