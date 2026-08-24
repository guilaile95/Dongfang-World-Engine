import type { WorldStore } from "../persist/store.js";
import type {
  CharacterRecord,
  ClaimRecord,
  FactRecord,
  KnowledgeRecord,
  LocationRecord,
  WorldRecord,
} from "../authority/types.js";

export const WORLD_ID = "riverside-inn";
export const SEED_ID = "seed-riverside-inn";
export const TIME0 = "day-1-morning";

export const LOC_HALL = "loc-hall";
export const LOC_KITCHEN = "loc-kitchen";
export const LOC_CELLAR = "loc-cellar";

export const CHAR_PLAYER = "char-player";
export const CHAR_KEEPER = "char-keeper";
export const CHAR_COOK = "char-cook";

export const FACT_BAG = "fact-bag-in-cellar";
export const FACT_INN_OPEN = "fact-inn-open";
export const FACT_GUEST_MISSING = "fact-guest-missing";

export const CLAIM_BAG = "claim-bag-in-cellar";
export const CLAIM_GUEST_FLED = "claim-guest-fled";

export const BEATS = [
  "day-1-morning",
  "day-1-noon",
  "day-1-evening",
  "day-2-morning",
  "day-2-noon",
  "day-2-evening",
  "day-3-morning",
] as const;

export function nextBeat(time: string): string {
  const index = BEATS.indexOf(time as (typeof BEATS)[number]);
  if (index === -1 || index >= BEATS.length - 1) {
    return `${time}+`;
  }
  const next = BEATS[index + 1];
  if (!next) {
    return `${time}+`;
  }
  return next;
}

export function seedInput(): {
  world: WorldRecord;
  locations: LocationRecord[];
  characters: CharacterRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  knowledge: KnowledgeRecord[];
} {
  const world: WorldRecord = {
    id: WORLD_ID,
    name: "临河客栈",
    time: TIME0,
    revision: 0,
    rules: [
      "地窖里的物事只有掌柜清楚，旁人不会随口知道。",
      "失踪的客人还没结案；有人吃饭或闲逛时，这件事也不会改写成食客日常。",
    ],
  };
  return {
    world,
    locations: [
      { id: LOC_HALL, worldId: WORLD_ID, name: "堂屋" },
      { id: LOC_KITCHEN, worldId: WORLD_ID, name: "厨房" },
      { id: LOC_CELLAR, worldId: WORLD_ID, name: "地窖" },
    ],
    characters: [
      { id: CHAR_PLAYER, worldId: WORLD_ID, name: "旅人", kind: "player", locationId: LOC_HALL },
      { id: CHAR_KEEPER, worldId: WORLD_ID, name: "掌柜老周", kind: "npc", locationId: LOC_HALL },
      { id: CHAR_COOK, worldId: WORLD_ID, name: "厨子阿福", kind: "npc", locationId: LOC_KITCHEN },
    ],
    facts: [
      {
        id: FACT_INN_OPEN,
        worldId: WORLD_ID,
        subject: "inn",
        predicate: "status",
        object: "open",
        validFrom: TIME0,
        validTo: null,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        sourceKind: "seed",
      },
      {
        id: FACT_GUEST_MISSING,
        worldId: WORLD_ID,
        subject: "guest-li",
        predicate: "status",
        object: "missing",
        validFrom: TIME0,
        validTo: null,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        sourceKind: "seed",
      },
      {
        id: FACT_BAG,
        worldId: WORLD_ID,
        subject: "guest-li-bag",
        predicate: "located_in",
        object: LOC_CELLAR,
        validFrom: TIME0,
        validTo: null,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        sourceKind: "seed",
      },
    ],
    claims: [
      {
        id: CLAIM_BAG,
        worldId: WORLD_ID,
        subject: "guest-li-bag",
        predicate: "located_in",
        object: LOC_CELLAR,
        recordedAt: TIME0,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        sourceKind: "seed",
      },
      {
        id: CLAIM_GUEST_FLED,
        worldId: WORLD_ID,
        subject: "guest-li",
        predicate: "fled_to",
        object: "town",
        recordedAt: TIME0,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        sourceKind: "seed",
      },
    ],
    knowledge: [
      {
        characterId: CHAR_KEEPER,
        claimId: CLAIM_BAG,
        state: "confirmed",
        sourceKind: "seed",
        sourceCharacterId: null,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        learnedAt: TIME0,
      },
      {
        characterId: CHAR_COOK,
        claimId: CLAIM_GUEST_FLED,
        state: "rumor",
        sourceKind: "seed",
        sourceCharacterId: null,
        sourceEventId: null,
        sourceSeedId: SEED_ID,
        learnedAt: TIME0,
      },
    ],
  };
}

export function seedWorld(store: WorldStore): void {
  if (!store.hasWorld(WORLD_ID)) {
    store.insertSeedWorld(seedInput());
  }
}
