import { WorldStore } from "../persist/store.js";
import { replayEvents } from "./project.js";
import type { EventRecord } from "./types.js";

export type SeedWorld = Parameters<WorldStore["insertSeedWorld"]>[0];

/** Rebuild materialized state from authored seed plus the append-only event log. */
export function rebuildWorld(seed: SeedWorld, events: EventRecord[]): WorldStore {
  const store = new WorldStore(":memory:");
  store.insertSeedWorld(seed);
  replayEvents(store, events);
  return store;
}
