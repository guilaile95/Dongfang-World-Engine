import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient } from "./model/client.js";
import { interpretationSchema } from "./scene/interpretation.js";
import { INTERPRETER_SYSTEM } from "./scene/interpreter.js";
import { interpretationFailureFrom, persistInterpretationFailure } from "./scene/failure-log.js";
import { assertNoSecret } from "./secrets.js";

/** Frozen line #1. Plain JSON path only. No native Output.object. No ten-turn run. */
const LINE = "我沿着街走走，找家还开着的早餐铺。";

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync("data/local", { recursive: true });
  const model = createModelClient(config);
  const started = Date.now();
  const result = await model.generateJsonOnce({
    role: "proposal",
    purpose: "interpret-precheck",
    schema: interpretationSchema,
    system: INTERPRETER_SYSTEM,
    prompt: [
      "当前状态（权威）：世界=当代世界；时间=当代；地点=普通城市",
      `玩家场景贡献：${LINE}`,
      "只解释这一句。不要替玩家改做别的事。",
    ].join("\n"),
  });
  const publicConfig = configForLog(config);
  const receipt = {
    protocol: "interpret-precheck",
    line: LINE,
    model: publicConfig.model,
    baseUrl: publicConfig.baseUrl,
    passed: result.object !== null,
    latencyMs: Date.now() - started,
    object: result.object,
    record: {
      structuredMode: result.record.structuredMode,
      errorCategory: result.record.errorCategory,
      errorMessage: result.record.errorMessage,
      inputTokens: result.record.inputTokens,
      outputTokens: result.record.outputTokens,
      costUsd: result.record.costUsd,
      attempts: result.record.attempts,
    },
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "interpret-precheck receipt");
  const out = resolve("data/local/interpret-precheck.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  if (!result.object) {
    persistInterpretationFailure(interpretationFailureFrom(LINE, result.record), config.apiKey);
    process.stderr.write(
      `PRECHECK_FAIL mode=${result.record.structuredMode} err=${result.record.errorCategory} in=${result.record.inputTokens ?? "-"} out=${result.record.outputTokens ?? "-"}\n`,
    );
    for (const attempt of result.record.attempts) {
      const issues = attempt.zodIssues.map((issue) => `${issue.path}:${issue.message}`).join(" | ") || "-";
      process.stderr.write(
        `  stage=${attempt.stage} cat=${attempt.errorCategory} extract=${attempt.extractError ?? "-"} zod=${issues}\n`,
      );
      if (attempt.rawText) {
        process.stderr.write(`  raw=${attempt.rawText.replace(/\s+/g, " ").slice(0, 400)}\n`);
      }
    }
    process.stderr.write(`receipt ${out}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    `PRECHECK_OK outcome=${result.object.outcome} in=${result.record.inputTokens ?? "-"} out=${result.record.outputTokens ?? "-"} ${receipt.latencyMs}ms\n`,
  );
  process.stderr.write(`receipt ${out}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
