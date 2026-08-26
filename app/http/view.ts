import type { Session } from "../session.js";
import { playerTimeLabel } from "../scene/time.js";

export interface ActionSuggestion {
  key: "A" | "B" | "C" | "D" | "E" | "F";
  label: string;
  type: "constructive" | "extreme" | "absurd";
}

/** Player-visible world slice. Never a snapshot, never engine IDs. */
export interface PlayerState {
  worldTitle: string;
  worldName: string;
  characterName: string;
  time: string;
  locationName: string;
  carried: string[];
  nearby: string[];
  era?: string;
  timeLabel?: string;
  publicPremise?: string;
  currentSituation?: string | null;
  suggestions?: ActionSuggestion[];
  terminalReason?: import("../session.js").TerminalReason;
  autoSteps?: number;
  elapsedMinutes?: number;
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
  era?: string;
  timeLabel?: string;
  publicPremise?: string;
}

export function playerState(
  session: Session,
  extra?: {
    currentSituation?: string | null;
    suggestions?: ActionSuggestion[];
    terminalReason?: import("../session.js").TerminalReason;
    autoSteps?: number;
    elapsedMinutes?: number;
  },
): PlayerState {
  const compiled = session.compiled;
  const snap = session.store.snapshot(compiled.seed.world.id);
  const player = snap.characters.find((row) => row.id === compiled.playerId);
  const location = snap.locations.find((row) => row.id === player?.locationId);
  const persistentSituation = session.store.getPlayerSituation(compiled.seed.world.id, compiled.playerId);
  const activeSituation = extra?.currentSituation !== undefined ? extra.currentSituation : persistentSituation;
  return {
    worldTitle: compiled.packageTitle,
    worldName: snap.world.name,
    characterName: player?.name ?? "",
    time: playerTimeLabel(snap.world.time, snap.world.time),
    locationName: location?.name ?? "",
    carried: snap.items.filter((row) => row.carrierId === compiled.playerId).map((row) => row.name),
    nearby: snap.characters
      .filter((row) => row.id !== compiled.playerId && row.locationId === player?.locationId)
      .map((row) => row.name),
    era: compiled.chronology?.era,
    timeLabel: playerTimeLabel(snap.world.time, compiled.chronology?.timeLabel),
    publicPremise: compiled.chronology?.publicPremise,
    currentSituation: activeSituation ?? null,
    ...(extra?.suggestions ? { suggestions: extra.suggestions } : {}),
    ...(extra?.terminalReason !== undefined ? { terminalReason: extra.terminalReason } : {}),
    ...(extra?.autoSteps !== undefined ? { autoSteps: extra.autoSteps } : {}),
    ...(extra?.elapsedMinutes !== undefined ? { elapsedMinutes: extra.elapsedMinutes } : {}),
  };
}

export function chatHistory(session: Session): ChatMessage[] {
  return session.store.listUiMessages(session.compiled.seed.world.id);
}
