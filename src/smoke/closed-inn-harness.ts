import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import type { KnowledgeState, WorldSnapshot } from "../domain/types.js";

export interface TurnStepConfig {
  actorId: string;
  intent: string;
}

export interface VisibleClaimTrace {
  claimId: string;
  knowledgeState: KnowledgeState;
}

export interface TurnExecutionTrace {
  turnIndex: number;
  actorId: string;
  locationId: string | null;
  visibleClaims: VisibleClaimTrace[];
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
  narrative: string | null;
}

export interface ClosedInnRunResult {
  fixture: ClosedInnFixtureIds;
  traces: TurnExecutionTrace[];
  finalWorldRevision: number;
  replayConsistent: boolean;
}

export function canonicalSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    world: snapshot.world,
    locations: [...snapshot.locations].sort((a, b) => a.id.localeCompare(b.id)),
    locationConnections: [...snapshot.locationConnections].sort((a, b) =>
      `${a.fromLocationId}:${a.toLocationId}`.localeCompare(`${b.fromLocationId}:${b.toLocationId}`),
    ),
    characters: [...snapshot.characters].sort((a, b) => a.id.localeCompare(b.id)),
    facts: [...snapshot.facts].sort((a, b) => a.id.localeCompare(b.id)),
    claims: [...snapshot.claims].sort((a, b) => a.id.localeCompare(b.id)),
    knowledge: [...snapshot.knowledge].sort((a, b) =>
      `${a.characterId}:${a.claimId}`.localeCompare(`${b.characterId}:${b.claimId}`),
    ),
    predicatePolicies: [...snapshot.predicatePolicies].sort((a, b) => a.predicate.localeCompare(b.predicate)),
    relationships: [...snapshot.relationships].sort((a, b) =>
      `${a.sourceCharacterId}:${a.targetCharacterId}`.localeCompare(`${b.sourceCharacterId}:${b.targetCharacterId}`),
    ),
    seed: snapshot.seed,
  };
}

export const DEFAULT_CLOSED_INN_STEPS: TurnStepConfig[] = [
  {
    actorId: "character-player",
    intent: "在客栈大堂观察周围环境与在场人员，尝试向店小二阿宝询问客栈情况。",
  },
  {
    actorId: "character-npc-a",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-player",
    intent: "根据当前合法可见的信息，询问赵先生自己掌握的情况；这一回合不要主动向他传播你已有的 Claim。",
  },
  {
    actorId: "character-npc-b",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-npc-c",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-player",
    intent: "根据当前合法可见的信息，如果已经掌握有助于澄清情况的 Claim，可以选择向赵先生说明。",
  },
  {
    actorId: "character-npc-a",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-npc-b",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-npc-c",
    intent: "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。",
  },
  {
    actorId: "character-player",
    intent: "在大堂整理当前合法掌握的全部线索，决定下一步行动。",
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

    let narrative: string | null = null;
    if (step.actorId === fixture.characters.player.id) {
      const envelope = envelopeBuilder.build({
        intent: step.intent,
        turnResult,
        ...(options.contextBudget === undefined ? {} : { contextBudget: options.contextBudget }),
      });
      narrative = await narrator.generate(envelope);
    }

    traces.push({
      turnIndex,
      actorId: step.actorId,
      locationId: preContext.location?.id ?? null,
      visibleClaims: preContext.knowledge.map((k) => ({
        claimId: k.claim.id,
        knowledgeState: k.knowledge.knowledgeState,
      })),
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

  const replayConsistent =
    finalSnapshot.world.revision === allEvents.length &&
    JSON.stringify(canonicalSnapshot(rebuilt)) === JSON.stringify(canonicalSnapshot(finalSnapshot));

  return {
    fixture,
    traces,
    finalWorldRevision: finalSnapshot.world.revision,
    replayConsistent,
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

export function isDirectExecution(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (!argvEntry) {
    return false;
  }
  try {
    return fileURLToPath(moduleUrl) === resolve(argvEntry);
  } catch {
    return false;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Closed Inn harness failed";
    console.error(JSON.stringify({ status: "error", message }, null, 2));
    process.exitCode = 1;
  });
}
