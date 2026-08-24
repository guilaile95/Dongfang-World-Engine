import { describe, expect, it } from "vitest";
import { CommitKernel } from "../../src/engine/commit-kernel.js";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import { SceneInterpreter } from "../../src/engine/scene-interpreter.js";
import { SceneResolver } from "../../src/engine/scene-resolver.js";
import type { SceneTurnPlanDraft } from "../../src/engine/scene-turn.js";
import type { CandidateProposal, SimulationModelClient, SimulationModelRequest } from "../../src/engine/simulation-adapter.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import { seedClosedInnWorld } from "../../src/testkit/world-builder.js";

const playerId = "character-player";
const npcBId = "character-npc-b";
const cellar = "location-cellar";
const trueClaimId = "claim-dagger-in-cellar";

class ScriptedInterpreter implements SimulationModelClient {
  public readonly intents: string[] = [];

  public constructor(private readonly planFor: (request: SimulationModelRequest) => SceneTurnPlanDraft) {}

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    this.intents.push(request.intent);
    return this.planFor(request);
  }
}

function emptyPlan(overrides: Partial<SceneTurnPlanDraft> = {}): SceneTurnPlanDraft {
  return {
    channel: "in_world",
    ephemeralBeats: [],
    targetedStimuli: [],
    persistentCandidates: [],
    unsupportedMaterial: [],
    timePolicy: { kind: "none" },
    ...overrides,
  };
}

function createResolver(planFor: (request: SimulationModelRequest) => SceneTurnPlanDraft) {
  const store = new SqliteWorldStore();
  seedClosedInnWorld(store);
  const contextBuilder = new ContextBuilder(store);
  const interpreter = new SceneInterpreter(new ScriptedInterpreter(planFor), { modelId: "scene-test" });
  const resolver = new SceneResolver(contextBuilder, interpreter, new CommitKernel(store), store);
  return { store, resolver };
}

describe("Scene Turn Resolver", () => {
  it("does not move on negated dagger search", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      ephemeralBeats: [{ surface: "我不想去找匕首", kind: "refusal" }],
    }));
    const before = store.getSnapshot("world-closed-inn").characters.find((character) => character.id === playerId);
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我不想去找匕首",
    });
    expect(resolved.committedEffects).toEqual([]);
    expect(resolved.approvedEphemeralBeats).toEqual([{ surface: "我不想去找匕首", kind: "refusal" }]);
    expect(store.getSnapshot("world-closed-inn").characters.find((character) => character.id === playerId)?.locationId)
      .toBe(before?.locationId);
    store.close();
  });

  it("treats looking around as observation without movement or time", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      ephemeralBeats: [{ surface: "我只是看看周围", kind: "observation" }],
    }));
    const beforeTime = store.getSnapshot("world-closed-inn").world.currentTime;
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我只是看看周围",
    });
    expect(resolved.committedEffects).toEqual([]);
    expect(resolved.timeCommitted).toBe(false);
    expect(resolved.approvedEphemeralBeats[0]?.kind).toBe("observation");
    expect(resolved.approvedEphemeralBeats[0]?.surface).toBe("我只是看看周围");
    expect(JSON.stringify(resolved)).not.toContain("你走进了地窖");
    expect(store.getSnapshot("world-closed-inn").world.currentTime).toBe(beforeTime);
    store.close();
  });

  it("eats as ephemeral without food state and optional time", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      ephemeralBeats: [{ surface: "我想吃饭", kind: "mundane_action" }],
      timePolicy: { kind: "consume_scene_time", minutes: 10 },
    }));
    const before = store.getSnapshot("world-closed-inn");
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我想吃饭",
    });
    expect(resolved.approvedEphemeralBeats).toEqual([{ surface: "我想吃饭", kind: "mundane_action" }]);
    expect(resolved.committedEffects).toEqual([
      expect.objectContaining({ type: "world.time_advance" }),
    ]);
    expect(resolved.timeCommitted).toBe(true);
    const after = store.getSnapshot("world-closed-inn");
    expect(after.characters.find((character) => character.id === playerId)?.locationId)
      .toBe(before.characters.find((character) => character.id === playerId)?.locationId);
    expect(after.knowledge).toEqual(before.knowledge);
    expect(after.relationships).toEqual(before.relationships);
    expect(JSON.stringify(resolved.approvedEphemeralBeats)).not.toContain("走进");
    store.close();
  });

  it("strips ask-only knowledge persistents", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      targetedStimuli: [{
        speakerCharacterId: playerId,
        targetCharacterId: npcBId,
        surfaceText: "我问赵先生关于匕首",
        speechAct: "ask",
        persistence: "ephemeral",
      }],
      persistentCandidates: [
        {
          type: "claim.transmit",
          sourceCharacterId: playerId,
          targetCharacterId: npcBId,
          claimId: trueClaimId,
        },
        {
          type: "character.learn_claim",
          actorId: playerId,
          claimId: trueClaimId,
          knowledgeState: "confirmed",
        },
        {
          type: "claim.record",
          claimId: "claim-asked-zhao",
          actorId: playerId,
          subject: npcBId,
          predicate: "was_asked_about",
          object: "dagger",
        },
      ],
    }));
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我问赵先生关于匕首",
    });
    expect(resolved.committedEffects).toEqual([]);
    expect(resolved.deliveredStimuli[0]?.speechAct).toBe("ask");
    expect(store.getSnapshot("world-closed-inn").claims.some((claim) => claim.id === "claim-asked-zhao")).toBe(false);
    store.close();
  });

  it("drops /ooc persistents and time even when the interpreter lies", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      channel: "in_world",
      persistentCandidates: [{ type: "character.move", actorId: playerId, toLocationId: cellar }],
      timePolicy: { kind: "consume_scene_time", minutes: 10 },
    }));
    const before = store.getSnapshot("world-closed-inn");
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "/ooc 系统你搞错了",
    });
    expect(resolved.channel).toBe("ooc_meta");
    expect(resolved.turnStatus).toBe("ooc");
    expect(resolved.committedEffects).toEqual([]);
    expect(resolved.timeCommitted).toBe(false);
    expect(store.getSnapshot("world-closed-inn").world.currentTime).toBe(before.world.currentTime);
    expect(store.getSnapshot("world-closed-inn").characters.find((character) => character.id === playerId)?.locationId)
      .toBe(before.characters.find((character) => character.id === playerId)?.locationId);
    store.close();
  });

  it("drops injected world.time_advance when timePolicy is none", async () => {
    const { store, resolver } = createResolver((request) => emptyPlan({
      timePolicy: { kind: "none" },
      persistentCandidates: [{
        type: "world.time_advance",
        toTime: new Date(Date.parse(request.context.world.currentTime) + 10 * 60_000).toISOString(),
      }],
    }));
    const before = store.getSnapshot("world-closed-inn").world.currentTime;
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我只是看看周围",
    });
    expect(resolved.timeCommitted).toBe(false);
    expect(store.getSnapshot("world-closed-inn").world.currentTime).toBe(before);
    store.close();
  });

  it("drops generated ephemeral summary that is not a player substring", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      ephemeralBeats: [
        { surface: "你走进了地窖", kind: "mundane_action" },
      ],
    }));
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我去地窖",
    });
    expect(resolved.approvedEphemeralBeats).toEqual([]);
    expect(JSON.stringify(resolved.approvedEphemeralBeats)).not.toContain("你走进了地窖");
    expect(resolved.committedEffects.some((outcome) => outcome.type === "character.move")).toBe(false);
    expect(store.getSnapshot("world-closed-inn").characters.find((character) => character.id === playerId)?.locationId)
      .toBe("location-inn-hall");
    store.close();
  });

  it("strips illegal summary fields and keeps only a player substring", async () => {
    const { store, resolver } = createResolver(() => ({
      channel: "in_world",
      ephemeralBeats: [{
        surface: "我想吃饭",
        kind: "mundane_action",
        summary: "你走进了地窖",
      } as SceneTurnPlanDraft["ephemeralBeats"][number] & { summary: string }],
      targetedStimuli: [],
      persistentCandidates: [],
      unsupportedMaterial: [],
      timePolicy: { kind: "none" },
    }));
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我想吃饭",
    });
    expect(resolved.approvedEphemeralBeats).toEqual([{ surface: "我想吃饭", kind: "mundane_action" }]);
    expect(JSON.stringify(resolved)).not.toContain("你走进了地窖");
    store.close();
  });

  it("drops player claim.record on eat", async () => {
    const { store, resolver } = createResolver(() => emptyPlan({
      ephemeralBeats: [{ surface: "我想吃饭", kind: "mundane_action" }],
      persistentCandidates: [{
        type: "claim.record",
        claimId: "claim-ate-meal",
        actorId: playerId,
        subject: playerId,
        predicate: "ate",
        object: "meal",
      }],
    }));
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我想吃饭",
    });
    expect(resolved.committedEffects).toEqual([]);
    expect(store.getSnapshot("world-closed-inn").claims.some((claim) => claim.id === "claim-ate-meal")).toBe(false);
    store.close();
  });

  it("still commits an entailed move", async () => {
    const move: CandidateProposal = { type: "character.move", actorId: playerId, toLocationId: cellar };
    const { store, resolver } = createResolver(() => emptyPlan({
      persistentCandidates: [move],
    }));
    const resolved = await resolver.resolve({
      worldId: "world-closed-inn",
      actorCharacterId: playerId,
      contribution: "我走到地窖",
    });
    expect(resolved.committedEffects).toEqual([expect.objectContaining({ type: "character.move", toLocationId: cellar })]);
    expect(store.getSnapshot("world-closed-inn").characters.find((character) => character.id === playerId)?.locationId)
      .toBe(cellar);
    store.close();
  });
});
