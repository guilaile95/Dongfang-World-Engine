import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayHost } from "../app/http/host.js";
import { resetWorldCatalog } from "../app/http/catalog.js";
import { createNarrator, stubNarrator } from "../app/narrator/client.js";
import { hasNarrationLeak } from "../app/narrator/project.js";
import { WorldStore, type PlayerProfile } from "../app/persist/store.js";
import { assemblePrompt } from "../app/visibility/assemble.js";
import { openWorld } from "../app/session.js";
import { WORLD_ID } from "../app/world/seed.js";
import type { AppConfig } from "../app/config.js";
import type { ModelClient } from "../app/model/client.js";

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
          // Repair succeeds with clean prose
          return { text: "夜风吹过街道，晚自习后的灯光渐渐熄灭。", record: dummyRecord };
        }
        // First projection leaks internal state
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

    // 1. Raw leaky chunks never entered collector
    for (const chunk of receivedChunks) {
      expect(hasNarrationLeak(chunk)).toBe(false);
      expect(chunk).not.toContain("当前状态");
      expect(chunk).not.toContain("loc-city");
    }

    // 2. Repair called at most once
    expect(callCount).toBe(2); // 1 projection + 1 repair

    // 3. Collector received the clean repaired prose
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

    expect(callCount).toBe(2); // 1 projection + 1 repair attempt
    expect(result).toBe("世界在继续运行。");
    const assembledText = receivedChunks.join("");
    expect(assembledText).toBe("世界在继续运行。");
    for (const chunk of receivedChunks) {
      expect(hasNarrationLeak(chunk)).toBe(false);
    }
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

      // Verify immediate snapshot
      const snap1 = store1.snapshot("test-world");
      const player1 = snap1.characters.find((c) => c.kind === "player")!;
      expect(player1.name).toBe("林念安");
      expect(player1.locationId).toBe("loc-store");

      store1.close();

      // Verify reopen from SQLite
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
      rmSync(tempDir, { recursive: true, force: true });
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
      rmSync(tempDir, { recursive: true, force: true });
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

      // Player continuity pack
      const playerPack = assemblePrompt({
        snapshot,
        observerId: "char-player",
        playerProfile: profile,
      });
      expect(playerPack.prompt).toContain("林念安");
      expect(playerPack.prompt).toContain("汽修店");
      expect(playerPack.prompt).toContain("少言寡语");

      // NPC continuity pack (MUST NOT have player's private profile)
      const npcPack = assemblePrompt({
        snapshot,
        observerId: "char-npc",
        // No player profile passed to NPC!
      });
      expect(npcPack.prompt).toContain("你是同学");
      expect(npcPack.prompt).not.toContain("汽修店");
      expect(npcPack.prompt).not.toContain("少言寡语");
      expect(npcPack.prompt).not.toContain("备战高考");

      store.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
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

      // Verify opening result
      expect(opening.message.role).toBe("world");
      expect(opening.message.text).toBeTruthy();
      expect(opening.state.characterName).toBe("李若晨");
      expect(opening.state.locationName).toBe("堂屋");

      // Verify no interpreter / worldTick / event advancement occurred
      const snapAfter = store.snapshot("riverside-inn");
      expect(snapAfter.world.time).toBe(timeBefore);
      expect(snapAfter.world.revision).toBe(revBefore);
      const eventsAfter = store.sqlite.prepare("SELECT COUNT(*) as count FROM events WHERE world_id = ?").get("riverside-inn") as { count: number };
      expect(eventsAfter.count).toBe(eventsBefore.count);

      // Verify UI message history contains only 1 world message (no synthetic player message!)
      const messages = host.messages();
      expect(messages.length).toBe(1);
      expect(messages[0]!.role).toBe("world");
      expect(messages[0]!.text).toBe(opening.message.text);

      // Verify idempotency: calling startLife again returns the existing opening without re-generating
      const secondCall = await host.startLife(profile, () => undefined);
      expect(secondCall.message.text).toBe(opening.message.text);
      expect(host.messages().length).toBe(1);

      host.close();
    } finally {
      delete process.env.DWE_PLAY_DIR;
      resetWorldCatalog();
      rmSync(playDir, { recursive: true, force: true });
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
      rmSync(testPlayDir, { recursive: true, force: true });
    }
  });
});
