import { describe, expect, it } from "vitest";
import { stubNpcVoice } from "../app/chat/npc.js";
import { stubSceneClient } from "../app/chat/scene.js";
import { RECENT_WINDOW, recentSceneBodies } from "../app/context/recent.js";
import { observerNamespace } from "../app/visibility/pool.js";
import { openWorld } from "../app/session.js";
import { CHAR_COOK, CHAR_KEEPER, CHAR_PLAYER, WORLD_ID } from "../app/world/seed.js";

describe("recent scene window", () => {
  it("keeps the last 1–3 resolved scenes so a follow-up is not amnesia", async () => {
    const session = openWorld(":memory:", stubSceneClient(), undefined, undefined, stubNpcVoice());
    const facts0 = session.store.snapshot(WORLD_ID).facts;
    const t1 = await session.playTurn("掌柜，汤好了吗？");
    expect(t1.dialogue?.addresseeId).toBe(CHAR_KEEPER);
    const t2 = await session.playTurn("那还要多久？");
    expect(t2.dialogue?.addresseeId).toBe(CHAR_KEEPER);
    expect(t2.prompt).toContain("汤好了吗");
    expect(t2.dialogue?.npcPrompt).toContain("汤好了吗");
    expect(t2.dialogue?.npcPrompt).not.toContain(observerNamespace(CHAR_PLAYER));

    await session.playTurn("掌柜，再给我一碗。");
    await session.playTurn("掌柜，第四句不该再记住第一句MARKER_ONE。");
    const window = recentSceneBodies(session.store, WORLD_ID, CHAR_PLAYER);
    expect(window.length).toBe(RECENT_WINDOW);
    expect(window.join("\n")).not.toContain("汤好了吗");
    expect(window.join("\n")).toContain("那还要多久");
    expect(session.store.snapshot(WORLD_ID).facts).toEqual(facts0);

    const cook = session.store.listContextItems(WORLD_ID, [observerNamespace(CHAR_COOK)], "scene");
    expect(cook.some((row) => row.body.includes("汤好了吗"))).toBe(false);
    const playerScenes = session.store.listContextItems(WORLD_ID, [observerNamespace(CHAR_PLAYER)], "scene");
    expect(playerScenes.length).toBe(RECENT_WINDOW);
    session.close();
  });
});
