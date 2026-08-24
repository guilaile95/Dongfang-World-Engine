import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { rebuildWorld } from "../app/authority/restore.js";
import { seedInput, TIME0, WORLD_ID } from "../app/world/seed.js";
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
    const rebuilt = rebuildWorld(seedInput(), events);
    expect(rebuilt.snapshot(WORLD_ID)).toEqual(live.snapshot(WORLD_ID));
    live.close();
    rebuilt.close();
  });
});

