import { and, eq } from "drizzle-orm";
import type { CandidateEvent } from "./candidate.js";
import type { CommittedEvent, WorldSnapshot } from "../domain/types.js";
import {
  characterKnowledge,
  characters,
  facts,
  relationships,
  worlds,
} from "../persistence/schema.js";
import { findRelationship } from "../persistence/sqlite-store.js";

export function projectEvent(tx: any, event: CommittedEvent): void {
  const payload = event.payload;
  switch (event.type) {
    case "character.move":
      tx.update(characters)
        .set({ locationId: stringValue(payload.toLocationId) })
        .where(eq(characters.id, stringValue(payload.actorId)))
        .run();
      break;
    case "character.die":
      tx.update(characters)
        .set({ alive: false })
        .where(eq(characters.id, stringValue(payload.actorId)))
        .run();
      break;
    case "character.learn_fact":
      projectKnowledge(tx, event);
      break;
    case "relationship.change":
      projectRelationship(tx, event);
      break;
    case "fact.assert":
      projectFact(tx, event);
      break;
    case "world.time_advance":
      break;
  }
  advanceWorldClock(tx, event);
}

function projectKnowledge(tx: any, event: CommittedEvent): void {
  const payload = event.payload;
  const characterId = stringValue(payload.actorId);
  const factId = stringValue(payload.factId);
  const existing = tx
    .select()
    .from(characterKnowledge)
    .where(and(eq(characterKnowledge.characterId, characterId), eq(characterKnowledge.factId, factId)))
    .get();
  const provenance = provenanceValues(payload.source);
  const values = {
    characterId,
    factId,
    knowledgeState: stringValue(payload.knowledgeState),
    ...provenance,
    learnedAt: event.eventTime,
  };
  if (existing) {
    tx.update(characterKnowledge)
      .set({
        knowledgeState: values.knowledgeState,
        sourceType: values.sourceType,
        sourceCharacterId: values.sourceCharacterId,
        sourceEventId: values.sourceEventId,
        learnedAt: values.learnedAt,
      })
      .where(and(eq(characterKnowledge.characterId, characterId), eq(characterKnowledge.factId, factId)))
      .run();
  } else {
    tx.insert(characterKnowledge).values(values).run();
  }
}

function projectRelationship(tx: any, event: CommittedEvent): void {
  const payload = event.payload;
  const sourceCharacterId = stringValue(payload.sourceCharacterId);
  const targetCharacterId = stringValue(payload.targetCharacterId);
  const current = findRelationship(tx, sourceCharacterId, targetCharacterId);
  const values = {
    sourceCharacterId,
    targetCharacterId,
    trust: (current?.trust ?? 0) + numberValue(payload.trustDelta),
    hostility: (current?.hostility ?? 0) + numberValue(payload.hostilityDelta),
    closeness: (current?.closeness ?? 0) + numberValue(payload.closenessDelta),
    relationshipType: stringValue(payload.relationshipType ?? current?.relationshipType ?? "unknown"),
    updatedByEventId: event.id,
  };
  if (current) {
    tx.update(relationships)
      .set({
        trust: values.trust,
        hostility: values.hostility,
        closeness: values.closeness,
        relationshipType: values.relationshipType,
        updatedByEventId: values.updatedByEventId,
      })
      .where(and(eq(relationships.sourceCharacterId, sourceCharacterId), eq(relationships.targetCharacterId, targetCharacterId)))
      .run();
  } else {
    tx.insert(relationships).values(values).run();
  }
}

function projectFact(tx: any, event: CommittedEvent): void {
  const payload = event.payload;
  const subject = stringValue(payload.subject);
  const predicate = stringValue(payload.predicate);
  const object = stringValue(payload.object);
  const validFrom = stringValue(payload.validFrom);
  const validTo = payload.validTo === null ? null : stringValue(payload.validTo);
  const existingOpenFacts = tx
    .select()
    .from(facts)
    .where(and(eq(facts.worldId, event.worldId), eq(facts.subject, subject), eq(facts.predicate, predicate)))
    .all()
    .filter((fact: typeof facts.$inferSelect) => fact.object !== object && fact.validTo === null && Date.parse(fact.validFrom) < Date.parse(validFrom));
  for (const existing of existingOpenFacts) {
    tx.update(facts).set({ validTo: validFrom }).where(eq(facts.id, existing.id)).run();
  }
  tx.insert(facts)
    .values({
      id: stringValue(payload.factId),
      worldId: event.worldId,
      subject,
      predicate,
      object,
      validFrom,
      validTo,
      sourceEventId: event.id,
      sourceType: "event",
    })
    .run();
}

export function rebuildState(initial: WorldSnapshot, eventLog: CommittedEvent[]): WorldSnapshot {
  const state = JSON.parse(JSON.stringify(initial)) as WorldSnapshot;
  for (const event of eventLog) {
    applyEventToSnapshot(state, event);
  }
  return state;
}

function applyEventToSnapshot(state: WorldSnapshot, event: CommittedEvent): void {
  const payload = event.payload;
  if (Date.parse(event.eventTime) > Date.parse(state.world.currentTime)) {
    state.world.currentTime = event.eventTime;
  }
  switch (event.type) {
    case "character.move": {
      const character = state.characters.find((value) => value.id === stringValue(payload.actorId));
      if (character) {
        character.locationId = stringValue(payload.toLocationId);
      }
      return;
    }
    case "character.die": {
      const character = state.characters.find((value) => value.id === stringValue(payload.actorId));
      if (character) {
        character.alive = false;
      }
      return;
    }
    case "character.learn_fact": {
      const characterId = stringValue(payload.actorId);
      const factId = stringValue(payload.factId);
      const existing = state.knowledge.find((value) => value.characterId === characterId && value.factId === factId);
      const provenance = provenanceValues(payload.source);
      const next = {
        characterId,
        factId,
        knowledgeState: stringValue(payload.knowledgeState),
        ...provenance,
        learnedAt: event.eventTime,
      };
      if (existing) {
        Object.assign(existing, next);
      } else {
        state.knowledge.push(next);
      }
      return;
    }
    case "relationship.change": {
      const sourceCharacterId = stringValue(payload.sourceCharacterId);
      const targetCharacterId = stringValue(payload.targetCharacterId);
      const existing = state.relationships.find(
        (value) => value.sourceCharacterId === sourceCharacterId && value.targetCharacterId === targetCharacterId,
      );
      const next = {
        sourceCharacterId,
        targetCharacterId,
        trust: (existing?.trust ?? 0) + numberValue(payload.trustDelta),
        hostility: (existing?.hostility ?? 0) + numberValue(payload.hostilityDelta),
        closeness: (existing?.closeness ?? 0) + numberValue(payload.closenessDelta),
        relationshipType: stringValue(payload.relationshipType ?? existing?.relationshipType ?? "unknown"),
        updatedByEventId: event.id,
      };
      if (existing) {
        Object.assign(existing, next);
      } else {
        state.relationships.push(next);
      }
      return;
    }
    case "fact.assert": {
      const factId = stringValue(payload.factId);
      const subject = stringValue(payload.subject);
      const predicate = stringValue(payload.predicate);
      const object = stringValue(payload.object);
      const validFrom = stringValue(payload.validFrom);
      const validTo = payload.validTo === null ? null : stringValue(payload.validTo);
      for (const fact of state.facts) {
        if (
          fact.worldId === event.worldId &&
          fact.subject === subject &&
          fact.predicate === predicate &&
          fact.object !== object &&
          fact.validTo === null &&
          Date.parse(fact.validFrom) < Date.parse(validFrom)
        ) {
          fact.validTo = validFrom;
        }
      }
      state.facts.push({
        id: factId,
        worldId: event.worldId,
        subject,
        predicate,
        object,
        validFrom,
        validTo,
        sourceEventId: event.id,
        sourceType: "event",
      });
      return;
    }
    case "world.time_advance":
      return;
  }
}

function advanceWorldClock(tx: any, event: CommittedEvent): void {
  const world = tx.select().from(worlds).where(eq(worlds.id, event.worldId)).get();
  if (world && Date.parse(event.eventTime) > Date.parse(world.currentTime)) {
    tx.update(worlds)
      .set({ currentTime: event.eventTime })
      .where(eq(worlds.id, event.worldId))
      .run();
  }
}

function provenanceValues(value: unknown): {
  sourceType: "character" | "event";
  sourceCharacterId: string | null;
  sourceEventId: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Projector expected structured knowledge provenance");
  }
  const source = value as Record<string, unknown>;
  if (source.kind === "character") {
    return {
      sourceType: "character",
      sourceCharacterId: stringValue(source.characterId),
      sourceEventId: null,
    };
  }
  if (source.kind === "event") {
    return {
      sourceType: "event",
      sourceCharacterId: null,
      sourceEventId: stringValue(source.eventId),
    };
  }
  throw new Error("Projector received an unknown knowledge provenance kind");
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Projector expected a non-empty string");
  }
  return value;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
