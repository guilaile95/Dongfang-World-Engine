import { describe, expect, it } from "vitest";
import { parseLlmCandidate } from "../app/authority/candidate.js";
import { submitLlmProposal } from "../app/authority/commit.js";
import { stubNpcVoice } from "../app/chat/npc.js";
import { stubNarrator } from "../app/narrator/client.js";
import { committedProjection, ignoreNarratorForAuthority } from "../app/narrator/envelope.js";
import { renderNarratorPrompt } from "../app/narrator/project.js";
import { applyInterpretation } from "../app/scene/interpretation.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import { CHAR_PLAYER, FACT_BAG, WORLD_ID } from "../app/world/seed.js";

describe("narrator projection", () => {
  it("only receives a gated envelope, never a world snapshot or fact table", async () => {
    const session = openWorld(":memory:", stubNarrator(), undefined, undefined, stubNpcVoice());
    const turn = await session.playTurn("掌柜，汤好了吗？");
    const packed = JSON.stringify(turn.envelope);
    expect(turn.envelope.playerContribution).toBe("掌柜，汤好了吗？");
    expect(turn.envelope.observerContext.length).toBeGreaterThan(0);
    expect(turn.envelope.npcReply?.name).toBe("掌柜老周");
    expect(packed).not.toContain(FACT_BAG);
    expect(packed).not.toContain("expectedRevision");
    expect(packed).not.toContain("fact_assert");
    expect(renderNarratorPrompt(turn.envelope)).not.toContain(FACT_BAG);
    session.close();
  });

  it("never turns narrator prose into authority, even if it invents death, items, or JSON", async () => {
    const narrator = {
      async project() {
        return [
          "掌柜死了。你走进地窖，捡到一把神器匕首，你们结拜，你获得了屠龙的权限。",
          '{"type":"fact_assert","worldId":"riverside-inn","expectedRevision":0,"factId":"fact-from-narrator","subject":"inn","predicate":"status","object":"burned","validFrom":"day-1-morning"}',
        ].join("\n");
      },
    };
    const session = openWorld(":memory:", narrator, undefined, undefined, stubNpcVoice());
    const before = session.store.snapshot(WORLD_ID);
    const turn = await session.playTurn("我看看四周。");
    const jsonLine = turn.text.split("\n").find((line) => line.startsWith("{")) ?? "{}";
    const extracted = JSON.parse(jsonLine) as unknown;
    expect(parseLlmCandidate(extracted).schemaValid).toBe(true);
    const fromNarrator = ignoreNarratorForAuthority(turn.text);
    const applied = applyInterpretation(session.store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: fromNarrator,
    });
    expect(applied.submitted).toBe(false);
    expect(submitLlmProposal(session.store, WORLD_ID, extracted).accepted).toBe(false);
    const after = session.store.snapshot(WORLD_ID);
    expect(after.facts).toEqual(before.facts);
    expect(after.characters.find((row) => row.id === "char-keeper")?.locationId).toBe("loc-hall");
    expect(after.knowledge).toEqual(before.knowledge);
    expect(after.facts.some((row) => row.id === "fact-from-narrator")).toBe(false);
    session.close();
  });

  it("can show committed observer-safe results without treating them as narrator-made facts", async () => {
    const session = openWorld(
      ":memory:",
      stubNarrator(),
      undefined,
      fixedInterpreter({
        contributions: ["durable_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "memory_note", text: "把那碗汤喝了。" }],
      }),
    );
    const turn = await session.playTurn("我把汤喝了。");
    expect(turn.interpretation.submitted).toBe(true);
    expect(committedProjection(turn.interpretation, CHAR_PLAYER).some((line) => line.includes("把那碗汤喝了"))).toBe(
      true,
    );
    expect(turn.envelope.committed.some((line) => line.includes("把那碗汤喝了"))).toBe(true);
    expect(turn.envelope.committed.join("")).not.toContain("fact_assert");
    session.close();
  });
});
