import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, streamText } from "ai";
import type { AppConfig } from "../config.js";
import type { ModelDriver, TokenUsage } from "./types.js";

export function createAiSdkDriver(config: AppConfig): ModelDriver {
  const provider = createOpenAICompatible({
    name: "dwe",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  return {
    async stream(input) {
      const result = streamText({
        model: provider.chatModel(input.model),
        system: input.system,
        prompt: input.prompt,
        maxRetries: 0,
        timeout: config.timeoutMs,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });
      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
        input.onChunk?.(chunk);
      }
      return { text, usage: toUsage(await result.usage) };
    },

    async generateObject(input) {
      const result = await generateText({
        model: provider.chatModel(input.model),
        system: input.system,
        prompt: input.prompt,
        output: Output.object({ schema: input.schema }),
        maxRetries: 0,
        timeout: config.timeoutMs,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });
      return { object: await result.output, usage: toUsage(result.usage) };
    },

    async generateText(input) {
      const result = await generateText({
        model: provider.chatModel(input.model),
        system: input.system,
        prompt: input.prompt,
        maxRetries: 0,
        timeout: config.timeoutMs,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });
      return { text: result.text, usage: toUsage(result.usage) };
    },
  };
}

function toUsage(usage: { inputTokens: number | undefined; outputTokens: number | undefined }): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
  };
}
