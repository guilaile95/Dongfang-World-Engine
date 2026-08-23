import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { KernelError } from "../engine/errors.js";
import type {
  CharacterRecord,
  ClaimRecord,
  CommittedEvent,
  FactRecord,
  KnowledgeRecord,
  LocationConnectionRecord,
  LocationRecord,
  PredicatePolicyRecord,
  RelationshipRecord,
  SeedRecord,
  WorldRecord,
  WorldSnapshot,
} from "../domain/types.js";
import {
  characterKnowledge,
  characters,
  claims,
  createSchemaSql,
  events,
  facts,
  locations,
  locationConnections,
  predicatePolicies,
  relationships,
  schema,
  seeds,
  worlds,
} from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface SeedWorldInput {
  world: WorldRecord;
  seed: SeedRecord;
  locations: LocationRecord[];
  locationConnections: LocationConnectionRecord[];
  characters: CharacterRecord[];
  facts?: FactRecord[];
  claims?: ClaimRecord[];
  knowledge?: KnowledgeRecord[];
  predicatePolicies?: PredicatePolicyRecord[];
  relationships?: RelationshipRecord[];
}

export class SqliteWorldStore {
  public readonly sqlite: Database.Database;
  public readonly db: AppDatabase;

  public constructor(filename = ":memory:") {
    this.sqlite = new Database(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(createSchemaSql);
    this.db = drizzle(this.sqlite, { schema });
  }

  public close(): void {
    this.sqlite.close();
  }

  public seedWorld(input: SeedWorldInput): void {
    this.db.transaction((tx) => {
      validateSeedInput(tx, input);
      tx.insert(worlds)
        .values({
          id: input.world.id,
          name: input.world.name,
          currentTime: input.world.currentTime,
          revision: input.world.revision,
          status: input.world.status,
        })
        .run();

      tx.insert(seeds).values(input.seed).run();

      if (input.locations.length > 0) {
        tx.insert(locations).values(input.locations).run();
      }
      if (input.characters.length > 0) {
        tx.insert(characters).values(
          input.characters.map((character) => ({
            id: character.id,
            worldId: character.worldId,
            name: character.name,
            type: character.type,
            alive: character.alive,
            locationId: character.locationId,
            identity: character.identity,
            currentGoal: character.currentGoal,
          })),
        ).run();
      }
      if (input.locationConnections.length > 0) {
        tx.insert(locationConnections).values(input.locationConnections).run();
      }
      if (input.facts && input.facts.length > 0) {
        tx.insert(facts).values(input.facts).run();
      }
      if (input.claims && input.claims.length > 0) {
        tx.insert(claims).values(input.claims).run();
      }
      if (input.knowledge && input.knowledge.length > 0) {
        tx.insert(characterKnowledge).values(input.knowledge).run();
      }
      if (input.predicatePolicies && input.predicatePolicies.length > 0) {
        tx.insert(predicatePolicies).values(input.predicatePolicies).run();
      }
      if (input.relationships && input.relationships.length > 0) {
        tx.insert(relationships).values(input.relationships).run();
      }
    });
  }

  public transaction<T>(callback: (tx: any) => T): T {
    return this.db.transaction(callback);
  }

  public getSnapshot(worldId: string): WorldSnapshot {
    return readSnapshot(this.db, worldId);
  }

  public listEvents(worldId: string): CommittedEvent[] {
    const rows = this.db
      .select()
      .from(events)
      .where(eq(events.worldId, worldId))
      .orderBy(asc(events.sequence))
      .all();
    return rows.map(toEvent);
  }

  public getEvent(eventId: string): CommittedEvent | null {
    const row = this.db.select().from(events).where(eq(events.id, eventId)).get();
    return row ? toEvent(row) : null;
  }
}

function validateSeedInput(tx: any, input: SeedWorldInput): void {
  const worldId = input.world.id;
  const invalid = (message: string, context: Record<string, unknown> = {}): never => {
    throw new KernelError("SEED_INVALID", message, { worldId, ...context });
  };
  const requireWorld = (kind: string, id: string, actualWorldId: string): void => {
    if (actualWorldId !== worldId) {
      invalid(`${kind} belongs to another World`, { id, referencedWorldId: actualWorldId });
    }
  };
  const charactersById = new Set(input.characters.map((character) => character.id));
  const locationsById = new Set(input.locations.map((location) => location.id));
  const connectionKeys = new Set<string>();
  const claimsById = new Set((input.claims ?? []).map((claim) => claim.id));

  if (input.seed.worldId !== worldId) {
    invalid("Seed belongs to another World", { seedId: input.seed.id, referencedWorldId: input.seed.worldId });
  }
  for (const location of input.locations) {
    requireWorld("Location", location.id, location.worldId);
    if (location.parentId !== null && !locationsById.has(location.parentId)) {
      invalid("Location parent references a Location outside the Seed", {
        locationId: location.id,
        parentId: location.parentId,
      });
    }
  }
  for (const character of input.characters) {
    requireWorld("Character", character.id, character.worldId);
    if (character.locationId !== null && !locationsById.has(character.locationId)) {
      invalid("Character location references a Location outside the Seed", {
        characterId: character.id,
        locationId: character.locationId,
      });
    }
  }
  for (const connection of input.locationConnections) {
    if (connection.fromLocationId === connection.toLocationId) {
      invalid("LocationConnection cannot connect a Location to itself", {
        locationId: connection.fromLocationId,
      });
    }
    const connectionKey = JSON.stringify([connection.fromLocationId, connection.toLocationId]);
    if (connectionKeys.has(connectionKey)) {
      invalid("Seed contains a duplicate LocationConnection", { connectionKey });
    }
    connectionKeys.add(connectionKey);
    requireWorld("LocationConnection", connectionKey, connection.worldId);
    if (!locationsById.has(connection.fromLocationId) || !locationsById.has(connection.toLocationId)) {
      invalid("LocationConnection references a Location outside the Seed", {
        fromLocationId: connection.fromLocationId,
        toLocationId: connection.toLocationId,
      });
    }
  }
  for (const fact of input.facts ?? []) {
    requireWorld("Fact", fact.id, fact.worldId);
    validateSeedSubject(fact.subject, worldId, charactersById, locationsById, "Fact", fact.id, invalid);
    validateSeedReference(fact.sourceSeedId, input.seed.id, "Fact", fact.id, invalid);
    validateEventReference(tx, fact.sourceEventId, worldId, "Fact", fact.id, invalid);
  }
  for (const claim of input.claims ?? []) {
    requireWorld("Claim", claim.id, claim.worldId);
    validateSeedSubject(claim.subject, worldId, charactersById, locationsById, "Claim", claim.id, invalid);
    validateSeedReference(claim.sourceSeedId, input.seed.id, "Claim", claim.id, invalid);
    validateEventReference(tx, claim.sourceEventId, worldId, "Claim", claim.id, invalid);
  }
  for (const policy of input.predicatePolicies ?? []) {
    requireWorld("PredicatePolicy", policy.predicate, policy.worldId);
  }
  for (const knowledge of input.knowledge ?? []) {
    if (!charactersById.has(knowledge.characterId)) {
      invalid("CharacterKnowledge references a Character outside the Seed", {
        characterId: knowledge.characterId,
        claimId: knowledge.claimId,
      });
    }
    if (!claimsById.has(knowledge.claimId)) {
      invalid("CharacterKnowledge references a Claim outside the Seed", {
        characterId: knowledge.characterId,
        claimId: knowledge.claimId,
      });
    }
    validateSeedReference(knowledge.sourceSeedId, input.seed.id, "CharacterKnowledge", knowledge.claimId, invalid);
    if (knowledge.sourceCharacterId !== null && !charactersById.has(knowledge.sourceCharacterId)) {
      invalid("CharacterKnowledge source Character belongs outside the Seed", {
        claimId: knowledge.claimId,
        sourceCharacterId: knowledge.sourceCharacterId,
      });
    }
    validateEventReference(tx, knowledge.sourceEventId, worldId, "CharacterKnowledge", knowledge.claimId, invalid);
  }
  for (const relationship of input.relationships ?? []) {
    if (!charactersById.has(relationship.sourceCharacterId) || !charactersById.has(relationship.targetCharacterId)) {
      invalid("Relationship references a Character outside the Seed", {
        sourceCharacterId: relationship.sourceCharacterId,
        targetCharacterId: relationship.targetCharacterId,
      });
    }
    validateEventReference(tx, relationship.updatedByEventId, worldId, "Relationship", relationship.sourceCharacterId, invalid);
  }
}

function validateSeedSubject(
  subject: string,
  worldId: string,
  charactersById: Set<string>,
  locationsById: Set<string>,
  kind: string,
  id: string,
  invalid: (message: string, context?: Record<string, unknown>) => never,
): void {
  if (subject !== worldId && !charactersById.has(subject) && !locationsById.has(subject)) {
    invalid(`${kind} subject is not an entity in the Seed World`, { id, subject });
  }
}

function validateSeedReference(
  sourceSeedId: string | null,
  expectedSeedId: string,
  kind: string,
  id: string,
  invalid: (message: string, context?: Record<string, unknown>) => never,
): void {
  if (sourceSeedId !== null && sourceSeedId !== expectedSeedId) {
    invalid(`${kind} provenance references another Seed`, { id, sourceSeedId, expectedSeedId });
  }
}

function validateEventReference(
  tx: any,
  sourceEventId: string | null,
  worldId: string,
  kind: string,
  id: string,
  invalid: (message: string, context?: Record<string, unknown>) => never,
): void {
  if (sourceEventId === null) {
    return;
  }
  const sourceEvent = tx.select().from(events).where(eq(events.id, sourceEventId)).get();
  if (!sourceEvent || sourceEvent.worldId !== worldId) {
    invalid(`${kind} provenance references an Event outside the Seed World`, { id, sourceEventId });
  }
}

export function readSnapshot(executor: any, worldId: string): WorldSnapshot {
  const world = executor.select().from(worlds).where(eq(worlds.id, worldId)).get();
  if (!world) {
    throw new KernelError("WORLD_NOT_FOUND", "World does not exist", { worldId });
  }
  const seed = executor.select().from(seeds).where(eq(seeds.worldId, worldId)).get();
  if (!seed) {
    throw new KernelError("SEED_NOT_FOUND", "World does not have an auditable Seed", { worldId });
  }

  const locationRows = executor.select().from(locations).where(eq(locations.worldId, worldId)).all();
  const locationConnectionRows = executor
    .select()
    .from(locationConnections)
    .where(eq(locationConnections.worldId, worldId))
    .orderBy(asc(locationConnections.fromLocationId), asc(locationConnections.toLocationId))
    .all();
  const characterRows = executor.select().from(characters).where(eq(characters.worldId, worldId)).all();
  const factRows = executor.select().from(facts).where(eq(facts.worldId, worldId)).all();
  const claimRows = executor.select().from(claims).where(eq(claims.worldId, worldId)).all();
  const characterIds = characterRows.map((character: { id: string }) => character.id);
  const knowledgeRows = characterIds.flatMap((characterId: string) =>
    executor.select().from(characterKnowledge).where(eq(characterKnowledge.characterId, characterId)).all(),
  );
  const relationshipRows = characterIds.flatMap((characterId: string) =>
    executor.select().from(relationships).where(eq(relationships.sourceCharacterId, characterId)).all(),
  );
  const predicatePolicyRows = executor
    .select()
    .from(predicatePolicies)
    .where(eq(predicatePolicies.worldId, worldId))
    .all();

  return {
    world: {
      id: world.id,
      name: world.name,
      currentTime: world.currentTime,
      revision: world.revision,
      status: world.status as WorldRecord["status"],
    },
    seed: {
      id: seed.id,
      worldId: seed.worldId,
      sourceType: seed.sourceType,
      sourceRef: seed.sourceRef,
      metadata: seed.metadata,
    },
    locations: locationRows.map((location: typeof locationRows[number]) => ({
      id: location.id,
      worldId: location.worldId,
      name: location.name,
      parentId: location.parentId,
      type: location.type,
    })),
    locationConnections: locationConnectionRows.map((connection: typeof locationConnectionRows[number]) => ({
      worldId: connection.worldId,
      fromLocationId: connection.fromLocationId,
      toLocationId: connection.toLocationId,
    })),
    characters: characterRows.map((character: typeof characterRows[number]) => ({
      id: character.id,
      worldId: character.worldId,
      name: character.name,
      type: character.type,
      alive: character.alive,
      locationId: character.locationId,
      identity: character.identity,
      currentGoal: character.currentGoal,
    })),
    facts: factRows.map((fact: typeof factRows[number]) => ({
      id: fact.id,
      worldId: fact.worldId,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
      sourceEventId: fact.sourceEventId,
      sourceSeedId: fact.sourceSeedId,
      sourceType: fact.sourceType,
    })),
    claims: claimRows.map((claim: typeof claimRows[number]) => ({
      id: claim.id,
      worldId: claim.worldId,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      sourceEventId: claim.sourceEventId,
      sourceSeedId: claim.sourceSeedId,
      recordedAt: claim.recordedAt,
    })),
    knowledge: knowledgeRows.map((knowledge: typeof knowledgeRows[number]) => ({
      characterId: knowledge.characterId,
      claimId: knowledge.claimId,
      knowledgeState: knowledge.knowledgeState,
      sourceType: knowledge.sourceType as KnowledgeRecord["sourceType"],
      sourceCharacterId: knowledge.sourceCharacterId,
      sourceEventId: knowledge.sourceEventId,
      sourceSeedId: knowledge.sourceSeedId,
      learnedAt: knowledge.learnedAt,
    })),
    predicatePolicies: predicatePolicyRows.map((policy: typeof predicatePolicyRows[number]) => ({
      worldId: policy.worldId,
      predicate: policy.predicate,
      cardinality: policy.cardinality as PredicatePolicyRecord["cardinality"],
    })),
    relationships: relationshipRows.map((relationship: typeof relationshipRows[number]) => ({
      sourceCharacterId: relationship.sourceCharacterId,
      targetCharacterId: relationship.targetCharacterId,
      trust: relationship.trust,
      hostility: relationship.hostility,
      closeness: relationship.closeness,
      relationshipType: relationship.relationshipType,
      updatedByEventId: relationship.updatedByEventId,
    })),
  };
}

export function toEvent(row: typeof events.$inferSelect): CommittedEvent {
  return {
    id: row.id,
    sequence: row.sequence,
    worldId: row.worldId,
    worldRevision: row.worldRevision,
    eventTime: row.eventTime,
    type: row.type as CommittedEvent["type"],
    locationId: row.locationId,
    actorIds: JSON.parse(row.actorIds) as string[],
    targetIds: JSON.parse(row.targetIds) as string[],
    causeEventIds: JSON.parse(row.causeEventIds) as string[],
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export function findWorld(executor: any, worldId: string): typeof worlds.$inferSelect | undefined {
  return executor.select().from(worlds).where(eq(worlds.id, worldId)).get();
}

export function findCharacter(executor: any, characterId: string): typeof characters.$inferSelect | undefined {
  return executor.select().from(characters).where(eq(characters.id, characterId)).get();
}

export function findLocation(executor: any, locationId: string): typeof locations.$inferSelect | undefined {
  return executor.select().from(locations).where(eq(locations.id, locationId)).get();
}

export function findLocationConnection(
  executor: any,
  worldId: string,
  fromLocationId: string,
  toLocationId: string,
): typeof locationConnections.$inferSelect | undefined {
  return executor
    .select()
    .from(locationConnections)
    .where(and(
      eq(locationConnections.worldId, worldId),
      eq(locationConnections.fromLocationId, fromLocationId),
      eq(locationConnections.toLocationId, toLocationId),
    ))
    .get();
}

export function findFact(executor: any, factId: string): typeof facts.$inferSelect | undefined {
  return executor.select().from(facts).where(eq(facts.id, factId)).get();
}

export function findClaim(executor: any, claimId: string): typeof claims.$inferSelect | undefined {
  return executor.select().from(claims).where(eq(claims.id, claimId)).get();
}

export function findEvent(executor: any, eventId: string): typeof events.$inferSelect | undefined {
  return executor.select().from(events).where(eq(events.id, eventId)).get();
}

export function findPredicatePolicy(
  executor: any,
  worldId: string,
  predicate: string,
): typeof predicatePolicies.$inferSelect | undefined {
  return executor
    .select()
    .from(predicatePolicies)
    .where(and(eq(predicatePolicies.worldId, worldId), eq(predicatePolicies.predicate, predicate)))
    .get();
}

export function findRelationship(
  executor: any,
  sourceCharacterId: string,
  targetCharacterId: string,
): typeof relationships.$inferSelect | undefined {
  return executor
    .select()
    .from(relationships)
    .where(and(eq(relationships.sourceCharacterId, sourceCharacterId), eq(relationships.targetCharacterId, targetCharacterId)))
    .get();
}
