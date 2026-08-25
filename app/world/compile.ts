import type {
  BackgroundThreadRecord,
  CharacterRecord,
  ClaimRecord,
  FactRecord,
  ItemRecord,
  KnowledgeRecord,
  LocationRecord,
  LocationRouteRecord,
  SourceRefRecord,
  WorldRecord,
} from "../authority/types.js";
import type { ContextItemRecord } from "../persist/store.js";
import type { WorldSource } from "./source.js";

export interface CompiledWorld {
  seed: {
    world: WorldRecord;
    locations: LocationRecord[];
    characters: CharacterRecord[];
    items: ItemRecord[];
    facts: FactRecord[];
    claims: ClaimRecord[];
    knowledge: KnowledgeRecord[];
  };
  playerId: string;
  packageTitle: string;
  sourceKind: WorldSource["sourceKind"];
  theme: WorldSource["theme"];
  chronology: import("./source.js").WorldChronology;
  materials: ContextItemRecord[];
  routes: LocationRouteRecord[];
  backgroundThreads: BackgroundThreadRecord[];
  sourceRefs: SourceRefRecord[];
  characterMetadata: Record<string, { alive: boolean; visibility: "public" | "hidden" }>;
}

export function compileWorld(source: WorldSource): CompiledWorld {
  const player = source.characters.find((row) => row.kind === "player");
  if (!player) {
    throw new Error("WORLD_SOURCE_NO_PLAYER");
  }
  const seedId = `seed-${source.id}`;
  const isLongzu = source.id === "longzu" || source.packageTitle.includes("龙族");
  const chronology: import("./source.js").WorldChronology = source.chronology ?? {
    era: isLongzu ? "仕兰中学时期" : "当前时期未标定",
    timeLabel: isLongzu ? "2009年秋 · 傍晚" : source.time,
    publicPremise: isLongzu
      ? "最近这座滨海城市接连发生几起尚未解释的雨夜失踪事件，老城区的街头巷尾议论纷纷。"
      : "平静的世界在日常运转。",
  };
  const world: WorldRecord = {
    id: source.id,
    name: source.publicName,
    time: source.time,
    revision: 0,
    rules: source.rules.filter((row) => row.visibility === "public").map((row) => row.text),
  };
  const locations: LocationRecord[] = source.locations.map((row) => ({
    id: row.id,
    worldId: source.id,
    name: row.name,
  }));
  const characters: CharacterRecord[] = source.characters.map((row) => ({
    id: row.id,
    worldId: source.id,
    name: row.name,
    kind: row.kind,
    locationId: row.locationId,
  }));
  const facts: FactRecord[] = source.facts.map((row) => ({
    id: row.id,
    worldId: source.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    validFrom: source.time,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seedId,
    sourceKind: "seed",
  }));
  const claims: ClaimRecord[] = source.claims.map((row) => ({
    id: row.id,
    worldId: source.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    recordedAt: source.time,
    sourceEventId: null,
    sourceSeedId: seedId,
    sourceKind: "seed",
  }));
  const knowledge: KnowledgeRecord[] = source.claims.flatMap((claim) =>
    claim.knownBy.map((row) => ({
      characterId: row.characterId,
      claimId: claim.id,
      state: row.state,
      sourceKind: "seed" as const,
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seedId,
      learnedAt: source.time,
    })),
  );
  const items: ItemRecord[] = (source.items ?? []).map((row) => ({
    id: row.id,
    worldId: source.id,
    name: row.name,
    locationId: row.carrierId ? null : row.locationId,
    carrierId: row.carrierId,
  }));
  return {
    seed: { world, locations, characters, items, facts, claims, knowledge },
    playerId: player.id,
    packageTitle: source.packageTitle,
    sourceKind: source.sourceKind,
    theme: source.theme,
    chronology,
    materials: [],
    routes: [],
    backgroundThreads: [],
    sourceRefs: [],
    characterMetadata: Object.fromEntries(characters.map((row) => [row.id, { alive: true, visibility: "public" as const }])),
  };
}
