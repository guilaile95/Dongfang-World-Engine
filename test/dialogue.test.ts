import { describe, expect, it } from "vitest";
import { submitCandidates } from "../app/authority/commit.js";
import { stubNpcVoice } from "../app/chat/npc.js";
import { stubSceneClient } from "../app/chat/scene.js";
import { resolveAddressee } from "../app/scene/address.js";
import { observerNamespace } from "../app/visibility/pool.js";
import { openWorld } from "../app/session.js";
import {
  CHAR_COOK,
  CHAR_KEEPER,
  CHAR_PLAYER,
  CLAIM_BAG,
  FACT_BAG,
  WORLD_ID,
} from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

const PLAYER_SECRET = "TOKEN_PLAYER_PRIVATE_LEDGER";

describe("player to npc dialogue", () => {
  it("resolves a same-place addressee by name and ignores NPCs in another room", () => {
    const store = memoryWorld();
    const snap = store.snapshot(WORLD_ID);
    expect(resolveAddressee(snap, CHAR_PLAYER, "掌柜，这汤是什么？")?.id).toBe(CHAR_KEEPER);
    expect(resolveAddressee(snap, CHAR_PLAYER, "老周你听见了吗")?.id).toBe(CHAR_KEEPER);
    expect(resolveAddressee(snap, CHAR_PLAYER, "阿福，厨房怎样？")).toBeNull();
    expect(resolveAddressee(snap, CHAR_PLAYER, "我先吃饭。")).toBeNull();
    store.close();
  });

  it("builds the NPC pack from the NPC observer, not the player's private context", async () => {
    const session = openWorld(":memory:", stubSceneClient(), undefined, undefined, stubNpcVoice());
    submitCandidates(session.store, {
      producer: "system",
      candidates: [
        {
          type: "memory_note",
          worldId: WORLD_ID,
          expectedRevision: 0,
          memoryId: "mem-player-private",
          characterId: CHAR_PLAYER,
          text: PLAYER_SECRET,
        },
      ],
    });
    const claimsBefore = session.store.snapshot(WORLD_ID).claims.length;
    const turn = await session.playTurn("掌柜，你最近还好吗？");
    expect(turn.dialogue?.addresseeId).toBe(CHAR_KEEPER);
    expect(turn.dialogue?.stimulus).toBe("掌柜，你最近还好吗？");
    expect(turn.dialogue?.npcPrompt).not.toContain(PLAYER_SECRET);
    expect(JSON.stringify(turn.observer.memories)).toContain(PLAYER_SECRET);
    expect(turn.dialogue?.npcPrompt).toContain("guest-li-bag");
    expect(turn.dialogue?.npcPrompt).not.toContain(FACT_BAG);
    expect(turn.prompt).not.toBe(turn.dialogue?.npcPrompt);
    expect(turn.prompt).not.toContain("guest-li-bag");
    expect(turn.text).toContain("掌柜老周");
    expect(session.store.snapshot(WORLD_ID).claims.length).toBe(claimsBefore);

    const cookScenes = session.store.listContextItems(WORLD_ID, [observerNamespace(CHAR_COOK)], "scene");
    expect(cookScenes.some((row) => row.body.includes("掌柜，你最近还好吗？"))).toBe(false);
    const keeperScenes = session.store.listContextItems(WORLD_ID, [observerNamespace(CHAR_KEEPER)], "scene");
    expect(keeperScenes.some((row) => row.body.includes("掌柜，你最近还好吗？"))).toBe(true);
    expect(
      session.store.snapshot(WORLD_ID).knowledge.some(
        (row) => row.characterId === CHAR_COOK && row.claimId === CLAIM_BAG,
      ),
    ).toBe(false);
    session.close();
  });

  it("does not persist a casual NPC answer as authority truth", async () => {
    const session = openWorld(":memory:", stubSceneClient(), undefined, undefined, {
      async reply() {
        return "汤还没好。地窖的事别问。";
      },
    });
    const factsBefore = session.store.snapshot(WORLD_ID).facts;
    const turn = await session.playTurn("掌柜，地窖里到底有什么？");
    expect(turn.dialogue?.npcReply).toContain("汤还没好");
    expect(session.store.snapshot(WORLD_ID).facts).toEqual(factsBefore);
    expect(turn.interpretation.submitted).toBe(false);
    session.close();
  });
});
