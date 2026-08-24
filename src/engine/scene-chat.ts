import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CharacterContext } from "./context-builder.js";

export interface SceneChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface ModelFacingContext {
  rules: string[];
  plotStage: string | null;
  plotThreads: Array<{
    id: string;
    predicate: string;
    object: string;
    displayText: string;
  }>;
  observer: CharacterContext;
}

export const SCENE_CHAT_INSTRUCTIONS = [
  "You are the scene narrator of a persistent Chinese text roleplay.",
  "The player talks in freeform chat. Never reject the line as an unknown action type.",
  "Never ask the player to pick from an engine verb menu or proposal list.",
  "The world does not orbit the player. If they eat, wander, or chat off-plot, NPCs and authored plot threads still continue from world state.",
  "Do not reveal hidden world facts that are absent from observer knowledge and plotThreads.",
  "Reply with scene prose in Chinese only. No JSON. No markdown fences.",
].join(" ");

export async function generateSceneReply(
  config: SceneChatConfig,
  context: ModelFacingContext,
  playerLine: string,
): Promise<string> {
  const provider = createOpenAICompatible({
    name: "dongfang-world-engine",
    baseURL: config.baseUrl.replace(/\/+$/, ""),
    apiKey: config.apiKey,
    ...(config.fetchImpl ? { fetch: config.fetchImpl } : {}),
  });
  const { text } = await generateText({
    model: provider.chatModel(config.model),
    system: [
      SCENE_CHAT_INSTRUCTIONS,
      "World rules:",
      ...context.rules.map((rule) => `- ${rule}`),
      `Plot stage: ${context.plotStage ?? "unknown"}`,
      "Authored plot threads (independent of the player's last line):",
      ...context.plotThreads.map((thread) => `- ${thread.displayText}`),
      "Observer-safe context JSON:",
      JSON.stringify(toSafeObserverPayload(context.observer)),
    ].join("\n"),
    prompt: playerLine,
    maxRetries: 0,
  });
  const sceneReply = sanitizeTerminalText(text);
  if (!sceneReply.trim()) {
    throw new Error("SCENE_REPLY_EMPTY");
  }
  return sceneReply;
}

function toSafeObserverPayload(observer: CharacterContext): unknown {
  return {
    world: observer.world,
    observer: {
      id: observer.observer.id,
      name: observer.observer.name,
      type: observer.observer.type,
      alive: observer.observer.alive,
      locationId: observer.observer.locationId,
    },
    location: observer.location === null
      ? null
      : { id: observer.location.id, name: observer.location.name },
    coLocatedCharacters: observer.coLocatedCharacters,
    knowledge: observer.knowledge.map((bundle) => ({
      claim: bundle.claim,
      knowledgeState: bundle.knowledge.knowledgeState,
    })),
    relationships: observer.relationships,
  };
}

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}
