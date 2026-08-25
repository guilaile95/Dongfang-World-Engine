import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import type { CallRecord } from "./model/types.js";
import { createNarrator } from "./narrator/client.js";
import { WorldStore } from "./persist/store.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { assemblePrompt } from "./visibility/assemble.js";
import { assertNoSecret } from "./secrets.js";

const LINES: Array<{ id: number; tag: string; line: string }> = [
  { id: 1, tag: "观察", line: "我看看周围有什么人和店铺。" },
  { id: 2, tag: "闲聊", line: "同学，今天天气还行。" },
  { id: 3, tag: "追问", line: "同学，你知道附近有没有奇怪的事吗？" },
  { id: 4, tag: "告知", line: "同学，你记住：这附近最近不太平，我晚上可能不回宿舍。" },
  { id: 5, tag: "认知", line: "同学，卡塞尔学院在哪？" },
  { id: 6, tag: "拒绝", line: "算了，我不去上学了。" },
  { id: 7, tag: "走路", line: "我沿着街再走走。" },
  { id: 8, tag: "回家", line: "我回家了。" },
  { id: 9, tag: "休息", line: "我在家里坐一会儿。" },
  { id: 10, tag: "观察", line: "我看看家里有什么。" },
  { id: 11, tag: "走路", line: "我走进食堂。" },
  { id: 12, tag: "吃饭", line: "先随便吃点热的。" },
  { id: 13, tag: "闲聊", line: "食堂师傅，今天忙不忙？" },
  { id: 14, tag: "追问", line: "师傅，街上那桩失踪案你听说了吗？" },
  { id: 15, tag: "混合", line: "我走进宿舍，把书包放在桌上。" },
  { id: 16, tag: "物品", line: "我拿起桌上的钥匙。" },
  { id: 17, tag: "物品", line: "我把钥匙留在宿舍。" },
  { id: 18, tag: "记录", line: "我把刚才听到的失踪传闻写进日记。" },
  { id: 19, tag: "走路", line: "我离开宿舍，去教学楼。" },
  { id: 20, tag: "观察", line: "我看看教学楼门口来往的人。" },
  { id: 21, tag: "走路", line: "我回到刚才那家便利店。" },
  { id: 22, tag: "离题", line: "买瓶水，顺便看一眼货架上的杂志。" },
  { id: 23, tag: "离题", line: "这本杂志封面挺吵的。" },
  { id: 24, tag: "走路", line: "我回到街上。" },
  { id: 25, tag: "后果", line: "同学，你还记得我晚上可能不回宿舍那件事吗？" },
  { id: 26, tag: "认知", line: "同学，龙还存在吗？" },
  { id: 27, tag: "认知", line: "那混血种、尼伯龙根又是什么？" },
  { id: 28, tag: "拒绝", line: "不，今天我不想跟任何人出门远行。" },
  { id: 29, tag: "离题", line: "我数了数路边停的车。" },
  { id: 30, tag: "观察", line: "街头新闻还在播吗？" },
  { id: 31, tag: "后果", line: "我再看看书包还在不在身上。" },
  { id: 32, tag: "混合", line: "我重新背上书包，问同学要不要一起去食堂。" },
];

const LEAK = ["黑王", "白王", "尼伯龙根", "fact-dragons-exist", "mixed-blood-academy", "死侍", "言灵"];
const RESTART_AFTER = 15;

function digest(store: WorldStore, worldId: string) {
  const snap = store.snapshot(worldId);
  return {
    time: snap.world.time,
    revision: snap.world.revision,
    playerLocation: snap.characters.find((row) => row.kind === "player")?.locationId ?? null,
    items: snap.items
      .map((row) => ({ id: row.id, name: row.name, locationId: row.locationId, carrierId: row.carrierId }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    memories: snap.memories
      .map((row) => ({ characterId: row.characterId, text: row.text }))
      .sort((a, b) => a.characterId.localeCompare(b.characterId) || a.text.localeCompare(b.text)),
    claims: snap.claims
      .map((row) => ({ id: row.id, subject: row.subject, predicate: row.predicate, object: row.object }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    knowledge: snap.knowledge
      .map((row) => ({ characterId: row.characterId, claimId: row.claimId, state: row.state }))
      .sort((a, b) => a.characterId.localeCompare(b.characterId) || a.claimId.localeCompare(b.claimId)),
    events: store.listEvents(worldId).map((event) => ({
      seq: event.seq,
      type: event.type,
      producer: event.producer,
    })),
  };
}

function interpRecord(records: CallRecord[], since: number): CallRecord | undefined {
  return records.slice(since).find((row) => row.purpose === "scene-interpretation");
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const worldFile = resolve("data/local/experiment-step17-longrun.sqlite");
  const receiptPath = resolve("data/local/experiment-step17-longrun-receipt.json");
  const resumeFrom = Number(process.env.DWE_RESUME_FROM ?? "1");
  let priorTurns: unknown[] = [];
  let priorRestart: {
    at: number;
    ok: boolean;
    digestBefore: ReturnType<typeof digest> | null;
    digestAfter: ReturnType<typeof digest> | null;
  } | null = null;
  let priorTokenIn = 0;
  let priorTokenOut = 0;
  let priorCalls = 0;
  let priorWall = 0;
  if (resumeFrom <= 1) {
    if (existsSync(worldFile)) {
      unlinkSync(worldFile);
    }
  } else if (existsSync(receiptPath)) {
    const prior = JSON.parse(readFileSync(receiptPath, "utf8")) as {
      turns?: unknown[];
      tokenIn?: number;
      tokenOut?: number;
      callCount?: number;
      wallMs?: number;
      restart?: {
        at: number;
        ok: boolean;
        digestBefore: ReturnType<typeof digest> | null;
        digestAfter: ReturnType<typeof digest> | null;
      };
    };
    priorTokenIn = prior.tokenIn ?? 0;
    priorTokenOut = prior.tokenOut ?? 0;
    priorCalls = prior.callCount ?? 0;
    priorWall = prior.wallMs ?? 0;
    priorTurns = (prior.turns ?? []).filter((row) => {
      const id = (row as { id?: number }).id;
      return typeof id === "number" && id < resumeFrom;
    });
    priorRestart = prior.restart ?? null;
  }
  const compiled = loadWorldFile(config.worldSource);
  const publicConfig = configForLog(config);
  const model = createModelClient(config);
  let session = openWorld(
    worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const playerId = compiled.playerId;
  const roommate = session.store.snapshot(worldId).characters.find((row) => row.name === "同学");
  const cafeteria = session.store.snapshot(worldId).characters.find((row) => row.name === "食堂师傅");
  const hybrid = session.store.snapshot(worldId).characters.find((row) => row.id === "char-hybrid");
  const started = Date.now();
  const turns: unknown[] = [...priorTurns];
  let consecutiveFail = 0;
  let maxConsecutiveFail = 0;
  let stoppedEarly = false;
  let stopReason: string | null = null;
  let p0 = false;
  let restart = priorRestart ?? {
    at: RESTART_AFTER,
    ok: false,
    digestBefore: null as ReturnType<typeof digest> | null,
    digestAfter: null as ReturnType<typeof digest> | null,
  };

  process.stderr.write(`experiment-step17-longrun model=${publicConfig.model} world=${worldFile}\n`);

  try {
    for (const input of LINES) {
      if (input.id < resumeFrom) {
        continue;
      }
      if (input.id === RESTART_AFTER + 1) {
        const before = digest(session.store, worldId);
        session.close();
        const reopened = new WorldStore(worldFile);
        seedCompiled(reopened, compiled);
        const after = digest(reopened, worldId);
        restart = {
          at: RESTART_AFTER,
          ok: JSON.stringify(before) === JSON.stringify(after),
          digestBefore: before,
          digestAfter: after,
        };
        reopened.close();
        if (!restart.ok) {
          p0 = true;
          stopReason = "RESUME_DIGEST_MISMATCH";
        }
        session = openWorld(
          worldFile,
          createNarrator(model, config.apiKey),
          compiled,
          createModelInterpreter(model, config.apiKey),
          createNpcVoice(model, config.apiKey),
        );
      }

      const before = digest(session.store, worldId);
      const rec0 = model.records.length;
      const t0 = Date.now();
      const view = await session.playTurn(input.line);
      const after = digest(session.store, worldId);
      const record = interpRecord(model.records, rec0);
      const leaks = LEAK.filter((token) => {
        if (input.line.includes(token)) {
          return false;
        }
        return (view.dialogue?.npcReply ?? "").includes(token);
      });
      if (view.parsed) {
        consecutiveFail = 0;
      } else {
        consecutiveFail += 1;
        maxConsecutiveFail = Math.max(maxConsecutiveFail, consecutiveFail);
      }
      const row = {
        id: input.id,
        tag: input.tag,
        line: input.line,
        parsed: view.parsed,
        structuredMode: record?.structuredMode ?? null,
        outcome: view.interpretation.outcome,
        proposals: view.rawInterpretation.proposals,
        submitted: view.interpretation.submitted,
        committed: view.envelope.committed,
        eventTypes: view.interpretation.result.events.map((event) => event.type),
        failureReason: view.interpretation.result.accepted ? [] : view.interpretation.result.reasons,
        narrator: view.text.replace(/\s+/g, " ").slice(0, 320),
        npc: view.dialogue?.npcReply ?? null,
        leaks,
        before,
        after,
        latencyMs: Date.now() - t0,
      };
      turns.push(row);
      process.stderr.write(
        `#${input.id} ${input.tag} parsed=${view.parsed} outcome=${view.interpretation.outcome} submitted=${view.interpretation.submitted} loc=${after.playerLocation} leaks=${leaks.length}\n`,
      );
      if (consecutiveFail >= 3) {
        stoppedEarly = true;
        stopReason = "INTERPRETATION_STREAK_FAIL";
        process.stderr.write(`interpretation failed 3 consecutive turns at #${input.id}, stopping\n`);
        break;
      }
      if (!restart.ok && restart.digestBefore) {
        stoppedEarly = true;
        p0 = true;
        stopReason = "RESUME_DIGEST_MISMATCH";
        process.stderr.write(`P0 resume digest mismatch at turn ${input.id}, stopping\n`);
        break;
      }
    }
  } finally {
    session.close();
  }

  const finalStore = new WorldStore(worldFile);
  seedCompiled(finalStore, compiled);
  const finalDigest = digest(finalStore, worldId);
  const roommatePack = roommate
    ? assemblePrompt({ snapshot: finalStore.snapshot(worldId), observerId: roommate.id }).prompt
    : "";
  const hybridPack = hybrid
    ? assemblePrompt({ snapshot: finalStore.snapshot(worldId), observerId: hybrid.id }).prompt
    : "";
  const cafeteriaPack = cafeteria
    ? assemblePrompt({ snapshot: finalStore.snapshot(worldId), observerId: cafeteria.id }).prompt
    : "";
  finalStore.close();

  const parsedTurns = (turns as Array<{ parsed: boolean }>).filter((row) => row.parsed).length;
  const completed = turns.length;
  const parsedRate = completed === 0 ? 0 : parsedTurns / completed;
  const tokenIn = priorTokenIn + model.records.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const tokenOut = priorTokenOut + model.records.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const modeCounts = model.records.reduce(
    (acc, row) => {
      acc[row.structuredMode] = (acc[row.structuredMode] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const interpretationFail = parsedRate < 0.8 || stopReason === "INTERPRETATION_STREAK_FAIL";
  const passed = completed >= 30 && parsedRate >= 0.8 && restart.ok && !p0 && !stoppedEarly;
  const receipt = {
    protocol: "experiment-step17-longzu-32",
    follows: "experiment-step17-preflight",
    uniqueVariable: "new Step 17 long run after location/item/mixed/diary primitives; not a reroll of experiment-8; turns 28-32 resume same sqlite after echo-leak abort",
    model: publicConfig.model,
    worldFile,
    worldSource: config.worldSource,
    completed,
    parsedTurns,
    parsedRate,
    maxConsecutiveFail,
    stoppedEarly,
    stopReason,
    restart,
    p0,
    interpretationFail,
    passed,
    finalDigest,
    roommateLeak: LEAK.filter((token) => roommatePack.includes(token)),
    hybridSeesDragon: hybridPack.includes("dragons") || hybridPack.includes("龙"),
    cafeteriaPackHasPlayer: cafeteriaPack.includes("普通人"),
    wallMs: priorWall + (Date.now() - started),
    tokenIn,
    tokenOut,
    callCount: priorCalls + model.records.length,
    callsPerTurn: completed === 0 ? 0 : (priorCalls + model.records.length) / completed,
    structuredModeCounts: modeCounts,
    costUsd: config.inputUsdPerMtok != null && config.outputUsdPerMtok != null
      ? model.records.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
      : "unknown / not configured",
    turns,
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "step17 longrun receipt");
  const out = resolve("data/local/experiment-step17-longrun-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(
    `step17 longrun completed=${completed}/32 parsed=${parsedTurns} rate=${parsedRate.toFixed(2)} restart=${restart.ok} p0=${p0} stop=${stopReason ?? "none"} passed=${passed}\n`,
  );
  for (const record of model.records.slice(-3)) {
    process.stderr.write(`  ${formatCallLine(record)}\n`);
  }
  process.stderr.write(`receipt ${out}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
