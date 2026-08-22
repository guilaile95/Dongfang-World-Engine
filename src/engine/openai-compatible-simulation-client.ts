import type {
  SimulationModelClient,
  SimulationModelRequest,
} from "./simulation-adapter.js";

export interface OpenAICompatibleSimulationClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type OpenAICompatibleTransportErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "malformed_response";

export class OpenAICompatibleSimulationTransportError extends Error {
  public readonly kind: OpenAICompatibleTransportErrorKind;

  public constructor(kind: OpenAICompatibleTransportErrorKind, message: string) {
    super(message);
    this.name = "OpenAICompatibleSimulationTransportError";
    this.kind = kind;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAICompatibleSimulationModelClient implements SimulationModelClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: OpenAICompatibleSimulationClientOptions) {
    if (options.baseUrl.trim().length === 0) {
      throw new TypeError("baseUrl must not be blank");
    }
    if (options.apiKey.trim().length === 0) {
      throw new TypeError("apiKey must not be blank");
    }
    if (options.model.trim().length === 0) {
      throw new TypeError("model must not be blank");
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive safe integer");
    }

    this.endpoint = toChatCompletionsEndpoint(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: buildSystemInstruction(request),
            },
            {
              role: "user",
              content: JSON.stringify({
                context: request.context,
                intent: request.intent,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenAICompatibleSimulationTransportError(
          "http",
          `OpenAI-compatible model request failed with HTTP ${response.status}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch {
        throw new OpenAICompatibleSimulationTransportError(
          "malformed_response",
          "OpenAI-compatible model response was not valid JSON",
        );
      }

      return extractAssistantContent(payload);
    } catch (error) {
      if (error instanceof OpenAICompatibleSimulationTransportError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new OpenAICompatibleSimulationTransportError(
          "timeout",
          `OpenAI-compatible model request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new OpenAICompatibleSimulationTransportError(
        "network",
        "OpenAI-compatible model request failed before a response was received",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toChatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function buildSystemInstruction(request: SimulationModelRequest): string {
  if (!request.repair) {
    return request.instructions;
  }
  return [
    request.instructions,
    "Repair the previous response according to this deterministic validation feedback:",
    request.repair.reason,
  ].join("\n");
}

function extractAssistantContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new OpenAICompatibleSimulationTransportError(
      "malformed_response",
      "OpenAI-compatible model response did not contain choices",
    );
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message) || typeof firstChoice.message.content !== "string") {
    throw new OpenAICompatibleSimulationTransportError(
      "malformed_response",
      "OpenAI-compatible model response did not contain assistant content",
    );
  }

  return firstChoice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
