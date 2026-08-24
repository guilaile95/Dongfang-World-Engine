import type {
  CharacterRecord,
  ClaimRecord,
  FactRecord,
  KnowledgeRecord,
  LocationRecord,
  WorldRecord,
} from "../authority/types.js";
import type { ContextItemRecord } from "../persist/store.js";
import type { WorldSource } from "./source.js";

export interface CompiledWorld {
  seed: {
    world: WorldRecord;
    locations: LocationRecord[];
    characters: CharacterRecord[];
    facts: FactRecord[];
    claims: ClaimRecord[];
    knowledge: KnowledgeRecord[];
  };
  playerId: string;
  packageTitle: string;
  sourceKind: WorldSource["sourceKind"];
  theme: WorldSource["theme"];
  materials: ContextItemRecord[];
}

export function compileWorld(source: WorldSource): CompiledWorld {
  const player = source.characters.find((row) => row.kind === "player");
  if (!player) {
    throw new Error("WORLD_SOURCE_NO_PLAYER");
  }
  const seedId = `seed-${source.id}`;
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
  return {
    seed: { world, locations, characters, facts, claims, knowledge },
    playerId: player.id,
    packageTitle: source.packageTitle,
    sourceKind: source.sourceKind,
    theme: source.theme,
    materials: [],
  };
}
