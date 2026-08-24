import type { WorldSnapshot } from "../authority/types.js";
import { observerNamespace, type LegalPool } from "./pool.js";

/**
 * Deterministic Visibility Gate. The only function allowed to read the full
 * world. Output is the legal pool for one observer. Facts, events, other
 * characters' knowledge, and unlearned claims do not pass.
 */
export function visibilityGate(
  snapshot: WorldSnapshot,
  observerId: string,
  ambient: string[] = [],
): LegalPool {
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
  const knownClaims = known.flatMap((row) => {
    const claim = snapshot.claims.find((item) => item.id === row.claimId);
    if (!claim || !knownClaimIds.has(claim.id)) {
      return [];
    }
    return [
      {
        claim: {
          id: claim.id,
          subject: claim.subject,
          predicate: claim.predicate,
          object: claim.object,
        },
        state: row.state,
        sourceKind: row.sourceKind,
      },
    ];
  });
  const memories = snapshot.memories.filter((row) => row.characterId === observerId);
  return {
    namespace: observerNamespace(observerId),
    observerId,
    worldName: snapshot.world.name,
    time: snapshot.world.time,
    publicRules: snapshot.world.rules,
    location: { id: location.id, name: location.name },
    present: snapshot.characters
      .filter((row) => row.locationId === observer.locationId)
      .map((row) => ({ id: row.id, name: row.name, kind: row.kind })),
    knownClaims,
    memories,
    ambient: sanitizeAmbient(snapshot, observerId, knownClaimIds, ambient),
  };
}

function sanitizeAmbient(
  snapshot: WorldSnapshot,
  observerId: string,
  knownClaimIds: ReadonlySet<string>,
  ambient: string[],
): string[] {
  const forbidden = forbiddenSubstrings(snapshot, observerId, knownClaimIds);
  return ambient.filter((line) => !forbidden.some((token) => line.includes(token)));
}

function forbiddenSubstrings(
  snapshot: WorldSnapshot,
  observerId: string,
  knownClaimIds: ReadonlySet<string>,
): string[] {
  const tokens: string[] = [];
  for (const claim of snapshot.claims) {
    if (!knownClaimIds.has(claim.id)) {
      tokens.push(claim.id);
      tokens.push(`${claim.subject} ${claim.predicate} ${claim.object}`);
    }
  }
  for (const fact of snapshot.facts) {
    tokens.push(fact.id);
  }
  for (const memory of snapshot.memories) {
    if (memory.characterId !== observerId && memory.text.length > 0) {
      tokens.push(memory.text);
    }
  }
  return tokens;
}
