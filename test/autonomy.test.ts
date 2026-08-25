import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_BUDGET,
  EXPERIMENT_1_AUTONOMY,
  NPC_ALWAYS_ON_INTERVAL_MS,
  backgroundWorldEvolutionEnabled,
  enableBackgroundEvolutionBecause,
  planTurnAutonomy,
} from "../app/world/autonomy.js";
import { compileWorld } from "../app/world/compile.js";
import { seedCompiled } from "../app/world/load.js";
import { parseWorldSource } from "../app/world/parse.js";
import { WorldStore } from "../app/persist/store.js";
import { CHAR_COOK, CHAR_KEEPER, CHAR_PLAYER, SYNTHETIC, WORLD_ID } from "../app/world/seed.js";
import { worldTick } from "../app/world/tick.js";
import { memoryWorld } from "./helpers.js";

const TINY = readFileSync(new URL("./fixtures/tiny-protocol.txt", import.meta.url), "utf8");

describe("world autonomy policy", () => {
  it("does not treat experiment-1, idle wall-clock, or WorldX/AI Town copies as a trigger", () => {
    expect(NPC_ALWAYS_ON_INTERVAL_MS).toBeNull();
    expect(EXPERIMENT_1_AUTONOMY.worldStopsWithoutPlayer).toBe(false);
    expect(backgroundWorldEvolutionEnabled(EXPERIMENT_1_AUTONOMY)).toBe(false);
    expect(enableBackgroundEvolutionBecause({ idleWallClock: true })).toBe(false);
    expect(enableBackgroundEvolutionBecause({ copyWorldXScheduler: true })).toBe(false);
    expect(enableBackgroundEvolutionBecause({ copyAiTownScheduler: true })).toBe(false);
    expect(
      enableBackgroundEvolutionBecause({
        evidence: {
          protocol: "later-real-play",
          worldStopsWithoutPlayer: true,
          provenBy: "step-real-play",
        },
      }),
    ).toBe(true);
  });

  it("keeps the current scene high, ordinary off-screen NPCs dormant, and uses a deterministic shortcut", () => {
    const store = memoryWorld();
    const plan = planTurnAutonomy(store.snapshot(WORLD_ID), SYNTHETIC);
    expect(plan.byCharacter[CHAR_PLAYER]).toBe("high");
    expect(plan.byCharacter[CHAR_KEEPER]).toBe("high");
    expect(plan.byCharacter[CHAR_COOK]).toBe("dormant");
    expect(plan.llmCalls).toBe(0);
    expect(plan.shortcut).toBe("deterministic");
    expect(plan.themeMemory?.characterId).toBe(CHAR_KEEPER);
    expect(plan.publicBeat).toContain("登记簿");
    store.close();
  });

  it("does not evolve a distant theme NPC until the gate opens, and damps identical memories", () => {
    const compiled = compileWorld(parseWorldSource(TINY));
    const store = new WorldStore(":memory:");
    seedCompiled(store, compiled);
    const worldId = compiled.seed.world.id;
    const first = planTurnAutonomy(store.snapshot(worldId), compiled);
    expect(first.byCharacter[compiled.playerId]).toBe("high");
    expect(first.byCharacter["char-hybrid"]).toBe("medium");
    expect(first.byCharacter["char-roommate"]).toBe("high");
    expect(first.themeMemory).toBeNull();
    expect(first.llmCalls).toBe(0);
    expect(first.deferred.some((row) => row.characterId === "char-hybrid" && row.reason === "gate")).toBe(
      true,
    );
    expect(first.macroLocations).toContain("loc-cassel");
    expect(first.dormantCount).toBeGreaterThan(0);

    const tick1 = worldTick(store, compiled);
    expect(tick1.accepted).toBe(true);
    expect(tick1.llmCalls).toBe(0);
    expect(store.snapshot(worldId).memories.filter((row) => row.characterId === "char-hybrid")).toEqual([]);

    const opened = planTurnAutonomy(store.snapshot(worldId), compiled, DEFAULT_AUTONOMY_BUDGET, {
      protocol: "later-real-play",
      worldStopsWithoutPlayer: true,
      provenBy: "step-real-play",
    });
    expect(opened.themeMemory?.characterId).toBe("char-hybrid");
    expect(opened.llmCalls).toBe(0);

    worldTick(store, compiled, {
      evidence: {
        protocol: "later-real-play",
        worldStopsWithoutPlayer: true,
        provenBy: "step-real-play",
      },
    });
    const afterWrite = store.snapshot(worldId).memories.filter((row) => row.characterId === "char-hybrid");
    expect(afterWrite).toHaveLength(1);

    const damped = planTurnAutonomy(store.snapshot(worldId), compiled, DEFAULT_AUTONOMY_BUDGET, {
      protocol: "later-real-play",
      worldStopsWithoutPlayer: true,
      provenBy: "step-real-play",
    });
    expect(damped.themeMemory).toBeNull();
    expect(damped.deferred.some((row) => row.reason === "damping")).toBe(true);
    store.close();
  });

  it("lowers resolution under budget instead of calling a model, and damps the inn theme after one note", () => {
    const store = memoryWorld();
    const squeezed = planTurnAutonomy(store.snapshot(WORLD_ID), SYNTHETIC, {
      ...DEFAULT_AUTONOMY_BUDGET,
      maxHighCharacters: 0,
    });
    expect(squeezed.byCharacter[CHAR_KEEPER]).toBe("dormant");
    expect(squeezed.themeMemory).toBeNull();
    expect(squeezed.llmCalls).toBe(0);

    const first = worldTick(store);
    expect(first.llmCalls).toBe(0);
    const memories1 = store.snapshot(WORLD_ID).memories.filter((row) => row.characterId === CHAR_KEEPER);
    expect(memories1).toHaveLength(1);

    const second = worldTick(store);
    expect(second.accepted).toBe(true);
    expect(second.llmCalls).toBe(0);
    const memories2 = store.snapshot(WORLD_ID).memories.filter((row) => row.characterId === CHAR_KEEPER);
    expect(memories2).toHaveLength(1);
    store.close();
  });
});
