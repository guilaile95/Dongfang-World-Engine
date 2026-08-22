export type WorldStatus = "active" | "paused" | "ended";

export type EventType =
  | "character.move"
  | "character.die"
  | "character.learn_fact"
  | "relationship.change"
  | "fact.assert"
  | "world.time_advance";

export type KnowledgeSource =
  | { kind: "character"; characterId: string }
  | { kind: "event"; eventId: string };

export type KnowledgeSourceType = "initial" | "character" | "event";

export interface WorldRecord {
  id: string;
  name: string;
  currentTime: string;
  status: WorldStatus;
}

export interface LocationRecord {
  id: string;
  worldId: string;
  name: string;
  parentId: string | null;
  type: string;
}

export interface CharacterRecord {
  id: string;
  worldId: string;
  name: string;
  type: string;
  alive: boolean;
  locationId: string | null;
  identity: string;
  currentGoal: string;
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
  sourceType: string;
}

export interface KnowledgeRecord {
  characterId: string;
  factId: string;
  knowledgeState: string;
  sourceType: KnowledgeSourceType;
  sourceCharacterId: string | null;
  sourceEventId: string | null;
  learnedAt: string;
}

export interface RelationshipRecord {
  sourceCharacterId: string;
  targetCharacterId: string;
  trust: number;
  hostility: number;
  closeness: number;
  relationshipType: string;
  updatedByEventId: string | null;
}

export interface CommittedEvent {
  id: string;
  worldId: string;
  eventTime: string;
  type: EventType;
  locationId: string | null;
  actorIds: string[];
  targetIds: string[];
  causeEventIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorldSnapshot {
  world: WorldRecord;
  locations: LocationRecord[];
  characters: CharacterRecord[];
  facts: FactRecord[];
  knowledge: KnowledgeRecord[];
  relationships: RelationshipRecord[];
}
