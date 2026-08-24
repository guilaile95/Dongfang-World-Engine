import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  CharacterRecord,
  ClaimRecord,
  EventRecord,
  FactRecord,
  KnowledgeRecord,
  LocationRecord,
  MemoryRecord,
  WorldRecord,
  WorldSnapshot,
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
    return {
      world,
      locations: locations.map((row) => ({ id: row.id, worldId: row.world_id, name: row.name }) satisfies LocationRecord),
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
    };
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
      `INSERT INTO claims (id, world_id, subject, predicate, object, recorded_at, source_event_id, source_seed_id, source_kind)
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
}
