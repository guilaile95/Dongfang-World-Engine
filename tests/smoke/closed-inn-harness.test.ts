import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import {
  isDirectExecution,
  runClosedInnTurns,
  type ClosedInnRunResult,
} from "../../src/smoke/closed-inn-harness.js";
import type { SimulationModelClient, SimulationModelRequest } from "../../src/engine/simulation-adapter.js";
import type { NarrativeModelClient, NarrativeModelRequest } from "../../src/engine/narrative.js";

class ScriptedSimulationModel implements SimulationModelClient {
  private turnCount = 0;

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    this.turnCount += 1;
    const actorId = request.context.observer.id;

    // Turn 1: Player in hall (empty)
    if (this.turnCount === 1) {
      return { proposals: [] };
    }

    // Turn 2: NPC-A in hall transmits true claim (dagger in cellar) to Player
    if (this.turnCount === 2) {
      return {
        proposals: [{
          type: "claim.transmit",
          sourceCharacterId: actorId,
          targetCharacterId: "character-player",
          claimId: "claim-dagger-in-cellar",
        }],
      };
    }

    // Turn 3: Player in hall has learned about the dagger in cellar
    if (this.turnCount === 3) {
      const knowsCellar = request.context.knowledge.some((k) => k.claim.id === "claim-dagger-in-cellar");
      if (!knowsCellar) {
        throw new Error("Player expected to know claim-dagger-in-cellar on Turn 3");
      }
      return {
        proposals: [{
          type: "relationship.change",
          sourceCharacterId: actorId,
          targetCharacterId: "character-npc-a",
          trustDelta: 10,
        }],
      };
    }

    // Turn 4: NPC-B acts while holding false rumor (guest room)
    if (this.turnCount === 4) {
      const knowsGuestRoom = request.context.knowledge.some((k) => k.claim.id === "claim-dagger-in-guestroom");
      if (!knowsGuestRoom) {
        throw new Error("NPC-B expected to hold false claim on Turn 4");
      }
      return {
        proposals: [{
          type: "relationship.change",
          sourceCharacterId: actorId,
          targetCharacterId: "character-npc-a",
          trustDelta: -5,
        }],
      };
    }

    // Turn 5: NPC-C in guest room
    if (this.turnCount === 5) {
      return { proposals: [] };
    }

    // Turn 6: Player in hall transmits cellar claim to NPC-B
    if (this.turnCount === 6) {
      return {
        proposals: [{
          type: "claim.transmit",
          sourceCharacterId: actorId,
          targetCharacterId: "character-npc-b",
          claimId: "claim-dagger-in-cellar",
        }],
      };
    }

    // Turn 7: NPC-A in hall
    if (this.turnCount === 7) {
      return { proposals: [] };
    }

    // Turn 8: NPC-B now has cellar claim, adjusts attitude towards NPC-A
    if (this.turnCount === 8) {
      const knowsCellar = request.context.knowledge.some((k) => k.claim.id === "claim-dagger-in-cellar");
      if (!knowsCellar) {
        throw new Error("NPC-B expected to hold transmitted cellar claim on Turn 8");
      }
      return {
        proposals: [{
          type: "relationship.change",
          sourceCharacterId: actorId,
          targetCharacterId: "character-npc-a",
          trustDelta: 15,
          hostilityDelta: -10,
        }],
      };
    }

    // Turn 9: NPC-C in guest room
    if (this.turnCount === 9) {
      return { proposals: [] };
    }

    // Turn 10: Player final turn
    if (this.turnCount === 10) {
      return { proposals: [] };
    }

    return { proposals: [] };
  }
}

class ScriptedNarrativeModel implements NarrativeModelClient {
  public readonly requests: NarrativeModelRequest[] = [];

  public async generate(request: NarrativeModelRequest): Promise<string> {
    this.requests.push(request);
    const actorName = request.envelope.observerContext.observer.name;
    const locationName = request.envelope.observerContext.location?.name ?? "未知地点";
    const status = request.envelope.turnStatus;
    const outcomeTypes = request.envelope.outcomes.map((o) => o.type).join(", ");
    return `${actorName}在${locationName}。状态: ${status}。事件: ${outcomeTypes || "无"}`;
  }
}

describe("Closed Inn 10-turn Headless Harness", () => {
  it("completes 10-turn causal loop proof deterministically and satisfies all hard assertions", async () => {
    const store = new SqliteWorldStore();
    const simulationModel = new ScriptedSimulationModel();
    const narratorModel = new ScriptedNarrativeModel();

    const result: ClosedInnRunResult = await runClosedInnTurns({
      store,
      simulationModel,
      narratorModel,
    });

    expect(result.traces).toHaveLength(10);
    expect(result.replayConsistent).toBe(true);

    // Turn 1: Player empty observation
    expect(result.traces[0]?.actorId).toBe("character-player");
    expect(result.traces[0]?.turnStatus).toBe("empty");
    expect(result.traces[0]?.visibleClaims).toEqual([]); // Player starts with 0 knowledge
    expect(typeof result.traces[0]?.narrative).toBe("string");

    // Turn 2: NPC-A transmits true cellar claim to Player
    expect(result.traces[1]?.actorId).toBe("character-npc-a");
    expect(result.traces[1]?.turnStatus).toBe("success");
    expect(result.traces[1]?.committedEvents).toHaveLength(1);
    expect(result.traces[1]?.committedEvents[0]?.type).toBe("claim.transmit");
    expect(result.traces[1]?.narrative).toBeNull();

    // Turn 3: Player now legally has claim-dagger-in-cellar visible in Context!
    expect(result.traces[2]?.actorId).toBe("character-player");
    expect(result.traces[2]?.visibleClaims).toContainEqual({
      claimId: "claim-dagger-in-cellar",
      knowledgeState: "confirmed",
    });
    expect(result.traces[2]?.committedEvents[0]?.type).toBe("relationship.change");
    expect(typeof result.traces[2]?.narrative).toBe("string");

    // Turn 4: NPC-B acts while holding false claim
    expect(result.traces[3]?.actorId).toBe("character-npc-b");
    expect(result.traces[3]?.visibleClaims).toContainEqual({
      claimId: "claim-dagger-in-guestroom",
      knowledgeState: "rumor",
    });
    expect(result.traces[3]?.committedEvents[0]?.type).toBe("relationship.change");
    expect(result.traces[3]?.narrative).toBeNull();

    // Turn 6: Player transmits cellar claim to NPC-B
    expect(result.traces[5]?.actorId).toBe("character-player");
    expect(result.traces[5]?.committedEvents[0]?.type).toBe("claim.transmit");
    expect(typeof result.traces[5]?.narrative).toBe("string");

    // Turn 8: NPC-B now legally has claim-dagger-in-cellar visible in Context!
    expect(result.traces[7]?.actorId).toBe("character-npc-b");
    expect(result.traces[7]?.visibleClaims).toContainEqual({
      claimId: "claim-dagger-in-cellar",
      knowledgeState: "confirmed",
    });
    expect(result.traces[7]?.narrative).toBeNull();

    // Verify player-facing narratives vs NPC developer-only safe traces
    for (const trace of result.traces) {
      if (trace.actorId === "character-player") {
        expect(typeof trace.narrative).toBe("string");
        expect(trace.narrative!.length).toBeGreaterThan(0);
        expect(trace.narrative).not.toContain("fact-hidden-dagger-cellar");
      } else {
        expect(trace.narrative).toBeNull();
        expect(typeof trace.actorId).toBe("string");
        expect(typeof trace.turnStatus).toBe("string");
        expect(Array.isArray(trace.visibleClaims)).toBe(true);
        expect(Array.isArray(trace.committedEvents)).toBe(true);
      }
    }

    // Verify Narrator invocation regression:
    // 1. NarrativeModelClient is ONLY called by Player turns (4 player turns in 10-step harness: T1, T3, T6, T10)
    expect(narratorModel.requests).toHaveLength(4);

    // 2. Every NarrativeModelRequest.observerContext.observer.id MUST equal character-player
    for (const request of narratorModel.requests) {
      expect(request.envelope.observerContext.observer.id).toBe("character-player");
    }

    // Verify final world revision matches number of committed events
    const allEvents = store.listEvents(result.fixture.world.id);
    expect(result.finalWorldRevision).toBe(allEvents.length);
    expect(result.finalWorldRevision).toBe(5); // 5 committed turns (T2: transmit, T3: rel, T4: rel, T6: transmit, T8: rel)

    store.close();
  });

  it("enforces regression: NarrativeModelClient is only called for player turns with character-player as observer", async () => {
    const store = new SqliteWorldStore();
    const simulationModel = new ScriptedSimulationModel();
    const narratorModel = new ScriptedNarrativeModel();

    const result = await runClosedInnTurns({
      store,
      simulationModel,
      narratorModel,
    });

    // 10 turns total, 4 player turns, 6 NPC turns
    const playerTraces = result.traces.filter((t) => t.actorId === "character-player");
    const npcTraces = result.traces.filter((t) => t.actorId !== "character-player");

    expect(playerTraces).toHaveLength(4);
    expect(npcTraces).toHaveLength(6);

    // Only player turns invoked Narrator
    expect(narratorModel.requests).toHaveLength(4);

    // Every observer is character-player
    for (const request of narratorModel.requests) {
      expect(request.envelope.observerContext.observer.id).toBe("character-player");
    }

    // NPC turns have null narrative, player turns have string narrative
    for (const playerTrace of playerTraces) {
      expect(typeof playerTrace.narrative).toBe("string");
      expect(playerTrace.narrative!.length).toBeGreaterThan(0);
    }
    for (const npcTrace of npcTraces) {
      expect(npcTrace.narrative).toBeNull();
      expect(npcTrace.visibleClaims).toBeDefined();
      expect(npcTrace.committedEvents).toBeDefined();
    }

    store.close();
  });

  it("determines direct execution correctly even when path contains spaces and unicode characters", () => {
    const complexPath = resolve("E:/AI Projects/东方狂想/dist/smoke/closed-inn-harness.js");
    const moduleUrl = pathToFileURL(complexPath).href;

    // 1. matching entry -> true
    expect(isDirectExecution(moduleUrl, complexPath)).toBe(true);

    // 2. different entry -> false
    const otherPath = resolve("E:/AI Projects/东方狂想/dist/smoke/other-module.js");
    expect(isDirectExecution(moduleUrl, otherPath)).toBe(false);

    // 3. undefined argv entry -> false
    expect(isDirectExecution(moduleUrl, undefined)).toBe(false);
  });
});
