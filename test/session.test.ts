import { describe, expect, it } from "vitest";
import { stubSceneClient } from "../app/chat/scene.js";
import { openWorld } from "../app/session.js";
import { TIME0, WORLD_ID } from "../app/world/seed.js";

describe("session", () => {
  it("resumes the same world file and does not tick on a blank line", async () => {
    const first = openWorld(":memory:", stubSceneClient());
    const idle = await first.playTurn("   ");
    expect(idle.observer.time).toBe(TIME0);
    expect(first.store.snapshot(WORLD_ID).world.revision).toBe(0);

    const turn = await first.playTurn("我先吃饭。");
    expect(turn.observer.time).not.toBe(TIME0);
    expect(turn.text).toContain("我先吃饭。");
    expect(turn.text).not.toMatch(/fact_assert|expectedRevision|CommitKernel/);
    first.close();
  });
});
