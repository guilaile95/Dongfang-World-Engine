import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile } from "./world/load.js";
import { assemblePrompt } from "./visibility/assemble.js";
import { assertNoSecret } from "./secrets.js";
import type { WorldStore } from "./persist/store.js";

/** Speech that should leave a lasting record between player and 同学. Not a move. Not an item. */
const ACTION = "同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。";
const FOLLOW = "同学，我刚才让你记住的是哪一件事？";

function authorityObserverSlice(store: WorldStore, worldId: string, observerId: string) {
  const pack = assemblePrompt({ snapshot: store.snapshot(worldId), observerId });
  return {
    memories: pack.observer.memories.map((row) => ({ id: row.id, text: row.text })),
    knownClaims: pack.observer.knownClaims.map((row) => ({
      id: row.claim.id,
      subject: row.claim.subject,
      predicate: row.claim.predicate,
      object: row.claim.object,
      state: row.state,
    })),
  };
}

function stateDigest(store: WorldStore, worldId: string) {
  const snap = store.snapshot(worldId);
  return {
    time: snap.world.time,
    revision: snap.world.revision,
    claims: snap.claims.map((row) => ({
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      sourceKind: row.sourceKind,
    })),
    memories: snap.memories.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      text: row.text,
    })),
    knowledge: snap.knowledge.map((row) => ({
      characterId: row.characterId,
      claimId: row.claimId,
      state: row.state,
    })),
    eventTypes: store.listEvents(worldId).map((event) => ({
      seq: event.seq,
      type: event.type,
      producer: event.producer,
    })),
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
  const roommate = session.store.snapshot(worldId).characters.find((row) => row.name === "同学");
  if (!roommate) {
    throw new Error("NPC 同学 not in compiled world");
  }

  const beforeState = stateDigest(session.store, worldId);
  const npcBefore = authorityObserverSlice(session.store, worldId, roommate.id);
  const started = Date.now();

  process.stderr.write(
    `experiment-4-e2e npc=${roommate.id} model=${publicConfig.model} world=${publicConfig.worldFile}\n`,
  );

  try {
    const t1 = await session.playTurn(ACTION);
    const interpCall = model.records.find((row) => row.purpose === "scene-interpretation");
    const afterWrite = stateDigest(session.store, worldId);
    const npcMid = authorityObserverSlice(session.store, worldId, roommate.id);
    const t2 = await session.playTurn(FOLLOW);
    const npcAfter = authorityObserverSlice(session.store, worldId, roommate.id);

    const llmEvents = t1.interpretation.result.events.filter((event) => event.producer === "llm");
    const parsed = interpCall?.errorCategory === "none";
    const durableProposals = (t1.rawInterpretation.proposals ?? []).length > 0
      && t1.rawInterpretation.outcome === "candidate"
      && t1.rawInterpretation.futureCausal === true;
    const npcMemoryChanged = JSON.stringify(npcBefore.memories) !== JSON.stringify(npcAfter.memories);
    const npcClaimsChanged = JSON.stringify(npcBefore.knownClaims) !== JSON.stringify(npcAfter.knownClaims);
    const npcAuthorityChanged = npcMemoryChanged || npcClaimsChanged;
    const narratorReceivedCommitted = t1.envelope.committed.length > 0;

    const surfaceCanTargetNpcMemory = t1.rawInterpretation.proposals.some(
      (row) => row.type === "memory_note" && row.characterId === roommate.id,
    );
    const surfaceWroteNpcMemory = afterWrite.memories.some(
      (row) =>
        row.characterId === roommate.id
        && !beforeState.memories.some((old) => old.id === row.id),
    );

    const passed = Boolean(
      parsed
        && durableProposals
        && t1.interpretation.submitted
        && llmEvents.length > 0
        && narratorReceivedCommitted
        && npcAuthorityChanged,
    );

    const structuralBlocker = !passed
      && parsed
      && !npcAuthorityChanged
      && !surfaceCanTargetNpcMemory
      && !surfaceWroteNpcMemory;

    const receipt = {
      protocol: "experiment-4-e2e-speech-consequence",
      follows: "experiment-3-interpretation-path",
      uniqueVariable: "smoke input redesigned onto claim_record/memory_note; no move/item; no narrator/prompt/schema change",
      model: publicConfig.model,
      worldFile: publicConfig.worldFile,
      action: ACTION,
      follow: FOLLOW,
      addresseeId: roommate.id,
      parsed,
      rawInterpretation: t1.rawInterpretation,
      bound: {
        contributions: t1.interpretation.contributions,
        outcome: t1.interpretation.outcome,
        futureCausal: t1.interpretation.futureCausal,
        submitted: t1.interpretation.submitted,
        reasons: t1.interpretation.result.reasons,
      },
      proposals: t1.rawInterpretation.proposals,
      submitted: t1.interpretation.submitted,
      llmEvents: llmEvents.map((event) => ({
        type: event.type,
        producer: event.producer,
        payload: event.payload,
      })),
      narratorReceivedCommitted: t1.envelope.committed,
      narratorText: t1.text.replace(/\s+/g, " ").slice(0, 500),
      beforeState,
      afterWrite,
      npcBefore,
      npcMid,
      npcAfter,
      npcMemoryChanged,
      npcClaimsChanged,
      npcAuthorityChanged,
      followNpcReply: t2.dialogue?.npcReply ?? null,
      checks: {
        parsed,
        durableProposals,
        submitted: t1.interpretation.submitted,
        llmCommittedEvents: llmEvents.length > 0,
        narratorReceivedCommitted,
        npcObserverAuthorityChanged: npcAuthorityChanged,
      },
      structuralBlocker,
      structuralReason: structuralBlocker
        ? "claim_record does not enter NPC legal pool (no llm knowledge grant); memory_note defaults to player unless characterId is the NPC; interpreter prompt does not assign addressee id"
        : null,
      passed,
      wallMs: Date.now() - started,
      tokenIn: model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
      tokenOut: model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
      costUsd: model.records.every((record) => record.costUsd === null)
        ? null
        : model.records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
      calls: model.records.map((record) => ({
        role: record.role,
        purpose: record.purpose,
        structuredMode: record.structuredMode,
        errorCategory: record.errorCategory,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        latencyMs: record.latencyMs,
        attempts: record.attempts,
      })),
    };
    assertNoSecret(JSON.stringify(receipt), config.apiKey, "experiment-4 receipt");
    const out = resolve("data/local/experiment-4-e2e-receipt.json");
    writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(
      `e2e parsed=${parsed} submitted=${t1.interpretation.submitted} committed=${t1.envelope.committed.length} npcAuthChanged=${npcAuthorityChanged} structural=${structuralBlocker} passed=${passed}\n`,
    );
    if (interpCall) {
      process.stderr.write(`  ${formatCallLine(interpCall)}\n`);
    }
    process.stderr.write(`receipt ${out}\n`);
    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    session.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
