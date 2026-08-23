import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import {
  NarrativeEnvelopeBuilder,
  Narrator,
  type NarrativeModelClient,
  type NarrativeModelRequest,
} from "../../src/engine/narrative.js";
import type { SimulationModelClient } from "../../src/engine/simulation-adapter.js";
import type { TurnResult } from "../../src/engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import { runCanonDivergenceScenario } from "../../src/smoke/canon-divergence-harness.js";

describe("Canon divergence Player-legible consequence", () => {
  it("routes the trusted consequence through Claim/Knowledge into the existing safe NarrativeEnvelope", async () => {
    const store = new SqliteWorldStore();
    const simulationModel: SimulationModelClient = {
      async generate(request) {
        const westTower = request.context.movementOptions.find((option) => option.name === "West Tower");
        if (!westTower) {
          throw new Error("Expected observer-safe West Tower movement option");
        }
        return {
          proposals: [{
            type: "character.move",
            actorId: request.context.observer.id,
            toLocationId: westTower.locationId,
          }],
        };
      },
    };
    const narrativeRequests: NarrativeModelRequest[] = [];
    const narrativeModel: NarrativeModelClient = {
      async generate(request) {
        narrativeRequests.push(request);
        return "你确认守卫路线已经改往西塔，旧命令不再按原路线执行。";
      },
    };

    try {
      const result = await runCanonDivergenceScenario({
        store,
        simulationModel,
        fixtureSuffix: "player-legible",
      });
      const snapshot = store.getSnapshot(result.fixture.worldId);
      const events = store.listEvents(result.fixture.worldId);
      const moveEvent = events.find(
        (event) => event.type === "character.move" && event.actorIds.includes(result.fixture.playerId),
      );
      const interventionEvent = events.find(
        (event) => event.type === "fact.assert" && event.payload.predicate === "watch_route" &&
          event.payload.object === "west_tower",
      );
      const claimEvent = events.find(
        (event) => event.type === "claim.record" && event.payload.predicate === "watch_route" &&
          event.payload.object === "west_tower",
      );
      const learnEvent = events.find(
        (event) => event.type === "character.learn_claim" && event.actorIds.includes(result.fixture.playerId),
      );
      if (!moveEvent || !interventionEvent || !claimEvent || !learnEvent) {
        throw new Error("Expected complete move → B′ → Claim → Knowledge provenance chain");
      }

      expect(claimEvent.causeEventIds).toEqual([interventionEvent.id]);
      expect(learnEvent.causeEventIds).toEqual([claimEvent.id]);
      expect(learnEvent.payload.source).toEqual({ kind: "event", eventId: claimEvent.id });
      expect(snapshot.knowledge.filter((knowledge) => knowledge.claimId === claimEvent.payload.claimId)).toEqual([
        expect.objectContaining({
          characterId: result.fixture.playerId,
          knowledgeState: "confirmed",
          sourceType: "event",
          sourceEventId: claimEvent.id,
          sourceCharacterId: null,
          sourceSeedId: null,
        }),
      ]);

      const contextBuilder = new ContextBuilder(store);
      const playerContext = contextBuilder.buildCharacterContext({
        worldId: result.fixture.worldId,
        observerCharacterId: result.fixture.playerId,
      });
      expect(playerContext.knowledge).toHaveLength(1);
      expect(playerContext.knowledge[0]).toEqual(expect.objectContaining({
        claim: {
          id: claimEvent.payload.claimId,
          subject: interventionEvent.payload.subject,
          predicate: "watch_route",
          object: "west_tower",
        },
        knowledge: expect.objectContaining({
          characterId: result.fixture.playerId,
          claimId: claimEvent.payload.claimId,
          knowledgeState: "confirmed",
          sourceType: "event",
          sourceEventId: claimEvent.id,
        }),
        provenance: expect.objectContaining({
          sourceType: "event",
          sourceEventId: claimEvent.id,
          sourceEventType: "claim.record",
        }),
      }));

      const turnResult: TurnResult = {
        status: "success",
        worldId: result.fixture.worldId,
        actorCharacterId: result.fixture.playerId,
        committedEvents: [moveEvent],
        state: null,
        rejection: null,
        contextBuilds: 1,
        simulationAttempts: 1,
      };
      const envelope = new NarrativeEnvelopeBuilder(contextBuilder).build({
        intent: "前往西塔阻止旧命令",
        turnResult,
      });

      expect(envelope.outcomes).toEqual([{
        type: "character.move",
        actorId: result.fixture.playerId,
        toLocationId: result.fixture.interventionLocationId,
        eventTime: moveEvent.eventTime,
      }]);
      expect(envelope.observerContext.knowledge).toEqual(playerContext.knowledge);
      const serializedEnvelope = JSON.stringify(envelope);
      for (const forbidden of [
        `fact-hidden-canon-trigger-player-legible`,
        interventionEvent.id,
        "sealed_order_status",
        "old_canon_arrest",
        "dawn_market_status",
        "factAssertionRequirements",
        "WorldSnapshot",
        "payload",
        "raw prompt",
        "raw response",
        "chain-of-thought",
      ]) {
        expect(serializedEnvelope).not.toContain(forbidden);
      }

      const snapshotBeforeNarration = store.getSnapshot(result.fixture.worldId);
      const eventsBeforeNarration = store.listEvents(result.fixture.worldId);
      const narrative = await new Narrator(narrativeModel).generate(envelope);
      expect(narrative).toBe("你确认守卫路线已经改往西塔，旧命令不再按原路线执行。");
      expect(narrativeRequests).toEqual([{ instructions: expect.any(String), envelope }]);
      expect(store.getSnapshot(result.fixture.worldId)).toEqual(snapshotBeforeNarration);
      expect(store.listEvents(result.fixture.worldId)).toEqual(eventsBeforeNarration);
      expect(result.replayConsistent).toBe(true);
    } finally {
      store.close();
    }
  });
});
