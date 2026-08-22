import type {
  CharacterRecord,
  FactRecord,
  KnowledgeRecord,
  LocationRecord,
  WorldRecord,
} from "../domain/types.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";

export const TEST_WORLD_ID = "world-1";
export const TEST_TIME = "2019-03-12T12:00:00.000Z";

export interface TestWorldIds {
  world: WorldRecord;
  locations: Record<"beijing" | "tokyo" | "office", LocationRecord>;
  characters: Record<"player" | "zhao" | "npcA" | "npcB" | "npcC", CharacterRecord>;
  secretFact: FactRecord;
}

export function seedTestWorld(store: SqliteWorldStore): TestWorldIds {
  const world: WorldRecord = {
    id: TEST_WORLD_ID,
    name: "东方狂想测试世界",
    currentTime: TEST_TIME,
    status: "active",
  };
  const locations = {
    beijing: {
      id: "location-beijing",
      worldId: TEST_WORLD_ID,
      name: "北京",
      parentId: null,
      type: "city",
    },
    tokyo: {
      id: "location-tokyo",
      worldId: TEST_WORLD_ID,
      name: "东京",
      parentId: null,
      type: "city",
    },
    office: {
      id: "location-office",
      worldId: TEST_WORLD_ID,
      name: "办公室",
      parentId: "location-beijing",
      type: "building",
    },
  } satisfies Record<"beijing" | "tokyo" | "office", LocationRecord>;
  const characters = {
    player: {
      id: "character-player",
      worldId: TEST_WORLD_ID,
      name: "玩家",
      type: "player",
      alive: true,
      locationId: locations.office.id,
      identity: "普通来客",
      currentGoal: "调查异常事件",
    },
    zhao: {
      id: "character-zhao",
      worldId: TEST_WORLD_ID,
      name: "赵雅",
      type: "npc",
      alive: true,
      locationId: locations.office.id,
      identity: "表面身份未明",
      currentGoal: "隐藏真实身份",
    },
    npcA: {
      id: "character-npc-a",
      worldId: TEST_WORLD_ID,
      name: "NPC-A",
      type: "npc",
      alive: true,
      locationId: locations.beijing.id,
      identity: "调查员",
      currentGoal: "追踪异常线索",
    },
    npcB: {
      id: "character-npc-b",
      worldId: TEST_WORLD_ID,
      name: "NPC-B",
      type: "npc",
      alive: true,
      locationId: locations.beijing.id,
      identity: "档案分析员",
      currentGoal: "核对传闻来源",
    },
    npcC: {
      id: "character-npc-c",
      worldId: TEST_WORLD_ID,
      name: "NPC-C",
      type: "npc",
      alive: true,
      locationId: locations.beijing.id,
      identity: "旁观者",
      currentGoal: "保持低调",
    },
  } satisfies Record<"player" | "zhao" | "npcA" | "npcB" | "npcC", CharacterRecord>;
  const secretFact: FactRecord = {
    id: "fact-001",
    worldId: TEST_WORLD_ID,
    subject: characters.zhao.id,
    predicate: "secret_affiliation",
    object: "隐藏组织",
    validFrom: TEST_TIME,
    validTo: null,
    sourceEventId: null,
    sourceType: "initial_lore",
  };
  const knowledge: KnowledgeRecord[] = [
    {
      characterId: characters.zhao.id,
      factId: secretFact.id,
      knowledgeState: "confirmed",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      learnedAt: TEST_TIME,
    },
    {
      characterId: characters.npcA.id,
      factId: secretFact.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      learnedAt: TEST_TIME,
    },
  ];

  store.seedWorld({
    world,
    locations: Object.values(locations),
    characters: Object.values(characters),
    facts: [secretFact],
    knowledge,
  });
  return { world, locations, characters, secretFact };
}
