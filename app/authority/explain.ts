import type { WorldStore } from "../persist/store.js";
import type { EventRecord, Producer } from "./types.js";

export type ProvenanceQuery =
  | { layer: "fact"; id: string }
  | { layer: "claim"; id: string }
  | { layer: "knowledge"; characterId: string; claimId: string }
  | { layer: "memory"; id: string };

export interface Provenance {
  layer: ProvenanceQuery["layer"];
  via: "seed" | "event" | "character";
  seedId: string | null;
  eventId: string | null;
  sourceCharacterId: string | null;
  producer: Producer | "seed";
  events: EventRecord[];
}

export function explain(store: WorldStore, worldId: string, query: ProvenanceQuery): Provenance {
  const snapshot = store.snapshot(worldId);
  const byId = new Map(store.listEvents(worldId).map((event) => [event.id, event]));

  if (query.layer === "fact") {
    const fact = snapshot.facts.find((row) => row.id === query.id);
    if (!fact) {
      throw new Error(`FACT_NOT_FOUND:${query.id}`);
    }
    return fromPointers(byId, {
      layer: "fact",
      via: fact.sourceKind,
      seedId: fact.sourceSeedId,
      eventId: fact.sourceEventId,
      sourceCharacterId: null,
    });
  }

  if (query.layer === "claim") {
    const claim = snapshot.claims.find((row) => row.id === query.id);
    if (!claim) {
      throw new Error(`CLAIM_NOT_FOUND:${query.id}`);
    }
    return fromPointers(byId, {
      layer: "claim",
      via: claim.sourceKind,
      seedId: claim.sourceSeedId,
      eventId: claim.sourceEventId,
      sourceCharacterId: null,
    });
  }

  if (query.layer === "memory") {
    const memory = snapshot.memories.find((row) => row.id === query.id);
    if (!memory) {
      throw new Error(`MEMORY_NOT_FOUND:${query.id}`);
    }
    return fromPointers(byId, {
      layer: "memory",
      via: memory.sourceEventId ? "event" : "seed",
      seedId: null,
      eventId: memory.sourceEventId,
      sourceCharacterId: null,
    });
  }

  const knowledge = snapshot.knowledge.find(
    (row) => row.characterId === query.characterId && row.claimId === query.claimId,
  );
  if (!knowledge) {
    throw new Error(`KNOWLEDGE_NOT_FOUND:${query.characterId}/${query.claimId}`);
  }
  return fromPointers(byId, {
    layer: "knowledge",
    via: knowledge.sourceKind,
    seedId: knowledge.sourceSeedId,
    eventId: knowledge.sourceEventId,
    sourceCharacterId: knowledge.sourceCharacterId,
  });
}

function fromPointers(
  byId: Map<string, EventRecord>,
  input: {
    layer: Provenance["layer"];
    via: Provenance["via"];
    seedId: string | null;
    eventId: string | null;
    sourceCharacterId: string | null;
  },
): Provenance {
  const events = walkCauses(byId, input.eventId);
  const committed = input.eventId ? byId.get(input.eventId) : undefined;
  return {
    layer: input.layer,
    via: input.via,
    seedId: input.seedId,
    eventId: input.eventId,
    sourceCharacterId: input.sourceCharacterId,
    producer: committed?.producer ?? "seed",
    events,
  };
}

function walkCauses(byId: Map<string, EventRecord>, startId: string | null): EventRecord[] {
  if (!startId) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: EventRecord[] = [];
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const event = byId.get(id);
    if (!event) {
      continue;
    }
    ordered.push(event);
    for (const cause of [...event.causeEventIds].reverse()) {
      stack.push(cause);
    }
  }
  return ordered.sort((a, b) => a.seq - b.seq);
}
