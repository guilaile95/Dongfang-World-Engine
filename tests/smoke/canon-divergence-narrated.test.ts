import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  readCanonDivergenceNarratedConfig,
  runCanonDivergenceNarratedSample,
  safeCanonDivergenceNarratedError,
  validateCanonDivergenceFormalPreflight,
} from "../../src/smoke/canon-divergence-narrated.js";

describe("Canon divergence real-Narrator sample entrypoint", () => {
  it("sends one observer-safe consequence envelope to the Narrator without a Simulation provider call", async () => {
    const apiKey = "test-narrator-key-must-not-leak";
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: "你赶到西塔后确认，守卫路线已经改往西塔。",
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const output = await runCanonDivergenceNarratedSample({
      baseUrl: "https://model.example/v1",
      apiKey,
      model: "test-narrator-model",
      fetchImpl: fakeFetch,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(expect.objectContaining({
      url: "https://model.example/v1/chat/completions",
      authorization: `Bearer ${apiKey}`,
    }));
    const requestBody = requests[0]!.body as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.model).toBe("test-narrator-model");
    expect(requestBody.messages.map((message) => message.role)).toEqual(["system", "user"]);
    const envelope = JSON.parse(requestBody.messages[1]!.content) as {
      intent: string;
      observerContext: {
        observer: { id: string };
        knowledge: Array<{
          claim: { subject: string; predicate: string; object: string };
          knowledge: { knowledgeState: string };
          provenance: { sourceType: string; sourceEventType: string };
        }>;
      };
      outcomes: Array<{ type: string; actorId: string; toLocationId: string }>;
    };
    expect(envelope.observerContext.observer.id).toContain("character-player-formal-narrated-sample");
    expect(envelope.outcomes).toEqual([expect.objectContaining({
      type: "character.move",
      actorId: envelope.observerContext.observer.id,
      toLocationId: expect.stringContaining("location-west-tower-formal-narrated-sample"),
    })]);
    expect(envelope.observerContext.knowledge).toEqual([expect.objectContaining({
      claim: expect.objectContaining({ predicate: "watch_route", object: "west_tower" }),
      knowledge: expect.objectContaining({ knowledgeState: "confirmed" }),
      provenance: expect.objectContaining({ sourceType: "event", sourceEventType: "claim.record" }),
    })]);

    const envelopeJson = requestBody.messages[1]!.content;
    expect(envelopeJson).toContain("watch_route");
    expect(envelopeJson).toContain("west_tower");
    for (const forbidden of [
      "fact-hidden-canon-trigger",
      "sealed_order_status",
      "old_canon_arrest",
      "dawn_market_status",
      "factAssertionRequirements",
      "event-canon-binding-formal-narrated-sample-03",
      "WorldSnapshot",
      "\"payload\"",
      "raw response",
      "chain-of-thought",
    ]) {
      expect(envelopeJson).not.toContain(forbidden);
    }
    expect(JSON.stringify(requestBody)).not.toContain(apiKey);

    expect(output.protocol).toEqual({
      kind: "canon_divergence_player_legibility",
      executionMode: "injected_test",
      formalSample: false,
      exactHeadSha: null,
      sampleConsumed: true,
      rerollAllowed: false,
      model: "test-narrator-model",
      simulationProviderCalls: 0,
      narratorProviderCalls: 1,
    });
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
    expect(output.result.finalWorldRevision).toBe(6);
    expect(output.result.committedEventCount).toBe(6);
    expect(output.result.replayConsistent).toBe(true);
    expect(output.providerOutcome).toBe("success");
    expect(output.providerError).toBeNull();
    expect(output.narrative).toBe("你赶到西塔后确认，守卫路线已经改往西塔。");
    expect(output.narrativeRedacted).toBe(false);
    expect(output.narrativeRedactionReason).toBeNull();

    const safeOutput = JSON.stringify(output);
    expect(safeOutput).not.toContain(apiKey);
    expect(safeOutput).not.toContain("messages");
    expect(safeOutput).not.toContain("fact-hidden-canon-trigger");
    expect(safeOutput).not.toContain("factAssertionRequirements");
    expect(safeOutput).not.toContain("\"payload\"");
  });

  it("fails closed on missing environment without including configured secrets", () => {
    const secret = "environment-secret-must-not-leak";
    let thrown: unknown;
    try {
      readCanonDivergenceNarratedConfig({
        DWE_LLM_BASE_URL: "https://model.example/v1",
        DWE_LLM_API_KEY: secret,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const safeError = safeCanonDivergenceNarratedError(thrown, secret);
    expect(safeError).toEqual({
      status: "error",
      kind: "configuration",
      message: "Missing required environment variable: DWE_LLM_MODEL",
    });
    expect(JSON.stringify(safeError)).not.toContain(secret);
  });

  it("redacts a configured secret from narrative and bounded runtime errors", async () => {
    const secret = "provider-secret-must-not-leak";
    const fakeFetch = (async (): Promise<Response> => new Response(JSON.stringify({
      choices: [{ message: { content: `unsafe ${secret}` } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const output = await runCanonDivergenceNarratedSample({
      baseUrl: "https://model.example/v1",
      apiKey: secret,
      model: `test-narrator-model-${secret}`,
      fetchImpl: fakeFetch,
    });
    expect(output.narrative).toBeNull();
    expect(output.narrativeRedacted).toBe(true);
    expect(output.narrativeRedactionReason).toBe("configured_secret");
    expect(output.providerOutcome).toBe("redacted_output_after_attempt");
    expect(output.protocol.sampleConsumed).toBe(true);
    expect(output.protocol.model).toBe("[model omitted because it contained the configured secret]");
    expect(JSON.stringify(output)).not.toContain(secret);

    expect(safeCanonDivergenceNarratedError(new Error(`transport exposed ${secret}`), secret)).toEqual({
      status: "error",
      kind: "runtime",
      message: "Canon divergence narrated sample failed",
    });
    expect(safeCanonDivergenceNarratedError(new Error("x".repeat(1_000))).message).toHaveLength(500);
  });

  it("preserves a consumed-sample receipt when the provider attempt fails", async () => {
    let requests = 0;
    const fakeFetch = (async (): Promise<Response> => {
      requests += 1;
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;

    const output = await runCanonDivergenceNarratedSample({
      baseUrl: "https://model.example/v1",
      apiKey: "test-key",
      model: "test-narrator-model",
      fetchImpl: fakeFetch,
    });

    expect(requests).toBe(1);
    expect(output.protocol).toEqual(expect.objectContaining({
      executionMode: "injected_test",
      formalSample: false,
      exactHeadSha: null,
      sampleConsumed: true,
      rerollAllowed: false,
      narratorProviderCalls: 1,
    }));
    expect(output.providerOutcome).toBe("unknown_after_attempt");
    expect(output.providerError).toEqual({
      code: "NARRATIVE_TRANSPORT_ERROR",
      message: "Narrator model transport failed",
    });
    expect(output.narrative).toBeNull();
    expect(output.result.authoredConsequence.triggered).toBe(true);
    expect(output.result.oldCanonAttempt.rejectionLeftStateUnchanged).toBe(true);
    expect(output.result.replayConsistent).toBe(true);
  });

  it("fails closed on redirects after exactly one wire request", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/v1/chat/completions") {
        response.writeHead(307, { Location: "/v1/redirected" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "redirected" } }] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const output = await runCanonDivergenceNarratedSample({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "redirect-test-key",
        model: "test-narrator-model",
      });

      expect(requests).toEqual(["/v1/chat/completions"]);
      expect(output.protocol).toEqual(expect.objectContaining({
        executionMode: "default_transport",
        formalSample: false,
        exactHeadSha: null,
        sampleConsumed: true,
        narratorProviderCalls: 1,
      }));
      expect(output.providerOutcome).toBe("unknown_after_attempt");
      expect(output.providerError?.code).toBe("NARRATIVE_TRANSPORT_ERROR");
      expect(output.narrative).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("redacts a provider echo of the raw request while retaining the receipt", async () => {
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Response(JSON.stringify({
        choices: [{ message: { content: String(init?.body) } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const output = await runCanonDivergenceNarratedSample({
      baseUrl: "https://model.example/v1",
      apiKey: "test-key",
      model: "test-narrator-model",
      fetchImpl: fakeFetch,
    });

    expect(output.protocol.sampleConsumed).toBe(true);
    expect(output.protocol.narratorProviderCalls).toBe(1);
    expect(output.providerOutcome).toBe("redacted_output_after_attempt");
    expect(output.providerError).toBeNull();
    expect(output.narrative).toBeNull();
    expect(output.narrativeRedacted).toBe(true);
    expect(output.narrativeRedactionReason).toBe("request_artifact");
    const safeOutput = JSON.stringify(output);
    expect(safeOutput).not.toContain("messages");
    expect(safeOutput).not.toContain("DEFAULT_NARRATIVE_INSTRUCTIONS");
    expect(safeOutput).not.toContain("observerContext");
  });

  it("marks only a direct clean exact-main process without preloads as formal", () => {
    const headSha = "a".repeat(40);
    const valid = {
      directExecution: true,
      branch: "main",
      headSha,
      originMainSha: headSha,
      worktreeStatus: "",
      execArgv: [],
      nodeOptions: "",
    };
    expect(validateCanonDivergenceFormalPreflight(valid)).toEqual({ commitSha: headSha });

    expect(() => validateCanonDivergenceFormalPreflight({ ...valid, branch: "feature/not-main" }))
      .toThrow("requires the main branch");
    expect(() => validateCanonDivergenceFormalPreflight({ ...valid, originMainSha: "b".repeat(40) }))
      .toThrow("requires exact origin/main HEAD");
    expect(() => validateCanonDivergenceFormalPreflight({ ...valid, worktreeStatus: " M file.ts" }))
      .toThrow("requires a clean worktree");
    expect(() => validateCanonDivergenceFormalPreflight({ ...valid, execArgv: ["--import", "fake-loader"] }))
      .toThrow("forbids Node preload or execution flags");
    expect(() => validateCanonDivergenceFormalPreflight({ ...valid, nodeOptions: "--require fake-loader" }))
      .toThrow("forbids Node preload or execution flags");
  });
});
