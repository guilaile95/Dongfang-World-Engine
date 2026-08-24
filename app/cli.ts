import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createSceneClient } from "./chat/scene.js";
import { configForLog, loadConfig } from "./config.js";
import { openWorld } from "./session.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const publicConfig = configForLog(config);
  process.stderr.write(`world file: ${publicConfig.worldFile}\n`);
  process.stderr.write(`model: ${publicConfig.model} @ ${publicConfig.baseUrl}\n`);

  const session = openWorld(config.worldFile, createSceneClient(config));
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
