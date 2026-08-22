import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { events, worlds } from "../persistence/schema.js";
import { findEvent, findWorld, SqliteWorldStore, toEvent } from "../persistence/sqlite-store.js";
import type { CommittedEvent } from "../domain/types.js";
import { parseCandidate, normalizeTime, type CandidateEvent } from "./candidate.js";
import { asKernelError, KernelError } from "./errors.js";
import { projectEvent } from "./projector.js";
import { validateCandidate } from "./validator.js";

export interface CommitKernelOptions {
  clock?: () => string;
  idFactory?: () => string;
  faultInjector?: (stage: "after_event_append" | "after_projection") => void;
}

export type CommitResult =
  | { ok: true; event: CommittedEvent; state: ReturnType<SqliteWorldStore["getSnapshot"]> }
  | { ok: false; error: KernelError };

export class CommitKernel {
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly faultInjector?: CommitKernelOptions["faultInjector"];

  public constructor(
    private readonly store: SqliteWorldStore,
    options: CommitKernelOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.faultInjector = options.faultInjector;
  }

  public commit(input: unknown): CommitResult {
    let candidate: CandidateEvent;
    try {
      candidate = parseCandidate(input);
    } catch (error) {
      return { ok: false, error: asKernelError(error) };
    }

    const eventId = this.idFactory();
    try {
      const event = this.store.transaction((tx) => {
        if (findEvent(tx, eventId)) {
          throw new KernelError("EVENT_ALREADY_COMMITTED", "Event id has already been committed", { eventId });
        }
        validateCandidate(tx, candidate);
        const world = findWorld(tx, candidate.worldId);
        if (!world) {
          throw new KernelError("WORLD_NOT_FOUND", "World does not exist", { worldId: candidate.worldId });
        }
        const pendingEvent = buildEvent(candidate, eventId, normalizeTime(this.clock()), world.revision + 1);
        tx.insert(events)
          .values({
            worldId: pendingEvent.worldId,
            worldRevision: pendingEvent.worldRevision,
            id: pendingEvent.id,
            eventTime: pendingEvent.eventTime,
            type: pendingEvent.type,
            locationId: pendingEvent.locationId,
            actorIds: JSON.stringify(pendingEvent.actorIds),
            targetIds: JSON.stringify(pendingEvent.targetIds),
            causeEventIds: JSON.stringify(pendingEvent.causeEventIds),
            payload: JSON.stringify(pendingEvent.payload),
            createdAt: pendingEvent.createdAt,
          })
          .run();
        this.faultInjector?.("after_event_append");
        const storedRow = findEvent(tx, eventId);
        if (!storedRow) {
          throw new KernelError("COMMIT_FAILED", "Committed Event could not be read after append", { eventId });
        }
        const committedEvent = toEvent(storedRow);
        projectEvent(tx, committedEvent);
        tx.update(worlds)
          .set({ revision: committedEvent.worldRevision })
          .where(eq(worlds.id, committedEvent.worldId))
          .run();
        this.faultInjector?.("after_projection");
        return committedEvent;
      });
      return { ok: true, event, state: this.store.getSnapshot(candidate.worldId) };
    } catch (error) {
      return { ok: false, error: asKernelError(error) };
    }
  }
}

function buildEvent(candidate: CandidateEvent, id: string, createdAt: string, worldRevision: number): CommittedEvent {
  const eventTime = normalizeTime(candidate.type === "world.time_advance" ? candidate.toTime : candidate.occurredAt);
  switch (candidate.type) {
    case "character.move":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, [candidate.actorId], [], {
        actorId: candidate.actorId,
        toLocationId: candidate.toLocationId,
      });
    case "character.die":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, [candidate.actorId], [], {
        actorId: candidate.actorId,
      });
    case "character.learn_claim":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, [candidate.actorId], [candidate.claimId], {
        actorId: candidate.actorId,
        claimId: candidate.claimId,
        knowledgeState: candidate.knowledgeState,
        source: candidate.source ?? null,
      });
    case "relationship.change":
      return makeEvent(
        candidate,
        id,
        createdAt,
        worldRevision,
        eventTime,
        [candidate.sourceCharacterId],
        [candidate.targetCharacterId],
        {
          sourceCharacterId: candidate.sourceCharacterId,
          targetCharacterId: candidate.targetCharacterId,
          trustDelta: candidate.trustDelta ?? 0,
          hostilityDelta: candidate.hostilityDelta ?? 0,
          closenessDelta: candidate.closenessDelta ?? 0,
          relationshipType: candidate.relationshipType,
        },
      );
    case "fact.assert":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, candidate.actorId ? [candidate.actorId] : [], [candidate.factId], {
        factId: candidate.factId,
        actorId: candidate.actorId ?? null,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        validFrom: normalizeTime(candidate.validFrom),
        validTo: candidate.validTo ? normalizeTime(candidate.validTo) : null,
      });
    case "claim.record":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, candidate.actorId ? [candidate.actorId] : [], [candidate.claimId], {
        claimId: candidate.claimId,
        actorId: candidate.actorId ?? null,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
      });
    case "claim.transmit":
      return makeEvent(
        candidate,
        id,
        createdAt,
        worldRevision,
        eventTime,
        [candidate.sourceCharacterId],
        [candidate.targetCharacterId],
        {
          sourceCharacterId: candidate.sourceCharacterId,
          targetCharacterId: candidate.targetCharacterId,
          claimId: candidate.claimId,
        },
      );
    case "world.time_advance":
      return makeEvent(candidate, id, createdAt, worldRevision, eventTime, [], [], { toTime: eventTime });
  }
}

function makeEvent(
  candidate: CandidateEvent,
  id: string,
  createdAt: string,
  worldRevision: number,
  eventTime: string,
  actorIds: string[],
  targetIds: string[],
  payload: Record<string, unknown>,
): CommittedEvent {
  return {
    id,
    sequence: 0,
    worldId: candidate.worldId,
    worldRevision,
    eventTime,
    type: candidate.type,
    locationId: null,
    actorIds,
    targetIds,
    causeEventIds: candidate.causeEventIds,
    payload,
    createdAt,
  };
}
