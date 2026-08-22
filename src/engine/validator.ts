import { and, eq } from "drizzle-orm";
import type { CandidateEvent } from "./candidate.js";
import { normalizeTime } from "./candidate.js";
import { KernelError } from "./errors.js";
import {
  characterKnowledge,
  characters,
  events,
  facts,
  locations,
  worlds,
} from "../persistence/schema.js";
import {
  findCharacter,
  findClaim,
  findEvent,
  findFact,
  findLocation,
  findPredicatePolicy,
  findRelationship,
} from "../persistence/sqlite-store.js";

export function validateCandidate(tx: any, candidate: CandidateEvent): void {
  const world = tx.select().from(worlds).where(eq(worlds.id, candidate.worldId)).get();
  if (!world) {
    throw new KernelError("WORLD_NOT_FOUND", "World does not exist", { worldId: candidate.worldId });
  }
  if (candidate.expectedWorldRevision !== world.revision) {
    throw new KernelError("STALE_WORLD_STATE", "Candidate was built from a stale World revision", {
      worldId: candidate.worldId,
      expectedWorldRevision: candidate.expectedWorldRevision,
      currentWorldRevision: world.revision,
    });
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
    if (Date.parse(cause.eventTime) > Date.parse(eventTime)) {
      throw new KernelError("INVALID_TIME", "Cause Event cannot occur after the Candidate Event", {
        causeEventId,
        causeEventTime: cause.eventTime,
        eventTime,
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
    case "character.learn_claim":
      validateKnowledge(tx, candidate, eventTime);
      return;
    case "relationship.change":
      validateRelationship(tx, candidate);
      return;
    case "fact.assert":
      validateFact(tx, candidate);
      return;
    case "claim.record":
      validateClaim(tx, candidate);
      return;
    case "claim.transmit":
      validateClaimTransmission(tx, candidate);
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

function validateKnowledge(
  tx: any,
  candidate: Extract<CandidateEvent, { type: "character.learn_claim" }>,
  eventTime: string,
): void {
  const character = findCharacter(tx, candidate.actorId);
  const claim = findClaim(tx, candidate.claimId);
  if (!character) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Learning Character does not exist", { characterId: candidate.actorId });
  }
  if (!claim) {
    throw new KernelError("CLAIM_NOT_FOUND", "Claim does not exist", { claimId: candidate.claimId });
  }
  if (character.worldId !== candidate.worldId || claim.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Character and Claim must belong to the same World", {
      characterId: candidate.actorId,
      claimId: candidate.claimId,
    });
  }
  if (!candidate.source) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Learning a Claim requires structured provenance", {
      characterId: candidate.actorId,
      claimId: candidate.claimId,
    });
  }

  if (candidate.source.kind === "character") {
    const sourceCharacter = findCharacter(tx, candidate.source.characterId);
    if (!sourceCharacter) {
      throw new KernelError("CHARACTER_NOT_FOUND", "Knowledge source Character does not exist", {
        sourceCharacterId: candidate.source.characterId,
      });
    }
    if (sourceCharacter.worldId !== candidate.worldId) {
      throw new KernelError("CROSS_WORLD_REFERENCE", "Knowledge source Character belongs to another World", {
        sourceCharacterId: candidate.source.characterId,
      });
    }
    if (sourceCharacter.id === character.id) {
      throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "A Character cannot be its own knowledge source", {
        characterId: character.id,
        claimId: candidate.claimId,
      });
    }
    const sourceKnowledge = tx
      .select()
      .from(characterKnowledge)
      .where(and(eq(characterKnowledge.characterId, sourceCharacter.id), eq(characterKnowledge.claimId, claim.id)))
      .get();
    if (!sourceKnowledge) {
      throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Source Character does not know the requested Claim", {
        sourceCharacterId: sourceCharacter.id,
        claimId: claim.id,
      });
    }
    if (sourceKnowledge.knowledgeState !== candidate.knowledgeState) {
      throw new KernelError("KNOWLEDGE_STATE_ESCALATION", "Character propagation must copy the source knowledge state exactly", {
        sourceCharacterId: sourceCharacter.id,
        claimId: claim.id,
        sourceKnowledgeState: sourceKnowledge.knowledgeState,
        requestedKnowledgeState: candidate.knowledgeState,
      });
    }
    return;
  }

  const sourceEvent = findEvent(tx, candidate.source.eventId);
  if (!sourceEvent) {
    throw new KernelError("EVENT_NOT_FOUND", "Knowledge source Event does not exist", {
      sourceEventId: candidate.source.eventId,
    });
  }
  if (sourceEvent.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Knowledge source Event belongs to another World", {
      sourceEventId: candidate.source.eventId,
    });
  }
  if (Date.parse(sourceEvent.eventTime) > Date.parse(eventTime)) {
    throw new KernelError("INVALID_TIME", "Knowledge source Event cannot occur after the learn Event", {
      sourceEventId: candidate.source.eventId,
      sourceEventTime: sourceEvent.eventTime,
      eventTime,
    });
  }
  const sourceActorIds = parseStringArray(sourceEvent.actorIds);
  const sourceTargetIds = parseStringArray(sourceEvent.targetIds);
  if (!sourceActorIds.includes(character.id) && !sourceTargetIds.includes(character.id)) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Learner did not participate in the source Event", {
      sourceEventId: candidate.source.eventId,
      characterId: character.id,
    });
  }
  const sourcePayload = JSON.parse(sourceEvent.payload) as Record<string, unknown>;
  const sourceSupportsClaim =
    (sourceEvent.type === "claim.record" || sourceEvent.type === "character.learn_claim") &&
    sourcePayload.claimId === candidate.claimId;
  if (!sourceSupportsClaim) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Source Event does not establish the requested Claim", {
      sourceEventId: candidate.source.eventId,
      claimId: candidate.claimId,
    });
  }
  if (sourceEvent.type === "character.learn_claim" && sourcePayload.knowledgeState !== candidate.knowledgeState) {
    throw new KernelError("KNOWLEDGE_STATE_ESCALATION", "Claim Event provenance must preserve the source knowledge state exactly", {
      sourceEventId: candidate.source.eventId,
      claimId: candidate.claimId,
      sourceKnowledgeState: sourcePayload.knowledgeState,
      requestedKnowledgeState: candidate.knowledgeState,
    });
  }
}

function validateClaim(tx: any, candidate: Extract<CandidateEvent, { type: "claim.record" }>): void {
  if (findClaim(tx, candidate.claimId)) {
    throw new KernelError("CLAIM_ALREADY_EXISTS", "Claim id has already been recorded", { claimId: candidate.claimId });
  }
  if (candidate.actorId) {
    const actor = findCharacter(tx, candidate.actorId);
    if (!actor) {
      throw new KernelError("CHARACTER_NOT_FOUND", "Claim assertion actor does not exist", {
        characterId: candidate.actorId,
      });
    }
    if (actor.worldId !== candidate.worldId) {
      throw new KernelError("CROSS_WORLD_REFERENCE", "Claim assertion actor belongs to another World", {
        characterId: candidate.actorId,
      });
    }
  }

  const subjectCharacter = findCharacter(tx, candidate.subject);
  const subjectLocation = findLocation(tx, candidate.subject);
  const subjectWorld = tx.select().from(worlds).where(eq(worlds.id, candidate.subject)).get();
  const subjectBelongsToWorld =
    subjectCharacter?.worldId === candidate.worldId ||
    subjectLocation?.worldId === candidate.worldId ||
    subjectWorld?.id === candidate.worldId;
  if (!subjectBelongsToWorld) {
    throw new KernelError("INVALID_CLAIM_SUBJECT", "Claim subject must be a known entity in the same World", {
      subject: candidate.subject,
      worldId: candidate.worldId,
    });
  }
}

function validateClaimTransmission(
  tx: any,
  candidate: Extract<CandidateEvent, { type: "claim.transmit" }>,
): void {
  const source = findCharacter(tx, candidate.sourceCharacterId);
  const target = findCharacter(tx, candidate.targetCharacterId);
  const claim = findClaim(tx, candidate.claimId);

  if (!source) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Transmission source Character does not exist", {
      sourceCharacterId: candidate.sourceCharacterId,
    });
  }
  if (!target) {
    throw new KernelError("CHARACTER_NOT_FOUND", "Transmission target Character does not exist", {
      targetCharacterId: candidate.targetCharacterId,
    });
  }
  if (source.worldId !== candidate.worldId || target.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Source and Target Characters must belong to the same World", {
      sourceCharacterId: candidate.sourceCharacterId,
      targetCharacterId: candidate.targetCharacterId,
      worldId: candidate.worldId,
    });
  }
  if (!source.alive) {
    throw new KernelError("CHARACTER_DEAD", "A dead Character cannot transmit a Claim", {
      characterId: source.id,
    });
  }
  if (!target.alive) {
    throw new KernelError("CHARACTER_DEAD", "Cannot transmit a Claim to a dead Character", {
      characterId: target.id,
    });
  }
  if (source.id === target.id) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "A Character cannot transmit a Claim to itself", {
      characterId: source.id,
      claimId: candidate.claimId,
    });
  }
  if (source.locationId === null || target.locationId === null || source.locationId !== target.locationId) {
    throw new KernelError("CHARACTERS_NOT_COLOCATED", "Source and Target must be co-located to transmit a Claim", {
      sourceCharacterId: source.id,
      sourceLocationId: source.locationId,
      targetCharacterId: target.id,
      targetLocationId: target.locationId,
    });
  }
  if (!claim) {
    throw new KernelError("CLAIM_NOT_FOUND", "Claim does not exist", { claimId: candidate.claimId });
  }
  if (claim.worldId !== candidate.worldId) {
    throw new KernelError("CROSS_WORLD_REFERENCE", "Claim must belong to the same World", {
      claimId: candidate.claimId,
      worldId: candidate.worldId,
    });
  }

  const sourceKnowledge = tx
    .select()
    .from(characterKnowledge)
    .where(and(eq(characterKnowledge.characterId, source.id), eq(characterKnowledge.claimId, claim.id)))
    .get();
  if (!sourceKnowledge) {
    throw new KernelError("KNOWLEDGE_SOURCE_REQUIRED", "Source Character does not know the transmitted Claim", {
      sourceCharacterId: source.id,
      claimId: claim.id,
    });
  }

  const targetKnowledge = tx
    .select()
    .from(characterKnowledge)
    .where(and(eq(characterKnowledge.characterId, target.id), eq(characterKnowledge.claimId, claim.id)))
    .get();
  if (targetKnowledge && targetKnowledge.knowledgeState !== sourceKnowledge.knowledgeState) {
    throw new KernelError("KNOWLEDGE_STATE_ESCALATION", "Target already holds different knowledge state for this Claim; generic transition lattice is not supported", {
      targetCharacterId: target.id,
      claimId: claim.id,
      existingKnowledgeState: targetKnowledge.knowledgeState,
      transmittedKnowledgeState: sourceKnowledge.knowledgeState,
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
  if (candidate.actorId) {
    const actor = findCharacter(tx, candidate.actorId);
    if (!actor) {
      throw new KernelError("CHARACTER_NOT_FOUND", "Fact assertion actor does not exist", {
        characterId: candidate.actorId,
      });
    }
    if (actor.worldId !== candidate.worldId) {
      throw new KernelError("CROSS_WORLD_REFERENCE", "Fact assertion actor belongs to another World", {
        characterId: candidate.actorId,
      });
    }
  }
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
  const configuredPolicy = findPredicatePolicy(tx, candidate.worldId, candidate.predicate);
  const cardinality = configuredPolicy?.cardinality === "many" ? "many" : "one";
  if (cardinality === "many") {
    return;
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

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new KernelError("VALIDATION_FAILED", "Event participant list is malformed");
  }
  return parsed;
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
