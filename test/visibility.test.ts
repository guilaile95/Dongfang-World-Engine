import { describe, expect, it } from "vitest";
import { contextFor, packObserverContext } from "../app/visibility/context.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CHAR_PLAYER,
  CLAIM_BAG,
  CLAIM_GUEST_FLED,
  FACT_BAG,
  LOC_CELLAR,
  WORLD_ID,
} from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("visibility", () => {
  it("does not put objective facts or other people's knowledge into an observer pack", () => {
    const store = memoryWorld();
    const snap = store.snapshot(WORLD_ID);
    const player = contextFor(snap, CHAR_PLAYER);
    const packed = packObserverContext(player);

    expect(player.knownClaims.some((row) => row.claim.id === CLAIM_BAG)).toBe(false);
    expect(player.knownClaims.some((row) => row.claim.id === CLAIM_GUEST_FLED)).toBe(false);
    expect(packed).not.toContain(FACT_BAG);
    expect(packed).not.toContain("guest-li-bag");
    expect(packed).not.toContain(LOC_CELLAR);
    expect(JSON.stringify(player)).not.toContain(FACT_BAG);

    const keeper = contextFor(snap, CHAR_KEEPER);
    expect(keeper.knownClaims.some((row) => row.claim.id === CLAIM_BAG && row.state === "confirmed")).toBe(true);
    expect(keeper.knownClaims.some((row) => row.claim.id === CLAIM_GUEST_FLED)).toBe(false);

    const cook = contextFor(snap, CHAR_COOK);
    expect(cook.knownClaims.some((row) => row.claim.id === CLAIM_GUEST_FLED && row.state === "rumor")).toBe(true);
    expect(cook.knownClaims.some((row) => row.claim.id === CLAIM_BAG)).toBe(false);
    expect(packObserverContext(cook)).not.toContain("guest-li-bag");
  });

  it("keeps player memories from granting claim knowledge", () => {
    const store = memoryWorld();
    const snap = store.snapshot(WORLD_ID);
    const player = contextFor(snap, CHAR_PLAYER, ["掌柜在柜台翻着登记簿，像还在等一个没回来的客人。"]);
    expect(player.ambient.length).toBe(1);
    expect(player.knownClaims).toEqual([]);
    expect(packObserverContext(player)).not.toContain("guest-li-bag");
  });
});
