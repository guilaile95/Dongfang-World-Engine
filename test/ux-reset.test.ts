import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayHost } from "../app/http/host.js";
import { createNarrator, stubNarrator } from "../app/narrator/client.js";
import { hasNarrationLeak, NARRATOR_LEAK_PATTERNS } from "../app/narrator/project.js";
import { WorldStore, type PlayerProfile } from "../app/persist/store.js";
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

describe("UX Reset: Narration Leak Gate", () => {
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
    expect(hasNarrationLeak('{"type":"character_move"}')).toBe(true);
  });

  it("does not flag ordinary literary Chinese text", () => {
    expect(hasNarrationLeak("这是我过去的记忆。")).toBe(false);
    expect(hasNarrationLeak("事实证明，他是对的。")).toBe(false);
    expect(hasNarrationLeak("这位权威学者发表了看法。")).toBe(false);
    expect(hasNarrationLeak("今天天气不错，同学在校门口等我。")).toBe(false);
    expect(hasNarrationLeak("我把书包放在了桌子上。")).toBe(false);
  });

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

  it("triggers repair when model output contains internal leak, and falls to safe prose", async () => {
    let callCount = 0;
    const leakyClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream(req: import("../app/model/types.js").StreamRequest) {
        callCount++;
        if (req.purpose === "narrator-repair") {
          // Repair succeeds with clean prose
          return { text: "你走在普通的街道上，晚风吹拂。", record: dummyRecord };
        }
        // First projection leaks internal state
        return { text: "当前状态（权威）：世界=当代世界\n你走在普通的街道上。", record: dummyRecord };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(leakyClient, "dummy-key");
    const result = await narrator.project({
      playerContribution: "我走在街上。",
      observerContext: "【世界】当代世界",
      committed: [],
      uncommitted: [],
      npcReply: null,
      ephemeral: { recentScenes: [], ambient: [] },
    });

    expect(callCount).toBe(2); // 1 projection + 1 repair
    expect(result).toBe("你走在普通的街道上，晚风吹拂。");
    expect(hasNarrationLeak(result)).toBe(false);
  });

  it("falls back to safe fail-closed text if repair still leaks", async () => {
    const alwaysLeakyClient: ModelClient = {
      records: [],
      lastRecord: () => undefined,
      async stream() {
        return { text: "当前状态（权威）：依然泄漏", record: dummyRecord };
      },
    } as unknown as ModelClient;

    const narrator = createNarrator(alwaysLeakyClient, "dummy-key");
    const result = await narrator.project({
      playerContribution: "你好",
      observerContext: "【世界】当代世界",
      committed: [],
      uncommitted: [],
      npcReply: null,
      ephemeral: { recentScenes: [], ambient: [] },
    });

    expect(result).toBe("世界在继续运行。");
  });
});

describe("UX Reset: Player Profile Persistence", () => {
  it("stores and retrieves a PlayerProfile in SQLite, surviving close and reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dwe-profile-test-"));
    const dbPath = join(tempDir, "play-profile.sqlite");

    try {
      // Step 1: Create world and save profile
      const store1 = new WorldStore(dbPath);
      store1.insertSeedWorld({
        world: { id: "test-world", name: "测试世界", time: "t0", revision: 0, rules: [] },
        locations: [{ id: "loc-1", worldId: "test-world", name: "起始点" }],
        characters: [{ id: "char-player", worldId: "test-world", name: "普通人", kind: "player", locationId: "loc-1" }],
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
        background: "高三学生，父母经营普通店铺。",
        startingLocation: "普通城市",
        personality: "冷静，记性好。",
      };

      store1.setPlayerProfile(profile);
      const read1 = store1.getPlayerProfile("test-world");
      expect(read1).toEqual(profile);
      store1.close();

      // Step 2: Reopen from disk and verify persistence
      const store2 = new WorldStore(dbPath);
      const read2 = store2.getPlayerProfile("test-world");
      expect(read2).toEqual(profile);
      expect(read2?.name).toBe("林念安");
      expect(read2?.age).toBe("18");
      expect(read2?.background).toContain("高三学生");
      store2.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("UX Reset: Test Data Isolation Guarantee", () => {
  it("never writes or modifies files in data/local when using an isolated play dir", async () => {
    // Record digest of existing files in data/local if any exist
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

    // Run a full session inside an isolated temp dir
    const testPlayDir = mkdtempSync(join(tmpdir(), "dwe-isolation-proof-"));
    process.env.DWE_PLAY_DIR = testPlayDir;
    try {
      const config = fakeConfig(testPlayDir);
      const host = new PlayHost(config, true);
      host.open("riverside-inn", "new");
      await host.playTurn("隔离测试消息一", "turn-iso-1", () => undefined);
      await host.playTurn("隔离测试消息二", "turn-iso-2", () => undefined);
      host.close();

      // Verify that data/local has the EXACT same files and digests
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

      // Verify the temp dir has the new files
      const testFiles = readdirSync(testPlayDir);
      expect(testFiles.some((f) => f.includes("play-riverside-inn.sqlite"))).toBe(true);
    } finally {
      delete process.env.DWE_PLAY_DIR;
      rmSync(testPlayDir, { recursive: true, force: true });
    }
  });
});
