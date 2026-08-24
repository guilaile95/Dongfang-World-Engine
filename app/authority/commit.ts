import { candidateSchema, parseLlmCandidate, type Candidate } from "./candidate.js";
import { authorize } from "./authorize.js";
import { applyCandidateToSnapshot, newEventId, projectToStore } from "./project.js";
import type { EventRecord, Producer, WorldSnapshot } from "./types.js";
import type { WorldStore } from "../persist/store.js";

export type SubmitResult =
  | { accepted: true; events: EventRecord[]; snapshot: WorldSnapshot; reasons: [] }
  | { accepted: false; events: []; snapshot: WorldSnapshot; reasons: string[] };

export function submitCandidates(
  store: WorldStore,
  input: {
    producer: Producer;
    candidates: Candidate[];
    causeEventIds?: string[];
  },
): SubmitResult {
  const worldId = input.candidates[0]?.worldId;
  if (!worldId) {
    throw new Error("submitCandidates requires a world");
  }
  const original = store.snapshot(worldId);
  if (input.candidates.length === 0) {
    return { accepted: true, events: [], snapshot: original, reasons: [] };
  }

  const knownEventIds = new Set(store.listEvents(worldId).map((event) => event.id));
  let working = original;
  const planned: Array<{ candidate: Candidate; eventId: string; at: string; causeEventIds: string[] }> = [];
  const causeEventIds = [...(input.causeEventIds ?? [])];

  for (const candidate of input.candidates) {
    const parsed = candidateSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        accepted: false,
        events: [],
        snapshot: original,
        reasons: parsed.error.issues.map((issue) => issue.message),
      };
    }
    const decision = authorize(working, input.producer, parsed.data, knownEventIds);
    if (!decision.ok) {
      return { accepted: false, events: [], snapshot: original, reasons: decision.reasons };
    }
    const eventId = newEventId();
    knownEventIds.add(eventId);
    const causes = [...causeEventIds];
    if (parsed.data.type === "character_learn_claim" && parsed.data.source.kind === "event") {
      if (!causes.includes(parsed.data.source.eventId)) {
        causes.push(parsed.data.source.eventId);
      }
    }
    planned.push({
      candidate: parsed.data,
      eventId,
      at: working.world.time,
      causeEventIds: causes,
    });
    causeEventIds.push(eventId);
    working = applyCandidateToSnapshot(working, parsed.data, eventId);
  }

  const events = store.transaction(() => {
    const written: EventRecord[] = [];
    let time = original.world.time;
    let revision = original.world.revision;
    for (const item of planned) {
      const event = store.insertEvent({
        id: item.eventId,
        worldId: item.candidate.worldId,
        type: item.candidate.type,
        producer: input.producer,
        at: item.at,
        payload: item.candidate,
        causeEventIds: item.causeEventIds,
      });
      if (item.candidate.type === "time_advance") {
        time = item.candidate.toTime;
      }
      revision += 1;
      store.updateWorld(item.candidate.worldId, { time, revision });
      projectToStore(store, event, item.candidate);
      written.push(event);
    }
    return written;
  });

  return { accepted: true, events, snapshot: store.snapshot(worldId), reasons: [] };
}

/** Schema-valid LLM JSON still has to pass authorize + transaction. Never writes on reject. */
export function submitLlmProposal(store: WorldStore, worldId: string, input: unknown): SubmitResult {
  const snapshot = store.snapshot(worldId);
  const parsed = parseLlmCandidate(input);
  if (!parsed.schemaValid || !parsed.candidate) {
    return { accepted: false, events: [], snapshot, reasons: parsed.issues };
  }
  return submitCandidates(store, { producer: "llm", candidates: [parsed.candidate] });
}

export function submitEmptyProposal(store: WorldStore, worldId: string): SubmitResult {
  return { accepted: true, events: [], snapshot: store.snapshot(worldId), reasons: [] };
}
