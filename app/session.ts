import type { NpcVoice } from "./chat/npc.js";
import { stubNpcVoice } from "./chat/npc.js";
import type { SceneClient } from "./chat/scene.js";
import { lastAddresseeId, recentSceneBodies, recordResolvedScene } from "./context/recent.js";
import { recall } from "./context/recall.js";
import { WorldStore } from "./persist/store.js";
import { continueAddressee } from "./scene/address.js";
import { applyInterpretation, ephemeralInterpretation, type BoundInterpretation } from "./scene/interpretation.js";
import { fixedInterpreter, type SceneInterpreter } from "./scene/interpreter.js";
import { assemblePrompt } from "./visibility/assemble.js";
import type { ObserverContext } from "./visibility/context.js";
import type { CompiledWorld } from "./world/compile.js";
import { seedCompiled } from "./world/load.js";
import { SYNTHETIC } from "./world/seed.js";
import { worldTick } from "./world/tick.js";

export interface DialogueTurn {
  addresseeId: string;
  addresseeName: string;
  stimulus: string;
  npcReply: string;
  npcPrompt: string;
}

export interface TurnView {
  text: string;
  observer: ObserverContext;
  prompt: string;
  interpretation: BoundInterpretation;
  dialogue: DialogueTurn | null;
}

export class Session {
  private ambient: string[] = [];
  private readonly interpreter: SceneInterpreter;
  private readonly npcVoice: NpcVoice;

  public constructor(
    public readonly store: WorldStore,
    private readonly scene: SceneClient,
    public readonly compiled: CompiledWorld,
    interpreter: SceneInterpreter = fixedInterpreter(ephemeralInterpretation()),
    npcVoice: NpcVoice = stubNpcVoice(),
  ) {
    this.interpreter = interpreter;
    this.npcVoice = npcVoice;
  }

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
    const recentForPlayer = recentSceneBodies(this.store, worldId, this.compiled.playerId);
    const pack = assemblePrompt({
      snapshot: this.store.snapshot(worldId),
      observerId: this.compiled.playerId,
      query: trimmed,
      ambient: this.ambient,
      recentScenes: recentForPlayer,
    });
    const raw = trimmed.length > 0
      ? await this.interpreter.interpret({
        playerLine: trimmed,
        observerPack: pack.prompt,
        worldId,
        playerId: this.compiled.playerId,
      })
      : ephemeralInterpretation();
    const interpretation = applyInterpretation(this.store, {
      worldId,
      playerId: this.compiled.playerId,
      interpretation: raw,
    });
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
      recentScenes: recentForPlayer,
    });
    const snapshot = this.store.snapshot(worldId);
    const addressee = trimmed.length > 0
      ? continueAddressee(
        snapshot,
        this.compiled.playerId,
        trimmed,
        lastAddresseeId(this.store, worldId, this.compiled.playerId),
      )
      : null;
    let dialogue: DialogueTurn | null = null;
    if (addressee) {
      const npcLore = recall(this.store, worldId, addressee.id, trimmed).map((hit) => ({
        title: hit.title,
        body: hit.body,
        score: hit.score,
        namespace: hit.namespace,
        kind: hit.kind,
      }));
      const npcPack = assemblePrompt({
        snapshot,
        observerId: addressee.id,
        query: trimmed,
        loreHits: npcLore,
        recentScenes: recentSceneBodies(this.store, worldId, addressee.id),
      });
      const npcReply = await this.npcVoice.reply({
        name: addressee.name,
        pack: npcPack.prompt,
        stimulus: trimmed,
      });
      dialogue = {
        addresseeId: addressee.id,
        addresseeName: addressee.name,
        stimulus: trimmed,
        npcReply,
        npcPrompt: npcPack.prompt,
      };
    }
    const text = await this.scene.writeScene(
      {
        prompt: assembled.prompt,
        playerLine: trimmed,
        ...(dialogue ? { heardNpc: { name: dialogue.addresseeName, line: dialogue.npcReply } } : {}),
      },
      onChunk,
    );
    if (trimmed.length > 0) {
      const resolved = {
        playerLine: trimmed,
        addresseeId: dialogue?.addresseeId ?? null,
        addresseeName: dialogue?.addresseeName ?? null,
        npcReply: dialogue?.npcReply ?? null,
      };
      recordResolvedScene(this.store, worldId, this.compiled.playerId, resolved, "player");
      if (dialogue) {
        recordResolvedScene(this.store, worldId, dialogue.addresseeId, resolved, "npc");
      }
    }
    return { text, observer: assembled.observer, prompt: assembled.prompt, interpretation, dialogue };
  }

  public close(): void {
    this.store.close();
  }
}

export function openWorld(
  path: string,
  scene: SceneClient,
  compiled: CompiledWorld = SYNTHETIC,
  interpreter?: SceneInterpreter,
  npcVoice?: NpcVoice,
): Session {
  const store = new WorldStore(path);
  seedCompiled(store, compiled);
  return new Session(store, scene, compiled, interpreter, npcVoice);
}
