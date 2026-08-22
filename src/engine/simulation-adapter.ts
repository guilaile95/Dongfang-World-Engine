import { z } from "zod";
import type { CharacterContext } from "./context-builder.js";

const dateTime = z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)), {
  message: "must be a parseable date-time",
});

const knowledgeSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("character"),
    characterId: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("event"),
    eventId: z.string().min(1),
  }).strict(),
]);

const moveProposal = z.object({
  type: z.literal("character.move"),
  actorId: z.string().min(1),
  toLocationId: z.string().min(1),
}).strict();

const dieProposal = z.object({
  type: z.literal("character.die"),
  actorId: z.string().min(1),
}).strict();

const learnClaimProposal = z.object({
  type: z.literal("character.learn_claim"),
  actorId: z.string().min(1),
  claimId: z.string().min(1),
  knowledgeState: z.enum(["unknown", "rumor", "suspected", "believed", "confirmed"]),
  source: knowledgeSource.optional(),
}).strict();

const relationshipProposal = z
  .object({
    type: z.literal("relationship.change"),
    sourceCharacterId: z.string().min(1),
    targetCharacterId: z.string().min(1),
    trustDelta: z.number().int().min(-100).max(100).optional(),
    hostilityDelta: z.number().int().min(-100).max(100).optional(),
    closenessDelta: z.number().int().min(-100).max(100).optional(),
    relationshipType: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.trustDelta === undefined &&
      value.hostilityDelta === undefined &&
      value.closenessDelta === undefined &&
      value.relationshipType === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "at least one relationship change is required",
        path: ["relationshipType"],
      });
    }
  });

const claimProposal = z.object({
  type: z.literal("claim.record"),
  claimId: z.string().min(1),
  actorId: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
}).strict();

const timeAdvanceProposal = z.object({
  type: z.literal("world.time_advance"),
  toTime: dateTime,
}).strict();

export const candidateProposalSchema = z.discriminatedUnion("type", [
  moveProposal,
  dieProposal,
  learnClaimProposal,
  relationshipProposal,
  claimProposal,
  timeAdvanceProposal,
]);

export const simulationPlanSchema = z.object({
  proposals: z.array(candidateProposalSchema),
}).strict();

export type CandidateProposal = z.infer<typeof candidateProposalSchema>;

export interface SimulationRequest {
  context: CharacterContext;
  actorCharacterId: string;
  intent: string;
}

export interface SimulationModelRequest {
  context: CharacterContext;
  intent: string;
  instructions: string;
  attempt: number;
  repair?: {
    reason: string;
  };
}

export interface SimulationModelClient {
  generate(request: SimulationModelRequest): Promise<unknown>;
}

export interface SimulationDiagnostics {
  modelId: string;
  attempts: number;
  proposalCount: number;
  repaired: boolean;
  status: "success" | "empty";
}

export interface SimulationPlan {
  proposals: CandidateProposal[];
  diagnostics: SimulationDiagnostics;
}

export type SimulationAdapterErrorCode =
  | "INVALID_REQUEST"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_TRANSPORT_ERROR";

export interface SimulationAdapterErrorDiagnostics {
  modelId: string;
  attempts: number;
  proposalCount: number;
  errorCategory: "request" | "schema" | "transport";
}

export class SimulationAdapterError extends Error {
  public readonly code: SimulationAdapterErrorCode;
  public readonly context: Record<string, unknown>;
  public readonly diagnostics: SimulationAdapterErrorDiagnostics;

  public constructor(
    code: SimulationAdapterErrorCode,
    message: string,
    diagnostics: SimulationAdapterErrorDiagnostics,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SimulationAdapterError";
    this.code = code;
    this.context = context;
    this.diagnostics = diagnostics;
  }
}

export const DEFAULT_SIMULATION_INSTRUCTIONS = [
  "Return JSON only with the shape { proposals: [...] }.",
  "Use only the six actor-supported proposal types.",
  "Do not include worldId, expectedWorldRevision, occurredAt, or causeEventIds; the future Turn Orchestrator owns the Event envelope.",
  "Do not include prose, hidden reasoning, raw world data, or unrequested effects.",
].join(" ");

interface SimulationAdapterOptions {
  modelId?: string;
  instructions?: string;
}

class OutputValidationFailure extends Error {
  public readonly issueCount: number;

  public constructor(message: string, issueCount: number) {
    super(message);
    this.name = "OutputValidationFailure";
    this.issueCount = issueCount;
  }
}

export class SimulationAdapter {
  private readonly modelId: string;
  private readonly instructions: string;

  public constructor(
    private readonly model: SimulationModelClient,
    options: SimulationAdapterOptions = {},
  ) {
    this.modelId = options.modelId ?? "injected-model";
    this.instructions = options.instructions ?? DEFAULT_SIMULATION_INSTRUCTIONS;
  }

  public async generate(request: SimulationRequest): Promise<SimulationPlan> {
    this.validateRequest(request);

    let lastValidationFailure: OutputValidationFailure | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const modelRequest: SimulationModelRequest = attempt === 1
        ? {
          context: request.context,
          intent: request.intent,
          instructions: this.instructions,
          attempt,
        }
        : {
          context: request.context,
          intent: request.intent,
          instructions: this.instructions,
          attempt,
          repair: {
            reason: lastValidationFailure?.message ?? "The previous model output failed schema validation.",
          },
        };

      let rawOutput: unknown;
      try {
        rawOutput = await this.model.generate(modelRequest);
      } catch {
        throw new SimulationAdapterError(
          "MODEL_TRANSPORT_ERROR",
          "Simulation model transport failed",
          {
            modelId: this.modelId,
            attempts: attempt,
            proposalCount: 0,
            errorCategory: "transport",
          },
        );
      }

      try {
        const parsed = parseSimulationPlan(rawOutput);
        validateProposalActorAuthority(parsed.proposals, request.actorCharacterId);
        return {
          proposals: parsed.proposals,
          diagnostics: {
            modelId: this.modelId,
            attempts: attempt,
            proposalCount: parsed.proposals.length,
            repaired: attempt === 2,
            status: parsed.proposals.length === 0 ? "empty" : "success",
          },
        };
      } catch (error) {
        if (!(error instanceof OutputValidationFailure)) {
          throw error;
        }
        lastValidationFailure = error;
        if (attempt === 2) {
          throw new SimulationAdapterError(
            "MODEL_OUTPUT_INVALID",
            "Simulation model output remained invalid after one repair attempt",
            {
              modelId: this.modelId,
              attempts: attempt,
              proposalCount: 0,
              errorCategory: "schema",
            },
            { issueCount: error.issueCount },
          );
        }
      }
    }

    throw new SimulationAdapterError(
      "MODEL_OUTPUT_INVALID",
      "Simulation model output could not be parsed",
      {
        modelId: this.modelId,
        attempts: 2,
        proposalCount: 0,
        errorCategory: "schema",
      },
    );
  }

  public async simulate(request: SimulationRequest): Promise<SimulationPlan> {
    return this.generate(request);
  }

  private validateRequest(request: SimulationRequest): void {
    if (!request || !request.context || typeof request.context.observer?.id !== "string") {
      throw new SimulationAdapterError(
        "INVALID_REQUEST",
        "Simulation request must contain a CharacterContext",
        {
          modelId: this.modelId,
          attempts: 0,
          proposalCount: 0,
          errorCategory: "request",
        },
      );
    }
    if (request.actorCharacterId !== request.context.observer.id) {
      throw new SimulationAdapterError(
        "INVALID_REQUEST",
        "Simulation actor must match the Context observer",
        {
          modelId: this.modelId,
          attempts: 0,
          proposalCount: 0,
          errorCategory: "request",
        },
        {
          actorCharacterId: request.actorCharacterId,
          observerCharacterId: request.context.observer.id,
        },
      );
    }
    if (typeof request.intent !== "string" || request.intent.trim().length === 0) {
      throw new SimulationAdapterError(
        "INVALID_REQUEST",
        "Simulation intent must not be blank",
        {
          modelId: this.modelId,
          attempts: 0,
          proposalCount: 0,
          errorCategory: "request",
        },
      );
    }
  }
}

export function parseSimulationPlan(rawOutput: unknown): z.infer<typeof simulationPlanSchema> {
  let decoded: unknown = rawOutput;
  if (typeof rawOutput === "string") {
    try {
      decoded = JSON.parse(rawOutput) as unknown;
    } catch {
      throw new OutputValidationFailure("Model output was not valid JSON", 1);
    }
  }

  const parsed = simulationPlanSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new OutputValidationFailure("Model output failed deterministic schema validation", parsed.error.issues.length);
  }
  return parsed.data;
}

function validateProposalActorAuthority(proposals: CandidateProposal[], actorCharacterId: string): void {
  for (const proposal of proposals) {
    switch (proposal.type) {
      case "character.move":
      case "character.die":
      case "character.learn_claim":
        if (proposal.actorId !== actorCharacterId) {
          throw new OutputValidationFailure("Proposal actor must match the SimulationRequest actor", 1);
        }
        break;
      case "relationship.change":
        if (proposal.sourceCharacterId !== actorCharacterId) {
          throw new OutputValidationFailure("Relationship proposal source must match the SimulationRequest actor", 1);
        }
        break;
      case "claim.record":
        if (proposal.actorId !== actorCharacterId) {
          throw new OutputValidationFailure("Claim proposal actor must match the SimulationRequest actor", 1);
        }
        break;
      case "world.time_advance":
        break;
    }
  }
}
