import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
    store.close();
  });
});
