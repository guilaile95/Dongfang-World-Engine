import { describe, expect, it } from "vitest";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import { KernelError } from "../../src/engine/errors.js";
import type { CharacterRecord, CommittedEvent, SeedRecord, WorldRecord } from "../../src/domain/types.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";

function createHarness() {
  const store = new SqliteWorldStore();
  const ids = seedTestWorld(store);
  const builder = new ContextBuilder(store);
  return { store, ids, builder };
}

function createKernel(store: SqliteWorldStore): CommitKernel {
  let nextId = 0;
  return new CommitKernel(store, {
    clock: () => TEST_TIME,
    idFactory: () => `context-event-${String(++nextId).padStart(4, "0")}`,
  });
}

function commitAtCurrentRevision(
  store: SqliteWorldStore,
  kernel: CommitKernel,
  input: Record<string, unknown>,
): CommitResult {
  return kernel.commit({
    ...input,
    expectedWorldRevision: store.getSnapshot(String(input.worldId)).world.revision,
  });
}

function expectCommitted(result: CommitResult): CommittedEvent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

function expectContextFailure(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KernelError);
  if (caught instanceof KernelError) {
    expect(caught.code).toBe(code);
  }
}

function seedForeignWorld(store: SqliteWorldStore): { world: WorldRecord; character: CharacterRecord } {
  const world: WorldRecord = {
    id: "world-context-foreign",
    name: "Foreign Context World",
    currentTime: TEST_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: "seed-context-foreign-v1",
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "tests/engine/context-builder.test.ts",
    metadata: JSON.stringify({ name: "foreign-context-world", version: 1 }),
  };
  const character: CharacterRecord = {
    id: "character-context-foreign",
    worldId: world.id,
    name: "Foreign Observer",
    type: "npc",
    alive: true,
    locationId: null,
    identity: "foreign",
    currentGoal: "remain isolated",
  };
  store.seedWorld({ world, seed, locations: [], characters: [character] });
  return { world, character };
}

describe("Context Builder MVP", () => {
  it("includes only the observer's CharacterKnowledge", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 10,
    });

    expect(context.knowledge).toHaveLength(2);
    expect(context.knowledge.every((bundle) => bundle.knowledge.characterId === ids.characters.npcA.id)).toBe(true);
    expect(context.knowledge.map((bundle) => bundle.knowledge.claimId)).toEqual([
      ids.secretClaim.id,
      ids.unverifiedClaim.id,
    ]);
    expect(context.knowledge.some((bundle) => bundle.knowledge.knowledgeState === "believed")).toBe(false);
    expect(context.knowledge.some((bundle) => bundle.knowledge.characterId === ids.characters.npcB.id)).toBe(false);
    store.close();
  });

  it("does not synthesize missing unknown Knowledge for the observer", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });

    expect(context.knowledge).toEqual([]);
    expect(JSON.stringify(context)).not.toContain(ids.secretClaim.id);
    expect(JSON.stringify(context)).not.toContain(ids.unverifiedClaim.id);
    store.close();
  });

  it("does not expose objective Fact Truth through an observer context", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });
    const serialized = JSON.stringify(context);

    expect(context).not.toHaveProperty("facts");
    expect(context).not.toHaveProperty("objectiveFacts");
    expect(serialized).not.toContain(ids.secretFact.id);
    expect(serialized).not.toContain(ids.secretFact.object);
    store.close();
  });

  it("bundles a known Claim with KnowledgeState and minimal initial provenance", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 10,
    });
    const bundle = context.knowledge.find((candidate) => candidate.claim.id === ids.secretClaim.id);

    expect(bundle).toBeDefined();
    expect(bundle).toEqual(expect.objectContaining({
      claim: expect.objectContaining({
        id: ids.secretClaim.id,
        predicate: ids.secretClaim.predicate,
        object: ids.secretClaim.object,
      }),
      knowledge: expect.objectContaining({
        characterId: ids.characters.npcA.id,
        claimId: ids.secretClaim.id,
        knowledgeState: "rumor",
      }),
      provenance: {
        sourceType: "initial",
        sourceCharacterId: null,
        sourceEventId: null,
        sourceSeedId: ids.seed.id,
        sourceEventType: null,
        sourceEventTime: null,
      },
    }));
    expect(JSON.stringify(bundle)).not.toContain("actorIds");
    expect(JSON.stringify(bundle)).not.toContain("payload");
    store.close();
  });

  it("does not leak Claim database provenance through a later Character knowledge chain", () => {
    const { store, ids, builder } = createHarness();
    const kernel = createKernel(store);
    const hiddenClaimEvent = expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "claim.record",
      worldId: ids.world.id,
      claimId: "claim-hidden-provenance",
      actorId: ids.characters.npcA.id,
      subject: ids.characters.npcA.id,
      predicate: "private_allegation",
      object: "hidden-value",
      occurredAt: TEST_TIME,
    }));
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "character.learn_claim",
      worldId: ids.world.id,
      actorId: ids.characters.npcA.id,
      claimId: "claim-hidden-provenance",
      knowledgeState: "rumor",
      source: { kind: "event", eventId: hiddenClaimEvent.id },
      occurredAt: TEST_TIME,
    }));
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "character.learn_claim",
      worldId: ids.world.id,
      actorId: ids.characters.npcB.id,
      claimId: "claim-hidden-provenance",
      knowledgeState: "rumor",
      source: { kind: "character", characterId: ids.characters.npcA.id },
      occurredAt: TEST_TIME,
    }));
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "character.learn_claim",
      worldId: ids.world.id,
      actorId: ids.characters.player.id,
      claimId: "claim-hidden-provenance",
      knowledgeState: "rumor",
      source: { kind: "character", characterId: ids.characters.npcB.id },
      occurredAt: TEST_TIME,
    }));

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });
    const bundle = context.knowledge.find((candidate) => candidate.claim.id === "claim-hidden-provenance");

    expect(bundle?.claim).toEqual({
      id: "claim-hidden-provenance",
      subject: ids.characters.npcA.id,
      predicate: "private_allegation",
      object: "hidden-value",
    });
    expect(bundle?.knowledge).toEqual(expect.objectContaining({
      characterId: ids.characters.player.id,
      claimId: "claim-hidden-provenance",
      knowledgeState: "rumor",
    }));
    expect(bundle?.provenance).toEqual(expect.objectContaining({
      sourceType: "character",
      sourceCharacterId: ids.characters.npcB.id,
      sourceEventId: null,
      sourceSeedId: null,
    }));
    expect(bundle?.claim).not.toHaveProperty("sourceEventId");
    expect(bundle?.claim).not.toHaveProperty("sourceSeedId");
    expect(bundle?.claim).not.toHaveProperty("recordedAt");
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(hiddenClaimEvent.id);
    expect(serialized).not.toContain(`"sourceSeedId":"${ids.seed.id}"`);
    expect(serialized).not.toContain("recordedAt");
    store.close();
  });

  it("includes only safe Event provenance metadata for a known Claim", () => {
    const { store, ids, builder } = createHarness();
    const kernel = createKernel(store);
    const claimEvent = expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "claim.record",
      worldId: ids.world.id,
      claimId: "claim-context-event",
      actorId: ids.characters.player.id,
      subject: ids.characters.player.id,
      predicate: "observed_signal",
      object: "signal-a",
      occurredAt: TEST_TIME,
    }));
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "character.learn_claim",
      worldId: ids.world.id,
      actorId: ids.characters.player.id,
      claimId: "claim-context-event",
      knowledgeState: "confirmed",
      source: { kind: "event", eventId: claimEvent.id },
      occurredAt: TEST_TIME,
    }));

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });
    const bundle = context.knowledge.find((candidate) => candidate.claim.id === "claim-context-event");

    expect(bundle?.provenance).toEqual({
      sourceType: "event",
      sourceCharacterId: null,
      sourceEventId: claimEvent.id,
      sourceSeedId: null,
      sourceEventType: "claim.record",
      sourceEventTime: TEST_TIME,
    });
    expect(JSON.stringify(bundle)).not.toContain("actorIds");
    expect(JSON.stringify(bundle)).not.toContain("targetIds");
    expect(JSON.stringify(bundle)).not.toContain("payload");
    store.close();
  });

  it("includes the observer self state and current Location", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });

    expect(context.world).toEqual({
      id: ids.world.id,
      currentTime: ids.world.currentTime,
      revision: ids.world.revision,
      status: ids.world.status,
    });
    expect(context.observer).toEqual(ids.characters.player);
    expect(context.location).toEqual(ids.locations.office);
    store.close();
  });

  it("exposes co-located Characters only through a safe public projection", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });
    const zhao = context.coLocatedCharacters.find((character) => character.id === ids.characters.zhao.id);

    expect(zhao).toEqual({
      id: ids.characters.zhao.id,
      name: ids.characters.zhao.name,
      type: ids.characters.zhao.type,
      alive: ids.characters.zhao.alive,
    });
    expect(zhao).not.toHaveProperty("identity");
    expect(zhao).not.toHaveProperty("currentGoal");
    expect(JSON.stringify(context.coLocatedCharacters)).not.toContain(ids.characters.zhao.identity);
    expect(JSON.stringify(context.coLocatedCharacters)).not.toContain(ids.characters.zhao.currentGoal);
    store.close();
  });

  it("exposes only relationships whose source is the observer", () => {
    const { store, ids, builder } = createHarness();
    const kernel = createKernel(store);
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "relationship.change",
      worldId: ids.world.id,
      sourceCharacterId: ids.characters.player.id,
      targetCharacterId: ids.characters.zhao.id,
      trustDelta: 20,
      occurredAt: TEST_TIME,
    }));
    expectCommitted(commitAtCurrentRevision(store, kernel, {
      type: "relationship.change",
      worldId: ids.world.id,
      sourceCharacterId: ids.characters.zhao.id,
      targetCharacterId: ids.characters.player.id,
      hostilityDelta: 30,
      occurredAt: TEST_TIME,
    }));

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });

    expect(context.relationships).toHaveLength(1);
    expect(context.relationships[0]).toEqual({
      sourceCharacterId: ids.characters.player.id,
      targetCharacterId: ids.characters.zhao.id,
      trust: 20,
      hostility: 0,
      closeness: 0,
      relationshipType: "unknown",
    });
    expect(context.relationships[0]).not.toHaveProperty("updatedByEventId");
    expect(JSON.stringify(context.relationships)).not.toContain("context-event-0001");
    expect(context.relationships.some((relationship) => relationship.sourceCharacterId === ids.characters.zhao.id)).toBe(false);
    store.close();
  });

  it("rejects cross-World observer and world references deterministically", () => {
    const { store, ids, builder } = createHarness();
    const foreign = seedForeignWorld(store);

    expectContextFailure(
      () => builder.buildCharacterContext({
        worldId: ids.world.id,
        observerCharacterId: foreign.character.id,
        budget: 10,
      }),
      "CROSS_WORLD_REFERENCE",
    );
    expectContextFailure(
      () => builder.buildCharacterContext({
        worldId: foreign.world.id,
        observerCharacterId: ids.characters.player.id,
        budget: 10,
      }),
      "CROSS_WORLD_REFERENCE",
    );
    store.close();
  });

  it("packs only visible whole units after visibility filtering", () => {
    const { store, ids, builder } = createHarness();

    const context = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 1,
    });

    expect(context.knowledge).toHaveLength(1);
    expect(context.knowledge[0]).toEqual(expect.objectContaining({
      claim: expect.any(Object),
      knowledge: expect.any(Object),
      provenance: expect.any(Object),
    }));
    expect(context.coLocatedCharacters).toEqual([]);
    expect(context.relationships).toEqual([]);
    expect(context.packing).toEqual({
      budget: 1,
      visibleUnits: 4,
      usedUnits: 1,
      truncated: true,
    });
    expect(JSON.stringify(context)).not.toContain(ids.characters.npcB.id);
    expect(context.location).toEqual(ids.locations.beijing);

    const zeroBudget = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 0,
    });
    expect(zeroBudget.knowledge).toEqual([]);
    expect(zeroBudget.coLocatedCharacters).toEqual([]);
    expect(zeroBudget.location).toEqual(ids.locations.beijing);
    expect(zeroBudget.packing.usedUnits).toBe(0);
    store.close();
  });

  it("does not append Events or mutate State while building Context", () => {
    const { store, ids, builder } = createHarness();
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const beforeEvents = store.listEvents(ids.world.id);

    builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });

    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    expect(store.listEvents(ids.world.id)).toEqual(beforeEvents);
    store.close();
  });

  it("returns deterministic output for unchanged state and budget", () => {
    const { store, ids, builder } = createHarness();

    const first = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 10,
    });
    const second = builder.buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.npcA.id,
      budget: 10,
    });

    expect(second).toEqual(first);
    store.close();
  });
});
