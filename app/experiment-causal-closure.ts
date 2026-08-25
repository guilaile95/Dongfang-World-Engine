import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { WorldStore } from "./persist/store.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { assemblePrompt } from "./visibility/assemble.js";
import { assertNoSecret } from "./secrets.js";

const LINES = [
  { id: 1, tag: "闲聊", line: "同学，今天天气还行。" },
  { id: 2, tag: "记住", line: "同学，你记住：晚上我可能不回宿舍。" },
  { id: 3, tag: "移动", line: "我回家了。" },
  { id: 4, tag: "离开后", line: "家里好安静。" },
  { id: 5, tag: "移动", line: "我走进宿舍。" },
  { id: 6, tag: "放下", line: "我把书包放在桌上。" },
  { id: 7, tag: "离开", line: "我回到街上。" },
  { id: 8, tag: "远程拿", line: "我把书包背起来。" },
  { id: 9, tag: "闲聊", line: "我数了数路边停的车。" },
  { id: 10, tag: "回去", line: "我走进宿舍。" },
  { id: 11, tag: "拿起", line: "我重新背上书包。" },
  { id: 12, tag: "追问", line: "我回到街上。" },
  { id: 13, tag: "记得吗", line: "同学，你还记得我晚上可能不回宿舍那件事吗？" },
];

const CONTACT = /肩带|抓起书包|摸到书包|已经背上|背上了书包|整理.{0,8}书包/;

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
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const worldFile = resolve("data/local/experiment-causal-closure.sqlite");
  if (existsSync(worldFile)) {
    unlinkSync(worldFile);
  }
  const compiled = loadWorldFile(config.worldSource);
  const model = createModelClient(config);
  const session = openWorld(
    worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const playerId = compiled.playerId;
  const roommate = session.store.snapshot(worldId).characters.find((row) => row.name === "同学");
  const hybrid = session.store.snapshot(worldId).characters.find((row) => row.id === "char-hybrid");
  if (!roommate) {
    throw new Error("NPC 同学 missing");
  }
  const started = Date.now();
  type Digest = ReturnType<typeof digest>;
  type TurnRow = {
    id: number;
    tag: string;
    line: string;
    parsed: boolean;
    outcome: string;
    submitted: boolean;
    committed: string[];
    uncommitted: string[];
    eventTypes: string[];
    dialogue: string | null;
    npc: string | null;
    narrator: string;
    before: Digest;
    after: Digest;
  };
  const turns: TurnRow[] = [];
  let parsedOk = 0;

  try {
    for (const input of LINES) {
      const before = digest(session.store, worldId);
      const view = await session.playTurn(input.line);
      const after = digest(session.store, worldId);
      if (view.parsed) {
        parsedOk += 1;
      }
      const row = {
        id: input.id,
        tag: input.tag,
        line: input.line,
        parsed: view.parsed,
        outcome: view.interpretation.outcome,
        submitted: view.interpretation.submitted,
        committed: view.envelope.committed,
        uncommitted: view.envelope.uncommitted,
        eventTypes: view.interpretation.result.events.map((event) => event.type),
        dialogue: view.dialogue?.addresseeName ?? null,
        npc: view.dialogue?.npcReply ?? null,
        narrator: view.text.replace(/\s+/g, " ").slice(0, 360),
        before,
        after,
      };
      turns.push(row);
      process.stderr.write(
        `#${input.id} ${input.tag} parsed=${view.parsed} submitted=${view.interpretation.submitted} loc=${after.playerLocation} npc=${row.dialogue ?? "none"}\n`,
      );
    }
  } finally {
    session.close();
  }

  const store = new WorldStore(worldFile);
  seedCompiled(store, compiled);
  const finalDigest = digest(store, worldId);
  const roommatePack = assemblePrompt({ snapshot: store.snapshot(worldId), observerId: roommate.id }).prompt;
  const hybridPack = hybrid
    ? assemblePrompt({ snapshot: store.snapshot(worldId), observerId: hybrid.id }).prompt
    : "";
  const roommateSeesPlayer = assemblePrompt({
    snapshot: store.snapshot(worldId),
    observerId: roommate.id,
  }).observer.present.some((row) => row.id === playerId);
  store.close();

  const byId = new Map(turns.map((row) => [row.id, row]));
  const t1 = byId.get(1);
  const t2 = byId.get(2);
  const t3 = byId.get(3);
  const t4 = byId.get(4);
  const t6 = byId.get(6);
  const t8 = byId.get(8);
  const t11 = byId.get(11);
  if (!t1 || !t2 || !t3 || !t4 || !t6 || !t8 || !t11) {
    throw new Error("missing turn rows");
  }
  const memoryOk = t2.after.memories.some((row) => row.characterId === roommate.id && /不回宿舍/.test(row.text));
  const afterWeatherNoForce = !t1.after.memories.some(
    (row) => row.characterId === roommate.id && /不回宿舍/.test(row.text),
  );
  const moveHome = t3.after.playerLocation === "loc-home" && t3.dialogue === null && t4.dialogue === null;
  const bagLeft = t6.after.items.find((row) => row.id === "item-bag")?.locationId === "loc-dorm"
    && t6.after.items.find((row) => row.id === "item-bag")?.carrierId === null;
  const remoteReject = t8.submitted === false
    && t8.after.items.find((row) => row.id === "item-bag")?.locationId === "loc-dorm"
    && t8.uncommitted.some((line) => line.includes("书包"))
    && !CONTACT.test(t8.narrator);
  const carryOk = t11.submitted && t11.after.items.find((row) => row.id === "item-bag")?.carrierId === playerId;
  const recallOk = /不回宿舍/.test(roommatePack);
  const noLeak = !/不回宿舍/.test(hybridPack);
  const parsedRate = parsedOk / LINES.length;

  const beforeClose = finalDigest;
  const reopened = new WorldStore(worldFile);
  seedCompiled(reopened, compiled);
  const afterOpen = digest(reopened, worldId);
  reopened.close();
  const restartOk = JSON.stringify(beforeClose) === JSON.stringify(afterOpen);

  const checks = {
    spokenMemory: memoryOk,
    weatherNotForced: afterWeatherNoForce,
    moveNoDialogue: moveHome,
    dropBag: bagLeft,
    remoteReject,
    carrySuccess: carryOk,
    laterRecall: recallOk,
    unrelatedNoLeak: noLeak,
    roommateSeesPlayerAtEnd: roommateSeesPlayer,
    restart: restartOk,
    parsed: parsedRate >= 0.8,
  };
  const passed = Object.values(checks).every(Boolean) && parsedRate >= 0.8;
  const receipt = {
    protocol: "experiment-causal-closure-13b",
    follows: "experiment-step17-longzu-32",
    uniqueVariable: "post-commit dialogue, uncommitted narrator, spoken remember-memory, beat damping",
    model: configForLog(config).model,
    worldFile,
    checks,
    parsedRate,
    restartOk,
    finalDigest,
    roommateSeesPlayer,
    passed,
    wallMs: Date.now() - started,
    tokenIn: model.records.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    tokenOut: model.records.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    callCount: model.records.length,
    costUsd: "unknown / not configured",
    turns,
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "causal-closure receipt");
  const out = resolve("data/local/experiment-causal-closure-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(`causal-closure passed=${passed} ${JSON.stringify(checks)}\n`);
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
