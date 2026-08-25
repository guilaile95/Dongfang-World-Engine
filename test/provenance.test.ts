import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { explain } from "../app/authority/explain.js";
import {
  CHAR_KEEPER,
  CHAR_PLAYER,
  CLAIM_BAG,
  FACT_BAG,
  SEED_ID,
  TIME0,
  WORLD_ID,
} from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("provenance", () => {
  it("explains seed facts and knowledge without mixing layers", () => {
    const store = memoryWorld();
    const fact = explain(store, WORLD_ID, { layer: "fact", id: FACT_BAG });
    expect(fact.via).toBe("seed");
    expect(fact.seedId).toBe(SEED_ID);
    expect(fact.producer).toBe("seed");
    expect(fact.events).toEqual([]);

    const claim = explain(store, WORLD_ID, { layer: "claim", id: CLAIM_BAG });
    expect(claim.via).toBe("seed");
    expect(claim.seedId).toBe(SEED_ID);

    const knowledge = explain(store, WORLD_ID, {
      layer: "knowledge",
      characterId: CHAR_KEEPER,
      claimId: CLAIM_BAG,
    });
    expect(knowledge.via).toBe("seed");
    expect(knowledge.seedId).toBe(SEED_ID);

    expect(() =>
      explain(store, WORLD_ID, { layer: "knowledge", characterId: CHAR_PLAYER, claimId: CLAIM_BAG }),
    ).toThrow(/KNOWLEDGE_NOT_FOUND/);
    store.close();
  });

  it("records the committing event and its causes for later explanation", () => {
    const store = memoryWorld();
    const tick = submitCandidates(store, { producer: "system", candidates: [
      { type: "time_advance", worldId: WORLD_ID, expectedRevision: 0, toTime: "day-1-noon" },
      { type: "memory_note", worldId: WORLD_ID, expectedRevision: 1, memoryId: "mem-system-beat", characterId: CHAR_KEEPER, text: "掌柜继续追查失踪客人的下落。" },
    ] });
    expect(tick.accepted).toBe(true);
    const memories = store.snapshot(WORLD_ID).memories.filter((row) => row.characterId === CHAR_KEEPER);
    const latest = memories[memories.length - 1];
    expect(latest).toBeDefined();
    if (!latest) {
      throw new Error("expected keeper memory");
    }
    const origin = explain(store, WORLD_ID, { layer: "memory", id: latest.id });
    expect(origin.via).toBe("event");
    expect(origin.producer).toBe("system");
    expect(origin.events).toHaveLength(2);
    expect(origin.events[0]?.type).toBe("time_advance");
    expect(origin.events[1]?.type).toBe("memory_note");
    expect(origin.events[1]?.causeEventIds).toEqual([origin.events[0]?.id]);
    store.close();
  });

  it("does not let a fact grant knowledge or a learned claim become a fact", () => {
    const store = memoryWorld();
    const asserted = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "fact_assert",
          worldId: WORLD_ID,
          expectedRevision: 0,
          factId: "fact-bell",
          subject: "hall-bell",
          predicate: "status",
          object: "cracked",
          validFrom: TIME0,
        },
      ],
    });
    expect(asserted.accepted).toBe(true);
    expect(store.snapshot(WORLD_ID).knowledge.some((row) => row.claimId === "fact-bell")).toBe(false);
    expect(store.snapshot(WORLD_ID).claims.some((row) => row.id === "fact-bell")).toBe(false);
    const factOrigin = explain(store, WORLD_ID, { layer: "fact", id: "fact-bell" });
    expect(factOrigin.via).toBe("event");
    expect(factOrigin.producer).toBe("system");
    expect(factOrigin.events).toHaveLength(1);

    const learned = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "character_learn_claim",
          worldId: WORLD_ID,
          expectedRevision: 1,
          characterId: CHAR_PLAYER,
          claimId: CLAIM_BAG,
          knowledgeState: "rumor",
          source: { kind: "character", characterId: CHAR_KEEPER },
        },
      ],
    });
    expect(learned.accepted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.facts.filter((row) => row.id === CLAIM_BAG)).toEqual([]);
    expect(snap.knowledge.some((row) => row.characterId === CHAR_PLAYER && row.claimId === CLAIM_BAG)).toBe(true);
    const learnOrigin = explain(store, WORLD_ID, {
      layer: "knowledge",
      characterId: CHAR_PLAYER,
      claimId: CLAIM_BAG,
    });
    expect(learnOrigin.via).toBe("character");
    expect(learnOrigin.sourceCharacterId).toBe(CHAR_KEEPER);
    expect(learnOrigin.producer).toBe("system");
    expect(learnOrigin.events).toHaveLength(1);
    expect(learnOrigin.events[0]?.type).toBe("character_learn_claim");
    store.close();
  });
});
