import { existsSync, unlinkSync } from "node:fs";
import { createNpcVoice, stubNpcVoice } from "../chat/npc.js";
import type { AppConfig } from "../config.js";
import { createModelClient } from "../model/client.js";
import { createNarrator, stubNarrator } from "../narrator/client.js";
import { createModelInterpreter, fixedInterpreter } from "../scene/interpreter.js";
import { ephemeralInterpretation } from "../scene/interpretation.js";
import { openWorld, Session, UNPARSED_HINT } from "../session.js";
import { loadWorldFile } from "../world/load.js";
import { worldCatalog } from "./catalog.js";
import { chatHistory, playerState, type ChatMessage, type PlayerState, type WorldOption } from "./view.js";

export interface TurnResult {
  text: string;
  parsed: boolean;
  state: PlayerState;
}

interface CachedTurn {
  chunks: string[];
  result: TurnResult;
}

export class PlayHost {
  private session: Session | null = null;
  private currentId: string | null = null;
  private readonly done = new Map<string, CachedTurn>();
  private inflight = new Set<string>();

  public constructor(
    private readonly config: AppConfig,
    private readonly stub: boolean = false,
  ) {}

  public worlds(): WorldOption[] {
    return worldCatalog(this.config);
  }

  public currentWorldId(): string | null {
    return this.currentId;
  }

  public bootstrap(): {
    worlds: Array<{ id: string; title: string }>;
    currentWorldId: string | null;
    state: PlayerState | null;
    messages: ChatMessage[];
    roleSwitch: "blocked";
    roleSwitchReason: string;
  } {
    if (!this.session) {
      const first = this.worlds()[0];
      if (first) {
        this.open(first.id, existsSync(first.savePath) ? "resume" : "new");
      }
    }
    return {
      worlds: this.worlds().map((row) => ({ id: row.id, title: row.title })),
      currentWorldId: this.currentId,
      state: this.session ? playerState(this.session) : null,
      messages: this.session ? chatHistory(this.session) : [],
      roleSwitch: "blocked",
      roleSwitchReason: "当前世界只有一个玩家身份，不能安全改成别的观察者。",
    };
  }

  public open(worldId: string, mode: "resume" | "new"): PlayerState {
    const option = this.worlds().find((row) => row.id === worldId);
    if (!option) {
      throw new Error("WORLD_NOT_AVAILABLE");
    }
    this.session?.close();
    this.session = null;
    this.currentId = null;
    this.done.clear();
    this.inflight.clear();
    if (mode === "new" && existsSync(option.savePath)) {
      unlinkSync(option.savePath);
    }
    const compiled = loadWorldFile(option.sourcePath);
    if (this.stub) {
      this.session = openWorld(
        option.savePath,
        stubNarrator(),
        compiled,
        fixedInterpreter(ephemeralInterpretation()),
        stubNpcVoice(),
      );
    } else {
      const model = createModelClient(this.config);
      this.session = openWorld(
        option.savePath,
        createNarrator(model, this.config.apiKey),
        compiled,
        createModelInterpreter(model, this.config.apiKey),
        createNpcVoice(model, this.config.apiKey),
      );
    }
    this.currentId = option.id;
    return playerState(this.session);
  }

  public state(): PlayerState {
    if (!this.session) {
      throw new Error("NO_SESSION");
    }
    return playerState(this.session);
  }

  public messages(): ChatMessage[] {
    if (!this.session) {
      throw new Error("NO_SESSION");
    }
    return chatHistory(this.session);
  }

  public async playTurn(
    text: string,
    turnId: string,
    onChunk: (chunk: string) => void,
  ): Promise<TurnResult> {
    const cached = this.done.get(turnId);
    if (cached) {
      for (const chunk of cached.chunks) {
        onChunk(chunk);
      }
      return cached.result;
    }
    if (this.inflight.has(turnId)) {
      throw new Error("TURN_IN_FLIGHT");
    }
    if (!this.session) {
      throw new Error("NO_SESSION");
    }
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("EMPTY_TURN");
    }
    this.inflight.add(turnId);
    const chunks: string[] = [];
    const session = this.session;
    const worldId = session.compiled.seed.world.id;
    try {
      session.store.insertUiMessage({ worldId, role: "player", text: trimmed, parsed: true });
      const turn = await session.playTurn(trimmed, (chunk) => {
        chunks.push(chunk);
        onChunk(chunk);
      });
      if (chunks.length === 0) {
        chunks.push(turn.text);
        onChunk(turn.text);
      }
      const parsed = turn.parsed;
      session.store.insertUiMessage({
        worldId,
        role: parsed ? "world" : "notice",
        text: turn.text,
        parsed,
      });
      const result: TurnResult = { text: turn.text, parsed, state: playerState(session) };
      this.done.set(turnId, { chunks, result });
      while (this.done.size > 32) {
        const first = this.done.keys().next().value;
        if (first) {
          this.done.delete(first);
        } else {
          break;
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "turn failed";
      process.stderr.write(`${message}\n`);
      const textOut = chunks.length > 0 ? chunks.join("") : UNPARSED_HINT;
      session.store.insertUiMessage({ worldId, role: "notice", text: textOut, parsed: false });
      const result: TurnResult = {
        text: textOut,
        parsed: false,
        state: playerState(session),
      };
      this.done.set(turnId, { chunks: chunks.length > 0 ? chunks : [textOut], result });
      return result;
    } finally {
      this.inflight.delete(turnId);
    }
  }

  public close(): void {
    this.session?.close();
    this.session = null;
    this.currentId = null;
  }
}
