import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stubNpcVoice } from "../app/chat/npc.js";
import type { AppConfig } from "../app/config.js";
import { resetWorldCatalog } from "../app/http/catalog.js";
import { PlayHost } from "../app/http/host.js";
import { stubNarrator } from "../app/narrator/client.js";
import { WorldStore } from "../app/persist/store.js";
import { fixedInterpreter } from "../app/scene/interpreter.js";
import { advanceDueBackgroundThreads } from "../app/scene/background.js";
import { fixedStopDecider, groundStopDecision, type SceneStopDecider } from "../app/scene/stop.js";
import { MAX_AUTO_DURATION_MINUTES, openWorld } from "../app/session.js";
import { loadWorldFile } from "../app/world/load.js";

const SOURCE = join(process.cwd(), "app", "world", "fixtures", "dragon-2009-first-hour.json");
const dirs: string[] = [];
afterEach(() => { delete process.env.DWE_PLAY_DIR; resetWorldCatalog(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function compiled() { return loadWorldFile(SOURCE); }
function config(): AppConfig { return { baseUrl: "http://127.0.0.1:9", apiKey: "test", model: "none", worldFile: join(tmpdir(), "unused.sqlite"), worldSource: null, maxRetries: 0, timeoutMs: 1000, fallbackModel: null, inputUsdPerMtok: null, outputUsdPerMtok: null }; }
function profile() {
  return { worldId: "longzu", name: "林念安", age: "18", gender: "女", background: "仕兰中学普通学生。", startingLocation: "仕兰中学教学楼", personality: "谨慎" };
}
function routeInterpreter(routeId: "route-long-home" | "route-short-home") {
  return fixedInterpreter({
    channel: "in_world",
    contributions: ["world_attempt"],
    futureCausal: false,
    outcome: "ephemeral",
    proposals: [],
    timePolicy: { kind: "route_travel", minutes: null, routeId, untilTime: null },
    strategyIntent: { kind: "follow_route", targetLocationId: "loc-home", routeId, untilTime: null, completionCondition: "到家" },
  });
}

async function opened(routeId: "route-long-home" | "route-short-home", path = ":memory:", stop: SceneStopDecider = fixedStopDecider()) {
  const session = openWorld(path, stubNarrator(), compiled(), routeInterpreter(routeId), stubNpcVoice(), stop);
  session.store.initializePlayerProfile(profile());
  await session.projectOpening(profile());
  return session;
}

describe("Issue #75 bounded scene lifecycle", () => {
  it("compiles the dated route graph and advances the long route to a second grounded decision", async () => {
    const session = await opened("route-long-home");
    const before = session.store.snapshot("longzu");
    expect(before.routes).toHaveLength(6);
    expect(before.backgroundThreads[0]?.currentStage).toBe("approaching");

    const turn = await session.handlePlayerTurn("我避开老码头，走老街远路回家。", "turn-long");
    const after = session.store.snapshot("longzu");
    expect(after.characters.find((row) => row.id === "char-player")?.locationId).toBe("loc-home");
    expect(turn.receipt.elapsedMinutes).toBe(37);
    expect(turn.receipt.autoSteps).toBe(1);
    expect(turn.receipt.stopReason).toBe("material_information");
    expect(turn.stopDecision?.options).toHaveLength(6);
    expect(after.backgroundThreads[0]?.currentStage).toBe("pickup_visible");
    expect(new Date(after.world.time).getTime() - new Date(before.world.time).getTime()).toBe(37 * 60_000);
    session.close();
  });

  it("keeps stop decisions non-authoritative and rejects hidden or promised options", async () => {
    const session = await opened("route-long-home");
    const before = session.store.listEvents("longzu").length;
    const decision = await fixedStopDecider().decide({ visibleContext: "普通街道", hardStopReason: "material_information", evidence: ["听见旋翼声"], strategyComplete: true });
    expect(decision).not.toBeNull();
    const unsafe = { ...decision!, options: decision!.options!.map((row, index) => index === 0 ? { ...row, text: "直接去找诺诺，她一定会告诉我真相" } : row) };
    expect(groundStopDecision(unsafe, session.store.snapshot("longzu"), session.compiled, "char-player").options).toBeNull();
    expect(session.store.listEvents("longzu")).toHaveLength(before);
    session.close();
  });

  it("does not stop mundane observation and fail-closes a structured stop failure after preserving committed time", async () => {
    const noStop = openWorld(":memory:", stubNarrator(), compiled(), fixedInterpreter({ contributions: ["observe"], futureCausal: false, outcome: "ephemeral", proposals: [], timePolicy: { kind: "none", minutes: null, routeId: null, untilTime: null }, strategyIntent: null }));
    noStop.store.initializePlayerProfile(profile());
    await noStop.projectOpening(profile());
    const t0 = noStop.store.snapshot("longzu").world.time;
    const ordinary = await noStop.handlePlayerTurn("我看看窗外。", "turn-observe");
    expect(ordinary.stopDecision?.shouldStop).toBe(false);
    expect(noStop.store.snapshot("longzu").world.time).toBe(t0);
    noStop.close();

    const failure = openWorld(":memory:", stubNarrator(), compiled(), fixedInterpreter({ contributions: ["low_causal"], futureCausal: false, outcome: "ephemeral", proposals: [], timePolicy: { kind: "bounded_action", minutes: 2, routeId: null, untilTime: null }, strategyIntent: null }), stubNpcVoice(), { async decide() { return null; } });
    const failed = await failure.handlePlayerTurn("我收拾书包。", "turn-stop-failure");
    expect(failed.receipt.terminalReason).toBe("structured_failure");
    expect(failed.receipt.elapsedMinutes).toBe(2);
    failure.close();
  });

  it("cancels at a safe boundary, preserving the committed player consequence and pending route", async () => {
    const interpreter = fixedInterpreter({
      contributions: ["durable_attempt", "world_attempt"], futureCausal: true, outcome: "candidate",
      proposals: [{ type: "memory_note", text: "决定绕行老街。" }],
      timePolicy: { kind: "route_travel", minutes: null, routeId: "route-long-home", untilTime: null },
      strategyIntent: { kind: "follow_route", targetLocationId: "loc-home", routeId: "route-long-home", untilTime: null, completionCondition: "到家" },
    });
    const session = openWorld(":memory:", stubNarrator(), compiled(), interpreter);
    const controller = new AbortController();
    controller.abort();
    const turn = await session.handlePlayerTurn("我记下决定并走远路。", "turn-cancel", controller.signal);
    const snapshot = session.store.snapshot("longzu");
    expect(turn.receipt.cancelled).toBe(true);
    expect(snapshot.memories.some((row) => row.text.includes("绕行老街"))).toBe(true);
    expect(snapshot.characters.find((row) => row.id === "char-player")?.locationId).toBe("loc-shilan-classroom");
    expect(session.store.getLifecycleState("longzu")?.strategy).not.toBeNull();
    session.close();
  });

  it("enforces the duration cap before movement", async () => {
    const world = compiled();
    world.routes = world.routes.map((route) => route.id === "route-long-home" ? { ...route, travelMinutes: MAX_AUTO_DURATION_MINUTES + 1 } : route);
    const session = openWorld(":memory:", stubNarrator(), world, routeInterpreter("route-long-home"));
    const turn = await session.handlePlayerTurn("我走远路。", "turn-cap");
    expect(turn.receipt.capReached).toBe(true);
    expect(session.store.snapshot("longzu").characters.find((row) => row.id === "char-player")?.locationId).toBe("loc-shilan-classroom");
    session.close();
  });

  it("executes each background beat once and advances it even when the player ignores the opening exposure", async () => {
    const session = await opened("route-short-home");
    const first = await session.handlePlayerTurn("我不理会路况提醒，照常走老码头近路回家。", "turn-ignore");
    expect(first.envelope.ephemeral.ambient).toEqual([]);
    expect(session.store.snapshot("longzu").backgroundThreads[0]?.currentStage).toBe("pickup_visible");
    const events = session.store.listEvents("longzu").filter((event) => event.type === "background_thread_advance").length;
    const repeated = advanceDueBackgroundThreads({ store: session.store, compiled: session.compiled, playerId: "char-player", routeId: "route-short-home" });
    expect(repeated.executedBeatIds).toEqual([]);
    expect(session.store.listEvents("longzu").filter((event) => event.type === "background_thread_advance")).toHaveLength(events);
    session.close();
  });

  it("replays a persisted turn receipt after host restart without duplicate commits or beats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dwe-turn-retry-"));
    dirs.push(dir);
    process.env.DWE_PLAY_DIR = dir;
    resetWorldCatalog();
    const firstHost = new PlayHost(config(), true);
    firstHost.open("longzu", "new");
    firstHost.setPlayerProfile(profile());
    await firstHost.startLife(profile());
    const first = await firstHost.playTurn("我避开老码头，走老街远路回家。", "stable-turn", () => undefined);
    firstHost.close();
    const path = join(dir, "play-longzu.sqlite");
    const beforeStore = new WorldStore(path);
    const eventCount = beforeStore.listEvents("longzu").length;
    const beatIds = beforeStore.snapshot("longzu").backgroundThreads[0]?.executedBeatIds;
    beforeStore.close();

    resetWorldCatalog();
    const secondHost = new PlayHost(config(), true);
    secondHost.open("longzu", "resume");
    const replay = await secondHost.playTurn("我避开老码头，走老街远路回家。", "stable-turn", () => undefined);
    expect(replay).toEqual(first);
    secondHost.close();
    const afterStore = new WorldStore(path);
    try {
      expect(afterStore.listEvents("longzu")).toHaveLength(eventCount);
      expect(afterStore.snapshot("longzu").backgroundThreads[0]?.executedBeatIds).toEqual(beatIds);
    } finally {
      afterStore.close();
    }
  });

  it("persists time, thread stage, player state, and lifecycle state across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dwe-lifecycle-"));
    dirs.push(dir);
    const path = join(dir, "world.sqlite");
    const first = await opened("route-long-home", path);
    await first.handlePlayerTurn("我走老街远路回家。", "turn-restart");
    const digest = first.store.getLifecycleState("longzu");
    const time = first.store.snapshot("longzu").world.time;
    first.close();

    const second = openWorld(path, stubNarrator(), compiled(), routeInterpreter("route-long-home"));
    const snapshot = second.store.snapshot("longzu");
    expect(snapshot.world.time).toBe(time);
    expect(snapshot.backgroundThreads[0]?.currentStage).toBe("pickup_visible");
    expect(snapshot.characters.find((row) => row.id === "char-player")?.locationId).toBe("loc-home");
    expect(second.store.getLifecycleState("longzu")).toEqual(digest);
    second.close();
  });

  it("keeps OOC completely outside time, background threads, events, and revision", async () => {
    const session = openWorld(":memory:", stubNarrator(), compiled(), routeInterpreter("route-long-home"));
    const before = session.store.snapshot("longzu");
    const events = session.store.listEvents("longzu").length;
    const turn = await session.handlePlayerTurn("/ooc 先解释一下规则", "turn-ooc");
    const after = session.store.snapshot("longzu");
    expect(turn.receipt.elapsedMinutes).toBe(0);
    expect(after.world).toEqual(before.world);
    expect(after.backgroundThreads).toEqual(before.backgroundThreads);
    expect(session.store.listEvents("longzu")).toHaveLength(events);
    session.close();
  });
});
