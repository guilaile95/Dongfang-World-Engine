import type { ClaimRecord, KnowledgeRecord, MemoryRecord, WorldSnapshot } from "../authority/types.js";

export interface ObserverContext {
  observerId: string;
  worldName: string;
  time: string;
  publicRules: string[];
  location: { id: string; name: string };
  present: Array<{ id: string; name: string; kind: "player" | "npc" }>;
  knownClaims: Array<{
    claim: ClaimRecord;
    state: KnowledgeRecord["state"];
    sourceKind: KnowledgeRecord["sourceKind"];
  }>;
  memories: MemoryRecord[];
  ambient: string[];
}

/**
 * Visibility before anything else. Facts, other people's knowledge, and
 * unlearned claims do not enter the pack. Ambient is ephemeral colour, not Truth.
 */
export function contextFor(
  snapshot: WorldSnapshot,
  observerId: string,
  ambient: string[] = [],
): ObserverContext {
  const observer = snapshot.characters.find((row) => row.id === observerId);
  if (!observer) {
    throw new Error(`OBSERVER_NOT_FOUND:${observerId}`);
  }
  const location = snapshot.locations.find((row) => row.id === observer.locationId);
  if (!location) {
    throw new Error(`LOCATION_NOT_FOUND:${observer.locationId}`);
  }
  const known = snapshot.knowledge.filter((row) => row.characterId === observerId);
  const knownClaimIds = new Set(known.map((row) => row.claimId));
  return {
    observerId,
    worldName: snapshot.world.name,
    time: snapshot.world.time,
    publicRules: snapshot.world.rules,
    location: { id: location.id, name: location.name },
    present: snapshot.characters
      .filter((row) => row.locationId === observer.locationId)
      .map((row) => ({ id: row.id, name: row.name, kind: row.kind })),
    knownClaims: known.flatMap((row) => {
      const claim = snapshot.claims.find((item) => item.id === row.claimId);
      if (!claim || !knownClaimIds.has(claim.id)) {
        return [];
      }
      return [{ claim, state: row.state, sourceKind: row.sourceKind }];
    }),
    memories: snapshot.memories.filter((row) => row.characterId === observerId),
    ambient,
  };
}

export function packObserverContext(context: ObserverContext): string {
  const present = context.present.map((row) => row.name).join("、");
  const claims = context.knownClaims
    .map((row) => `${row.claim.subject} ${row.claim.predicate} ${row.claim.object} (${row.state})`)
    .join("；") || "（无）";
  const memories = context.memories.map((row) => row.text).join("；") || "（无）";
  const ambient = context.ambient.join(" ") || "（无）";
  return [
    `世界：${context.worldName}`,
    `时间：${context.time}`,
    `地点：${context.location.name}`,
    `在场：${present}`,
    `公开规则：${context.publicRules.join("；")}`,
    `你所知的说法：${claims}`,
    `你的印象：${memories}`,
    `当下可见：${ambient}`,
  ].join("\n");
}
