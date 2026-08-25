import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";
import type { NarratorEnvelope } from "./envelope.js";
import {
  hasNarrationLeak,
  hasPerspectiveViolation,
  NARRATOR_SYSTEM,
  OPENING_SYSTEM,
  parseOpeningOutput,
  renderNarratorPrompt,
  renderOpeningPrompt,
  type OpeningPromptInput,
  type ParsedOpening,
} from "./project.js";

export interface Narrator {
  project(envelope: NarratorEnvelope, onChunk?: (text: string) => void): Promise<string>;
  projectOpening?(input: OpeningPromptInput, onChunk?: (text: string) => void): Promise<ParsedOpening>;
}

const REPAIR_SYSTEM =
  "你的任务：把下面的段落重写成干净的故事文本，不改变任何已发生的事，只改变表达方式。" +
  "严禁出现：Authority、Candidate、Revision、权威层、非权威、Context、数据库、B层、C层、S层、当前状态、最近场景，或任何内部技术字段名。" +
  "必须严格使用第二人称「你」来叙述玩家，严禁在正文中使用第三人称描写玩家。" +
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

    async projectOpening(input, onChunk) {
      const prompt = renderOpeningPrompt(input);
      assertNoSecret(prompt, apiKey, "opening prompt");

      const result = await client.stream({
        role: "narrator",
        purpose: "narrator-opening",
        system: OPENING_SYSTEM,
        prompt,
      });
      let text = result.text;

      if (hasNarrationLeak(text) || hasPerspectiveViolation(text, input.profile.name)) {
        const repairResult = await client.stream({
          role: "narrator",
          purpose: "narrator-repair",
          system: REPAIR_SYSTEM,
          prompt: text,
        });
        const repaired = repairResult.text;
        text = hasNarrationLeak(repaired)
          ? "暴雨拍打着窗户，周围的人各自忙碌着。你坐在原地，感到有什么事情正在悄然发生。"
          : repaired;
      }

      const parsed = parseOpeningOutput(text, input.locationName);

      if (onChunk && parsed.narrative) {
        emitChunked(parsed.narrative, onChunk);
      }

      return parsed;
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

    async projectOpening(input, onChunk) {
      const narrative = `你站在${input.locationName}，天色渐晚，四周传来人们低语的声音。街道新闻还在滚动播报着最近几起尚未结案的失踪事件，气氛透着一丝不同寻常的紧绷。`;
      const currentSituation = `眼下：你身处${input.locationName}，周围正议论着城里的失踪事件。`;
      const suggestions: import("../http/view.js").ActionSuggestion[] = [
        { key: "A", label: "主动打听最近的失踪事件详情", type: "constructive" },
        { key: "B", label: "仔细观察在场人员的举止表情", type: "constructive" },
        { key: "C", label: "拿出自己的随身物品检查一番", type: "constructive" },
        { key: "D", label: `收拾好东西，离开${input.locationName}`, type: "constructive" },
        { key: "E", label: "大声询问是否有人知道失踪案线索", type: "extreme" },
        { key: "F", label: "凑到旁人身边故作神秘地问「你也听说外星人了吗」", type: "absurd" },
      ];
      if (onChunk) {
        emitChunked(narrative, onChunk);
      }
      return { narrative, currentSituation, suggestions };
    },
  };
}
