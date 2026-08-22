import { ContextBuilder } from "../engine/context-builder.js";
import { CommitKernel } from "../engine/commit-kernel.js";
import {
  DEFAULT_NARRATIVE_INSTRUCTIONS,
  Narrator,
  NarrativeEnvelopeBuilder,
  OpenAICompatibleNarrativeModelClient,
  type NarrativeModelClient,
} from "../engine/narrative.js";
import {
  OpenAICompatibleSimulationModelClient,
} from "../engine/openai-compatible-simulation-client.js";
import {
  SimulationAdapter,
  type SimulationModelClient,
} from "../engine/simulation-adapter.js";
import { TurnOrchestrator } from "../engine/turn-orchestrator.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import { seedClosedInnWorld, type ClosedInnFixtureIds } from "../testkit/world-builder.js";
import { rebuildState } from "../engine/projector.js";

export interface TurnStepConfig {
  actorId: string;
  intent: string;
}

export interface TurnExecutionTrace {
  turnIndex: number;
  actorId: string;
  locationId: string | null;
  visibleClaimIds: string[];
  turnStatus: string;
  committedEvents: Array<{
    type: string;
    worldRevision: number;
    eventTime: string;
  }>;
  rejection: {
    kind: string;
    code: string;
  } | null;
  narrative: string;
}

export interface ClosedInnRunResult {
  fixture: ClosedInnFixtureIds;
  traces: TurnExecutionTrace[];
  finalWorldRevision: number;
  assertionsPassed: boolean;
}

export const DEFAULT_CLOSED_INN_STEPS: TurnStepConfig[] = [
  {
    actorId: "character-player",
    intent: "在客栈大堂观察周围环境与在场人员",
  },
  {
    actorId: "character-npc-a",
    intent: "根据你当前合法可见的信息决定下一步行动，向大堂内的旅客楚子航告知匕首掉在地窖的消息",
  },
  {
    actorId: "character-player",
    intent: "根据刚刚获知的信息，动身前往客栈地窖查看情况",
  },
  {
    actorId: "character-npc-b",
    intent: "根据当前合法可见的信息决定下一步行动",
  },
  {
    actorId: "character-npc-c",
    intent: "根据当前合法可见的信息决定下一步行动，在二楼客房静观其变",
  },
  {
    actorId: "character-player",
    intent: "在客栈地窖查看情况，然后返回客栈大堂",
  },
  {
    actorId: "character-player",
    intent: "在大堂向账房赵先生说明匕首掉在地窖的情况",
  },
  {
    actorId: "character-npc-b",
    intent: "根据当前合法可见的信息与新获得的信息决定下一步行动",
  },
  {
    actorId: "character-npc-a",
    intent: "根据当前合法可见的信息决定下一步行动",
  },
  {
    actorId: "character-player",
    intent: "确认当前掌握的线索，准备离开客栈",
  },
];

export interface RunClosedInnOptions {
  store: SqliteWorldStore;
  simulationModel: SimulationModelClient;
  narratorModel: NarrativeModelClient;
  steps?: TurnStepConfig[];
  contextBudget?: number;
}

export async function runClosedInnTurns(options: RunClosedInnOptions): Promise<ClosedInnRunResult> {
  const { store, simulationModel, narratorModel } = options;
  const fixture = seedClosedInnWorld(store);
  const contextBuilder = new ContextBuilder(store);
  const simulationAdapter = new SimulationAdapter(simulationModel, {
    modelId: "closed-inn-simulation",
  });
  const commitKernel = new CommitKernel(store);
  const turnOrchestrator = new TurnOrchestrator({
    stateReader: store,
    contextBuilder,
    simulationAdapter,
    commitKernel,
  });
  const envelopeBuilder = new NarrativeEnvelopeBuilder(contextBuilder);
  const narrator = new Narrator(narratorModel, {
    instructions: DEFAULT_NARRATIVE_INSTRUCTIONS,
  });

  const steps = options.steps ?? DEFAULT_CLOSED_INN_STEPS;
  const traces: TurnExecutionTrace[] = [];

  const initialSnapshot = store.getSnapshot(fixture.world.id);

  for (let turnIndex = 1; turnIndex <= steps.length; turnIndex += 1) {
    const step = steps[turnIndex - 1];
    if (!step) {
      continue;
    }

    const preContext = contextBuilder.buildCharacterContext({
      worldId: fixture.world.id,
      observerCharacterId: step.actorId,
      ...(options.contextBudget === undefined ? {} : { budget: options.contextBudget }),
    });

    const turnResult = await turnOrchestrator.runActorTurn({
      worldId: fixture.world.id,
      actorCharacterId: step.actorId,
      intent: step.intent,
      ...(options.contextBudget === undefined ? {} : { contextBudget: options.contextBudget }),
    });

    const envelope = envelopeBuilder.build({
      intent: step.intent,
      turnResult,
      ...(options.contextBudget === undefined ? {} : { contextBudget: options.contextBudget }),
    });

    const narrative = await narrator.generate(envelope);

    traces.push({
      turnIndex,
      actorId: step.actorId,
      locationId: preContext.location?.id ?? null,
      visibleClaimIds: preContext.knowledge.map((k) => k.claim.id),
      turnStatus: turnResult.status,
      committedEvents: turnResult.committedEvents.map((event) => ({
        type: event.type,
        worldRevision: event.worldRevision,
        eventTime: event.eventTime,
      })),
      rejection: turnResult.rejection
        ? {
          kind: turnResult.rejection.kind,
          code: turnResult.rejection.code,
        }
        : null,
      narrative,
    });
  }

  const finalSnapshot = store.getSnapshot(fixture.world.id);
  const allEvents = store.listEvents(fixture.world.id);
  const rebuilt = rebuildState(initialSnapshot, allEvents);

  const assertionsPassed =
    finalSnapshot.world.revision === allEvents.length &&
    rebuilt.world.revision === finalSnapshot.world.revision &&
    rebuilt.characters.length === finalSnapshot.characters.length &&
    rebuilt.knowledge.length === finalSnapshot.knowledge.length;

  return {
    fixture,
    traces,
    finalWorldRevision: finalSnapshot.world.revision,
    assertionsPassed,
  };
}

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
    });

    console.log(JSON.stringify({
      worldId: result.fixture.world.id,
      finalWorldRevision: result.finalWorldRevision,
      assertionsPassed: result.assertionsPassed,
      traces: result.traces.map((trace) => ({
        ...trace,
        narrative: trace.narrative.includes(apiKey)
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Closed Inn harness failed";
    console.error(JSON.stringify({ status: "error", message }, null, 2));
    process.exitCode = 1;
  });
}
