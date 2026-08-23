import type {
  CharacterRecord,
  FactAssertionRequirementRecord,
  FactRecord,
  LocationConnectionRecord,
  LocationRecord,
  PredicatePolicyRecord,
  SeedRecord,
  WorldRecord,
} from "../domain/types.js";
import { SqliteWorldStore, type SeedWorldInput } from "../persistence/sqlite-store.js";

export const CANON_DIVERGENCE_T0 = "2031-04-05T12:00:00.000Z";
export const CANON_DIVERGENCE_T1 = "2031-04-05T13:00:00.000Z";
export const CANON_DIVERGENCE_T2 = "2031-04-05T14:00:00.000Z";
export const CANON_DIVERGENCE_T3 = "2031-04-05T15:00:00.000Z";
export const CANON_DIVERGENCE_T4 = "2031-04-05T16:00:00.000Z";

export interface CanonDivergenceFixtureIds {
  worldId: string;
  playerId: string;
  npcAId: string;
  npcBId: string;
  npcCId: string;
  courtyardId: string;
  eastGateId: string;
  westTowerId: string;
  hiddenFactId: string;
}

export interface CanonDivergenceFixture {
  input: SeedWorldInput;
  ids: CanonDivergenceFixtureIds;
}

export function createCanonDivergenceFixture(suffix: string): CanonDivergenceFixture {
  const world: WorldRecord = {
    id: `world-canon-${suffix}`,
    name: `Moon Gate ${suffix}`,
    currentTime: CANON_DIVERGENCE_T0,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: `seed-canon-${suffix}`,
    worldId: world.id,
    sourceType: "test_fixture",
    sourceRef: "src/testkit/canon-divergence-world.ts",
    metadata: JSON.stringify({ slice: "canon-divergence", suffix }),
  };
  const locations: LocationRecord[] = [
    {
      id: `location-courtyard-${suffix}`,
      worldId: world.id,
      name: "Moon Courtyard",
      parentId: null,
      type: "courtyard",
    },
    {
      id: `location-east-gate-${suffix}`,
      worldId: world.id,
      name: "East Gate",
      parentId: null,
      type: "gate",
    },
    {
      id: `location-west-tower-${suffix}`,
      worldId: world.id,
      name: "West Tower",
      parentId: null,
      type: "tower",
    },
  ];
  const locationConnections: LocationConnectionRecord[] = [
    {
      worldId: world.id,
      fromLocationId: locations[0]!.id,
      toLocationId: locations[1]!.id,
    },
    {
      worldId: world.id,
      fromLocationId: locations[0]!.id,
      toLocationId: locations[2]!.id,
    },
  ];
  const characters: CharacterRecord[] = [
    {
      id: `character-player-${suffix}`,
      worldId: world.id,
      name: "Player",
      type: "player",
      alive: true,
      locationId: locations[0]!.id,
      identity: "A traveler whose choices may alter the local history",
      currentGoal: "Prevent an unjust arrest",
    },
    {
      id: `character-npc-a-${suffix}`,
      worldId: world.id,
      name: "Gate Captain",
      type: "npc",
      alive: true,
      locationId: locations[0]!.id,
      identity: "A captain bound to the city watch",
      currentGoal: "Carry out the current watch route",
    },
    {
      id: `character-npc-b-${suffix}`,
      worldId: world.id,
      name: "Market Keeper",
      type: "npc",
      alive: true,
      locationId: locations[1]!.id,
      identity: "The keeper of the independent dawn market",
      currentGoal: "Open the market on schedule",
    },
    {
      id: `character-npc-c-${suffix}`,
      worldId: world.id,
      name: "Courier",
      type: "npc",
      alive: true,
      locationId: locations[2]!.id,
      identity: "A courier awaiting an authoritative route assignment",
      currentGoal: "Deliver the sealed order",
    },
  ];
  const hiddenFact: FactRecord = {
    id: `fact-hidden-canon-trigger-${suffix}`,
    worldId: world.id,
    subject: world.id,
    predicate: "sealed_order_status",
    object: "active",
    validFrom: CANON_DIVERGENCE_T0,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };
  const predicatePolicies: PredicatePolicyRecord[] = [{
    worldId: world.id,
    predicate: "watch_route",
    cardinality: "one",
  }];
  const factAssertionRequirements: FactAssertionRequirementRecord[] = [
    {
      worldId: world.id,
      assertingSubject: characters[1]!.id,
      assertingPredicate: "watch_route",
      assertingObject: "east_gate",
      requiredSubject: world.id,
      requiredPredicate: "sealed_order_status",
      requiredObject: "active",
    },
    {
      worldId: world.id,
      assertingSubject: characters[3]!.id,
      assertingPredicate: "delivery_outcome",
      assertingObject: "old_canon_arrest",
      requiredSubject: characters[1]!.id,
      requiredPredicate: "watch_route",
      requiredObject: "east_gate",
    },
  ];

  return {
    input: {
      world,
      seed,
      locations,
      locationConnections,
      characters,
      facts: [hiddenFact],
      predicatePolicies,
      factAssertionRequirements,
    },
    ids: {
      worldId: world.id,
      playerId: characters[0]!.id,
      npcAId: characters[1]!.id,
      npcBId: characters[2]!.id,
      npcCId: characters[3]!.id,
      courtyardId: locations[0]!.id,
      eastGateId: locations[1]!.id,
      westTowerId: locations[2]!.id,
      hiddenFactId: hiddenFact.id,
    },
  };
}

export function seedCanonDivergenceWorld(store: SqliteWorldStore, suffix: string): CanonDivergenceFixtureIds {
  const fixture = createCanonDivergenceFixture(suffix);
  store.seedWorld(fixture.input);
  return fixture.ids;
}
