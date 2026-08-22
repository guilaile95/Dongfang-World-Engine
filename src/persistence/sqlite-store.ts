import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { KernelError } from "../engine/errors.js";
import type {
  CharacterRecord,
  CommittedEvent,
  FactRecord,
  KnowledgeRecord,
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
  createSchemaSql,
  events,
  facts,
  locations,
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
  characters: CharacterRecord[];
  facts?: FactRecord[];
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
      if (input.facts && input.facts.length > 0) {
        tx.insert(facts).values(input.facts).run();
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
  const characterRows = executor.select().from(characters).where(eq(characters.worldId, worldId)).all();
  const factRows = executor.select().from(facts).where(eq(facts.worldId, worldId)).all();
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
    knowledge: knowledgeRows.map((knowledge: typeof knowledgeRows[number]) => ({
      characterId: knowledge.characterId,
      factId: knowledge.factId,
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

export function findFact(executor: any, factId: string): typeof facts.$inferSelect | undefined {
  return executor.select().from(facts).where(eq(facts.id, factId)).get();
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
