import { copyFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
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

export function createSaveBackup(
  savePath: string,
  worldId: string,
  copyFn: (src: string, dest: string) => void = copyFileSync,
): string {
  if (!existsSync(savePath)) {
    return "";
  }
  const dir = dirname(savePath);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

  let candidateName = `play-${worldId}.backup-${timestamp}.sqlite`;
  let backupPath = join(dir, candidateName);
  let counter = 1;
  while (existsSync(backupPath)) {
    candidateName = `play-${worldId}.backup-${timestamp}-${counter}.sqlite`;
    backupPath = join(dir, candidateName);
    counter++;
  }

  try {
    copyFn(savePath, backupPath);
    if (!existsSync(backupPath) || statSync(backupPath).size === 0) {
      throw new Error("BACKUP_FILE_INVALID");
    }
    const verifyDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      const row = verifyDb.prepare("SELECT id FROM worlds WHERE id = ?").get(worldId)
        ?? verifyDb.prepare("SELECT id FROM worlds LIMIT 1").get();
      if (!row) {
        throw new Error("BACKUP_VERIFY_NO_WORLD");
      }
    } finally {
      verifyDb.close();
    }
    return backupPath;
  } catch (error) {
    if (existsSync(backupPath)) {
      try {
        unlinkSync(backupPath);
      } catch {
        // ignore cleanup error
      }
    }
    throw new Error(`BACKUP_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
    private readonly copyFileFn: (src: string, dest: string) => void = copyFileSync,
  ) {}

  public worlds(): WorldOption[] {
    return worldCatalog(this.config);
  }

  public worldsList(): Array<{ id: string; title: string; description: string; hasSave: boolean }> {
    return this.worlds().map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      hasSave: existsSync(row.savePath),
    }));
  }

  public getPlayerProfile(worldId: string): import("../persist/store.js").PlayerProfile | null {
    if (!this.session || this.currentId !== worldId) {
      return null;
    }
    return this.session.store.getPlayerProfile(worldId);
  }

  public setPlayerProfile(profile: import("../persist/store.js").PlayerProfile): void {
    if (!this.session || this.currentId !== profile.worldId) {
      throw new Error("NO_SESSION");
    }
    this.session.store.setPlayerProfile(profile);
  }

  public currentWorldId(): string | null {
    return this.currentId;
  }

  public bootstrap(): {
    worlds: Array<{ id: string; title: string; description: string; hasSave: boolean }>;
    currentWorldId: string | null;
    state: PlayerState | null;
    messages: ChatMessage[];
    playerProfile: import("../persist/store.js").PlayerProfile | null;
    roleSwitch: "blocked";
    roleSwitchReason: string;
  } {
    if (!this.session) {
      const first = this.worlds()[0];
      if (first && existsSync(first.savePath)) {
        this.open(first.id, "resume");
      }
    }
    return {
      worlds: this.worldsList(),
      currentWorldId: this.currentId,
      state: this.session ? playerState(this.session) : null,
      messages: this.session ? chatHistory(this.session) : [],
      playerProfile: this.currentId ? this.getPlayerProfile(this.currentId) : null,
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
      createSaveBackup(option.savePath, option.id, this.copyFileFn);
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
