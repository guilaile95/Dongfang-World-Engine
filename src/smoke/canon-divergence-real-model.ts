import {
  OpenAICompatibleSimulationModelClient,
  type OpenAICompatibleSimulationClientOptions,
} from "../engine/openai-compatible-simulation-client.js";
import type { SimulationModelClient, SimulationModelRequest } from "../engine/simulation-adapter.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  runCanonDivergenceScenario,
  type CanonDivergenceRunResult,
} from "./canon-divergence-harness.js";
import { isDirectExecution } from "./closed-inn-harness.js";

export interface CanonDivergenceRealModelConfig extends OpenAICompatibleSimulationClientOptions {}

export interface CanonDivergenceFormalSampleResult {
  protocol: {
    kind: "canon_divergence_action_selection";
    executionMode: "formal_network" | "injected_test";
    formalSample: boolean;
    rerollAllowed: false;
    model: string;
    providerCalls: number;
  };
  result: CanonDivergenceRunResult;
}

export function readCanonDivergenceRealModelConfig(
  environment: NodeJS.ProcessEnv,
): CanonDivergenceRealModelConfig {
  return {
    baseUrl: requiredEnvironment(environment, "DWE_LLM_BASE_URL"),
    apiKey: requiredEnvironment(environment, "DWE_LLM_API_KEY"),
    model: requiredEnvironment(environment, "DWE_LLM_MODEL"),
  };
}

export async function runCanonDivergenceRealModelSample(
  config: CanonDivergenceRealModelConfig,
): Promise<CanonDivergenceFormalSampleResult> {
  const store = new SqliteWorldStore();
  const injectedTestTransport = config.fetchImpl !== undefined;
  let providerCalls = 0;
  const transport = new OpenAICompatibleSimulationModelClient(config);
  const simulationModel: SimulationModelClient = {
    async generate(request: SimulationModelRequest): Promise<unknown> {
      providerCalls += 1;
      return transport.generate(request);
    },
  };

  try {
    const result = await runCanonDivergenceScenario({
      store,
      simulationModel,
      fixtureSuffix: "formal-real-model-sample",
    });
    return {
      protocol: {
        kind: "canon_divergence_action_selection",
        executionMode: injectedTestTransport ? "injected_test" : "formal_network",
        formalSample: !injectedTestTransport,
        rerollAllowed: false,
        model: config.model,
        providerCalls,
      },
      result,
    };
  } finally {
    store.close();
  }
}

export function safeCanonDivergenceSampleError(
  error: unknown,
  configuredApiKey?: string,
): { status: "error"; kind: "configuration" | "runtime"; message: string } {
  const fallback = "Canon divergence real-model sample failed";
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
  const config = readCanonDivergenceRealModelConfig(process.env);
  const output = await runCanonDivergenceRealModelSample(config);
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
      safeCanonDivergenceSampleError(error, process.env.DWE_LLM_API_KEY?.trim()),
      null,
      2,
    ));
    process.exitCode = 1;
  });
}
