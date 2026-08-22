import type {
  SimulationModelClient,
  SimulationModelRequest,
} from "./simulation-adapter.js";

export interface OpenAICompatibleChatClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAICompatibleSimulationClientOptions extends OpenAICompatibleChatClientOptions {}

export interface OpenAICompatibleChatRequest {
  systemInstruction: string;
  userPayload: unknown;
}

export type OpenAICompatibleTransportErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "malformed_response";

export class OpenAICompatibleTransportError extends Error {
  public readonly kind: OpenAICompatibleTransportErrorKind;

  public constructor(kind: OpenAICompatibleTransportErrorKind, message: string) {
    super(message);
    this.name = "OpenAICompatibleSimulationTransportError";
    this.kind = kind;
  }
}

export { OpenAICompatibleTransportError as OpenAICompatibleSimulationTransportError };

export const DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS = 30_000;

export class OpenAICompatibleSimulationModelClient implements SimulationModelClient {
  private readonly options: OpenAICompatibleChatClientOptions;

  public constructor(options: OpenAICompatibleSimulationClientOptions) {
    this.options = normalizeOptions(options);
  }

  public async generate(request: SimulationModelRequest): Promise<unknown> {
    return requestOpenAICompatibleAssistantContent(this.options, {
      systemInstruction: buildSystemInstruction(request),
      userPayload: {
        context: request.context,
        intent: request.intent,
      },
    });
  }
}

export async function requestOpenAICompatibleAssistantContent(
  options: OpenAICompatibleChatClientOptions,
  request: OpenAICompatibleChatRequest,
): Promise<string> {
  const resolved = normalizeOptions(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const response = await resolved.fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          {
            role: "system",
            content: request.systemInstruction,
          },
          {
            role: "user",
            content: JSON.stringify(request.userPayload),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new OpenAICompatibleTransportError(
        "http",
        `OpenAI-compatible model request failed with HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new OpenAICompatibleTransportError(
        "malformed_response",
        "OpenAI-compatible model response was not valid JSON",
      );
    }

    return extractAssistantContent(payload);
  } catch (error) {
    if (error instanceof OpenAICompatibleTransportError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new OpenAICompatibleTransportError(
        "timeout",
        `OpenAI-compatible model request timed out after ${resolved.timeoutMs}ms`,
      );
    }
    throw new OpenAICompatibleTransportError(
      "network",
      "OpenAI-compatible model request failed before a response was received",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOptions(options: OpenAICompatibleChatClientOptions): OpenAICompatibleChatClientOptions & {
  endpoint: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
} {
  if (options.baseUrl.trim().length === 0) {
    throw new TypeError("baseUrl must not be blank");
  }
  if (options.apiKey.trim().length === 0) {
    throw new TypeError("apiKey must not be blank");
  }
  if (options.model.trim().length === 0) {
    throw new TypeError("model must not be blank");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }

  return {
    ...options,
    endpoint: toChatCompletionsEndpoint(options.baseUrl),
    timeoutMs,
    fetchImpl: options.fetchImpl ?? fetch,
  };
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
    throw new OpenAICompatibleTransportError(
      "malformed_response",
      "OpenAI-compatible model response did not contain choices",
    );
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message) || typeof firstChoice.message.content !== "string") {
    throw new OpenAICompatibleTransportError(
      "malformed_response",
      "OpenAI-compatible model response did not contain assistant content",
    );
  }

  return firstChoice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
