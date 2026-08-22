export type ErrorCode =
  | "WORLD_NOT_FOUND"
  | "STALE_WORLD_STATE"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_DEAD"
  | "LOCATION_NOT_FOUND"
  | "CROSS_WORLD_REFERENCE"
  | "CHARACTERS_NOT_COLOCATED"
  | "FACT_NOT_FOUND"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_ALREADY_EXISTS"
  | "KNOWLEDGE_SOURCE_REQUIRED"
  | "KNOWLEDGE_STATE_ESCALATION"
  | "FACT_CONFLICT"
  | "SEED_NOT_FOUND"
  | "SEED_INVALID"
  | "INVALID_TIME"
  | "RELATIONSHIP_INVALID"
  | "EVENT_NOT_FOUND"
  | "EVENT_ALREADY_COMMITTED"
  | "INVALID_FACT_SUBJECT"
  | "INVALID_CLAIM_SUBJECT"
  | "VALIDATION_FAILED"
  | "COMMIT_FAILED";

export class KernelError extends Error {
  public readonly code: ErrorCode;
  public readonly context: Record<string, unknown>;

  public constructor(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.context = context;
  }
}

export function asKernelError(error: unknown): KernelError {
  if (error instanceof KernelError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown commit failure";
  return new KernelError("COMMIT_FAILED", message);
}
