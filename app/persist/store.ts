import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  BackgroundThreadRecord,
  CharacterRecord,
  ClaimRecord,
  EventRecord,
  FactRecord,
  KnowledgeRecord,
  ItemRecord,
  LocationRecord,
  LocationRouteRecord,
  MemoryRecord,
  WorldRecord,
  WorldSnapshot,
  SourceRefRecord,
} from "../authority/types.js";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time TEXT NOT NULL,
  revision INTEGER NOT NULL,
  rules_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id)
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source_event_id TEXT,
  source_seed_id TEXT,
  source_kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source_event_id TEXT,
  source_seed_id TEXT,
  source_kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge (
  character_id TEXT NOT NULL REFERENCES characters(id),
  claim_id TEXT NOT NULL REFERENCES claims(id),
  state TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_character_id TEXT,
  source_event_id TEXT,
  source_seed_id TEXT,
  learned_at TEXT NOT NULL,
  PRIMARY KEY (character_id, claim_id)
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  text TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source_event_id TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id),
  carrier_id TEXT REFERENCES characters(id)
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  type TEXT NOT NULL,
  producer TEXT NOT NULL,
  at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  cause_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS context_items (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ui_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  parsed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS player_profiles (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id),
  name TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  starting_location TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  from_location_id TEXT NOT NULL REFERENCES locations(id),
  to_location_id TEXT NOT NULL REFERENCES locations(id),
  via_json TEXT NOT NULL,
  travel_minutes INTEGER NOT NULL,
  bidirectional INTEGER NOT NULL,
  visibility TEXT NOT NULL,
  conditions_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS background_threads (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  actor_ids_json TEXT NOT NULL,
  objective TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  location_scope_json TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  beats_json TEXT NOT NULL,
  executed_beat_ids_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  source_type TEXT NOT NULL,
  work_or_file TEXT NOT NULL,
  edition_or_version TEXT NOT NULL,
  locator TEXT NOT NULL,
  paraphrase TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authority_commits (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  idempotency_key TEXT NOT NULL,
  event_ids_json TEXT NOT NULL,
  PRIMARY KEY (world_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS turn_receipts (
  world_id TEXT NOT NULL REFERENCES worlds(id),
  turn_id TEXT NOT NULL,
  player_line TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (world_id, turn_id)
);
CREATE TABLE IF NOT EXISTS lifecycle_state (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id),
  turn_id TEXT NOT NULL,
  strategy_json TEXT,
  next_step_index INTEGER NOT NULL,
  elapsed_minutes INTEGER NOT NULL,
  terminal_reason TEXT
);
`;

export interface ContextItemRecord {
  id: string;
  worldId: string;
  namespace: string;
  kind: "lore" | "scene" | "summary";
  title: string;
  body: string;
  seq: number;
}

export class WorldStore {
  public readonly sqlite: Database.Database;

  public constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.sqlite = new Database(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(SCHEMA);
  }

  public close(): void {
    this.sqlite.close();
  }

  public transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work)();
  }

  public hasWorld(worldId: string): boolean {
    const row = this.sqlite.prepare("SELECT id FROM worlds WHERE id = ?").get(worldId);
    return row !== undefined;
  }

  public snapshot(worldId: string): WorldSnapshot {
    const worldRow = this.sqlite.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId) as
      | {
        id: string;
        name: string;
        time: string;
        revision: number;
        rules_json: string;
      }
      | undefined;
    if (!worldRow) {
      throw new Error(`WORLD_NOT_FOUND:${worldId}`);
    }
    const world: WorldRecord = {
      id: worldRow.id,
      name: worldRow.name,
      time: worldRow.time,
      revision: worldRow.revision,
      rules: JSON.parse(worldRow.rules_json) as string[],
    };
    const locations = this.sqlite.prepare("SELECT * FROM locations WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      name: string;
    }>;
    const characters = this.sqlite.prepare("SELECT * FROM characters WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      name: string;
      kind: "player" | "npc";
      location_id: string;
    }>;
    const facts = this.sqlite.prepare("SELECT * FROM facts WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      subject: string;
      predicate: string;
      object: string;
      valid_from: string;
      valid_to: string | null;
      source_event_id: string | null;
      source_seed_id: string | null;
      source_kind: "seed" | "event";
    }>;
    const claims = this.sqlite.prepare("SELECT * FROM claims WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      subject: string;
      predicate: string;
      object: string;
      recorded_at: string;
      source_event_id: string | null;
      source_seed_id: string | null;
      source_kind: "seed" | "event";
    }>;
    const knowledge = this.sqlite.prepare(
      `SELECT k.* FROM knowledge k
       JOIN characters c ON c.id = k.character_id
       WHERE c.world_id = ?`,
    ).all(worldId) as Array<{
      character_id: string;
      claim_id: string;
      state: KnowledgeRecord["state"];
      source_kind: KnowledgeRecord["sourceKind"];
      source_character_id: string | null;
      source_event_id: string | null;
      source_seed_id: string | null;
      learned_at: string;
    }>;
    const memories = this.sqlite.prepare("SELECT * FROM memories WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      character_id: string;
      text: string;
      recorded_at: string;
      source_event_id: string | null;
    }>;
    const items = this.sqlite.prepare("SELECT * FROM items WHERE world_id = ?").all(worldId) as Array<{
      id: string;
      world_id: string;
      name: string;
      location_id: string | null;
      carrier_id: string | null;
    }>;
    const routes = this.listRoutes(worldId);
    const backgroundThreads = this.listBackgroundThreads(worldId);
    const sourceRefs = this.listSourceRefs(worldId);
    return {
      world,
      locations: locations.map((row) => ({ id: row.id, worldId: row.world_id, name: row.name }) satisfies LocationRecord),
      items: items.map((row) => ({
        id: row.id,
        worldId: row.world_id,
        name: row.name,
        locationId: row.location_id,
        carrierId: row.carrier_id,
      }) satisfies ItemRecord),
      characters: characters.map((row) => ({
        id: row.id,
        worldId: row.world_id,
        name: row.name,
        kind: row.kind,
        locationId: row.location_id,
      }) satisfies CharacterRecord),
      facts: facts.map((row) => ({
        id: row.id,
        worldId: row.world_id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        sourceEventId: row.source_event_id,
        sourceSeedId: row.source_seed_id,
        sourceKind: row.source_kind,
      }) satisfies FactRecord),
      claims: claims.map((row) => ({
        id: row.id,
        worldId: row.world_id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        recordedAt: row.recorded_at,
        sourceEventId: row.source_event_id,
        sourceSeedId: row.source_seed_id,
        sourceKind: row.source_kind,
      }) satisfies ClaimRecord),
      knowledge: knowledge.map((row) => ({
        characterId: row.character_id,
        claimId: row.claim_id,
        state: row.state,
        sourceKind: row.source_kind,
        sourceCharacterId: row.source_character_id,
        sourceEventId: row.source_event_id,
        sourceSeedId: row.source_seed_id,
        learnedAt: row.learned_at,
      })),
      memories: memories.map((row) => ({
        id: row.id,
        worldId: row.world_id,
        characterId: row.character_id,
        text: row.text,
        recordedAt: row.recorded_at,
        sourceEventId: row.source_event_id,
      }) satisfies MemoryRecord),
      routes,
      backgroundThreads,
      sourceRefs,
    };
  }

  public insertCompiledMetadata(
    routes: LocationRouteRecord[],
    threads: BackgroundThreadRecord[],
    sourceRefs: SourceRefRecord[],
  ): void {
    const route = this.sqlite.prepare(
      `INSERT INTO routes (id, world_id, name, from_location_id, to_location_id, via_json, travel_minutes, bidirectional, visibility, conditions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of routes) route.run(row.id, row.worldId, row.name, row.fromLocationId, row.toLocationId, JSON.stringify(row.viaLocationIds), row.travelMinutes, row.bidirectional ? 1 : 0, row.visibility, JSON.stringify(row.conditions));
    const thread = this.sqlite.prepare(
      `INSERT INTO background_threads (id, world_id, actor_ids_json, objective, current_stage, location_scope_json, starts_at, beats_json, executed_beat_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of threads) thread.run(row.id, row.worldId, JSON.stringify(row.actorIds), row.objective, row.currentStage, JSON.stringify(row.locationScope), row.startsAt, JSON.stringify(row.beats), JSON.stringify(row.executedBeatIds));
    const ref = this.sqlite.prepare(
      `INSERT INTO source_refs (id, world_id, source_type, work_or_file, edition_or_version, locator, paraphrase, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of sourceRefs) ref.run(row.id, row.worldId, row.sourceType, row.workOrFile, row.editionOrVersion, row.locator, row.paraphrase, row.status, row.notes);
  }

  public listRoutes(worldId: string): LocationRouteRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM routes WHERE world_id = ? ORDER BY id").all(worldId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), worldId: String(row.world_id), name: String(row.name), fromLocationId: String(row.from_location_id), toLocationId: String(row.to_location_id),
      viaLocationIds: JSON.parse(String(row.via_json)) as string[], travelMinutes: Number(row.travel_minutes), bidirectional: Number(row.bidirectional) === 1,
      visibility: row.visibility === "hidden" ? "hidden" : "public", conditions: JSON.parse(String(row.conditions_json)) as string[],
    }));
  }

  public listBackgroundThreads(worldId: string): BackgroundThreadRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM background_threads WHERE world_id = ? ORDER BY id").all(worldId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), worldId: String(row.world_id), actorIds: JSON.parse(String(row.actor_ids_json)) as string[], objective: String(row.objective),
      currentStage: String(row.current_stage), locationScope: JSON.parse(String(row.location_scope_json)) as string[], startsAt: String(row.starts_at),
      beats: JSON.parse(String(row.beats_json)) as BackgroundThreadRecord["beats"], executedBeatIds: JSON.parse(String(row.executed_beat_ids_json)) as string[],
    }));
  }

  public listSourceRefs(worldId: string): SourceRefRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM source_refs WHERE world_id = ? ORDER BY id").all(worldId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), worldId: String(row.world_id), sourceType: row.source_type as SourceRefRecord["sourceType"], workOrFile: String(row.work_or_file),
      editionOrVersion: String(row.edition_or_version), locator: String(row.locator), paraphrase: String(row.paraphrase), status: row.status as SourceRefRecord["status"], notes: String(row.notes),
    }));
  }

  public advanceBackgroundThread(threadId: string, beatId: string, stageTo: string): void {
    const row = this.sqlite.prepare("SELECT executed_beat_ids_json FROM background_threads WHERE id = ?").get(threadId) as { executed_beat_ids_json: string } | undefined;
    if (!row) throw new Error(`BACKGROUND_THREAD_NOT_FOUND:${threadId}`);
    const executed = JSON.parse(row.executed_beat_ids_json) as string[];
    this.sqlite.prepare("UPDATE background_threads SET current_stage = ?, executed_beat_ids_json = ? WHERE id = ?").run(stageTo, JSON.stringify([...executed, beatId]), threadId);
  }

  public getAuthorityCommit(worldId: string, key: string): string[] | null {
    const row = this.sqlite.prepare("SELECT event_ids_json FROM authority_commits WHERE world_id = ? AND idempotency_key = ?").get(worldId, key) as { event_ids_json: string } | undefined;
    return row ? JSON.parse(row.event_ids_json) as string[] : null;
  }

  public insertAuthorityCommit(worldId: string, key: string, eventIds: string[]): void {
    this.sqlite.prepare("INSERT INTO authority_commits (world_id, idempotency_key, event_ids_json) VALUES (?, ?, ?)").run(worldId, key, JSON.stringify(eventIds));
  }

  public getTurnReceipt<T>(worldId: string, turnId: string): { playerLine: string; result: T } | null {
    const row = this.sqlite.prepare("SELECT player_line, result_json FROM turn_receipts WHERE world_id = ? AND turn_id = ?").get(worldId, turnId) as { player_line: string; result_json: string } | undefined;
    return row ? { playerLine: row.player_line, result: JSON.parse(row.result_json) as T } : null;
  }

  public insertTurnReceipt(worldId: string, turnId: string, playerLine: string, result: unknown): void {
    this.sqlite.prepare("INSERT OR IGNORE INTO turn_receipts (world_id, turn_id, player_line, result_json) VALUES (?, ?, ?, ?)").run(worldId, turnId, playerLine, JSON.stringify(result));
  }

  public setLifecycleState(input: { worldId: string; turnId: string; strategy: unknown | null; nextStepIndex: number; elapsedMinutes: number; terminalReason: string | null }): void {
    this.sqlite.prepare(
      `INSERT INTO lifecycle_state (world_id, turn_id, strategy_json, next_step_index, elapsed_minutes, terminal_reason)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET turn_id=excluded.turn_id, strategy_json=excluded.strategy_json, next_step_index=excluded.next_step_index, elapsed_minutes=excluded.elapsed_minutes, terminal_reason=excluded.terminal_reason`,
    ).run(input.worldId, input.turnId, input.strategy === null ? null : JSON.stringify(input.strategy), input.nextStepIndex, input.elapsedMinutes, input.terminalReason);
  }

  public getLifecycleState(worldId: string): { turnId: string; strategy: unknown | null; nextStepIndex: number; elapsedMinutes: number; terminalReason: string | null } | null {
    const row = this.sqlite.prepare("SELECT * FROM lifecycle_state WHERE world_id = ?").get(worldId) as Record<string, unknown> | undefined;
    return row ? { turnId: String(row.turn_id), strategy: row.strategy_json ? JSON.parse(String(row.strategy_json)) : null, nextStepIndex: Number(row.next_step_index), elapsedMinutes: Number(row.elapsed_minutes), terminalReason: row.terminal_reason === null ? null : String(row.terminal_reason) } : null;
  }

  public listEvents(worldId: string): EventRecord[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM events WHERE world_id = ? ORDER BY seq ASC",
    ).all(worldId) as Array<{
      seq: number;
      id: string;
      world_id: string;
      type: string;
      producer: EventRecord["producer"];
      at: string;
      payload_json: string;
      cause_json: string;
    }>;
    return rows.map((row) => ({
      seq: row.seq,
      id: row.id,
      worldId: row.world_id,
      type: row.type,
      producer: row.producer,
      at: row.at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      causeEventIds: JSON.parse(row.cause_json) as string[],
    }));
  }

  public insertSeedWorld(input: {
    world: WorldRecord;
    locations: LocationRecord[];
    characters: CharacterRecord[];
    facts: FactRecord[];
    claims: ClaimRecord[];
    knowledge: KnowledgeRecord[];
    items?: ItemRecord[];
  }): void {
    this.transaction(() => {
      this.sqlite.prepare(
        "INSERT INTO worlds (id, name, time, revision, rules_json) VALUES (?, ?, ?, ?, ?)",
      ).run(input.world.id, input.world.name, input.world.time, input.world.revision, JSON.stringify(input.world.rules));
      const insertLocation = this.sqlite.prepare(
        "INSERT INTO locations (id, world_id, name) VALUES (?, ?, ?)",
      );
      for (const location of input.locations) {
        insertLocation.run(location.id, location.worldId, location.name);
      }
      const insertCharacter = this.sqlite.prepare(
        "INSERT INTO characters (id, world_id, name, kind, location_id) VALUES (?, ?, ?, ?, ?)",
      );
      for (const character of input.characters) {
        insertCharacter.run(character.id, character.worldId, character.name, character.kind, character.locationId);
      }
      const insertItem = this.sqlite.prepare(
        "INSERT INTO items (id, world_id, name, location_id, carrier_id) VALUES (?, ?, ?, ?, ?)",
      );
      for (const item of input.items ?? []) {
        insertItem.run(item.id, item.worldId, item.name, item.locationId, item.carrierId);
      }
      const insertFact = this.sqlite.prepare(
        `INSERT INTO facts (id, world_id, subject, predicate, object, valid_from, valid_to, source_event_id, source_seed_id, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const fact of input.facts) {
        insertFact.run(
          fact.id,
          fact.worldId,
          fact.subject,
          fact.predicate,
          fact.object,
          fact.validFrom,
          fact.validTo,
          fact.sourceEventId,
          fact.sourceSeedId,
          fact.sourceKind,
        );
      }
      const insertClaim = this.sqlite.prepare(
        `INSERT INTO claims (id, world_id, subject, predicate, object, recorded_at, source_event_id, source_seed_id, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const claim of input.claims) {
        insertClaim.run(
          claim.id,
          claim.worldId,
          claim.subject,
          claim.predicate,
          claim.object,
          claim.recordedAt,
          claim.sourceEventId,
          claim.sourceSeedId,
          claim.sourceKind,
        );
      }
      const insertKnowledge = this.sqlite.prepare(
        `INSERT INTO knowledge (character_id, claim_id, state, source_kind, source_character_id, source_event_id, source_seed_id, learned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const knowledge of input.knowledge) {
        insertKnowledge.run(
          knowledge.characterId,
          knowledge.claimId,
          knowledge.state,
          knowledge.sourceKind,
          knowledge.sourceCharacterId,
          knowledge.sourceEventId,
          knowledge.sourceSeedId,
          knowledge.learnedAt,
        );
      }
    });
  }

  public insertEvent(input: Omit<EventRecord, "seq">): EventRecord {
    const info = this.sqlite.prepare(
      `INSERT INTO events (id, world_id, type, producer, at, payload_json, cause_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.worldId,
      input.type,
      input.producer,
      input.at,
      JSON.stringify(input.payload),
      JSON.stringify(input.causeEventIds),
    );
    return { ...input, seq: Number(info.lastInsertRowid) };
  }

  public insertFact(fact: FactRecord): void {
    this.sqlite.prepare(
      `INSERT INTO facts (id, world_id, subject, predicate, object, valid_from, valid_to, source_event_id, source_seed_id, source_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fact.id,
      fact.worldId,
      fact.subject,
      fact.predicate,
      fact.object,
      fact.validFrom,
      fact.validTo,
      fact.sourceEventId,
      fact.sourceSeedId,
      fact.sourceKind,
    );
  }

  public insertClaim(claim: ClaimRecord): void {
    this.sqlite.prepare(
      `INSERT OR REPLACE INTO claims (id, world_id, subject, predicate, object, recorded_at, source_event_id, source_seed_id, source_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      claim.id,
      claim.worldId,
      claim.subject,
      claim.predicate,
      claim.object,
      claim.recordedAt,
      claim.sourceEventId,
      claim.sourceSeedId,
      claim.sourceKind,
    );
  }

  public upsertKnowledge(knowledge: KnowledgeRecord): void {
    this.sqlite.prepare(
      `INSERT INTO knowledge (character_id, claim_id, state, source_kind, source_character_id, source_event_id, source_seed_id, learned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(character_id, claim_id) DO UPDATE SET
         state = excluded.state,
         source_kind = excluded.source_kind,
         source_character_id = excluded.source_character_id,
         source_event_id = excluded.source_event_id,
         source_seed_id = excluded.source_seed_id,
         learned_at = excluded.learned_at`,
    ).run(
      knowledge.characterId,
      knowledge.claimId,
      knowledge.state,
      knowledge.sourceKind,
      knowledge.sourceCharacterId,
      knowledge.sourceEventId,
      knowledge.sourceSeedId,
      knowledge.learnedAt,
    );
  }

  public insertMemory(memory: MemoryRecord): void {
    this.sqlite.prepare(
      `INSERT INTO memories (id, world_id, character_id, text, recorded_at, source_event_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id,
      memory.worldId,
      memory.characterId,
      memory.text,
      memory.recordedAt,
      memory.sourceEventId,
    );
  }

  public updateCharacterLocation(characterId: string, locationId: string): void {
    this.sqlite.prepare("UPDATE characters SET location_id = ? WHERE id = ?").run(locationId, characterId);
  }

  public insertItem(item: ItemRecord): void {
    this.sqlite.prepare(
      "INSERT OR REPLACE INTO items (id, world_id, name, location_id, carrier_id) VALUES (?, ?, ?, ?, ?)",
    ).run(item.id, item.worldId, item.name, item.locationId, item.carrierId);
  }

  public updateItem(itemId: string, patch: { locationId: string | null; carrierId: string | null }): void {
    this.sqlite.prepare("UPDATE items SET location_id = ?, carrier_id = ? WHERE id = ?").run(
      patch.locationId,
      patch.carrierId,
      itemId,
    );
  }

  public updateWorld(worldId: string, patch: { time: string; revision: number }): void {
    this.sqlite.prepare("UPDATE worlds SET time = ?, revision = ? WHERE id = ?").run(
      patch.time,
      patch.revision,
      worldId,
    );
  }

  public insertContextItem(item: ContextItemRecord): void {
    const seq = item.seq > 0 ? item.seq : this.nextContextSeq(item.worldId, item.namespace, item.kind);
    this.sqlite.prepare(
      `INSERT OR IGNORE INTO context_items (id, world_id, namespace, kind, title, body, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(item.id, item.worldId, item.namespace, item.kind, item.title, item.body, seq);
  }

  public nextContextSeq(worldId: string, namespace: string, kind: ContextItemRecord["kind"]): number {
    const row = this.sqlite.prepare(
      `SELECT COALESCE(MAX(seq), 0) AS n FROM context_items WHERE world_id = ? AND namespace = ? AND kind = ?`,
    ).get(worldId, namespace, kind) as { n: number };
    return row.n + 1;
  }

  public listRecentScenes(worldId: string, namespace: string, limit: number): ContextItemRecord[] {
    const rows = this.sqlite.prepare(
      `SELECT * FROM (
         SELECT * FROM context_items
         WHERE world_id = ? AND namespace = ? AND kind = 'scene'
         ORDER BY seq DESC
         LIMIT ?
       ) ORDER BY seq ASC`,
    ).all(worldId, namespace, limit) as Array<{
      id: string;
      world_id: string;
      namespace: string;
      kind: ContextItemRecord["kind"];
      title: string;
      body: string;
      seq: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.world_id,
      namespace: row.namespace,
      kind: row.kind,
      title: row.title,
      body: row.body,
      seq: row.seq,
    }));
  }

  public pruneContextKind(worldId: string, namespace: string, kind: ContextItemRecord["kind"], keep: number): void {
    const cutoff = this.sqlite.prepare(
      `SELECT seq FROM context_items
       WHERE world_id = ? AND namespace = ? AND kind = ?
       ORDER BY seq DESC LIMIT 1 OFFSET ?`,
    ).get(worldId, namespace, kind, keep - 1) as { seq: number } | undefined;
    if (!cutoff) {
      return;
    }
    this.sqlite.prepare(
      `DELETE FROM context_items WHERE world_id = ? AND namespace = ? AND kind = ? AND seq < ?`,
    ).run(worldId, namespace, kind, cutoff.seq);
  }

  public listContextItems(worldId: string, namespaces: string[], kind?: ContextItemRecord["kind"]): ContextItemRecord[] {
    if (namespaces.length === 0) {
      return [];
    }
    const placeholders = namespaces.map(() => "?").join(", ");
    const kindClause = kind ? "AND kind = ?" : "";
    const params: unknown[] = [worldId, ...namespaces];
    if (kind) {
      params.push(kind);
    }
    const rows = this.sqlite.prepare(
      `SELECT * FROM context_items WHERE world_id = ? AND namespace IN (${placeholders}) ${kindClause}`,
    ).all(...params) as Array<{
      id: string;
      world_id: string;
      namespace: string;
      kind: ContextItemRecord["kind"];
      title: string;
      body: string;
      seq: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.world_id,
      namespace: row.namespace,
      kind: row.kind,
      title: row.title,
      body: row.body,
      seq: row.seq ?? 0,
    }));
  }

  public deleteContextKind(worldId: string, namespace: string, kind: ContextItemRecord["kind"]): void {
    this.sqlite.prepare(
      "DELETE FROM context_items WHERE world_id = ? AND namespace = ? AND kind = ?",
    ).run(worldId, namespace, kind);
  }

  public deleteAllContext(worldId: string): void {
    this.sqlite.prepare("DELETE FROM context_items WHERE world_id = ?").run(worldId);
  }

  public insertUiMessage(input: { worldId: string; role: "player" | "world" | "notice"; text: string; parsed: boolean }): void {
    this.sqlite.prepare(
      "INSERT INTO ui_messages (world_id, role, text, parsed) VALUES (?, ?, ?, ?)",
    ).run(input.worldId, input.role, input.text, input.parsed ? 1 : 0);
    const cutoff = this.sqlite.prepare(
      `SELECT seq FROM ui_messages WHERE world_id = ? ORDER BY seq DESC LIMIT 1 OFFSET 199`,
    ).get(input.worldId) as { seq: number } | undefined;
    if (cutoff) {
      this.sqlite.prepare("DELETE FROM ui_messages WHERE world_id = ? AND seq < ?").run(input.worldId, cutoff.seq);
    }
  }

  public listUiMessages(worldId: string): Array<{ role: "player" | "world" | "notice"; text: string; parsed: boolean }> {
    const rows = this.sqlite.prepare(
      "SELECT role, text, parsed FROM ui_messages WHERE world_id = ? ORDER BY seq ASC",
    ).all(worldId) as Array<{ role: "player" | "world" | "notice"; text: string; parsed: number }>;
    return rows.map((row) => ({ role: row.role, text: row.text, parsed: row.parsed === 1 }));
  }

  public getPlayerProfile(worldId: string): PlayerProfile | null {
    const row = this.sqlite.prepare("SELECT * FROM player_profiles WHERE world_id = ?").get(worldId) as {
      world_id: string;
      name: string;
      age: string;
      gender: string;
      background: string;
      starting_location: string;
      personality: string;
    } | undefined;
    if (!row) {
      return null;
    }
    return {
      worldId: row.world_id,
      name: row.name,
      age: row.age,
      gender: row.gender,
      background: row.background,
      startingLocation: row.starting_location,
      personality: row.personality,
    };
  }

  public setPlayerProfile(profile: PlayerProfile): void {
    this.sqlite.prepare(
      `INSERT INTO player_profiles (world_id, name, age, gender, background, starting_location, personality)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET
         name=excluded.name, age=excluded.age, gender=excluded.gender,
         background=excluded.background, starting_location=excluded.starting_location,
         personality=excluded.personality`,
    ).run(
      profile.worldId,
      profile.name,
      profile.age,
      profile.gender,
      profile.background,
      profile.startingLocation,
      profile.personality,
    );
  }

  public initializePlayerProfile(profile: PlayerProfile): void {
    this.transaction(() => {
      this.setPlayerProfile(profile);

      const player = this.sqlite.prepare(
        "SELECT id, name, location_id FROM characters WHERE world_id = ? AND kind = 'player'",
      ).get(profile.worldId) as { id: string; name: string; location_id: string } | undefined;

      if (!player) {
        throw new Error(`PLAYER_CHARACTER_NOT_FOUND:${profile.worldId}`);
      }

      if (profile.name.trim()) {
        this.sqlite.prepare(
          "UPDATE characters SET name = ? WHERE id = ? AND world_id = ?",
        ).run(profile.name.trim(), player.id, profile.worldId);
      }

      if (profile.startingLocation.trim()) {
        const targetLoc = profile.startingLocation.trim();
        const loc = this.sqlite.prepare(
          "SELECT id FROM locations WHERE world_id = ? AND (id = ? OR name = ?)",
        ).get(profile.worldId, targetLoc, targetLoc) as { id: string } | undefined;

        if (!loc) {
          throw new Error(`INVALID_STARTING_LOCATION:${targetLoc}`);
        }

        this.sqlite.prepare(
          "UPDATE characters SET location_id = ? WHERE id = ? AND world_id = ?",
        ).run(loc.id, player.id, profile.worldId);
      }
    });
  }

  public setPlayerSituation(worldId: string, observerId: string, situation: string): void {
    const ns = `char:${observerId}`;
    this.sqlite.prepare(
      `INSERT INTO context_items (id, world_id, namespace, kind, title, body, seq)
       VALUES (?, ?, ?, 'summary', 'situation', ?, 0)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
    ).run(`situation-${worldId}-${observerId}`, worldId, ns, situation);
  }

  public getPlayerSituation(worldId: string, observerId: string): string | null {
    const ns = `char:${observerId}`;
    const row = this.sqlite.prepare(
      "SELECT body FROM context_items WHERE world_id = ? AND namespace = ? AND kind = 'summary' AND title = 'situation'",
    ).get(worldId, ns) as { body: string } | undefined;
    return row?.body ?? null;
  }

  public clearPlayerSituation(worldId: string, observerId: string): void {
    const ns = `char:${observerId}`;
    this.sqlite.prepare(
      "DELETE FROM context_items WHERE world_id = ? AND namespace = ? AND kind = 'summary' AND title = 'situation'",
    ).run(worldId, ns);
  }
}

export interface PlayerProfile {
  worldId: string;
  name: string;
  age: string;
  gender: string;
  background: string;
  startingLocation: string;
  personality: string;
}

