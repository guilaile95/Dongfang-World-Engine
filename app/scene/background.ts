import type { Candidate } from "../authority/candidate.js";
import { submitCandidates } from "../authority/commit.js";
import type { BackgroundExposureRecord } from "../authority/types.js";
import type { WorldStore } from "../persist/store.js";
import type { CompiledWorld } from "../world/compile.js";

export interface DeliveredExposure extends BackgroundExposureRecord {
  threadId: string;
  beatId: string;
}

export function advanceDueBackgroundThreads(input: {
  store: WorldStore;
  compiled: CompiledWorld;
  playerId: string;
  routeId?: string | null;
}): { exposures: DeliveredExposure[]; executedBeatIds: string[] } {
  const { store, compiled, playerId, routeId = null } = input;
  const worldId = compiled.seed.world.id;
  const exposures: DeliveredExposure[] = [];
  const executedBeatIds: string[] = [];
  for (const thread of store.snapshot(worldId).backgroundThreads) {
    for (const beat of thread.beats) {
      const fresh = store.snapshot(worldId);
      const current = fresh.backgroundThreads.find((row) => row.id === thread.id);
      if (!current || current.currentStage !== beat.stageFrom || current.executedBeatIds.includes(beat.beatId) || !isDue(current.startsAt, beat.dueAt, beat.afterMinutes, fresh.world.time)) continue;
      const candidates: Candidate[] = [{
        type: "background_thread_advance", worldId, expectedRevision: fresh.world.revision,
        threadId: current.id, beatId: beat.beatId, stageFrom: beat.stageFrom, stageTo: beat.stageTo,
      }];
      for (const consequence of beat.consequences) {
        const expectedRevision = fresh.world.revision + candidates.length;
        candidates.push(consequence.type === "fact_assert"
          ? { type: "fact_assert", worldId, expectedRevision, factId: consequence.id, subject: consequence.subject, predicate: consequence.predicate, object: consequence.object, validFrom: fresh.world.time }
          : { type: "claim_record", worldId, expectedRevision, claimId: consequence.id, subject: consequence.subject, predicate: consequence.predicate, object: consequence.object });
      }
      const result = submitCandidates(store, { producer: "system", candidates, idempotencyKey: `background:${current.id}:${beat.beatId}` });
      if (!result.accepted) throw new Error(`BACKGROUND_COMMIT_REJECTED:${result.reasons.join(",")}`);
      executedBeatIds.push(beat.beatId);
      for (const exposure of beat.exposureRules) {
        if (exposureVisible(store, compiled, playerId, current.locationScope, exposure.kind, routeId)) exposures.push({ ...exposure, threadId: current.id, beatId: beat.beatId });
      }
    }
  }
  return { exposures, executedBeatIds };
}

function isDue(startsAt: string, dueAt: string | null, afterMinutes: number | null, now: string): boolean {
  const nowMs = Date.parse(now);
  const dueMs = dueAt ? Date.parse(dueAt) : Date.parse(startsAt) + (afterMinutes ?? 0) * 60_000;
  return Number.isFinite(nowMs) && Number.isFinite(dueMs) && nowMs >= dueMs;
}

function exposureVisible(
  store: WorldStore,
  compiled: CompiledWorld,
  playerId: string,
  scope: string[],
  kind: BackgroundExposureRecord["kind"],
  routeId: string | null,
): boolean {
  if (kind === "public_broadcast") return true;
  const snapshot = store.snapshot(compiled.seed.world.id);
  const player = snapshot.characters.find((row) => row.id === playerId);
  if (!player) return false;
  if (kind === "same_location" || kind === "visible_result") return scope.includes(player.locationId);
  const route = routeId ? snapshot.routes.find((row) => row.id === routeId) : null;
  return Boolean(route && [route.fromLocationId, ...route.viaLocationIds, route.toLocationId].some((id) => scope.includes(id)));
}
