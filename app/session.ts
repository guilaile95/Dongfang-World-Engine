import { submitEmptyProposal } from "./authority/commit.js";
import type { SceneClient } from "./chat/scene.js";
import { WorldStore } from "./persist/store.js";
import { recordScene } from "./context/artifacts.js";
import { recall } from "./context/recall.js";
import { assemblePrompt } from "./visibility/assemble.js";
import type { ObserverContext } from "./visibility/context.js";
import type { CompiledWorld } from "./world/compile.js";
import { seedCompiled } from "./world/load.js";
import { SYNTHETIC } from "./world/seed.js";
import { worldTick } from "./world/tick.js";

export interface TurnView {
  text: string;
  observer: ObserverContext;
  prompt: string;
}

export class Session {
  private ambient: string[] = [];

  public constructor(
    public readonly store: WorldStore,
    private readonly scene: SceneClient,
    public readonly compiled: CompiledWorld,
  ) {}

  public contextFor(observerId: string = this.compiled.playerId): ObserverContext {
    return assemblePrompt({
      snapshot: this.store.snapshot(this.compiled.seed.world.id),
      observerId,
      ambient: this.ambient,
    }).observer;
  }

  public async playTurn(
    playerLine: string,
    onChunk?: (text: string) => void,
  ): Promise<TurnView> {
    const trimmed = playerLine.trim();
    const worldId = this.compiled.seed.world.id;
    if (trimmed.length > 0) {
      const tick = worldTick(this.store, this.compiled);
      this.ambient = tick.publicBeat ? [tick.publicBeat] : [];
    }
    submitEmptyProposal(this.store, worldId);
    const loreHits = recall(this.store, worldId, this.compiled.playerId, trimmed).map((hit) => ({
      title: hit.title,
      body: hit.body,
      score: hit.score,
      namespace: hit.namespace,
      kind: hit.kind,
    }));
    const assembled = assemblePrompt({
      snapshot: this.store.snapshot(worldId),
      observerId: this.compiled.playerId,
      query: trimmed,
      ambient: this.ambient,
      loreHits,
    });
    const text = await this.scene.writeScene(
      { prompt: assembled.prompt, playerLine: trimmed },
      onChunk,
    );
    if (trimmed.length > 0) {
      recordScene(this.store, worldId, this.compiled.playerId, text);
    }
    return { text, observer: assembled.observer, prompt: assembled.prompt };
  }

  public close(): void {
    this.store.close();
  }
}

export function openWorld(
  path: string,
  scene: SceneClient,
  compiled: CompiledWorld = SYNTHETIC,
): Session {
  const store = new WorldStore(path);
  seedCompiled(store, compiled);
  return new Session(store, scene, compiled);
}
