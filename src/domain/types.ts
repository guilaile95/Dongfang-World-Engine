export type WorldStatus = "active" | "paused" | "ended";

export type EventType =
  | "character.move"
  | "character.die"
  | "character.learn_claim"
  | "relationship.change"
  | "fact.assert"
  | "claim.record"
  | "world.time_advance";

export type KnowledgeSource =
  | { kind: "character"; characterId: string }
  | { kind: "event"; eventId: string };

export type KnowledgeSourceType = "initial" | "character" | "event";

export type KnowledgeState = "unknown" | "rumor" | "suspected" | "believed" | "confirmed";

export type PredicateCardinality = "one" | "many";

export interface WorldRecord {
  id: string;
  name: string;
  currentTime: string;
  revision: number;
  status: WorldStatus;
}

export interface SeedRecord {
  id: string;
  worldId: string;
  sourceType: string;
  sourceRef: string;
  metadata: string;
}

export interface PredicatePolicyRecord {
  worldId: string;
  predicate: string;
  cardinality: PredicateCardinality;
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
  sourceSeedId: string | null;
  sourceType: string;
}

export interface ClaimRecord {
  id: string;
  worldId: string;
  subject: string;
  predicate: string;
  object: string;
  sourceEventId: string | null;
  sourceSeedId: string | null;
  recordedAt: string;
}

export interface KnowledgeRecord {
  characterId: string;
  claimId: string;
  knowledgeState: KnowledgeState;
  sourceType: KnowledgeSourceType;
  sourceCharacterId: string | null;
  sourceEventId: string | null;
  sourceSeedId: string | null;
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
  sequence: number;
  worldId: string;
  worldRevision: number;
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
  seed: SeedRecord;
  locations: LocationRecord[];
  characters: CharacterRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  knowledge: KnowledgeRecord[];
  predicatePolicies: PredicatePolicyRecord[];
  relationships: RelationshipRecord[];
}
