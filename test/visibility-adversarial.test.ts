import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import type { WorldSnapshot } from "../app/authority/types.js";
import { assemblePrompt } from "../app/visibility/assemble.js";
import { applyBudget } from "../app/visibility/budget.js";
import { visibilityGate } from "../app/visibility/gate.js";
import { searchWithinPool } from "../app/visibility/retrieve.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CLAIM_BAG,
  CLAIM_GUEST_FLED,
  FACT_BAG,
  LOC_HALL,
  TIME0,
  WORLD_ID,
} from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

const KEEPER_MEMORY = "TOKEN_KEEPER_LEDGER_LI_OWES";
const COOK_MEMORY = "TOKEN_COOK_HIDDEN_DEBT";

function seedSecrets(store: ReturnType<typeof memoryWorld>): void {
  const keeperMem = submitCandidates(store, {
    producer: "system",
    candidates: [
      {
        type: "memory_note",
        worldId: WORLD_ID,
        expectedRevision: 0,
        memoryId: "mem-keeper-ledger",
        characterId: CHAR_KEEPER,
        text: KEEPER_MEMORY,
      },
    ],
  });
  expect(keeperMem.accepted).toBe(true);
  const cookMem = submitCandidates(store, {
    producer: "system",
    candidates: [
      {
        type: "memory_note",
        worldId: WORLD_ID,
        expectedRevision: 1,
        memoryId: "mem-cook-debt",
        characterId: CHAR_COOK,
        text: COOK_MEMORY,
      },
    ],
  });
  expect(cookMem.accepted).toBe(true);
}

function colocated(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    ...snapshot,
    characters: snapshot.characters.map((row) =>
      row.id === CHAR_COOK ? { ...row, locationId: LOC_HALL } : row,
    ),
  };
}

/** Forbidden pattern: index the raw world, then maybe filter. Used only to contrast the gate. */
function searchWorldThenMaybeFilter(snapshot: WorldSnapshot, query: string): string[] {
  const hits: string[] = [];
  for (const fact of snapshot.facts) {
    if (`${fact.subject} ${fact.predicate} ${fact.object}`.includes(query) || fact.id.includes(query)) {
      hits.push(fact.id);
    }
  }
  for (const claim of snapshot.claims) {
    if (`${claim.subject} ${claim.predicate} ${claim.object}`.includes(query) || claim.id.includes(query)) {
      hits.push(claim.id);
    }
  }
  for (const memory of snapshot.memories) {
    if (memory.text.includes(query)) {
      hits.push(memory.text);
    }
  }
  return hits;
}

describe("visibility adversarial", () => {
  it("two NPCs with different knowledge do not receive each other's secrets, even when colocated and queried for them", () => {
    const store = memoryWorld();
    seedSecrets(store);
    const snapshot = colocated(store.snapshot(WORLD_ID));

    const keeperPool = visibilityGate(snapshot, CHAR_KEEPER);
    const cookPool = visibilityGate(snapshot, CHAR_COOK);

    expect(keeperPool.namespace).toBe(`char:${CHAR_KEEPER}`);
    expect(cookPool.namespace).toBe(`char:${CHAR_COOK}`);
    expect("facts" in keeperPool).toBe(false);
    expect("events" in cookPool).toBe(false);

    expect(keeperPool.knownClaims.some((row) => row.claim.id === CLAIM_BAG)).toBe(true);
    expect(keeperPool.knownClaims.some((row) => row.claim.id === CLAIM_GUEST_FLED)).toBe(false);
    expect(keeperPool.memories.some((row) => row.text === KEEPER_MEMORY)).toBe(true);
    expect(keeperPool.memories.some((row) => row.text === COOK_MEMORY)).toBe(false);
    expect(JSON.stringify(keeperPool)).not.toContain(CLAIM_GUEST_FLED);
    expect(JSON.stringify(keeperPool)).not.toContain(COOK_MEMORY);
    expect(JSON.stringify(keeperPool)).not.toContain(FACT_BAG);

    expect(cookPool.knownClaims.some((row) => row.claim.id === CLAIM_GUEST_FLED)).toBe(true);
    expect(cookPool.knownClaims.some((row) => row.claim.id === CLAIM_BAG)).toBe(false);
    expect(cookPool.memories.some((row) => row.text === COOK_MEMORY)).toBe(true);
    expect(cookPool.memories.some((row) => row.text === KEEPER_MEMORY)).toBe(false);
    expect(JSON.stringify(cookPool)).not.toContain("guest-li-bag");
    expect(JSON.stringify(cookPool)).not.toContain(CLAIM_BAG);
    expect(JSON.stringify(cookPool)).not.toContain(KEEPER_MEMORY);
    expect(JSON.stringify(cookPool)).not.toContain(FACT_BAG);

    expect(keeperPool.present.some((row) => row.id === CHAR_COOK)).toBe(true);
    expect(cookPool.present.some((row) => row.id === CHAR_KEEPER)).toBe(true);

    const cookSearch = searchWithinPool(cookPool, "guest-li-bag located_in loc-cellar");
    expect(cookSearch.claims.some((row) => row.claim.id === CLAIM_BAG)).toBe(false);
    expect(cookSearch.memories.some((row) => row.text === KEEPER_MEMORY)).toBe(false);
    expect(JSON.stringify(cookSearch)).not.toContain("guest-li-bag");

    const keeperSearch = searchWithinPool(keeperPool, "guest-li fled_to town");
    expect(keeperSearch.claims.some((row) => row.claim.id === CLAIM_GUEST_FLED)).toBe(false);
    expect(keeperSearch.memories.some((row) => row.text === COOK_MEMORY)).toBe(false);
    expect(JSON.stringify(keeperSearch)).not.toContain(COOK_MEMORY);

    const cookPrompt = assemblePrompt({
      snapshot,
      observerId: CHAR_COOK,
      query: "guest-li-bag located_in loc-cellar TOKEN_KEEPER_LEDGER_LI_OWES",
    }).prompt;
    const keeperPrompt = assemblePrompt({
      snapshot,
      observerId: CHAR_KEEPER,
      query: "guest-li fled_to town TOKEN_COOK_HIDDEN_DEBT",
    }).prompt;
    expect(cookPrompt).not.toContain("guest-li-bag");
    expect(cookPrompt).not.toContain(KEEPER_MEMORY);
    expect(cookPrompt).not.toContain(FACT_BAG);
    expect(keeperPrompt).not.toContain(CLAIM_GUEST_FLED);
    expect(keeperPrompt).not.toContain(COOK_MEMORY);

    const cookedDown = applyBudget(searchWithinPool(cookPool, "bag cellar ledger"), {
      maxClaims: 0,
      maxMemories: 0,
      maxLore: 0,
      maxChars: 40,
    });
    expect(cookedDown.claims).toEqual([]);
    expect(JSON.stringify(cookedDown)).not.toContain("guest-li-bag");
    expect(JSON.stringify(cookedDown)).not.toContain(KEEPER_MEMORY);

    const leakedIfGlobal = searchWorldThenMaybeFilter(snapshot, "guest-li-bag");
    expect(leakedIfGlobal).toContain(CLAIM_BAG);
    expect(leakedIfGlobal).toContain(FACT_BAG);
    expect(searchWithinPool(cookPool, "guest-li-bag").claims.map((row) => row.claim.id)).not.toContain(CLAIM_BAG);

    expect(visibilityGate(snapshot, CHAR_COOK, [`掌柜说 ${CLAIM_BAG} guest-li-bag located_in loc-cellar`]).ambient).toEqual(
      [],
    );
    store.close();
  });

  it("does not treat unlearned facts or the event log as legal retrieval targets", () => {
    const store = memoryWorld();
    const snapshot = store.snapshot(WORLD_ID);
    const events = store.listEvents(WORLD_ID);
    expect(events.length).toBe(0);
    const cook = assemblePrompt({ snapshot, observerId: CHAR_COOK, query: TIME0 });
    expect(JSON.stringify(cook.pool)).not.toContain("fact_assert");
    expect(JSON.stringify(cook.prompt)).not.toContain(FACT_BAG);
    expect(cook.pool.knownClaims.every((row) => row.claim.id !== CLAIM_BAG)).toBe(true);
    store.close();
  });
});
