import type { AppConfig } from "../config.js";
import { assertNoSecret, redactSecret } from "../secrets.js";
import { createAiSdkDriver } from "./ai-sdk-driver.js";
import { classifyError } from "./errors.js";
import type {
  CallRecord,
  ModelDriver,
  StreamRequest,
  StreamResult,
  StructuredMode,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
} from "./types.js";

export function createModelClient(config: AppConfig, driver: ModelDriver = createAiSdkDriver(config)): ModelClient {
  return new ModelClient(config, driver);
}

export class ModelClient {
  public readonly records: CallRecord[] = [];

  public constructor(
    private readonly config: AppConfig,
    private readonly driver: ModelDriver,
  ) {}

  public lastRecord(): CallRecord | undefined {
    return this.records[this.records.length - 1];
  }

  public async stream(request: StreamRequest): Promise<StreamResult> {
    const started = Date.now();
    let emitted = false;
    const run = (model: string) =>
      this.driver.stream({
        system: request.system,
        prompt: request.prompt,
        model,
        onChunk: (chunk) => {
          emitted = true;
          request.onChunk?.(chunk);
        },
      });
    try {
      const outcome = await this.withRetry(run, { allowRetry: () => !emitted });
      const record = this.finish({
        request,
        model: outcome.model,
        usage: outcome.value.usage,
        started,
        retryCount: outcome.retryCount,
        fallbackUsed: outcome.fallbackUsed,
        structuredMode: "none",
        outputChars: outcome.value.text.length,
      });
      assertNoSecret(outcome.value.text, this.config.apiKey, "model stream");
      return { text: outcome.value.text, record };
    } catch (error) {
      const record = this.fail(request, started, error, "none", 0);
      throw Object.assign(error instanceof Error ? error : new Error(record.errorMessage ?? "stream failed"), {
        record,
      });
    }
  }

  public async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    try {
      const outcome = await this.withRetry(
        (model) =>
          this.driver.generateObject({
            system: request.system,
            prompt: request.prompt,
            model,
            schema: request.schema,
          }),
        { allowRetry: () => true },
      );
      const parsed = request.schema.safeParse(outcome.value.object);
      if (parsed.success) {
        return {
          object: parsed.data,
          record: this.finish({
            request,
            model: outcome.model,
            usage: outcome.value.usage,
            started,
            retryCount: outcome.retryCount,
            fallbackUsed: outcome.fallbackUsed,
            structuredMode: "native",
            outputChars: JSON.stringify(parsed.data).length,
          }),
        };
      }
      return await this.jsonFallback(request, started, outcome.model, outcome.retryCount, outcome.fallbackUsed);
    } catch (error) {
      const classified = classifyError(error);
      if (classified.category === "schema" || classified.category === "unsupported") {
        return this.jsonFallback(request, started, this.config.model, 0, false);
      }
      return {
        object: null,
        record: this.fail(request, started, error, "none", 0),
      };
    }
  }

  private async jsonFallback<T>(
    request: StructuredRequest<T>,
    started: number,
    model: string,
    retryCount: number,
    fallbackUsed: boolean,
  ): Promise<StructuredResult<T>> {
    const textPath = await this.tryJsonText(request, model, 0);
    if (textPath.ok) {
      return {
        object: textPath.object,
        record: this.finish({
          request,
          model,
          usage: textPath.usage,
          started,
          retryCount,
          fallbackUsed,
          structuredMode: "json_text",
          outputChars: JSON.stringify(textPath.object).length,
        }),
      };
    }
    const repaired = await this.tryJsonText(request, model, 1, textPath.issues);
    if (repaired.ok) {
      return {
        object: repaired.object,
        record: this.finish({
          request,
          model,
          usage: repaired.usage,
          started,
          retryCount,
          fallbackUsed,
          structuredMode: "json_repair",
          outputChars: JSON.stringify(repaired.object).length,
        }),
      };
    }
    return {
      object: null,
      record: this.fail(request, started, repaired.error, "json_repair", retryCount, fallbackUsed),
    };
  }

  private async tryJsonText<T>(
    request: StructuredRequest<T>,
    model: string,
    repair: 0 | 1,
    issues: string[] = [],
  ): Promise<{ ok: true; object: T; usage: TokenUsage } | { ok: false; error: unknown; issues: string[] }> {
    const system = [
      request.system,
      "Reply with JSON only. No markdown.",
      repair === 1 ? `Previous JSON failed: ${issues.join("; ")}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    try {
      const result = await this.driver.generateText({ system, prompt: request.prompt, model });
      const raw = extractJson(result.text);
      const parsed = request.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error,
          issues: parsed.error.issues.map((issue) => issue.message),
        };
      }
      return { ok: true, object: parsed.data, usage: result.usage };
    } catch (error) {
      return { ok: false, error, issues };
    }
  }

  private async withRetry<T>(
    run: (model: string) => Promise<T>,
    options: { allowRetry: () => boolean },
  ): Promise<{ value: T; model: string; retryCount: number; fallbackUsed: boolean }> {
    const models = this.modelChain();
    let retryCount = 0;
    let lastError: unknown;
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (!model) {
        continue;
      }
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
        try {
          const value = await run(model);
          return { value, model, retryCount, fallbackUsed: index > 0 };
        } catch (error) {
          lastError = error;
          const classified = classifyError(error);
          if (!classified.retryable || !options.allowRetry() || attempt === this.config.maxRetries) {
            break;
          }
          retryCount += 1;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("model call failed");
  }

  private modelChain(): string[] {
    const chain = [this.config.model];
    if (this.config.fallbackModel && this.config.fallbackModel !== this.config.model) {
      chain.push(this.config.fallbackModel);
    }
    return chain;
  }

  private finish(input: {
    request: { role: CallRecord["role"]; purpose: string; prompt: string; system: string };
    model: string;
    usage: TokenUsage;
    started: number;
    retryCount: number;
    fallbackUsed: boolean;
    structuredMode: StructuredMode;
    outputChars: number;
  }): CallRecord {
    const record: CallRecord = {
      role: input.request.role,
      purpose: input.request.purpose,
      provider: "openai-compatible",
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      costUsd: estimateCost(input.usage, this.config),
      latencyMs: Date.now() - input.started,
      retryCount: input.retryCount,
      fallbackUsed: input.fallbackUsed,
      structuredMode: input.structuredMode,
      errorCategory: "none",
      errorMessage: null,
      promptChars: input.request.system.length + input.request.prompt.length,
      outputChars: input.outputChars,
    };
    this.push(record);
    return record;
  }

  private fail(
    request: { role: CallRecord["role"]; purpose: string; prompt: string; system: string },
    started: number,
    error: unknown,
    structuredMode: StructuredMode,
    retryCount: number,
    fallbackUsed = false,
  ): CallRecord {
    const classified = classifyError(error);
    const record: CallRecord = {
      role: request.role,
      purpose: request.purpose,
      provider: "openai-compatible",
      model: this.config.model,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      retryCount,
      fallbackUsed,
      structuredMode,
      errorCategory: classified.category,
      errorMessage: redactSecret(classified.message, this.config.apiKey),
      promptChars: request.system.length + request.prompt.length,
      outputChars: 0,
    };
    this.push(record);
    return record;
  }

  private push(record: CallRecord): void {
    const serialized = JSON.stringify(record);
    assertNoSecret(serialized, this.config.apiKey, "call record");
    this.records.push(record);
  }
}

export function formatCallLine(record: CallRecord): string {
  const cost = record.costUsd === null ? "-" : record.costUsd.toFixed(6);
  return [
    record.role,
    record.purpose,
    `${record.provider}/${record.model}`,
    `in=${record.inputTokens ?? "-"}`,
    `out=${record.outputTokens ?? "-"}`,
    `cost=${cost}`,
    `${record.latencyMs}ms`,
    `retries=${record.retryCount}`,
    `err=${record.errorCategory}`,
  ].join(" ");
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.search(/[{\[]/);
  if (start < 0) {
    throw new Error("no JSON object in model text");
  }
  return JSON.parse(trimmed.slice(start)) as unknown;
}

function estimateCost(usage: TokenUsage, config: AppConfig): number | null {
  if (config.inputUsdPerMtok === null || config.outputUsdPerMtok === null) {
    return null;
  }
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1_000_000) * config.inputUsdPerMtok + (output / 1_000_000) * config.outputUsdPerMtok;
}
