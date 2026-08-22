import { ContextBuilder } from "../engine/context-builder.js";
import { CommitKernel } from "../engine/commit-kernel.js";
import { OpenAICompatibleSimulationModelClient } from "../engine/openai-compatible-simulation-client.js";
import { SimulationAdapter } from "../engine/simulation-adapter.js";
import { TurnOrchestrator } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import { seedTestWorld } from "../testkit/world-builder.js";

async function main(): Promise<void> {
  const store = new SqliteWorldStore();
  try {
    const ids = seedTestWorld(store);
    const contextBuilder = new ContextBuilder(store);
    const modelClient = new OpenAICompatibleSimulationModelClient({
      baseUrl: requiredEnvironment("DWE_LLM_BASE_URL"),
      apiKey: requiredEnvironment("DWE_LLM_API_KEY"),
      model: requiredEnvironment("DWE_LLM_MODEL"),
    });
    const simulationAdapter = new SimulationAdapter(modelClient, {
      modelId: "openai-compatible-smoke",
    });
    const orchestrator = new TurnOrchestrator({
      stateReader: store,
      contextBuilder,
      simulationAdapter,
      commitKernel: new CommitKernel(store),
    });

    const result = await orchestrator.runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent: process.env.DWE_SMOKE_INTENT?.trim() || "观察当前环境并提出一个合法行动",
    });

    console.log(JSON.stringify({
      status: result.status,
      rejection: result.rejection,
      committedEvents: result.committedEvents.map((event) => ({
        type: event.type,
        worldRevision: event.worldRevision,
        eventTime: event.eventTime,
      })),
      finalWorldRevision: result.state?.world.revision ?? null,
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Headless smoke failed";
  console.error(JSON.stringify({ status: "error", message }, null, 2));
  process.exitCode = 1;
});
