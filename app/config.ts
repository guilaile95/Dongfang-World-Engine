import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicFields } from "./secrets.js";

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  worldFile: string;
  worldSource: string | null;
  maxRetries: number;
  timeoutMs: number;
  fallbackModel: string | null;
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    applyDotEnv();
  }
  return {
    baseUrl: required(env, "DWE_LLM_BASE_URL"),
    apiKey: required(env, "DWE_LLM_API_KEY"),
    model: required(env, "DWE_LLM_MODEL"),
    worldFile: resolve(env.DWE_WORLD_FILE?.trim() || "data/local/world.sqlite"),
    worldSource: env.DWE_WORLD_SOURCE?.trim() ? resolve(env.DWE_WORLD_SOURCE.trim()) : null,
    maxRetries: integer(env.DWE_LLM_MAX_RETRIES, 2),
    timeoutMs: integer(env.DWE_LLM_TIMEOUT_MS, 60_000),
    fallbackModel: emptyToNull(env.DWE_LLM_FALLBACK_MODEL),
    inputUsdPerMtok: floatOrNull(env.DWE_LLM_INPUT_USD_PER_MTOK),
    outputUsdPerMtok: floatOrNull(env.DWE_LLM_OUTPUT_USD_PER_MTOK),
  };
}

export function configForLog(config: AppConfig): Record<string, string> {
  return publicFields(config);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function integer(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function floatOrNull(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Load .env into process.env without overriding existing values. Never log values. */
function applyDotEnv(): void {
  const file = resolve(".env");
  if (!existsSync(file)) {
    return;
  }
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
