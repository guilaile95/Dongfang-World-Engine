import type { RankedSlice } from "./retrieve.js";

export interface ContextBudget {
  maxClaims: number;
  maxMemories: number;
  maxChars: number;
}

export const DEFAULT_BUDGET: ContextBudget = {
  maxClaims: 16,
  maxMemories: 16,
  maxChars: 8000,
};

/** Truncate a ranked legal slice. Cannot pull extra rows from the world. */
export function applyBudget(slice: RankedSlice, budget: ContextBudget = DEFAULT_BUDGET): RankedSlice {
  const claims = slice.claims.slice(0, Math.max(0, budget.maxClaims));
  const memories = slice.memories.slice(0, Math.max(0, budget.maxMemories));
  const next: RankedSlice = { ...slice, claims, memories };
  let packed = measure(next);
  while (packed > budget.maxChars && (next.claims.length > 0 || next.memories.length > 0)) {
    const lastClaim = next.claims[next.claims.length - 1];
    const lastMemory = next.memories[next.memories.length - 1];
    const claimScore = lastClaim?.score ?? -1;
    const memoryScore = lastMemory?.score ?? -1;
    if (lastMemory && memoryScore <= claimScore) {
      next.memories = next.memories.slice(0, -1);
    } else if (lastClaim) {
      next.claims = next.claims.slice(0, -1);
    } else {
      next.memories = next.memories.slice(0, -1);
    }
    packed = measure(next);
  }
  return next;
}

function measure(slice: RankedSlice): number {
  const claims = slice.claims
    .map((row) => `${row.claim.subject} ${row.claim.predicate} ${row.claim.object}`)
    .join("；");
  const memories = slice.memories.map((row) => row.text).join("；");
  return (
    slice.worldName.length +
    slice.time.length +
    slice.publicRules.join("").length +
    slice.location.name.length +
    slice.present.map((row) => row.name).join("").length +
    slice.ambient.join("").length +
    claims.length +
    memories.length
  );
}
