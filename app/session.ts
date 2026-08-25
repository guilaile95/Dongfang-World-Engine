import type { NpcVoice } from "./chat/npc.js";
import { stubNpcVoice } from "./chat/npc.js";
import { lastAddresseeId, recentSceneBodies, recordResolvedScene } from "./context/recent.js";
import { recall } from "./context/recall.js";
import type { Narrator } from "./narrator/client.js";
import { stubNarrator } from "./narrator/client.js";
import { committedProjection, type NarratorEnvelope } from "./narrator/envelope.js";
import { WorldStore } from "./persist/store.js";
import { continueAddressee } from "./scene/address.js";
import {
  applyInterpretation,
  ephemeralInterpretation,
  type BoundInterpretation,
  type SceneInterpretation,
} from "./scene/interpretation.js";
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

export const UNPARSED_HINT = "这一句没有被可靠理解，请换一种说法。";

export interface TurnView {
  text: string;
  observer: ObserverContext;
  prompt: string;
  rawInterpretation: SceneInterpretation;
  interpretation: BoundInterpretation;
  dialogue: DialogueTurn | null;
  envelope: NarratorEnvelope;
  parsed: boolean;
}

export class Session {
  private ambient: string[] = [];
  private readonly interpreter: SceneInterpreter;
  private readonly npcVoice: NpcVoice;

  public constructor(
    public readonly store: WorldStore,
    private readonly narrator: Narrator,
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
    const recentForPlayer = recentSceneBodies(this.store, worldId, this.compiled.playerId);
    const pack = assemblePrompt({
      snapshot: this.store.snapshot(worldId),
      observerId: this.compiled.playerId,
      query: trimmed,
      ambient: this.ambient,
      recentScenes: recentForPlayer,
    });
    const interpreted = trimmed.length > 0
      ? await this.interpreter.interpret({
        playerLine: trimmed,
        observerPack: pack.prompt,
        worldId,
        playerId: this.compiled.playerId,
      })
      : { interpretation: ephemeralInterpretation(), parsed: true };
    const raw = interpreted.interpretation;
    if (trimmed.length > 0 && !interpreted.parsed) {
      const empty = applyInterpretation(this.store, {
        worldId,
        playerId: this.compiled.playerId,
        parsed: false,
        interpretation: raw,
      });
      const observer = pack.observer;
      return {
        text: UNPARSED_HINT,
        observer,
        prompt: pack.prompt,
        rawInterpretation: raw,
        interpretation: empty,
        dialogue: null,
        envelope: {
          playerContribution: trimmed,
          observerContext: pack.prompt,
          committed: [],
          npcReply: null,
          ephemeral: { recentScenes: recentForPlayer, ambient: this.ambient },
        },
        parsed: false,
      };
    }
    if (trimmed.length > 0) {
      const tick = worldTick(this.store, this.compiled);
      this.ambient = tick.publicBeat ? [tick.publicBeat] : [];
    }
    const snapshotForAddress = this.store.snapshot(worldId);
    const addressee = trimmed.length > 0
      ? continueAddressee(
        snapshotForAddress,
        this.compiled.playerId,
        trimmed,
        lastAddresseeId(this.store, worldId, this.compiled.playerId),
      )
      : null;
    const interpretation = applyInterpretation(this.store, {
      worldId,
      playerId: this.compiled.playerId,
      addresseeId: addressee?.id ?? null,
      parsed: interpreted.parsed,
      interpretation: raw,
    });
    const loreHits = recall(this.store, worldId, this.compiled.playerId, trimmed, { kinds: ["lore"] }).map((hit) => ({
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
    let dialogue: DialogueTurn | null = null;
    if (addressee) {
      const npcLore = recall(this.store, worldId, addressee.id, trimmed, { kinds: ["lore"] }).map((hit) => ({
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
    const envelope: NarratorEnvelope = {
      playerContribution: trimmed,
      observerContext: assembled.prompt,
      committed: committedProjection(interpretation, this.compiled.playerId, snapshot),
      npcReply: dialogue ? { name: dialogue.addresseeName, line: dialogue.npcReply } : null,
      ephemeral: {
        recentScenes: recentForPlayer,
        ambient: this.ambient,
      },
    };
    const text = await this.narrator.project(envelope, onChunk);
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
    return {
      text,
      observer: assembled.observer,
      prompt: assembled.prompt,
      rawInterpretation: raw,
      interpretation,
      dialogue,
      envelope,
      parsed: interpreted.parsed,
    };
  }

  public close(): void {
    this.store.close();
  }
}

export function openWorld(
  path: string,
  narrator: Narrator,
  compiled: CompiledWorld = SYNTHETIC,
  interpreter?: SceneInterpreter,
  npcVoice?: NpcVoice,
): Session {
  const store = new WorldStore(path);
  seedCompiled(store, compiled);
  return new Session(store, narrator, compiled, interpreter, npcVoice);
}
