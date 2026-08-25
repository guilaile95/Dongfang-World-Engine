import type { NpcVoice } from "./chat/npc.js";
import { stubNpcVoice } from "./chat/npc.js";
import { lastAddresseeId, recentSceneBodies, recordOpeningScene, recordResolvedScene } from "./context/recent.js";
import { recall } from "./context/recall.js";
import type { Narrator } from "./narrator/client.js";
import { stubNarrator } from "./narrator/client.js";
import { committedProjection, uncommittedProjection, type NarratorEnvelope } from "./narrator/envelope.js";
import { WorldStore } from "./persist/store.js";
import { continueAddressee, reachableAddressee } from "./scene/address.js";
import {
  applyInterpretation,
  ensureObviousCarry,
  ensureObviousMove,
  ensureSpokenMemory,
  ephemeralInterpretation,
  withObviousMove,
  withSpokenMemory,
  type BoundInterpretation,
  type SceneInterpretation,
} from "./scene/interpretation.js";
import { dampPublicBeat } from "./world/autonomy.js";
import { resolveLocationId } from "./world/resolve.js";
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
  private lastPublicBeat: string | null = null;
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
    const profile = this.store.getPlayerProfile(worldId);
    const recentForPlayer = recentSceneBodies(this.store, worldId, this.compiled.playerId);
    const pack = assemblePrompt({
      snapshot: this.store.snapshot(worldId),
      observerId: this.compiled.playerId,
      query: trimmed,
      ambient: this.ambient,
      recentScenes: recentForPlayer,
      playerProfile: profile,
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
          uncommitted: [],
          npcReply: null,
          ephemeral: { recentScenes: recentForPlayer, ambient: this.ambient },
        },
        parsed: false,
      };
    }
    const eventsBefore = this.store.listEvents(worldId).length;
    if (trimmed.length > 0) {
      worldTick(this.store, this.compiled);
    }
    const snapshotForAddress = this.store.snapshot(worldId);
    const intended = trimmed.length > 0
      ? continueAddressee(
        snapshotForAddress,
        this.compiled.playerId,
        trimmed,
        lastAddresseeId(this.store, worldId, this.compiled.playerId),
      )
      : null;
    const player = snapshotForAddress.characters.find((row) => row.id === this.compiled.playerId);
    let toApply = raw;
    if (intended) {
      toApply = withSpokenMemory(toApply, { addresseeId: intended.id, playerLine: trimmed });
    }
    toApply = withObviousMove(toApply, {
      playerLine: trimmed,
      locationId: resolveLocationId(snapshotForAddress, trimmed),
      currentLocationId: player?.locationId ?? "",
    });
    let interpretation = applyInterpretation(this.store, {
      worldId,
      playerId: this.compiled.playerId,
      addresseeId: intended?.id ?? null,
      parsed: interpreted.parsed,
      interpretation: toApply,
    });
    const wroteMemory = interpretation.result.events.some(
      (event) => event.type === "memory_note" && event.payload["characterId"] === intended?.id,
    );
    const extra = [
      intended && !wroteMemory
        ? ensureSpokenMemory(this.store, {
          worldId,
          addresseeId: intended.id,
          playerLine: trimmed,
        })
        : null,
      ensureObviousMove(this.store, {
        worldId,
        playerId: this.compiled.playerId,
        playerLine: trimmed,
      }),
      ensureObviousCarry(this.store, {
        worldId,
        playerId: this.compiled.playerId,
        playerLine: trimmed,
      }),
    ].flatMap((row) => row?.events ?? []);
    if (extra.length > 0) {
      interpretation = {
        ...interpretation,
        submitted: true,
        futureCausal: true,
        outcome: "candidate",
        result: {
          accepted: true,
          events: [...interpretation.result.events, ...extra],
          snapshot: this.store.snapshot(worldId),
          reasons: [],
        },
      };
    }
    const snapshot = this.store.snapshot(worldId);
    const newEvents = this.store.listEvents(worldId).slice(eventsBefore);
    const themeHere = snapshot.characters.find((row) => row.id === this.compiled.theme.characterId)?.locationId
      === snapshot.characters.find((row) => row.id === this.compiled.playerId)?.locationId;
    const tickBeat = this.compiled.theme.publicBeatScope === "public_world" || themeHere
      ? this.compiled.theme.publicBeat
      : "";
    this.ambient = dampPublicBeat(tickBeat, this.lastPublicBeat, newEvents);
    if (this.ambient[0]) {
      this.lastPublicBeat = this.ambient[0];
    }
    const loreHits = recall(this.store, worldId, this.compiled.playerId, trimmed, { kinds: ["lore"] }).map((hit) => ({
      title: hit.title,
      body: hit.body,
      score: hit.score,
      namespace: hit.namespace,
      kind: hit.kind,
    }));
    const assembled = assemblePrompt({
      snapshot,
      observerId: this.compiled.playerId,
      query: trimmed,
      ambient: this.ambient,
      loreHits,
      recentScenes: recentForPlayer,
      playerProfile: profile,
    });
    const addressee = reachableAddressee(snapshot, this.compiled.playerId, intended);
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
      uncommitted: uncommittedProjection(toApply, interpretation),
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

  public async projectOpening(
    profile: import("./persist/store.js").PlayerProfile,
    onChunk?: (text: string) => void,
  ): Promise<import("./narrator/project.js").ParsedOpening> {
    const worldId = this.compiled.seed.world.id;
    const snapshot = this.store.snapshot(worldId);
    const player = snapshot.characters.find((c) => c.id === this.compiled.playerId);
    const location = snapshot.locations.find((l) => l.id === player?.locationId);
    const present = snapshot.characters
      .filter((c) => c.id !== this.compiled.playerId && c.locationId === player?.locationId)
      .map((c) => c.name);

    const query = [location?.name, profile.startingLocation, profile.background].filter(Boolean).join(" ");
    const loreHits = recall(this.store, worldId, this.compiled.playerId, query, { kinds: ["lore"], limit: 4 });

    const input: import("./narrator/project.js").OpeningPromptInput = {
      worldTitle: this.compiled.packageTitle,
      era: this.compiled.chronology?.era || "当代",
      timeLabel: this.compiled.chronology?.timeLabel || snapshot.world.time,
      publicPremise: this.compiled.chronology?.publicPremise || "平静的世界在日常运转。",
      locationName: location?.name || profile.startingLocation || "普通城市",
      presentCharacters: present,
      publicRules: snapshot.world.rules,
      publicLore: loreHits.map((hit) => hit.body),
      publicBeat: this.compiled.theme.publicBeat,
      profile,
    };

    let parsed: import("./narrator/project.js").ParsedOpening;
    if (this.narrator.projectOpening) {
      parsed = await this.narrator.projectOpening(input, onChunk);
    } else {
      const narrative = await this.narrator.project(
        {
          playerContribution: "",
          observerContext: `【世界】${input.worldTitle}【地点】${input.locationName}`,
          committed: [],
          uncommitted: [],
          npcReply: null,
          ephemeral: { recentScenes: [], ambient: this.ambient },
        },
        onChunk,
      );
      const m = await import("./narrator/project.js");
      parsed = m.parseOpeningOutput(narrative, input.locationName);
    }

    // 1. Commit bootstrap hook item to Authority items table if present
    if (parsed.hookItem && player?.locationId) {
      const existingItems = snapshot.items;
      const alreadyPresent = existingItems.some(
        (it) => it.name === parsed.hookItem && (it.locationId === player.locationId || it.carrierId === player.id),
      );
      if (!alreadyPresent) {
        this.store.insertItem({
          id: `item-hook-${Date.now()}`,
          worldId,
          name: parsed.hookItem,
          locationId: player.locationId,
          carrierId: null,
        });
      }
    }

    // 2. Record opening scene into player namespace continuity (recent scenes)
    recordOpeningScene(this.store, worldId, this.compiled.playerId, parsed.narrative);

    return parsed;
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
