import type { Session } from "../session.js";

/** Player-visible world slice. Never a snapshot, never engine IDs. */
export interface PlayerState {
  worldTitle: string;
  worldName: string;
  characterName: string;
  time: string;
  locationName: string;
  carried: string[];
  nearby: string[];
}

export interface ChatMessage {
  role: "player" | "world" | "notice";
  text: string;
  parsed: boolean;
}

export interface WorldOption {
  id: string;
  title: string;
  description: string;
  sourcePath: string;
  savePath: string;
}

export function playerState(session: Session): PlayerState {
  const compiled = session.compiled;
  const snap = session.store.snapshot(compiled.seed.world.id);
  const player = snap.characters.find((row) => row.id === compiled.playerId);
  const location = snap.locations.find((row) => row.id === player?.locationId);
  return {
    worldTitle: compiled.packageTitle,
    worldName: snap.world.name,
    characterName: player?.name ?? "",
    time: snap.world.time,
    locationName: location?.name ?? "",
    carried: snap.items.filter((row) => row.carrierId === compiled.playerId).map((row) => row.name),
    nearby: snap.characters
      .filter((row) => row.id !== compiled.playerId && row.locationId === player?.locationId)
      .map((row) => row.name),
  };
}

export function chatHistory(session: Session): ChatMessage[] {
  return session.store.listUiMessages(session.compiled.seed.world.id);
}
