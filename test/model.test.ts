import { describe, expect, it } from "vitest";
import type { AppConfig } from "../app/config.js";
import { createModelClient, extractJson, formatCallLine } from "../app/model/client.js";
import { classifyError, TransportError } from "../app/model/errors.js";
import type { ModelDriver, TokenUsage } from "../app/model/types.js";
import { z } from "zod";

const usage: TokenUsage = { inputTokens: 10, outputTokens: 5 };

function config(apiKey: string): AppConfig {
  return {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey,
    model: "unit-model",
    worldFile: "data/local/world.sqlite",
    maxRetries: 2,
    timeoutMs: 1000,
    fallbackModel: "unit-fallback",
    inputUsdPerMtok: 1,
    outputUsdPerMtok: 2,
  };
}

class FakeDriver implements ModelDriver {
  public streamCalls = 0;
  public objectCalls = 0;
  public textCalls = 0;
  public streamFailRemaining = 0;
  public failPrimary = false;
  public objectMode: "native" | "unsupported" = "native";
  public textBodies: string[] = ['{"note":"ok"}'];
  public streamText = "堂屋很安静。";

  public async stream(input: {
    system: string;
    prompt: string;
    model: string;
    onChunk?: (text: string) => void;
  }): Promise<{ text: string; usage: TokenUsage }> {
    this.streamCalls += 1;
    if (this.failPrimary && input.model === "unit-model") {
      throw new TransportError("primary down", "transport", true);
    }
    if (this.streamFailRemaining > 0) {
      this.streamFailRemaining -= 1;
      throw new TransportError("busy", "rate_limit", true);
    }
    input.onChunk?.(this.streamText);
    return { text: this.streamText, usage };
  }

  public async generateObject(): Promise<{ object: unknown; usage: TokenUsage }> {
    this.objectCalls += 1;
    if (this.objectMode === "unsupported") {
      throw new TransportError("no json schema", "unsupported", false);
    }
    return { object: { note: "native" }, usage };
  }

  public async generateText(): Promise<{ text: string; usage: TokenUsage }> {
    this.textCalls += 1;
    const body = this.textBodies.shift() ?? "{}";
    return { text: body, usage };
  }
}

const noteSchema = z.object({ note: z.string() });

describe("model access", () => {
  it("records purpose, model, tokens, cost, latency, retries; never the API key or prompt body", async () => {
    const injected = `unit-${Date.now()}-credential`;
    const driver = new FakeDriver();
    const client = createModelClient(config(injected), driver);
    const chunks: string[] = [];
    const result = await client.stream({
      role: "narrator",
      purpose: "foreground-scene",
      system: "narrate",
      prompt: `secret world dump ${injected}`,
      onChunk: (chunk) => chunks.push(chunk),
    });
    expect(result.text).toBe("堂屋很安静。");
    expect(chunks.join("")).toBe(result.text);
    const record = result.record;
    expect(record.role).toBe("narrator");
    expect(record.purpose).toBe("foreground-scene");
    expect(record.provider).toBe("openai-compatible");
    expect(record.model).toBe("unit-model");
    expect(record.inputTokens).toBe(10);
    expect(record.outputTokens).toBe(5);
    expect(record.costUsd).toBeCloseTo(20 / 1_000_000);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.retryCount).toBe(0);
    expect(record.errorCategory).toBe("none");
    expect(record.structuredMode).toBe("none");
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(injected);
    expect(serialized).not.toContain("secret world dump");
    expect(record).not.toHaveProperty("prompt");
    expect(record).not.toHaveProperty("reasoning");
    expect(formatCallLine(record)).not.toContain(injected);
    expect(formatCallLine(record)).toContain("foreground-scene");
  });

  it("retries retryable transport errors and can fall back to another model", async () => {
    const driver = new FakeDriver();
    driver.streamFailRemaining = 2;
    const client = createModelClient(config(`unit-${Date.now()}-credential`), driver);
    const result = await client.stream({
      role: "narrator",
      purpose: "foreground-scene",
      system: "n",
      prompt: "p",
    });
    expect(result.record.retryCount).toBe(2);
    expect(result.record.errorCategory).toBe("none");
    expect(driver.streamCalls).toBe(3);

    const falling = new FakeDriver();
    falling.failPrimary = true;
    const fallbackClient = createModelClient(config(`unit-${Date.now()}-credential-b`), falling);
    const fb = await fallbackClient.stream({
      role: "narrator",
      purpose: "foreground-scene",
      system: "n",
      prompt: "p",
    });
    expect(fb.record.fallbackUsed).toBe(true);
    expect(fb.record.model).toBe("unit-fallback");
  });

  it("prefers native structured output, then text JSON, then one bounded repair", async () => {
    const native = new FakeDriver();
    const nativeClient = createModelClient(config(`unit-${Date.now()}-credential-c`), native);
    const nativeResult = await nativeClient.generateStructured({
      role: "proposal",
      purpose: "background-proposal",
      system: "json",
      prompt: "propose",
      schema: noteSchema,
    });
    expect(nativeResult.object).toEqual({ note: "native" });
    expect(nativeResult.record.structuredMode).toBe("native");
    expect(nativeResult.record.role).toBe("proposal");

    const json = new FakeDriver();
    json.objectMode = "unsupported";
    json.textBodies = ['{"note":"from-text"}'];
    const jsonClient = createModelClient(config(`unit-${Date.now()}-credential-d`), json);
    const jsonResult = await jsonClient.generateStructured({
      role: "proposal",
      purpose: "background-proposal",
      system: "json",
      prompt: "propose",
      schema: noteSchema,
    });
    expect(jsonResult.object).toEqual({ note: "from-text" });
    expect(jsonResult.record.structuredMode).toBe("json_text");

    const repair = new FakeDriver();
    repair.objectMode = "unsupported";
    repair.textBodies = ["not json", '{"note":"repaired"}'];
    const repairClient = createModelClient(config(`unit-${Date.now()}-credential-e`), repair);
    const repaired = await repairClient.generateStructured({
      role: "proposal",
      purpose: "background-proposal",
      system: "json",
      prompt: "propose",
      schema: noteSchema,
    });
    expect(repaired.object).toEqual({ note: "repaired" });
    expect(repaired.record.structuredMode).toBe("json_repair");
    expect(repair.textCalls).toBe(2);
  });

  it("classifies transport errors without using request bodies as the category", () => {
    expect(classifyError(new TransportError("nope", "rate_limit", true)).category).toBe("rate_limit");
    expect(classifyError(new TransportError("nope", "auth", false)).retryable).toBe(false);
  });

  it("extracts JSON from fenced text", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
