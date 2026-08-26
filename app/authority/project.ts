import { randomUUID } from "node:crypto";
import type { Candidate } from "./candidate.js";
import type {
  ClaimRecord,
  EventRecord,
  FactRecord,
  KnowledgeRecord,
  MemoryRecord,
  WorldSnapshot,
} from "./types.js";
import type { WorldStore } from "../persist/store.js";

export function newEventId(): string {
  return randomUUID();
}

export function applyCandidateToSnapshot(
  snapshot: WorldSnapshot,
  candidate: Candidate,
  eventId: string,
): WorldSnapshot {
  const at = snapshot.world.time;
  const world = {
    ...snapshot.world,
    revision: snapshot.world.revision + 1,
    time: candidate.type === "time_advance" ? candidate.toTime : snapshot.world.time,
  };

  switch (candidate.type) {
    case "fact_assert": {
      const fact: FactRecord = {
        id: candidate.factId,
        worldId: candidate.worldId,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        validFrom: candidate.validFrom,
        validTo: null,
        sourceEventId: eventId,
        sourceSeedId: null,
        sourceKind: "event",
      };
      return { ...snapshot, world, facts: [...snapshot.facts, fact] };
    }
    case "claim_record": {
      const claim: ClaimRecord = {
        id: candidate.claimId,
        worldId: candidate.worldId,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        recordedAt: at,
        sourceEventId: eventId,
        sourceSeedId: null,
        sourceKind: "event",
      };
      return { ...snapshot, world, claims: [...snapshot.claims, claim] };
    }
    case "character_learn_claim": {
      const origin = candidate.source;
      const knowledge: KnowledgeRecord = {
        characterId: candidate.characterId,
        claimId: candidate.claimId,
        state: candidate.knowledgeState,
        sourceKind: origin.kind,
        sourceCharacterId: origin.kind === "character" ? origin.characterId : null,
        sourceEventId: eventId,
        sourceSeedId: origin.kind === "seed" ? origin.seedId : null,
        learnedAt: at,
      };
      const without = snapshot.knowledge.filter(
        (row) => !(row.characterId === knowledge.characterId && row.claimId === knowledge.claimId),
      );
      return { ...snapshot, world, knowledge: [...without, knowledge] };
    }
    case "time_advance":
      return { ...snapshot, world };
    case "memory_note": {
      const memory: MemoryRecord = {
        id: candidate.memoryId,
        worldId: candidate.worldId,
        characterId: candidate.characterId,
        text: candidate.text,
        recordedAt: at,
        sourceEventId: eventId,
      };
      return { ...snapshot, world, memories: [...snapshot.memories, memory] };
    }
    case "character_move": {
      const characters = snapshot.characters.map((row) =>
        row.id === candidate.characterId ? { ...row, locationId: candidate.locationId } : row,
      );
      return { ...snapshot, world, characters };
    }
    case "item_place": {
      const items = snapshot.items.map((row) =>
        row.id === candidate.itemId
          ? { ...row, locationId: candidate.locationId, carrierId: null }
          : row,
      );
      return { ...snapshot, world, items };
    }
    case "item_carry": {
      const items = snapshot.items.map((row) =>
        row.id === candidate.itemId
          ? { ...row, locationId: null, carrierId: candidate.characterId }
          : row,
      );
      return { ...snapshot, world, items };
    }
    case "background_thread_advance": {
      const backgroundThreads = snapshot.backgroundThreads.map((row) => row.id === candidate.threadId
        ? { ...row, currentStage: candidate.stageTo, executedBeatIds: [...row.executedBeatIds, candidate.beatId] }
        : row);
      return { ...snapshot, world, backgroundThreads };
    }
  }
}

export function projectToStore(store: WorldStore, event: EventRecord, candidate: Candidate): void {
  switch (candidate.type) {
    case "fact_assert":
      store.insertFact({
        id: candidate.factId,
        worldId: candidate.worldId,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        validFrom: candidate.validFrom,
        validTo: null,
        sourceEventId: event.id,
        sourceSeedId: null,
        sourceKind: "event",
      });
      break;
    case "claim_record":
      store.insertClaim({
        id: candidate.claimId,
        worldId: candidate.worldId,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        recordedAt: event.at,
        sourceEventId: event.id,
        sourceSeedId: null,
        sourceKind: "event",
      });
      break;
    case "character_learn_claim": {
      const origin = candidate.source;
      store.upsertKnowledge({
        characterId: candidate.characterId,
        claimId: candidate.claimId,
        state: candidate.knowledgeState,
        sourceKind: origin.kind,
        sourceCharacterId: origin.kind === "character" ? origin.characterId : null,
        sourceEventId: event.id,
        sourceSeedId: origin.kind === "seed" ? origin.seedId : null,
        learnedAt: event.at,
      });
      break;
    }
    case "time_advance":
      break;
    case "memory_note":
      store.insertMemory({
        id: candidate.memoryId,
        worldId: candidate.worldId,
        characterId: candidate.characterId,
        text: candidate.text,
        recordedAt: event.at,
        sourceEventId: event.id,
      });
      break;
    case "character_move":
      store.updateCharacterLocation(candidate.characterId, candidate.locationId);
      break;
    case "item_place":
      store.updateItem(candidate.itemId, { locationId: candidate.locationId, carrierId: null });
      break;
    case "item_carry":
      store.updateItem(candidate.itemId, { locationId: null, carrierId: candidate.characterId });
      break;
    case "background_thread_advance":
      store.advanceBackgroundThread(candidate.threadId, candidate.beatId, candidate.stageTo);
      break;
  }
}

export function replayEvents(store: WorldStore, events: EventRecord[]): void {
  if (events.length === 0) {
    return;
  }
  const worldId = events[0]?.worldId;
  if (!worldId) {
    return;
  }
  const start = store.snapshot(worldId);
  store.transaction(() => {
    let time = start.world.time;
    let revision = start.world.revision;
    for (const event of events) {
      const candidate = event.payload as Candidate;
      store.insertEvent({
        id: event.id,
        worldId: event.worldId,
        type: event.type,
        producer: event.producer,
        at: event.at,
        payload: event.payload,
        causeEventIds: event.causeEventIds,
      });
      if (candidate.type === "time_advance") {
        time = candidate.toTime;
      }
      revision += 1;
      store.updateWorld(worldId, { time, revision });
      projectToStore(store, event, candidate);
    }
  });
}
