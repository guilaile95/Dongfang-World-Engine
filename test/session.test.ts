import { describe, expect, it } from "vitest";
import { stubNarrator } from "../app/narrator/client.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { openWorld } from "../app/session.js";
import { TIME0, WORLD_ID } from "../app/world/seed.js";

describe("session", () => {
  it("keeps conversation alive while fail-closing untrusted persistent consequences", async () => {
    let narrated = 0;
    const narrator = {
      async project() {
        narrated += 1;
        return "should-not-run";
      },
    };
    const session = openWorld(
      ":memory:",
      narrator,
      undefined,
      fixedInterpreter(
        {
          contributions: ["uncertain_attempt"],
          futureCausal: false,
          outcome: "fail",
          proposals: [],
        },
        false,
      ),
    );
    const before = session.store.snapshot(WORLD_ID);
    const turn = await session.playTurn("同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。");
    const after = session.store.snapshot(WORLD_ID);
    expect(turn.parsed).toBe(false);
    expect(turn.text).toBe("should-not-run");
    expect(turn.dialogue).toBeNull();
    expect(turn.envelope.committed).toEqual([]);
    expect(narrated).toBe(1);
    expect(after.world.time).toBe(before.world.time);
    expect(after.world.revision).toBe(before.world.revision);
    expect(after.memories).toEqual(before.memories);
    expect(after.claims).toEqual(before.claims);
    expect(session.store.listEvents(WORLD_ID)).toEqual([]);
    session.close();
  });

  it("resumes the same world file and does not tick on a blank line", async () => {
    const first = openWorld(":memory:", stubNarrator());
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
