export type CallRole = "narrator" | "proposal" | "npc";

export type ErrorCategory =
  | "none"
  | "timeout"
  | "rate_limit"
  | "auth"
  | "transport"
  | "schema"
  | "unsupported"
  | "unknown";

export type StructuredMode = "none" | "native" | "json_text" | "json_repair";

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Safe to log. No prompt body, no API key, no hidden reasoning, no world snapshot. */
export interface CallRecord {
  role: CallRole;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  structuredMode: StructuredMode;
  errorCategory: ErrorCategory;
  errorMessage: string | null;
  promptChars: number;
  outputChars: number;
}

export interface StreamRequest {
  role: CallRole;
  purpose: string;
  system: string;
  prompt: string;
  onChunk?: (text: string) => void;
}

export interface StructuredRequest<T> {
  role: CallRole;
  purpose: string;
  system: string;
  prompt: string;
  schema: import("zod").ZodType<T>;
}

export interface StreamResult {
  text: string;
  record: CallRecord;
}

export interface StructuredResult<T> {
  object: T | null;
  record: CallRecord;
}

export interface ModelDriver {
  stream(input: {
    system: string;
    prompt: string;
    model: string;
    onChunk?: (text: string) => void;
  }): Promise<{ text: string; usage: TokenUsage }>;
  generateObject(input: {
    system: string;
    prompt: string;
    model: string;
    schema: import("zod").ZodType<unknown>;
  }): Promise<{ object: unknown; usage: TokenUsage }>;
  generateText(input: { system: string; prompt: string; model: string }): Promise<{ text: string; usage: TokenUsage }>;
}
