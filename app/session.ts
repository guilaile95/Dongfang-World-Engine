import { submitEmptyProposal } from "./authority/commit.js";
import type { SceneClient } from "./chat/scene.js";
import { WorldStore } from "./persist/store.js";
import { assemblePrompt } from "./visibility/assemble.js";
import type { ObserverContext } from "./visibility/context.js";
import { CHAR_PLAYER, seedWorld, WORLD_ID } from "./world/seed.js";
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
  ) {}

  public contextFor(observerId: string = CHAR_PLAYER): ObserverContext {
    return assemblePrompt({
      snapshot: this.store.snapshot(WORLD_ID),
      observerId,
      ambient: this.ambient,
    }).observer;
  }

  public async playTurn(
    playerLine: string,
    onChunk?: (text: string) => void,
  ): Promise<TurnView> {
    const trimmed = playerLine.trim();
    if (trimmed.length > 0) {
      const tick = worldTick(this.store);
      this.ambient = tick.publicBeat ? [tick.publicBeat] : [];
    }
    submitEmptyProposal(this.store, WORLD_ID);
    const assembled = assemblePrompt({
      snapshot: this.store.snapshot(WORLD_ID),
      observerId: CHAR_PLAYER,
      query: trimmed,
      ambient: this.ambient,
    });
    const text = await this.scene.writeScene(
      { prompt: assembled.prompt, playerLine: trimmed },
      onChunk,
    );
    return { text, observer: assembled.observer, prompt: assembled.prompt };
  }

  public close(): void {
    this.store.close();
  }
}

export function openWorld(path: string, scene: SceneClient): Session {
  const store = new WorldStore(path);
  seedWorld(store);
  return new Session(store, scene);
}
