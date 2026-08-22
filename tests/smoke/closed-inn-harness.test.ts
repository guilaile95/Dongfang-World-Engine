import { describe, expect, it } from "vitest";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import {
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

    // Turn 3: Player moves to cellar after learning about the dagger
    if (this.turnCount === 3) {
      const knowsCellar = request.context.knowledge.some((k) => k.claim.id === "claim-dagger-in-cellar");
      if (!knowsCellar) {
        throw new Error("Player expected to know claim-dagger-in-cellar on Turn 3");
      }
      return {
        proposals: [{
          type: "character.move",
          actorId,
          toLocationId: "location-cellar",
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

    // Turn 6: Player returns to hall from cellar
    if (this.turnCount === 6) {
      return {
        proposals: [{
          type: "character.move",
          actorId,
          toLocationId: "location-inn-hall",
        }],
      };
    }

    // Turn 7: Player transmits cellar claim to NPC-B
    if (this.turnCount === 7) {
      return {
        proposals: [{
          type: "claim.transmit",
          sourceCharacterId: actorId,
          targetCharacterId: "character-npc-b",
          claimId: "claim-dagger-in-cellar",
        }],
      };
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

    // Turn 9: NPC-A
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
  public async generate(request: NarrativeModelRequest): Promise<string> {
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
    expect(result.assertionsPassed).toBe(true);

    // Turn 1: Player empty observation
    expect(result.traces[0]?.actorId).toBe("character-player");
    expect(result.traces[0]?.turnStatus).toBe("empty");
    expect(result.traces[0]?.visibleClaimIds).toEqual([]); // Player starts with 0 knowledge

    // Turn 2: NPC-A transmits true cellar claim to Player
    expect(result.traces[1]?.actorId).toBe("character-npc-a");
    expect(result.traces[1]?.turnStatus).toBe("success");
    expect(result.traces[1]?.committedEvents).toHaveLength(1);
    expect(result.traces[1]?.committedEvents[0]?.type).toBe("claim.transmit");

    // Turn 3: Player now legally has claim-dagger-in-cellar visible in Context!
    expect(result.traces[2]?.actorId).toBe("character-player");
    expect(result.traces[2]?.visibleClaimIds).toContain("claim-dagger-in-cellar");
    expect(result.traces[2]?.committedEvents[0]?.type).toBe("character.move");

    // Turn 4: NPC-B acts while holding false claim
    expect(result.traces[3]?.actorId).toBe("character-npc-b");
    expect(result.traces[3]?.visibleClaimIds).toContain("claim-dagger-in-guestroom");
    expect(result.traces[3]?.committedEvents[0]?.type).toBe("relationship.change");

    // Turn 7: Player transmits cellar claim to NPC-B
    expect(result.traces[6]?.actorId).toBe("character-player");
    expect(result.traces[6]?.committedEvents[0]?.type).toBe("claim.transmit");

    // Turn 8: NPC-B now legally has claim-dagger-in-cellar visible in Context!
    expect(result.traces[7]?.actorId).toBe("character-npc-b");
    expect(result.traces[7]?.visibleClaimIds).toContain("claim-dagger-in-cellar");

    // Verify all 10 turn narratives are non-empty bounded plain text
    for (const trace of result.traces) {
      expect(typeof trace.narrative).toBe("string");
      expect(trace.narrative.length).toBeGreaterThan(0);
      expect(trace.narrative).not.toContain("fact-hidden-dagger-cellar");
    }

    // Verify final world revision matches number of committed events
    const allEvents = store.listEvents(result.fixture.world.id);
    expect(result.finalWorldRevision).toBe(allEvents.length);
    expect(result.finalWorldRevision).toBe(6);

    store.close();
  });
});
