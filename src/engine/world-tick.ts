import type { ClaimRecord, CommittedEvent, FactRecord, WorldSnapshot } from "../domain/types.js";
import { CLOSED_INN_WORLD_ID } from "../testkit/world-builder.js";
import type { CommitKernel, CommitResult } from "./commit-kernel.js";
import { KernelError } from "./errors.js";
import type { SqliteWorldStore } from "../persistence/sqlite-store.js";

export const PLOT_STAGE_PREDICATE = "plot_stage";
export const PLOT_PROGRESS_PREDICATE = "plot_progress";
export const PLOT_ONGOING_CLAIM_ID = "claim-plot-ongoing";
export const PLOT_STAGE_FACT_PREFIX = "fact-plot-stage-";

const ids = {
  worldId: CLOSED_INN_WORLD_ID,
  playerId: "character-player",
  npcAId: "character-npc-a",
  npcBId: "character-npc-b",
  npcCId: "character-npc-c",
} as const;

export interface AuthoredPlotStep {
  fromStage: string;
  toStage: string;
  claimId: string;
  actorId: string;
  object: string;
  displayText: string;
}

/** Authored Closed Inn investigation. Never derived from the player line. */
export const CLOSED_INN_PLOT_STEPS: readonly AuthoredPlotStep[] = [
  {
    fromStage: "0",
    toStage: "1",
    claimId: "claim-plot-tick-1",
    actorId: ids.npcCId,
    object: "sun-searches-guestroom",
    displayText: "孙掌柜独自在客房翻找匕首传闻来源，没有理会大厅里的旅客在做什么。",
  },
  {
    fromStage: "1",
    toStage: "2",
    claimId: "claim-plot-tick-2",
    actorId: ids.npcBId,
    object: "zhao-checks-ledgers",
    displayText: "赵先生独自核对旧账追查匕首，调查与旅客当下的日常行动无关。",
  },
  {
    fromStage: "2",
    toStage: "3",
    claimId: "claim-plot-tick-3",
    actorId: ids.npcAId,
    object: "bao-checks-cellar-key",
    displayText: "阿宝按自己的目标核对地窖钥匙去向，客栈调查仍在推进。",
  },
];

export const PLOT_CLAIM_DISPLAY_TEXT: Readonly<Record<string, string>> = {
  [PLOT_ONGOING_CLAIM_ID]: "客栈正在追查失踪匕首。这条调查不会因为旅客吃饭、闲逛或闲聊而停止。",
  ...Object.fromEntries(CLOSED_INN_PLOT_STEPS.map((step) => [step.claimId, step.displayText])),
};

export interface WorldTickResult {
  stage: string;
  claimId: string | null;
  events: CommittedEvent[];
  independentOfPlayerLine: true;
}

export function currentPlotStage(snapshot: WorldSnapshot, atTime = snapshot.world.currentTime): string | null {
  const open = snapshot.facts.filter((fact) =>
    fact.predicate === PLOT_STAGE_PREDICATE &&
    fact.subject === snapshot.world.id &&
    isFactOpenAt(fact, atTime),
  );
  const latest = open.sort((first, second) => first.id.localeCompare(second.id)).at(-1);
  return latest?.object ?? null;
}

export function publicPlotThreads(snapshot: WorldSnapshot): Array<{
  id: string;
  predicate: string;
  object: string;
  displayText: string;
}> {
  return snapshot.claims
    .filter((claim) => claim.predicate === PLOT_PROGRESS_PREDICATE || claim.id === PLOT_ONGOING_CLAIM_ID)
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((claim) => ({
      id: claim.id,
      predicate: claim.predicate,
      object: claim.object,
      displayText: PLOT_CLAIM_DISPLAY_TEXT[claim.id] ?? `${claim.predicate}:${claim.object}`,
    }));
}

export function tickClosedInnWorld(store: SqliteWorldStore, kernel: CommitKernel): WorldTickResult {
  const events: CommittedEvent[] = [];
  const afterTime = commitTimeAdvance(store, kernel, events);
  const snapshot = store.getSnapshot(ids.worldId);
  const fromStage = currentPlotStage(snapshot, afterTime) ?? "0";
  const step = CLOSED_INN_PLOT_STEPS.find((candidate) => candidate.fromStage === fromStage);
  if (!step) {
    return { stage: fromStage, claimId: null, events, independentOfPlayerLine: true };
  }
  if (snapshot.claims.some((claim) => claim.id === step.claimId)) {
    return { stage: fromStage, claimId: step.claimId, events, independentOfPlayerLine: true };
  }
  commitPlotClaim(store, kernel, step, afterTime, events);
  commitPlotStage(store, kernel, step.toStage, afterTime, events);
  return { stage: step.toStage, claimId: step.claimId, events, independentOfPlayerLine: true };
}

function commitTimeAdvance(
  store: SqliteWorldStore,
  kernel: CommitKernel,
  events: CommittedEvent[],
): string {
  const snapshot = store.getSnapshot(ids.worldId);
  const toTime = addMinutes(snapshot.world.currentTime, 10);
  events.push(requireCommitted(kernel.commit({
    type: "world.time_advance",
    worldId: ids.worldId,
    expectedWorldRevision: snapshot.world.revision,
    occurredAt: snapshot.world.currentTime,
    toTime,
    causeEventIds: [],
  }), "advance world time"));
  return toTime;
}

function commitPlotClaim(
  store: SqliteWorldStore,
  kernel: CommitKernel,
  step: AuthoredPlotStep,
  occurredAt: string,
  events: CommittedEvent[],
): void {
  const snapshot = store.getSnapshot(ids.worldId);
  events.push(requireCommitted(kernel.commit({
    type: "claim.record",
    worldId: ids.worldId,
    expectedWorldRevision: snapshot.world.revision,
    claimId: step.claimId,
    actorId: step.actorId,
    subject: ids.worldId,
    predicate: PLOT_PROGRESS_PREDICATE,
    object: step.object,
    occurredAt,
    causeEventIds: [],
  }), `record authored plot ${step.claimId}`));
}

function commitPlotStage(
  store: SqliteWorldStore,
  kernel: CommitKernel,
  toStage: string,
  validFrom: string,
  events: CommittedEvent[],
): void {
  const snapshot = store.getSnapshot(ids.worldId);
  events.push(requireCommitted(kernel.commit({
    type: "fact.assert",
    worldId: ids.worldId,
    expectedWorldRevision: snapshot.world.revision,
    factId: `${PLOT_STAGE_FACT_PREFIX}${toStage}`,
    subject: ids.worldId,
    predicate: PLOT_STAGE_PREDICATE,
    object: toStage,
    validFrom,
    occurredAt: validFrom,
    causeEventIds: [],
  }), `assert plot stage ${toStage}`));
}

function isFactOpenAt(fact: FactRecord, atTime: string): boolean {
  const at = Date.parse(atTime);
  if (Date.parse(fact.validFrom) > at) {
    return false;
  }
  return fact.validTo === null || Date.parse(fact.validTo) > at;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function requireCommitted(result: CommitResult, label: string): CommittedEvent {
  if (!result.ok) {
    throw new KernelError(result.error.code, `${label} failed: ${result.error.message}`, result.error.context);
  }
  return result.event;
}

export function isHiddenWorldFact(fact: FactRecord): boolean {
  return fact.predicate === "dagger_location";
}

export function isPlotClaim(claim: ClaimRecord): boolean {
  return claim.predicate === PLOT_PROGRESS_PREDICATE || claim.id === PLOT_ONGOING_CLAIM_ID;
}
