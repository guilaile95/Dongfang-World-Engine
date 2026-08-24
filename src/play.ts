import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { CommittedEvent } from "./domain/types.js";
import { CommitKernel, type CommitResult } from "./engine/commit-kernel.js";
import { ContextBuilder, type ContextClaimGroundings } from "./engine/context-builder.js";
import { KernelError } from "./engine/errors.js";
import {
  NarrativeError,
  Narrator,
  OpenAICompatibleNarrativeModelClient,
} from "./engine/narrative.js";
import { OpenAICompatibleSimulationModelClient } from "./engine/openai-compatible-simulation-client.js";
import { SceneInterpreter } from "./engine/scene-interpreter.js";
import { SceneResolver, toNarrativeEnvelope } from "./engine/scene-resolver.js";
import { SimulationAdapter, type SimulationModelClient } from "./engine/simulation-adapter.js";
import { TurnOrchestrator } from "./engine/turn-orchestrator.js";
import { SqliteWorldStore } from "./persistence/sqlite-store.js";
import { CLOSED_INN_WORLD_ID, seedClosedInnWorld } from "./testkit/world-builder.js";

export const PLAYABLE_DELAYED_CLAIM_ID = "claim-player-observed-delayed-reconciliation";
export const PLAYABLE_DELAYED_DISPLAY_TEXT =
  "在你把匕首位于地窖的线索告诉赵先生后，他对阿宝的敌意明显缓和了。";

const DEFAULT_WORLD_FILE = "data/local/closed-inn.sqlite";
// ponytail: one authored world with stable IDs; add a world-pack loader only when authoring blocks play.
const ids = {
  worldId: CLOSED_INN_WORLD_ID,
  playerId: "character-player",
  npcAId: "character-npc-a",
  npcBId: "character-npc-b",
  npcCId: "character-npc-c",
  trueCellarClaimId: "claim-dagger-in-cellar",
  falseTheftClaimId: "claim-dagger-stolen-by-npcb",
  falseGuestRoomClaimId: "claim-dagger-in-guestroom",
} as const;

interface PlayConfig {
  worldFile: string;
  baseUrl: string;
  apiKey: string;
  simulationModel: string;
  narratorModel: string;
}

interface OpenWorldResult {
  store: SqliteWorldStore;
  resumed: boolean;
}

export async function runPlayableLocalLoop(config: PlayConfig): Promise<void> {
  const opened = openOrSeedWorld(config.worldFile);
  const { store } = opened;
  let cli: ReturnType<typeof createInterface> | null = null;
  try {
    const contextBuilder = new ContextBuilder(store, closedInnClaimGroundings());
    const commitKernel = new CommitKernel(store);
    const continuationOrchestrator = new TurnOrchestrator({
      stateReader: store,
      contextBuilder,
      simulationAdapter: new SimulationAdapter(createClosedInnContinuationModel(store), {
        modelId: "closed-inn-local-continuation",
      }),
      commitKernel,
    });
    const sceneResolver = new SceneResolver(
      contextBuilder,
      new SceneInterpreter(
        new OpenAICompatibleSimulationModelClient({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.simulationModel,
        }),
        { modelId: config.simulationModel },
      ),
      commitKernel,
      store,
      {
        chooseActor: (worldId) => chooseContinuationActor(store, worldId),
        run: async ({ worldId, actorCharacterId }) => {
          if (actorCharacterId === ids.npcBId) {
            commitAuthoredNpcReaction(store, contextBuilder, commitKernel);
          }
          return continuationOrchestrator.runActorTurn({
            worldId,
            actorCharacterId,
            intent: "根据当前合法可见信息采取至多一个本地行动。不要推进世界时间。",
          });
        },
      },
    );
    const narrator = new Narrator(new OpenAICompatibleNarrativeModelClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.narratorModel,
    }));
    cli = createInterface({ input: process.stdin, output: process.stdout });
    printWorldStatus(store, opened.resumed ? "已恢复世界" : "已创建世界", config.worldFile);
    console.log("直接输入自然语言行动；输入 :quit 退出。\n");

    process.stdout.write("> ");
    for await (const line of cli) {
      const intent = line.trim();
      if (intent === ":quit") {
        break;
      }
      if (!intent) {
        process.stdout.write("> ");
        continue;
      }

      const resolved = await sceneResolver.resolve({
        worldId: ids.worldId,
        actorCharacterId: ids.playerId,
        contribution: intent,
      });
      if (resolved.channel !== "ooc_meta") {
        ensureDelayedConsequence(store, commitKernel);
      }

      const envelope = toNarrativeEnvelope(resolved);
      try {
        const narrative = await narrator.generate(envelope);
        const safeNarrative = sanitizeTerminalText(narrative);
        console.log(
          safeNarrative.includes(config.apiKey) || !safeNarrative.trim()
            ? "[叙事输出因包含凭据或不安全控制字符而被隐藏]"
            : safeNarrative,
        );
      } catch (error) {
        const code = error instanceof NarrativeError ? error.code : "NARRATIVE_TRANSPORT_ERROR";
        console.log(`[叙事暂不可用：${code}]`);
      }
      if (resolved.rejection) {
        console.log(`[玩家回合 ${resolved.turnStatus}：${resolved.rejection.code}]`);
      }
      printWorldStatus(store, "世界继续", config.worldFile, false);
      process.stdout.write("\n> ");
    }
  } finally {
    cli?.close();
    store.close();
  }
}

function openOrSeedWorld(worldFile: string): OpenWorldResult {
  mkdirSync(dirname(worldFile), { recursive: true });
  const store = new SqliteWorldStore(worldFile);
  let resumed = true;
  try {
    try {
      store.getSnapshot(ids.worldId);
    } catch (error) {
      if (!(error instanceof KernelError) || error.code !== "WORLD_NOT_FOUND") {
        throw error;
      }
      seedClosedInnWorld(store);
      resumed = false;
    }
    assertPlayableWorld(store);
    return { store, resumed };
  } catch (error) {
    store.close();
    throw error;
  }
}

function assertPlayableWorld(store: SqliteWorldStore): void {
  const snapshot = store.getSnapshot(ids.worldId);
  const characterIds = new Set(snapshot.characters.map((character) => character.id));
  const claimIds = new Set(snapshot.claims.map((claim) => claim.id));
  for (const characterId of [ids.playerId, ids.npcAId, ids.npcBId, ids.npcCId]) {
    if (!characterIds.has(characterId)) {
      throw new Error(`Playable world is missing Character ${characterId}`);
    }
  }
  for (const claimId of [ids.trueCellarClaimId, ids.falseTheftClaimId, ids.falseGuestRoomClaimId]) {
    if (!claimIds.has(claimId)) {
      throw new Error(`Playable world is missing Claim ${claimId}`);
    }
  }
}

function closedInnClaimGroundings(): ContextClaimGroundings {
  return {
    [ids.playerId]: {
      [ids.trueCellarClaimId]: "失踪的匕首在客栈地窖。",
      [ids.falseTheftClaimId]: "传闻称账房赵先生偷走了匕首。",
      [ids.falseGuestRoomClaimId]: "传闻称失踪的匕首在二楼客房。",
      [PLAYABLE_DELAYED_CLAIM_ID]: PLAYABLE_DELAYED_DISPLAY_TEXT,
    },
  };
}

function createClosedInnContinuationModel(store: SqliteWorldStore): SimulationModelClient {
  return {
    async generate(request) {
      const context = request.context;
      const proposals: Array<Record<string, unknown>> = [];

      if (context.observer.id === ids.npcAId) {
        const npcAKnows = context.knowledge.some((bundle) => bundle.claim.id === ids.trueCellarClaimId);
        const playerIsPresent = context.coLocatedCharacters.some((character) => character.id === ids.playerId);
        const alreadyTransmitted = store.listEvents(ids.worldId).some(
          (event) => event.type === "claim.transmit" &&
            event.payload.sourceCharacterId === ids.npcAId &&
            event.payload.targetCharacterId === ids.playerId &&
            event.payload.claimId === ids.trueCellarClaimId,
        );
        if (npcAKnows && playerIsPresent && !alreadyTransmitted) {
          proposals.push({
            type: "claim.transmit",
            sourceCharacterId: ids.npcAId,
            targetCharacterId: ids.playerId,
            claimId: ids.trueCellarClaimId,
          });
        }
      }

      return { proposals };
    },
  };
}

function chooseContinuationActor(store: SqliteWorldStore, worldId: string): string {
  const timeAdvances = store.listEvents(worldId).filter((event) => event.type === "world.time_advance").length;
  const tickCount = Math.max(0, timeAdvances - 1);
  return [ids.npcAId, ids.npcBId, ids.npcCId][tickCount % 3]!;
}

function commitAuthoredNpcReaction(
  store: SqliteWorldStore,
  contextBuilder: ContextBuilder,
  kernel: CommitKernel,
): void {
  const context = contextBuilder.buildCharacterContext({
    worldId: ids.worldId,
    observerCharacterId: ids.npcBId,
  });
  const learnedFromPlayer = context.knowledge.find(
    (bundle) => bundle.claim.id === ids.trueCellarClaimId &&
      bundle.knowledge.sourceCharacterId === ids.playerId &&
      bundle.knowledge.sourceEventId !== null &&
      Date.parse(context.world.currentTime) - Date.parse(bundle.knowledge.learnedAt) >= 20 * 60_000,
  );
  const relationship = context.relationships.find(
    (candidate) => candidate.targetCharacterId === ids.npcAId &&
      candidate.trust === -20 && candidate.hostility === 20,
  );
  if (!learnedFromPlayer?.knowledge.sourceEventId || !relationship) {
    return;
  }
  const sourceEvent = store.getEvent(learnedFromPlayer.knowledge.sourceEventId);
  if (!isExpectedTrigger(sourceEvent)) {
    throw new Error("NPC reaction Knowledge has invalid source Event provenance");
  }
  // Scenario-local trusted producer binds the exact visible Knowledge source; Kernel still decides the write.
  requireCommitted(kernel.commit({
    type: "relationship.change",
    worldId: ids.worldId,
    expectedWorldRevision: context.world.revision,
    sourceCharacterId: ids.npcBId,
    targetCharacterId: ids.npcAId,
    trustDelta: 15,
    hostilityDelta: -10,
    relationshipType: "reconsidering",
    occurredAt: context.world.currentTime,
    causeEventIds: [sourceEvent.id],
  }), "commit authored NPC reaction");
}

function ensureDelayedConsequence(store: SqliteWorldStore, kernel: CommitKernel): void {
  let snapshot = store.getSnapshot(ids.worldId);
  const npcKnowledge = snapshot.knowledge.find(
    (knowledge) => knowledge.characterId === ids.npcBId &&
      knowledge.claimId === ids.trueCellarClaimId &&
      knowledge.sourceCharacterId === ids.playerId &&
      knowledge.sourceEventId !== null,
  );
  const relationship = snapshot.relationships.find(
    (candidate) => candidate.sourceCharacterId === ids.npcBId && candidate.targetCharacterId === ids.npcAId,
  );
  const triggerEvent = npcKnowledge?.sourceEventId ? store.getEvent(npcKnowledge.sourceEventId) : null;
  const reactionEvent = relationship?.updatedByEventId ? store.getEvent(relationship.updatedByEventId) : null;
  if (!isExpectedTrigger(triggerEvent) || !isExpectedReaction(reactionEvent)) {
    return;
  }
  if (reactionEvent.causeEventIds.length !== 1 || reactionEvent.causeEventIds[0] !== triggerEvent.id) {
    throw new Error("Playable NPC reaction has invalid causal provenance");
  }
  if (Date.parse(reactionEvent.eventTime) - Date.parse(triggerEvent.eventTime) < 20 * 60_000) {
    return;
  }
  const locations = [ids.playerId, ids.npcAId, ids.npcBId].map(
    (characterId) => snapshot.characters.find((character) => character.id === characterId)?.locationId ?? null,
  );
  if (locations[0] === null || !locations.every((locationId) => locationId === locations[0])) {
    return;
  }

  let consequenceClaim = snapshot.claims.find((claim) => claim.id === PLAYABLE_DELAYED_CLAIM_ID);
  if (!consequenceClaim) {
    requireCommitted(kernel.commit({
      type: "claim.record",
      worldId: ids.worldId,
      expectedWorldRevision: snapshot.world.revision,
      claimId: PLAYABLE_DELAYED_CLAIM_ID,
      actorId: ids.playerId,
      subject: ids.npcBId,
      predicate: "attitude_changed_toward",
      object: ids.npcAId,
      occurredAt: snapshot.world.currentTime,
      causeEventIds: [triggerEvent.id, reactionEvent.id],
    }), "record delayed consequence Claim");
    snapshot = store.getSnapshot(ids.worldId);
    consequenceClaim = snapshot.claims.find((claim) => claim.id === PLAYABLE_DELAYED_CLAIM_ID);
  }
  if (
    !consequenceClaim ||
    consequenceClaim.subject !== ids.npcBId ||
    consequenceClaim.predicate !== "attitude_changed_toward" ||
    consequenceClaim.object !== ids.npcAId ||
    consequenceClaim.sourceEventId === null
  ) {
    throw new Error("Playable delayed consequence Claim conflicts with the authored projection");
  }
  const claimEvent = store.getEvent(consequenceClaim.sourceEventId);
  if (
    !claimEvent || claimEvent.type !== "claim.record" || claimEvent.causeEventIds.length !== 2 ||
    claimEvent.causeEventIds[0] !== triggerEvent.id || claimEvent.causeEventIds[1] !== reactionEvent.id
  ) {
    throw new Error("Playable delayed consequence Claim has invalid Event provenance");
  }
  if (!snapshot.knowledge.some(
    (knowledge) => knowledge.characterId === ids.playerId && knowledge.claimId === PLAYABLE_DELAYED_CLAIM_ID,
  )) {
    requireCommitted(kernel.commit({
      type: "character.learn_claim",
      worldId: ids.worldId,
      expectedWorldRevision: snapshot.world.revision,
      actorId: ids.playerId,
      claimId: PLAYABLE_DELAYED_CLAIM_ID,
      knowledgeState: "confirmed",
      source: { kind: "event", eventId: claimEvent.id },
      occurredAt: snapshot.world.currentTime,
      causeEventIds: [claimEvent.id],
    }), "learn delayed consequence Claim");
  }
}

function isExpectedTrigger(event: CommittedEvent | null): event is CommittedEvent {
  return event?.type === "claim.transmit" &&
    event.payload.sourceCharacterId === ids.playerId &&
    event.payload.targetCharacterId === ids.npcBId &&
    event.payload.claimId === ids.trueCellarClaimId;
}

function isExpectedReaction(event: CommittedEvent | null): event is CommittedEvent {
  return event?.type === "relationship.change" &&
    event.payload.sourceCharacterId === ids.npcBId &&
    event.payload.targetCharacterId === ids.npcAId &&
    event.payload.trustDelta === 15 &&
    event.payload.hostilityDelta === -10;
}

function requireCommitted(result: CommitResult, label: string): CommittedEvent {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.code}`);
  }
  return result.event;
}

function printWorldStatus(store: SqliteWorldStore, label: string, worldFile: string, includeFile = true): void {
  const snapshot = store.getSnapshot(ids.worldId);
  const player = snapshot.characters.find((character) => character.id === ids.playerId);
  const location = snapshot.locations.find((candidate) => candidate.id === player?.locationId);
  const file = includeFile ? ` | 文件=${worldFile}` : "";
  console.log(`${label} | world=${ids.worldId} | revision=${snapshot.world.revision} | 时间=${snapshot.world.currentTime} | 位置=${location?.name ?? "未知"}${file}`);
}

function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

function readConfig(environment: NodeJS.ProcessEnv): PlayConfig {
  const simulationModel = requiredEnvironment(environment, "DWE_LLM_MODEL");
  return {
    worldFile: resolve(environment.DWE_WORLD_FILE?.trim() || DEFAULT_WORLD_FILE),
    baseUrl: requiredEnvironment(environment, "DWE_LLM_BASE_URL"),
    apiKey: requiredEnvironment(environment, "DWE_LLM_API_KEY"),
    simulationModel,
    narratorModel: environment.DWE_LLM_NARRATOR_MODEL?.trim() || simulationModel,
  };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  await runPlayableLocalLoop(readConfig(process.env));
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Playable Local Loop failed";
    console.error(message.slice(0, 500));
    process.exitCode = 1;
  });
}
