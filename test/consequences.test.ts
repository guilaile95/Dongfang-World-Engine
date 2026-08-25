import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { submitCandidates, submitLlmProposal } from "../app/authority/commit.js";
import { rebuildWorld } from "../app/authority/restore.js";
import { stubNarrator } from "../app/narrator/client.js";
import { WorldStore } from "../app/persist/store.js";
import { applyInterpretation } from "../app/scene/interpretation.js";
import { INTERPRETER_SYSTEM, fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import { visibilityGate } from "../app/visibility/gate.js";
import { compileWorld } from "../app/world/compile.js";
import { seedCompiled } from "../app/world/load.js";
import { parseWorldSource } from "../app/world/parse.js";
import { resolveLocationId } from "../app/world/resolve.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CHAR_PLAYER,
  ITEM_BAG,
  ITEM_KEY,
  LOC_HALL,
  LOC_KITCHEN,
  TIME0,
  WORLD_ID,
  seedInput,
} from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

const TINY = readFileSync(new URL("./fixtures/tiny-protocol.txt", import.meta.url), "utf8");

function protocolWorld(): { store: WorldStore; worldId: string; playerId: string } {
  const compiled = compileWorld(parseWorldSource(TINY));
  const store = new WorldStore(":memory:");
  seedCompiled(store, compiled);
  return { store, worldId: compiled.seed.world.id, playerId: compiled.playerId };
}

describe("location and item consequences", () => {
  it("states mixed move/item/diary contracts in the interpreter prompt", () => {
    expect(INTERPRETER_SYSTEM).toContain("character_move");
    expect(INTERPRETER_SYSTEM).toContain("item_place");
    expect(INTERPRETER_SYSTEM).toContain("item_carry");
    expect(INTERPRETER_SYSTEM).toContain("必须同时给出");
    expect(INTERPRETER_SYSTEM).toContain("写日记");
  });

  it("resolves ordinary destinations without guessing an unknown place", () => {
    const { store, worldId } = protocolWorld();
    const snap = store.snapshot(worldId);
    expect(resolveLocationId(snap, "我回家了。")).toBe("loc-home");
    expect(resolveLocationId(snap, "我走进食堂。")).toBe("loc-cafeteria");
    expect(resolveLocationId(snap, "我离开宿舍，去教学楼。")).toBe("loc-teaching");
    expect(resolveLocationId(snap, "我回到刚才那家便利店。")).toBe("loc-store");
    expect(resolveLocationId(snap, "校园食堂")).toBe("loc-cafeteria");
    expect(resolveLocationId(snap, "一个从没听说过的地方")).toBeNull();
    store.close();
  });

  it("commits player location from natural-language move and updates visibility", () => {
    const store = memoryWorld();
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "厨房" }],
      },
    });
    expect(applied.submitted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(LOC_KITCHEN);
    const player = visibilityGate(snap, CHAR_PLAYER);
    const cook = visibilityGate(snap, CHAR_COOK);
    const keeper = visibilityGate(snap, CHAR_KEEPER);
    expect(player.location.id).toBe(LOC_KITCHEN);
    expect(cook.present.some((row) => row.id === CHAR_PLAYER)).toBe(true);
    expect(keeper.present.some((row) => row.id === CHAR_PLAYER)).toBe(false);
    expect(player.visibleItems.some((row) => row.id === ITEM_BAG && row.carriedBy === CHAR_PLAYER)).toBe(true);
    expect(cook.visibleItems.some((row) => row.id === ITEM_BAG)).toBe(true);
    expect(keeper.visibleItems.some((row) => row.id === ITEM_BAG)).toBe(false);
    store.close();
  });

  it("does not write a location when the destination cannot be determined", () => {
    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID);
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "月球背面的秘密基地" }],
      },
    });
    expect(applied.submitted).toBe(false);
    expect(applied.outcome).toBe("clarify");
    expect(store.snapshot(WORLD_ID).characters).toEqual(before.characters);
    expect(store.listEvents(WORLD_ID)).toEqual([]);
    store.close();
  });

  it("lets the player put down and pick up a bag, and keeps carried items with the player", () => {
    const store = memoryWorld();
    const drop = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_place", item: "书包", location: "桌上" }],
      },
    });
    expect(drop.submitted).toBe(true);
    const afterDrop = store.snapshot(WORLD_ID).items.find((row) => row.id === ITEM_BAG);
    expect(afterDrop?.carrierId).toBeNull();
    expect(afterDrop?.locationId).toBe(LOC_HALL);

    const pick = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_carry", item: "书包" }],
      },
    });
    expect(pick.submitted).toBe(true);
    expect(store.snapshot(WORLD_ID).items.find((row) => row.id === ITEM_BAG)?.carrierId).toBe(CHAR_PLAYER);

    applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "厨房" }],
      },
    });
    const moved = store.snapshot(WORLD_ID);
    expect(moved.characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(LOC_KITCHEN);
    expect(moved.items.find((row) => row.id === ITEM_BAG)?.carrierId).toBe(CHAR_PLAYER);
    expect(visibilityGate(moved, CHAR_COOK).visibleItems.some((row) => row.id === ITEM_BAG)).toBe(true);
    expect(visibilityGate(moved, CHAR_KEEPER).visibleItems.some((row) => row.id === ITEM_BAG)).toBe(false);
    store.close();
  });

  it("commits location and item state together from one mixed interpretation", () => {
    const store = memoryWorld();
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["mixed"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [
          { type: "character_move", location: "厨房" },
          { type: "item_place", item: "书包", location: "桌上" },
        ],
      },
    });
    expect(applied.submitted).toBe(true);
    expect(applied.result.events.map((event) => event.type)).toEqual(["character_move", "item_place"]);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(LOC_KITCHEN);
    const bag = snap.items.find((row) => row.id === ITEM_BAG);
    expect(bag?.carrierId).toBeNull();
    expect(bag?.locationId).toBe(LOC_KITCHEN);
    store.close();
  });

  it("does not commit a mixed action when one destination cannot be resolved", () => {
    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID);
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["mixed"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [
          { type: "character_move", location: "厨房" },
          { type: "item_place", item: "不存在的神器", location: "桌上" },
        ],
      },
    });
    expect(applied.submitted).toBe(false);
    expect(store.snapshot(WORLD_ID).characters).toEqual(before.characters);
    expect(store.snapshot(WORLD_ID).items).toEqual(before.items);
    store.close();
  });

  it("writes a diary line into the player's Memory, not Fact or another character", () => {
    const store = memoryWorld();
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      addresseeId: CHAR_KEEPER,
      interpretation: {
        contributions: ["durable_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "memory_note", text: "把刚才听到的失踪传闻写进日记。" }],
      },
    });
    expect(applied.submitted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.memories.some((row) => row.characterId === CHAR_PLAYER && row.text.includes("失踪传闻"))).toBe(true);
    expect(snap.memories.some((row) => row.characterId === CHAR_KEEPER)).toBe(false);
    expect(snap.facts.some((row) => row.object.includes("失踪"))).toBe(false);
    expect(snap.knowledge.some((row) => row.characterId === CHAR_PLAYER)).toBe(false);
    store.close();
  });

  it("rejects LLM moving an NPC or taking an item that is not in reach", () => {
    const store = memoryWorld();
    const npcMove = submitLlmProposal(store, WORLD_ID, {
      type: "character_move",
      worldId: WORLD_ID,
      expectedRevision: 0,
      characterId: CHAR_COOK,
      locationId: LOC_HALL,
    });
    expect(npcMove.accepted).toBe(false);
    expect(npcMove.reasons).toContain("LLM_CANNOT_MOVE_NPC");

    const far = submitLlmProposal(store, WORLD_ID, {
      type: "item_carry",
      worldId: WORLD_ID,
      expectedRevision: 0,
      itemId: ITEM_KEY,
      characterId: CHAR_PLAYER,
    });
    expect(far.accepted).toBe(true);

    applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_place", item: "钥匙", location: "堂屋" }],
      },
    });
    applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "厨房" }],
      },
    });
    const unreachable = submitLlmProposal(store, WORLD_ID, {
      type: "item_carry",
      worldId: WORLD_ID,
      expectedRevision: store.snapshot(WORLD_ID).world.revision,
      itemId: ITEM_KEY,
      characterId: CHAR_PLAYER,
    });
    expect(unreachable.accepted).toBe(false);
    expect(unreachable.reasons).toContain("ITEM_NOT_IN_REACH");
    store.close();
  });

  it("rebuilds move and item state from seed plus events after close/reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "dwe-conseq-"));
    const file = join(dir, "world.sqlite");
    try {
      const live = new WorldStore(file);
      live.insertSeedWorld(seedInput());
      const moved = submitCandidates(live, {
        producer: "llm",
        candidates: [
          {
            type: "character_move",
            worldId: WORLD_ID,
            expectedRevision: 0,
            characterId: CHAR_PLAYER,
            locationId: LOC_KITCHEN,
          },
          {
            type: "item_place",
            worldId: WORLD_ID,
            expectedRevision: 1,
            itemId: ITEM_BAG,
            locationId: LOC_KITCHEN,
          },
        ],
      });
      expect(moved.accepted).toBe(true);
      const snap = live.snapshot(WORLD_ID);
      const events = live.listEvents(WORLD_ID);
      live.close();

      const reopened = new WorldStore(file);
      expect(reopened.snapshot(WORLD_ID).characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(LOC_KITCHEN);
      expect(reopened.snapshot(WORLD_ID).items.find((row) => row.id === ITEM_BAG)?.locationId).toBe(LOC_KITCHEN);
      reopened.close();

      const rebuilt = rebuildWorld(seedInput(), events);
      expect(rebuilt.snapshot(WORLD_ID)).toEqual(snap);
      rebuilt.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let the narrator envelope treat empty committed as a finished move", async () => {
    const session = openWorld(
      ":memory:",
      stubNarrator(),
      undefined,
      fixedInterpreter({
        contributions: ["low_causal"],
        futureCausal: false,
        outcome: "ephemeral",
        proposals: [],
      }),
    );
    const loc0 = session.store.snapshot(WORLD_ID).characters.find((row) => row.id === CHAR_PLAYER)?.locationId;
    const turn = await session.playTurn("同学当场死了。");
    expect(turn.envelope.committed).toEqual([]);
    expect(turn.interpretation.submitted).toBe(false);
    expect(session.store.snapshot(WORLD_ID).characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(loc0);
    expect(session.store.snapshot(WORLD_ID).characters.find((row) => row.id === CHAR_KEEPER)).toBeTruthy();
    session.close();
  });

  it("keeps protocol home/cafeteria/bag/key available as real world state", () => {
    const { store, worldId, playerId } = protocolWorld();
    const snap = store.snapshot(worldId);
    expect(snap.locations.map((row) => row.id)).toEqual(expect.arrayContaining([
      "loc-home",
      "loc-dorm",
      "loc-cafeteria",
      "loc-teaching",
      "loc-store",
    ]));
    expect(snap.items.find((row) => row.id === "item-bag")?.carrierId).toBe(playerId);
    expect(snap.items.find((row) => row.id === "item-key")?.locationId).toBe("loc-dorm");
    const home = applyInterpretation(store, {
      worldId,
      playerId,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "家" }],
      },
    });
    expect(home.submitted).toBe(true);
    expect(store.snapshot(worldId).characters.find((row) => row.id === playerId)?.locationId).toBe("loc-home");
    store.close();
  });
});
