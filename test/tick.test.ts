import { describe, expect, it } from "vitest";
import { CHAR_KEEPER, CHAR_PLAYER, TIME0, WORLD_ID } from "../app/world/seed.js";
import { worldTick } from "../app/world/tick.js";
import { contextFor } from "../app/visibility/context.js";
import { memoryWorld } from "./helpers.js";

describe("world tick", () => {
  it("advances time and theme without reading the player line", () => {
    const store = memoryWorld();
    const result = worldTick(store);
    expect(result.accepted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.world.time).not.toBe(TIME0);
    expect(snap.world.revision).toBe(2);
    expect(snap.memories.some((row) => row.characterId === CHAR_KEEPER)).toBe(true);

    const player = contextFor(snap, CHAR_PLAYER, result.publicBeat ? [result.publicBeat] : []);
    expect(player.memories).toEqual([]);
    expect(player.time).toBe(snap.world.time);
    expect(player.ambient.join("")).toContain("登记簿");
    expect(player.knownClaims).toEqual([]);
  });
});
