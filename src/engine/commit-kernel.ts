import { randomUUID } from "node:crypto";
import { events } from "../persistence/schema.js";
import { findEvent, SqliteWorldStore } from "../persistence/sqlite-store.js";
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
        const committedEvent = buildEvent(candidate, eventId, normalizeTime(this.clock()));
        tx.insert(events)
          .values({
            id: committedEvent.id,
            worldId: committedEvent.worldId,
            eventTime: committedEvent.eventTime,
            type: committedEvent.type,
            locationId: committedEvent.locationId,
            actorIds: JSON.stringify(committedEvent.actorIds),
            targetIds: JSON.stringify(committedEvent.targetIds),
            causeEventIds: JSON.stringify(committedEvent.causeEventIds),
            payload: JSON.stringify(committedEvent.payload),
            createdAt: committedEvent.createdAt,
          })
          .run();
        this.faultInjector?.("after_event_append");
        projectEvent(tx, committedEvent);
        this.faultInjector?.("after_projection");
        return committedEvent;
      });
      return { ok: true, event, state: this.store.getSnapshot(candidate.worldId) };
    } catch (error) {
      return { ok: false, error: asKernelError(error) };
    }
  }
}

function buildEvent(candidate: CandidateEvent, id: string, createdAt: string): CommittedEvent {
  const eventTime = normalizeTime(candidate.type === "world.time_advance" ? candidate.toTime : candidate.occurredAt);
  switch (candidate.type) {
    case "character.move":
      return makeEvent(candidate, id, createdAt, eventTime, [candidate.actorId], [], {
        actorId: candidate.actorId,
        toLocationId: candidate.toLocationId,
      });
    case "character.die":
      return makeEvent(candidate, id, createdAt, eventTime, [candidate.actorId], [], {
        actorId: candidate.actorId,
      });
    case "character.learn_fact":
      return makeEvent(candidate, id, createdAt, eventTime, [candidate.actorId], [candidate.factId], {
        actorId: candidate.actorId,
        factId: candidate.factId,
        knowledgeState: candidate.knowledgeState,
        source: candidate.source ?? null,
      });
    case "relationship.change":
      return makeEvent(
        candidate,
        id,
        createdAt,
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
      return makeEvent(candidate, id, createdAt, eventTime, candidate.actorId ? [candidate.actorId] : [], [candidate.factId], {
        factId: candidate.factId,
        actorId: candidate.actorId ?? null,
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        validFrom: normalizeTime(candidate.validFrom),
        validTo: candidate.validTo ? normalizeTime(candidate.validTo) : null,
      });
    case "world.time_advance":
      return makeEvent(candidate, id, createdAt, eventTime, [], [], { toTime: eventTime });
  }
}

function makeEvent(
  candidate: CandidateEvent,
  id: string,
  createdAt: string,
  eventTime: string,
  actorIds: string[],
  targetIds: string[],
  payload: Record<string, unknown>,
): CommittedEvent {
  return {
    id,
    worldId: candidate.worldId,
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
