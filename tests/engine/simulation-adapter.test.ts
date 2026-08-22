import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import {
  SimulationAdapter,
  SimulationAdapterError,
  type SimulationAdapterErrorCode,
  type SimulationModelClient,
  type SimulationModelRequest,
} from "../../src/engine/simulation-adapter.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";

class FakeModel implements SimulationModelClient {
  public readonly calls: SimulationModelRequest[] = [];
  private readonly responses: unknown[];

  public constructor(...responses: unknown[]) {
    this.responses = [...responses];
  }

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    this.calls.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw new Error("Fake model has no response left");
    }
    return response;
  }
}

function createHarness() {
  const store = new SqliteWorldStore();
  const ids = seedTestWorld(store);
  const context = new ContextBuilder(store).buildCharacterContext({
    worldId: ids.world.id,
    observerCharacterId: ids.characters.player.id,
    budget: 10,
  });
  return { store, ids, context };
}

function moveProposal(actorId: string, toLocationId: string): Record<string, unknown> {
  return {
    type: "character.move",
    actorId,
    toLocationId,
    occurredAt: TEST_TIME,
    causeEventIds: [],
  };
}

async function expectAdapterError(
  action: () => Promise<unknown>,
  code: SimulationAdapterErrorCode,
): Promise<SimulationAdapterError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SimulationAdapterError);
  if (!(caught instanceof SimulationAdapterError)) {
    throw new Error(`Expected ${code}, but no SimulationAdapterError was thrown`);
  }
  expect(caught.code).toBe(code);
  return caught;
}

describe("Simulation Adapter MVP", () => {
  it("uses only the supplied filtered CharacterContext and can return zero proposals", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel({ proposals: [] });
    const adapter = new SimulationAdapter(model, { modelId: "fake-model" });

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "观察周围",
    });

    expect(result.proposals).toEqual([]);
    expect(result.diagnostics).toEqual({
      modelId: "fake-model",
      attempts: 1,
      proposalCount: 0,
      repaired: false,
      status: "empty",
    });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.context).toBe(context);
    expect(model.calls[0]!.intent).toBe("观察周围");
    expect(model.calls[0]!.instructions).toContain("worldId");
    expect(model.calls[0]!.attempt).toBe(1);
    expect(model.calls[0]).not.toHaveProperty("store");
    expect(model.calls[0]).not.toHaveProperty("snapshot");
    store.close();
  });

  it("rejects an actor different from the Context observer before model invocation", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel({ proposals: [] });
    const adapter = new SimulationAdapter(model);

    await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.npcA.id,
        intent: "移动",
      }),
      "INVALID_REQUEST",
    );

    expect(model.calls).toHaveLength(0);
    store.close();
  });

  it("rejects blank intent before model invocation", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel({ proposals: [] });
    const adapter = new SimulationAdapter(model);

    await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "   \n\t",
      }),
      "INVALID_REQUEST",
    );

    expect(model.calls).toHaveLength(0);
    store.close();
  });

  it("preserves the order of multiple typed proposals", async () => {
    const { store, ids, context } = createHarness();
    const first = moveProposal(ids.characters.player.id, ids.locations.tokyo.id);
    const second = {
      type: "character.die",
      actorId: ids.characters.player.id,
      occurredAt: TEST_TIME,
      causeEventIds: [],
    };
    const model = new FakeModel({ proposals: [first, second] });
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "先移动，再承担风险",
    });

    expect(result.proposals.map((proposal) => proposal.type)).toEqual([
      "character.move",
      "character.die",
    ]);
    expect(result.proposals[0]).toEqual(first);
    expect(result.proposals[1]).toEqual(second);
    store.close();
  });

  it("schema-validates every currently supported proposal type", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel({
      proposals: [
        moveProposal(ids.characters.player.id, ids.locations.tokyo.id),
        {
          type: "character.die",
          actorId: ids.characters.player.id,
          occurredAt: TEST_TIME,
          causeEventIds: [],
        },
        {
          type: "character.learn_claim",
          actorId: ids.characters.player.id,
          claimId: ids.secretClaim.id,
          knowledgeState: "rumor",
          source: { kind: "character", characterId: ids.characters.zhao.id },
          occurredAt: TEST_TIME,
          causeEventIds: [],
        },
        {
          type: "relationship.change",
          sourceCharacterId: ids.characters.player.id,
          targetCharacterId: ids.characters.zhao.id,
          trustDelta: 5,
          occurredAt: TEST_TIME,
          causeEventIds: [],
        },
        {
          type: "fact.assert",
          factId: "fact-proposal",
          actorId: ids.characters.player.id,
          subject: ids.characters.zhao.id,
          predicate: "observed_status",
          object: "present",
          validFrom: TEST_TIME,
          occurredAt: TEST_TIME,
          causeEventIds: [],
        },
        {
          type: "claim.record",
          claimId: "claim-proposal",
          actorId: ids.characters.player.id,
          subject: ids.characters.zhao.id,
          predicate: "reported_status",
          object: "uncertain",
          occurredAt: TEST_TIME,
          causeEventIds: [],
        },
        {
          type: "world.time_advance",
          toTime: "2019-03-12T13:00:00.000Z",
          occurredAt: "2019-03-12T13:00:00.000Z",
          causeEventIds: [],
        },
      ],
    });
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "提出一组合法候选",
    });

    expect(result.proposals.map((proposal) => proposal.type)).toEqual([
      "character.move",
      "character.die",
      "character.learn_claim",
      "relationship.change",
      "fact.assert",
      "claim.record",
      "world.time_advance",
    ]);
    store.close();
  });

  it("rejects an unknown action type deterministically", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [{ ...moveProposal(ids.characters.player.id, ids.locations.tokyo.id), type: "combat.attack" }],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "攻击",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("rejects model-supplied worldId and expectedWorldRevision authority metadata", async () => {
    const { store, ids, context } = createHarness();
    const pollutedOutput = {
      proposals: [{
        ...moveProposal(ids.characters.player.id, ids.locations.tokyo.id),
        worldId: ids.world.id,
        expectedWorldRevision: 999,
      }],
    };
    const model = new FakeModel(pollutedOutput, pollutedOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "移动",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("uses at most one repair attempt for malformed first output", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel(
      { proposals: [{ type: "character.move" }] },
      { proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)] },
    );
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到东京",
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.diagnostics).toEqual({
      modelId: "injected-model",
      attempts: 2,
      proposalCount: 1,
      repaired: true,
      status: "success",
    });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.repair).toEqual(expect.objectContaining({ reason: expect.any(String) }));
    store.close();
  });

  it("returns a stable error after a second malformed response without a third call", async () => {
    const { store, ids, context } = createHarness();
    const malformed = { proposals: [{ type: "character.move" }] };
    const model = new FakeModel(malformed, malformed);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "移动",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.errorCategory).toBe("schema");
    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("surfaces transport failure without retrying", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel(new Error("network unavailable"));
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "观察",
      }),
      "MODEL_TRANSPORT_ERROR",
    );

    expect(error.diagnostics.errorCategory).toBe("transport");
    expect(error.diagnostics.attempts).toBe(1);
    expect(model.calls).toHaveLength(1);
    store.close();
  });

  it("rejects a proposal that tries to act as another Character", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [moveProposal(ids.characters.zhao.id, ids.locations.tokyo.id)],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
    const adapter = new SimulationAdapter(model);

    await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "让赵雅移动",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("does not write Events, State, or World revision", async () => {
    const { store, ids, context } = createHarness();
    const beforeSnapshot = store.getSnapshot(ids.world.id);
    const beforeEvents = store.listEvents(ids.world.id);
    const model = new FakeModel({
      proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)],
    });
    const adapter = new SimulationAdapter(model);

    await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "移动",
    });

    expect(store.getSnapshot(ids.world.id)).toEqual(beforeSnapshot);
    expect(store.listEvents(ids.world.id)).toEqual(beforeEvents);
    store.close();
  });

  it("returns deterministic output for the same fake response and Context", async () => {
    const { store, ids, context } = createHarness();
    const response = {
      proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)],
    };
    const first = await new SimulationAdapter(new FakeModel(response), { modelId: "deterministic-fake" }).generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "移动",
    });
    const second = await new SimulationAdapter(new FakeModel(response), { modelId: "deterministic-fake" }).generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "移动",
    });

    expect(second).toEqual(first);
    store.close();
  });
});
