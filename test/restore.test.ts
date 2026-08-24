import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { rebuildWorld } from "../app/authority/restore.js";
import { WorldStore } from "../app/persist/store.js";
import { seedInput, seedWorld, TIME0, WORLD_ID } from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("restore", () => {
  it("rebuilds the long-term world from seed plus committed events", () => {
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
    const rebuilt = rebuildWorld(seedInput(), events);
    expect(rebuilt.snapshot(WORLD_ID)).toEqual(live.snapshot(WORLD_ID));
    expect(rebuilt.listEvents(WORLD_ID).map((event) => event.id)).toEqual(events.map((event) => event.id));
    live.close();
    rebuilt.close();
  });

  it("reopens the same sqlite file as authoritative state", () => {
    const dir = mkdtempSync(join(tmpdir(), "dwe-world-"));
    const file = join(dir, "world.sqlite");
    try {
      const first = new WorldStore(file);
      seedWorld(first);
      const written = submitCandidates(first, {
        producer: "system",
        candidates: [
          {
            type: "fact_assert",
            worldId: WORLD_ID,
            expectedRevision: 0,
            factId: "fact-rain",
            subject: "sky",
            predicate: "weather",
            object: "rain",
            validFrom: TIME0,
          },
        ],
      });
      expect(written.accepted).toBe(true);
      const snap = first.snapshot(WORLD_ID);
      const eventIds = first.listEvents(WORLD_ID).map((event) => event.id);
      first.close();

      const second = new WorldStore(file);
      expect(second.snapshot(WORLD_ID)).toEqual(snap);
      expect(second.listEvents(WORLD_ID).map((event) => event.id)).toEqual(eventIds);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
