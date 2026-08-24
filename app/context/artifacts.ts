import { randomUUID } from "node:crypto";
import type { WorldStore } from "../persist/store.js";
import { packObserverContext } from "../visibility/context.js";
import { visibilityGate } from "../visibility/gate.js";
import { observerNamespace } from "../visibility/pool.js";

/** Summaries are rebuildable artifacts. They are not Fact / Knowledge / Event authority. */
export function writeSummary(
  store: WorldStore,
  worldId: string,
  observerId: string,
  title: string,
  body: string,
): void {
  store.insertContextItem({
    id: `sum-${randomUUID()}`,
    worldId,
    namespace: observerNamespace(observerId),
    kind: "summary",
    title,
    body,
  });
}

export function recordScene(
  store: WorldStore,
  worldId: string,
  observerId: string,
  text: string,
): void {
  store.insertContextItem({
    id: `scene-${randomUUID()}`,
    worldId,
    namespace: observerNamespace(observerId),
    kind: "scene",
    title: "scene",
    body: text.slice(0, 2000),
  });
}

export function rebuildObserverArtifacts(store: WorldStore, worldId: string, observerId: string): void {
  const ns = observerNamespace(observerId);
  store.deleteContextKind(worldId, ns, "summary");
  const pool = visibilityGate(store.snapshot(worldId), observerId);
  store.insertContextItem({
    id: `sum-${randomUUID()}`,
    worldId,
    namespace: ns,
    kind: "summary",
    title: "rebuilt",
    body: packObserverContext(pool),
  });
}

export function wipeContextArtifacts(store: WorldStore, worldId: string): void {
  store.deleteAllContext(worldId);
}
