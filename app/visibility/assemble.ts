import type { WorldSnapshot } from "../authority/types.js";
import { applyBudget, DEFAULT_BUDGET, type ContextBudget } from "./budget.js";
import { visibilityGate } from "./gate.js";
import { toObserverContext, type LegalPool, type ObserverContext } from "./pool.js";
import { packPrompt } from "./prompt.js";
import { rankWithinPool, type RankedSlice } from "./retrieve.js";

export interface AssembledPrompt {
  pool: LegalPool;
  ranked: RankedSlice;
  budgeted: RankedSlice;
  prompt: string;
  observer: ObserverContext;
}

/**
 * World → Visibility Gate → legal pool → rank → budget → prompt.
 * Ranking and budget never see the raw world.
 */
export function assemblePrompt(input: {
  snapshot: WorldSnapshot;
  observerId: string;
  query?: string;
  ambient?: string[];
  budget?: ContextBudget;
}): AssembledPrompt {
  const pool = visibilityGate(input.snapshot, input.observerId, input.ambient ?? []);
  const ranked = rankWithinPool(pool, input.query ?? "");
  const budgeted = applyBudget(ranked, input.budget ?? DEFAULT_BUDGET);
  return {
    pool,
    ranked,
    budgeted,
    prompt: packPrompt(budgeted),
    observer: toObserverContext(pool),
  };
}
