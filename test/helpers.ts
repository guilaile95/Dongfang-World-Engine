import { WorldStore } from "../app/persist/store.js";
import { seedWorld, WORLD_ID } from "../app/world/seed.js";

export function memoryWorld(): WorldStore {
  const store = new WorldStore(":memory:");
  seedWorld(store);
  return store;
}

export function worldRevision(store: WorldStore): number {
  return store.snapshot(WORLD_ID).world.revision;
}
