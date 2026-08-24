import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemblePrompt } from "../app/visibility/assemble.js";
import { recall } from "../app/context/recall.js";
import { rebuildObserverArtifacts, writeSummary } from "../app/context/artifacts.js";
import { loadWorldFile, seedCompiled } from "../app/world/load.js";
import { visibilityGate } from "../app/visibility/gate.js";
import { WorldStore } from "../app/persist/store.js";

const CANDIDATES = [
  process.env.DWE_WORLD_SOURCE,
  "C:\\Users\\DINOL\\Downloads\\龙族V1.0.txt",
].filter((path): path is string => Boolean(path && existsSync(path)));

describe.skipIf(CANDIDATES.length === 0)("real world source", () => {
  it("loads 龙族 materials and keeps ordinary-player visibility", () => {
    const path = CANDIDATES[0];
    if (!path) {
      return;
    }
    const compiled = loadWorldFile(path);
    expect(compiled.sourceKind).toBe("protocol");
    expect(compiled.packageTitle).toMatch(/龙族/);
    expect(compiled.seed.world.name).toBe("当代世界");
    expect(compiled.seed.characters.some((row) => row.kind === "player")).toBe(true);
    expect(compiled.seed.facts.some((row) => row.id === "fact-dragons-exist")).toBe(true);

    const store = new WorldStore(":memory:");
    seedCompiled(store, compiled);
    const snap = store.snapshot(compiled.seed.world.id);
    const player = visibilityGate(snap, compiled.playerId);
    const packed = JSON.stringify(player);
    expect(packed).not.toContain("黑王");
    expect(packed).not.toContain("白王");
    expect(packed).not.toContain("尼伯龙根");
    expect(packed).not.toContain("fact-dragons-exist");
    expect(packed).not.toContain("mixed-blood-academy");
    expect(player.knownClaims.some((row) => row.claim.id === "claim-dragons-exist")).toBe(false);

    const hybrid = visibilityGate(snap, "char-hybrid");
    expect(hybrid.knownClaims.some((row) => row.claim.id === "claim-dragons-exist")).toBe(true);
    expect(JSON.stringify(hybrid.knownClaims)).not.toEqual(JSON.stringify(player.knownClaims));

    const school = recall(store, compiled.seed.world.id, compiled.playerId, "普通生活");
    expect(school.some((hit) => hit.body.includes("普通生活"))).toBe(true);
    expect(JSON.stringify(school)).not.toContain("黑王");

    const forbidden = recall(store, compiled.seed.world.id, compiled.playerId, "黑王 卡塞尔学院");
    const playerPrompt = assemblePrompt({
      snapshot: snap,
      observerId: compiled.playerId,
      query: "黑王现在在哪？",
      loreHits: forbidden.map((hit) => ({
        title: hit.title,
        body: hit.body,
        score: hit.score,
        namespace: hit.namespace,
        kind: hit.kind,
      })),
    }).prompt;
    expect(playerPrompt).not.toContain("黑王");
    expect(playerPrompt).not.toContain("尼伯龙根");

    const hybridLore = recall(store, compiled.seed.world.id, "char-hybrid", "卡塞尔");
    expect(hybridLore.some((hit) => hit.body.includes("卡塞尔"))).toBe(true);

    const factsBefore = store.snapshot(compiled.seed.world.id).facts;
    writeSummary(store, compiled.seed.world.id, compiled.playerId, "wrong", "龙已经灭绝，卡塞尔从未存在。");
    expect(store.snapshot(compiled.seed.world.id).facts).toEqual(factsBefore);
    rebuildObserverArtifacts(store, compiled.seed.world.id, compiled.playerId);
    expect(store.snapshot(compiled.seed.world.id).facts).toEqual(factsBefore);
    const summaries = store.listContextItems(compiled.seed.world.id, [`char:${compiled.playerId}`], "summary");
    expect(summaries.some((row) => row.body.includes("龙已经灭绝"))).toBe(false);
    store.close();
  });
});
