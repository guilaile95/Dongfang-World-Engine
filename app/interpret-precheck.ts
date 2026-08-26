import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stubNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient } from "./model/client.js";
import { stubNarrator } from "./narrator/client.js";
import { createModelInterpreter, fixedInterpreter } from "./scene/interpreter.js";
import { createModelStopDecider, fixedStopDecider } from "./scene/stop.js";
import { openWorld, UNPARSED_HINT } from "./session.js";
import { loadWorldFile } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";

const ROUTE_LINE = "我避开老码头，选择 route-long-home，经老街和24小时药店的远路回家。";
const CHAT_LINE = "我看看窗外，顺便和同学聊两句。";

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync("data/local", { recursive: true });
  const model = createModelClient(config);
  const compiled = loadWorldFile(resolve("app/world/fixtures/dragon-2009-first-hour.json"));
  const interpreter = createModelInterpreter(model, config.apiKey);
  const stopDecider = createModelStopDecider(model);

  const route = await interpreter.interpret({
    playerLine: ROUTE_LINE,
    observerPack: "【世界】龙族·2009 第一小时\n【地点】仕兰中学教学楼\n【可用路线】route-long-home=经老街和24小时药店回家的远路（37分钟）；route-short-home=经老码头回家的近路（23分钟）",
    worldId: compiled.seed.world.id,
    playerId: compiled.playerId,
  });
  const stop = await stopDecider.decide({
    visibleContext: "你在24小时药店外的小街，听见低空旋翼声；两名陌生年轻人在红色跑车旁等待。",
    hardStopReason: "material_information",
    evidence: ["远路经过药店时出现了新的可见信息。"],
    strategyComplete: false,
  });

  const profile = { worldId: compiled.seed.world.id, name: "预检玩家", age: "18", gender: "未知", background: "普通学生", startingLocation: "仕兰中学教学楼", personality: "谨慎" };
  const chatSession = openWorld(":memory:", stubNarrator(), compiled, interpreter, stubNpcVoice(), fixedStopDecider());
  await chatSession.projectOpening(profile);
  const chatBefore = chatSession.store.snapshot(compiled.seed.world.id);
  const chatEventsBefore = chatSession.store.listEvents(compiled.seed.world.id).length;
  const chatTurn = await chatSession.handlePlayerTurn(CHAT_LINE, "preflight-chat");
  const chatAfter = chatSession.store.snapshot(compiled.seed.world.id);
  const chatEventsAfter = chatSession.store.listEvents(compiled.seed.world.id).length;
  chatSession.close();

  const invalid = openWorld(":memory:", stubNarrator(), compiled, fixedInterpreter({
    contributions: ["world_attempt"],
    futureCausal: true,
    outcome: "candidate",
    proposals: [{ type: "character_move", location: "不存在的地点" }],
    timePolicy: { kind: "none", minutes: null, routeId: null, untilTime: null },
    strategyIntent: null,
  }), stubNpcVoice(), fixedStopDecider());
  await invalid.projectOpening(profile);
  const invalidBefore = invalid.store.snapshot(compiled.seed.world.id);
  const invalidEventsBefore = invalid.store.listEvents(compiled.seed.world.id).length;
  const invalidTurn = await invalid.handlePlayerTurn("我走进不存在的地点。", "preflight-invalid-persistent");
  const invalidAfter = invalid.store.snapshot(compiled.seed.world.id);
  const invalidEventsAfter = invalid.store.listEvents(compiled.seed.world.id).length;
  invalid.close();

  const routeObject = route.interpretation.strategyIntent;
  const routeOk = Boolean(route.parsed && routeObject?.kind === "follow_route" && routeObject.routeId === "route-long-home" && route.interpretation.timePolicy?.kind === "route_travel");
  const stopOk = Boolean(stop && stop.shouldStop && stop.stopReason === "material_information" && stop.options?.map((row) => row.key).join("") === "ABCDEF");
  const chatOk = Boolean(chatTurn.text !== UNPARSED_HINT && !/JSON|Schema|Interpreter|换一种说法/.test(chatTurn.text) && chatEventsAfter === chatEventsBefore && chatAfter.world.revision === chatBefore.world.revision && chatAfter.characters.find((row) => row.id === compiled.playerId)?.locationId === chatBefore.characters.find((row) => row.id === compiled.playerId)?.locationId);
  const invalidOk = Boolean(invalidEventsAfter === invalidEventsBefore && invalidAfter.world.revision === invalidBefore.world.revision && invalidAfter.characters.find((row) => row.id === compiled.playerId)?.locationId === invalidBefore.characters.find((row) => row.id === compiled.playerId)?.locationId && invalidTurn.interpretation.submitted === false);
  const receipt = {
    protocol: "interpret-precheck",
    mode: "generateStructured",
    model: configForLog(config).model,
    baseUrl: configForLog(config).baseUrl,
    route: { line: ROUTE_LINE, parsed: route.parsed, interpretation: route.interpretation, ok: routeOk },
    stop: { decision: stop, ok: stopOk },
    ordinaryConversation: { line: CHAT_LINE, parsed: chatTurn.parsed, text: chatTurn.text, receipt: chatTurn.receipt, ok: chatOk },
    invalidPersistent: { parsed: invalidTurn.parsed, submitted: invalidTurn.interpretation.submitted, eventsBefore: invalidEventsBefore, eventsAfter: invalidEventsAfter, ok: invalidOk },
    calls: model.records,
    passed: routeOk && stopOk && chatOk && invalidOk,
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "interpret-precheck receipt");
  const out = resolve("data/local/interpret-precheck.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(`PRECHECK_${receipt.passed ? "OK" : "FAIL"} structured=${model.records.length} route=${routeOk} stop=${stopOk} chat=${chatOk} invalid=${invalidOk}\n`);
  process.stderr.write(`receipt ${out}\n`);
  if (!receipt.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
