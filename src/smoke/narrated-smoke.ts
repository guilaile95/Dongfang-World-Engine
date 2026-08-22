import { ContextBuilder } from "../engine/context-builder.js";
import { CommitKernel } from "../engine/commit-kernel.js";
import {
  DEFAULT_NARRATIVE_INSTRUCTIONS,
  Narrator,
  NarrativeEnvelopeBuilder,
  OpenAICompatibleNarrativeModelClient,
} from "../engine/narrative.js";
import { OpenAICompatibleSimulationModelClient } from "../engine/openai-compatible-simulation-client.js";
import { SimulationAdapter } from "../engine/simulation-adapter.js";
import { TurnOrchestrator } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import { seedTestWorld } from "../testkit/world-builder.js";

async function main(): Promise<void> {
  const store = new SqliteWorldStore();
  const apiKey = requiredEnvironment("DWE_LLM_API_KEY");
  const baseUrl = requiredEnvironment("DWE_LLM_BASE_URL");
  const simulationModel = requiredEnvironment("DWE_LLM_MODEL");
  const narratorModel = process.env.DWE_LLM_NARRATOR_MODEL?.trim() || simulationModel;

  try {
    const ids = seedTestWorld(store);
    const contextBuilder = new ContextBuilder(store);
    const simulationAdapter = new SimulationAdapter(
      new OpenAICompatibleSimulationModelClient({
        baseUrl,
        apiKey,
        model: simulationModel,
      }),
      { modelId: "openai-compatible-narrated-smoke-simulation" },
    );
    const turnOrchestrator = new TurnOrchestrator({
      stateReader: store,
      contextBuilder,
      simulationAdapter,
      commitKernel: new CommitKernel(store),
    });
    const intent = process.env.DWE_SMOKE_INTENT?.trim() || "观察当前环境并提出一个合法行动";
    const turnResult = await turnOrchestrator.runActorTurn({
      worldId: ids.world.id,
      actorCharacterId: ids.characters.player.id,
      intent,
    });
    const envelope = new NarrativeEnvelopeBuilder(contextBuilder).build({
      intent,
      turnResult,
    });
    const narrative = await new Narrator(
      new OpenAICompatibleNarrativeModelClient({
        baseUrl,
        apiKey,
        model: narratorModel,
      }),
      { instructions: DEFAULT_NARRATIVE_INSTRUCTIONS },
    ).generate(envelope);

    console.log(JSON.stringify({
      turn: {
        status: turnResult.status,
        rejection: turnResult.rejection,
        committedEvents: turnResult.committedEvents.map((event) => ({
          type: event.type,
          worldRevision: event.worldRevision,
          eventTime: event.eventTime,
        })),
        finalWorldRevision: turnResult.state?.world.revision ?? null,
      },
      narrative: narrative.includes(apiKey)
        ? "[narrative omitted because it contained the configured secret]"
        : narrative,
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
  const message = error instanceof Error ? error.message : "Narrated smoke failed";
  console.error(JSON.stringify({ status: "error", message }, null, 2));
  process.exitCode = 1;
});
