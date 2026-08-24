import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlaySession } from "../src/engine/play-session.js";
import { PLOT_ONGOING_CLAIM_ID, PLOT_PROGRESS_PREDICATE } from "../src/engine/world-tick.js";
import { SqliteWorldStore } from "../src/persistence/sqlite-store.js";
import {
  CLOSED_INN_WORLD_ID,
  CLOSED_INN_WORLD_RULES,
} from "../src/testkit/world-builder.js";

const OFF_PLOT_LINE = "我去厨房随便找点吃的，今天不查匕首，也不跟任何人说话。";
const SCENE_REPLY = "你在客栈灶房找了点剩饭。大厅那边的调查并没有因为你走开而停下来。";

interface ProcessResult {
  stdout: string;
  stderr: string;
}

describe("Chat-first playable loop", () => {
  it("accepts off-plot chat, persists independent plot, and resumes context from the same file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dwe-chat-first-"));
    const worldFile = join(directory, "world.sqlite");
    const apiKey = "playable-test-key-must-not-leak";
    const requests: string[] = [];
    const server = createFakeProvider((body) => {
      requests.push(body);
      return SCENE_REPLY;
    });
    await listen(server);

    try {
      const address = server.address() as AddressInfo;
      const config = {
        worldFile,
        DWE_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        DWE_LLM_API_KEY: apiKey,
        DWE_LLM_MODEL: "playable-fake-model",
      };
      const session = PlaySession.open({
        worldFile,
        baseUrl: config.DWE_LLM_BASE_URL,
        apiKey,
        model: config.DWE_LLM_MODEL,
      });
      expect(session.resumed).toBe(false);

      const turn = await session.playTurn(OFF_PLOT_LINE);
      expect(turn.unknownActionRejection).toBe(false);
      expect(turn.sceneReply.trim().length).toBeGreaterThan(0);
      expect(turn.sceneReply).not.toMatch(/unknown action|未知行动|proposal/i);
      expect(turn.sceneReply).not.toContain(apiKey);
      expect(turn.playerLine).toBe(OFF_PLOT_LINE);
      expect(turn.plotContinuation.independentOfPlayerLine).toBe(true);
      expect(turn.plotContinuation.claimId).toBe("claim-plot-tick-1");
      expect(turn.plotContinuation.stage).toBe("1");
      expect(turn.modelFacingContext.rules).toEqual([...CLOSED_INN_WORLD_RULES]);
      expect(turn.modelFacingContext.plotStage).toBe("1");
      expect(turn.modelFacingContext.plotThreads.some((thread) => thread.id === PLOT_ONGOING_CLAIM_ID)).toBe(true);
      expect(turn.modelFacingContext.plotThreads.some((thread) => thread.id === "claim-plot-tick-1")).toBe(true);
      expect(JSON.stringify(turn.modelFacingContext)).not.toContain("fact-hidden-dagger-cellar");
      expect(JSON.stringify(requests.join("\n"))).not.toContain(apiKey);

      const liveStore = session.getStore();
      const snapshot = liveStore.getSnapshot(CLOSED_INN_WORLD_ID);
      const events = liveStore.listEvents(CLOSED_INN_WORLD_ID);
      const plotClaim = snapshot.claims.find((claim) => claim.id === "claim-plot-tick-1");
      const plotClaimEvent = events.find((event) => event.type === "claim.record" && event.payload.claimId === "claim-plot-tick-1");
      expect(plotClaim).toEqual(expect.objectContaining({
        predicate: PLOT_PROGRESS_PREDICATE,
        object: "sun-searches-guestroom",
      }));
      expect(plotClaimEvent?.payload.actorId).toBe("character-npc-c");
      expect(plotClaimEvent?.payload.actorId).not.toBe("character-player");
      expect(JSON.stringify(plotClaimEvent?.payload)).not.toContain("厨房");
      expect(JSON.stringify(plotClaimEvent?.payload)).not.toContain(OFF_PLOT_LINE);
      expect(snapshot.facts.some((fact) => fact.id === "fact-hidden-dagger-cellar")).toBe(true);
      expect(snapshot.facts.some((fact) =>
        fact.predicate === "plot_stage" && fact.object === "1" && fact.validTo === null,
      )).toBe(true);
      session.close();

      const resumed = PlaySession.open({
        worldFile,
        baseUrl: config.DWE_LLM_BASE_URL,
        apiKey,
        model: config.DWE_LLM_MODEL,
      });
      expect(resumed.resumed).toBe(true);
      const restored = resumed.buildModelFacingContext();
      expect(restored.rules).toEqual([...CLOSED_INN_WORLD_RULES]);
      expect(restored.plotStage).toBe("1");
      expect(restored.plotThreads.map((thread) => thread.id)).toEqual(
        expect.arrayContaining([PLOT_ONGOING_CLAIM_ID, "claim-plot-tick-1"]),
      );
      expect(JSON.stringify(restored)).not.toContain("fact-hidden-dagger-cellar");
      const second = await resumed.playTurn("我再去灶上喝口水。");
      expect(second.unknownActionRejection).toBe(false);
      expect(second.sceneReply.trim().length).toBeGreaterThan(0);
      expect(second.plotContinuation.stage).toBe("2");
      expect(second.modelFacingContext.plotThreads.some((thread) => thread.id === "claim-plot-tick-2")).toBe(true);
      resumed.close();
      expect((await stat(worldFile)).size).toBeGreaterThan(0);
    } finally {
      await closeServer(server);
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("spawns the shipped play entry and returns a scene reply for a freeform line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dwe-play-cli-"));
    const worldFile = join(directory, "world.sqlite");
    const apiKey = "cli-test-key-must-not-leak";
    const server = createFakeProvider(() => SCENE_REPLY);
    await listen(server);
    try {
      const address = server.address() as AddressInfo;
      const run = await runPlayProcess({
        DWE_WORLD_FILE: worldFile,
        DWE_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        DWE_LLM_API_KEY: apiKey,
        DWE_LLM_MODEL: "playable-fake-model",
      }, [OFF_PLOT_LINE]);
      expect(run.stderr).toBe("");
      expect(run.stdout).toContain("已创建世界");
      expect(run.stdout).toContain(SCENE_REPLY);
      expect(run.stdout).not.toMatch(/unknown action|未知行动/i);
      expect(run.stdout).not.toContain(apiKey);
      const store = new SqliteWorldStore(worldFile);
      expect(store.listEvents(CLOSED_INN_WORLD_ID).some((event) =>
        event.type === "claim.record" && event.payload.claimId === "claim-plot-tick-1",
      )).toBe(true);
      store.close();
    } finally {
      await closeServer(server);
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

function createFakeProvider(replyFor: (body: string) => string) {
  return createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      const content = replyFor(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "chatcmpl-playable",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
      }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : "fake provider failed");
    }
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function runPlayProcess(environment: Record<string, string>, inputs: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const npmCli = process.env.npm_execpath;
    const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const arguments_ = npmCli
      ? [npmCli, "run", "play", "--silent"]
      : ["run", "play", "--silent"];
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: { ...process.env, ...environment, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("npm run play timed out"));
    }, 90_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`npm run play exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(`${inputs.join("\n")}\n:quit\n`);
  });
}
