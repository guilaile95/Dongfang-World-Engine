import type { LegalPool } from "./pool.js";

export interface RankedSlice {
  namespace: string;
  observerId: string;
  worldName: string;
  time: string;
  publicRules: string[];
  location: LegalPool["location"];
  present: LegalPool["present"];
  ambient: string[];
  claims: Array<LegalPool["knownClaims"][number] & { score: number }>;
  memories: Array<LegalPool["memories"][number] & { score: number }>;
}

/**
 * Rank and optionally drop items *inside* one observer namespace.
 * Never accepts a WorldSnapshot: full-world index then filter is rejected.
 * A low score may omit legal items. It cannot introduce illegal ones.
 */
export function rankWithinPool(pool: LegalPool, query: string): RankedSlice {
  const claims = pool.knownClaims
    .map((row) => ({
      ...row,
      score: scoreText(`${row.claim.subject} ${row.claim.predicate} ${row.claim.object}`, query),
    }))
    .sort(byScore);
  const memories = pool.memories
    .map((row) => ({
      ...row,
      score: scoreText(row.text, query),
    }))
    .sort(byScore);
  return {
    namespace: pool.namespace,
    observerId: pool.observerId,
    worldName: pool.worldName,
    time: pool.time,
    publicRules: pool.publicRules,
    location: pool.location,
    present: pool.present,
    ambient: pool.ambient,
    claims,
    memories,
  };
}

/** Keyword search confined to the legal pool. Empty query returns the whole pool. */
export function searchWithinPool(pool: LegalPool, query: string): RankedSlice {
  const ranked = rankWithinPool(pool, query);
  if (!query.trim()) {
    return ranked;
  }
  return {
    ...ranked,
    claims: ranked.claims.filter((row) => row.score > 0),
    memories: ranked.memories.filter((row) => row.score > 0),
  };
}

function scoreText(text: string, query: string): number {
  if (!query.trim()) {
    return 1;
  }
  const needles = tokens(query);
  if (needles.length === 0) {
    return 1;
  }
  const hay = new Set(tokens(text));
  let hit = 0;
  for (const word of needles) {
    if (hay.has(word)) {
      hit += 1;
    }
  }
  return hit;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((word) => word.length > 0);
}

function byScore<T extends { score: number }>(a: T, b: T): number {
  return b.score - a.score;
}
