import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { replayEvents } from "../app/authority/project.js";
import { WorldStore } from "../app/persist/store.js";
import { seedInput, seedWorld, TIME0, WORLD_ID } from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("replay", () => {
  it("rebuilds materialized state from seed plus committed events", () => {
    const live = memoryWorld();
    const first = submitCandidates(live, {
      producer: "system",
      candidates: [
        {
          type: "time_advance",
          worldId: WORLD_ID,
          expectedRevision: 0,
          toTime: "day-1-noon",
        },
      ],
    });
    expect(first.accepted).toBe(true);
    const second = submitCandidates(live, {
      producer: "system",
      candidates: [
        {
          type: "fact_assert",
          worldId: WORLD_ID,
          expectedRevision: 1,
          factId: "fact-rain",
          subject: "sky",
          predicate: "weather",
          object: "rain",
          validFrom: TIME0,
        },
      ],
    });
    expect(second.accepted).toBe(true);

    const events = live.listEvents(WORLD_ID);
    expect(events).toHaveLength(2);

    const rebuilt = new WorldStore(":memory:");
    rebuilt.insertSeedWorld(seedInput());
    replayEvents(rebuilt, events);

    const liveSnap = live.snapshot(WORLD_ID);
    const rebuiltSnap = rebuilt.snapshot(WORLD_ID);
    expect(rebuiltSnap.world).toEqual(liveSnap.world);
    expect(rebuiltSnap.facts).toEqual(liveSnap.facts);
    expect(rebuiltSnap.claims).toEqual(liveSnap.claims);
    expect(rebuiltSnap.knowledge).toEqual(liveSnap.knowledge);
    expect(rebuiltSnap.memories).toEqual(liveSnap.memories);
    expect(rebuilt.listEvents(WORLD_ID).map((event) => event.id)).toEqual(events.map((event) => event.id));
    live.close();
    rebuilt.close();
  });
});
