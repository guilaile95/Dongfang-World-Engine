export type Producer = "system" | "world_tick" | "llm";

export type KnowledgeState = "rumor" | "believed" | "confirmed";

export type KnowledgeSource =
  | { kind: "event"; eventId: string }
  | { kind: "character"; characterId: string }
  | { kind: "seed"; seedId: string };

export interface WorldRecord {
  id: string;
  name: string;
  time: string;
  revision: number;
  rules: string[];
}

export interface LocationRecord {
  id: string;
  worldId: string;
  name: string;
}

export interface CharacterRecord {
  id: string;
  worldId: string;
  name: string;
  kind: "player" | "npc";
  locationId: string;
}

export interface FactRecord {
  id: string;
  worldId: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string;
  validTo: string | null;
  sourceEventId: string | null;
  sourceKind: "seed" | "event";
}

export interface ClaimRecord {
  id: string;
  worldId: string;
  subject: string;
  predicate: string;
  object: string;
  recordedAt: string;
  sourceEventId: string | null;
  sourceKind: "seed" | "event";
}

export interface KnowledgeRecord {
  characterId: string;
  claimId: string;
  state: KnowledgeState;
  sourceKind: KnowledgeSource["kind"];
  sourceCharacterId: string | null;
  sourceEventId: string | null;
  sourceSeedId: string | null;
  learnedAt: string;
}

/** Impression / recall. Never objective truth and never grants knowledge of a Claim. */
export interface MemoryRecord {
  id: string;
  worldId: string;
  characterId: string;
  text: string;
  recordedAt: string;
  sourceEventId: string | null;
}

export interface EventRecord {
  seq: number;
  id: string;
  worldId: string;
  type: string;
  producer: Producer;
  at: string;
  payload: Record<string, unknown>;
  causeEventIds: string[];
}

export interface WorldSnapshot {
  world: WorldRecord;
  locations: LocationRecord[];
  characters: CharacterRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  knowledge: KnowledgeRecord[];
  memories: MemoryRecord[];
}
