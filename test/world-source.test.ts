import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileWorld } from "../app/world/compile.js";
import { parseWorldSource } from "../app/world/parse.js";
import { seedCompiled } from "../app/world/load.js";
import { visibilityGate } from "../app/visibility/gate.js";
import { WorldStore } from "../app/persist/store.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CHAR_PLAYER,
  CLAIM_BAG,
  FACT_BAG,
  WORLD_ID,
} from "../app/world/seed.js";

const INN = readFileSync(new URL("../app/world/fixtures/riverside-inn.md", import.meta.url), "utf8");
const TINY = readFileSync(new URL("./fixtures/tiny-protocol.txt", import.meta.url), "utf8");

describe("world source", () => {
  it("parses the synthetic inn fixture used by unit tests", () => {
    const source = parseWorldSource(INN);
    expect(source.sourceKind).toBe("structured");
    expect(source.id).toBe(WORLD_ID);
    const compiled = compileWorld(source);
    expect(compiled.playerId).toBe(CHAR_PLAYER);
    expect(compiled.seed.characters.map((row) => row.id)).toEqual([CHAR_PLAYER, CHAR_KEEPER, CHAR_COOK]);
    expect(compiled.seed.knowledge.some((row) => row.characterId === CHAR_KEEPER && row.claimId === CLAIM_BAG)).toBe(
      true,
    );
  });

  it("parses a tiny protocol document without loading a real novel pack", () => {
    const source = parseWorldSource(TINY);
    expect(source.sourceKind).toBe("protocol");
    expect(source.publicName).toBe("当代世界");
    expect(source.rules.some((row) => row.text.includes("世界不围绕玩家"))).toBe(true);
    expect(source.locations.some((row) => row.id === "loc-cassel" && row.visibility === "hidden")).toBe(true);
    expect(source.locations.map((row) => row.id)).toEqual(expect.arrayContaining([
      "loc-home",
      "loc-dorm",
      "loc-cafeteria",
      "loc-teaching",
      "loc-store",
    ]));
    expect(source.items.some((row) => row.id === "item-bag" && row.carrierId === "char-player")).toBe(true);
    expect(source.items.some((row) => row.id === "item-key" && row.locationId === "loc-dorm")).toBe(true);
    expect(source.characters.some((row) => row.kind === "player")).toBe(true);
    expect(source.characters.some((row) => row.name === "路明非")).toBe(true);
    expect(source.facts.some((row) => row.id === "fact-dragons-exist" && row.visibility === "hidden")).toBe(true);

    const compiled = compileWorld(source);
    const store = new WorldStore(":memory:");
    seedCompiled(store, compiled);
    const snap = store.snapshot(compiled.seed.world.id);
    const player = visibilityGate(snap, compiled.playerId);
    const hybrid = visibilityGate(snap, "char-hybrid");
    const packedPlayer = JSON.stringify(player);
    expect(packedPlayer).not.toContain("fact-dragons-exist");
    expect(packedPlayer).not.toContain("mixed-blood-academy");
    expect(player.knownClaims.some((row) => row.claim.id === "claim-dragons-exist")).toBe(false);
    expect(hybrid.knownClaims.some((row) => row.claim.id === "claim-dragons-exist")).toBe(true);
    expect(player.location.name).toBe("普通城市");
    expect(hybrid.location.name).toBe("卡塞尔学院");
    store.close();
  });

  it("does not put the inn cellar secret into the player pool after compiling the fixture", () => {
    const compiled = compileWorld(parseWorldSource(INN));
    const store = new WorldStore(":memory:");
    seedCompiled(store, compiled);
    const player = visibilityGate(store.snapshot(WORLD_ID), CHAR_PLAYER);
    expect(JSON.stringify(player)).not.toContain(FACT_BAG);
    expect(player.knownClaims.some((row) => row.claim.id === CLAIM_BAG)).toBe(false);
    store.close();
  });
});
