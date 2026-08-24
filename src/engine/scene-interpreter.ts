import type { CharacterContext } from "./context-builder.js";
import {
  sceneTurnPlanSchema,
  type SceneTurnPlanDraft,
} from "./scene-turn.js";
import {
  SimulationAdapterError,
  type SimulationModelClient,
  type SimulationModelRequest,
} from "./simulation-adapter.js";

export interface SceneInterpretationRequest {
  context: CharacterContext;
  actorCharacterId: string;
  intent: string;
}

export const DEFAULT_SCENE_INTERPRETER_INSTRUCTIONS = [
  "Return exactly one JSON object. Return JSON only: no markdown, prose, comments, or hidden reasoning.",
  "Shape: {\"channel\":\"in_world|ooc_meta\",\"ephemeralBeats\":[...],\"targetedStimuli\":[...],\"persistentCandidates\":[...],\"unsupportedMaterial\":[...],\"timePolicy\":{\"kind\":\"none\"}|{\"kind\":\"consume_scene_time\",\"minutes\":1-60}}.",
  "You are a lane router, not a narrator. Do not invent scene prose. Do not emit a summary field or any rewritten description of what happened.",
  "ephemeralBeats items are {\"surface\":\"exact substring of the player intent\",\"kind\":\"mundane_action|observation|remain_in_place|refusal|other_low_causal\"}. surface must be copied from the player intent; never rewrite it (for example never replace 我去地窖 with 你走进了地窖).",
  "Use ephemeralBeats for low-causal action, observation, remaining in place, or refusal. Do not use them to complete location change, death, items, relationships, knowledge, permissions, or world time.",
  "persistentCandidates use only the seven actor Proposal types and exact fields already documented for actor proposals. actorId or sourceCharacterId must equal context.observer.id. Never emit fact.assert, worldId, expectedWorldRevision, occurredAt, or causeEventIds.",
  "Do not emit character.move unless the player intent requests movement. Do not substitute an unrelated legal persistent action. When uncertain, persistentCandidates must be [].",
  "A question to a character is targetedStimuli with speechAct=ask, not claim.transmit. Telling a known Claim may use speechAct=tell plus claim.transmit.",
  "Do not emit claim.record. Do not persist speech.",
  "timePolicy consume_scene_time only when the resolved scene itself consumes time (for example an ordinary meal). Observation, refusal, remain-in-place, co-located questions, and OOC use {\"kind\":\"none\"}. Do not put world.time_advance in persistentCandidates.",
  "channel ooc_meta for out-of-character / meta input. Leading /ooc is always OOC.",
].join(" ");

export class SceneInterpreter {
  private readonly modelId: string;
  private readonly instructions: string;

  public constructor(
    private readonly model: SimulationModelClient,
    options: { modelId?: string; instructions?: string } = {},
  ) {
    this.modelId = options.modelId ?? "injected-model";
    this.instructions = options.instructions ?? DEFAULT_SCENE_INTERPRETER_INSTRUCTIONS;
  }

  public async interpret(request: SceneInterpretationRequest): Promise<SceneTurnPlanDraft> {
    if (request.actorCharacterId !== request.context.observer.id) {
      throw new SimulationAdapterError(
        "INVALID_REQUEST",
        "Scene actor must match the Context observer",
        {
          modelId: this.modelId,
          attempts: 0,
          proposalCount: 0,
          errorCategory: "request",
        },
      );
    }
    if (typeof request.intent !== "string" || request.intent.trim().length === 0) {
      throw new SimulationAdapterError(
        "INVALID_REQUEST",
        "Scene intent must not be blank",
        {
          modelId: this.modelId,
          attempts: 0,
          proposalCount: 0,
          errorCategory: "request",
        },
      );
    }

    let lastReason = "The previous model output failed schema validation.";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const modelRequest: SimulationModelRequest = {
        context: request.context,
        intent: request.intent,
        instructions: this.instructions,
        attempt,
        ...(attempt === 2 ? { repair: { reason: lastReason } } : {}),
      };
      let rawOutput: unknown;
      try {
        rawOutput = await this.model.generate(modelRequest);
      } catch {
        throw new SimulationAdapterError(
          "MODEL_TRANSPORT_ERROR",
          "Scene interpreter model transport failed",
          {
            modelId: this.modelId,
            attempts: attempt,
            proposalCount: 0,
            errorCategory: "transport",
          },
        );
      }
      const parsed = parseSceneTurnPlanDraft(rawOutput);
      if (parsed.ok) {
        return parsed.data;
      }
      lastReason = parsed.reason;
      if (attempt === 2) {
        throw new SimulationAdapterError(
          "MODEL_OUTPUT_INVALID",
          `Scene interpreter output remained invalid after one repair attempt: ${parsed.reason}`,
          {
            modelId: this.modelId,
            attempts: attempt,
            proposalCount: 0,
            errorCategory: "schema",
          },
        );
      }
    }
    throw new SimulationAdapterError(
      "MODEL_OUTPUT_INVALID",
      "Scene interpreter output could not be parsed",
      {
        modelId: this.modelId,
        attempts: 2,
        proposalCount: 0,
        errorCategory: "schema",
      },
    );
  }
}

export function parseSceneTurnPlanDraft(
  rawOutput: unknown,
): { ok: true; data: SceneTurnPlanDraft } | { ok: false; reason: string } {
  let decoded: unknown = rawOutput;
  if (typeof rawOutput === "string") {
    try {
      decoded = JSON.parse(rawOutput) as unknown;
    } catch {
      return { ok: false, reason: "Model output was not valid JSON" };
    }
  }
  const parsed = sceneTurnPlanSchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: issue ? `${issue.path.join(".") || "$"}: ${issue.message}` : "Scene turn plan failed schema validation",
    };
  }
  return { ok: true, data: parsed.data };
}
