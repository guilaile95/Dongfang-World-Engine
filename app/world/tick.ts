import { randomUUID } from "node:crypto";
import { submitCandidates } from "../authority/commit.js";
import type { WorldStore } from "../persist/store.js";
import { CHAR_KEEPER, CHAR_PLAYER, nextBeat, WORLD_ID } from "./seed.js";

export interface TickResult {
  publicBeat: string;
  accepted: boolean;
  reasons: string[];
}

/** Once per in-world player turn. Not parsed from the player line. Not a scheduler. */
export function worldTick(store: WorldStore): TickResult {
  const snapshot = store.snapshot(WORLD_ID);
  const toTime = nextBeat(snapshot.world.time);
  const memoryId = `mem-tick-${randomUUID()}`;
  const result = submitCandidates(store, {
    producer: "world_tick",
    candidates: [
      {
        type: "time_advance",
        worldId: WORLD_ID,
        expectedRevision: snapshot.world.revision,
        toTime,
      },
      {
        type: "memory_note",
        worldId: WORLD_ID,
        expectedRevision: snapshot.world.revision + 1,
        memoryId,
        characterId: CHAR_KEEPER,
        text: "还得把李公子的下落问清楚，不能因为堂里有人吃饭就把这事放下。",
      },
    ],
  });

  const after = store.snapshot(WORLD_ID);
  const player = after.characters.find((row) => row.id === CHAR_PLAYER);
  const keeper = after.characters.find((row) => row.id === CHAR_KEEPER);
  const samePlace = player && keeper && player.locationId === keeper.locationId;
  const publicBeat = samePlace ? "掌柜在柜台翻着登记簿，像还在等一个没回来的客人。" : "";

  return {
    publicBeat,
    accepted: result.accepted,
    reasons: result.reasons,
  };
}
