import { describe, expect, it } from "vitest";
import { parseLlmCandidate } from "../app/authority/candidate.js";
import { submitCandidates, submitEmptyProposal, submitLlmProposal } from "../app/authority/commit.js";
import {
  CHAR_PLAYER,
  CLAIM_BAG,
  FACT_INN_OPEN,
  SEED_ID,
  TIME0,
  WORLD_ID,
} from "../app/world/seed.js";
import { memoryWorld, worldRevision } from "./helpers.js";

describe("authority", () => {
  it("treats empty proposal as success and writes nothing", () => {
    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID);
    const result = submitEmptyProposal(store, WORLD_ID);
    expect(result.accepted).toBe(true);
    expect(result.events).toEqual([]);
    expect(store.snapshot(WORLD_ID)).toEqual(before);
  });

  it("parses schema-valid LLM fact_assert but does not treat it as Truth", () => {
    const raw = {
      type: "fact_assert",
      worldId: WORLD_ID,
      expectedRevision: 0,
      factId: "fact-from-llm",
      subject: "inn",
      predicate: "status",
      object: "burned",
      validFrom: TIME0,
    };
    const parsed = parseLlmCandidate(raw);
    expect(parsed.schemaValid).toBe(true);
    expect(parsed.candidate?.type).toBe("fact_assert");

    const store = memoryWorld();
    const result = submitLlmProposal(store, WORLD_ID, raw);
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("LLM_CANNOT_WRITE:fact_assert");
    expect(store.snapshot(WORLD_ID).facts.some((fact) => fact.id === "fact-from-llm")).toBe(false);
    expect(store.snapshot(WORLD_ID).facts.some((fact) => fact.id === FACT_INN_OPEN && fact.object === "open")).toBe(
      true,
    );
    expect(worldRevision(store)).toBe(0);
    expect(store.listEvents(WORLD_ID)).toEqual([]);
  });

  it("rejects schema-invalid LLM output without writing", () => {
    const store = memoryWorld();
    const result = submitLlmProposal(store, WORLD_ID, { type: "fact_assert", worldId: WORLD_ID });
    expect(result.accepted).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(worldRevision(store)).toBe(0);
    expect(store.listEvents(WORLD_ID)).toEqual([]);
  });

  it("lets system assert a fact through the gate", () => {
    const store = memoryWorld();
    const result = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "fact_assert",
          worldId: WORLD_ID,
          expectedRevision: 0,
          factId: "fact-rain",
          subject: "sky",
          predicate: "weather",
          object: "rain",
          validFrom: TIME0,
        },
      ],
    });
    expect(result.accepted).toBe(true);
    expect(store.snapshot(WORLD_ID).facts.some((fact) => fact.id === "fact-rain")).toBe(true);
    expect(worldRevision(store)).toBe(1);
    expect(store.listEvents(WORLD_ID)).toHaveLength(1);
  });

  it("rolls back the whole batch when a later candidate is illegal", () => {
    const store = memoryWorld();
    const result = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "fact_assert",
          worldId: WORLD_ID,
          expectedRevision: 0,
          factId: "fact-partial",
          subject: "gate",
          predicate: "state",
          object: "ajar",
          validFrom: TIME0,
        },
        {
          type: "character_learn_claim",
          worldId: WORLD_ID,
          expectedRevision: 1,
          characterId: CHAR_PLAYER,
          claimId: "claim-does-not-exist",
          knowledgeState: "rumor",
          source: { kind: "seed", seedId: SEED_ID },
        },
      ],
    });
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("CLAIM_NOT_FOUND");
    expect(store.snapshot(WORLD_ID).facts.some((fact) => fact.id === "fact-partial")).toBe(false);
    expect(worldRevision(store)).toBe(0);
    expect(store.listEvents(WORLD_ID)).toEqual([]);
  });

  it("rejects stale revision without writing", () => {
    const store = memoryWorld();
    const result = submitCandidates(store, {
      producer: "system",
      candidates: [
        {
          type: "time_advance",
          worldId: WORLD_ID,
          expectedRevision: 99,
          toTime: "day-1-noon",
        },
      ],
    });
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("STALE_WORLD_STATE");
    expect(store.snapshot(WORLD_ID).world.time).toBe(TIME0);
  });

  it("does not let a recorded claim become a fact, or a memory become knowledge", () => {
    const store = memoryWorld();
    const claimResult = submitLlmProposal(store, WORLD_ID, {
      type: "claim_record",
      worldId: WORLD_ID,
      expectedRevision: 0,
      claimId: "claim-from-llm",
      subject: "guest-li",
      predicate: "seen_at",
      object: "river",
    });
    expect(claimResult.accepted).toBe(true);
    expect(store.snapshot(WORLD_ID).facts.some((fact) => fact.id === "claim-from-llm")).toBe(false);
    expect(store.snapshot(WORLD_ID).knowledge.some((row) => row.claimId === "claim-from-llm")).toBe(false);

    const memoryResult = submitLlmProposal(store, WORLD_ID, {
      type: "memory_note",
      worldId: WORLD_ID,
      expectedRevision: 1,
      memoryId: "mem-player-1",
      characterId: CHAR_PLAYER,
      text: "觉得地窖里好像藏了什么。",
    });
    expect(memoryResult.accepted).toBe(true);
    const snap = store.snapshot(WORLD_ID);
    expect(snap.memories.some((row) => row.id === "mem-player-1")).toBe(true);
    expect(snap.knowledge.some((row) => row.characterId === CHAR_PLAYER && row.claimId === CLAIM_BAG)).toBe(false);
  });

  it("rejects LLM knowledge and time writes even when schema-valid", () => {
    const store = memoryWorld();
    const learn = submitLlmProposal(store, WORLD_ID, {
      type: "character_learn_claim",
      worldId: WORLD_ID,
      expectedRevision: 0,
      characterId: CHAR_PLAYER,
      claimId: CLAIM_BAG,
      knowledgeState: "confirmed",
      source: { kind: "seed", seedId: SEED_ID },
    });
    expect(learn.accepted).toBe(false);
    expect(learn.reasons).toContain("LLM_CANNOT_WRITE:character_learn_claim");
    expect(store.snapshot(WORLD_ID).knowledge.some((row) => row.characterId === CHAR_PLAYER)).toBe(false);

    const time = submitLlmProposal(store, WORLD_ID, {
      type: "time_advance",
      worldId: WORLD_ID,
      expectedRevision: 0,
      toTime: "day-1-noon",
    });
    expect(time.accepted).toBe(false);
    expect(time.reasons).toContain("LLM_CANNOT_WRITE:time_advance");
    expect(store.snapshot(WORLD_ID).world.time).toBe(TIME0);
  });
});
