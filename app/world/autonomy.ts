import type { CharacterRecord, MemoryRecord, WorldSnapshot } from "../authority/types.js";
import type { CompiledWorld } from "./compile.js";

/**
 * Multi-resolution world autonomy. Not an always-on NPC scheduler.
 * WorldX / AI Town / Emergence are pattern references only.
 */
export const SIMULATION_RESOLUTIONS = ["high", "medium", "macro", "dormant"] as const;
export type SimulationResolution = (typeof SIMULATION_RESOLUTIONS)[number];

/** There is no per-NPC wall-clock pulse. */
export const NPC_ALWAYS_ON_INTERVAL_MS: null = null;

export interface AutonomyBudget {
  maxHighCharacters: number;
  maxMediumCharacters: number;
  maxMacroAggregates: number;
  maxLlmCalls: number;
  maxTokens: number;
  minBeatsBetweenMedium: number;
  minBeatsBetweenMacro: number;
}

export const DEFAULT_AUTONOMY_BUDGET: AutonomyBudget = {
  maxHighCharacters: 8,
  maxMediumCharacters: 2,
  maxMacroAggregates: 1,
  maxLlmCalls: 0,
  maxTokens: 0,
  minBeatsBetweenMedium: 3,
  minBeatsBetweenMacro: 8,
};

export interface AutonomyEvidence {
  protocol: string;
  /** True only when real play made “world stops without the player” perceptible. */
  worldStopsWithoutPlayer: boolean;
  provenBy: string;
}

/**
 * Experiment-1: player was present every turn. The world did not “stop while idle”;
 * scene-interpretation transport failed. Not a trigger for background evolution.
 */
export const EXPERIMENT_1_AUTONOMY: AutonomyEvidence = {
  protocol: "experiment-1-product-play",
  worldStopsWithoutPlayer: false,
  provenBy: "experiment-1",
};

export interface AutonomyDeferral {
  characterId?: string;
  locationId?: string;
  from: SimulationResolution | "llm";
  to: SimulationResolution | "shortcut" | "skip";
  reason: "budget" | "inertia" | "damping" | "dormant" | "gate" | "frequency";
}

export interface AutonomyPlan {
  byCharacter: Record<string, SimulationResolution>;
  macroLocations: string[];
  dormantCount: number;
  timeAdvance: boolean;
  themeMemory: { characterId: string; text: string } | null;
  publicBeat: string;
  llmCalls: number;
  tokensReserved: number;
  shortcut: "deterministic";
  deferred: AutonomyDeferral[];
}

export function backgroundWorldEvolutionEnabled(
  evidence: AutonomyEvidence | null | undefined,
): boolean {
  if (!evidence) {
    return false;
  }
  return evidence.worldStopsWithoutPlayer === true && evidence.provenBy.trim().length > 0;
}

/** Idle wall-clock or copying WorldX/AI Town schedulers is not evidence. */
export function enableBackgroundEvolutionBecause(reason: {
  idleWallClock?: boolean;
  copyWorldXScheduler?: boolean;
  copyAiTownScheduler?: boolean;
  evidence?: AutonomyEvidence | null;
}): boolean {
  if (reason.idleWallClock || reason.copyWorldXScheduler || reason.copyAiTownScheduler) {
    return false;
  }
  return backgroundWorldEvolutionEnabled(reason.evidence);
}

export function planTurnAutonomy(
  snapshot: WorldSnapshot,
  compiled: CompiledWorld,
  budget: AutonomyBudget = DEFAULT_AUTONOMY_BUDGET,
  evidence: AutonomyEvidence | null = EXPERIMENT_1_AUTONOMY,
): AutonomyPlan {
  const player = snapshot.characters.find((row) => row.id === compiled.playerId);
  const themeId = compiled.theme.characterId;
  const deferred: AutonomyDeferral[] = [];
  const byCharacter: Record<string, SimulationResolution> = {};
  const npcs = snapshot.characters.filter((row) => row.kind === "npc");

  if (player) {
    byCharacter[player.id] = "high";
  }

  const sceneNpcs = npcs
    .filter((row) => player && row.locationId === player.locationId)
    .sort((a, b) => preferTheme(a, b, themeId));
  let highSlots = 0;
  for (const npc of sceneNpcs) {
    if (highSlots < budget.maxHighCharacters) {
      byCharacter[npc.id] = "high";
      highSlots += 1;
    } else {
      byCharacter[npc.id] = "dormant";
      deferred.push({
        characterId: npc.id,
        from: "high",
        to: "dormant",
        reason: "budget",
      });
    }
  }

  let mediumSlots = 0;
  const macroLocations: string[] = [];
  for (const npc of npcs) {
    if (byCharacter[npc.id]) {
      continue;
    }
    const offScreenTheme = npc.id === themeId;
    if (offScreenTheme && mediumSlots < budget.maxMediumCharacters) {
      byCharacter[npc.id] = "medium";
      mediumSlots += 1;
      continue;
    }
    if (
      player &&
      npc.locationId !== player.locationId &&
      !macroLocations.includes(npc.locationId) &&
      macroLocations.length < budget.maxMacroAggregates
    ) {
      macroLocations.push(npc.locationId);
    }
    byCharacter[npc.id] = "dormant";
    deferred.push({
      characterId: npc.id,
      locationId: npc.locationId,
      from: offScreenTheme ? "medium" : "macro",
      to: "dormant",
      reason: offScreenTheme && mediumSlots >= budget.maxMediumCharacters ? "budget" : "dormant",
    });
  }

  const evolve = backgroundWorldEvolutionEnabled(evidence);
  if (!evolve) {
    for (const npc of npcs) {
      const band = byCharacter[npc.id];
      if (band === "medium" || band === "macro") {
        deferred.push({
          characterId: npc.id,
          locationId: npc.locationId,
          from: band,
          to: "skip",
          reason: "gate",
        });
      }
    }
  }

  const requestedLlm = evolve ? 1 : 0;
  let llmCalls = 0;
  if (requestedLlm > budget.maxLlmCalls || requestedLlm * estimateTokens() > budget.maxTokens) {
    if (requestedLlm > 0) {
      deferred.push({ from: "llm", to: "shortcut", reason: "budget" });
    }
    llmCalls = 0;
  } else {
    llmCalls = requestedLlm;
  }

  const theme = snapshot.characters.find((row) => row.id === themeId);
  const themeBand = theme ? byCharacter[theme.id] : undefined;
  const samePlace = Boolean(player && theme && player.locationId === theme.locationId);
  const publicBeat =
    compiled.theme.publicBeatScope === "public_world" || samePlace ? compiled.theme.publicBeat : "";

  let themeMemory: AutonomyPlan["themeMemory"] = null;
  if (theme && compiled.theme.memory) {
    const allowDurable = themeBand === "high" || (themeBand === "medium" && evolve);
    if (!allowDurable) {
      deferred.push({
        characterId: theme.id,
        from: themeBand ?? "dormant",
        to: "skip",
        reason: themeBand === "medium" || themeBand === "macro" ? "gate" : "dormant",
      });
    } else if (alreadyNoted(snapshot.memories, theme.id, compiled.theme.memory)) {
      deferred.push({
        characterId: theme.id,
        from: themeBand ?? "high",
        to: "skip",
        reason: "damping",
      });
    } else if (themeBand === "medium" && !frequencyOk(snapshot, theme.id, budget.minBeatsBetweenMedium)) {
      deferred.push({
        characterId: theme.id,
        from: "medium",
        to: "skip",
        reason: "frequency",
      });
    } else {
      themeMemory = { characterId: theme.id, text: compiled.theme.memory };
    }
  }

  const dormantCount = npcs.filter((row) => byCharacter[row.id] === "dormant").length;
  return {
    byCharacter,
    macroLocations,
    dormantCount,
    timeAdvance: true,
    themeMemory,
    publicBeat,
    llmCalls,
    tokensReserved: 0,
    shortcut: "deterministic",
    deferred,
  };
}

function preferTheme(a: CharacterRecord, b: CharacterRecord, themeId: string): number {
  if (a.id === themeId) {
    return -1;
  }
  if (b.id === themeId) {
    return 1;
  }
  return a.id.localeCompare(b.id);
}

function alreadyNoted(memories: MemoryRecord[], characterId: string, text: string): boolean {
  return memories.some((row) => row.characterId === characterId && row.text === text);
}

function frequencyOk(snapshot: WorldSnapshot, characterId: string, minBeats: number): boolean {
  const last = snapshot.memories.filter((row) => row.characterId === characterId).at(-1);
  if (!last) {
    return true;
  }
  return beatDistance(last.recordedAt, snapshot.world.time) >= minBeats;
}

function beatDistance(from: string, to: string): number {
  const a = /^(.*?)(?:·(\d+))?$/.exec(from);
  const b = /^(.*?)(?:·(\d+))?$/.exec(to);
  if (a && b && a[1] === b[1]) {
    return Number(b[2] || "0") - Number(a[2] || "0");
  }
  return from === to ? 0 : 1;
}

function estimateTokens(): number {
  return 0;
}
