import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import type { CallRecord } from "./model/types.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";
import { WorldStore } from "./persist/store.js";

/** Same frozen lines as experiment-1. New sqlite. Not a reroll. */
const INPUTS: Array<{ id: number; category: string; line: string }> = [
  { id: 1, category: "普通行动", line: "我沿着街走走，找家还开着的早餐铺。" },
  { id: 2, category: "否定", line: "算了，我不去上学了。" },
  { id: 3, category: "观察", line: "我站在路边，看看周围有什么人和店铺。" },
  { id: 4, category: "闲聊", line: "同学，今天天气还行。" },
  { id: 5, category: "直接问NPC", line: "同学，你知道附近有没有奇怪的事吗？" },
  { id: 6, category: "连续追问", line: "你刚才说的那个，能再说细一点吗？" },
  { id: 7, category: "混合动作+说话", line: "我把书包放下，问同学要不要一起去食堂。" },
  { id: 8, category: "转换话题", line: "不谈这个了，我先去便利店买瓶水。" },
  { id: 9, category: "长期后果", line: "我把刚才听到的话写进日记，以后不会忘掉。" },
  { id: 10, category: "OOC/meta", line: "（OOC）这是游戏吗？我现在该怎么玩？" },
];

const LEAK = ["黑王", "白王", "尼伯龙根", "fact-dragons-exist", "mixed-blood-academy", "死侍", "言灵"];

function excerpt(text: string, n = 420): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

function leaksIn(text: string): string[] {
  return LEAK.filter((token) => text.includes(token));
}

function digest(store: WorldStore, worldId: string): Record<string, unknown> {
  const snap = store.snapshot(worldId);
  const events = store.listEvents(worldId);
  return {
    time: snap.world.time,
    revision: snap.world.revision,
    factCount: snap.facts.length,
    claimCount: snap.claims.length,
    knowledgeCount: snap.knowledge.length,
    memoryCount: snap.memories.length,
    eventCount: events.length,
    eventTypes: events.map((event) => event.type),
    playerLocation: snap.characters.find((row) => row.kind === "player")?.locationId ?? null,
    roommateLocation: snap.characters.find((row) => row.name === "同学")?.locationId ?? null,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const compiled = loadWorldFile(config.worldSource);
  const publicConfig = configForLog(config);
  const model = createModelClient(config);
  const session = openWorld(
    config.worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const turns: unknown[] = [];
  let callCursor = 0;

  process.stderr.write(
    `experiment-2 source=${publicConfig.worldSource} world=${publicConfig.worldFile} model=${publicConfig.model} @ ${publicConfig.baseUrl}\n`,
  );

  try {
    for (const input of INPUTS) {
      const before = digest(session.store, worldId);
      const started = Date.now();
      let error: string | null = null;
      let view: Awaited<ReturnType<typeof session.playTurn>> | null = null;
      try {
        view = await session.playTurn(input.line);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const calls = model.records.slice(callCursor);
      callCursor = model.records.length;
      for (const record of calls) {
        assertNoSecret(JSON.stringify(record), config.apiKey, "experiment call record");
      }
      const playerPrompt = view?.prompt ?? "";
      const npcPrompt = view?.dialogue?.npcPrompt ?? "";
      const row = {
        id: input.id,
        category: input.category,
        line: input.line,
        error,
        latencyMs: Date.now() - started,
        interpretation: view
          ? {
            contributions: view.interpretation.contributions,
            outcome: view.interpretation.outcome,
            futureCausal: view.interpretation.futureCausal,
            submitted: view.interpretation.submitted,
            reasons: view.interpretation.result.reasons,
            eventTypes: view.interpretation.result.events.map((event) => event.type),
          }
          : null,
        dialogue: view?.dialogue
          ? {
            addresseeName: view.dialogue.addresseeName,
            npcReply: excerpt(view.dialogue.npcReply),
            npcPromptLeaks: leaksIn(npcPrompt),
          }
          : null,
        narrator: view ? excerpt(view.text) : null,
        envelopeCommitted: view?.envelope.committed ?? [],
        playerPromptLeaks: leaksIn(playerPrompt),
        playerKnownClaims: view?.observer.knownClaims.map((row) => row.claim.id) ?? [],
        before,
        after: digest(session.store, worldId),
        calls: calls.map((record: CallRecord) => ({
          role: record.role,
          purpose: record.purpose,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
          latencyMs: record.latencyMs,
          retryCount: record.retryCount,
          structuredMode: record.structuredMode,
          errorCategory: record.errorCategory,
        })),
      };
      turns.push(row);
      process.stderr.write(
        `#${input.id} ${input.category} outcome=${view?.interpretation.outcome ?? "error"} submitted=${view?.interpretation.submitted ?? false} npc=${view?.dialogue?.addresseeName ?? "-"} err=${error ?? "none"}\n`,
      );
      for (const record of calls) {
        process.stderr.write(`  ${formatCallLine(record)}\n`);
      }
    }
  } finally {
    session.close();
  }

  const resumeStore = new WorldStore(config.worldFile);
  seedCompiled(resumeStore, compiled);
  const resumed = digest(resumeStore, worldId);
  resumeStore.close();

  const receipt = {
    protocol: "experiment-2-product-play",
    follows: "experiment-1-product-play",
    reroll: false,
    promptEdited: false,
    modelSwitched: false,
    worldHandEdited: false,
    failuresDiscarded: false,
    model: publicConfig.model,
    baseUrl: publicConfig.baseUrl,
    worldSource: publicConfig.worldSource,
    worldFile: publicConfig.worldFile,
    packageTitle: compiled.packageTitle,
    worldId,
    turns,
    resumed,
    callCount: model.records.length,
    tokenIn: model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
    tokenOut: model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
    costUsd: model.records.every((record) => record.costUsd === null)
      ? null
      : model.records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
  };
  const out = resolve("data/local/experiment-2-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(`receipt ${out}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
