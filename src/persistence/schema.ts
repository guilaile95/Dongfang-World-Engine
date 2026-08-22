import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export const worlds = sqliteTable("worlds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currentTime: text("current_time").notNull(),
  revision: integer("revision").notNull().default(0),
  status: text("status").notNull(),
});

export const seeds = sqliteTable("seeds", {
  id: text("id").primaryKey(),
  worldId: text("world_id").notNull().references(() => worlds.id),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  metadata: text("metadata").notNull(),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  worldId: text("world_id").notNull().references(() => worlds.id),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  type: text("type").notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  worldId: text("world_id").notNull().references(() => worlds.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  alive: integer("alive", { mode: "boolean" }).notNull(),
  locationId: text("location_id"),
  identity: text("identity").notNull(),
  currentGoal: text("current_goal").notNull(),
});

export const events = sqliteTable("events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  worldId: text("world_id").notNull().references(() => worlds.id),
  worldRevision: integer("world_revision").notNull(),
  eventTime: text("event_time").notNull(),
  type: text("event_type").notNull(),
  locationId: text("location_id"),
  actorIds: text("actor_ids").notNull(),
  targetIds: text("target_ids").notNull(),
  causeEventIds: text("cause_event_ids").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const facts = sqliteTable("facts", {
  id: text("id").primaryKey(),
  worldId: text("world_id").notNull().references(() => worlds.id),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  sourceEventId: text("source_event_id").references(() => events.id),
  sourceSeedId: text("source_seed_id").references(() => seeds.id),
  sourceType: text("source_type").notNull(),
});

export const characterKnowledge = sqliteTable(
  "character_knowledge",
  {
    characterId: text("character_id").notNull().references(() => characters.id),
    factId: text("fact_id").notNull().references(() => facts.id),
    knowledgeState: text("knowledge_state").notNull(),
    sourceType: text("source_type").notNull(),
    sourceCharacterId: text("source_character_id").references(() => characters.id),
    sourceEventId: text("source_event_id").references(() => events.id),
    sourceSeedId: text("source_seed_id").references(() => seeds.id),
    learnedAt: text("learned_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.characterId, table.factId] }),
  }),
);

export const predicatePolicies = sqliteTable(
  "predicate_policies",
  {
    worldId: text("world_id").notNull().references(() => worlds.id),
    predicate: text("predicate").notNull(),
    cardinality: text("cardinality").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.worldId, table.predicate] }),
  }),
);

export const relationships = sqliteTable(
  "relationships",
  {
    sourceCharacterId: text("source_character_id").notNull().references(() => characters.id),
    targetCharacterId: text("target_character_id").notNull().references(() => characters.id),
    trust: integer("trust").notNull().default(0),
    hostility: integer("hostility").notNull().default(0),
    closeness: integer("closeness").notNull().default(0),
    relationshipType: text("relationship_type").notNull().default("unknown"),
    updatedByEventId: text("updated_by_event_id").references(() => events.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sourceCharacterId, table.targetCharacterId] }),
  }),
);

export const schema = {
  worlds,
  seeds,
  locations,
  characters,
  events,
  facts,
  characterKnowledge,
  predicatePolicies,
  relationships,
};

export const createSchemaSql = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  current_time TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended'))
);
CREATE TABLE IF NOT EXISTS seeds (
  id TEXT PRIMARY KEY NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  alive INTEGER NOT NULL CHECK (alive IN (0, 1)),
  location_id TEXT,
  identity TEXT NOT NULL,
  current_goal TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  world_revision INTEGER NOT NULL CHECK (world_revision >= 1),
  event_time TEXT NOT NULL,
  event_type TEXT NOT NULL,
  location_id TEXT,
  actor_ids TEXT NOT NULL,
  target_ids TEXT NOT NULL,
  cause_event_ids TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source_event_id TEXT REFERENCES events(id),
  source_seed_id TEXT REFERENCES seeds(id),
  source_type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS character_knowledge (
  character_id TEXT NOT NULL REFERENCES characters(id),
  fact_id TEXT NOT NULL REFERENCES facts(id),
  knowledge_state TEXT NOT NULL CHECK (knowledge_state IN ('unknown', 'rumor', 'suspected', 'believed', 'confirmed')),
  source_type TEXT NOT NULL,
  source_character_id TEXT REFERENCES characters(id),
  source_event_id TEXT REFERENCES events(id),
  source_seed_id TEXT REFERENCES seeds(id),
  learned_at TEXT NOT NULL,
  PRIMARY KEY (character_id, fact_id)
);
CREATE TABLE IF NOT EXISTS predicate_policies (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  predicate TEXT NOT NULL,
  cardinality TEXT NOT NULL CHECK (cardinality IN ('one', 'many')),
  PRIMARY KEY (world_id, predicate)
);
CREATE TABLE IF NOT EXISTS relationships (
  source_character_id TEXT NOT NULL REFERENCES characters(id),
  target_character_id TEXT NOT NULL REFERENCES characters(id),
  trust INTEGER NOT NULL DEFAULT 0 CHECK (trust BETWEEN -100 AND 100),
  hostility INTEGER NOT NULL DEFAULT 0 CHECK (hostility BETWEEN -100 AND 100),
  closeness INTEGER NOT NULL DEFAULT 0 CHECK (closeness BETWEEN -100 AND 100),
  relationship_type TEXT NOT NULL DEFAULT 'unknown',
  updated_by_event_id TEXT REFERENCES events(id),
  PRIMARY KEY (source_character_id, target_character_id)
);
CREATE TRIGGER IF NOT EXISTS events_append_only_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'EVENT_APPEND_ONLY');
END;
CREATE TRIGGER IF NOT EXISTS events_append_only_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'EVENT_APPEND_ONLY');
END;
`;
