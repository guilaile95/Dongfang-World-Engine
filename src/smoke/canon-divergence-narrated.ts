import { execFileSync } from "node:child_process";
import { ContextBuilder } from "../engine/context-builder.js";
import {
  DEFAULT_NARRATIVE_INSTRUCTIONS,
  NarrativeError,
  Narrator,
  NarrativeEnvelopeBuilder,
  OpenAICompatibleNarrativeModelClient,
  type NarrativeEnvelope,
  type NarrativeModelClient,
  type NarrativeModelRequest,
} from "../engine/narrative.js";
import type { OpenAICompatibleChatClientOptions } from "../engine/openai-compatible-simulation-client.js";
import type { SimulationModelClient } from "../engine/simulation-adapter.js";
import type { TurnResult } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT,
  canonDivergenceClaimGroundings,
  runCanonDivergenceScenario,
  type CanonDivergenceRunResult,
} from "./canon-divergence-harness.js";
import { isDirectExecution } from "./closed-inn-harness.js";

export interface CanonDivergenceNarratedConfig extends OpenAICompatibleChatClientOptions {}

export type CanonNarratorProviderOutcome =
  | "success"
  | "unknown_after_attempt"
  | "invalid_output_after_attempt"
  | "redacted_output_after_attempt";

export interface CanonDivergenceNarratedSampleResult {
  protocol: {
    kind: "canon_divergence_player_legibility";
    executionMode: "formal_network" | "default_transport" | "injected_test";
    formalSample: boolean;
    exactHeadSha: string | null;
    sampleConsumed: true;
    rerollAllowed: false;
    model: string;
    simulationProviderCalls: 0;
    narratorProviderCalls: number;
  };
  result: CanonDivergenceRunResult;
  providerOutcome: CanonNarratorProviderOutcome;
  providerError: {
    code: "NARRATIVE_OUTPUT_INVALID" | "NARRATIVE_TRANSPORT_ERROR";
    message: string;
  } | null;
  narrative: string | null;
  narrativeRedacted: boolean;
  narrativeRedactionReason: "configured_secret" | "request_artifact" | null;
}

export interface CanonDivergenceFormalPreflightInput {
  directExecution: boolean;
  branch: string;
  headSha: string;
  originMainSha: string;
  worktreeStatus: string;
  execArgv: string[];
  nodeOptions: string | undefined;
}

interface CanonDivergenceFormalExecution {
  commitSha: string;
}

export function readCanonDivergenceNarratedConfig(
  environment: NodeJS.ProcessEnv,
): CanonDivergenceNarratedConfig {
  return {
    baseUrl: requiredEnvironment(environment, "DWE_LLM_BASE_URL"),
    apiKey: requiredEnvironment(environment, "DWE_LLM_API_KEY"),
    model: requiredEnvironment(environment, "DWE_LLM_MODEL"),
  };
}

export function validateCanonDivergenceFormalPreflight(
  input: CanonDivergenceFormalPreflightInput,
): CanonDivergenceFormalExecution {
  if (!input.directExecution) {
    throw new Error("Formal Canon narration sample requires direct CLI execution");
  }
  if (input.branch.trim() !== "main") {
    throw new Error("Formal Canon narration sample requires the main branch");
  }
  if (!/^[0-9a-f]{40}$/.test(input.headSha.trim()) || input.headSha.trim() !== input.originMainSha.trim()) {
    throw new Error("Formal Canon narration sample requires exact origin/main HEAD");
  }
  if (input.worktreeStatus.trim().length > 0) {
    throw new Error("Formal Canon narration sample requires a clean worktree");
  }
  if (input.execArgv.length > 0 || (input.nodeOptions?.trim().length ?? 0) > 0) {
    throw new Error("Formal Canon narration sample forbids Node preload or execution flags");
  }
  return { commitSha: input.headSha.trim() };
}

export async function runCanonDivergenceNarratedSample(
  config: CanonDivergenceNarratedConfig,
): Promise<CanonDivergenceNarratedSampleResult> {
  return executeCanonDivergenceNarratedSample(config, null);
}

async function executeCanonDivergenceNarratedSample(
  config: CanonDivergenceNarratedConfig,
  formalExecution: CanonDivergenceFormalExecution | null,
): Promise<CanonDivergenceNarratedSampleResult> {
  const store = new SqliteWorldStore();
  const injectedTestTransport = config.fetchImpl !== undefined;
  const underlyingFetch = config.fetchImpl ?? fetch;
  const singleRequestFetch = ((input: string | URL | Request, init?: RequestInit) =>
    underlyingFetch(input, { ...init, redirect: "error" })) as typeof fetch;
  let narratorProviderCalls = 0;
  const narrativeTransport = new OpenAICompatibleNarrativeModelClient({
    ...config,
    fetchImpl: singleRequestFetch,
  });
  const narrativeModel: NarrativeModelClient = {
    async generate(request: NarrativeModelRequest): Promise<string> {
      narratorProviderCalls += 1;
      return narrativeTransport.generate(request);
    },
  };

  const simulationModel: SimulationModelClient = {
    async generate(request) {
      const westTower = request.context.movementOptions.find((option) => option.name === "West Tower");
      if (!westTower) {
        throw new Error("Deterministic Canon narration setup could not find the observer-visible West Tower option");
      }
      return {
        proposals: [{
          type: "character.move",
          actorId: request.context.observer.id,
          toLocationId: westTower.locationId,
        }],
      };
    },
  };

  try {
    const result = await runCanonDivergenceScenario({
      store,
      simulationModel,
      fixtureSuffix: "formal-narrated-sample",
    });
    const moveEvent = store.listEvents(result.fixture.worldId).find(
      (event) => event.type === "character.move" && event.actorIds.length === 1 &&
        event.actorIds[0] === result.fixture.playerId,
    );
    if (
      result.playerTurn.status !== "success" ||
      result.playerTurn.rejection !== null ||
      !moveEvent ||
      !result.authoredConsequence.triggered ||
      !result.playerConsequenceKnowledge.acquired ||
      result.playerConsequenceKnowledge.knowledgeState !== "confirmed" ||
      result.playerConsequenceKnowledge.sourceEventType !== "claim.record" ||
      result.oldCanonAttempt.committed ||
      result.oldCanonAttempt.rejectionCode !== "FACT_PRECONDITION_FAILED" ||
      result.oldCanonAttempt.rejectionLeftStateUnchanged !== true ||
      !result.replayConsistent
    ) {
      throw new Error("Deterministic Canon narration setup did not satisfy its authority preconditions");
    }

    const turnResult: TurnResult = {
      status: "success",
      worldId: result.fixture.worldId,
      actorCharacterId: result.fixture.playerId,
      committedEvents: [moveEvent],
      state: null,
      rejection: null,
      contextBuilds: 1,
      simulationAttempts: 1,
    };
    const envelope = new NarrativeEnvelopeBuilder(new ContextBuilder(
      store,
      canonDivergenceClaimGroundings({
        worldId: result.fixture.worldId,
        playerId: result.fixture.playerId,
      }),
    )).build({
      intent: DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT,
      turnResult,
    });

    let narrative: string;
    try {
      narrative = await new Narrator(narrativeModel).generate(envelope);
    } catch (error) {
      const narrativeError = error instanceof NarrativeError
        ? error
        : new NarrativeError("NARRATIVE_TRANSPORT_ERROR", "Narrator model transport failed");
      return createReceipt({
        config,
        formalExecution,
        injectedTestTransport,
        narratorProviderCalls,
        result,
        providerOutcome: narrativeError.code === "NARRATIVE_OUTPUT_INVALID"
          ? "invalid_output_after_attempt"
          : "unknown_after_attempt",
        providerError: { code: narrativeError.code, message: narrativeError.message },
        narrative: null,
        narrativeRedactionReason: null,
      });
    }

    const narrativeRedactionReason = getNarrativeRedactionReason(narrative, config, envelope);
    return createReceipt({
      config,
      formalExecution,
      injectedTestTransport,
      narratorProviderCalls,
      result,
      providerOutcome: narrativeRedactionReason === null ? "success" : "redacted_output_after_attempt",
      providerError: null,
      narrative: narrativeRedactionReason === null ? narrative : null,
      narrativeRedactionReason,
    });
  } finally {
    store.close();
  }
}

function createReceipt(input: {
  config: CanonDivergenceNarratedConfig;
  formalExecution: CanonDivergenceFormalExecution | null;
  injectedTestTransport: boolean;
  narratorProviderCalls: number;
  result: CanonDivergenceRunResult;
  providerOutcome: CanonNarratorProviderOutcome;
  providerError: CanonDivergenceNarratedSampleResult["providerError"];
  narrative: string | null;
  narrativeRedactionReason: CanonDivergenceNarratedSampleResult["narrativeRedactionReason"];
}): CanonDivergenceNarratedSampleResult {
  return {
    protocol: {
      kind: "canon_divergence_player_legibility",
      executionMode: input.formalExecution
        ? "formal_network"
        : input.injectedTestTransport ? "injected_test" : "default_transport",
      formalSample: input.formalExecution !== null,
      exactHeadSha: input.formalExecution?.commitSha ?? null,
      sampleConsumed: true,
      rerollAllowed: false,
      model: input.config.model.includes(input.config.apiKey)
        ? "[model omitted because it contained the configured secret]"
        : input.config.model,
      simulationProviderCalls: 0,
      narratorProviderCalls: input.narratorProviderCalls,
    },
    result: input.result,
    providerOutcome: input.providerOutcome,
    providerError: input.providerError,
    narrative: input.narrative,
    narrativeRedacted: input.narrativeRedactionReason !== null,
    narrativeRedactionReason: input.narrativeRedactionReason,
  };
}

function getNarrativeRedactionReason(
  narrative: string,
  config: CanonDivergenceNarratedConfig,
  envelope: NarrativeEnvelope,
): CanonDivergenceNarratedSampleResult["narrativeRedactionReason"] {
  if (narrative.includes(config.apiKey)) {
    return "configured_secret";
  }
  const serializedEnvelope = JSON.stringify(envelope);
  const serializedRequest = JSON.stringify({
    model: config.model,
    messages: [
      { role: "system", content: DEFAULT_NARRATIVE_INSTRUCTIONS },
      { role: "user", content: serializedEnvelope },
    ],
  });
  const hasRequestScaffold = narrative.includes("\"messages\"") &&
    narrative.includes("\"role\":\"system\"") && narrative.includes("\"role\":\"user\"");
  const hasEnvelopeScaffold = narrative.includes("\"observerContext\"") &&
    narrative.includes("\"outcomes\"") && narrative.includes("\"turnStatus\"");
  const hasEscapedEnvelope = narrative.includes("\\\"observerContext\\\"") &&
    narrative.includes("\\\"outcomes\\\"") && narrative.includes("\\\"turnStatus\\\"");
  if (
    narrative.includes(DEFAULT_NARRATIVE_INSTRUCTIONS) ||
    narrative.includes(DEFAULT_NARRATIVE_INSTRUCTIONS.slice(0, 80)) ||
    narrative.includes(serializedEnvelope) ||
    narrative.includes(serializedRequest) ||
    hasRequestScaffold ||
    hasEnvelopeScaffold ||
    hasEscapedEnvelope
  ) {
    return "request_artifact";
  }
  return null;
}

export function safeCanonDivergenceNarratedError(
  error: unknown,
  configuredApiKey?: string,
): { status: "error"; kind: "configuration" | "runtime"; message: string } {
  const fallback = "Canon divergence narrated sample failed";
  let message = error instanceof Error ? error.message : fallback;
  if (configuredApiKey && message.includes(configuredApiKey)) {
    message = fallback;
  }
  return {
    status: "error",
    kind: message.startsWith("Missing required environment variable:") ? "configuration" : "runtime",
    message: message.slice(0, 500),
  };
}

async function main(): Promise<void> {
  const config = readCanonDivergenceNarratedConfig(process.env);
  const formalExecution = collectFormalExecution();
  const output = await executeCanonDivergenceNarratedSample(config, formalExecution);
  console.log(JSON.stringify(output, null, 2));
}

function collectFormalExecution(): CanonDivergenceFormalExecution {
  return validateCanonDivergenceFormalPreflight({
    directExecution: isDirectExecution(import.meta.url, process.argv[1]),
    branch: readGit(["branch", "--show-current"]),
    headSha: readGit(["rev-parse", "HEAD"]),
    originMainSha: readGit(["rev-parse", "origin/main"]),
    worktreeStatus: readGit(["status", "--porcelain"]),
    execArgv: [...process.execArgv],
    nodeOptions: process.env.NODE_OPTIONS,
  });
}

function readGit(arguments_: string[]): string {
  return execFileSync("git", arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify(
      safeCanonDivergenceNarratedError(error, process.env.DWE_LLM_API_KEY?.trim()),
      null,
      2,
    ));
    process.exitCode = 1;
  });
}
