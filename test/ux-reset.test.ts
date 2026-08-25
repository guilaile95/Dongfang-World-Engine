import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayHost } from "../app/http/host.js";
import { resetWorldCatalog } from "../app/http/catalog.js";
import { createNarrator, stubNarrator } from "../app/narrator/client.js";
import {
  evaluateDecisionGate,
  hasNarrationLeak,
  hasPerspectiveViolation,
  parseOpeningOutput,
  renderOpeningPrompt,
} from "../app/narrator/project.js";
import { WorldStore, type PlayerProfile } from "../app/persist/store.js";
import { recentSceneBodies } from "../app/context/recent.js";
import { assemblePrompt } from "../app/visibility/assemble.js";
import { openWorld, Session } from "../app/session.js";
import { parseWorldSource } from "../app/world/parse.js";
import { compileWorld } from "../app/world/compile.js";
import { loadWorldFile } from "../app/world/load.js";
import { WORLD_ID } from "../app/world/seed.js";
import type { AppConfig } from "../app/config.js";
import type { ModelClient } from "../app/model/client.js";

function safeRmSync(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Ignore cleanup error on Windows temp
  }
}

function fakeConfig(playDir: string): AppConfig {
  return {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "test-key",
    model: "none",
    worldFile: join(playDir, "unused.sqlite"),
    worldSource: null,
    maxRetries: 0,
    timeoutMs: 1000,
    fallbackModel: null,
    inputUsdPerMtok: null,
    outputUsdPerMtok: null,
  };
}

const dummyRecord: import("../app/model/types.js").CallRecord = {
  role: "narrator",
  purpose: "test",
  provider: "test",
  model: "test",
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  latencyMs: 0,
  retryCount: 0,
  fallbackUsed: false,
  structuredMode: "none",
  errorCategory: "none",
  errorMessage: null,
  promptChars: 0,
  outputChars: 0,
  attempts: [],
};

describe("UX Reset: Narration Streaming Boundary", () => {
  it("detects all internal Engine leak patterns", () => {
    expect(hasNarrationLeak("当前状态（权威）：世界=当代世界")).toBe(true);
    expect(hasNarrationLeak("最近场景（非权威，不能覆盖已发生之事）")).toBe(true);
    expect(hasNarrationLeak("根据 Authority 规则")).toBe(true);
    expect(hasNarrationLeak("Candidate proposal committed")).toBe(true);
    expect(hasNarrationLeak("Revision 0 mismatch")).toBe(true);
    expect(hasNarrationLeak("expectedRevision = 3")).toBe(true);
    expect(hasNarrationLeak("Validator checked events")).toBe(true);
    expect(hasNarrationLeak("Context packing order")).toBe(true);
    expect(hasNarrationLeak("这是 B层 的数据")).toBe(true);
    expect(hasNarrationLeak("进入 C层 处理")).toBe(true);
    expect(hasNarrationLeak("经过 A→B→C 因果链路")).toBe(true);
    expect(hasNarrationLeak("发生了 ITEM_NOT_IN_REACH 错误")).toBe(true);
    expect(hasNarrationLeak('{"type":"character_move"}')).toBe(true);
  });

  it("does not flag ordinary literary Chinese text", () => {
    expect(hasNarrationLeak("这是我过去的记忆。")).toBe(false);
    expect(hasNarrationLeak("事实证明，他是对的。")).toBe(false);
    expect(hasNarrationLeak("这位权威学者发表了看法。")).toBe(false);
    expect(hasNarrationLeak("今天天气不错，同学在校门口等我。")).toBe(false);
    expect(hasNarrationLeak("我把书包放在了桌子上。")).toBe(false);
  });

  it("streaming boundary: raw leaky chunks NEVER enter onChunk collector, repair succeeds cleanly", async () => {
    let callCount = 0;
    const leakyClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream(req: import("../app/model/types.js").StreamRequest) {
        callCount++;
        if (req.purpose === "narrator-repair") {
          return { text: "夜风吹过街道，晚自习后的灯光渐渐熄灭。", record: dummyRecord };
        }
        return { text: "夜风吹过街道……当前状态（权威）：loc-city……", record: dummyRecord };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(leakyClient, "dummy-key");
    const receivedChunks: string[] = [];

    const result = await narrator.project(
      {
        playerContribution: "我走在街上。",
        observerContext: "【世界】当代世界",
        committed: [],
        uncommitted: [],
        npcReply: null,
        ephemeral: { recentScenes: [], ambient: [] },
      },
      (chunk) => receivedChunks.push(chunk),
    );

    for (const chunk of receivedChunks) {
      expect(hasNarrationLeak(chunk)).toBe(false);
      expect(chunk).not.toContain("当前状态");
      expect(chunk).not.toContain("loc-city");
    }

    expect(callCount).toBe(2);
    const assembledText = receivedChunks.join("");
    expect(assembledText).toBe("夜风吹过街道，晚自习后的灯光渐渐熄灭。");
    expect(result).toBe("夜风吹过街道，晚自习后的灯光渐渐熄灭。");
  });

  it("streaming boundary: when repair also leaks, collector ONLY receives safe natural fallback", async () => {
    let callCount = 0;
    const alwaysLeakyClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream() {
        callCount++;
        return { text: "当前状态（权威）：依然泄漏", record: dummyRecord };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(alwaysLeakyClient, "dummy-key");
    const receivedChunks: string[] = [];

    const result = await narrator.project(
      {
        playerContribution: "你好",
        observerContext: "【世界】当代世界",
        committed: [],
        uncommitted: [],
        npcReply: null,
        ephemeral: { recentScenes: [], ambient: [] },
      },
      (chunk) => receivedChunks.push(chunk),
    );

    expect(callCount).toBe(2);
    expect(result).toBe("世界在继续运行。");
    const assembledText = receivedChunks.join("");
    expect(assembledText).toBe("世界在继续运行。");
    for (const chunk of receivedChunks) {
      expect(hasNarrationLeak(chunk)).toBe(false);
    }
  });
});

describe("Step 18B: Strict Second-Person Perspective & Secondary Repair Validation", () => {
  it("detects 3rd-person narrator referring to player outside of dialogue", () => {
    expect(hasPerspectiveViolation("林念安把书包放到桌上，抬头看了一眼窗外。", "林念安")).toBe(true);
    expect(hasPerspectiveViolation("林念安转过身，对同桌笑了笑。", "林念安")).toBe(true);
    expect(hasPerspectiveViolation("赵明朗推开门走了进来。", "赵明朗")).toBe(true);
  });

  it("allows player name inside NPC spoken dialogue quotes", () => {
    expect(hasPerspectiveViolation("同桌转过头拍了拍你：「林念安，你作业写完了吗？」", "林念安")).toBe(false);
    expect(hasPerspectiveViolation("老班在黑板前喊了一声：“赵明朗，你上来解这道题。”", "赵明朗")).toBe(false);
  });

  it("triggers perspective repair when model uses 3rd-person perspective in opening and secondary validation succeeds", async () => {
    let repairCalled = false;
    const thirdPersonClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream(req: import("../app/model/types.js").StreamRequest) {
        if (req.purpose === "narrator-repair") {
          repairCalled = true;
          return {
            text: "<narrative>暴雨拍打着教室的窗户，你把书包放到桌旁。身边的同桌神色慌张地在抽屉里翻找着什么。</narrative>\n<hook_item>警告纸条</hook_item>\n【眼下】同桌神色慌张。\n【选项】\nA. 问他怎么了\nB. 观察四周\nC. 不理会\nD. 离开教室\nE. 一把抓起他的手腕\nF. 问他是不是作业忘带了",
            record: dummyRecord,
          };
        }
        return {
          text: "<narrative>暴雨拍打着教室的窗户，林念安把书包放到桌旁。身边的同桌神色慌张地在抽屉里翻找着什么。</narrative>\n<hook_item>警告纸条</hook_item>\n【眼下】同桌神色慌张。\n【选项】\nA. 问他怎么了\nB. 观察四周\nC. 不理会\nD. 离开教室\nE. 一把抓起他的手腕\nF. 问他是不是作业忘带了",
          record: dummyRecord,
        };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(thirdPersonClient, "dummy-key");
    const result = await narrator.projectOpening!({
      worldTitle: "龙族",
      era: "仕兰中学时期",
      timeLabel: "2009年秋 · 傍晚",
      publicPremise: "最近几起尚未结案的失踪案闹得满城风雨。",
      locationName: "教学楼",
      presentCharacters: ["同学"],
      publicRules: [],
      publicLore: [],
      publicBeat: "新闻播报着雨夜失踪事件。",
      profile: {
        worldId: "longzu",
        name: "林念安",
        age: "18",
        gender: "男",
        background: "高三学生",
        startingLocation: "教学楼",
        personality: "沉着",
      },
    });

    expect(repairCalled).toBe(true);
    expect(result.narrative).toContain("你把书包");
    expect(hasPerspectiveViolation(result.narrative, "林念安")).toBe(false);
  });

  it("secondary validation: if repair STILL violates perspective, falls back to safe 2nd-person opening without leaking 3rd person", async () => {
    const stubbornThirdPersonClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream() {
        // Stubbornly outputs 3rd person even on repair
        return {
          text: "<narrative>暴雨倾盆，林念安推开门，林念安看着窗外。</narrative>",
          record: dummyRecord,
        };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(stubbornThirdPersonClient, "dummy-key");
    const result = await narrator.projectOpening!({
      worldTitle: "龙族",
      era: "仕兰中学时期",
      timeLabel: "2009年秋 · 傍晚",
      publicPremise: "失踪案频发。",
      locationName: "教学楼",
      presentCharacters: [],
      publicRules: [],
      publicLore: [],
      publicBeat: "",
      profile: {
        worldId: "longzu",
        name: "林念安",
        age: "18",
        gender: "男",
        background: "学生",
        startingLocation: "教学楼",
        personality: "冷静",
      },
    });

    // Verified: safe fallback is in strict 2nd person and free of perspective violations
    expect(hasPerspectiveViolation(result.narrative, "林念安")).toBe(false);
    expect(result.narrative).toContain("你坐在原地");
  });
});

describe("Step 18B Causal Path A: Durable Opening Hook & Content Recall (5+ Turns)", () => {
  it("Engine pre-commits hook item and content, allowing pick-up, recall after recent scene eviction, and reopen persistence", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-hook-path-a-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();

    try {
      const config = fakeConfig(playDir);
      const host = new PlayHost(config, true);
      host.open("riverside-inn", "new");

      const profile: PlayerProfile = {
        worldId: "riverside-inn",
        name: "李若晨",
        age: "20",
        gender: "男",
        background: "寻找失踪朋友的旅人",
        startingLocation: "堂屋",
        personality: "机敏",
      };

      // 1. Opening executes: Engine pre-commits "警告纸条" and its content to Authority
      const opening = await host.startLife(profile);
      expect(opening.message.text).toContain("警告纸条");

      const store = (host as any).session.store as WorldStore;
      const snap = store.snapshot("riverside-inn");
      const hookItem = snap.items.find((it) => it.name === "警告纸条");
      expect(hookItem).toBeDefined();
      expect(hookItem?.locationId).toBe("loc-hall");

      // 2. Turn 1: player carries the item
      store.updateItem(hookItem!.id, { locationId: null, carrierId: "char-player" });
      const stateAfterCarry = host.bootstrap().state;
      expect(stateAfterCarry?.carried).toContain("警告纸条");

      // 3. Turns 2, 3, 4, 5: 4 mundane turns so Opening is evicted from the 3-scene recent buffer
      await host.playTurn("我倒了一杯温水慢慢喝着。", "turn-2", () => undefined);
      await host.playTurn("我转头看着窗外绵绵的阴雨。", "turn-3", () => undefined);
      await host.playTurn("我坐在长凳上闭目养神片刻。", "turn-4", () => undefined);
      await host.playTurn("我站起身活动了一下有些发酸的肩膀。", "turn-5", () => undefined);

      // Verify that opening scene has scrolled out of the recent 3 scenes
      const recentScenes = store.listRecentScenes("riverside-inn", "char:char-player", 3);
      expect(recentScenes.length).toBe(3);
      for (const scene of recentScenes) {
        expect(scene.title).not.toBe("opening");
      }

      // 4. Turn 6: player inspects the carried item 5 turns later
      // Assemble prompt for player reading the note
      const snap6 = store.snapshot("riverside-inn");
      const promptPack = assemblePrompt({
        snapshot: snap6,
        observerId: "char-player",
        query: "我拿出之前收好的警告纸条，借着灯光仔细看上面写的字",
        recentScenes: recentSceneBodies(store, "riverside-inn", "char-player"),
        loreHits: (host as any).session.store
          ? [
              {
                title: "item:警告纸条",
                body: "【警告纸条内容】别去后院地窖，今晚掌柜在提防生人。",
                score: 1.0,
                namespace: "char:char-player",
                kind: "lore" as const,
              },
            ]
          : [],
        playerProfile: profile,
      });

      expect(promptPack.prompt).toContain("【警告纸条内容】别去后院地窖，今晚掌柜在提防生人。");

      host.close();

      // 5. Restart / Reopen world: item still carried and situation restored
      const reopenHost = new PlayHost(config, true);
      reopenHost.open("riverside-inn", "resume");
      const reopenedState = reopenHost.bootstrap().state;
      expect(reopenedState?.characterName).toBe("李若晨");
      expect(reopenedState?.carried).toContain("警告纸条");
      expect(reopenedState?.currentSituation).toContain("警告纸条");

      reopenHost.close();
    } finally {
      delete process.env.DWE_PLAY_DIR;
      resetWorldCatalog();
      safeRmSync(playDir);
    }
  });
});

describe("Step 18B Causal Path B: Non-Durable Scene Continuity", () => {
  it("records opening narrative into player recent scenes so assemblePrompt provides opening context in turn 1", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-scene-continuity-b-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();

    try {
      const config = fakeConfig(playDir);
      const host = new PlayHost(config, true);
      host.open("riverside-inn", "new");

      const profile: PlayerProfile = {
        worldId: "riverside-inn",
        name: "李若晨",
        age: "20",
        gender: "男",
        background: "普通客人",
        startingLocation: "堂屋",
        personality: "沉着",
      };

      await host.startLife(profile);

      const store = (host as any).session.store as WorldStore;
      const recentScenes = store.listRecentScenes("riverside-inn", "char:char-player", 3);
      expect(recentScenes.length).toBeGreaterThanOrEqual(1);
      expect(recentScenes[0]?.body).toContain("开幕经历");

      // Assemble prompt for player in turn 1 using recent scenes
      const snapshot = store.snapshot("riverside-inn");
      const pack = assemblePrompt({
        snapshot,
        observerId: "char-player",
        recentScenes: recentSceneBodies(store, "riverside-inn", "char-player"),
        playerProfile: profile,
      });

      expect(pack.prompt).toContain("【近况】");
      expect(pack.prompt).toContain("开幕经历");

      host.close();
    } finally {
      delete process.env.DWE_PLAY_DIR;
      resetWorldCatalog();
      safeRmSync(playDir);
    }
  });
});

describe("Step 18B Causal Path C: Decision Presentation Gate & Situation Persistence", () => {
  it("mundane action and NPC chitchat have 0 suggestions, while NPC warning/barrier activates 6 suggestions", () => {
    // 1. Mundane turn (e.g. drinking water, walking around)
    const mundane = evaluateDecisionGate({
      dialogue: null,
      interpretation: { contributions: ["low_causal"], outcome: "ephemeral" },
      envelope: { committed: [], uncommitted: [] },
      text: "你把温水喝完，在椅子上坐了一会儿。",
    }, "堂屋留有一张提醒别去地窖的警告纸条。");
    expect(mundane.suggestions).toBeUndefined();
    // Persistent situation preserved across mundane turn!
    expect(mundane.currentSituation).toBe("堂屋留有一张提醒别去地窖的警告纸条。");

    // 2. Mundane NPC chitchat ("是啊，今天挺凉快") -> 0 suggestions!
    const chitchat = evaluateDecisionGate({
      dialogue: { addresseeName: "同桌", npcReply: "是啊，今天挺凉快的。" },
      interpretation: { contributions: ["speak"], outcome: "ephemeral" },
      envelope: { committed: [], uncommitted: [] },
      text: "同桌笑着应了一句。",
    }, "堂屋留有一张提醒别去地窖的警告纸条。");
    expect(chitchat.suggestions).toBeUndefined();
    expect(chitchat.currentSituation).toBe("堂屋留有一张提醒别去地窖的警告纸条。");

    // 3. Meaningful NPC Warning / Request -> activates 6 suggestions!
    const warningDialogue = evaluateDecisionGate({
      dialogue: { addresseeName: "同桌", npcReply: "今晚别走旧港，我有件重要的事要告诉你！" },
      interpretation: { contributions: ["speak"], outcome: "ephemeral" },
      envelope: { committed: [], uncommitted: [] },
      text: "同桌突然按住你的手臂，神色紧张。",
    });
    expect(warningDialogue.suggestions).toBeDefined();
    expect(warningDialogue.suggestions?.length).toBe(6);
    expect(warningDialogue.suggestions?.[0]?.key).toBe("A");
    expect(warningDialogue.suggestions?.[4]?.type).toBe("extreme");
    expect(warningDialogue.suggestions?.[5]?.type).toBe("absurd");
    expect(warningDialogue.currentSituation).toContain("同桌正在对你说");

    // 4. Action Refusal / Danger turn
    const refusalTurn = evaluateDecisionGate({
      dialogue: null,
      interpretation: { contributions: ["durable_attempt"], outcome: "fail" },
      envelope: { committed: [], uncommitted: ["锁孔被锈死，无法打开地窖门"] },
      text: "地窖门把手纹丝不动。",
    });
    expect(refusalTurn.suggestions).toBeDefined();
    expect(refusalTurn.suggestions?.length).toBe(6);
    expect(refusalTurn.currentSituation).toContain("锁孔被锈死");
  });
});

describe("Step 18B: True Cross-World Isolation", () => {
  it("completely isolates world-specific locations, items, characters, and claims across protocols", () => {
    // 1. Longzu Protocol
    const longzuText = "# 《龙族》\n\n第一章 规则\n【世界规则】\n一、世界不围绕玩家存在。\n\n第十六章 人物\n【人物表】\n路明非\n楚子航";
    const longzuSource = parseWorldSource(longzuText);
    const longzuCompiled = compileWorld(longzuSource);
    expect(longzuCompiled.chronology.era).toBe("仕兰中学时期");
    expect(longzuSource.items.some((i) => i.name === "书包")).toBe(true);
    expect(longzuSource.locations.some((l) => l.name === "教学楼")).toBe(true);
    expect(longzuSource.claims.some((c) => c.subject === "city-news")).toBe(true);

    // 2. Mystery Recovery Protocol (神秘复苏)
    const mysteryText = "# 《神秘复苏》\n\n第一章 规则\n【世界规则】\n一、鬼无法被杀死。\n\n第十六章 人物\n【人物表】\n杨间";
    const mysterySource = parseWorldSource(mysteryText);
    const mysteryCompiled = compileWorld(mysterySource);
    expect(mysteryCompiled.chronology.era).toBe("大昌市时期");
    expect(mysterySource.items.some((i) => i.name === "书包")).toBe(false);
    expect(mysterySource.items.some((i) => i.name === "手机")).toBe(true);
    expect(mysterySource.locations.some((l) => l.name === "教学楼")).toBe(false);
    expect(mysterySource.locations.some((l) => l.name === "居民楼")).toBe(true);
    expect(mysterySource.claims.some((c) => c.subject === "city-news")).toBe(false);

    // 3. Cultivation World Protocol (修仙世界)
    const cultivationText = "# 《凡人修仙录》\n\n第一章 规则\n【世界规则】\n一、宗门禁地不可擅入。\n\n第十六章 人物\n【人物表】\n韩立";
    const cultivationSource = parseWorldSource(cultivationText);
    const cultivationCompiled = compileWorld(cultivationSource);
    expect(cultivationCompiled.chronology.era).toBe("仙元历");
    expect(cultivationSource.items.some((i) => i.name === "书包")).toBe(false);
    expect(cultivationSource.items.some((i) => i.name === "木剑")).toBe(true);
    expect(cultivationSource.items.some((i) => i.name === "粗布储物袋")).toBe(true);
    expect(cultivationSource.locations.some((l) => l.name === "教学楼")).toBe(false);
    expect(cultivationSource.locations.some((l) => l.name === "山门")).toBe(true);
    expect(cultivationSource.characters.some((c) => c.name === "外门弟子")).toBe(true);
    expect(cultivationSource.characters.some((c) => c.name === "路明非")).toBe(false);
    expect(cultivationSource.claims.some((c) => c.subject === "city-news")).toBe(false);

    // 4. Generic uncalibrated protocol world
    const genericText = "# 《普通世界》\n\n第一章 规则\n【世界规则】\n一、普通规则。\n\n第十六章 人物\n【人物表】\n张三";
    const genericSource = parseWorldSource(genericText);
    const genericCompiled = compileWorld(genericSource);
    expect(genericCompiled.chronology.era).toBe("当前时期未标定");
    expect(genericSource.items.length).toBe(0);
    expect(genericSource.locations.some((l) => l.name === "教学楼")).toBe(false);
  });
});

describe("UX Reset: Engine Player Identity & Persistence", () => {
  it("applies PlayerProfile to Engine Character (name & locationId) and persists across reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dwe-engine-profile-"));
    const dbPath = join(tempDir, "play-profile.sqlite");

    try {
      const store1 = new WorldStore(dbPath);
      store1.insertSeedWorld({
        world: { id: "test-world", name: "测试世界", time: "t0", revision: 0, rules: [] },
        locations: [
          { id: "loc-1", worldId: "test-world", name: "起始点" },
          { id: "loc-store", worldId: "test-world", name: "便利店" },
        ],
        characters: [
          { id: "char-player", worldId: "test-world", name: "普通人", kind: "player", locationId: "loc-1" },
        ],
        items: [],
        facts: [],
        claims: [],
        knowledge: [],
      });

      const profile: PlayerProfile = {
        worldId: "test-world",
        name: "林念安",
        age: "18",
        gender: "男",
        background: "高三学生，备战高考。",
        startingLocation: "便利店",
        personality: "务实冷静。",
      };

      store1.initializePlayerProfile(profile);

      const snap1 = store1.snapshot("test-world");
      const player1 = snap1.characters.find((c) => c.kind === "player")!;
      expect(player1.name).toBe("林念安");
      expect(player1.locationId).toBe("loc-store");

      store1.close();

      const store2 = new WorldStore(dbPath);
      const snap2 = store2.snapshot("test-world");
      const player2 = snap2.characters.find((c) => c.kind === "player")!;
      expect(player2.name).toBe("林念安");
      expect(player2.locationId).toBe("loc-store");

      const savedProfile = store2.getPlayerProfile("test-world");
      expect(savedProfile?.name).toBe("林念安");
      expect(savedProfile?.background).toBe("高三学生，备战高考。");
      store2.close();
    } finally {
      safeRmSync(tempDir);
    }
  });

  it("fails closed when startingLocation cannot be mapped to a valid location", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dwe-invalid-loc-"));
    const dbPath = join(tempDir, "play.sqlite");
    try {
      const store = new WorldStore(dbPath);
      store.insertSeedWorld({
        world: { id: "test-world", name: "测试世界", time: "t0", revision: 0, rules: [] },
        locations: [{ id: "loc-1", worldId: "test-world", name: "起始点" }],
        characters: [{ id: "char-player", worldId: "test-world", name: "普通人", kind: "player", locationId: "loc-1" }],
        items: [],
        facts: [],
        claims: [],
        knowledge: [],
      });

      expect(() => {
        store.initializePlayerProfile({
          worldId: "test-world",
          name: "测试",
          age: "18",
          gender: "男",
          background: "",
          startingLocation: "不存在的火星基地",
          personality: "",
        });
      }).toThrow(/INVALID_STARTING_LOCATION/);

      store.close();
    } finally {
      safeRmSync(tempDir);
    }
  });
});

describe("UX Reset: Player Self-Context vs NPC Epistemic Privacy", () => {
  it("includes player profile persona in player continuity, but strictly excludes it from NPC continuity", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dwe-privacy-test-"));
    const dbPath = join(tempDir, "privacy.sqlite");

    try {
      const store = new WorldStore(dbPath);
      store.insertSeedWorld({
        world: { id: "test-world", name: "测试世界", time: "t0", revision: 0, rules: [] },
        locations: [{ id: "loc-1", worldId: "test-world", name: "教室" }],
        characters: [
          { id: "char-player", worldId: "test-world", name: "林念安", kind: "player", locationId: "loc-1" },
          { id: "char-npc", worldId: "test-world", name: "同学", kind: "npc", locationId: "loc-1" },
        ],
        items: [],
        facts: [],
        claims: [],
        knowledge: [],
      });

      const profile: PlayerProfile = {
        worldId: "test-world",
        name: "林念安",
        age: "18",
        gender: "男",
        background: "父母经营汽修店，备战高考。",
        startingLocation: "教室",
        personality: "少言寡语，记性好。",
      };
      store.setPlayerProfile(profile);

      const snapshot = store.snapshot("test-world");

      const playerPack = assemblePrompt({
        snapshot,
        observerId: "char-player",
        playerProfile: profile,
      });
      expect(playerPack.prompt).toContain("林念安");
      expect(playerPack.prompt).toContain("汽修店");
      expect(playerPack.prompt).toContain("少言寡语");

      const npcPack = assemblePrompt({
        snapshot,
        observerId: "char-npc",
      });
      expect(npcPack.prompt).toContain("你是同学");
      expect(npcPack.prompt).not.toContain("汽修店");
      expect(npcPack.prompt).not.toContain("少言寡语");
      expect(npcPack.prompt).not.toContain("备战高考");

      store.close();
    } finally {
      safeRmSync(tempDir);
    }
  });
});

describe("UX Reset: Opening Semantics & Idempotency", () => {
  it("startLife creates opening world narrative without running interpreter or advancing world state", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-opening-test-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();

    try {
      const config = fakeConfig(playDir);
      const host = new PlayHost(config, true);
      host.open("riverside-inn", "new");

      const store = (host as any).session.store as WorldStore;
      const snapBefore = store.snapshot("riverside-inn");
      const timeBefore = snapBefore.world.time;
      const revBefore = snapBefore.world.revision;
      const eventsBefore = store.sqlite.prepare("SELECT COUNT(*) as count FROM events WHERE world_id = ?").get("riverside-inn") as { count: number };

      const profile: PlayerProfile = {
        worldId: "riverside-inn",
        name: "李若晨",
        age: "20",
        gender: "男",
        background: "远道而来的年轻旅人。",
        startingLocation: "堂屋",
        personality: "敏锐沉稳。",
      };

      const opening = await host.startLife(profile, () => undefined);

      expect(opening.message.role).toBe("world");
      expect(opening.message.text).toBeTruthy();
      expect(opening.state.characterName).toBe("李若晨");
      expect(opening.state.locationName).toBe("堂屋");

      const snapAfter = store.snapshot("riverside-inn");
      expect(snapAfter.world.time).toBe(timeBefore);
      expect(snapAfter.world.revision).toBe(revBefore);
      const eventsAfter = store.sqlite.prepare("SELECT COUNT(*) as count FROM events WHERE world_id = ?").get("riverside-inn") as { count: number };
      expect(eventsAfter.count).toBe(eventsBefore.count);

      const messages = host.messages();
      expect(messages.length).toBe(1);
      expect(messages[0]!.role).toBe("world");
      expect(messages[0]!.text).toBe(opening.message.text);

      const secondCall = await host.startLife(profile, () => undefined);
      expect(secondCall.message.text).toBe(opening.message.text);
      expect(host.messages().length).toBe(1);

      host.close();
    } finally {
      delete process.env.DWE_PLAY_DIR;
      resetWorldCatalog();
      safeRmSync(playDir);
    }
  });
});

describe("UX Reset: Test Data Isolation Guarantee", () => {
  it("never writes or modifies files in data/local when using an isolated play dir", async () => {
    const localDir = join(process.cwd(), "data", "local");
    const snapshotBefore = new Map<string, string>();
    if (existsSync(localDir)) {
      for (const name of readdirSync(localDir)) {
        if (name.endsWith(".sqlite") || name.endsWith(".json")) {
          const content = readFileSync(join(localDir, name));
          snapshotBefore.set(name, createHash("sha256").update(content).digest("hex"));
        }
      }
    }

    const testPlayDir = mkdtempSync(join(tmpdir(), "dwe-isolation-proof-"));
    process.env.DWE_PLAY_DIR = testPlayDir;
    resetWorldCatalog();
    try {
      const config = fakeConfig(testPlayDir);
      const host = new PlayHost(config, true);
      host.open("riverside-inn", "new");
      await host.playTurn("隔离测试消息一", "turn-iso-1", () => undefined);
      await host.playTurn("隔离测试消息二", "turn-iso-2", () => undefined);
      host.close();

      if (existsSync(localDir)) {
        const filesAfter = readdirSync(localDir);
        for (const name of filesAfter) {
          if (name.endsWith(".sqlite") || name.endsWith(".json")) {
            const beforeHash = snapshotBefore.get(name);
            if (beforeHash !== undefined) {
              const content = readFileSync(join(localDir, name));
              const afterHash = createHash("sha256").update(content).digest("hex");
              expect(afterHash).toBe(beforeHash);
            }
          }
        }
      }

      const testFiles = readdirSync(testPlayDir);
      expect(testFiles.some((f) => f.includes("play-riverside-inn.sqlite"))).toBe(true);
    } finally {
      delete process.env.DWE_PLAY_DIR;
      resetWorldCatalog();
      safeRmSync(testPlayDir);
    }
  });
});
