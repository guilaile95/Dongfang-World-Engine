import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { stubNarrator } from "../app/narrator/client.js";
import {
  applyInterpretation,
  interpretationSchema,
  normalizeInterpretation,
} from "../app/scene/interpretation.js";
import { INTERPRETER_SYSTEM, fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import { CHAR_COOK, CHAR_KEEPER, CHAR_PLAYER, TIME0, WORLD_ID } from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("scene interpretation", () => {
  it("states the proposal JSON field contract without content aliases", () => {
    expect(INTERPRETER_SYSTEM).toContain("只输出 JSON");
    expect(INTERPRETER_SYSTEM).toContain("type, text");
    expect(INTERPRETER_SYSTEM).toContain("type, subject, predicate, object");
    expect(INTERPRETER_SYSTEM).toContain("禁止 content");
  });

  it("defaults omitted futureCausal to false and still parses a legal ephemeral object", () => {
    const parsed = interpretationSchema.safeParse({
      contributions: ["low_causal", "observe"],
      outcome: "ephemeral",
      proposals: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.futureCausal).toBe(false);
    expect(parsed.data.outcome).toBe("ephemeral");

    const explicit = interpretationSchema.parse({
      contributions: ["durable_attempt"],
      futureCausal: true,
      outcome: "candidate",
      proposals: [{ type: "memory_note", text: "记下这句话。" }],
    });
    expect(explicit.futureCausal).toBe(true);
  });

  it("treats eating and refusing as ephemeral and never substitutes another write", () => {
    const eat = normalizeInterpretation({
      contributions: ["low_causal"],
      futureCausal: false,
      outcome: "candidate",
      proposals: [{ type: "claim_record", subject: "player", predicate: "moved_to", object: "loc-cellar" }],
    });
    expect(eat.outcome).toBe("ephemeral");
    expect(eat.proposals).toEqual([]);

    const refuse = normalizeInterpretation({
      contributions: ["refuse"],
      futureCausal: false,
      outcome: "candidate",
      proposals: [{ type: "memory_note", text: "去了地窖" }],
    });
    expect(refuse.outcome).toBe("ephemeral");
    expect(refuse.proposals).toEqual([]);

    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID);
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: eat,
    });
    expect(applied.submitted).toBe(false);
    expect(store.snapshot(WORLD_ID).claims).toEqual(before.claims);
    expect(store.snapshot(WORLD_ID).facts).toEqual(before.facts);
    store.close();
  });

  it("rejects schema-illegal proposals including fact_assert and unknown actions", () => {
    const bad = normalizeInterpretation({
      contributions: ["world_attempt"],
      futureCausal: true,
      outcome: "candidate",
      proposals: [{ type: "fact_assert", subject: "inn", predicate: "status", object: "burned" }],
    });
    expect(bad.outcome).toBe("fail");
    expect(bad.proposals).toEqual([]);

    const unknown = normalizeInterpretation({
      contributions: ["world_attempt"],
      futureCausal: true,
      outcome: "candidate",
      proposals: [{ type: "character.move", to: "loc-cellar" }],
    });
    expect(unknown.outcome).toBe("fail");
    expect(unknown.proposals).toEqual([]);
  });

  it("asks and observes do not grant knowledge", () => {
    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID).knowledge;
    applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["ask", "observe"],
        futureCausal: false,
        outcome: "ephemeral",
        proposals: [],
      },
    });
    expect(store.snapshot(WORLD_ID).knowledge).toEqual(before);
    store.close();
  });

  it("re-enters authority when a mundane act has future causal value in this scene", () => {
    const store = memoryWorld();
    const poisoned = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "fact_assert",
          worldId: WORLD_ID,
          expectedRevision: 0,
          factId: "fact-stew-poisoned",
          subject: "stew",
          predicate: "status",
          object: "poisoned",
          validFrom: TIME0,
        },
      ],
    });
    expect(poisoned.accepted).toBe(true);
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      interpretation: {
        contributions: ["low_causal", "durable_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [
          { type: "claim_record", subject: CHAR_PLAYER, predicate: "ingested", object: "stew" },
          { type: "memory_note", text: "把灶上的汤喝了。" },
        ],
      },
    });
    expect(applied.submitted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.facts.some((row) => row.id === "fact-stew-poisoned" && row.object === "poisoned")).toBe(true);
    expect(snap.claims.some((row) => row.predicate === "ingested" && row.object === "stew")).toBe(true);
    expect(snap.knowledge.some((row) => row.characterId === CHAR_PLAYER && row.claimId === "claim-bag-in-cellar")).toBe(
      false,
    );
    store.close();
  });

  it("binds an unaddressed spoken memory_note to the resolved addressee, not the player or a bystander", () => {
    const store = memoryWorld();
    const applied = applyInterpretation(store, {
      worldId: WORLD_ID,
      playerId: CHAR_PLAYER,
      addresseeId: CHAR_KEEPER,
      interpretation: {
        contributions: ["speak", "durable_attempt"],
        futureCausal: true,
        outcome: "candidate",
        proposals: [{ type: "memory_note", text: "旅人说从今天起不住这儿了。" }],
      },
    });
    expect(applied.submitted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.memories.some((row) => row.characterId === CHAR_KEEPER && row.text.includes("不住这儿"))).toBe(true);
    expect(snap.memories.some((row) => row.characterId === CHAR_PLAYER)).toBe(false);
    expect(snap.memories.some((row) => row.characterId === CHAR_COOK)).toBe(false);
    store.close();
  });

  it("session eating stays ephemeral and does not invent a food system", async () => {
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
    const claimsBefore = session.store.snapshot(WORLD_ID).claims.length;
    const turn = await session.playTurn("我先吃饭。");
    expect(turn.interpretation.outcome).toBe("ephemeral");
    expect(turn.interpretation.submitted).toBe(false);
    expect(session.store.snapshot(WORLD_ID).claims.length).toBe(claimsBefore);
    expect(session.store.snapshot(WORLD_ID).facts.some((row) => row.predicate === "hunger")).toBe(false);
    session.close();
  });
});
