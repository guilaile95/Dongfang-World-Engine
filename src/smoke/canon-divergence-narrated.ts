import { ContextBuilder } from "../engine/context-builder.js";
import {
  Narrator,
  NarrativeEnvelopeBuilder,
  OpenAICompatibleNarrativeModelClient,
  type NarrativeModelClient,
  type NarrativeModelRequest,
} from "../engine/narrative.js";
import type { OpenAICompatibleChatClientOptions } from "../engine/openai-compatible-simulation-client.js";
import type { SimulationModelClient } from "../engine/simulation-adapter.js";
import type { TurnResult } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT,
  runCanonDivergenceScenario,
  type CanonDivergenceRunResult,
} from "./canon-divergence-harness.js";
import { isDirectExecution } from "./closed-inn-harness.js";

export interface CanonDivergenceNarratedConfig extends OpenAICompatibleChatClientOptions {}

export interface CanonDivergenceNarratedSampleResult {
  protocol: {
    kind: "canon_divergence_player_legibility";
    executionMode: "formal_network" | "injected_test";
    formalSample: boolean;
    rerollAllowed: false;
    model: string;
    simulationProviderCalls: 0;
    narratorProviderCalls: number;
  };
  result: CanonDivergenceRunResult;
  narrative: string | null;
  narrativeRedacted: boolean;
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

export async function runCanonDivergenceNarratedSample(
  config: CanonDivergenceNarratedConfig,
): Promise<CanonDivergenceNarratedSampleResult> {
  const store = new SqliteWorldStore();
  const injectedTestTransport = config.fetchImpl !== undefined;
  let narratorProviderCalls = 0;
  const narrativeTransport = new OpenAICompatibleNarrativeModelClient(config);
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
    const envelope = new NarrativeEnvelopeBuilder(new ContextBuilder(store)).build({
      intent: DEFAULT_CANON_DIVERGENCE_PLAYER_INTENT,
      turnResult,
    });
    const narrative = await new Narrator(narrativeModel).generate(envelope);
    const narrativeRedacted = narrative.includes(config.apiKey);

    return {
      protocol: {
        kind: "canon_divergence_player_legibility",
        executionMode: injectedTestTransport ? "injected_test" : "formal_network",
        formalSample: !injectedTestTransport,
        rerollAllowed: false,
        model: config.model,
        simulationProviderCalls: 0,
        narratorProviderCalls,
      },
      result,
      narrative: narrativeRedacted ? null : narrative,
      narrativeRedacted,
    };
  } finally {
    store.close();
  }
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
  const output = await runCanonDivergenceNarratedSample(config);
  console.log(JSON.stringify(output, null, 2));
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
