import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";
import type { NarratorEnvelope } from "./envelope.js";
import { hasNarrationLeak, NARRATOR_SYSTEM, renderNarratorPrompt } from "./project.js";

export interface Narrator {
  project(envelope: NarratorEnvelope, onChunk?: (text: string) => void): Promise<string>;
}

const REPAIR_SYSTEM =
  "你的任务：把下面的段落重写成干净的故事文本，不改变任何已发生的事，只改变表达方式。" +
  "严禁出现：Authority、Candidate、Revision、权威层、非权威、Context、数据库、B层、C层、S层、当前状态、最近场景，或任何内部技术字段名。" +
  "直接输出重写后的段落，不加任何说明。";

export function createNarrator(client: ModelClient, apiKey: string): Narrator {
  return {
    async project(envelope, onChunk) {
      const prompt = renderNarratorPrompt(envelope);
      assertNoSecret(prompt, apiKey, "narrator envelope");

      // 1. Initial generation: buffered on server, NEVER pass raw onChunk before validation.
      const result = await client.stream({
        role: "narrator",
        purpose: "narrator-projection",
        system: NARRATOR_SYSTEM,
        prompt,
      });
      let text = result.text;

      // 2. Narration Leak Gate: one presentation-only repair attempt if internal markers detected.
      if (hasNarrationLeak(text)) {
        const repairResult = await client.stream({
          role: "narrator",
          purpose: "narrator-repair",
          system: REPAIR_SYSTEM,
          prompt: text,
        });
        const repaired = repairResult.text;
        // If repair still leaks, fall through to safe natural fallback.
        text = hasNarrationLeak(repaired)
          ? "世界在继续运行。"
          : repaired;
      }

      // 3. Emit only validated, safe prose to onChunk.
      if (onChunk && text) {
        emitChunked(text, onChunk);
      }

      return text;
    },
  };
}

function emitChunked(text: string, onChunk: (chunk: string) => void): void {
  const chunkSize = 24;
  for (let i = 0; i < text.length; i += chunkSize) {
    onChunk(text.slice(i, i + chunkSize));
  }
}

export function stubNarrator(): Narrator {
  return {
    async project(envelope, onChunk) {
      const npc = envelope.npcReply ? `\n${envelope.npcReply.name}：「${envelope.npcReply.line}」` : "";
      // Stub: output in player-safe format without any Engine internals
      const text = `${envelope.playerContribution || "……"}${npc}`;
      if (onChunk && text) {
        emitChunked(text, onChunk);
      }
      return text;
    },
  };
}
