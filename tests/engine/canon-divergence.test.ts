import { describe, expect, it } from "vitest";
import type {
  CharacterRecord,
  CommittedEvent,
  FactAssertionRequirementRecord,
  FactRecord,
  LocationRecord,
  PredicatePolicyRecord,
  SeedRecord,
  WorldRecord,
} from "../../src/domain/types.js";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import { KernelError } from "../../src/engine/errors.js";
import { rebuildState } from "../../src/engine/projector.js";
import { SqliteWorldStore, type SeedWorldInput } from "../../src/persistence/sqlite-store.js";
import { canonicalSnapshot } from "../../src/smoke/closed-inn-harness.js";

const T0 = "2031-04-05T12:00:00.000Z";
const T0_HALF = "2031-04-05T12:30:00.000Z";
const T1 = "2031-04-05T13:00:00.000Z";
const T1_HALF = "2031-04-05T13:30:00.000Z";
const T2 = "2031-04-05T14:00:00.000Z";
const T3 = "2031-04-05T15:00:00.000Z";
const T4 = "2031-04-05T16:00:00.000Z";

interface CanonFixture {
  input: SeedWorldInput;
  ids: {
    worldId: string;
    playerId: string;
    npcAId: string;
    npcBId: string;
    npcCId: string;
    hiddenFactId: string;
  };
}

function createCanonFixture(suffix: string): CanonFixture {
  const world: WorldRecord = {
    id: `world-canon-${suffix}`,
    name: `Moon Gate ${suffix}`,
    currentTime: T0,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: `seed-canon-${suffix}`,
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "tests/engine/canon-divergence.test.ts",
    metadata: JSON.stringify({ slice: "canon-divergence", suffix }),
  };
  const locations: LocationRecord[] = [
    {
      id: `location-courtyard-${suffix}`,
      worldId: world.id,
      name: "Moon Courtyard",
      parentId: null,
      type: "courtyard",
    },
    {
      id: `location-east-gate-${suffix}`,
      worldId: world.id,
      name: "East Gate",
      parentId: null,
      type: "gate",
    },
    {
      id: `location-west-tower-${suffix}`,
      worldId: world.id,
      name: "West Tower",
      parentId: null,
      type: "tower",
    },
  ];
  const characters: CharacterRecord[] = [
    {
      id: `character-player-${suffix}`,
      worldId: world.id,
      name: "Player",
      type: "player",
      alive: true,
      locationId: locations[0]!.id,
      identity: "A traveler whose choices may alter the local history",
      currentGoal: "Prevent an unjust arrest",
    },
    {
      id: `character-npc-a-${suffix}`,
      worldId: world.id,
      name: "Gate Captain",
      type: "npc",
      alive: true,
      locationId: locations[0]!.id,
      identity: "A captain bound to the city watch",
      currentGoal: "Carry out the current watch route",
    },
    {
      id: `character-npc-b-${suffix}`,
      worldId: world.id,
      name: "Market Keeper",
      type: "npc",
      alive: true,
      locationId: locations[1]!.id,
      identity: "The keeper of the independent dawn market",
      currentGoal: "Open the market on schedule",
    },
    {
      id: `character-npc-c-${suffix}`,
      worldId: world.id,
      name: "Courier",
      type: "npc",
      alive: true,
      locationId: locations[2]!.id,
      identity: "A courier awaiting an authoritative route assignment",
      currentGoal: "Deliver the sealed order",
    },
  ];
  const hiddenFact: FactRecord = {
    id: `fact-hidden-canon-trigger-${suffix}`,
    worldId: world.id,
    subject: world.id,
    predicate: "sealed_order_status",
    object: "active",
    validFrom: T0,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };
  const predicatePolicies: PredicatePolicyRecord[] = [{
    worldId: world.id,
    predicate: "watch_route",
    cardinality: "one",
  }];
  const factAssertionRequirements: FactAssertionRequirementRecord[] = [
    {
      worldId: world.id,
      assertingSubject: characters[1]!.id,
      assertingPredicate: "watch_route",
      assertingObject: "east_gate",
      requiredSubject: world.id,
      requiredPredicate: "sealed_order_status",
      requiredObject: "active",
    },
    {
      worldId: world.id,
      assertingSubject: characters[3]!.id,
      assertingPredicate: "delivery_outcome",
      assertingObject: "old_canon_arrest",
      requiredSubject: characters[1]!.id,
      requiredPredicate: "watch_route",
      requiredObject: "east_gate",
    },
  ];

  return {
    input: {
      world,
      seed,
      locations,
      locationConnections: [],
      characters,
      facts: [hiddenFact],
      predicatePolicies,
      factAssertionRequirements,
    },
    ids: {
      worldId: world.id,
      playerId: characters[0]!.id,
      npcAId: characters[1]!.id,
      npcBId: characters[2]!.id,
      npcCId: characters[3]!.id,
      hiddenFactId: hiddenFact.id,
    },
  };
}

function createHarness(suffix: string, mutate?: (fixture: CanonFixture) => void) {
  const fixture = createCanonFixture(suffix);
  mutate?.(fixture);
  const store = new SqliteWorldStore();
  store.seedWorld(fixture.input);
  let nextEventId = 0;
  const kernel = new CommitKernel(store, {
    clock: () => T4,
    idFactory: () => `event-canon-${suffix}-${String(++nextEventId).padStart(2, "0")}`,
  });
  return { ...fixture, store, kernel };
}

function commitFact(
  store: SqliteWorldStore,
  kernel: CommitKernel,
  input: {
    worldId: string;
    factId: string;
    subject: string;
    predicate: string;
    object: string;
    validFrom: string;
    occurredAt: string;
    actorId?: string;
    causeEventIds?: string[];
  },
): CommitResult {
  return kernel.commit({
    type: "fact.assert",
    expectedWorldRevision: store.getSnapshot(input.worldId).world.revision,
    causeEventIds: [],
    ...input,
  });
}

function expectCommitted(result: CommitResult): CommittedEvent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

function expectRejected(result: CommitResult, code: string): KernelError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`Expected ${code}, but the Candidate committed`);
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

function commitBaselineB(harness: ReturnType<typeof createHarness>): CommittedEvent {
  return expectCommitted(commitFact(harness.store, harness.kernel, {
    worldId: harness.ids.worldId,
    factId: `fact-baseline-b-${harness.ids.worldId}`,
    subject: harness.ids.npcAId,
    predicate: "watch_route",
    object: "east_gate",
    validFrom: T1,
    occurredAt: T1,
  }));
}

function commitOldCanonC(
  harness: ReturnType<typeof createHarness>,
  validFrom = T2,
  occurredAt = T2,
  causeEventIds: string[] = [],
): CommitResult {
  return commitFact(harness.store, harness.kernel, {
    worldId: harness.ids.worldId,
    factId: `fact-old-c-${harness.ids.worldId}-${validFrom}`,
    subject: harness.ids.npcCId,
    predicate: "delivery_outcome",
    object: "old_canon_arrest",
    validFrom,
    occurredAt,
    causeEventIds,
  });
}

function commitIndependentD(harness: ReturnType<typeof createHarness>, occurredAt: string): CommittedEvent {
  return expectCommitted(commitFact(harness.store, harness.kernel, {
    worldId: harness.ids.worldId,
    factId: `fact-independent-d-${harness.ids.worldId}`,
    subject: harness.ids.npcBId,
    predicate: "dawn_market_status",
    object: "open",
    validFrom: occurredAt,
    occurredAt,
  }));
}

function expectCanonicalReplay(harness: ReturnType<typeof createHarness>, initial: ReturnType<SqliteWorldStore["getSnapshot"]>): void {
  const rebuilt = rebuildState(initial, harness.store.listEvents(harness.ids.worldId));
  expect(canonicalSnapshot(rebuilt)).toEqual(canonicalSnapshot(harness.store.getSnapshot(harness.ids.worldId)));
}

describe("Seed-authoritative Fact assertion requirements", () => {
  it("allows the control A -> B -> C path and independent D with canonical replay", () => {
    const harness = createHarness("control");
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const oldC = expectCommitted(commitOldCanonC(harness));
      const independentD = commitIndependentD(harness, T3);
      const final = harness.store.getSnapshot(harness.ids.worldId);

      expect([baselineB.worldRevision, oldC.worldRevision, independentD.worldRevision]).toEqual([1, 2, 3]);
      expect(final.facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: harness.ids.hiddenFactId, validTo: null }),
        expect.objectContaining({ id: baselineB.payload.factId, object: "east_gate", validTo: null }),
        expect.objectContaining({ id: oldC.payload.factId, object: "old_canon_arrest", validTo: null }),
        expect.objectContaining({ id: independentD.payload.factId, object: "open", validTo: null }),
      ]));
      expect(final.factAssertionRequirements).toHaveLength(2);

      const playerContextJson = JSON.stringify(new ContextBuilder(harness.store).buildCharacterContext({
        worldId: harness.ids.worldId,
        observerCharacterId: harness.ids.playerId,
      }));
      expect(playerContextJson).not.toContain(harness.ids.hiddenFactId);
      expect(playerContextJson).not.toContain("sealed_order_status");
      expect(playerContextJson).not.toContain("factAssertionRequirements");
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("rejects a direct old-C attempt after Player-caused B' without partial state, while D continues", () => {
    const harness = createHarness("intervention");
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const intervention = expectCommitted(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-intervention-b-prime-${harness.ids.worldId}`,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T2,
        occurredAt: T2,
      }));
      const beforeRejectedState = harness.store.getSnapshot(harness.ids.worldId);
      const beforeRejectedEvents = harness.store.listEvents(harness.ids.worldId);

      const rejection = expectRejected(commitOldCanonC(harness, T2, T3, [baselineB.id]), "FACT_PRECONDITION_FAILED");

      expect(rejection.context).toEqual(expect.objectContaining({
        assertingSubject: harness.ids.npcCId,
        assertingPredicate: "delivery_outcome",
        assertingObject: "old_canon_arrest",
        assertionTime: T2,
        unmetRequirements: [{
          subject: harness.ids.npcAId,
          predicate: "watch_route",
          object: "east_gate",
        }],
      }));
      expect(harness.store.getSnapshot(harness.ids.worldId)).toEqual(beforeRejectedState);
      expect(harness.store.listEvents(harness.ids.worldId)).toEqual(beforeRejectedEvents);
      expect(beforeRejectedState.world.revision).toBe(2);

      const independentD = commitIndependentD(harness, T4);
      const final = harness.store.getSnapshot(harness.ids.worldId);
      expect(final.world.revision).toBe(3);
      expect(final.facts.find((fact) => fact.id === baselineB.payload.factId)?.validTo).toBe(T2);
      expect(final.facts).toContainEqual(expect.objectContaining({
        id: intervention.payload.factId,
        object: "west_tower",
        sourceEventId: intervention.id,
        validTo: null,
      }));
      expect(intervention.actorIds).toEqual([harness.ids.playerId]);
      expect(final.facts.some((fact) => fact.object === "old_canon_arrest")).toBe(false);
      expect(final.facts).toContainEqual(expect.objectContaining({
        id: independentD.payload.factId,
        object: "open",
      }));
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("evaluates requirements at validFrom rather than occurredAt", () => {
    const harness = createHarness("valid-from");
    try {
      commitBaselineB(harness);
      expectCommitted(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-intervention-${harness.ids.worldId}`,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T2,
        occurredAt: T2,
      }));

      const beforeTooEarlyAssertion = harness.store.getSnapshot(harness.ids.worldId);
      expectRejected(commitOldCanonC(harness, T0_HALF, T3), "FACT_PRECONDITION_FAILED");
      expect(harness.store.getSnapshot(harness.ids.worldId)).toEqual(beforeTooEarlyAssertion);

      const historicalC = expectCommitted(commitOldCanonC(harness, T1_HALF, T3));
      const final = harness.store.getSnapshot(harness.ids.worldId);
      expect(historicalC.eventTime).toBe(T3);
      expect(historicalC.payload.validFrom).toBe(T1_HALF);
      expect(final.world.currentTime).toBe(T3);
    } finally {
      harness.store.close();
    }
  });

  it("rejects a retroactive replacement that would invalidate a committed Fact prerequisite", () => {
    const harness = createHarness("retroactive-regression");
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const oldC = expectCommitted(commitOldCanonC(harness, T3, T3, [baselineB.id]));
      const beforeRejectedState = harness.store.getSnapshot(harness.ids.worldId);
      const beforeRejectedEvents = harness.store.listEvents(harness.ids.worldId);
      const rejection = expectRejected(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-retroactive-b-prime-${harness.ids.worldId}`,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T2,
        occurredAt: T4,
      }), "FACT_PRECONDITION_FAILED");
      const final = harness.store.getSnapshot(harness.ids.worldId);
      const persistedB = final.facts.find((fact) => fact.id === baselineB.payload.factId);
      const persistedC = final.facts.find((fact) => fact.id === oldC.payload.factId);

      expect(rejection.context).toEqual({
        replacementSubject: harness.ids.npcAId,
        replacementPredicate: "watch_route",
        replacementObject: "west_tower",
        replacementValidFrom: T2,
        invalidatedAssertions: [{
          assertingFactId: oldC.payload.factId,
          assertingSubject: harness.ids.npcCId,
          assertingPredicate: "delivery_outcome",
          assertingObject: "old_canon_arrest",
          assertionTime: T3,
          requiredSubject: harness.ids.npcAId,
          requiredPredicate: "watch_route",
          requiredObject: "east_gate",
        }],
      });
      expect(final).toEqual(beforeRejectedState);
      expect(harness.store.listEvents(harness.ids.worldId)).toEqual(beforeRejectedEvents);
      expect([baselineB.worldRevision, oldC.worldRevision]).toEqual([1, 2]);
      expect(final.world).toEqual(expect.objectContaining({ currentTime: T3, revision: 2 }));
      expect(persistedB).toEqual(expect.objectContaining({
        object: "east_gate",
        validFrom: T1,
        validTo: null,
      }));
      expect(persistedC).toEqual(expect.objectContaining({
        object: "old_canon_arrest",
        validFrom: T3,
        validTo: null,
      }));
      expect(final.facts.some((fact) => fact.object === "west_tower" && fact.predicate === "watch_route"))
        .toBe(false);
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("rejects a replacement that would invalidate its own prerequisite at validFrom", () => {
    const harness = createHarness("self-invalidating-replacement", (fixture) => {
      fixture.input.factAssertionRequirements!.push({
        worldId: fixture.ids.worldId,
        assertingSubject: fixture.ids.npcAId,
        assertingPredicate: "watch_route",
        assertingObject: "west_tower",
        requiredSubject: fixture.ids.npcAId,
        requiredPredicate: "watch_route",
        requiredObject: "east_gate",
      });
    });
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const beforeRejectedState = harness.store.getSnapshot(harness.ids.worldId);
      const beforeRejectedEvents = harness.store.listEvents(harness.ids.worldId);
      const replacementFactId = `fact-self-invalidating-${harness.ids.worldId}`;
      const rejection = expectRejected(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: replacementFactId,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T2,
        occurredAt: T2,
      }), "FACT_PRECONDITION_FAILED");

      expect(rejection.context).toEqual(expect.objectContaining({
        replacementValidFrom: T2,
        invalidatedAssertions: [{
          assertingFactId: replacementFactId,
          assertingSubject: harness.ids.npcAId,
          assertingPredicate: "watch_route",
          assertingObject: "west_tower",
          assertionTime: T2,
          requiredSubject: harness.ids.npcAId,
          requiredPredicate: "watch_route",
          requiredObject: "east_gate",
        }],
      }));
      expect(harness.store.getSnapshot(harness.ids.worldId)).toEqual(beforeRejectedState);
      expect(harness.store.listEvents(harness.ids.worldId)).toEqual(beforeRejectedEvents);
      expect(beforeRejectedState.world.revision).toBe(1);
      expect(beforeRejectedState.facts.find((fact) => fact.id === baselineB.payload.factId)?.validTo).toBeNull();
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("allows a historical replacement when it invalidates no committed Fact prerequisite", () => {
    const harness = createHarness("retroactive-unrelated");
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const independentD = commitIndependentD(harness, T3);
      const intervention = expectCommitted(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-retroactive-unrelated-${harness.ids.worldId}`,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T2,
        occurredAt: T4,
      }));
      const final = harness.store.getSnapshot(harness.ids.worldId);

      expect([baselineB.worldRevision, independentD.worldRevision, intervention.worldRevision]).toEqual([1, 2, 3]);
      expect(final.world).toEqual(expect.objectContaining({ currentTime: T4, revision: 3 }));
      expect(final.facts.find((fact) => fact.id === baselineB.payload.factId)?.validTo).toBe(T2);
      expect(final.facts).toContainEqual(expect.objectContaining({
        id: intervention.payload.factId,
        object: "west_tower",
        validFrom: T2,
        validTo: null,
      }));
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("allows a later replacement that preserves the prerequisite at the committed assertion time", () => {
    const harness = createHarness("replacement-after-assertion");
    try {
      const initial = harness.store.getSnapshot(harness.ids.worldId);
      const baselineB = commitBaselineB(harness);
      const oldC = expectCommitted(commitOldCanonC(harness, T2, T2, [baselineB.id]));
      const intervention = expectCommitted(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-later-b-prime-${harness.ids.worldId}`,
        actorId: harness.ids.playerId,
        subject: harness.ids.npcAId,
        predicate: "watch_route",
        object: "west_tower",
        validFrom: T3,
        occurredAt: T4,
      }));
      const final = harness.store.getSnapshot(harness.ids.worldId);

      expect([baselineB.worldRevision, oldC.worldRevision, intervention.worldRevision]).toEqual([1, 2, 3]);
      expect(final.facts.find((fact) => fact.id === baselineB.payload.factId)?.validTo).toBe(T3);
      expect(final.facts).toContainEqual(expect.objectContaining({
        id: oldC.payload.factId,
        validFrom: T2,
        validTo: null,
      }));
      expect(final.facts).toContainEqual(expect.objectContaining({
        id: intervention.payload.factId,
        validFrom: T3,
        validTo: null,
      }));
      expectCanonicalReplay(harness, initial);
    } finally {
      harness.store.close();
    }
  });

  it("enforces AND requirements before cardinality handling while leaving unmatched Fact triples unrestricted", () => {
    const harness = createHarness("and", (fixture) => {
      fixture.input.predicatePolicies!.push({
        worldId: fixture.ids.worldId,
        predicate: "delivery_outcome",
        cardinality: "many",
      });
      fixture.input.factAssertionRequirements!.push({
        worldId: fixture.ids.worldId,
        assertingSubject: fixture.ids.npcCId,
        assertingPredicate: "delivery_outcome",
        assertingObject: "old_canon_arrest",
        requiredSubject: fixture.ids.worldId,
        requiredPredicate: "courier_clearance",
        requiredObject: "granted",
      });
    });
    try {
      commitBaselineB(harness);
      const beforeRejected = harness.store.getSnapshot(harness.ids.worldId);
      expectRejected(commitOldCanonC(harness), "FACT_PRECONDITION_FAILED");
      expect(harness.store.getSnapshot(harness.ids.worldId)).toEqual(beforeRejected);

      expectCommitted(commitFact(harness.store, harness.kernel, {
        worldId: harness.ids.worldId,
        factId: `fact-clearance-${harness.ids.worldId}`,
        subject: harness.ids.worldId,
        predicate: "courier_clearance",
        object: "granted",
        validFrom: T2,
        occurredAt: T2,
      }));
      expectCommitted(commitOldCanonC(harness));
      commitIndependentD(harness, T3);
    } finally {
      harness.store.close();
    }
  });

  it.each(["assertingSubject", "requiredSubject"] as const)(
    "rejects a %s that resolves to another Seed World without partial initialization",
    (subjectField) => {
      const store = new SqliteWorldStore();
      try {
        const foreign = createCanonFixture(`foreign-${subjectField}`);
        foreign.input.factAssertionRequirements = [];
        store.seedWorld(foreign.input);

        const candidate = createCanonFixture(`cross-world-${subjectField}`);
        const requirement = candidate.input.factAssertionRequirements![0]!;
        candidate.input.factAssertionRequirements![0] = {
          ...requirement,
          [subjectField]: foreign.ids.worldId,
        };

        expect(() => store.seedWorld(candidate.input)).toThrowError(expect.objectContaining({
          code: "SEED_INVALID",
        }));
        const persisted = store.sqlite
          .prepare("SELECT COUNT(*) AS count FROM worlds WHERE id = ?")
          .get(candidate.ids.worldId) as { count: number };
        expect(persisted.count).toBe(0);
      } finally {
        store.close();
      }
    },
  );

  it("rejects empty predicate or object values before writing the Seed", () => {
    const fields = ["assertingPredicate", "assertingObject", "requiredPredicate", "requiredObject"] as const;
    for (const field of fields) {
      const store = new SqliteWorldStore();
      try {
        const fixture = createCanonFixture(`empty-${field}`);
        const requirement = fixture.input.factAssertionRequirements![0]!;
        fixture.input.factAssertionRequirements![0] = { ...requirement, [field]: "" };
        expect(() => store.seedWorld(fixture.input)).toThrowError(expect.objectContaining({
          code: "SEED_INVALID",
        }));
        expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM worlds").get()).toEqual({ count: 0 });
      } finally {
        store.close();
      }
    }
  });

  it("keeps structurally distinct requirement tuples even when delimiter-joined strings would collide", () => {
    const store = new SqliteWorldStore();
    try {
      const fixture = createCanonFixture("tuple-collision");
      const base = fixture.input.factAssertionRequirements![0]!;
      fixture.input.factAssertionRequirements = [
        { ...base, assertingPredicate: "a:b", assertingObject: "c" },
        { ...base, assertingPredicate: "a", assertingObject: "b:c" },
      ];
      store.seedWorld(fixture.input);
      expect(store.getSnapshot(fixture.ids.worldId).factAssertionRequirements).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it("rejects duplicate Fact assertion requirements deterministically before writing the Seed", () => {
    const store = new SqliteWorldStore();
    try {
      const fixture = createCanonFixture("duplicate");
      fixture.input.factAssertionRequirements!.push({ ...fixture.input.factAssertionRequirements![0]! });
      expect(() => store.seedWorld(fixture.input)).toThrowError(expect.objectContaining({
        code: "SEED_INVALID",
      }));
      expect(store.sqlite.prepare("SELECT COUNT(*) AS count FROM worlds").get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});
