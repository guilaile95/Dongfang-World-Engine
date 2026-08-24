import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rebuildState } from "../src/engine/projector.js";
import {
  PLAYABLE_DELAYED_CLAIM_ID,
  PLAYABLE_DELAYED_DISPLAY_TEXT,
} from "../src/play.js";
import { SqliteWorldStore } from "../src/persistence/sqlite-store.js";
import { canonicalSnapshot } from "../src/smoke/closed-inn-harness.js";
import { CLOSED_INN_WORLD_ID, seedClosedInnWorld } from "../src/testkit/world-builder.js";

interface ProviderRequest {
  kind: "simulation" | "narrative";
  body: string;
  userPayload: Record<string, unknown>;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

const playerId = "character-player";
const npcAId = "character-npc-a";
const npcBId = "character-npc-b";
const trueClaimId = "claim-dagger-in-cellar";

describe("Playable Local Loop entrypoint", () => {
  it("plays 25 natural-language interactions across exit/resume with an explainable delayed consequence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dwe-playable-"));
    const worldFile = join(directory, "world.sqlite");
    const apiKey = "playable-test-key-must-not-leak";
    const requests: ProviderRequest[] = [];
    let delayedNarrated = false;
    const server = createServer(async (request, response) => {
      try {
        const body = await readBody(request);
        const parsed = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
        };
        const system = parsed.messages[0]?.content ?? "";
        const userPayload = JSON.parse(parsed.messages[1]?.content ?? "{}") as Record<string, unknown>;
        const kind = system.includes("lane router") || system.includes("top-level shape")
          ? "simulation"
          : "narrative";
        requests.push({ kind, body, userPayload });
        const content = kind === "simulation"
          ? JSON.stringify(buildPlayerScenePlan(userPayload))
          : buildNarrative(userPayload, () => delayedNarrated, () => {
            delayedNarrated = true;
          });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end(error instanceof Error ? error.message : "fake provider failed");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const environment = {
        DWE_WORLD_FILE: worldFile,
        DWE_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        DWE_LLM_API_KEY: apiKey,
        DWE_LLM_MODEL: "playable-fake-model",
      };
      const firstInputs = [
        "我先观察大堂里的人，听听有没有人愿意说出匕首线索。",
        "我把已经知道的匕首在地窖的线索告诉赵先生。",
        "我观察赵先生听到线索后的反应。",
        "我继续留在大堂观察阿宝和赵先生。",
        "我再看看赵先生对阿宝的态度有没有变化。",
        "我前往客栈地窖查看现场。",
        "我在地窖仔细观察周围。",
        "我回到客栈大堂。",
        "我把目前的线索重新梳理一遍。",
        "我再次前往客栈地窖，准备稍后继续调查。",
      ];
      const firstRun = await runPlayProcess(environment, firstInputs);
      expect(firstRun.stderr).toBe("");
      expect(firstRun.stdout).toContain("已创建世界");
      expect(firstRun.stdout).toContain(PLAYABLE_DELAYED_DISPLAY_TEXT);
      expect(firstRun.stdout).not.toContain(apiKey);
      expect(firstRun.stdout).not.toContain("\u001b");
      expect(firstRun.stdout).not.toContain("]52;");
      expect((await stat(worldFile)).size).toBeGreaterThan(0);

      const firstStore = new SqliteWorldStore(worldFile);
      const firstSnapshot = firstStore.getSnapshot(CLOSED_INN_WORLD_ID);
      const firstEvents = firstStore.listEvents(CLOSED_INN_WORLD_ID);
      const firstRevision = firstSnapshot.world.revision;
      expect(firstRevision).toBe(firstEvents.length);
      expect(firstRevision).toBeGreaterThan(10);
      expect(firstSnapshot.characters.find((character) => character.id === playerId)?.locationId)
        .toBe("location-cellar");
      expect(firstSnapshot.knowledge.some(
        (knowledge) => knowledge.characterId === playerId && knowledge.claimId === PLAYABLE_DELAYED_CLAIM_ID,
      )).toBe(true);
      firstStore.close();

      const secondInputs = [
        "我回到客栈大堂继续调查。",
        "我观察大堂里的气氛。",
        "我前往二楼客房看看传闻从何而来。",
        "我在二楼客房观察有没有新的痕迹。",
        "我回到客栈大堂。",
        "我问自己还有哪些线索需要核对。",
        "我继续观察赵先生的神情。",
        "我留意阿宝是否显得放松。",
        "我把地窖和客房的说法作比较。",
        "我暂时不行动，只观察周围。",
        "我确认自己仍记得之前得到的线索。",
        "我看看客栈里是否还有人移动。",
        "我继续等待世界变化。",
        "我重新审视赵先生与阿宝的关系。",
        "我在大堂结束这一轮调查。",
      ];
      const secondRun = await runPlayProcess(environment, secondInputs);
      expect(secondRun.stderr).toBe("");
      expect(secondRun.stdout).toContain("已恢复世界");
      expect(secondRun.stdout).toContain(`revision=${firstRevision}`);
      expect(secondRun.stdout).toContain("位置=客栈地窖");
      expect(secondRun.stdout).not.toContain(apiKey);

      const finalStore = new SqliteWorldStore(worldFile);
      const finalSnapshot = finalStore.getSnapshot(CLOSED_INN_WORLD_ID);
      const events = finalStore.listEvents(CLOSED_INN_WORLD_ID);
      expect(finalSnapshot.world.id).toBe(firstSnapshot.world.id);
      expect(finalSnapshot.seed.id).toBe(firstSnapshot.seed.id);
      expect(finalSnapshot.world.revision).toBe(events.length);
      expect(finalSnapshot.world.revision).toBeGreaterThan(firstRevision);
      expect(events[firstRevision]?.worldRevision).toBe(firstRevision + 1);
      expect(events.map((event) => event.worldRevision)).toEqual(events.map((_, index) => index + 1));
      expect(events.filter((event) => event.type === "world.time_advance")).toHaveLength(25);

      const playerTransmission = events.find((event) =>
        event.type === "claim.transmit" &&
        event.payload.sourceCharacterId === playerId &&
        event.payload.targetCharacterId === npcBId &&
        event.payload.claimId === trueClaimId
      );
      const reaction = events.find((event) =>
        event.type === "relationship.change" &&
        event.payload.sourceCharacterId === npcBId &&
        event.payload.targetCharacterId === npcAId &&
        event.payload.hostilityDelta === -10
      );
      const consequenceClaim = finalSnapshot.claims.find((claim) => claim.id === PLAYABLE_DELAYED_CLAIM_ID);
      const consequenceKnowledge = finalSnapshot.knowledge.find(
        (knowledge) => knowledge.characterId === playerId && knowledge.claimId === PLAYABLE_DELAYED_CLAIM_ID,
      );
      expect(playerTransmission).toBeDefined();
      expect(reaction).toBeDefined();
      expect(reaction?.causeEventIds).toEqual([playerTransmission!.id]);
      expect(Date.parse(reaction!.eventTime) - Date.parse(playerTransmission!.eventTime)).toBeGreaterThanOrEqual(
        20 * 60_000,
      );
      expect(finalSnapshot.knowledge).toContainEqual(expect.objectContaining({
        characterId: npcBId,
        claimId: trueClaimId,
        sourceCharacterId: playerId,
        sourceEventId: playerTransmission!.id,
      }));
      expect(finalSnapshot.relationships).toContainEqual(expect.objectContaining({
        sourceCharacterId: npcBId,
        targetCharacterId: npcAId,
        trust: -5,
        hostility: 10,
        updatedByEventId: reaction!.id,
      }));
      expect(consequenceClaim).toEqual(expect.objectContaining({
        subject: npcBId,
        predicate: "attitude_changed_toward",
        object: npcAId,
      }));
      const claimEvent = finalStore.getEvent(consequenceClaim!.sourceEventId!);
      expect(claimEvent?.causeEventIds).toEqual([playerTransmission!.id, reaction!.id]);
      expect(consequenceKnowledge).toEqual(expect.objectContaining({
        knowledgeState: "confirmed",
        sourceType: "event",
        sourceEventId: claimEvent!.id,
      }));
      const learnEvent = events.find((event) =>
        event.type === "character.learn_claim" && event.payload.claimId === PLAYABLE_DELAYED_CLAIM_ID
      );
      expect(learnEvent?.causeEventIds).toEqual([claimEvent!.id]);

      const simulationRequests = requests.filter((request) => request.kind === "simulation");
      const narrativeRequests = requests.filter((request) => request.kind === "narrative");
      expect(simulationRequests).toHaveLength(25);
      expect(narrativeRequests).toHaveLength(25);
      expect(simulationRequests.map((request) => request.userPayload.intent)).toEqual([
        ...firstInputs,
        ...secondInputs,
      ]);
      expect(requests.map((request) => request.body).join("\n")).not.toContain(apiKey);
      for (const request of narrativeRequests) {
        expect(request.body).not.toContain("fact-hidden-dagger-cellar");
        expect(request.body).not.toContain("\"facts\":");
        expect(request.body).not.toContain("factAssertionRequirements");
        expect(request.body).not.toContain("WorldSnapshot");
      }

      const pristineStore = new SqliteWorldStore();
      seedClosedInnWorld(pristineStore);
      const rebuilt = rebuildState(pristineStore.getSnapshot(CLOSED_INN_WORLD_ID), events);
      expect(canonicalSnapshot(rebuilt)).toEqual(canonicalSnapshot(finalSnapshot));
      pristineStore.close();
      finalStore.close();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

function buildPlayerScenePlan(payload: Record<string, unknown>): Record<string, unknown> {
  const context = payload.context as {
    observer: { id: string };
    movementOptions: Array<{ locationId: string; name: string }>;
    coLocatedCharacters: Array<{ id: string; name: string }>;
    knowledge: Array<{ claim: { id: string } }>;
  };
  const intent = String(payload.intent ?? "");
  if (intent.trim().toLowerCase().startsWith("/ooc")) {
    return {
      channel: "ooc_meta",
      ephemeralBeats: [],
      targetedStimuli: [],
      persistentCandidates: [],
      unsupportedMaterial: [],
      timePolicy: { kind: "none" },
    };
  }
  const persistentCandidates: Array<Record<string, unknown>> = [];
  const targetedStimuli: Array<Record<string, unknown>> = [];
  if (intent.includes("告诉赵先生")) {
    const target = context.coLocatedCharacters.find((character) => character.id === npcBId);
    const claim = context.knowledge.find((bundle) => bundle.claim.id === trueClaimId);
    if (target && claim) {
      targetedStimuli.push({
        speakerCharacterId: context.observer.id,
        targetCharacterId: target.id,
        surfaceText: intent,
        speechAct: "tell",
        persistence: "ephemeral",
      });
      persistentCandidates.push({
        type: "claim.transmit",
        sourceCharacterId: context.observer.id,
        targetCharacterId: target.id,
        claimId: claim.claim.id,
      });
    }
  } else {
  const destinationName = intent.includes("地窖")
    ? "客栈地窖"
    : intent.includes("二楼客房") ? "二楼客房" : intent.includes("大堂") && intent.includes("回") ? "客栈大堂" : null;
  const destination = context.movementOptions.find((option) => option.name === destinationName);
  if (destination) {
    persistentCandidates.push({
      type: "character.move",
      actorId: context.observer.id,
      toLocationId: destination.locationId,
    });
  }
  }
  return {
    channel: "in_world",
    ephemeralBeats: persistentCandidates.length > 0
      ? []
      : [{ surface: intent, kind: "observation" }],
    targetedStimuli,
    persistentCandidates,
    unsupportedMaterial: [],
    timePolicy: { kind: "consume_scene_time", minutes: 10 },
  };
}

function buildNarrative(
  payload: Record<string, unknown>,
  wasDelayedNarrated: () => boolean,
  markDelayedNarrated: () => void,
): string {
  const envelope = payload as {
    observerContext: { knowledge: Array<{ claim: { id: string; displayText?: string } }> };
    outcomes: Array<{ type: string }>;
  };
  const delayed = envelope.observerContext.knowledge.find(
    (bundle) => bundle.claim.id === PLAYABLE_DELAYED_CLAIM_ID,
  );
  if (delayed?.claim.displayText && !wasDelayedNarrated()) {
    markDelayedNarrated();
    return `迟来的后果终于显现：${delayed.claim.displayText}`;
  }
  if (envelope.outcomes.some((outcome) => outcome.type === "character.move")) {
    return "你按自己的决定移动，新的位置已经被世界记录。";
  }
  if (envelope.outcomes.some((outcome) => outcome.type === "claim.transmit")) {
    return "你把自己已知的线索告诉了面前的人。";
  }
  return "\u001b]52;c;dGVzdA==\u0007你继续观察；即使你没有提交新行动，客栈里的时间与人物仍在向前。";
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
    }, 60_000);
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
