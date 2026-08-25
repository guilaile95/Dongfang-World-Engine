import type { ErrorCategory, StructuredAttempt, StructuredMode, TokenUsage, ZodIssuePath } from "./types.js";

export const RAW_TEXT_LIMIT = 1500;

export function truncateRaw(text: string | null | undefined, limit = RAW_TEXT_LIMIT): string | null {
  if (text == null) {
    return null;
  }
  const one = text.replace(/\r\n/g, "\n");
  if (one.length <= limit) {
    return one;
  }
  return `${one.slice(0, limit)}…`;
}

export function zodIssuePaths(error: unknown): ZodIssuePath[] {
  if (!error || typeof error !== "object") {
    return [];
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as { path?: unknown; message?: unknown; code?: unknown };
    const path = Array.isArray(row.path) ? row.path.map(String).join(".") : "";
    return [
      {
        path: path.length > 0 ? path : "(root)",
        message: typeof row.message === "string" ? row.message : String(row.message ?? "invalid"),
        code: typeof row.code === "string" || typeof row.code === "number" ? String(row.code) : null,
      },
    ];
  });
}

export function isZodLike(error: unknown): boolean {
  return zodIssuePaths(error).length > 0;
}

export function attempt(input: {
  stage: StructuredMode extends "none" ? never : Exclude<StructuredMode, "none">;
  started: number;
  usage?: TokenUsage | null;
  rawText?: string | null;
  extractError?: string | null;
  zodIssues?: ZodIssuePath[];
  errorCategory: ErrorCategory;
  errorMessage?: string | null;
}): StructuredAttempt {
  return {
    stage: input.stage,
    latencyMs: Date.now() - input.started,
    inputTokens: input.usage?.inputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
    rawText: truncateRaw(input.rawText),
    extractError: input.extractError ?? null,
    zodIssues: input.zodIssues ?? [],
    errorCategory: input.errorCategory,
    errorMessage: input.errorMessage ?? null,
  };
}

export function sumUsage(attempts: StructuredAttempt[]): TokenUsage {
  let input = 0;
  let output = 0;
  let any = false;
  for (const row of attempts) {
    if (row.inputTokens != null) {
      input += row.inputTokens;
      any = true;
    }
    if (row.outputTokens != null) {
      output += row.outputTokens;
      any = true;
    }
  }
  return {
    inputTokens: any ? input : null,
    outputTokens: any ? output : null,
  };
}
