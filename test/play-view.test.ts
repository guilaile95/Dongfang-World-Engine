import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resetWorldCatalog, worldCatalog } from "../app/http/catalog.js";
import { PlayHost } from "../app/http/host.js";
import { playerState } from "../app/http/view.js";
import { stubNarrator } from "../app/narrator/client.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld, UNPARSED_HINT } from "../app/session.js";
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
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    host.open("riverside-inn", "new");
    const first = await host.playTurn("我先吃饭。", "turn-1", () => undefined);
    const rev1 = JSON.stringify(host.state());
    const second = await host.playTurn("我先吃饭。", "turn-1", () => undefined);
    expect(second.text).toBe(first.text);
    expect(JSON.stringify(host.state())).toBe(rev1);
    host.close();
  });

  it("bootstrap worlds do not include save paths", () => {
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    const boot = host.bootstrap();
    const packed = JSON.stringify(boot);
    expect(packed).not.toContain("savePath");
    expect(packed).not.toContain("sourcePath");
    expect(packed).not.toContain("claim-");
    expect(packed).not.toContain("expectedRevision");
    host.close();
  });

  it("can switch to a new inn save", () => {
    process.env.DWE_PLAY_DIR = playDir;
    resetWorldCatalog();
    const host = new PlayHost(fakeConfig(), true);
    const a = host.open("riverside-inn", "new");
    expect(a.locationName).toBe("堂屋");
    const b = host.open("riverside-inn", "new");
    expect(b.locationName).toBe("堂屋");
    expect(host.messages()).toEqual([]);
    host.close();
  });
});

describe("fail-closed notice is player-facing", () => {
  it("uses the public hint and no stack", async () => {
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
    expect(turn.text).toBe(UNPARSED_HINT);
    expect(turn.text).not.toMatch(/Zod|stack|expectedRevision|claim-/);
    session.close();
  });
});
