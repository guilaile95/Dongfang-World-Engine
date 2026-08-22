import { describe, expect, it } from "vitest";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { KernelError } from "../../src/engine/errors.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";
import { rebuildState } from "../../src/engine/projector.js";
import { SqliteWorldStore, type SeedWorldInput } from "../../src/persistence/sqlite-store.js";
import type {
  CharacterRecord,
  ClaimRecord,
  CommittedEvent,
  FactRecord,
  KnowledgeRecord,
  LocationRecord,
  SeedRecord,
  WorldRecord,
  WorldSnapshot,
} from "../../src/domain/types.js";

function createHarness(options: ConstructorParameters<typeof CommitKernel>[1] = {}) {
  const store = new SqliteWorldStore();
  const ids = seedTestWorld(store);
  let nextId = 0;
  const rawKernel = new CommitKernel(store, {
    clock: () => TEST_TIME,
    idFactory: () => `event-${String(++nextId).padStart(4, "0")}`,
    ...options,
  });
  const kernel = {
    commit(input: unknown): CommitResult {
      if (isRecord(input) && !("expectedWorldRevision" in input)) {
        return rawKernel.commit({
          ...input,
          expectedWorldRevision: store.getSnapshot(ids.world.id).world.revision,
        });
      }
      return rawKernel.commit(input);
    },
  };
  return { store, ids, kernel };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function expectSeedFailure(action: () => void, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}, but seedWorld succeeded`);
  } catch (error) {
    expect(error).toBeInstanceOf(KernelError);
    if (error instanceof KernelError) {
      expect(error.code).toBe(code);
    }
  }
}

function sortedSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    world: snapshot.world,
    locations: [...snapshot.locations].sort((a, b) => a.id.localeCompare(b.id)),
    characters: [...snapshot.characters].sort((a, b) => a.id.localeCompare(b.id)),
    facts: [...snapshot.facts].sort((a, b) => a.id.localeCompare(b.id)),
    claims: [...snapshot.claims].sort((a, b) => a.id.localeCompare(b.id)),
    knowledge: [...snapshot.knowledge].sort((a, b) =>
      `${a.characterId}:${a.claimId}`.localeCompare(`${b.characterId}:${b.claimId}`),
    ),
    predicatePolicies: [...snapshot.predicatePolicies].sort((a, b) => a.predicate.localeCompare(b.predicate)),
    relationships: [...snapshot.relationships].sort((a, b) =>
      `${a.sourceCharacterId}:${a.targetCharacterId}`.localeCompare(`${b.sourceCharacterId}:${b.targetCharacterId}`),
    ),
    seed: snapshot.seed,
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
      `INSERT INTO events (id, world_id, world_revision, event_time, event_type, location_id, actor_ids, target_ids, cause_event_ids, payload, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.worldId,
      1,
      input.eventTime,
      input.type,
      JSON.stringify(input.actorIds ?? []),
      JSON.stringify(input.targetIds ?? []),
      JSON.stringify([]),
      JSON.stringify(input.payload ?? {}),
      TEST_TIME,
  );
}

function seedForeignWorld(store: SqliteWorldStore): {
  world: WorldRecord;
  seed: SeedRecord;
  character: CharacterRecord;
  claim: ClaimRecord;
  location: LocationRecord;
} {
  const world: WorldRecord = {
    id: "world-foreign",
    name: "Foreign Test World",
    currentTime: TEST_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: "seed-foreign-world-v1",
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "tests/engine/commit-kernel.test.ts",
    metadata: JSON.stringify({ name: "foreign-world-fixture", version: 1 }),
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
    currentGoal: "test isolation",
  };
  const claim: ClaimRecord = {
    id: "claim-foreign",
    worldId: world.id,
    subject: character.id,
    predicate: "foreign_claim",
    object: "foreign-object",
    sourceEventId: null,
    sourceSeedId: seed.id,
    recordedAt: TEST_TIME,
  };
  store.seedWorld({
    world,
    seed,
    locations: [location],
    characters: [character],
    claims: [claim],
  });
  return { world, seed, character, claim, location };
}

function createSeedInput(suffix: string): SeedWorldInput {
  const world: WorldRecord = {
    id: `world-seed-${suffix}`,
    name: `Seed World ${suffix}`,
    currentTime: TEST_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: `seed-world-${suffix}-v1`,
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "tests/engine/commit-kernel.test.ts",
    metadata: JSON.stringify({ name: `seed-world-${suffix}`, version: 1 }),
  };
  const location: LocationRecord = {
    id: `location-seed-${suffix}`,
    worldId: world.id,
    name: `Seed Location ${suffix}`,
    parentId: null,
    type: "city",
  };
  const characterA: CharacterRecord = {
    id: `character-seed-${suffix}-a`,
    worldId: world.id,
    name: `Seed Character ${suffix} A`,
    type: "npc",
    alive: true,
    locationId: location.id,
    identity: "seed-a",
    currentGoal: "test seed integrity",
  };
  const characterB: CharacterRecord = {
    ...characterA,
    id: `character-seed-${suffix}-b`,
    name: `Seed Character ${suffix} B`,
  };
  const fact: FactRecord = {
    id: `fact-seed-${suffix}`,
    worldId: world.id,
    subject: characterA.id,
    predicate: "seed_fact",
    object: "valid",
    validFrom: TEST_TIME,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };
  const claim: ClaimRecord = {
    id: `claim-seed-${suffix}`,
    worldId: world.id,
    subject: characterA.id,
    predicate: "seed_claim",
    object: "valid",
    sourceEventId: null,
    sourceSeedId: seed.id,
    recordedAt: TEST_TIME,
  };
  return {
    world,
    seed,
    locations: [location],
    characters: [characterA, characterB],
    facts: [fact],
    claims: [claim],
    relationships: [{
      sourceCharacterId: characterA.id,
      targetCharacterId: characterB.id,
      trust: 0,
      hostility: 0,
      closeness: 0,
      relationshipType: "test",
      updatedByEventId: null,
    }],
  };
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

  it("assigns one World revision per successful Event and exposes deterministic identities", () => {
    const { store, ids, kernel } = createHarness();
    const initial = store.getSnapshot(ids.world.id);
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(0);

    const first = expectSuccess(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.beijing.id,
        occurredAt: TEST_TIME,
      }),
    );
    const second = expectSuccess(
      kernel.commit({
        type: "relationship.change",
        worldId: ids.world.id,
        sourceCharacterId: ids.characters.zhao.id,
        targetCharacterId: ids.characters.player.id,
        trustDelta: 1,
        occurredAt: TEST_TIME,
      }),
    );

    expect(first.sequence).toBe(1);
    expect(first.worldRevision).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second.worldRevision).toBe(2);
    expect(first.eventTime).toBe(second.eventTime);
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(2);
    expect(store.listEvents(ids.world.id).map((event) => [event.sequence, event.worldRevision])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(rebuildState(initial, store.listEvents(ids.world.id)).world.revision).toBe(2);
    store.close();
  });

  it("rejects stale Candidates without changing Event Log or Materialized State", () => {
    const { store, ids, kernel } = createHarness();
    const first = expectSuccess(
      kernel.commit({
        type: "character.move",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
        occurredAt: TEST_TIME,
      }),
    );
    const beforeRejected = store.getSnapshot(ids.world.id);
    const result = kernel.commit({
      type: "character.die",
      worldId: ids.world.id,
      actorId: ids.characters.player.id,
      occurredAt: TEST_TIME,
      expectedWorldRevision: first.worldRevision - 1,
    });
    expectFailure(result, "STALE_WORLD_STATE");
    if (!result.ok) {
      expect(result.error.context).toMatchObject({
        expectedWorldRevision: 0,
        currentWorldRevision: 1,
      });
    }
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(sortedSnapshot(store.getSnapshot(ids.world.id))).toEqual(sortedSnapshot(beforeRejected));
    store.close();
  });

  it("keeps initial Truth and Knowledge traceable to the auditable Seed", () => {
    const { store, ids } = createHarness();
    const snapshot = store.getSnapshot(ids.world.id);
    expect(snapshot.seed).toEqual(ids.seed);
    expect(snapshot.facts).toContainEqual(expect.objectContaining({
      id: ids.secretFact.id,
      sourceSeedId: ids.seed.id,
      sourceEventId: null,
    }));
    expect(snapshot.claims).toContainEqual(expect.objectContaining({
      id: ids.unverifiedClaim.id,
      sourceSeedId: ids.seed.id,
      sourceEventId: null,
    }));
    expect(snapshot.facts).not.toContainEqual(expect.objectContaining({
      subject: ids.unverifiedClaim.subject,
      predicate: ids.unverifiedClaim.predicate,
      object: ids.unverifiedClaim.object,
    }));
    expect(snapshot.knowledge.filter((entry) => entry.claimId === ids.unverifiedClaim.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ characterId: ids.characters.npcA.id, knowledgeState: "rumor", sourceSeedId: ids.seed.id }),
        expect.objectContaining({ characterId: ids.characters.npcB.id, knowledgeState: "believed", sourceSeedId: ids.seed.id }),
      ]),
    );
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

  it("keeps Fact, Claim and CharacterKnowledge separate and authorizes Claim provenance", () => {
    const { store, ids, kernel } = createHarness();
    expect(store.getSnapshot(ids.world.id).knowledge).not.toContainEqual(
      expect.objectContaining({ characterId: ids.characters.player.id, claimId: ids.secretClaim.id }),
    );

    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );

    expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        source: { kind: "character", characterId: ids.characters.zhao.id },
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).knowledge).toContainEqual(
      expect.objectContaining({
        characterId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        sourceType: "character",
        sourceCharacterId: ids.characters.zhao.id,
        sourceEventId: null,
        sourceSeedId: null,
      }),
    );
    store.close();
  });

  it("rejects the obsolete character.learn_fact compatibility path", () => {
    const { store, ids, kernel } = createHarness();
    expectFailure(
      kernel.commit({
        type: "character.learn_fact",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        factId: ids.secretFact.id,
        knowledgeState: "rumor",
        occurredAt: TEST_TIME,
      }),
      "VALIDATION_FAILED",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    store.close();
  });

  it("does not infer Claim knowledge from an unrelated fact.assert Event", () => {
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
    expect(store.getSnapshot(ids.world.id).facts).toContainEqual(expect.objectContaining({ id: "fact-002" }));
    expect(store.getSnapshot(ids.world.id).knowledge).not.toContainEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      claimId: ids.unverifiedClaim.id,
    }));
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.unverifiedClaim.id,
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: factEvent.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );
    expect(store.getSnapshot(ids.world.id).knowledge).not.toContainEqual(
      expect.objectContaining({ characterId: ids.characters.player.id, claimId: ids.unverifiedClaim.id }),
    );
    store.close();
  });

  it("allows NPC-A to propagate a Claim to NPC-B without broadcasting to NPC-C", () => {
    const { store, ids, kernel } = createHarness();
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.npcB.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        source: { kind: "character", characterId: ids.characters.npcA.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_STATE_ESCALATION",
    );
    expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.npcB.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: ids.characters.npcA.id },
        occurredAt: TEST_TIME,
      }),
    );
    const knowledge = store.getSnapshot(ids.world.id).knowledge;
    expect(knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.npcB.id,
      claimId: ids.secretClaim.id,
      sourceType: "character",
      sourceCharacterId: ids.characters.npcA.id,
    }));
    expect(knowledge).not.toContainEqual(expect.objectContaining({
      characterId: ids.characters.npcC.id,
      claimId: ids.secretClaim.id,
    }));
    store.close();
  });

  it("prevents Claim Event provenance from escalating or downgrading KnowledgeState", () => {
    const { store, ids, kernel } = createHarness();
    const first = expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: ids.characters.npcA.id },
        occurredAt: TEST_TIME,
      }),
    );
    const beforeRejected = store.getSnapshot(ids.world.id);
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: first.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_STATE_ESCALATION",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(beforeRejected.world.revision);
    expect(store.getSnapshot(ids.world.id)).toEqual(beforeRejected);

    expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
        source: { kind: "event", eventId: first.id },
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      claimId: ids.secretClaim.id,
      knowledgeState: "rumor",
      sourceType: "event",
      sourceEventId: first.id,
    }));
    store.close();
  });

  it("rejects a source Character that does not know the Claim", () => {
    const { store, ids, kernel } = createHarness();
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "confirmed",
        source: { kind: "character", characterId: ids.characters.npcB.id },
        occurredAt: TEST_TIME,
      }),
      "KNOWLEDGE_SOURCE_REQUIRED",
    );
    store.close();
  });

  it("allows Claim Event provenance only when the learner participated in that Event", () => {
    const { store, ids, kernel } = createHarness();
    const observedEvent = expectSuccess(
      kernel.commit({
        type: "claim.record",
        worldId: ids.world.id,
        claimId: "claim-observed",
        actorId: ids.characters.player.id,
        subject: ids.characters.player.id,
        predicate: "observed_signal",
        object: "signal-a",
        occurredAt: TEST_TIME,
      }),
    );
    expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: "claim-observed",
        knowledgeState: "confirmed",
        source: { kind: "event", eventId: observedEvent.id },
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      claimId: "claim-observed",
      sourceType: "event",
      sourceCharacterId: null,
      sourceEventId: observedEvent.id,
    }));
    store.close();
  });

  it("replays Claim records and ClaimKnowledge without creating objective Facts", () => {
    const { store, ids, kernel } = createHarness();
    const initial = store.getSnapshot(ids.world.id);
    const claimEvent = expectSuccess(
      kernel.commit({
        type: "claim.record",
        worldId: ids.world.id,
        claimId: "claim-replayed",
        actorId: ids.characters.player.id,
        subject: ids.characters.player.id,
        predicate: "unverified_status",
        object: "possibly-hidden",
        occurredAt: TEST_TIME,
      }),
    );
    expectSuccess(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: "claim-replayed",
        knowledgeState: "believed",
        source: { kind: "event", eventId: claimEvent.id },
        occurredAt: TEST_TIME,
      }),
    );

    const finalState = store.getSnapshot(ids.world.id);
    expect(finalState.claims).toContainEqual(expect.objectContaining({ id: "claim-replayed" }));
    expect(finalState.facts).not.toContainEqual(expect.objectContaining({ id: "claim-replayed" }));
    expect(finalState.knowledge).toContainEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      claimId: "claim-replayed",
      knowledgeState: "believed",
    }));
    expect(sortedSnapshot(rebuildState(initial, store.listEvents(ids.world.id)))).toEqual(sortedSnapshot(finalState));
    store.close();
  });

  it("rejects cross-World Claim, Character, and Event provenance references", () => {
    const { store, ids, kernel } = createHarness();
    const foreign = seedForeignWorld(store);

    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: foreign.claim.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: ids.characters.npcA.id },
        occurredAt: TEST_TIME,
      }),
      "CROSS_WORLD_REFERENCE",
    );
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
        source: { kind: "character", characterId: foreign.character.id },
        occurredAt: TEST_TIME,
      }),
      "CROSS_WORLD_REFERENCE",
    );

    insertRawEventForTemporalValidation(store, {
      id: "foreign-claim-event",
      worldId: foreign.world.id,
      eventTime: TEST_TIME,
      type: "claim.record",
      actorIds: [foreign.character.id],
      targetIds: [foreign.claim.id],
      payload: { claimId: foreign.claim.id },
    });
    expectFailure(
      kernel.commit({
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
        source: { kind: "event", eventId: "foreign-claim-event" },
        occurredAt: TEST_TIME,
      }),
      "CROSS_WORLD_REFERENCE",
    );
    expect(store.listEvents(ids.world.id)).toHaveLength(0);
    store.close();
  });

  it("rejects cross-World Seed inputs deterministically before any write", () => {
    const { store } = createHarness();
    const foreign = seedForeignWorld(store);
    const worldA: WorldRecord = {
      id: "world-seed-a",
      name: "Seed World A",
      currentTime: TEST_TIME,
      revision: 0,
      status: "active",
    };
    const seedA: SeedRecord = {
      id: "seed-world-a-v1",
      worldId: worldA.id,
      sourceType: "test_fixture",
      sourceRef: "tests/engine/commit-kernel.test.ts",
      metadata: JSON.stringify({ name: "seed-world-a", version: 1 }),
    };
    const characterA: CharacterRecord = {
      id: "character-seed-a",
      worldId: worldA.id,
      name: "Seed Character A",
      type: "npc",
      alive: true,
      locationId: null,
      identity: "seed-a",
      currentGoal: "test seed isolation",
    };
    const crossWorldKnowledge: KnowledgeRecord = {
      characterId: characterA.id,
      claimId: foreign.claim.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seedA.id,
      learnedAt: TEST_TIME,
    };

    expectSeedFailure(
      () => store.seedWorld({
        world: worldA,
        seed: seedA,
        locations: [],
        characters: [characterA],
        claims: [],
        knowledge: [crossWorldKnowledge],
      }),
      "SEED_INVALID",
    );
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM worlds WHERE id = ?").get(worldA.id)).toEqual({ count: 0 });
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM seeds WHERE id = ?").get(seedA.id)).toEqual({ count: 0 });
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM characters WHERE id = ?").get(characterA.id)).toEqual({ count: 0 });

    const worldC: WorldRecord = {
      id: "world-seed-c",
      name: "Seed World C",
      currentTime: TEST_TIME,
      revision: 0,
      status: "active",
    };
    const seedC: SeedRecord = {
      id: "seed-world-c-v1",
      worldId: worldC.id,
      sourceType: "test_fixture",
      sourceRef: "tests/engine/commit-kernel.test.ts",
      metadata: JSON.stringify({ name: "seed-world-c", version: 1 }),
    };
    const characterC: CharacterRecord = { ...characterA, id: "character-seed-c", worldId: worldC.id };
    const crossSeedFact: FactRecord = {
      id: "fact-cross-seed",
      worldId: worldC.id,
      subject: characterC.id,
      predicate: "cross_seed_fact",
      object: "invalid",
      validFrom: TEST_TIME,
      validTo: null,
      sourceEventId: null,
      sourceSeedId: foreign.seed.id,
      sourceType: "initial_lore",
    };
    const crossSeedClaim: ClaimRecord = {
      id: "claim-cross-seed",
      worldId: worldC.id,
      subject: characterC.id,
      predicate: "cross_seed_claim",
      object: "invalid",
      sourceEventId: null,
      sourceSeedId: foreign.seed.id,
      recordedAt: TEST_TIME,
    };

    expectSeedFailure(
      () => store.seedWorld({
        world: worldC,
        seed: seedC,
        locations: [],
        characters: [characterC],
        facts: [crossSeedFact],
        claims: [crossSeedClaim],
      }),
      "SEED_INVALID",
    );
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM worlds WHERE id = ?").get(worldC.id)).toEqual({ count: 0 });
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM facts WHERE id = ?").get(crossSeedFact.id)).toEqual({ count: 0 });
    expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM claims WHERE id = ?").get(crossSeedClaim.id)).toEqual({ count: 0 });
    store.close();
  });

  it("enforces Seed location, subject, and relationship Event referential integrity", () => {
    const store = new SqliteWorldStore();
    const foreign = seedForeignWorld(store);
    insertRawEventForTemporalValidation(store, {
      id: "foreign-relationship-event",
      worldId: foreign.world.id,
      eventTime: TEST_TIME,
      type: "claim.record",
      actorIds: [foreign.character.id],
      targetIds: [foreign.claim.id],
      payload: { claimId: foreign.claim.id },
    });

    const cases: Array<{ suffix: string; mutate: (input: SeedWorldInput) => void }> = [
      {
        suffix: "character-location",
        mutate: (input) => {
          input.characters[0] = { ...input.characters[0]!, locationId: foreign.location.id };
        },
      },
      {
        suffix: "location-parent",
        mutate: (input) => {
          input.locations[0] = { ...input.locations[0]!, parentId: foreign.location.id };
        },
      },
      {
        suffix: "fact-subject",
        mutate: (input) => {
          input.facts![0] = { ...input.facts![0]!, subject: foreign.character.id };
        },
      },
      {
        suffix: "claim-subject",
        mutate: (input) => {
          input.claims![0] = { ...input.claims![0]!, subject: foreign.location.id };
        },
      },
      {
        suffix: "relationship-event",
        mutate: (input) => {
          input.relationships![0] = { ...input.relationships![0]!, updatedByEventId: "foreign-relationship-event" };
        },
      },
    ];

    for (const testCase of cases) {
      const input = createSeedInput(testCase.suffix);
      testCase.mutate(input);
      expectSeedFailure(() => store.seedWorld(input), "SEED_INVALID");
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM worlds WHERE id = ?").get(input.world.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM seeds WHERE id = ?").get(input.seed.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM locations WHERE world_id = ?").get(input.world.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM characters WHERE world_id = ?").get(input.world.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM facts WHERE world_id = ?").get(input.world.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM claims WHERE world_id = ?").get(input.world.id)).toEqual({ count: 0 });
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM relationships WHERE source_character_id = ?").get(input.characters[0]!.id)).toEqual({ count: 0 });
    }

    const valid = createSeedInput("valid-references");
    store.seedWorld(valid);
    const snapshot = store.getSnapshot(valid.world.id);
    expect(snapshot.locations).toHaveLength(1);
    expect(snapshot.characters).toHaveLength(2);
    expect(snapshot.facts).toHaveLength(1);
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.relationships).toHaveLength(1);
    expect(snapshot.characters[0]!.locationId).toBe(valid.locations[0]!.id);
    expect(snapshot.locations[0]!.parentId).toBeNull();
    store.close();
  });

  it("rejects future Events as causes or knowledge sources for past Candidates", () => {
    const { store, ids, kernel } = createHarness();
    insertRawEventForTemporalValidation(store, {
      id: "future-event",
      worldId: ids.world.id,
      eventTime: "2019-03-12T14:00:00.000Z",
      type: "claim.record",
      actorIds: [ids.characters.player.id],
      targetIds: [ids.secretClaim.id],
      payload: { claimId: ids.secretClaim.id },
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
        type: "character.learn_claim",
        worldId: ids.world.id,
        actorId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
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

  it("allows overlapping objects when the World predicate policy is many", () => {
    const { store, ids, kernel } = createHarness();
    expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-many-1",
        subject: ids.characters.player.id,
        predicate: "known_multi",
        object: "object-a",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
    );
    expectSuccess(
      kernel.commit({
        type: "fact.assert",
        worldId: ids.world.id,
        factId: "fact-many-2",
        subject: ids.characters.player.id,
        predicate: "known_multi",
        object: "object-b",
        validFrom: TEST_TIME,
        occurredAt: TEST_TIME,
      }),
    );
    expect(store.getSnapshot(ids.world.id).facts.filter((fact) => fact.predicate === "known_multi")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "fact-many-1", object: "object-a", validTo: null }),
        expect.objectContaining({ id: "fact-many-2", object: "object-b", validTo: null }),
      ]),
    );
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
    expect(store.getSnapshot(ids.world.id).world.revision).toBe(before.world.revision);
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
          type: "character.learn_claim",
          worldId: ids.world.id,
          actorId: ids.characters.player.id,
          claimId: ids.secretClaim.id,
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
      expect.objectContaining({ characterId: ids.characters.player.id, claimId: ids.secretClaim.id }),
    );
    expect(finalState.relationships.find(
      (relationship) => relationship.sourceCharacterId === ids.characters.player.id && relationship.targetCharacterId === ids.characters.zhao.id,
    )?.trust).toBe(10);
    store.close();
  });
});
