import { APICallError, RetryError } from "ai";
import { isZodLike } from "./diagnostics.js";
import type { ErrorCategory } from "./types.js";

export class TransportError extends Error {
  public constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export function classifyError(error: unknown): {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
} {
  if (error instanceof TransportError) {
    return { category: error.category, retryable: error.retryable, message: truncate(error.message) };
  }
  if (RetryError.isInstance(error) && error.lastError) {
    return classifyError(error.lastError);
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return { category: "auth", retryable: false, message: truncate(error.message) };
    }
    if (status === 429) {
      return { category: "rate_limit", retryable: true, message: truncate(error.message) };
    }
    if (status === 408 || status === 504) {
      return { category: "timeout", retryable: true, message: truncate(error.message) };
    }
    if (
      status === 400 &&
      /json_schema|response_format|structured output|output\.object|unsupported/i.test(error.message)
    ) {
      return { category: "unsupported", retryable: false, message: truncate(error.message) };
    }
    return {
      category: "transport",
      retryable: error.isRetryable || (status !== undefined && status >= 500),
      message: truncate(error.message),
    };
  }
  if (isZodLike(error) || (error instanceof Error && error.name === "ZodError")) {
    return { category: "schema", retryable: false, message: truncate(error instanceof Error ? error.message : "zod") };
  }
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || name === "TimeoutError" || /timeout/i.test(raw)) {
    return { category: "timeout", retryable: true, message: truncate(raw) };
  }
  if (/unsupported/i.test(raw) || name === "UnsupportedFunctionalityError") {
    return { category: "unsupported", retryable: false, message: truncate(raw) };
  }
  if (/schema|json|parse|NoObjectGenerated/i.test(raw) || name === "NoObjectGeneratedError" || name === "TypeValidationError") {
    return { category: "schema", retryable: false, message: truncate(raw) };
  }
  return { category: "unknown", retryable: false, message: truncate(raw) };
}

function truncate(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
