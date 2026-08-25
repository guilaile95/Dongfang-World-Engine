import type { KnowledgeRecord, KnowledgeState, MemoryRecord } from "../authority/types.js";

export interface LegalClaim {
  claim: {
    id: string;
    subject: string;
    predicate: string;
    object: string;
  };
  state: KnowledgeState;
  sourceKind: KnowledgeRecord["sourceKind"];
}

/** Post-gate pool. Retrieval may only search this namespace, never the raw world. */
export interface LegalPool {
  namespace: string;
  observerId: string;
  worldName: string;
  time: string;
  publicRules: string[];
  location: { id: string; name: string };
  present: Array<{ id: string; name: string; kind: "player" | "npc" }>;
  visibleItems: Array<{ id: string; name: string; carriedBy: string | null }>;
  knownClaims: LegalClaim[];
  memories: MemoryRecord[];
  ambient: string[];
}

export type ObserverContext = Omit<LegalPool, "namespace">;

export function observerNamespace(observerId: string): string {
  return `char:${observerId}`;
}

export function toObserverContext(pool: LegalPool): ObserverContext {
  return {
    observerId: pool.observerId,
    worldName: pool.worldName,
    time: pool.time,
    publicRules: pool.publicRules,
    location: pool.location,
    present: pool.present,
    visibleItems: pool.visibleItems,
    knownClaims: pool.knownClaims,
    memories: pool.memories,
    ambient: pool.ambient,
  };
}
