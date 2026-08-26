import type { Candidate } from "./candidate.js";
import type { Producer, WorldSnapshot } from "./types.js";

export interface AuthDecision {
  ok: boolean;
  reasons: string[];
}

const LLM_WRITABLE = new Set<Candidate["type"]>([
  "claim_record",
  "memory_note",
  "character_move",
  "item_place",
  "item_carry",
]);

export function authorize(
  snapshot: WorldSnapshot,
  producer: Producer,
  candidate: Candidate,
  knownEventIds: ReadonlySet<string>,
): AuthDecision {
  const reasons: string[] = [];
  if (candidate.worldId !== snapshot.world.id) {
    reasons.push("WORLD_MISMATCH");
  }
  if (candidate.expectedRevision !== snapshot.world.revision) {
    reasons.push("STALE_WORLD_STATE");
  }
  if (producer === "llm" && !LLM_WRITABLE.has(candidate.type)) {
    reasons.push(`LLM_CANNOT_WRITE:${candidate.type}`);
  }

  switch (candidate.type) {
    case "fact_assert": {
      if (snapshot.facts.some((fact) => fact.id === candidate.factId)) {
        reasons.push("FACT_EXISTS");
      }
      const openDuplicate = snapshot.facts.some(
        (fact) =>
          fact.validTo === null &&
          fact.subject === candidate.subject &&
          fact.predicate === candidate.predicate &&
          fact.object === candidate.object,
      );
      if (openDuplicate) {
        reasons.push("FACT_TRIPLE_OPEN");
      }
      break;
    }
    case "claim_record": {
      if (snapshot.claims.some((claim) => claim.id === candidate.claimId)) {
        reasons.push("CLAIM_EXISTS");
      }
      break;
    }
    case "character_learn_claim": {
      const character = snapshot.characters.find((row) => row.id === candidate.characterId);
      if (!character) {
        reasons.push("CHARACTER_NOT_FOUND");
      }
      if (!snapshot.claims.some((claim) => claim.id === candidate.claimId)) {
        reasons.push("CLAIM_NOT_FOUND");
      }
      const origin = candidate.source;
      if (origin.kind === "character") {
        const source = snapshot.characters.find((row) => row.id === origin.characterId);
        if (!source) {
          reasons.push("SOURCE_CHARACTER_NOT_FOUND");
        } else if (
          !snapshot.knowledge.some(
            (row) => row.characterId === source.id && row.claimId === candidate.claimId,
          )
        ) {
          reasons.push("SOURCE_CHARACTER_LACKS_CLAIM");
        }
      } else if (origin.kind === "event") {
        if (!knownEventIds.has(origin.eventId)) {
          reasons.push("SOURCE_EVENT_NOT_FOUND");
        }
      } else if (producer === "llm") {
        reasons.push("LLM_CANNOT_USE_SEED_SOURCE");
      }
      break;
    }
    case "time_advance": {
      if (candidate.toTime === snapshot.world.time) {
        reasons.push("TIME_UNCHANGED");
      }
      break;
    }
    case "memory_note": {
      if (!snapshot.characters.some((row) => row.id === candidate.characterId)) {
        reasons.push("CHARACTER_NOT_FOUND");
      }
      if (snapshot.memories.some((row) => row.id === candidate.memoryId)) {
        reasons.push("MEMORY_EXISTS");
      }
      break;
    }
    case "character_move": {
      const character = snapshot.characters.find((row) => row.id === candidate.characterId);
      if (!character) {
        reasons.push("CHARACTER_NOT_FOUND");
      } else if (producer === "llm" && character.kind !== "player") {
        reasons.push("LLM_CANNOT_MOVE_NPC");
      }
      if (!snapshot.locations.some((row) => row.id === candidate.locationId)) {
        reasons.push("LOCATION_NOT_FOUND");
      }
      break;
    }
    case "item_place": {
      const item = snapshot.items.find((row) => row.id === candidate.itemId);
      if (!item) {
        reasons.push("ITEM_NOT_FOUND");
      }
      if (!snapshot.locations.some((row) => row.id === candidate.locationId)) {
        reasons.push("LOCATION_NOT_FOUND");
      }
      if (producer === "llm") {
        const player = snapshot.characters.find((row) => row.kind === "player");
        if (!player || (item && item.carrierId !== player.id && item.locationId !== player.locationId)) {
          reasons.push("ITEM_NOT_IN_REACH");
        }
      }
      break;
    }
    case "item_carry": {
      const item = snapshot.items.find((row) => row.id === candidate.itemId);
      const carrier = snapshot.characters.find((row) => row.id === candidate.characterId);
      if (!item) {
        reasons.push("ITEM_NOT_FOUND");
      }
      if (!carrier) {
        reasons.push("CHARACTER_NOT_FOUND");
      } else if (producer === "llm" && carrier.kind !== "player") {
        reasons.push("LLM_CANNOT_GIVE_ITEM_TO_NPC");
      }
      if (producer === "llm" && item && carrier) {
        const samePlace = item.locationId === carrier.locationId;
        const alreadyHeld = item.carrierId === carrier.id;
        if (!samePlace && !alreadyHeld) {
          reasons.push("ITEM_NOT_IN_REACH");
        }
      }
      break;
    }
    case "background_thread_advance": {
      if (producer === "llm") reasons.push("LLM_CANNOT_ADVANCE_BACKGROUND_THREAD");
      const thread = snapshot.backgroundThreads.find((row) => row.id === candidate.threadId);
      if (!thread) {
        reasons.push("BACKGROUND_THREAD_NOT_FOUND");
      } else {
        if (thread.currentStage !== candidate.stageFrom) reasons.push("BACKGROUND_STAGE_MISMATCH");
        if (thread.executedBeatIds.includes(candidate.beatId)) reasons.push("BACKGROUND_BEAT_ALREADY_EXECUTED");
        if (!thread.beats.some((row) => row.beatId === candidate.beatId && row.stageFrom === candidate.stageFrom && row.stageTo === candidate.stageTo)) reasons.push("BACKGROUND_BEAT_NOT_FOUND");
      }
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}
