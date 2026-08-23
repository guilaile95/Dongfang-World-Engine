import { describe, expect, it } from "vitest";
import { CommitKernel, type CommitResult } from "../../src/engine/commit-kernel.js";
import type { SimulationModelClient, SimulationModelRequest } from "../../src/engine/simulation-adapter.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import {
  commitAuthoredInterventionFromEvent,
  runCanonDivergenceScenario,
} from "../../src/smoke/canon-divergence-harness.js";
import {
  CANON_DIVERGENCE_T1,
  seedCanonDivergenceWorld,
} from "../../src/testkit/canon-divergence-world.js";

class StaticSimulationModel implements SimulationModelClient {
  public readonly requests: SimulationModelRequest[] = [];

  public constructor(private readonly output: unknown) {}

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    this.requests.push(request);
    return this.output;
  }
}

function createKernel(store: SqliteWorldStore, suffix: string): CommitKernel {
  let nextEventId = 0;
  return new CommitKernel(store, {
    clock: () => CANON_DIVERGENCE_T1,
    idFactory: () => `event-binding-adversarial-${suffix}-${String(++nextEventId).padStart(2, "0")}`,
  });
}

function requireCommitted(result: CommitResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.event;
}

describe("Canon divergence trusted authored action binding", () => {
  it("runs the control path without treating raw intent as an authoritative intervention", async () => {
    const store = new SqliteWorldStore();
    const model = new StaticSimulationModel({ proposals: [] });
    try {
      const result = await runCanonDivergenceScenario({
        store,
        simulationModel: model,
        fixtureSuffix: "player-action",
        playerIntent: "我现在就前往西塔并阻止旧命令。",
      });
      const snapshot = store.getSnapshot(result.fixture.worldId);

      expect(result.playerTurn).toEqual({
        status: "empty",
        committedEvents: [],
        rejection: null,
      });
      expect(result.authoredConsequence).toEqual({
        triggered: false,
        sourceEventWorldRevision: null,
        committedEventWorldRevision: null,
      });
      expect(result.oldCanonAttempt).toEqual({
        committed: true,
        rejectionCode: null,
        rejectionLeftStateUnchanged: null,
      });
      expect(result.independentEvent).toEqual({ type: "fact.assert", worldRevision: 3 });
      expect(result.finalWorldRevision).toBe(3);
      expect(result.committedEventCount).toBe(3);
      expect(result.replayConsistent).toBe(true);
      expect(snapshot.characters.find((character) => character.id === result.fixture.playerId)?.locationId)
        .not.toBe(result.fixture.interventionLocationId);
      expect(snapshot.facts).toContainEqual(expect.objectContaining({
        predicate: "delivery_outcome",
        object: "old_canon_arrest",
      }));
      expect(snapshot.facts.some((fact) => fact.object === "west_tower" && fact.predicate === "watch_route"))
        .toBe(false);
      expect(model.requests).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("binds only the committed Player move to B', rejects direct old C, and preserves D plus replay", async () => {
    const store = new SqliteWorldStore();
    let interventionLocationId = "";
    const model: SimulationModelClient = {
      async generate(request) {
        const westTower = request.context.movementOptions.find((option) => option.name === "West Tower");
        if (!westTower) {
          throw new Error("Expected the observer-safe West Tower movement option");
        }
        interventionLocationId = westTower.locationId;
        return {
          proposals: [{
            type: "character.move",
            actorId: request.context.observer.id,
            toLocationId: westTower.locationId,
          }],
        };
      },
    };

    try {
      const result = await runCanonDivergenceScenario({
        store,
        simulationModel: model,
        fixtureSuffix: "player-action",
      });
      const snapshot = store.getSnapshot(result.fixture.worldId);
      const events = store.listEvents(result.fixture.worldId);
      const moveEvent = events.find((event) => event.type === "character.move");
      const interventionFact = snapshot.facts.find(
        (fact) => fact.predicate === "watch_route" && fact.object === "west_tower",
      );
      const interventionEvent = interventionFact?.sourceEventId
        ? store.getEvent(interventionFact.sourceEventId)
        : null;

      expect(interventionLocationId).toBe(result.fixture.interventionLocationId);
      expect(result.playerTurn).toEqual({
        status: "success",
        committedEvents: [{ type: "character.move", worldRevision: 2 }],
        rejection: null,
      });
      expect(result.authoredConsequence).toEqual({
        triggered: true,
        sourceEventWorldRevision: 2,
        committedEventWorldRevision: 3,
      });
      expect(result.oldCanonAttempt).toEqual({
        committed: false,
        rejectionCode: "FACT_PRECONDITION_FAILED",
        rejectionLeftStateUnchanged: true,
      });
      expect(result.independentEvent).toEqual({ type: "fact.assert", worldRevision: 4 });
      expect(result.finalWorldRevision).toBe(4);
      expect(result.committedEventCount).toBe(4);
      expect(result.replayConsistent).toBe(true);

      expect(snapshot.characters.find((character) => character.id === result.fixture.playerId)?.locationId)
        .toBe(result.fixture.interventionLocationId);
      expect(snapshot.facts.find((fact) => fact.predicate === "watch_route" && fact.object === "east_gate")?.validTo)
        .toBe("2031-04-05T14:00:00.000Z");
      expect(interventionFact).toEqual(expect.objectContaining({
        object: "west_tower",
        validTo: null,
      }));
      expect(interventionEvent?.actorIds).toEqual([result.fixture.playerId]);
      expect(interventionEvent?.causeEventIds).toEqual([moveEvent?.id]);
      expect(snapshot.facts.some((fact) => fact.object === "old_canon_arrest")).toBe(false);
      expect(snapshot.facts).toContainEqual(expect.objectContaining({
        predicate: "dawn_market_status",
        object: "open",
      }));

      const safeJson = JSON.stringify(result);
      expect(safeJson).not.toContain("fact-hidden-canon-trigger");
      expect(safeJson).not.toContain("sealed_order_status");
      expect(safeJson).not.toContain("factAssertionRequirements");
      expect(safeJson).not.toContain("payload");
      expect(safeJson).not.toContain("state");
      expect(safeJson).not.toContain("raw");
    } finally {
      store.close();
    }
  });

  it("does not trigger B' when unsupported fact.assert output produces no committed actor Event", async () => {
    const store = new SqliteWorldStore();
    const model = new StaticSimulationModel({
      proposals: [{
        type: "fact.assert",
        worldId: "model-controlled-world",
        expectedWorldRevision: 0,
        occurredAt: CANON_DIVERGENCE_T1,
        causeEventIds: [],
        factId: "model-fact",
        subject: "model-subject",
        predicate: "model-predicate",
        object: "model-object",
        validFrom: CANON_DIVERGENCE_T1,
      }],
    });
    try {
      const result = await runCanonDivergenceScenario({
        store,
        simulationModel: model,
        fixtureSuffix: "unsupported-fact",
      });
      const snapshot = store.getSnapshot(result.fixture.worldId);

      expect(result.playerTurn.status).toBe("rejected");
      expect(result.playerTurn.committedEvents).toEqual([]);
      expect(result.playerTurn.rejection).toEqual({
        kind: "simulation",
        code: "MODEL_OUTPUT_INVALID",
      });
      expect(result.authoredConsequence.triggered).toBe(false);
      expect(result.oldCanonAttempt.committed).toBe(true);
      expect(result.finalWorldRevision).toBe(3);
      expect(result.committedEventCount).toBe(3);
      expect(result.replayConsistent).toBe(true);
      expect(snapshot.facts.some((fact) => fact.id === "model-fact")).toBe(false);
      expect(model.requests).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it.each([
    { name: "missing Event id", actor: "missing", destination: "west" },
    { name: "another actor's move", actor: "npc", destination: "west" },
    { name: "Player move to another destination", actor: "player", destination: "east" },
  ])("does not bind $name", ({ actor, destination }) => {
    const store = new SqliteWorldStore();
    try {
      const fixture = seedCanonDivergenceWorld(store, `adversarial-${actor}-${destination}`);
      const kernel = createKernel(store, `${actor}-${destination}`);
      let sourceEventId = "event-does-not-exist";

      if (actor !== "missing") {
        const event = requireCommitted(kernel.commit({
          type: "character.move",
          worldId: fixture.worldId,
          expectedWorldRevision: 0,
          actorId: actor === "player" ? fixture.playerId : fixture.npcAId,
          toLocationId: destination === "west" ? fixture.westTowerId : fixture.eastGateId,
          occurredAt: CANON_DIVERGENCE_T1,
          causeEventIds: [],
        }));
        sourceEventId = event.id;
      }

      const before = store.getSnapshot(fixture.worldId);
      const eventCountBefore = store.listEvents(fixture.worldId).length;
      expect(commitAuthoredInterventionFromEvent(store, kernel, fixture, sourceEventId)).toBeNull();
      expect(store.getSnapshot(fixture.worldId)).toEqual(before);
      expect(store.listEvents(fixture.worldId)).toHaveLength(eventCountBefore);
      expect(before.facts.some((fact) => fact.object === "west_tower" && fact.predicate === "watch_route"))
        .toBe(false);
    } finally {
      store.close();
    }
  });

  it("does not bind a matching move after another committed Event has advanced the World head", () => {
    const store = new SqliteWorldStore();
    try {
      const fixture = seedCanonDivergenceWorld(store, "stale-source-event");
      const kernel = createKernel(store, "stale-source-event");
      const move = requireCommitted(kernel.commit({
        type: "character.move",
        worldId: fixture.worldId,
        expectedWorldRevision: 0,
        actorId: fixture.playerId,
        toLocationId: fixture.westTowerId,
        occurredAt: CANON_DIVERGENCE_T1,
        causeEventIds: [],
      }));
      requireCommitted(kernel.commit({
        type: "world.time_advance",
        worldId: fixture.worldId,
        expectedWorldRevision: 1,
        toTime: "2031-04-05T14:00:00.000Z",
        occurredAt: CANON_DIVERGENCE_T1,
        causeEventIds: [],
      }));

      const before = store.getSnapshot(fixture.worldId);
      expect(commitAuthoredInterventionFromEvent(store, kernel, fixture, move.id)).toBeNull();
      expect(store.getSnapshot(fixture.worldId)).toEqual(before);
      expect(before.world.revision).toBe(2);
      expect(before.facts.some((fact) => fact.object === "west_tower" && fact.predicate === "watch_route"))
        .toBe(false);
    } finally {
      store.close();
    }
  });
});
