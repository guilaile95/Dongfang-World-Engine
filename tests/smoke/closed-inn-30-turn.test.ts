import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLOSED_INN_30_ACTOR_SEQUENCE,
  CLOSED_INN_30_STEPS,
  CLOSED_INN_NPC_INTENT,
  CLOSED_INN_PLAYER_INTENT,
  buildClosedInn30Steps,
} from "../../src/smoke/closed-inn-30-turn.js";
import { isDirectExecution } from "../../src/smoke/closed-inn-harness.js";

describe("Closed Inn 30-turn Entrypoint Configuration", () => {
  it("builds exactly 30 turns with strict round-robin actor sequence and observer-safe intents", () => {
    const steps = buildClosedInn30Steps();
    expect(steps).toHaveLength(30);
    expect(CLOSED_INN_30_STEPS).toHaveLength(30);

    for (let i = 0; i < 30; i += 1) {
      const step = steps[i]!;
      const expectedActor = CLOSED_INN_30_ACTOR_SEQUENCE[i % CLOSED_INN_30_ACTOR_SEQUENCE.length];
      expect(step.actorId).toBe(expectedActor);

      if (step.actorId === "character-player") {
        expect(step.intent).toBe(CLOSED_INN_PLAYER_INTENT);
        expect(step.intent).toBe("根据当前合法可见的信息观察、询问、调查、判断并决定下一步行动。");
      } else {
        expect(step.intent).toBe(CLOSED_INN_NPC_INTENT);
        expect(step.intent).toBe("根据你当前合法可见的信息和自己的目标，自主决定下一步行动。");
      }
    }

    // Verify actor counts
    const playerSteps = steps.filter((s) => s.actorId === "character-player");
    const npcaSteps = steps.filter((s) => s.actorId === "character-npc-a");
    const npcbSteps = steps.filter((s) => s.actorId === "character-npc-b");
    const npccSteps = steps.filter((s) => s.actorId === "character-npc-c");

    expect(playerSteps).toHaveLength(8);
    expect(npcaSteps).toHaveLength(8);
    expect(npcbSteps).toHaveLength(7);
    expect(npccSteps).toHaveLength(7);
  });

  it("determines direct execution for 30-turn module with complex path", () => {
    const complexPath = resolve("E:/AI Projects/东方狂想/dist/smoke/closed-inn-30-turn.js");
    const moduleUrl = pathToFileURL(complexPath).href;

    expect(isDirectExecution(moduleUrl, complexPath)).toBe(true);
    expect(isDirectExecution(moduleUrl, resolve("E:/AI Projects/东方狂想/dist/smoke/other.js"))).toBe(false);
  });
});
