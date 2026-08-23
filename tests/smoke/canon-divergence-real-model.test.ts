import { describe, expect, it } from "vitest";
import {
  readCanonDivergenceRealModelConfig,
  runCanonDivergenceRealModelSample,
  safeCanonDivergenceSampleError,
} from "../../src/smoke/canon-divergence-real-model.js";

describe("Canon divergence real-model sample entrypoint", () => {
  it("maps injected OpenAI-compatible HTTP to the trusted action binding without leaking hidden authority data", async () => {
    const apiKey = "test-api-key-must-not-leak";
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      const userPayload = JSON.parse(body.messages[1]!.content) as {
        context: {
          observer: { id: string };
          movementOptions: Array<{ locationId: string; name: string }>;
        };
        intent: string;
      };
      const westTower = userPayload.context.movementOptions.find((option) => option.name === "West Tower");
      if (!westTower) {
        throw new Error("Expected observer-safe West Tower movement option");
      }
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              proposals: [{
                type: "character.move",
                actorId: userPayload.context.observer.id,
                toLocationId: westTower.locationId,
              }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const output = await runCanonDivergenceRealModelSample({
      baseUrl: "https://model.example/v1",
      apiKey,
      model: "test-model",
      fetchImpl: fakeFetch,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(expect.objectContaining({
      url: "https://model.example/v1/chat/completions",
      authorization: `Bearer ${apiKey}`,
    }));
    const requestJson = JSON.stringify(requests[0]!.body);
    expect(requestJson).not.toContain("fact-hidden-canon-trigger");
    expect(requestJson).not.toContain("sealed_order_status");
    expect(requestJson).not.toContain("factAssertionRequirements");

    expect(output.protocol).toEqual({
      kind: "canon_divergence_action_selection",
      executionMode: "injected_test",
      formalSample: false,
      rerollAllowed: false,
      model: "test-model",
      providerCalls: 1,
    });
    expect(output.result.playerTurn.committedEvents).toEqual([
      { type: "character.move", worldRevision: 2 },
    ]);
    expect(output.result.authoredConsequence.triggered).toBe(true);
    expect(output.result.playerConsequenceKnowledge).toEqual({
      acquired: true,
      claim: {
        subject: expect.stringContaining("character-npc-a-"),
        predicate: "watch_route",
        object: "west_tower",
      },
      knowledgeState: "confirmed",
      sourceEventType: "claim.record",
      claimEventWorldRevision: 4,
      learnEventWorldRevision: 5,
    });
    expect(output.result.oldCanonAttempt).toEqual({
      committed: false,
      rejectionCode: "FACT_PRECONDITION_FAILED",
      rejectionLeftStateUnchanged: true,
    });
    expect(output.result.independentEvent).toEqual({ type: "fact.assert", worldRevision: 6 });
    expect(output.result.finalWorldRevision).toBe(6);
    expect(output.result.committedEventCount).toBe(6);
    expect(output.result.replayConsistent).toBe(true);

    const safeJson = JSON.stringify(output);
    expect(safeJson).not.toContain(apiKey);
    expect(safeJson).not.toContain("fact-hidden-canon-trigger");
    expect(safeJson).not.toContain("sealed_order_status");
    expect(safeJson).not.toContain("factAssertionRequirements");
    expect(safeJson).not.toContain("payload");
    expect(safeJson).not.toContain("messages");
    expect(safeJson).not.toContain("chain-of-thought");
  });

  it("fails closed on missing environment without including configured secrets", () => {
    const secret = "environment-secret-must-not-leak";
    let thrown: unknown;
    try {
      readCanonDivergenceRealModelConfig({
        DWE_LLM_BASE_URL: "https://model.example/v1",
        DWE_LLM_API_KEY: secret,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const safeError = safeCanonDivergenceSampleError(thrown, secret);
    expect(safeError).toEqual({
      status: "error",
      kind: "configuration",
      message: "Missing required environment variable: DWE_LLM_MODEL",
    });
    expect(JSON.stringify(safeError)).not.toContain(secret);
  });

  it("redacts a configured API key from bounded error output", () => {
    const secret = "provider-secret";
    expect(safeCanonDivergenceSampleError(new Error(`transport exposed ${secret}`), secret)).toEqual({
      status: "error",
      kind: "runtime",
      message: "Canon divergence real-model sample failed",
    });
    expect(safeCanonDivergenceSampleError(new Error("x".repeat(1_000))).message).toHaveLength(500);
  });
});
