import { randomUUID } from "node:crypto";
import { submitCandidates } from "../authority/commit.js";
import type { WorldStore } from "../persist/store.js";
import type { CompiledWorld } from "./compile.js";
import { nextBeat, SYNTHETIC } from "./seed.js";

export interface TickResult {
  publicBeat: string;
  accepted: boolean;
  reasons: string[];
}

/** Once per in-world player turn. Not parsed from the player line. Not a scheduler. */
export function worldTick(store: WorldStore, compiled: CompiledWorld = SYNTHETIC): TickResult {
  const worldId = compiled.seed.world.id;
  const snapshot = store.snapshot(worldId);
  const toTime = nextBeat(snapshot.world.time);
  const memoryId = `mem-tick-${randomUUID()}`;
  const themeId = compiled.theme.characterId;
  const candidates = [
    {
      type: "time_advance" as const,
      worldId,
      expectedRevision: snapshot.world.revision,
      toTime,
    },
    ...(themeId && compiled.theme.memory
      ? [
        {
          type: "memory_note" as const,
          worldId,
          expectedRevision: snapshot.world.revision + 1,
          memoryId,
          characterId: themeId,
          text: compiled.theme.memory,
        },
      ]
      : []),
  ];
  const result = submitCandidates(store, {
    producer: "world_tick",
    candidates,
  });

  const after = store.snapshot(worldId);
  const player = after.characters.find((row) => row.id === compiled.playerId);
  const theme = after.characters.find((row) => row.id === themeId);
  const samePlace = player && theme && player.locationId === theme.locationId;
  const publicBeat =
    compiled.theme.publicBeatScope === "public_world" || samePlace ? compiled.theme.publicBeat : "";

  return {
    publicBeat,
    accepted: result.accepted,
    reasons: result.reasons,
  };
}
