import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../../src/engine/context-builder.js";
import {
  DEFAULT_SIMULATION_INSTRUCTIONS,
  MAX_SIMULATION_VALIDATION_DIAGNOSTICS,
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
  it("publishes an explicit provider-agnostic contract for all actor Proposal types", () => {
    expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain('{"proposals":[...]}');
    expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain('{"proposals":[]}');
    expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain("JSON only");
    expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain("markdown code fences");
    expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain("prose");

    for (const type of [
      "character.move",
      "character.die",
      "character.learn_claim",
      "relationship.change",
      "claim.record",
      "world.time_advance",
    ]) {
      expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain(type);
    }
    for (const field of [
      "actorId",
      "toLocationId",
      "claimId",
      "knowledgeState",
      "source",
      "sourceCharacterId",
      "eventId",
      "targetCharacterId",
      "trustDelta",
      "hostilityDelta",
      "closenessDelta",
      "relationshipType",
      "subject",
      "predicate",
      "object",
      "toTime",
    ]) {
      expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain(field);
    }
    for (const forbiddenField of [
      "worldId",
      "expectedWorldRevision",
      "occurredAt",
      "causeEventIds",
      "fact.assert",
    ]) {
      expect(DEFAULT_SIMULATION_INSTRUCTIONS).toContain(forbiddenField);
    }
  });

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

  it("rejects model-controlled occurredAt even on an otherwise-valid proposal", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [{
        ...moveProposal(ids.characters.player.id, ids.locations.tokyo.id),
        occurredAt: TEST_TIME,
      }],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
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

  it("passes bounded schema paths, codes, and messages to one repair attempt", async () => {
    const { store, ids, context } = createHarness();
    const rawSecret = "RAW_MODEL_OUTPUT_SECRET";
    const malformedOutput = {
      proposals: [{
        type: "character.move",
        actorId: 123,
        rawSecret,
      }],
    };
    const validOutput = { proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)] };
    const model = new FakeModel(malformedOutput, validOutput);
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到东京",
    });

    expect(result.proposals).toEqual(validOutput.proposals);
    const repairReason = model.calls[1]!.repair?.reason ?? "";
    expect(repairReason).toContain("proposals.0.actorId");
    expect(repairReason).toContain("invalid_type");
    expect(repairReason).toContain("expected string");
    expect(repairReason).not.toContain(rawSecret);
    expect(repairReason).not.toContain("SimulationModelRequest");
    store.close();
  });

  it("limits schema repair diagnostics to a small fixed number", async () => {
    const { store, ids, context } = createHarness();
    const malformedOutput = {
      proposals: Array.from({ length: 20 }, () => ({ type: "character.move" })),
    };
    const validOutput = { proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)] };
    const model = new FakeModel(malformedOutput, validOutput);
    const adapter = new SimulationAdapter(model);

    await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "修复多个 schema 问题",
    });

    const repairReason = model.calls[1]!.repair?.reason ?? "";
    expect((repairReason.match(/proposals\./g) ?? [])).toHaveLength(MAX_SIMULATION_VALIDATION_DIAGNOSTICS);
    expect(repairReason).toContain("additional validation issue(s) omitted");
    store.close();
  });

  it("gives actor authority failures an actionable repair reason", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [moveProposal(ids.characters.zhao.id, ids.locations.tokyo.id)],
    };
    const validOutput = { proposals: [moveProposal(ids.characters.player.id, ids.locations.tokyo.id)] };
    const model = new FakeModel(invalidOutput, validOutput);
    const adapter = new SimulationAdapter(model);

    await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "让其他角色移动",
    });

    const repairReason = model.calls[1]!.repair?.reason ?? "";
    expect(repairReason).toContain("proposals.0.actorId");
    expect(repairReason).toContain("Proposal actor must match context.observer.id");
    store.close();
  });

  it("keeps invalid JSON repair and final errors explicit", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel("not-json", "still-not-json");
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "返回 JSON",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(model.calls[1]!.repair?.reason).toBe("Model output was not valid JSON");
    expect(error.message).toContain("Model output was not valid JSON");
    expect(error.context.validationSummary).toBe("Model output was not valid JSON");
    store.close();
  });

  it("includes the final sanitized validation summary in MODEL_OUTPUT_INVALID", async () => {
    const { store, ids, context } = createHarness();
    const malformedOutput = { proposals: [{ type: "character.move" }] };
    const model = new FakeModel(malformedOutput, malformedOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "重复返回 malformed proposal",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.message).toContain("proposals.0.actorId");
    expect(error.message).toContain("proposals.0.toLocationId");
    expect(error.context.validationSummary).toContain("proposals.0.actorId");
    expect(error.context).not.toHaveProperty("rawOutput");
    expect(error.context).not.toHaveProperty("prompt");
    store.close();
  });

  it("rejects model-controlled causeEventIds even on an otherwise-valid proposal", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [{
        ...moveProposal(ids.characters.player.id, ids.locations.tokyo.id),
        causeEventIds: [],
      }],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
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

  it("schema-validates every currently supported proposal type", async () => {
    const { store, ids, context } = createHarness();
    const model = new FakeModel({
      proposals: [
        moveProposal(ids.characters.player.id, ids.locations.tokyo.id),
        {
          type: "character.die",
          actorId: ids.characters.player.id,
        },
        {
          type: "character.learn_claim",
          actorId: ids.characters.player.id,
          claimId: ids.secretClaim.id,
          knowledgeState: "rumor",
          source: { kind: "character", characterId: ids.characters.zhao.id },
        },
        {
          type: "relationship.change",
          sourceCharacterId: ids.characters.player.id,
          targetCharacterId: ids.characters.zhao.id,
          trustDelta: 5,
        },
        {
          type: "claim.record",
          claimId: "claim-proposal",
          actorId: ids.characters.player.id,
          subject: ids.characters.zhao.id,
          predicate: "reported_status",
          object: "uncertain",
        },
        {
          type: "world.time_advance",
          toTime: "2019-03-12T13:00:00.000Z",
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
      "claim.record",
      "world.time_advance",
    ]);
    for (const proposal of result.proposals) {
      expect(proposal).not.toHaveProperty("occurredAt");
      expect(proposal).not.toHaveProperty("causeEventIds");
      expect(proposal).not.toHaveProperty("worldId");
      expect(proposal).not.toHaveProperty("expectedWorldRevision");
    }
    store.close();
  });

  it("rejects actorless claim.record proposals", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [{
        type: "claim.record",
        claimId: "claim-without-actor",
        subject: ids.characters.zhao.id,
        predicate: "reported_status",
        object: "uncertain",
      }],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "记录命题",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("rejects claim.record attributed to another Character", async () => {
    const { store, ids, context } = createHarness();
    const invalidOutput = {
      proposals: [{
        type: "claim.record",
        actorId: ids.characters.zhao.id,
        claimId: "claim-wrong-actor",
        subject: ids.characters.zhao.id,
        predicate: "reported_status",
        object: "uncertain",
      }],
    };
    const model = new FakeModel(invalidOutput, invalidOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "让赵雅记录命题",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    store.close();
  });

  it("accepts an actor-attributed claim.record proposal", async () => {
    const { store, ids, context } = createHarness();
    const proposal = {
      type: "claim.record",
      actorId: ids.characters.player.id,
      claimId: "claim-attributed",
      subject: ids.characters.zhao.id,
      predicate: "reported_status",
      object: "uncertain",
    };
    const model = new FakeModel({ proposals: [proposal] });
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "记录命题",
    });

    expect(result.proposals).toEqual([proposal]);
    expect(result.diagnostics.proposalCount).toBe(1);
    store.close();
  });

  it("rejects fact.assert from the actor Simulation Adapter surface", async () => {
    const { store, ids, context } = createHarness();
    const unsupportedOutput = {
      proposals: [{
        type: "fact.assert",
        factId: "fact-actor-forbidden",
        actorId: ids.characters.player.id,
        subject: ids.characters.zhao.id,
        predicate: "objective_status",
        object: "guilty",
        validFrom: TEST_TIME,
      }],
    };
    const model = new FakeModel(unsupportedOutput, unsupportedOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "把猜测变成事实",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
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

  it("accepts valid claim.transmit proposal when sourceCharacterId matches actorCharacterId", async () => {
    const { store, ids, context } = createHarness();
    const validOutput = {
      proposals: [{
        type: "claim.transmit",
        sourceCharacterId: ids.characters.player.id,
        targetCharacterId: ids.characters.zhao.id,
        claimId: ids.secretClaim.id,
      }],
    };
    const model = new FakeModel(validOutput);
    const adapter = new SimulationAdapter(model);

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "向赵雅传播信息",
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toEqual({
      type: "claim.transmit",
      sourceCharacterId: ids.characters.player.id,
      targetCharacterId: ids.characters.zhao.id,
      claimId: ids.secretClaim.id,
    });
    store.close();
  });

  it("rejects claim.transmit proposal when sourceCharacterId does not match actorCharacterId", async () => {
    const { store, ids, context } = createHarness();
    const mismatchedOutput = {
      proposals: [{
        type: "claim.transmit",
        sourceCharacterId: ids.characters.zhao.id, // Zhao instead of Player (actor)
        targetCharacterId: ids.characters.player.id,
        claimId: ids.secretClaim.id,
      }],
    };
    const model = new FakeModel(mismatchedOutput, mismatchedOutput);
    const adapter = new SimulationAdapter(model);

    const error = await expectAdapterError(
      () => adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "传播信息",
      }),
      "MODEL_OUTPUT_INVALID",
    );

    expect(error.diagnostics.attempts).toBe(2);
    expect(model.calls[1]!.repair?.reason).toContain("sourceCharacterId");
    store.close();
  });
});
