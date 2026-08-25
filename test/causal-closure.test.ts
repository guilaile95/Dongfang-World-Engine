import { describe, expect, it } from "vitest";
import { stubNpcVoice } from "../app/chat/npc.js";
import { stubNarrator } from "../app/narrator/client.js";
import { uncommittedProjection } from "../app/narrator/envelope.js";
import { NARRATOR_SYSTEM, renderNarratorPrompt } from "../app/narrator/project.js";
import { applyInterpretation, withObviousMove, withSpokenMemory } from "../app/scene/interpretation.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import { visibilityGate } from "../app/visibility/gate.js";
import { dampPublicBeat } from "../app/world/autonomy.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CHAR_PLAYER,
  ITEM_BAG,
  LOC_HALL,
  LOC_KITCHEN,
  WORLD_ID,
} from "../app/world/seed.js";

describe("post-step17 causal closure", () => {
  it("does not let an origin NPC speak after a committed move", async () => {
    const session = openWorld(
      ":memory:",
      stubNarrator(),
      undefined,
      {
        async interpret(request) {
          if (request.playerLine.includes("厨房")) {
            return {
              parsed: true,
              interpretation: {
                contributions: ["world_attempt"],
                futureCausal: true,
                outcome: "candidate",
                proposals: [{ type: "character_move", location: "厨房" }],
              },
            };
          }
          return {
            parsed: true,
            interpretation: {
              contributions: ["speak"],
              futureCausal: false,
              outcome: "ephemeral",
              proposals: [],
            },
          };
        },
      },
      stubNpcVoice(),
    );
    const hello = await session.playTurn("掌柜，汤好了吗？");
    expect(hello.dialogue?.addresseeId).toBe(CHAR_KEEPER);

    const moved = await session.playTurn("我走进厨房。");
    expect(moved.interpretation.submitted).toBe(true);
    expect(session.store.snapshot(WORLD_ID).characters.find((row) => row.id === CHAR_PLAYER)?.locationId).toBe(
      LOC_KITCHEN,
    );
    expect(moved.dialogue).toBeNull();
    const snap = session.store.snapshot(WORLD_ID);
    expect(visibilityGate(snap, CHAR_KEEPER).present.some((row) => row.id === CHAR_PLAYER)).toBe(false);
    expect(visibilityGate(snap, CHAR_COOK).present.some((row) => row.id === CHAR_PLAYER)).toBe(true);
    session.close();
  });

  it("writes spoken remember-this as addressee Memory and leaves weather as ephemeral", async () => {
    const session = openWorld(
      ":memory:",
      stubNarrator(),
      undefined,
      fixedInterpreter({
        contributions: ["speak"],
        futureCausal: false,
        outcome: "ephemeral",
        proposals: [],
      }),
      stubNpcVoice(),
    );
    const remember = await session.playTurn("掌柜，你记住：晚上我可能不回宿舍。");
    expect(remember.interpretation.submitted).toBe(true);
    const afterRemember = session.store.snapshot(WORLD_ID);
    expect(
      afterRemember.memories.some((row) => row.characterId === CHAR_KEEPER && row.text.includes("不回宿舍")),
    ).toBe(true);
    expect(afterRemember.facts.some((row) => String(row.object).includes("不回宿舍"))).toBe(false);

    const memoryCount = afterRemember.memories.length;
    await session.playTurn("今天天气不错。");
    expect(session.store.snapshot(WORLD_ID).memories).toHaveLength(memoryCount);
    expect(
      visibilityGate(session.store.snapshot(WORLD_ID), CHAR_COOK).memories.some((row) => row.text.includes("不回宿舍")),
    ).toBe(false);
    session.close();
  });

  it("keeps a rejected carry out of the world and tells the narrator it did not happen", () => {
    const session = openWorld(":memory:", stubNarrator());
    applyInterpretation(session.store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_place", item: "书包", location: "堂屋" }],
      },
    });
    applyInterpretation(session.store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "character_move", location: "厨房" }],
      },
    });
    const rejected = applyInterpretation(session.store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_carry", item: "书包" }],
      },
    });
    expect(rejected.submitted).toBe(false);
    expect(rejected.result.reasons).toContain("ITEM_NOT_IN_REACH");
    expect(session.store.snapshot(WORLD_ID).items.find((row) => row.id === ITEM_BAG)?.locationId).toBe(LOC_HALL);
    const uncommitted = uncommittedProjection(
      {
        contributions: ["world_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "item_carry", item: "书包" }],
      },
      rejected,
    );
    expect(uncommitted.join("")).toContain("书包");
    const prompt = renderNarratorPrompt({
      playerContribution: "我把书包背起来。",
      observerContext: "地点=厨房",
      committed: [],
      uncommitted,
      npcReply: null,
      ephemeral: { recentScenes: [], ambient: [] },
    });
    expect(prompt).toContain("未发生");
    expect(prompt).toContain("ITEM_NOT_IN_REACH");
    expect(NARRATOR_SYSTEM).toContain("不能描写已经摸到");
    session.close();
  });

  it("does not re-inject the same public beat without a supporting tick event", () => {
    const beat = "街头新闻仍在报一桩没有结案的失踪。";
    expect(dampPublicBeat(beat, null, [])).toEqual([beat]);
    expect(dampPublicBeat(beat, beat, [{ type: "time_advance", producer: "world_tick" }])).toEqual([]);
    expect(dampPublicBeat(beat, beat, [{ type: "memory_note", producer: "world_tick" }])).toEqual([beat]);
  });

  it("does not turn weather into Memory or remember-speech into Fact", () => {
    const weather = withSpokenMemory(
      { contributions: ["speak"], futureCausal: false, outcome: "ephemeral", proposals: [] },
      { addresseeId: CHAR_KEEPER, playerLine: "今天天气不错。" },
    );
    expect(weather.outcome).toBe("ephemeral");
    expect(weather.proposals).toEqual([]);

    const remember = withSpokenMemory(
      { contributions: ["speak"], futureCausal: false, outcome: "ephemeral", proposals: [] },
      { addresseeId: CHAR_KEEPER, playerLine: "掌柜，你记住：晚上我可能不回宿舍。" },
    );
    expect(remember.outcome).toBe("candidate");
    expect(remember.proposals[0]).toMatchObject({ type: "memory_note", characterId: CHAR_KEEPER });

    const stay = withObviousMove(
      { contributions: ["low_causal"], futureCausal: false, outcome: "ephemeral", proposals: [] },
      { playerLine: "我数了数路边停的车。", locationId: "loc-city", currentLocationId: "loc-city" },
    );
    expect(stay.proposals).toEqual([]);
    const go = withObviousMove(
      { contributions: ["low_causal"], futureCausal: false, outcome: "ephemeral", proposals: [] },
      { playerLine: "我回到街上。", locationId: "loc-city", currentLocationId: "loc-dorm" },
    );
    expect(go.proposals).toEqual([{ type: "character_move", location: "loc-city" }]);
  });
});
