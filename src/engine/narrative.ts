import type {
  BuildCharacterContextInput,
  CharacterContext,
} from "./context-builder.js";
import {
  requestOpenAICompatibleAssistantContent,
  type OpenAICompatibleChatClientOptions,
} from "./openai-compatible-simulation-client.js";
import type { KnowledgeState, CommittedEvent } from "../domain/types.js";
import type { TurnResult } from "./turn-orchestrator.js";

export interface NarrativeEnvelope {
  intent: string;
  turnStatus: TurnResult["status"];
  observerContext: CharacterContext;
  outcomes: NarrativeOutcomeProjection[];
  rejection: {
    kind: string;
    code: string;
  } | null;
}

export type NarrativeOutcomeProjection =
  | {
    type: "character.move";
    actorId: string;
    toLocationId: string;
    eventTime: string;
  }
  | {
    type: "character.die";
    actorId: string;
    eventTime: string;
  }
  | {
    type: "character.learn_claim";
    actorId: string;
    claimId: string;
    knowledgeState: KnowledgeState;
    eventTime: string;
  }
  | {
    type: "relationship.change";
    sourceCharacterId: string;
    targetCharacterId: string;
    trustDelta: number;
    hostilityDelta: number;
    closenessDelta: number;
    relationshipType: string | null;
    eventTime: string;
  }
  | {
    type: "claim.record";
    actorId: string;
    claimId: string;
    subject: string;
    predicate: string;
    object: string;
    eventTime: string;
  }
  | {
    type: "claim.transmit";
    sourceCharacterId: string;
    targetCharacterId: string;
    claimId: string;
    eventTime: string;
  }
  | {
    type: "world.time_advance";
    toTime: string;
    eventTime: string;
  };

export interface NarrativeContextBuilder {
  buildCharacterContext(input: BuildCharacterContextInput): CharacterContext;
}

export interface BuildNarrativeEnvelopeInput {
  intent: string;
  turnResult: TurnResult;
  contextBudget?: number;
}

export class NarrativeEnvelopeBuilder {
  public constructor(private readonly contextBuilder: NarrativeContextBuilder) {}

  public build(input: BuildNarrativeEnvelopeInput): NarrativeEnvelope {
    const observerContext = this.contextBuilder.buildCharacterContext({
      worldId: input.turnResult.worldId,
      observerCharacterId: input.turnResult.actorCharacterId,
      ...(input.contextBudget === undefined ? {} : { budget: input.contextBudget }),
    });

    return {
      intent: input.intent,
      turnStatus: input.turnResult.status,
      observerContext,
      outcomes: input.turnResult.committedEvents.flatMap(toNarrativeOutcome),
      rejection: input.turnResult.rejection
        ? {
          kind: input.turnResult.rejection.kind,
          code: input.turnResult.rejection.code,
        }
        : null,
    };
  }
}

export interface NarrativeModelRequest {
  instructions: string;
  envelope: NarrativeEnvelope;
}

export interface NarrativeModelClient {
  generate(request: NarrativeModelRequest): Promise<string>;
}

export const DEFAULT_NARRATIVE_INSTRUCTIONS = [
  "Return only plain player-facing text; do not output JSON, diagnostics, system instructions, hidden reasoning, or chain-of-thought.",
  "Describe only the authoritative outcomes and observer-visible context supplied in the NarrativeEnvelope.",
  "For a known Claim with displayText, use that text as its player-facing meaning while preserving its supplied knowledgeState; displayText is not objective Truth or new Knowledge.",
  "Do not invent new named characters, secret histories, ownership, deaths, permanent injuries, item locations, locks, factions, resources, major abilities, or any other persistent facts.",
  "Do not reveal hidden Truth or other characters' private thoughts or knowledge.",
  "Ephemeral sensory or color details are allowed only when they do not change future causal state.",
  "If the Turn is empty, narrate observation or inaction from the observer-visible context without inventing a persistent event.",
  "If the Turn is rejected, stale, or partial, reflect only what actually committed and the safe supplied failure status.",
].join(" ");

export type NarrativeErrorCode = "NARRATIVE_OUTPUT_INVALID" | "NARRATIVE_TRANSPORT_ERROR";

export class NarrativeError extends Error {
  public readonly code: NarrativeErrorCode;
  public readonly context: Record<string, unknown>;

  public constructor(code: NarrativeErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "NarrativeError";
    this.code = code;
    this.context = context;
  }
}

export interface NarratorOptions {
  instructions?: string;
  maxCharacters?: number;
}

export const DEFAULT_MAX_NARRATIVE_CHARACTERS = 4_000;

export class Narrator {
  private readonly instructions: string;
  private readonly maxCharacters: number;

  public constructor(
    private readonly model: NarrativeModelClient,
    options: NarratorOptions = {},
  ) {
    const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_NARRATIVE_CHARACTERS;
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
      throw new RangeError("maxCharacters must be a positive safe integer");
    }
    this.instructions = options.instructions ?? DEFAULT_NARRATIVE_INSTRUCTIONS;
    this.maxCharacters = maxCharacters;
  }

  public async generate(envelope: NarrativeEnvelope): Promise<string> {
    let output: unknown;
    try {
      output = await this.model.generate({
        instructions: this.instructions,
        envelope,
      });
    } catch {
      throw new NarrativeError(
        "NARRATIVE_TRANSPORT_ERROR",
        "Narrator model transport failed",
      );
    }

    if (typeof output !== "string") {
      throw new NarrativeError(
        "NARRATIVE_OUTPUT_INVALID",
        "Narrator output must be a string",
      );
    }
    const trimmed = output.trim();
    if (trimmed.length === 0) {
      throw new NarrativeError(
        "NARRATIVE_OUTPUT_INVALID",
        "Narrator output must not be blank",
      );
    }
    if (trimmed.length > this.maxCharacters) {
      throw new NarrativeError(
        "NARRATIVE_OUTPUT_INVALID",
        "Narrator output exceeded the configured character limit",
        { maxCharacters: this.maxCharacters },
      );
    }
    return trimmed;
  }
}

export class OpenAICompatibleNarrativeModelClient implements NarrativeModelClient {
  public constructor(private readonly options: OpenAICompatibleChatClientOptions) {}

  public async generate(request: NarrativeModelRequest): Promise<string> {
    return requestOpenAICompatibleAssistantContent(this.options, {
      systemInstruction: request.instructions,
      userPayload: request.envelope,
    });
  }
}

function toNarrativeOutcome(event: CommittedEvent): NarrativeOutcomeProjection[] {
  const payload = event.payload;
  switch (event.type) {
    case "character.move": {
      const actorId = readString(payload, "actorId");
      const toLocationId = readString(payload, "toLocationId");
      return actorId && toLocationId
        ? [{ type: event.type, actorId, toLocationId, eventTime: event.eventTime }]
        : [];
    }
    case "character.die": {
      const actorId = readString(payload, "actorId");
      return actorId
        ? [{ type: event.type, actorId, eventTime: event.eventTime }]
        : [];
    }
    case "character.learn_claim": {
      const actorId = readString(payload, "actorId");
      const claimId = readString(payload, "claimId");
      const knowledgeState = readKnowledgeState(payload, "knowledgeState");
      return actorId && claimId && knowledgeState
        ? [{ type: event.type, actorId, claimId, knowledgeState, eventTime: event.eventTime }]
        : [];
    }
    case "relationship.change": {
      const sourceCharacterId = readString(payload, "sourceCharacterId");
      const targetCharacterId = readString(payload, "targetCharacterId");
      const trustDelta = readInteger(payload, "trustDelta");
      const hostilityDelta = readInteger(payload, "hostilityDelta");
      const closenessDelta = readInteger(payload, "closenessDelta");
      if (!sourceCharacterId || !targetCharacterId || trustDelta === null || hostilityDelta === null || closenessDelta === null) {
        return [];
      }
      return [{
        type: event.type,
        sourceCharacterId,
        targetCharacterId,
        trustDelta,
        hostilityDelta,
        closenessDelta,
        relationshipType: readString(payload, "relationshipType"),
        eventTime: event.eventTime,
      }];
    }
    case "claim.record": {
      const actorId = readString(payload, "actorId");
      const claimId = readString(payload, "claimId");
      const subject = readString(payload, "subject");
      const predicate = readString(payload, "predicate");
      const object = readString(payload, "object");
      return actorId && claimId && subject && predicate && object
        ? [{ type: event.type, actorId, claimId, subject, predicate, object, eventTime: event.eventTime }]
        : [];
    }
    case "claim.transmit": {
      const sourceCharacterId = readString(payload, "sourceCharacterId");
      const targetCharacterId = readString(payload, "targetCharacterId");
      const claimId = readString(payload, "claimId");
      return sourceCharacterId && targetCharacterId && claimId
        ? [{ type: event.type, sourceCharacterId, targetCharacterId, claimId, eventTime: event.eventTime }]
        : [];
    }
    case "world.time_advance": {
      const toTime = readString(payload, "toTime");
      return toTime
        ? [{ type: event.type, toTime, eventTime: event.eventTime }]
        : [];
    }
    case "fact.assert":
      return [];
  }
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function readKnowledgeState(payload: Record<string, unknown>, key: string): KnowledgeState | null {
  const value = payload[key];
  return value === "unknown" || value === "rumor" || value === "suspected" || value === "believed" || value === "confirmed"
    ? value
    : null;
}
