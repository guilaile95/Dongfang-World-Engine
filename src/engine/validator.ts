import { and, eq } from "drizzle-orm";
import type { CandidateEvent } from "./candidate.js";
import { normalizeTime } from "./candidate.js";
import { KernelError } from "./errors.js";
import {
  characters,
  events,
  facts,
  locations,
  worlds,
} from "../persistence/schema.js";
import {
  findCharacter,
  findEvent,
  findFact,
  findLocation,
  findRelationship,
} from "../persistence/sqlite-store.js";

export function validateCandidate(tx: any, candidate: CandidateEvent): void {
  const world = tx.select().from(worlds).where(eq(worlds.id, candidate.worldId)).get();
  if (!world) {
    throw new KernelError("WORLD_NOT_FOUND", "World does not exist", { worldId: candidate.worldId });
  }

  const eventTime = normalizeTime(candidate.type === "world.time_advance" ? candidate.toTime : candidate.occurredAt);
  const currentTime = normalizeTime(world.currentTime);
  if (Date.parse(eventTime) < Date.parse(currentTime)) {
    throw new KernelError("INVALID_TIME", "Candidate time cannot move before the current world time", {
      currentTime,
      eventTime,
    });
  }

  for (const causeEventId of candidate.causeEventIds) {
    const cause = findEvent(tx, causeEventId);
    if (!cause) {
      throw new KernelError("EVENT_NOT_FOUND", "Cause Event does not exist", { causeEventId });
    }
    if (cause.worldId !== candidate.worldId) {
      throw new KernelError("CROSS_WORLD_REFERENCE", "Cause Event belongs to another World", {
        causeEventId,
        worldId: candidate.worldId,
      });
    }
  }

  switch (candidate.type) {
    case "character.move":
      validateMove(tx, candidate);
      return;
    case "character.die":
      validateDeath(tx, candidate);
      return;
    case "character.learn_fact":
      validateKnowledge(tx, candidate);
      return;
    case "relationship.change":
      validateRelationship(tx, candidate);
      return;
    case "fact.assert":
      validateFact(tx, candidate);
      return;
    case "world.time_advance":
      if (Date.parse(normalizeTime(candidate.toTime)) <= Date.parse(currentTime)) {
        throw new KernelError("INVALID_TIME", "world.time_advance must advance the world clock", {
          currentTime,
          toTime: candidate.toTime,
        });
      }
      return;
  }
}

function validateMove(tx: any, candidate: Extract<CandidateEvent, { type: "character.move" }>): void {
  const character = findCharacter(tx, candidate.actorId);
  const location = findLocation(tx, candidate.toLocationId);
  if (!character) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Moving Character does not exist", { characterId: candidate.actorId });
  }
  if (!location) {
    throw new KernelError("LOCATION_NOT_FOUND", "Destination Location does not exist", {
      locationId: candidate.toLocationId,
    });
  }
  if (character.worldId !== candidate.worldId || location.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Character and Location must belong to the same World", {
      characterId: candidate.actorId,
      locationId: candidate.toLocationId,
      worldId: candidate.worldId,
    });
  }
  if (!character.alive) {
    throw new KernelError("CHARACTER_DEAD", "A dead Character cannot move", { characterId: candidate.actorId });
  }
}

function validateDeath(tx: any, candidate: Extract<CandidateEvent, { type: "character.die" }>): void {
  const character = findCharacter(tx, candidate.actorId);
  if (!character) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Dying Character does not exist", { characterId: candidate.actorId });
  }
  if (character.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Character belongs to another World", {
      characterId: candidate.actorId,
    });
  }
  if (!character.alive) {
    throw new KernelError("CHARACTER_DEAD", "Character is already dead", { characterId: candidate.actorId });
  }
}

function validateKnowledge(tx: any, candidate: Extract<CandidateEvent, { type: "character.learn_fact" }>): void {
  const character = findCharacter(tx, candidate.actorId);
  const fact = findFact(tx, candidate.factId);
  if (!character) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Learning Character does not exist", { characterId: candidate.actorId });
  }
  if (!fact) {
    throw new KernelError("FACT_NOT_FOUND", "Fact does not exist", { factId: candidate.factId });
  }
  if (character.worldId !== candidate.worldId || fact.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Character and Fact must belong to the same World", {
      characterId: candidate.actorId,
      factId: candidate.factId,
    });
  }
  if (!candidate.sourceEventId) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Learning a Fact requires a source Event", {
      characterId: candidate.actorId,
      factId: candidate.factId,
    });
  }

  const sourceEvent = findEvent(tx, candidate.sourceEventId);
  if (!sourceEvent) {
    throw new KernelError("EVENT_NOT_FOUND", "Knowledge source Event does not exist", {
      sourceEventId: candidate.sourceEventId,
    });
  }
  if (sourceEvent.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Knowledge source Event belongs to another World", {
      sourceEventId: candidate.sourceEventId,
    });
  }
  const sourcePayload = JSON.parse(sourceEvent.payload) as Record<string, unknown>;
  const sourceSupportsFact =
    (sourceEvent.type === "fact.assert" || sourceEvent.type === "character.learn_fact") &&
    sourcePayload.factId === candidate.factId;
  if (!sourceSupportsFact) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Source Event does not establish the requested Fact", {
      sourceEventId: candidate.sourceEventId,
      factId: candidate.factId,
    });
  }
}

function validateRelationship(
  tx: any,
  candidate: Extract<CandidateEvent, { type: "relationship.change" }>,
): void {
  const source = findCharacter(tx, candidate.sourceCharacterId);
  const target = findCharacter(tx, candidate.targetCharacterId);
  if (!source || !target) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Relationship Character does not exist", {
      sourceCharacterId: candidate.sourceCharacterId,
      targetCharacterId: candidate.targetCharacterId,
    });
  }
  if (source.worldId !== candidate.worldId || target.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Relationship Characters must belong to the same World", {
      sourceCharacterId: candidate.sourceCharacterId,
      targetCharacterId: candidate.targetCharacterId,
    });
  }
  if (source.id === target.id) {
    throw new KernelError("RELATIONSHIP_INVALID", "A Character cannot form a normal relationship with itself", {
      characterId: source.id,
    });
  }

  const current = findRelationship(tx, source.id, target.id);
  const trust = (current?.trust ?? 0) + (candidate.trustDelta ?? 0);
  const hostility = (current?.hostility ?? 0) + (candidate.hostilityDelta ?? 0);
  const closeness = (current?.closeness ?? 0) + (candidate.closenessDelta ?? 0);
  if (![trust, hostility, closeness].every((value) => value >= -100 && value <= 100)) {
    throw new KernelError("RELATIONSHIP_INVALID", "Relationship values must remain between -100 and 100", {
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
      trust,
      hostility,
      closeness,
    });
  }
}

function validateFact(tx: any, candidate: Extract<CandidateEvent, { type: "fact.assert" }>): void {
  const subjectCharacter = findCharacter(tx, candidate.subject);
  const subjectLocation = findLocation(tx, candidate.subject);
  const subjectWorld = tx.select().from(worlds).where(eq(worlds.id, candidate.subject)).get();
  const subjectBelongsToWorld =
    subjectCharacter?.worldId === candidate.worldId ||
    subjectLocation?.worldId === candidate.worldId ||
    subjectWorld?.id === candidate.worldId;
  if (!subjectBelongsToWorld) {
    throw new KernelError("INVALID_FACT_SUBJECT", "Fact subject must be a known entity in the same World", {
      subject: candidate.subject,
      worldId: candidate.worldId,
    });
  }

  const validFrom = normalizeTime(candidate.validFrom);
  const validTo = candidate.validTo ? normalizeTime(candidate.validTo) : null;
  if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) {
    throw new KernelError("INVALID_TIME", "Fact validTo must be after validFrom", { validFrom, validTo });
  }
  const samePredicate = tx
    .select()
    .from(facts)
    .where(and(eq(facts.worldId, candidate.worldId), eq(facts.subject, candidate.subject), eq(facts.predicate, candidate.predicate)))
    .all();
  for (const existing of samePredicate) {
    if (existing.object === candidate.object) {
      continue;
    }
    if (!intervalsOverlap(existing.validFrom, existing.validTo, validFrom, validTo)) {
      continue;
    }
    const canCloseOpenFact = existing.validTo === null && Date.parse(existing.validFrom) < Date.parse(validFrom);
    if (!canCloseOpenFact) {
      throw new KernelError("FACT_CONFLICT", "Fact would create overlapping conflicting Truth", {
        subject: candidate.subject,
        predicate: candidate.predicate,
        existingFactId: existing.id,
      });
    }
  }
}

function intervalsOverlap(
  firstFrom: string,
  firstTo: string | null,
  secondFrom: string,
  secondTo: string | null,
): boolean {
  const firstEnd = firstTo ? Date.parse(firstTo) : Number.POSITIVE_INFINITY;
  const secondEnd = secondTo ? Date.parse(secondTo) : Number.POSITIVE_INFINITY;
  return Date.parse(firstFrom) < secondEnd && Date.parse(secondFrom) < firstEnd;
}
