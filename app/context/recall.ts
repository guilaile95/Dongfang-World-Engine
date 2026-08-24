import type { ContextItemRecord, WorldStore } from "../persist/store.js";
import { observerNamespace } from "../visibility/pool.js";
import { PUBLIC_NS } from "./ingest.js";

export interface RecallHit extends ContextItemRecord {
  score: number;
}

/**
 * Search only the observer's namespace plus public lore.
 * Full-world index then filter is not provided.
 */
export function observerNamespaces(observerId: string): string[] {
  return [PUBLIC_NS, observerNamespace(observerId)];
}

export function recall(
  store: WorldStore,
  worldId: string,
  observerId: string,
  query: string,
  limit = 6,
): RecallHit[] {
  const items = store.listContextItems(worldId, observerNamespaces(observerId));
  const ranked = items
    .map((item) => ({ ...item, score: scoreText(`${item.title} ${item.body}`, query) }))
    .filter((item) => (query.trim() ? item.score > 0 : true))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

function scoreText(text: string, query: string): number {
  const hay = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) {
    return 1;
  }
  let hit = 0;
  if (hay.includes(q)) {
    hit += 2;
  }
  for (const word of tokens(q)) {
    if (word.length > 0 && hay.includes(word)) {
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
