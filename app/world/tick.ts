import { randomUUID } from "node:crypto";
import { submitCandidates } from "../authority/commit.js";
import type { WorldStore } from "../persist/store.js";
import {
  DEFAULT_AUTONOMY_BUDGET,
  EXPERIMENT_1_AUTONOMY,
  planTurnAutonomy,
  type AutonomyBudget,
  type AutonomyEvidence,
} from "./autonomy.js";
import type { CompiledWorld } from "./compile.js";
import { nextBeat, SYNTHETIC } from "./seed.js";

export interface TickResult {
  publicBeat: string;
  accepted: boolean;
  reasons: string[];
  llmCalls: number;
}

/** Once per in-world player turn. Not parsed from the player line. Not a scheduler. */
export function worldTick(
  store: WorldStore,
  compiled: CompiledWorld = SYNTHETIC,
  options: { budget?: AutonomyBudget; evidence?: AutonomyEvidence | null } = {},
): TickResult {
  const worldId = compiled.seed.world.id;
  const snapshot = store.snapshot(worldId);
  const plan = planTurnAutonomy(
    snapshot,
    compiled,
    options.budget ?? DEFAULT_AUTONOMY_BUDGET,
    options.evidence === undefined ? EXPERIMENT_1_AUTONOMY : options.evidence,
  );
  const toTime = nextBeat(snapshot.world.time);
  const candidates = [
    ...(plan.timeAdvance
      ? [
        {
          type: "time_advance" as const,
          worldId,
          expectedRevision: snapshot.world.revision,
          toTime,
        },
      ]
      : []),
    ...(plan.themeMemory
      ? [
        {
          type: "memory_note" as const,
          worldId,
          expectedRevision: snapshot.world.revision + (plan.timeAdvance ? 1 : 0),
          memoryId: `mem-tick-${randomUUID()}`,
          characterId: plan.themeMemory.characterId,
          text: plan.themeMemory.text,
        },
      ]
      : []),
  ];
  const result = candidates.length > 0
    ? submitCandidates(store, { producer: "world_tick", candidates })
    : { accepted: true, reasons: [] as string[], events: [] };

  return {
    publicBeat: plan.publicBeat,
    accepted: result.accepted,
    reasons: result.reasons,
    llmCalls: plan.llmCalls,
  };
}
