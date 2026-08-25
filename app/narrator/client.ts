import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";
import type { NarratorEnvelope } from "./envelope.js";
import { NARRATOR_SYSTEM, renderNarratorPrompt } from "./project.js";

export interface Narrator {
  project(envelope: NarratorEnvelope, onChunk?: (text: string) => void): Promise<string>;
}

export function createNarrator(client: ModelClient, apiKey: string): Narrator {
  return {
    async project(envelope, onChunk) {
      const prompt = renderNarratorPrompt(envelope);
      assertNoSecret(prompt, apiKey, "narrator envelope");
      const result = await client.stream({
        role: "narrator",
        purpose: "narrator-projection",
        system: NARRATOR_SYSTEM,
        prompt,
        ...(onChunk ? { onChunk } : {}),
      });
      return result.text;
    },
  };
}

export function stubNarrator(): Narrator {
  return {
    async project(envelope, onChunk) {
      const npc = envelope.npcReply ? `\n${envelope.npcReply.name}：「${envelope.npcReply.line}」` : "";
      const text = `${envelope.observerContext}\n\n> ${envelope.playerContribution || "……"}${npc}`;
      onChunk?.(text);
      return text;
    },
  };
}
