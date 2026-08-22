import { describe, expect, it } from "vitest";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";
import { rebuildState } from "../../src/engine/projector.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import type { CommittedEvent, WorldSnapshot } from "../../src/domain/types.js";

function createHarness(options: ConstructorParameters<typeof CommitKernel>[1] = {}) {
  const store = new SqliteWorldStore();
  const ids = seedTestWorld(store);
  let nextId = 0;
  const kernel = new CommitKernel(store, {
    clock: () => TEST_TIME,
    idFactory: () => `event-${String(++nextId).padStart(4, "0")}`,
    ...options,
  });
  return { store, ids, kernel };
}

function expectSuccess(result: CommitResult): CommittedEvent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

function expectFailure(result: CommitResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`Expected ${code}, got a successful commit`);
  }
  expect(result.error.code).toBe(code);
}

function sortedSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    world: snapshot.world,
    locations: [...snapshot.locations].sort((a, b) => a.id.localeCompare(b.id)),
    characters: [...snapshot.characters].sort((a, b) => a.id.localeCompare(b.id)),
    facts: [...snapshot.facts].sort((a, b) => a.id.localeCompare(b.id)),
    knowledge: [...snapshot.knowledge].sort((a, b) =>
      `${a.characterId}:${a.factId}`.localeCompare(`${b.characterId}:${b.factId}`),
    ),
    relationships: [...snapshot.relationships].sort((a, b) =>
      `${a.sourceCharacterId}:${a.targetCharacterId}`.localeCompare(`${b.sourceCharacterId}:${b.targetCharacterId}`),
    ),
  };
}

function insertRawEventForTemporalValidation(
  store: SqliteWorldStore,
  input: {
    id: string;
    worldId: string;
    eventTime: string;
    type: string;
    actorIds?: string[];
    targetIds?: string[];
    payload?: Record<string, unknown>;
  },
): void {
  store.sqlite
    .prepare(
      `INSERT INTO events (id, world_id, event_time, event_type, location_id, actor_ids, target_ids, cause_event_ids, payload, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.worldId,
      input.eventTime,
      input.type,
      JSON.stringify(input.actorIds ?? []),
      JSON.stringify(input.targetIds ?? []),
      JSON.stringify([]),
      JSON.stringify(input.payload ?? {}),
      TEST_TIME,
    );
}

describe("World Engine Commit Kernel", () => {
  it("commits a legal move and explains materialized state through Event Log", () => {
    const { store, ids, kernel } = createHarness();
    const initial = store.getSnapshot(ids.world.id);

    const event = expectSuccess(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.beijing.id,
        occurredAt: TEST_TIME,
      }),
    );

    expect(event.type).toBe("character.move");
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(store.getSnapshot(ids.world.id).characters.find((character) => character.id === ids.characters.player.id)?.locationId)
      .toBe(ids.locations.beijing.id);

    const rebuilt = rebuildState(initial, store.listEvents(ids.world.id));
    expect(sortedSnapshot(rebuilt)).toEqual(sortedSnapshot(store.getSnapshot(ids.world.id)));
    store.close();
  });

  it("advances World time for every Event and rejects inversion while allowing same-time Events", () => {
    const { store, ids, kernel } = createHarness();
    const eventTime = "2019-03-12T14:00:00.000Z";
    expectSuccess(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
        occurredAt: eventTime,
      }),
    );
    expect(store.getSnapshot(ids.world.id).world.currentTime).toBe(eventTime);

    const beforeRejectedEvent = store.getSnapshot(ids.world.id);
    expectFailure(
      kernel.commit({
        type: "character.die",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        occurredAt: "2019-03-12T13:00:00.000Z",
      }),
      "INVALID_TIME",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(sortedSnapshot(store.getSnapshot(ids.world.id))).toEqual(sortedSnapshot(beforeRejectedEvent));

    expectSuccess(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.zhao.id,
        targetCharacterId: ids.characters.player.id,
        trustDelta: 1,
        occurredAt: eventTime,
      }),
    );
    expectSuccess(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.player.id,
        targetCharacterId: ids.characters.zhao.id,
        trustDelta: 1,
        occurredAt: eventTime,
      }),
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(3);
    expect(store.getSnapshot(ids.world.id).world.currentTime).toBe(eventTime);
    store.close();
  });

  it("enforces death invariants", () => {
    const { store, ids, kernel } = createHarness();
    expectSuccess(
      kernel.commit({
        type: "character.die",
        worldId: ids.world.id,
        actorId: ids.characters.npcA.id,
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).characters.find((character) => character.id === ids.characters.npcA.id)?.alive).toBe(false);

    expectFailure(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.npcA.id,
        toLocationId: ids.locations.tokyo.id,
        occurredAt: TEST_TIME,
      }),
      "CHARACTER_DEAD",
    );
    expectFailure(
      kernel.commit({
        type: "character.die",
        worldId: ids.world.id,
        actorId: ids.characters.npcA.id,
        occurredAt: TEST_TIME,
      }),
      "CHARACTER_DEAD",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    store.close();
  });

  it("keeps Fact and CharacterKnowledge separate and authorizes character provenance", () => {
    const { store, ids, kernel } = createHarness();
    expect(store.getSnapshot(ids.world.id).knowledge).not.toContainEqual(
      expect.objectContaining({ characterId: ids.characters.player.id, factId: ids.secretFact.id }),
    );

    expectFailure(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "confirmed",
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );

    expectSuccess(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: ids.characters.zhao.id },
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).knowledge).toContainEqual(
      expect.objectContaining({
        characterId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "rumor",
        sourceType: "character",
        sourceCharacterId: ids.characters.zhao.id,
        sourceEventId: null,
      }),
    );
    store.close();
  });

  it("does not infer knowledge from an unrelated fact.assert Event", () => {
    const { store, ids, kernel } = createHarness();
    const factEvent = expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-002",
        actorId: ids.characters.zhao.id,
        subject: ids.characters.zhao.id,
        predicate: "private_status",
        object: "hidden",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
    );
    expectFailure(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: "fact-002",
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: factEvent.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );
    expect(store.getSnapshot(ids.world.id).knowledge).not.toContainEqual(
      expect.objectContaining({ characterId: ids.characters.player.id, factId: "fact-002" }),
    );
    store.close();
  });

  it("allows NPC-A to propagate knowledge to NPC-B without broadcasting to NPC-C", () => {
    const { store, ids, kernel } = createHarness();
    expectSuccess(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.npcB.id,
        factId: ids.secretFact.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: ids.characters.npcA.id },
        occurredAt: TEST_TIME,
      }),
    );
    const knowledge = store.getSnapshot(ids.world.id).knowledge;
    expect(knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.npcB.id,
      factId: ids.secretFact.id,
      sourceType: "character",
      sourceCharacterId: ids.characters.npcA.id,
    }));
    expect(knowledge).not.toContainEqual(expect.objectContaining({
      characterId: ids.characters.npcC.id,
      factId: ids.secretFact.id,
    }));
    store.close();
  });

  it("rejects a source Character that does not know the Fact", () => {
    const { store, ids, kernel } = createHarness();
    expectFailure(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "confirmed",
        source: { kind: "character", characterId: ids.characters.npcB.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );
    store.close();
  });

  it("allows Event provenance only when the learner participated in that Event", () => {
    const { store, ids, kernel } = createHarness();
    const observedEvent = expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-observed",
        actorId: ids.characters.player.id,
        subject: ids.characters.player.id,
        predicate: "observed_signal",
        object: "signal-a",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
    );
    expectSuccess(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: "fact-observed",
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: observedEvent.id },
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      factId: "fact-observed",
      sourceType: "event",
      sourceCharacterId: null,
      sourceEventId: observedEvent.id,
    }));
    store.close();
  });

  it("rejects future Events as causes or knowledge sources for past Candidates", () => {
    const { store, ids, kernel } = createHarness();
    insertRawEventForTemporalValidation(store, {
      id: "future-event",
      worldId: ids.world.id,
      eventTime: "2019-03-12T14:00:00.000Z",
      type: "fact.assert",
      actorIds: [ids.characters.player.id],
      targetIds: [ids.secretFact.id],
      payload: { factId: ids.secretFact.id },
    });

    expectFailure(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
        occurredAt: "2019-03-12T13:00:00.000Z",
        causeEventIds: ["future-event"],
      }),
      "INVALID_TIME",
    );
    expectFailure(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: "future-event" },
        occurredAt: "2019-03-12T13:00:00.000Z",
      }),
      "INVALID_TIME",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    store.close();
  });

  it("rejects overlapping conflicting Facts while retaining history on a later transition", () => {
    const { store, ids, kernel } = createHarness();
    expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-status-1",
        subject: ids.characters.zhao.id,
        predicate: "status",
        object: "missing",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
    );
    expectFailure(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-status-2",
        subject: ids.characters.zhao.id,
        predicate: "status",
        object: "present",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
      "FACT_CONFLICT",
    );

    const transitionTime = "2019-03-12T13:00:00.000Z";
    expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-status-2",
        subject: ids.characters.zhao.id,
        predicate: "status",
        object: "present",
        validFrom: transitionTime,
        occurredAt: transitionTime,
      }),
    );
    const facts = store.getSnapshot(ids.world.id).facts.filter((fact) => fact.predicate === "status");
    expect(facts).toHaveLength(2);
    expect(facts.find((fact) => fact.id === "fact-status-1")?.validTo).toBe(transitionTime);
    expect(facts.find((fact) => fact.id === "fact-status-2")?.sourceType).toBe("event");
    store.close();
  });

  it("stores A→B and B→A relationships independently and traces changes to Events", () => {
    const { store, ids, kernel } = createHarness();
    const forward = expectSuccess(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.zhao.id,
        targetCharacterId: ids.characters.player.id,
        trustDelta: 70,
        relationshipType: "ally",
        occurredAt: TEST_TIME,
      }),
    );
    const reverse = expectSuccess(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.player.id,
        targetCharacterId: ids.characters.zhao.id,
        trustDelta: 30,
        occurredAt: TEST_TIME,
      }),
    );
    const relationships = store.getSnapshot(ids.world.id).relationships;
    expect(relationships).toContainEqual(expect.objectContaining({
      sourceCharacterId: ids.characters.zhao.id,
      targetCharacterId: ids.characters.player.id,
      trust: 70,
      updatedByEventId: forward.id,
    }));
    expect(relationships).toContainEqual(expect.objectContaining({
      sourceCharacterId: ids.characters.player.id,
      targetCharacterId: ids.characters.zhao.id,
      trust: 30,
      updatedByEventId: reverse.id,
    }));
    expectFailure(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.player.id,
        targetCharacterId: ids.characters.player.id,
        trustDelta: 1,
        occurredAt: TEST_TIME,
      }),
      "RELATIONSHIP_INVALID",
    );
    store.close();
  });

  it("rolls back Event and Projection together when a post-append step fails", () => {
    let failed = false;
    const { store, ids, kernel } = createHarness({
      faultInjector: (stage) => {
        if (stage === "after_event_append" && !failed) {
          failed = true;
          throw new Error("injected projector failure");
        }
      },
    });
    const before = store.getSnapshot(ids.world.id);
    const result = kernel.commit({
      type: "character.move",
      worldId: ids.world.id,
      actorId: ids.characters.player.id,
      toLocationId: ids.locations.tokyo.id,
      occurredAt: TEST_TIME,
    });
    expectFailure(result, "COMMIT_FAILED");
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    expect(sortedSnapshot(store.getSnapshot(ids.world.id))).toEqual(sortedSnapshot(before));
    store.close();
  });

  it("protects committed Events from ordinary UPDATE and DELETE", () => {
    const { store, ids, kernel } = createHarness();
    const event = expectSuccess(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
        occurredAt: TEST_TIME,
      }),
    );
    expect(() => store.sqlite.prepare("UPDATE events SET payload = ? WHERE id = ?").run("{}", event.id)).toThrow(/EVENT_APPEND_ONLY/);
    expect(() => store.sqlite.prepare("DELETE FROM events WHERE id = ?").run(event.id)).toThrow(/EVENT_APPEND_ONLY/);
    expect(store.getEvent(event.id)?.type).toBe("character.move");
    store.close();
  });

  it("executes 90 mixed candidates with no partial state and rebuilds from Event Log", () => {
    const { store, ids, kernel } = createHarness();
    const initial = store.getSnapshot(ids.world.id);
    const results: CommitResult[] = [];

    for (let index = 0; index < 20; index += 1) {
      results.push(
        kernel.commit({
          type: "character.move",
          worldId: ids.world.id,
          actorId: ids.characters.npcA.id,
          toLocationId: index % 2 === 0 ? ids.locations.tokyo.id : ids.locations.beijing.id,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "character.move",
          worldId: ids.world.id,
          actorId: `missing-${index}`,
          toLocationId: ids.locations.tokyo.id,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "relationship.change",
          worldId: ids.world.id,
          sourceCharacterId: ids.characters.player.id,
          targetCharacterId: ids.characters.zhao.id,
          trustDelta: 1,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "relationship.change",
          worldId: ids.world.id,
          sourceCharacterId: ids.characters.player.id,
          targetCharacterId: ids.characters.player.id,
          trustDelta: 1,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "fact.assert",
          worldId: ids.world.id,
          factId: `fact-batch-${index}`,
          subject: ids.characters.player.id,
          predicate: `batch_predicate_${index}`,
          object: `object-${index}`,
          validFrom: TEST_TIME,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "character.learn_fact",
          worldId: ids.world.id,
          actorId: ids.characters.player.id,
          factId: ids.secretFact.id,
          knowledgeState: "confirmed",
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      const toTime = `2019-03-12T${String(13 + index).padStart(2, "0")}:00:00.000Z`;
      results.push(
        kernel.commit({
          type: "world.time_advance",
          worldId: ids.world.id,
          toTime,
          occurredAt: TEST_TIME,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(
        kernel.commit({
          type: "character.move",
          worldId: ids.world.id,
          actorId: ids.characters.player.id,
          toLocationId: ids.locations.office.id,
          occurredAt: TEST_TIME,
        }),
      );
    }

    expect(results).toHaveLength(90);
    expect(results.filter((result) => result.ok)).toHaveLength(50);
    expect(results.filter((result) => !result.ok)).toHaveLength(40);
    expect(store.listEvents(ids.world.id)).toHaveLength(50);

    const finalState = store.getSnapshot(ids.world.id);
    const rebuilt = rebuildState(initial, store.listEvents(ids.world.id));
    expect(sortedSnapshot(rebuilt)).toEqual(sortedSnapshot(finalState));
    expect(finalState.world.currentTime).toBe("2019-03-12T22:00:00.000Z");
    expect(finalState.knowledge).not.toContainEqual(
      expect.objectContaining({ characterId: ids.characters.player.id, factId: ids.secretFact.id }),
    );
    expect(finalState.relationships.find(
      (relationship) => relationship.sourceCharacterId === ids.characters.player.id && relationship.targetCharacterId === ids.characters.zhao.id,
    )?.trust).toBe(10);
    store.close();
  });
});
