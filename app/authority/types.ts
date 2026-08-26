export type Producer = "system" | "llm";

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

export interface LocationRouteRecord {
  id: string;
  worldId: string;
  name: string;
  fromLocationId: string;
  toLocationId: string;
  viaLocationIds: string[];
  travelMinutes: number;
  bidirectional: boolean;
  visibility: "public" | "hidden";
  conditions: string[];
}

export interface BackgroundExposureRecord {
  kind: "same_location" | "route_intersection" | "public_broadcast" | "visible_result";
  observerRequirements: string[];
  presentationDirective: string;
  stopReason: "new_risk" | "direction_choice" | "material_information" | "meaningful_npc_request" | "obstacle" | "destination_reached";
}

export interface BackgroundBeatRecord {
  beatId: string;
  stageFrom: string;
  stageTo: string;
  dueAt: string | null;
  afterMinutes: number | null;
  preconditions: string[];
  consequences: Array<{
    type: "fact_assert" | "claim_record";
    id: string;
    subject: string;
    predicate: string;
    object: string;
    visibility?: "public" | "hidden" | undefined;
  }>;
  exposureRules: BackgroundExposureRecord[];
}

export interface BackgroundThreadRecord {
  id: string;
  worldId: string;
  actorIds: string[];
  objective: string;
  currentStage: string;
  locationScope: string[];
  startsAt: string;
  beats: BackgroundBeatRecord[];
  executedBeatIds: string[];
}

export interface SourceRefRecord {
  id: string;
  worldId: string;
  sourceType: "official_novel" | "official_revision" | "official_supplement" | "owner_protocol" | "slice_authored";
  workOrFile: string;
  editionOrVersion: string;
  locator: string;
  paraphrase: string;
  status: "confirmed" | "provisional" | "unresolved";
  notes: string;
}

export interface CharacterRecord {
  id: string;
  worldId: string;
  name: string;
  kind: "player" | "npc";
  locationId: string;
}

/** Physical thing. Either at a location or carried. Not an RPG inventory. */
export interface ItemRecord {
  id: string;
  worldId: string;
  name: string;
  locationId: string | null;
  carrierId: string | null;
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
  sourceSeedId: string | null;
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
  items: ItemRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  knowledge: KnowledgeRecord[];
  memories: MemoryRecord[];
  routes: LocationRouteRecord[];
  backgroundThreads: BackgroundThreadRecord[];
  sourceRefs: SourceRefRecord[];
}
