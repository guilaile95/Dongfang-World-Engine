import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rebuildObserverArtifacts, wipeContextArtifacts, writeSummary } from "../app/context/artifacts.js";
import { ingestMaterials } from "../app/context/ingest.js";
import { recall } from "../app/context/recall.js";
import { WorldStore } from "../app/persist/store.js";
import { compileWorld } from "../app/world/compile.js";
import { seedCompiled } from "../app/world/load.js";
import { parseWorldSource } from "../app/world/parse.js";
import { CHAR_KEEPER, CHAR_PLAYER, FACT_BAG, WORLD_ID } from "../app/world/seed.js";

const TINY = readFileSync(new URL("./fixtures/tiny-protocol.txt", import.meta.url), "utf8");
const INN = readFileSync(new URL("../app/world/fixtures/riverside-inn.md", import.meta.url), "utf8");

function seeded(sourceText: string): { store: WorldStore; worldId: string; playerId: string } {
  const source = parseWorldSource(sourceText);
  const compiled = compileWorld(source);
  compiled.materials = ingestMaterials(source, sourceText);
  const store = new WorldStore(":memory:");
  seedCompiled(store, compiled);
  return { store, worldId: compiled.seed.world.id, playerId: compiled.playerId };
}

describe("context recall", () => {
  it("recalls public protocol materials for the current topic without leaking hidden lore to the ordinary player", () => {
    const { store, worldId, playerId } = seeded(TINY);
    const playerHits = recall(store, worldId, playerId, "普通生活");
    expect(playerHits.some((hit) => hit.body.includes("普通生活"))).toBe(true);
    expect(playerHits.every((hit) => hit.namespace === "public" || hit.namespace === `char:${playerId}`)).toBe(true);
    expect(JSON.stringify(playerHits)).not.toContain("mixed-blood-academy");
    expect(JSON.stringify(playerHits)).not.toContain("卡塞尔学院");

    const casselAsPlayer = recall(store, worldId, playerId, "卡塞尔学院");
    expect(JSON.stringify(casselAsPlayer)).not.toContain("卡塞尔学院");

    const hybridHits = recall(store, worldId, "char-hybrid", "卡塞尔");
    expect(hybridHits.some((hit) => hit.body.includes("卡塞尔"))).toBe(true);
    store.close();
  });

  it("does not let a wrong summary overwrite authority facts, and rebuild drops the artifact", () => {
    const { store, worldId, playerId } = seeded(INN);
    const before = store.snapshot(worldId);
    writeSummary(store, worldId, playerId, "wrong", "客栈已烧毁，guest-li-bag 不在地窖。");
    expect(store.snapshot(worldId).facts).toEqual(before.facts);
    expect(store.snapshot(worldId).facts.some((row) => row.id === FACT_BAG)).toBe(true);

    const playRecall = recall(store, worldId, playerId, "客栈");
    expect(playRecall.every((hit) => hit.kind === "lore")).toBe(true);
    expect(playRecall.some((hit) => hit.body.includes("客栈已烧毁"))).toBe(false);

    const polluted = recall(store, worldId, playerId, "客栈", { kinds: ["summary"] });
    expect(polluted.some((hit) => hit.kind === "summary" && hit.body.includes("客栈已烧毁"))).toBe(true);

    rebuildObserverArtifacts(store, worldId, playerId);
    const after = store.snapshot(worldId);
    expect(after.facts).toEqual(before.facts);
    expect(after.claims).toEqual(before.claims);
    expect(after.knowledge).toEqual(before.knowledge);
    const rebuilt = store.listContextItems(worldId, [`char:${playerId}`], "summary");
    expect(rebuilt.some((row) => row.body.includes("客栈已烧毁"))).toBe(false);
    expect(rebuilt.some((row) => row.title === "rebuilt")).toBe(true);
    store.close();
  });

  it("can wipe context artifacts without touching world truth or events", () => {
    const { store, worldId, playerId } = seeded(INN);
    writeSummary(store, worldId, playerId, "tmp", "noise");
    const before = store.snapshot(worldId);
    const events = store.listEvents(worldId);
    wipeContextArtifacts(store, worldId);
    expect(store.snapshot(worldId)).toEqual(before);
    expect(store.listEvents(worldId)).toEqual(events);
    expect(store.listContextItems(worldId, ["public", `char:${playerId}`, `char:${CHAR_KEEPER}`])).toEqual([]);
    store.close();
  });
});
