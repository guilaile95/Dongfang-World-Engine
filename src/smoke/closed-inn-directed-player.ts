import {
  OpenAICompatibleNarrativeModelClient,
} from "../engine/narrative.js";
import {
  OpenAICompatibleSimulationModelClient,
} from "../engine/openai-compatible-simulation-client.js";
import type { CommittedEvent, EventType } from "../domain/types.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  isDirectExecution,
  runClosedInnTurns,
  type ClosedInnRunResult,
  type TurnExecutionTrace,
  type TurnStepConfig,
} from "./closed-inn-harness.js";

export const CLOSED_INN_DIRECTED_PLAYER_BASE_SHA =
  "a093ee973790272ac4bd495239fc2e6e620fc328";

export const CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT =
  "根据你当前合法可见的信息和自己的目标，自主决定下一步行动。";

export const CLOSED_INN_DIRECTED_PLAYER_STEPS: readonly TurnStepConfig[] = [
  {
    actorId: "character-player",
    intent: "在客栈大堂观察周围环境，接近店小二阿宝并留在同一区域，观察并准备获知其可能主动透露的信息。",
  },
  {
    actorId: "character-npc-a",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "在客栈大堂接近账房赵先生，观察并准备获知其可能主动透露的信息；本回合不要主动传播自己的 Claim。",
  },
  {
    actorId: "character-npc-b",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "通过连接通道离开客栈大堂，明确移动至二楼客房。",
  },
  {
    actorId: "character-npc-c",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "在二楼客房接近行商孙掌柜，观察并准备获知其可能主动透露的信息；本回合不要主动向其传播自己的 Claim。",
  },
  {
    actorId: "character-npc-c",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "离开二楼客房，通过连接通道返回客栈大堂。",
  },
  {
    actorId: "character-npc-b",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "在客栈大堂中，根据自己实际已经掌握且持有的 Claim，主动向账房赵先生说明一条确切信息。",
  },
  {
    actorId: "character-npc-b",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-npc-a",
    intent: CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  },
  {
    actorId: "character-player",
    intent: "在客栈大堂整理自己合法掌握的全部线索与各方反应，评估匕首下落并做出最终判断。",
  },
];

export interface SafeExperimentEventSummary {
  eventId: string;
  type: EventType;
  worldRevision: number;
  eventTime: string;
}

export interface SafePlayerContext {
  locationId: string | null;
  visibleClaims: Array<{
    claimId: string;
    knowledgeState: TurnExecutionTrace["visibleClaims"][number]["knowledgeState"];
  }>;
}

export type SafePlayerOutcome =
  | {
    eventId: string;
    type: "character.move";
    toLocationId: string;
  }
  | {
    eventId: string;
    type: "claim.transmit";
    claimId: string;
    targetCharacterId: string;
  };

export interface SafePlayerReceivedOutcome {
  eventId: string;
  type: "claim.transmit";
  sourceCharacterId: string;
  claimId: string;
}

export interface SafeExperimentTurnTrace {
  turnIndex: number;
  actorId: string;
  frozenIntent: string;
  turnStatus: string;
  rejection: {
    kind: string;
    code: string;
  } | null;
  committedEvents: SafeExperimentEventSummary[];
  playerContext: SafePlayerContext | null;
  playerOutcomes: SafePlayerOutcome[];
  playerReceivedOutcomes: SafePlayerReceivedOutcome[];
}

export interface SafeExperimentRunResult {
  frozenBaseSha: string;
  finalWorldRevision: number;
  replayConsistent: boolean;
  traces: SafeExperimentTurnTrace[];
}

export interface DirectedPlayerProjectionInput {
  finalWorldRevision: number;
  replayConsistent: boolean;
  traces: TurnExecutionTrace[];
}

export function projectSafeExperimentRun(
  input: DirectedPlayerProjectionInput,
  authoritativeEvents: CommittedEvent[],
  steps: readonly TurnStepConfig[] = CLOSED_INN_DIRECTED_PLAYER_STEPS,
): SafeExperimentRunResult {
  if (input.traces.length !== steps.length) {
    throw new Error(`Directed-player trace count mismatch: expected ${steps.length}, got ${input.traces.length}`);
  }

  const traces = input.traces.map((trace, index) => {
    const step = steps[index];
    if (!step) {
      throw new Error(`Missing frozen directed-player step ${index + 1}`);
    }
    if (trace.turnIndex !== index + 1 || trace.actorId !== step.actorId) {
      throw new Error(`Directed-player trace does not match frozen turn ${index + 1}`);
    }

    const mappedEvents = trace.committedEvents.map((summary) =>
      findAuthoritativeEvent(summary, authoritativeEvents),
    );
    const isPlayerTurn = step.actorId === "character-player";

    return {
      turnIndex: index + 1,
      actorId: step.actorId,
      frozenIntent: step.intent,
      turnStatus: trace.turnStatus,
      rejection: trace.rejection,
      committedEvents: mappedEvents.map(toSafeEventSummary),
      playerContext: isPlayerTurn
        ? {
          locationId: trace.locationId,
          visibleClaims: trace.visibleClaims.map((claim) => ({
            claimId: claim.claimId,
            knowledgeState: claim.knowledgeState,
          })),
        }
        : null,
      playerOutcomes: isPlayerTurn
        ? mappedEvents.flatMap((event) => toPlayerOutcome(event, trace))
        : [],
      playerReceivedOutcomes: isPlayerTurn
        ? []
        : mappedEvents.flatMap(toPlayerReceivedOutcome),
    } satisfies SafeExperimentTurnTrace;
  });

  return {
    frozenBaseSha: CLOSED_INN_DIRECTED_PLAYER_BASE_SHA,
    finalWorldRevision: input.finalWorldRevision,
    replayConsistent: input.replayConsistent,
    traces,
  };
}

function findAuthoritativeEvent(
  summary: TurnExecutionTrace["committedEvents"][number],
  authoritativeEvents: CommittedEvent[],
): CommittedEvent {
  const matches = authoritativeEvents.filter((event) => event.worldRevision === summary.worldRevision);
  if (matches.length !== 1) {
    throw new Error(`Authoritative event revision ${summary.worldRevision} did not resolve uniquely`);
  }
  const event = matches[0]!;
  if (event.type !== summary.type || event.eventTime !== summary.eventTime) {
    throw new Error(`Authoritative event revision ${summary.worldRevision} does not match trace summary`);
  }
  return event;
}

function toSafeEventSummary(event: CommittedEvent): SafeExperimentEventSummary {
  return {
    eventId: event.id,
    type: event.type,
    worldRevision: event.worldRevision,
    eventTime: event.eventTime,
  };
}

function toPlayerOutcome(
  event: CommittedEvent,
  trace: TurnExecutionTrace,
): SafePlayerOutcome[] {
  if (!isSoleActor(event, "character-player")) {
    return [];
  }

  if (event.type === "character.move") {
    const actorId = readRequiredPayloadString(event, "actorId");
    if (actorId !== "character-player") {
      throw new Error(`Player move event ${event.id} does not match its authoritative actor`);
    }
    return [{
      eventId: event.id,
      type: event.type,
      toLocationId: readRequiredPayloadString(event, "toLocationId"),
    }];
  }

  if (event.type === "claim.transmit") {
    const sourceCharacterId = readRequiredPayloadString(event, "sourceCharacterId");
    if (sourceCharacterId !== "character-player") {
      throw new Error(`Player transmit event ${event.id} does not match its authoritative source`);
    }
    const claimId = readRequiredPayloadString(event, "claimId");
    if (!trace.visibleClaims.some((claim) => claim.claimId === claimId)) {
      throw new Error(`Player transmitted a claim absent from the player context: ${claimId}`);
    }
    const targetCharacterId = readRequiredPayloadString(event, "targetCharacterId");
    if (!event.targetIds.includes(targetCharacterId)) {
      throw new Error(`Player transmit target does not match authoritative target ids for ${event.id}`);
    }
    return [{
      eventId: event.id,
      type: event.type,
      claimId,
      targetCharacterId,
    }];
  }

  return [];
}

function toPlayerReceivedOutcome(event: CommittedEvent): SafePlayerReceivedOutcome[] {
  if (event.type !== "claim.transmit" || !event.targetIds.includes("character-player")) {
    return [];
  }
  const sourceCharacterId = readRequiredPayloadString(event, "sourceCharacterId");
  const targetCharacterId = readRequiredPayloadString(event, "targetCharacterId");
  if (sourceCharacterId === "character-player" || !event.actorIds.includes(sourceCharacterId) || targetCharacterId !== "character-player") {
    throw new Error(`NPC transmit event ${event.id} does not match authoritative actor/target ids`);
  }
  return [{
    eventId: event.id,
    type: event.type,
    sourceCharacterId,
    claimId: readRequiredPayloadString(event, "claimId"),
  }];
}

function isSoleActor(event: CommittedEvent, actorId: string): boolean {
  return event.actorIds.length === 1 && event.actorIds[0] === actorId;
}

function readRequiredPayloadString(event: CommittedEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Authoritative event ${event.id} has no safe ${key} value`);
  }
  return value;
}

async function main(): Promise<void> {
  const store = new SqliteWorldStore();
  const apiKey = requiredEnvironment("DWE_LLM_API_KEY");
  const baseUrl = requiredEnvironment("DWE_LLM_BASE_URL");
  const simulationModelName = requiredEnvironment("DWE_LLM_MODEL");
  const narratorModelName = process.env.DWE_LLM_NARRATOR_MODEL?.trim() || simulationModelName;

  try {
    const result: ClosedInnRunResult = await runClosedInnTurns({
      store,
      simulationModel: new OpenAICompatibleSimulationModelClient({
        baseUrl,
        apiKey,
        model: simulationModelName,
      }),
      narratorModel: new OpenAICompatibleNarrativeModelClient({
        baseUrl,
        apiKey,
        model: narratorModelName,
      }),
      steps: [...CLOSED_INN_DIRECTED_PLAYER_STEPS],
    });
    const safeResult = projectSafeExperimentRun(
      result,
      store.listEvents(result.fixture.world.id),
    );
    console.log(JSON.stringify(safeResult, null, 2));
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
  main().catch(() => {
    console.error(JSON.stringify({ status: "error", message: "Closed Inn directed-player experiment failed" }));
    process.exitCode = 1;
  });
}
