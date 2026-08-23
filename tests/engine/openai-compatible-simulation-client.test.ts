import { describe, expect, it } from "vitest";
import { ContextBuilder, type CharacterContext } from "../../src/engine/context-builder.js";
import { CommitKernel } from "../../src/engine/commit-kernel.js";
import {
  OpenAICompatibleSimulationModelClient,
  OpenAICompatibleSimulationTransportError,
} from "../../src/engine/openai-compatible-simulation-client.js";
import {
  SimulationAdapter,
  SimulationAdapterError,
  type SimulationModelRequest,
} from "../../src/engine/simulation-adapter.js";
import { TurnOrchestrator } from "../../src/engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../../src/persistence/sqlite-store.js";
import { TEST_TIME, seedTestWorld } from "../../src/testkit/world-builder.js";

interface FetchCall {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
}

function createFetch(
  responder: (call: FetchCall, count: number) => Response | Promise<Response>,
): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { input, init };
    calls.push(call);
    return responder(call, calls.length);
  };
  return { calls, fetchImpl };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assistantResponse(content: string, status = 200): Response {
  return jsonResponse({
    choices: [{ message: { role: "assistant", content } }],
  }, status);
}

function fakeContext(): CharacterContext {
  return {
    world: {
      id: "world-test",
      currentTime: TEST_TIME,
      revision: 0,
      status: "active",
    },
    observer: {
      id: "character-player",
      worldId: "world-test",
      name: "Player",
      type: "player",
      alive: true,
      locationId: null,
      identity: "test-player",
      currentGoal: "test",
    },
    location: null,
    movementOptions: [],
    coLocatedCharacters: [],
    knowledge: [],
    relationships: [],
    packing: { budget: 0, visibleUnits: 0, usedUnits: 0, truncated: false },
  };
}

function modelRequest(overrides: Partial<SimulationModelRequest> = {}): SimulationModelRequest {
  return {
    context: fakeContext(),
    intent: "观察周围",
    instructions: "Return JSON only.",
    attempt: 1,
    ...overrides,
  };
}

async function expectTransportError(
  action: () => Promise<unknown>,
  kind: OpenAICompatibleSimulationTransportError["kind"],
): Promise<OpenAICompatibleSimulationTransportError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(OpenAICompatibleSimulationTransportError);
  if (!(caught instanceof OpenAICompatibleSimulationTransportError)) {
    throw new Error(`Expected transport error kind ${kind}`);
  }
  expect(caught.kind).toBe(kind);
  return caught;
}

function requestBody(call: FetchCall): Record<string, unknown> {
  expect(call.init?.body).toBeTypeOf("string");
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

describe("OpenAI-compatible SimulationModelClient", () => {
  it("sends the configured model and Authorization header, returning only assistant content", async () => {
    const apiKey = "test-api-key-never-returned";
    const content = '{"proposals":[]}';
    const { calls, fetchImpl } = createFetch(() => assistantResponse(content));
    const request = modelRequest();
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1/",
      apiKey,
      model: "test-model",
      fetchImpl,
    });

    const result = await client.generate(request);

    expect(result).toBe(content);
    expect(String(result)).not.toContain(apiKey);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe("https://provider.test/v1/chat/completions");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${apiKey}`);

    const body = requestBody(calls[0]!);
    expect(body.model).toBe("test-model");
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("worldId");
    expect(body).not.toHaveProperty("expectedWorldRevision");
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: request.instructions });
    expect(messages[1]?.role).toBe("user");
    expect(JSON.parse(String(messages[1]?.content))).toEqual({
      context: request.context,
      intent: request.intent,
    });
    expect(Object.keys(JSON.parse(String(messages[1]?.content)))).toEqual(["context", "intent"]);
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it("accepts an already-complete OpenAI-compatible assistant response", async () => {
    const { fetchImpl } = createFetch(() => assistantResponse("assistant content"));
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl,
    });

    await expect(client.generate(modelRequest())).resolves.toBe("assistant content");
  });

  it("throws a sanitized HTTP transport error without retrying", async () => {
    const apiKey = "test-http-secret";
    const { calls, fetchImpl } = createFetch(() => new Response(`provider body ${apiKey}`, { status: 429 }));
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1",
      apiKey,
      model: "test-model",
      fetchImpl,
    });

    const error = await expectTransportError(() => client.generate(modelRequest()), "http");

    expect(calls).toHaveLength(1);
    expect(error.message).not.toContain(apiKey);
  });

  it("throws a sanitized network error without retrying", async () => {
    const apiKey = "test-network-secret";
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error(`network failure ${apiKey}`);
    };
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1",
      apiKey,
      model: "test-model",
      fetchImpl,
    });

    const error = await expectTransportError(() => client.generate(modelRequest()), "network");

    expect(calls).toBe(1);
    expect(error.message).not.toContain(apiKey);
  });

  it("aborts a request deterministically at the configured timeout", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 10,
      fetchImpl,
    });

    const error = await expectTransportError(() => client.generate(modelRequest()), "timeout");

    expect(calls).toBe(1);
    expect(error.message).toContain("10ms");
  });

  it("rejects a provider response without assistant content", async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ choices: [{ message: { role: "assistant" } }] }));
    const client = new OpenAICompatibleSimulationModelClient({
      baseUrl: "https://provider.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl,
    });

    await expectTransportError(() => client.generate(modelRequest()), "malformed_response");
  });

  it("leaves malformed model JSON repair to SimulationAdapter", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const context = new ContextBuilder(store).buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });
    const validOutput = JSON.stringify({ proposals: [] });
    const { calls, fetchImpl } = createFetch((_call, count) => assistantResponse(
      count === 1 ? "not-json" : validOutput,
    ));
    const adapter = new SimulationAdapter(
      new OpenAICompatibleSimulationModelClient({
        baseUrl: "https://provider.test/v1",
        apiKey: "test-key",
        model: "test-model",
        fetchImpl,
      }),
      { modelId: "fake-openai-compatible" },
    );

    const result = await adapter.generate({
      context,
      actorCharacterId: ids.characters.player.id,
      intent: "观察",
    });

    expect(result.proposals).toEqual([]);
    expect(result.diagnostics).toMatchObject({ attempts: 2, repaired: true, status: "empty" });
    expect(calls).toHaveLength(2);
    store.close();
  });

  it("does not retry transport failures through SimulationAdapter", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("provider unavailable", { status: 503 });
    };
    const adapter = new SimulationAdapter(
      new OpenAICompatibleSimulationModelClient({
        baseUrl: "https://provider.test/v1",
        apiKey: "test-key",
        model: "test-model",
        fetchImpl,
      }),
    );
    const context = new ContextBuilder(store).buildCharacterContext({
      worldId: ids.world.id,
      observerCharacterId: ids.characters.player.id,
      budget: 10,
    });

    let caught: unknown;
    try {
      await adapter.generate({
        context,
        actorCharacterId: ids.characters.player.id,
        intent: "观察",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SimulationAdapterError);
    if (caught instanceof SimulationAdapterError) {
      expect(caught.code).toBe("MODEL_TRANSPORT_ERROR");
      expect(caught.diagnostics.attempts).toBe(1);
    }
    expect(calls).toBe(1);
    store.close();
  });

  it("runs one fake-HTTP turn through ContextBuilder, Adapter, Orchestrator, and Kernel", async () => {
    const store = new SqliteWorldStore();
    const ids = seedTestWorld(store);
    const modelOutput = JSON.stringify({
      proposals: [{
        type: "character.move",
        actorId: ids.characters.player.id,
        toLocationId: ids.locations.tokyo.id,
      }],
    });
    const { calls, fetchImpl } = createFetch(() => assistantResponse(modelOutput));
    const simulationAdapter = new SimulationAdapter(
      new OpenAICompatibleSimulationModelClient({
        baseUrl: "https://provider.test/v1",
        apiKey: "test-key",
        model: "test-model",
        fetchImpl,
      }),
      { modelId: "fake-openai-compatible" },
    );
    let nextEventId = 0;
    const commitKernel = new CommitKernel(store, {
      clock: () => TEST_TIME,
      idFactory: () => `smoke-event-${String(++nextEventId).padStart(4, "0")}`,
    });
    const result = await new TurnOrchestrator({
      stateReader: store,
      contextBuilder: new ContextBuilder(store),
      simulationAdapter,
      commitKernel,
    }).runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: "移动到东京",
    });

    expect(result.status).toBe("success");
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]).toMatchObject({
      type: "character.move",
      worldRevision: 1,
      eventTime: TEST_TIME,
    });
    expect(result.state?.world.revision).toBe(1);
    expect(store.listEvents(ids.world.id)).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const body = requestBody(calls[0]!);
    expect(body.model).toBe("test-model");
    expect(body).not.toHaveProperty("expectedWorldRevision");
    expect(body).not.toHaveProperty("occurredAt");
    expect(body).not.toHaveProperty("causeEventIds");
    const messages = body.messages as Array<Record<string, unknown>>;
    const userPayload = JSON.parse(String(messages[1]?.content)) as Record<string, unknown>;
    expect(Object.keys(userPayload)).toEqual(["context", "intent"]);
    expect(userPayload.intent).toBe("移动到东京");
    expect(userPayload).not.toHaveProperty("store");
    expect(userPayload).not.toHaveProperty("snapshot");
    expect(userPayload).not.toHaveProperty("commitKernel");
    store.close();
  });
});
