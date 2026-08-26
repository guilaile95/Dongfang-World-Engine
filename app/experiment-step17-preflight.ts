import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice, stubNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { WorldStore } from "./persist/store.js";
import { createModelInterpreter, fixedInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { assemblePrompt } from "./visibility/assemble.js";
import { assertNoSecret } from "./secrets.js";
import type { CallRecord } from "./model/types.js";

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
  const worldFile = resolve("data/local/experiment-step17-preflight.sqlite");
  if (existsSync(worldFile)) {
    unlinkSync(worldFile);
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
  const started = Date.now();
  const cases: unknown[] = [];

  const play = async (id: string, line: string) => {
    const before = digest(session.store, worldId);
    const rec0 = model.records.length;
    const t0 = Date.now();
    const view = await session.playTurn(line);
    const after = digest(session.store, worldId);
    const record = interpRecord(model.records, rec0);
    const row = {
      id,
      line,
      parsed: view.parsed,
      structuredMode: record?.structuredMode ?? null,
      outcome: view.interpretation.outcome,
      proposals: view.rawInterpretation.proposals,
      submitted: view.interpretation.submitted,
      committed: view.envelope.committed,
      eventTypes: view.interpretation.result.events.map((event) => event.type),
      failureReason: view.interpretation.result.accepted ? [] : view.interpretation.result.reasons,
      narrator: view.text.replace(/\s+/g, " ").slice(0, 360),
      before,
      after,
      latencyMs: Date.now() - t0,
    };
    cases.push(row);
    process.stderr.write(
      `${id} parsed=${view.parsed} outcome=${view.interpretation.outcome} submitted=${view.interpretation.submitted} loc=${after.playerLocation}\n`,
    );
    return { view, before, after, record };
  };

  try {
    const home = await play("1-home", "我回家了。");
    const cafeteria = await play("2-cafeteria", "我走进食堂。");
    const drop = await play("3-drop-bag", "我把书包放在桌上。");
    const pick = await play("4-carry-bag", "我重新背上书包。");
    const mixed = await play("5-mixed", "我走进宿舍，把书包放在桌上。");
    const diary = await play("6-diary", "我把刚才听到的失踪传闻写进日记。");
    const empty = await play("7-empty", "同学当场死了。");

    const loc = (snap: ReturnType<typeof digest>) => snap.playerLocation;
    const bag = (snap: ReturnType<typeof digest>) => snap.items.find((row) => row.id === "item-bag");
    const homeOk = home.view.parsed && loc(home.after) === "loc-home";
    const cafeteriaOk = cafeteria.view.parsed && loc(cafeteria.after) === "loc-cafeteria";
    const dropOk = drop.view.parsed && bag(drop.after)?.carrierId === null && bag(drop.after)?.locationId === loc(drop.after);
    const pickOk = pick.view.parsed && bag(pick.after)?.carrierId === playerId;
    const mixedOk = Boolean(
      mixed.view.parsed
        && loc(mixed.after) === "loc-dorm"
        && bag(mixed.after)?.carrierId === null
        && bag(mixed.after)?.locationId === "loc-dorm"
        && mixed.view.interpretation.result.events.some((event) => event.type === "character_move")
        && mixed.view.interpretation.result.events.some((event) => event.type === "item_place"),
    );
    const diaryOk = Boolean(
      diary.view.parsed
        && diary.after.memories.some((row) => row.characterId === playerId && /失踪|传闻|日记/.test(row.text))
        && diary.after.claims.filter((row) => !diary.before.claims.some((old) => old.id === row.id)).length === 0,
    );
    const deathAsserted = /同学(?:已经)?死了|同学当场死去/.test(empty.view.text);
    const emptyOk = Boolean(
      empty.view.parsed
        && empty.view.envelope.committed.length === 0
        && loc(empty.after) === loc(empty.before)
        && JSON.stringify(empty.after.items) === JSON.stringify(empty.before.items)
        && !deathAsserted,
    );

    const failStore = resolve("data/local/experiment-step17-preflight-failclosed.sqlite");
    if (existsSync(failStore)) {
      unlinkSync(failStore);
    }
    let narrated = 0;
    const failSession = openWorld(
      failStore,
      {
        async project() {
          narrated += 1;
          return "这句话没有改变已确认的世界事实，但你仍然可以继续描述或观察眼前的场景。";
        },
      },
      compiled,
      fixedInterpreter(
        {
          contributions: ["uncertain_attempt"],
          futureCausal: false,
          outcome: "fail",
          proposals: [],
        },
        false,
      ),
      stubNpcVoice(),
    );
    const failBefore = digest(failSession.store, worldId);
    const failTurn = await failSession.playTurn("%%%NOT_A_SCENE%%% [[[");
    const failAfter = digest(failSession.store, worldId);
    const failClosedOk = Boolean(
      failTurn.parsed === false
        && failTurn.text !== ""
        && failTurn.dialogue === null
        && narrated === 1
        && failAfter.time === failBefore.time
        && failAfter.revision === failBefore.revision
        && failAfter.events.length === failBefore.events.length
        && failAfter.playerLocation === failBefore.playerLocation,
    );
    failSession.close();
    cases.push({
      id: "8-ephemeral-lane-fail-closed-persistence",
      parsed: failTurn.parsed,
      text: failTurn.text,
      narrated,
      ok: failClosedOk,
    });

    const beforeClose = digest(session.store, worldId);
    session.close();
    const reopened = new WorldStore(worldFile);
    seedCompiled(reopened, compiled);
    const afterOpen = digest(reopened, worldId);
    const restartOk = JSON.stringify(beforeClose) === JSON.stringify(afterOpen);
    const roommate = reopened.snapshot(worldId).characters.find((row) => row.name === "同学");
    const playerPresentForRoommate = roommate
      ? assemblePrompt({ snapshot: reopened.snapshot(worldId), observerId: roommate.id }).observer.present.some(
        (row) => row.id === playerId,
      )
      : null;
    reopened.close();
    cases.push({
      id: "9-restart",
      beforeClose,
      afterOpen,
      playerPresentForRoommate,
      ok: restartOk,
    });

    const checks = {
      movement: homeOk && cafeteriaOk,
      item: dropOk && pickOk,
      mixed: mixedOk,
      diary: diaryOk,
      emptyCommitted: emptyOk,
      failClosed: failClosedOk,
      restart: restartOk,
    };
    const passed = Object.values(checks).every(Boolean);
    const tokenIn = model.records.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
    const tokenOut = model.records.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
    const receipt = {
      protocol: "experiment-step17-preflight",
      uniqueVariable: "location/item/mixed/diary durable consequences plus fail-closed and restart digest",
      model: publicConfig.model,
      worldFile,
      worldSource: config.worldSource,
      checks,
      homeOk,
      cafeteriaOk,
      dropOk,
      pickOk,
      mixedOk,
      diaryOk,
      emptyOk,
      failClosedOk,
      restartOk,
      playerPresentForRoommate,
      passed,
      cases,
      wallMs: Date.now() - started,
      tokenIn,
      tokenOut,
      callCount: model.records.length,
      costUsd: config.inputUsdPerMtok != null && config.outputUsdPerMtok != null
        ? model.records.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
        : "unknown / not configured",
      calls: model.records.map((row) => ({
        purpose: row.purpose,
        structuredMode: row.structuredMode,
        errorCategory: row.errorCategory,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        latencyMs: row.latencyMs,
      })),
    };
    assertNoSecret(JSON.stringify(receipt), config.apiKey, "step17 preflight receipt");
    const out = resolve("data/local/experiment-step17-preflight-receipt.json");
    writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(`step17 preflight passed=${passed} ${JSON.stringify(checks)}\n`);
    for (const record of model.records.slice(-4)) {
      process.stderr.write(`  ${formatCallLine(record)}\n`);
    }
    process.stderr.write(`receipt ${out}\n`);
    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    try {
      session.close();
    } catch {
      // already closed after restart case
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
