import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile } from "./world/load.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error(
      "Set DWE_WORLD_SOURCE to a .txt or .md world pack (for example 龙族V1.0.txt). Product play does not start from the synthetic inn fixture.",
    );
  }
  const compiled = loadWorldFile(config.worldSource);
  const publicConfig = configForLog(config);
  process.stderr.write(`world source: ${publicConfig.worldSource} (${compiled.packageTitle})\n`);
  process.stderr.write(`world file: ${publicConfig.worldFile}\n`);
  process.stderr.write(`model: ${publicConfig.model} @ ${publicConfig.baseUrl}\n`);

  const model = createModelClient(config);
  const session = openWorld(
    config.worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model),
    createNpcVoice(model, config.apiKey),
  );
  const rl = createInterface({ input, output });
  process.stdout.write("输入自然语言。:quit 退出。引擎藏在后面。\n");

  try {
    while (true) {
      const line = await rl.question("> ");
      if (line.trim() === ":quit") {
        break;
      }
      const turn = await session.playTurn(line, (chunk) => {
        process.stdout.write(chunk);
      });
      if (!turn.text.endsWith("\n")) {
        process.stdout.write("\n");
      }
      const recorded = model.lastRecord();
      if (recorded) {
        process.stderr.write(`${formatCallLine(recorded)}\n`);
      }
    }
  } finally {
    rl.close();
    session.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
