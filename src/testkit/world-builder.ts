import type {
  CharacterRecord,
  ClaimRecord,
  FactRecord,
  LocationConnectionRecord,
  KnowledgeRecord,
  LocationRecord,
  PredicatePolicyRecord,
  SeedRecord,
  WorldRecord,
} from "../domain/types.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";

export const TEST_WORLD_ID = "world-1";
export const TEST_TIME = "2019-03-12T12:00:00.000Z";

export interface TestWorldIds {
  world: WorldRecord;
  locations: Record<"beijing" | "tokyo" | "office" | "hidden", LocationRecord>;
  characters: Record<"player" | "zhao" | "npcA" | "npcB" | "npcC", CharacterRecord>;
  secretFact: FactRecord;
  secretClaim: ClaimRecord;
  unverifiedClaim: ClaimRecord;
  seed: SeedRecord;
}

export function seedTestWorld(store: SqliteWorldStore): TestWorldIds {
  const world: WorldRecord = {
    id: TEST_WORLD_ID,
    name: "东方狂想测试世界",
    currentTime: TEST_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: "seed-test-world-v1",
    worldId: TEST_WORLD_ID,
    sourceType: "test_fixture",
    sourceRef: "src/testkit/world-builder.ts",
    metadata: JSON.stringify({ name: "deterministic-kernel-fixture", version: 1 }),
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
    hidden: {
      id: "location-hidden",
      worldId: TEST_WORLD_ID,
      name: "隐藏地点",
      parentId: null,
      type: "room",
    },
  } satisfies Record<"beijing" | "tokyo" | "office" | "hidden", LocationRecord>;
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
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };
  const secretClaim: ClaimRecord = {
    id: "claim-001",
    worldId: TEST_WORLD_ID,
    subject: characters.zhao.id,
    predicate: "secret_affiliation",
    object: "隐藏组织",
    sourceEventId: null,
    sourceSeedId: seed.id,
    recordedAt: TEST_TIME,
  };
  const unverifiedClaim: ClaimRecord = {
    id: "claim-unverified-001",
    worldId: TEST_WORLD_ID,
    subject: characters.npcC.id,
    predicate: "organization_membership",
    object: "组织-A",
    sourceEventId: null,
    sourceSeedId: seed.id,
    recordedAt: TEST_TIME,
  };
  const knowledge: KnowledgeRecord[] = [
    {
      characterId: characters.zhao.id,
      claimId: secretClaim.id,
      knowledgeState: "confirmed",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: TEST_TIME,
    },
    {
      characterId: characters.npcA.id,
      claimId: secretClaim.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: TEST_TIME,
    },
    {
      characterId: characters.npcA.id,
      claimId: unverifiedClaim.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: TEST_TIME,
    },
    {
      characterId: characters.npcB.id,
      claimId: unverifiedClaim.id,
      knowledgeState: "believed",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: TEST_TIME,
    },
  ];
  const predicatePolicies: PredicatePolicyRecord[] = [
    {
      worldId: TEST_WORLD_ID,
      predicate: "known_multi",
      cardinality: "many",
    },
  ];
  const locationConnections: LocationConnectionRecord[] = [
    { worldId: TEST_WORLD_ID, fromLocationId: locations.office.id, toLocationId: locations.beijing.id },
    { worldId: TEST_WORLD_ID, fromLocationId: locations.office.id, toLocationId: locations.tokyo.id },
    { worldId: TEST_WORLD_ID, fromLocationId: locations.beijing.id, toLocationId: locations.office.id },
    { worldId: TEST_WORLD_ID, fromLocationId: locations.beijing.id, toLocationId: locations.tokyo.id },
    { worldId: TEST_WORLD_ID, fromLocationId: locations.tokyo.id, toLocationId: locations.beijing.id },
    { worldId: TEST_WORLD_ID, fromLocationId: locations.tokyo.id, toLocationId: locations.office.id },
  ];

  store.seedWorld({
    world,
    seed,
    locations: Object.values(locations),
    locationConnections,
    characters: Object.values(characters),
    facts: [secretFact],
    claims: [secretClaim, unverifiedClaim],
    knowledge,
    predicatePolicies,
  });
  return { world, locations, characters, secretFact, secretClaim, unverifiedClaim, seed };
}

export const CLOSED_INN_WORLD_ID = "world-closed-inn";
export const CLOSED_INN_INITIAL_TIME = "2019-03-12T18:00:00.000Z";

export const CLOSED_INN_WORLD_RULES = [
  "世界不是围绕玩家存在的。玩家吃饭、闲逛、闲聊时，已开始的剧情与 NPC 仍按自己的目标继续。",
  "不要把所有事件解释成对玩家的反应。",
  "已确认的世界事实与规则优先于本轮闲聊。",
  "失踪匕首调查是已开始的剧情主线，不会因为旅客走开而消失。",
] as const;

export function parseClosedInnWorldRules(metadata: string): string[] {
  const parsed = JSON.parse(metadata) as { rules?: unknown };
  if (!Array.isArray(parsed.rules)) {
    return [];
  }
  return parsed.rules.filter((rule): rule is string => typeof rule === "string" && rule.trim().length > 0);
}

export interface ClosedInnFixtureIds {
  world: WorldRecord;
  seed: SeedRecord;
  locations: Record<"hall" | "cellar" | "guestRoom", LocationRecord>;
  characters: Record<"player" | "npcA" | "npcB" | "npcC", CharacterRecord>;
  hiddenTruth: FactRecord;
  claims: Record<"trueCellar" | "falseTheftNpcB" | "falseGuestRoom" | "plotOngoing", ClaimRecord>;
  plotStage: FactRecord;
}

export function seedClosedInnWorld(store: SqliteWorldStore): ClosedInnFixtureIds {
  const world: WorldRecord = {
    id: CLOSED_INN_WORLD_ID,
    name: "封闭客栈匕首谜案",
    currentTime: CLOSED_INN_INITIAL_TIME,
    revision: 0,
    status: "active",
  };
  const seed: SeedRecord = {
    id: "seed-closed-inn-v1",
    worldId: CLOSED_INN_WORLD_ID,
    sourceType: "test_fixture",
    sourceRef: "src/testkit/world-builder.ts",
    metadata: JSON.stringify({
      fixture: "closed-inn",
      version: 2,
      rules: [...CLOSED_INN_WORLD_RULES],
    }),
  };
  const locations = {
    hall: {
      id: "location-inn-hall",
      worldId: CLOSED_INN_WORLD_ID,
      name: "客栈大堂",
      parentId: null,
      type: "room",
    },
    cellar: {
      id: "location-cellar",
      worldId: CLOSED_INN_WORLD_ID,
      name: "客栈地窖",
      parentId: null,
      type: "room",
    },
    guestRoom: {
      id: "location-guest-room",
      worldId: CLOSED_INN_WORLD_ID,
      name: "二楼客房",
      parentId: null,
      type: "room",
    },
  } satisfies Record<"hall" | "cellar" | "guestRoom", LocationRecord>;

  const characters = {
    player: {
      id: "character-player",
      worldId: CLOSED_INN_WORLD_ID,
      name: "旅客·顾云舟",
      type: "player",
      alive: true,
      locationId: locations.hall.id,
      identity: "避雨借宿的行者",
      currentGoal: "查明失踪匕首下落并离开客栈",
    },
    npcA: {
      id: "character-npc-a",
      worldId: CLOSED_INN_WORLD_ID,
      name: "店小二·阿宝",
      type: "npc",
      alive: true,
      locationId: locations.hall.id,
      identity: "负责大堂杂务的伙计",
      currentGoal: "证明自己清白并告知可信者匕首真实掉落地窖",
    },
    npcB: {
      id: "character-npc-b",
      worldId: CLOSED_INN_WORLD_ID,
      name: "账房·赵先生",
      type: "npc",
      alive: true,
      locationId: locations.hall.id,
      identity: "客栈算账先生",
      currentGoal: "怀疑有人藏匿匕首并追查二楼客房传闻",
    },
    npcC: {
      id: "character-npc-c",
      worldId: CLOSED_INN_WORLD_ID,
      name: "行商·孙掌柜",
      type: "npc",
      alive: true,
      locationId: locations.guestRoom.id,
      identity: "借宿二楼的绸缎商人",
      currentGoal: "在客房避嫌并打探账房偷窃的传闻",
    },
  } satisfies Record<"player" | "npcA" | "npcB" | "npcC", CharacterRecord>;

  const hiddenTruth: FactRecord = {
    id: "fact-hidden-dagger-cellar",
    worldId: CLOSED_INN_WORLD_ID,
    subject: CLOSED_INN_WORLD_ID,
    predicate: "dagger_location",
    object: locations.cellar.id,
    validFrom: CLOSED_INN_INITIAL_TIME,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };

  const plotStage: FactRecord = {
    id: "fact-plot-stage-0",
    worldId: CLOSED_INN_WORLD_ID,
    subject: CLOSED_INN_WORLD_ID,
    predicate: "plot_stage",
    object: "0",
    validFrom: CLOSED_INN_INITIAL_TIME,
    validTo: null,
    sourceEventId: null,
    sourceSeedId: seed.id,
    sourceType: "initial_lore",
  };

  const claims = {
    trueCellar: {
      id: "claim-dagger-in-cellar",
      worldId: CLOSED_INN_WORLD_ID,
      subject: CLOSED_INN_WORLD_ID,
      predicate: "dagger_location",
      object: locations.cellar.id,
      sourceEventId: null,
      sourceSeedId: seed.id,
      recordedAt: CLOSED_INN_INITIAL_TIME,
    },
    falseTheftNpcB: {
      id: "claim-dagger-stolen-by-npcb",
      worldId: CLOSED_INN_WORLD_ID,
      subject: characters.npcB.id,
      predicate: "suspected_thief",
      object: characters.npcB.id,
      sourceEventId: null,
      sourceSeedId: seed.id,
      recordedAt: CLOSED_INN_INITIAL_TIME,
    },
    falseGuestRoom: {
      id: "claim-dagger-in-guestroom",
      worldId: CLOSED_INN_WORLD_ID,
      subject: CLOSED_INN_WORLD_ID,
      predicate: "dagger_location",
      object: locations.guestRoom.id,
      sourceEventId: null,
      sourceSeedId: seed.id,
      recordedAt: CLOSED_INN_INITIAL_TIME,
    },
    plotOngoing: {
      id: "claim-plot-ongoing",
      worldId: CLOSED_INN_WORLD_ID,
      subject: CLOSED_INN_WORLD_ID,
      predicate: "plot_thread",
      object: "dagger_investigation",
      sourceEventId: null,
      sourceSeedId: seed.id,
      recordedAt: CLOSED_INN_INITIAL_TIME,
    },
  } satisfies Record<"trueCellar" | "falseTheftNpcB" | "falseGuestRoom" | "plotOngoing", ClaimRecord>;

  const knowledge: KnowledgeRecord[] = [
    {
      characterId: characters.npcA.id,
      claimId: claims.trueCellar.id,
      knowledgeState: "confirmed",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: CLOSED_INN_INITIAL_TIME,
    },
    {
      characterId: characters.npcB.id,
      claimId: claims.falseGuestRoom.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: CLOSED_INN_INITIAL_TIME,
    },
    {
      characterId: characters.npcC.id,
      claimId: claims.falseTheftNpcB.id,
      knowledgeState: "rumor",
      sourceType: "initial",
      sourceCharacterId: null,
      sourceEventId: null,
      sourceSeedId: seed.id,
      learnedAt: CLOSED_INN_INITIAL_TIME,
    },
  ];

  const relationships = [
    {
      sourceCharacterId: characters.npcB.id,
      targetCharacterId: characters.npcA.id,
      trust: -20,
      hostility: 20,
      closeness: 0,
      relationshipType: "suspicious",
      updatedByEventId: null,
    },
    {
      sourceCharacterId: characters.npcA.id,
      targetCharacterId: characters.npcB.id,
      trust: -10,
      hostility: 10,
      closeness: 0,
      relationshipType: "wary",
      updatedByEventId: null,
    },
  ];
  const locationConnections: LocationConnectionRecord[] = [
    {
      worldId: CLOSED_INN_WORLD_ID,
      fromLocationId: locations.hall.id,
      toLocationId: locations.cellar.id,
    },
    {
      worldId: CLOSED_INN_WORLD_ID,
      fromLocationId: locations.hall.id,
      toLocationId: locations.guestRoom.id,
    },
    {
      worldId: CLOSED_INN_WORLD_ID,
      fromLocationId: locations.cellar.id,
      toLocationId: locations.hall.id,
    },
    {
      worldId: CLOSED_INN_WORLD_ID,
      fromLocationId: locations.guestRoom.id,
      toLocationId: locations.hall.id,
    },
  ];

  store.seedWorld({
    world,
    seed,
    locations: Object.values(locations),
    locationConnections,
    characters: Object.values(characters),
    facts: [hiddenTruth, plotStage],
    claims: Object.values(claims),
    knowledge,
    relationships,
  });

  return { world, seed, locations, characters, hiddenTruth, claims, plotStage };
}
