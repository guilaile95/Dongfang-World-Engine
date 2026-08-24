import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CommitKernel } from "./commit-kernel.js";
import { ContextBuilder } from "./context-builder.js";
import { KernelError } from "./errors.js";
import {
  generateSceneReply,
  type ModelFacingContext,
  type SceneChatConfig,
} from "./scene-chat.js";
import { SqliteWorldStore } from "../persistence/sqlite-store.js";
import {
  CLOSED_INN_WORLD_ID,
  parseClosedInnWorldRules,
  seedClosedInnWorld,
} from "../testkit/world-builder.js";
import {
  currentPlotStage,
  publicPlotThreads,
  tickClosedInnWorld,
  type WorldTickResult,
} from "./world-tick.js";

const PLAYER_ID = "character-player";

export interface PlaySessionConfig extends SceneChatConfig {
  worldFile: string;
}

export interface PlayTurnResult {
  sceneReply: string;
  playerLine: string;
  unknownActionRejection: false;
  plotContinuation: WorldTickResult;
  worldRevision: number;
  modelFacingContext: ModelFacingContext;
}

export class PlaySession {
  public readonly resumed: boolean;

  private constructor(
    public readonly worldFile: string,
    private readonly store: SqliteWorldStore,
    private readonly kernel: CommitKernel,
    private readonly contextBuilder: ContextBuilder,
    private readonly chat: SceneChatConfig,
    resumed: boolean,
  ) {
    this.resumed = resumed;
  }

  public static open(config: PlaySessionConfig): PlaySession {
    mkdirSync(dirname(config.worldFile), { recursive: true });
    const store = new SqliteWorldStore(config.worldFile);
    let resumed = true;
    try {
      try {
        store.getSnapshot(CLOSED_INN_WORLD_ID);
      } catch (error) {
        if (!(error instanceof KernelError) || error.code !== "WORLD_NOT_FOUND") {
          throw error;
        }
        seedClosedInnWorld(store);
        resumed = false;
      }
      assertPlayableWorld(store);
      const chat: SceneChatConfig = {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      };
      return new PlaySession(
        config.worldFile,
        store,
        new CommitKernel(store),
        new ContextBuilder(store),
        chat,
        resumed,
      );
    } catch (error) {
      store.close();
      throw error;
    }
  }

  public getStore(): SqliteWorldStore {
    return this.store;
  }

  public buildModelFacingContext(): ModelFacingContext {
    const snapshot = this.store.getSnapshot(CLOSED_INN_WORLD_ID);
    return {
      rules: parseClosedInnWorldRules(snapshot.seed.metadata),
      plotStage: currentPlotStage(snapshot),
      plotThreads: publicPlotThreads(snapshot),
      observer: this.contextBuilder.buildCharacterContext({
        worldId: CLOSED_INN_WORLD_ID,
        observerCharacterId: PLAYER_ID,
      }),
    };
  }

  public async playTurn(playerLine: string): Promise<PlayTurnResult> {
    const intent = playerLine.trim();
    if (intent.length === 0) {
      throw new Error("Player line must not be blank");
    }
    const skipWorldTick = intent.toLowerCase().startsWith("/ooc");
    const plotContinuation = skipWorldTick
      ? {
        stage: currentPlotStage(this.store.getSnapshot(CLOSED_INN_WORLD_ID)) ?? "0",
        claimId: null,
        events: [],
        independentOfPlayerLine: true as const,
      }
      : tickClosedInnWorld(this.store, this.kernel);
    const modelFacingContext = this.buildModelFacingContext();
    const sceneReply = await generateSceneReply(this.chat, modelFacingContext, intent);
    return {
      sceneReply,
      playerLine: intent,
      unknownActionRejection: false,
      plotContinuation,
      worldRevision: this.store.getSnapshot(CLOSED_INN_WORLD_ID).world.revision,
      modelFacingContext,
    };
  }

  public close(): void {
    this.store.close();
  }
}

function assertPlayableWorld(store: SqliteWorldStore): void {
  const snapshot = store.getSnapshot(CLOSED_INN_WORLD_ID);
  const characterIds = new Set(snapshot.characters.map((character) => character.id));
  for (const characterId of [PLAYER_ID, "character-npc-a", "character-npc-b", "character-npc-c"]) {
    if (!characterIds.has(characterId)) {
      throw new Error(`Playable world is missing Character ${characterId}`);
    }
  }
  if (currentPlotStage(snapshot) === null) {
    throw new Error("Playable world is missing the authored plot_stage Fact");
  }
  if (parseClosedInnWorldRules(snapshot.seed.metadata).length === 0) {
    throw new Error("Playable world is missing authored rules");
  }
}
