import {
  OpenAICompatibleNarrativeModelClient,
} from "../engine/narrative.js";
import {
  OpenAICompatibleSimulationModelClient,
} from "../engine/openai-compatible-simulation-client.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  isDirectExecution,
  runClosedInnTurns,
  type TurnStepConfig,
} from "./closed-inn-harness.js";

export const CLOSED_INN_NPC_INTENT = "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。";
export const CLOSED_INN_PLAYER_INTENT = "根据当前合法可见的信息观察、询问、调查、判断并决定下一步行动。";

export const CLOSED_INN_30_ACTOR_SEQUENCE = [
  "character-player",
  "character-npc-a",
  "character-npc-b",
  "character-npc-c",
] as const;

export function buildClosedInn30Steps(): TurnStepConfig[] {
  const steps: TurnStepConfig[] = [];
  for (let i = 0; i < 30; i += 1) {
    const actorId = CLOSED_INN_30_ACTOR_SEQUENCE[i % CLOSED_INN_30_ACTOR_SEQUENCE.length]!;
    const intent = actorId === "character-player" ? CLOSED_INN_PLAYER_INTENT : CLOSED_INN_NPC_INTENT;
    steps.push({ actorId, intent });
  }
  return steps;
}

export const CLOSED_INN_30_STEPS: TurnStepConfig[] = buildClosedInn30Steps();

async function main(): Promise<void> {
  const store = new SqliteWorldStore();
  const apiKey = requiredEnvironment("DWE_LLM_API_KEY");
  const baseUrl = requiredEnvironment("DWE_LLM_BASE_URL");
  const simulationModelName = requiredEnvironment("DWE_LLM_MODEL");
  const narratorModelName = process.env.DWE_LLM_NARRATOR_MODEL?.trim() || simulationModelName;

  try {
    const simulationClient = new OpenAICompatibleSimulationModelClient({
      baseUrl,
      apiKey,
      model: simulationModelName,
    });
    const narratorClient = new OpenAICompatibleNarrativeModelClient({
      baseUrl,
      apiKey,
      model: narratorModelName,
    });

    const result = await runClosedInnTurns({
      store,
      simulationModel: simulationClient,
      narratorModel: narratorClient,
      steps: CLOSED_INN_30_STEPS,
    });

    console.log(JSON.stringify({
      worldId: result.fixture.world.id,
      finalWorldRevision: result.finalWorldRevision,
      replayConsistent: result.replayConsistent,
      traces: result.traces.map((trace) => ({
        ...trace,
        narrative:
          trace.narrative !== null && trace.narrative.includes(apiKey)
            ? "[narrative omitted because it contained the configured secret]"
            : trace.narrative,
      })),
    }, null, 2));
  } finally {
    store.close();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Closed Inn 30-turn harness failed";
    console.error(JSON.stringify({ status: "error", message }, null, 2));
    process.exitCode = 1;
  });
}
