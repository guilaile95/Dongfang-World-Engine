import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resetWorldCatalog, worldCatalog } from "../app/http/catalog.js";
import { PlayHost } from "../app/http/host.js";
import { playerState } from "../app/http/view.js";
import { stubNarrator } from "../app/narrator/client.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import type { AppConfig } from "../app/config.js";
import { CHAR_PLAYER, WORLD_ID } from "../app/world/seed.js";

function fakeConfig(worldSource: string | null = null): AppConfig {
  return {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "test-key",
    model: "none",
    worldFile: join(tmpdir(), "unused.sqlite"),
    worldSource,
    maxRetries: 0,
    timeoutMs: 1000,
    fallbackModel: null,
    inputUsdPerMtok: null,
    outputUsdPerMtok: null,
  };
}

describe("player-safe play view", () => {
  const playDir = mkdtempSync(join(tmpdir(), "dwe-playdir-"));

  it("exposes only names a player would know", () => {
    const session = openWorld(":memory:", stubNarrator());
    const state = playerState(session);
    const packed = JSON.stringify(state);
    expect(state.worldTitle).toBe("临河客栈");
    expect(state.characterName).toBe("旅人");
    expect(state.locationName).toBe("堂屋");
    expect(state.carried).toContain("书包");
    expect(state.nearby).toContain("掌柜老周");
    expect(packed).not.toContain("fact-");
    expect(packed).not.toContain("claim-");
    expect(packed).not.toContain("expectedRevision");
    expect(packed).not.toContain("char-player");
    expect(packed).not.toContain("loc-hall");
    expect(packed).not.toContain("revision");
    expect(packed).not.toContain(CHAR_PLAYER);
    expect(packed).not.toContain(WORLD_ID);
    session.close();
  });

  it("lists the inn fixture without leaking engine paths as required fields", () => {
    resetWorldCatalog();
    const worlds = worldCatalog(fakeConfig());
    expect(worlds.some((row) => row.title === "临河客栈")).toBe(true);
    expect(JSON.stringify(worlds)).not.toContain("fact_assert");
  });

  it("replays the same turnId without a second authority write", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-turnid-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    try {
      host.open("riverside-inn", "new");
      const first = await host.playTurn("我先吃饭。", "turn-1", () => undefined);
      const rev1 = JSON.stringify(host.state());
      const second = await host.playTurn("我先吃饭。", "turn-1", () => undefined);
      expect(second.text).toBe(first.text);
      expect(JSON.stringify(host.state())).toBe(rev1);
    } finally {
      host.close();
    }
  });

  it("Case E: API privacy - bootstrap worlds do not include save paths and expose hasSave", () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-case-e-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    try {
      const boot = host.bootstrap();
      const packed = JSON.stringify(boot);
      expect(packed).not.toContain("savePath");
      expect(packed).not.toContain("sourcePath");
      expect(packed).not.toContain("backupPath");
      expect(packed).not.toContain("claim-");
      expect(packed).not.toContain("fact-");
      expect(packed).not.toContain("expectedRevision");
      expect(packed).not.toContain("Candidate");
      expect(packed).not.toContain("Validator");
      expect(boot.worlds.length).toBeGreaterThan(0);
      expect(typeof boot.worlds[0]?.hasSave).toBe("boolean");
    } finally {
      host.close();
    }
  });

  it("Case A: existing save -> new creates a verified backup preserving old state, and starts clean new world", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-case-a-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    try {
      const a = host.open("riverside-inn", "new");
      expect(a.locationName).toBe("堂屋");
      await host.playTurn("我在堂屋放下行李。", "turn-save-a1", () => undefined);
      expect(host.messages().length).toBeGreaterThan(0);
      const oldMessagesCount = host.messages().length;

      const b = host.open("riverside-inn", "new");
      expect(b.locationName).toBe("堂屋");
      expect(host.messages()).toEqual([]);

      const { readdirSync } = await import("node:fs");
      const { WorldStore } = await import("../app/persist/store.js");
      const files = readdirSync(playDir);
      const backups = files.filter((name) => name.startsWith("play-riverside-inn.backup-") && name.endsWith(".sqlite"));
      expect(backups.length).toBe(1);

      const latestBackup = join(playDir, backups[0]!);
      const backupStore = new WorldStore(latestBackup);
      try {
        const backupMessages = backupStore.listUiMessages("riverside-inn");
        expect(backupMessages.length).toBe(oldMessagesCount);
        expect(backupMessages.some((m) => m.text === "我在堂屋放下行李。")).toBe(true);
      } finally {
        backupStore.close();
      }
    } finally {
      host.close();
    }
  });

  it("Case B: consecutive new calls generate unique backup names and do not overwrite previous backups", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-case-b-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    try {
      host.open("riverside-inn", "new");
      await host.playTurn("第一轮对话。", "turn-save-b1", () => undefined);

      host.open("riverside-inn", "new");
      await host.playTurn("第二轮对话。", "turn-save-b2", () => undefined);

      host.open("riverside-inn", "new");

      const { readdirSync } = await import("node:fs");
      const files = readdirSync(playDir);
      const backups = files.filter((name) => name.startsWith("play-riverside-inn.backup-") && name.endsWith(".sqlite"));
      expect(backups.length).toBe(2);

      const uniqueNames = new Set(backups);
      expect(uniqueNames.size).toBe(backups.length);
    } finally {
      host.close();
    }
  });

  it("Case C: backup failure fails closed without modifying active save", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-case-c-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    const savePath = worldCatalog(fakeConfig()).find((w) => w.id === "riverside-inn")!.savePath;
    let digestBefore = "";
    try {
      host.open("riverside-inn", "new");
      await host.playTurn("关键记忆：绝不能丢。", "turn-save-c1", () => undefined);
      const { readFileSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      digestBefore = createHash("sha256").update(readFileSync(savePath)).digest("hex");
    } finally {
      host.close();
    }

    const failingHost = new PlayHost(fakeConfig(), true, () => {
      throw new Error("DISK_IO_SIMULATED_FAILURE");
    });
    try {
      expect(() => failingHost.open("riverside-inn", "new")).toThrow(/BACKUP_FAILED/);
    } finally {
      failingHost.close();
    }

    const { readFileSync, existsSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    expect(existsSync(savePath)).toBe(true);
    const digestAfter = createHash("sha256").update(readFileSync(savePath)).digest("hex");
    expect(digestAfter).toBe(digestBefore);

    const recoverHost = new PlayHost(fakeConfig(), true);
    try {
      recoverHost.open("riverside-inn", "resume");
      expect(recoverHost.messages().some((m) => m.text === "关键记忆：绝不能丢。")).toBe(true);
    } finally {
      recoverHost.close();
    }
  });

  it("Case D: resume opens existing save without creating backup or changing state", async () => {
    const playDir = mkdtempSync(join(tmpdir(), "dwe-play-case-d-"));
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    const savePath = worldCatalog(fakeConfig()).find((w) => w.id === "riverside-inn")!.savePath;
    let digestBefore = "";
    let backupsBefore = 0;
    try {
      host.open("riverside-inn", "new");
      await host.playTurn("继续游戏测试。", "turn-save-d1", () => undefined);
      const { readFileSync, readdirSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      digestBefore = createHash("sha256").update(readFileSync(savePath)).digest("hex");
      backupsBefore = readdirSync(playDir).filter((n) => n.includes(".backup-")).length;
    } finally {
      host.close();
    }

    const resumeHost = new PlayHost(fakeConfig(), true);
    try {
      resumeHost.open("riverside-inn", "resume");

      const { readFileSync, readdirSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      const backupsAfter = readdirSync(playDir).filter((n) => n.includes(".backup-")).length;
      expect(backupsAfter).toBe(backupsBefore);

      const digestAfter = createHash("sha256").update(readFileSync(savePath)).digest("hex");
      expect(digestAfter).toBe(digestBefore);
      expect(resumeHost.messages().some((m) => m.text === "继续游戏测试。")).toBe(true);
    } finally {
      resumeHost.close();
    }
  });
});

describe("parse failure stays in the public conversation lane", () => {
  it("does not expose parser internals or persist an untrusted result", async () => {
    const session = openWorld(
      ":memory:",
      stubNarrator(),
      undefined,
      fixedInterpreter(
        {
          contributions: ["uncertain_attempt"],
          futureCausal: false,
          outcome: "fail",
          proposals: [],
        },
        false,
      ),
    );
    const turn = await session.playTurn("%%%NOT_A_SCENE%%% [[[");
    expect(turn.parsed).toBe(false);
    expect(turn.text).toBe("%%%NOT_A_SCENE%%% [[[");
    expect(turn.text).not.toMatch(/Zod|stack|expectedRevision|claim-/);
    session.close();
  });
});
