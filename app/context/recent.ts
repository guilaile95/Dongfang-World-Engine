import { randomUUID } from "node:crypto";
import type { WorldStore } from "../persist/store.js";
import { observerNamespace } from "../visibility/pool.js";

export const RECENT_WINDOW = 3;

export interface ResolvedScene {
  playerLine: string;
  addresseeId: string | null;
  addresseeName: string | null;
  npcReply: string | null;
}

/** Bounded 1–3 resolved scenes. Non-authoritative. Cannot write Truth. */
export function recordResolvedScene(
  store: WorldStore,
  worldId: string,
  observerId: string,
  scene: ResolvedScene,
  asSpeaker: "player" | "npc",
): void {
  const ns = observerNamespace(observerId);
  const body = compactScene(scene, asSpeaker);
  const title = scene.addresseeId ? `npc:${scene.addresseeId}` : "solo";
  store.insertContextItem({
    id: `scene-${randomUUID()}`,
    worldId,
    namespace: ns,
    kind: "scene",
    title,
    body,
    seq: 0,
  });
  store.pruneContextKind(worldId, ns, "scene", RECENT_WINDOW);
}

export function recordOpeningScene(
  store: WorldStore,
  worldId: string,
  observerId: string,
  openingNarrative: string,
): void {
  const ns = observerNamespace(observerId);
  const body = `开幕经历：${trimBody(openingNarrative)}`;
  store.insertContextItem({
    id: `scene-opening-${randomUUID()}`,
    worldId,
    namespace: ns,
    kind: "scene",
    title: "opening",
    body,
    seq: 0,
  });
  store.pruneContextKind(worldId, ns, "scene", RECENT_WINDOW);
}

export function recentSceneBodies(store: WorldStore, worldId: string, observerId: string): string[] {
  return store.listRecentScenes(worldId, observerNamespace(observerId), RECENT_WINDOW).map((row) => row.body);
}

export function lastAddresseeId(store: WorldStore, worldId: string, observerId: string): string | null {
  const rows = store.listRecentScenes(worldId, observerNamespace(observerId), RECENT_WINDOW);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const title = rows[i]?.title ?? "";
    if (title.startsWith("npc:")) {
      return title.slice(4);
    }
  }
  return null;
}

function compactScene(scene: ResolvedScene, asSpeaker: "player" | "npc"): string {
  if (asSpeaker === "npc" && scene.addresseeName) {
    const reply = scene.npcReply ? `\n你：「${trimBody(scene.npcReply)}」` : "";
    return `对方：${trimBody(scene.playerLine)}${reply}`;
  }
  const reply = scene.npcReply && scene.addresseeName
    ? `\n${scene.addresseeName}：「${trimBody(scene.npcReply)}」`
    : "";
  return `你：${trimBody(scene.playerLine)}${reply}`;
}

function trimBody(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 400 ? `${one.slice(0, 400)}…` : one;
}
