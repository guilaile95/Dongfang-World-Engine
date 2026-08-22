import { describe, expect, it } from "vitest";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import { rebuildState } from "../../src/engine/projector.js";
import type { CommittedEvent, KnowledgeRecord, WorldSnapshot } from "../../src/domain/types.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import {
  CLOSED_INN_INITIAL_TIME,
  seedClosedInnWorld,
} from "../../src/testkit/world-builder.js";

const REMINDER_TIME = "2019-03-12T19:00:00.000Z";

function createKernel(store: SqliteWorldStore): CommitKernel {
  let nextEventId = 0;
  return new CommitKernel(store, {
    clock: () => "2019-03-12T20:00:00.000Z",
    idFactory: () => `event-provenance-${String(++nextEventId).padStart(2, "0")}`,
  });
}

function commitTransmission(
  kernel: CommitKernel,
  worldId: string,
  sourceCharacterId: string,
  targetCharacterId: string,
  claimId: string,
  expectedWorldRevision: number,
  occurredAt: string,
): CommitResult {
  return kernel.commit({
    type: "claim.transmit",
    worldId,
    expectedWorldRevision,
    sourceCharacterId,
    targetCharacterId,
    claimId,
    occurredAt,
  });
}

function expectCommitted(result: CommitResult): CommittedEvent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

function findKnowledge(snapshot: WorldSnapshot, characterId: string, claimId: string): KnowledgeRecord {
  const knowledge = snapshot.knowledge.find(
    (value) => value.characterId === characterId && value.claimId === claimId,
  );
  if (!knowledge) {
    throw new Error(`Missing CharacterKnowledge for ${characterId}/${claimId}`);
  }
  return knowledge;
}

function canonicalSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
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

describe("Claim transmission provenance", () => {
  it("preserves a seed holder's provenance across a same-state reminder and replays the event log", () => {
    const store = new SqliteWorldStore();

    try {
      const fixture = seedClosedInnWorld(store);
      const kernel = createKernel(store);
      const initial = store.getSnapshot(fixture.world.id);
      const claimId = fixture.claims.trueCellar.id;
      const npcAKnowledgeBeforeTransmission = findKnowledge(
        initial,
        fixture.characters.npcA.id,
        claimId,
      );

      expect(npcAKnowledgeBeforeTransmission).toEqual({
        characterId: fixture.characters.npcA.id,
        claimId,
        knowledgeState: "confirmed",
        sourceType: "initial",
        sourceCharacterId: null,
        sourceEventId: null,
        sourceSeedId: fixture.seed.id,
        learnedAt: CLOSED_INN_INITIAL_TIME,
      });

      const firstTransmission = expectCommitted(
        commitTransmission(
          kernel,
          fixture.world.id,
          fixture.characters.npcA.id,
          fixture.characters.player.id,
          claimId,
          0,
          CLOSED_INN_INITIAL_TIME,
        ),
      );
      const playerKnowledgeAfterFirstTransmission = findKnowledge(
        store.getSnapshot(fixture.world.id),
        fixture.characters.player.id,
        claimId,
      );

      expect(playerKnowledgeAfterFirstTransmission).toEqual({
        characterId: fixture.characters.player.id,
        claimId,
        knowledgeState: "confirmed",
        sourceType: "character",
        sourceCharacterId: fixture.characters.npcA.id,
        sourceEventId: firstTransmission.id,
        sourceSeedId: null,
        learnedAt: CLOSED_INN_INITIAL_TIME,
      });

      const secondTransmission = expectCommitted(
        commitTransmission(
          kernel,
          fixture.world.id,
          fixture.characters.player.id,
          fixture.characters.npcA.id,
          claimId,
          1,
          REMINDER_TIME,
        ),
      );
      expect(secondTransmission.type).toBe("claim.transmit");
      expect(store.listEvents(fixture.world.id)).toHaveLength(2);

      const finalState = store.getSnapshot(fixture.world.id);
      const rebuiltState = rebuildState(initial, store.listEvents(fixture.world.id));
      expect(canonicalSnapshot(rebuiltState)).toEqual(canonicalSnapshot(finalState));

      expect(findKnowledge(finalState, fixture.characters.npcA.id, claimId)).toEqual(
        npcAKnowledgeBeforeTransmission,
      );
    } finally {
      store.close();
    }
  });

  it("preserves the first acquisition provenance when the same Claim is retransmitted", () => {
    const store = new SqliteWorldStore();

    try {
      const fixture = seedClosedInnWorld(store);
      const kernel = createKernel(store);
      const claimId = fixture.claims.trueCellar.id;

      const firstTransmission = expectCommitted(
        commitTransmission(
          kernel,
          fixture.world.id,
          fixture.characters.npcA.id,
          fixture.characters.player.id,
          claimId,
          0,
          CLOSED_INN_INITIAL_TIME,
        ),
      );
      const playerKnowledgeAfterFirstTransmission = findKnowledge(
        store.getSnapshot(fixture.world.id),
        fixture.characters.player.id,
        claimId,
      );

      const secondTransmission = expectCommitted(
        commitTransmission(
          kernel,
          fixture.world.id,
          fixture.characters.npcA.id,
          fixture.characters.player.id,
          claimId,
          1,
          REMINDER_TIME,
        ),
      );

      expect(secondTransmission.id).not.toBe(firstTransmission.id);
      expect(store.listEvents(fixture.world.id)).toHaveLength(2);
      expect(findKnowledge(store.getSnapshot(fixture.world.id), fixture.characters.player.id, claimId)).toEqual(
        playerKnowledgeAfterFirstTransmission,
      );
    } finally {
      store.close();
    }
  });
});
