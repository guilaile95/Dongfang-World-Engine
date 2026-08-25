import {
  isLegalRecallNamespace,
  packFromSlice,
  renderContinuity,
  type ContinuityEvidence,
  type ContinuityPack,
} from "../context/continuity.js";
import type { WorldSnapshot } from "../authority/types.js";
import { applyBudget, DEFAULT_BUDGET, type ContextBudget } from "./budget.js";
import { visibilityGate } from "./gate.js";
import { toObserverContext, type LegalPool, type ObserverContext } from "./pool.js";
import { rankWithinPool, type LoreHit, type RankedSlice } from "./retrieve.js";

export interface AssembledPrompt {
  pool: LegalPool;
  ranked: RankedSlice;
  budgeted: RankedSlice;
  continuity: ContinuityPack;
  prompt: string;
  observer: ObserverContext;
}

/**
 * World → Visibility Gate → legal pool → rank → budget → continuity pack.
 * Ranking, recall, and summaries never see the raw world.
 */
export function assemblePrompt(input: {
  snapshot: WorldSnapshot;
  observerId: string;
  query?: string;
  ambient?: string[];
  budget?: ContextBudget;
  loreHits?: LoreHit[];
  recentScenes?: string[];
  rollingSummary?: string | null;
  evidence?: ContinuityEvidence | null;
  playerProfile?: import("../persist/store.js").PlayerProfile | null;
}): AssembledPrompt {
  const pool = visibilityGate(input.snapshot, input.observerId, input.ambient ?? []);
  const ranked = rankWithinPool(pool, input.query ?? "");
  ranked.lore = (input.loreHits ?? []).filter(
    (hit) => hit.kind === "lore" && isLegalRecallNamespace(pool.namespace, hit.namespace),
  );
  const budgeted = applyBudget(ranked, input.budget ?? DEFAULT_BUDGET);
  const continuity = packFromSlice(budgeted, input.recentScenes ?? [], {
    ...(input.rollingSummary !== undefined ? { rollingSummary: input.rollingSummary } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.playerProfile !== undefined ? { playerProfile: input.playerProfile } : {}),
  });
  return {
    pool,
    ranked,
    budgeted,
    continuity,
    prompt: renderContinuity(continuity),
    observer: toObserverContext(pool),
  };
}
