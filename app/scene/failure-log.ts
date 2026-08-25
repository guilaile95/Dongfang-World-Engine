import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CallRecord } from "../model/types.js";
import { assertNoSecret } from "../secrets.js";

export const INTERPRETATION_FAILURE_LOG = resolve("data/local/interpretation-failures.jsonl");

export interface InterpretationFailure {
  at: string;
  playerLine: string;
  purpose: string;
  model: string;
  latencyMs: number;
  errorCategory: CallRecord["errorCategory"];
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attempts: CallRecord["attempts"];
}

export function interpretationFailureFrom(
  playerLine: string,
  record: CallRecord,
): InterpretationFailure {
  return {
    at: new Date().toISOString(),
    playerLine,
    purpose: record.purpose,
    model: record.model,
    latencyMs: record.latencyMs,
    errorCategory: record.errorCategory,
    errorMessage: record.errorMessage,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    attempts: record.attempts,
  };
}

export function persistInterpretationFailure(row: InterpretationFailure, apiKey: string): void {
  const line = `${JSON.stringify(row)}\n`;
  assertNoSecret(line, apiKey, "interpretation failure log");
  mkdirSync("data/local", { recursive: true });
  appendFileSync(INTERPRETATION_FAILURE_LOG, line, "utf8");
}
