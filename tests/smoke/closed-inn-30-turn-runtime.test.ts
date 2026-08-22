import { describe, expect, it } from "vitest";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import {
  runClosedInnTurns,
  type TurnStepConfig,
} from "../../src/smoke/closed-inn-harness.js";
import type {
  SimulationModelClient,
  SimulationModelRequest,
} from "../../src/engine/simulation-adapter.js";
import type {
  NarrativeModelClient,
  NarrativeModelRequest,
} from "../../src/engine/narrative.js";

const ACTOR_SEQUENCE = [
  "character-player",
  "character-npc-a",
  "character-npc-b",
  "character-npc-c",
] as const;

const PLAYER_INTENT = "根据当前合法可见的信息观察、询问、调查、判断并决定下一步行动。";
const NPC_INTENT = "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。";

class EmptySimulationModel implements SimulationModelClient {
  public async generate(_request: SimulationModelRequest): Promise<unknown> {
    return { proposals: [] };
  }
}

class RecordingNarrativeModel implements NarrativeModelClient {
  public readonly requests: NarrativeModelRequest[] = [];

  public async generate(request: NarrativeModelRequest): Promise<string> {
    this.requests.push(request);
    return "deterministic player narrative";
  }
}

function buildSteps(): TurnStepConfig[] {
  return Array.from({ length: 30 }, (_, index) => {
    const actorId = ACTOR_SEQUENCE[index % ACTOR_SEQUENCE.length]!;
    return {
      actorId,
      intent: actorId === "character-player" ? PLAYER_INTENT : NPC_INTENT,
    };
  });
}

describe("Closed Inn 30-turn runtime regression", () => {
  it("executes a deterministic empty-model run with safe replayable traces", async () => {
    const store = new SqliteWorldStore();
    const simulationModel = new EmptySimulationModel();
    const narratorModel = new RecordingNarrativeModel();

    try {
      const steps = buildSteps();
      const result = await runClosedInnTurns({
        store,
        simulationModel,
        narratorModel,
        steps,
      });

      const expectedActorIds = Array.from(
        { length: 30 },
        (_, index) => ACTOR_SEQUENCE[index % ACTOR_SEQUENCE.length]!,
      );
      expect(steps).toHaveLength(30);
      expect(steps.map((step) => step.actorId)).toEqual(expectedActorIds);
      expect(result.traces).toHaveLength(30);
      expect(result.traces.map((trace) => trace.turnIndex)).toEqual(
        Array.from({ length: 30 }, (_, index) => index + 1),
      );
      expect(result.traces.map((trace) => trace.actorId)).toEqual(expectedActorIds);
      expect(expectedActorIds.filter((actorId) => actorId === "character-player")).toHaveLength(8);
      expect(expectedActorIds.filter((actorId) => actorId === "character-npc-a")).toHaveLength(8);
      expect(expectedActorIds.filter((actorId) => actorId === "character-npc-b")).toHaveLength(7);
      expect(expectedActorIds.filter((actorId) => actorId === "character-npc-c")).toHaveLength(7);

      expect(result.replayConsistent).toBe(true);
      expect(result.finalWorldRevision).toBe(0);
      expect(narratorModel.requests).toHaveLength(8);

      for (const request of narratorModel.requests) {
        expect(request.envelope.observerContext.observer.id).toBe("character-player");
      }

      for (const trace of result.traces) {
        expect(trace.committedEvents).toEqual([]);

        if (trace.actorId === "character-player") {
          expect(typeof trace.narrative).toBe("string");
          expect(trace.narrative!.trim().length).toBeGreaterThan(0);
          expect(trace.narrative).not.toContain("fact-hidden-dagger-cellar");
        } else {
          expect(trace.narrative).toBeNull();
        }
      }
    } finally {
      store.close();
    }
  });
});
