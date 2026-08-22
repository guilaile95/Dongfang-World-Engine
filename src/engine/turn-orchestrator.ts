import type { CharacterContext, BuildCharacterContextInput } from "./context-builder.js";
import { candidateProposalSchema, type CandidateProposal, type SimulationPlan, type SimulationRequest } from "./simulation-adapter.js";
import { KernelError } from "./errors.js";
import type { CommitResult } from "./commit-kernel.js";
import type { CandidateEvent } from "./candidate.js";
import type { CommittedEvent, WorldSnapshot } from "../domain/types.js";

export interface RunActorTurnInput {
  worldId: string;
  actorCharacterId: string;
  intent: string;
  contextBudget?: number;
}

export interface TurnContextBuilder {
  buildCharacterContext(input: BuildCharacterContextInput): CharacterContext;
}

export interface TurnSimulationAdapter {
  generate(request: SimulationRequest): Promise<SimulationPlan>;
}

export interface TurnStateReader {
  getSnapshot(worldId: string): WorldSnapshot;
}

export interface TurnCommitKernel {
  commit(input: unknown): CommitResult;
}

export interface TurnOrchestratorDependencies {
  stateReader: TurnStateReader;
  contextBuilder: TurnContextBuilder;
  simulationAdapter: TurnSimulationAdapter;
  commitKernel: TurnCommitKernel;
}

export const DEFAULT_MAX_PROPOSALS_PER_TURN = 8;

export interface TurnOrchestratorOptions {
  maxProposalsPerTurn?: number;
}

export type TurnStatus = "empty" | "success" | "rejected" | "partial" | "stale";

export type TurnRejectionKind =
  | "context"
  | "simulation"
  | "proposal_invalid"
  | "execution_limit"
  | "stale_context"
  | "kernel_rejection"
  | "stale_after_partial"
  | "world_read";

export interface TurnRejection {
  kind: TurnRejectionKind;
  code: string;
  message: string;
  proposalIndex: number | null;
}

export interface TurnResult {
  status: TurnStatus;
  worldId: string;
  actorCharacterId: string;
  committedEvents: CommittedEvent[];
  state: WorldSnapshot | null;
  rejection: TurnRejection | null;
  contextBuilds: number;
  simulationAttempts: number;
}

interface ExecutionSuccess {
  kind: "complete";
  committedEvents: CommittedEvent[];
  state: WorldSnapshot | null;
}

interface ExecutionRejection {
  kind: "rejected";
  rejection: TurnRejection;
  committedEvents: CommittedEvent[];
  state: WorldSnapshot | null;
}

interface ExecutionStaleBeforeCommit {
  kind: "stale_before_commit";
}

type ExecutionResult = ExecutionSuccess | ExecutionRejection | ExecutionStaleBeforeCommit;

interface PlanValidationSuccess {
  ok: true;
  proposals: CandidateProposal[];
}

interface PlanValidationFailure {
  ok: false;
  rejection: TurnRejection;
}

type PlanValidationResult = PlanValidationSuccess | PlanValidationFailure;

export class TurnOrchestrator {
  private readonly maxProposalsPerTurn: number;

  public constructor(
    private readonly dependencies: TurnOrchestratorDependencies,
    options: TurnOrchestratorOptions = {},
  ) {
    const maxProposalsPerTurn = options.maxProposalsPerTurn ?? DEFAULT_MAX_PROPOSALS_PER_TURN;
    if (!Number.isSafeInteger(maxProposalsPerTurn) || maxProposalsPerTurn < 1) {
      throw new RangeError("maxProposalsPerTurn must be a positive safe integer");
    }
    this.maxProposalsPerTurn = maxProposalsPerTurn;
  }

  public async runActorTurn(input: RunActorTurnInput): Promise<TurnResult> {
    let contextBuilds = 0;
    let simulationAttempts = 0;
    let staleRetryUsed = false;

    while (true) {
      let context: CharacterContext;
      try {
        context = this.dependencies.contextBuilder.buildCharacterContext({
          worldId: input.worldId,
          observerCharacterId: input.actorCharacterId,
          ...(input.contextBudget === undefined ? {} : { budget: input.contextBudget }),
        });
        contextBuilds += 1;
      } catch (error) {
        return this.resultForFailure(
          input,
          "rejected",
          toRejection("context", error, null),
          [],
          this.readState(input.worldId),
          contextBuilds,
          simulationAttempts,
        );
      }

      let rawPlan: unknown;
      try {
        simulationAttempts += 1;
        rawPlan = await this.dependencies.simulationAdapter.generate({
          context,
          actorCharacterId: input.actorCharacterId,
          intent: input.intent,
        });
      } catch (error) {
        return this.resultForFailure(
          input,
          "rejected",
          toRejection("simulation", error, null),
          [],
          this.readState(input.worldId),
          contextBuilds,
          simulationAttempts,
        );
      }

      if (!isRecord(rawPlan) || !Array.isArray(rawPlan.proposals)) {
        return this.resultForFailure(
          input,
          "rejected",
          {
            kind: "simulation",
            code: "MODEL_OUTPUT_INVALID",
            message: "Simulation plan proposals must be an array",
            proposalIndex: null,
          },
          [],
          this.readState(input.worldId),
          contextBuilds,
          simulationAttempts,
        );
      }

      const planValidation = this.validatePlan(rawPlan.proposals, input.actorCharacterId);
      if (!planValidation.ok) {
        return this.resultForFailure(
          input,
          "rejected",
          planValidation.rejection,
          [],
          this.readState(input.worldId),
          contextBuilds,
          simulationAttempts,
        );
      }

      if (planValidation.proposals.length === 0) {
        return {
          status: "empty",
          worldId: input.worldId,
          actorCharacterId: input.actorCharacterId,
          committedEvents: [],
          state: this.readState(input.worldId),
          rejection: null,
          contextBuilds,
          simulationAttempts,
        };
      }

      const beforeCommitState = this.readState(input.worldId);
      if (!beforeCommitState) {
        return this.resultForFailure(
          input,
          "rejected",
          {
            kind: "world_read",
            code: "WORLD_NOT_FOUND",
            message: "World could not be read before the first proposal commit",
            proposalIndex: 0,
          },
          [],
          null,
          contextBuilds,
          simulationAttempts,
        );
      }
      if (beforeCommitState.world.revision !== context.world.revision) {
        if (!staleRetryUsed) {
          staleRetryUsed = true;
          continue;
        }
        return this.resultForFailure(
          input,
          "stale",
          {
            kind: "stale_context",
            code: "STALE_CONTEXT",
            message: "World changed again before the first proposal commit",
            proposalIndex: 0,
          },
          [],
          beforeCommitState,
          contextBuilds,
          simulationAttempts,
        );
      }

      const execution = this.executePlan(
        input,
        planValidation.proposals,
        context.world.revision,
        beforeCommitState,
      );
      if (execution.kind === "stale_before_commit") {
        if (!staleRetryUsed) {
          staleRetryUsed = true;
          continue;
        }
        return this.resultForFailure(
          input,
          "stale",
          {
            kind: "stale_context",
            code: "STALE_CONTEXT",
            message: "The first proposal became stale before commit after the retry budget was exhausted",
            proposalIndex: 0,
          },
          [],
          this.readState(input.worldId),
          contextBuilds,
          simulationAttempts,
        );
      }
      if (execution.kind === "rejected") {
        const status: TurnStatus = execution.committedEvents.length === 0 ? "rejected" : "partial";
        return this.resultForFailure(
          input,
          status,
          execution.rejection,
          execution.committedEvents,
          execution.state,
          contextBuilds,
          simulationAttempts,
        );
      }
      return {
        status: "success",
        worldId: input.worldId,
        actorCharacterId: input.actorCharacterId,
        committedEvents: execution.committedEvents,
        state: execution.state,
        rejection: null,
        contextBuilds,
        simulationAttempts,
      };
    }
  }

  private validatePlan(proposals: unknown[], actorCharacterId: string): PlanValidationResult {
    if (proposals.length > this.maxProposalsPerTurn) {
      return {
        ok: false,
        rejection: {
          kind: "execution_limit",
          code: "PROPOSAL_LIMIT_EXCEEDED",
          message: `Turn contains ${proposals.length} proposals; the maximum is ${this.maxProposalsPerTurn}`,
          proposalIndex: null,
        },
      };
    }

    const parsedProposals: CandidateProposal[] = [];
    let firstRejection: TurnRejection | null = null;
    for (const [proposalIndex, proposal] of proposals.entries()) {
      const parsedProposal = candidateProposalSchema.safeParse(proposal);
      if (!parsedProposal.success) {
        firstRejection ??= {
          kind: "proposal_invalid",
          code: "MODEL_OUTPUT_INVALID",
          message: "Simulation proposal failed the actor proposal schema",
          proposalIndex,
        };
        continue;
      }
      if (!isActorOwnedProposal(parsedProposal.data, actorCharacterId)) {
        firstRejection ??= {
          kind: "proposal_invalid",
          code: "MODEL_OUTPUT_INVALID",
          message: "Simulation proposal is not attributed to the turn actor",
          proposalIndex,
        };
        continue;
      }
      parsedProposals.push(parsedProposal.data);
    }

    return firstRejection
      ? { ok: false, rejection: firstRejection }
      : { ok: true, proposals: parsedProposals };
  }

  private executePlan(
    input: RunActorTurnInput,
    proposals: CandidateProposal[],
    initialRevision: number,
    initialState: WorldSnapshot,
  ): ExecutionResult {
    const committedEvents: CommittedEvent[] = [];
    let expectedRevision = initialRevision;
    let lastState: WorldSnapshot | null = initialState;

    for (const [proposalIndex, proposal] of proposals.entries()) {
      const authoritativeState = proposalIndex === 0
        ? initialState
        : this.readState(input.worldId);
      if (!authoritativeState) {
        return {
          kind: "rejected",
          rejection: {
            kind: "world_read",
            code: "WORLD_NOT_FOUND",
            message: "World could not be read before a proposal commit",
            proposalIndex,
          },
          committedEvents,
          state: lastState,
        };
      }

      const candidate = bindTrustedCandidate(
        proposal,
        input.worldId,
        expectedRevision,
        authoritativeState.world.currentTime,
      );
      const result = this.dependencies.commitKernel.commit(candidate);
      if (!result.ok) {
        if (result.error.code === "STALE_WORLD_STATE" && committedEvents.length === 0 && proposalIndex === 0) {
          return { kind: "stale_before_commit" };
        }
        return {
          kind: "rejected",
          rejection: {
            kind: result.error.code === "STALE_WORLD_STATE" ? "stale_after_partial" : "kernel_rejection",
            code: result.error.code,
            message: result.error.message,
            proposalIndex,
          },
          committedEvents,
          state: lastState,
        };
      }

      committedEvents.push(result.event);
      expectedRevision = result.event.worldRevision;
      lastState = result.state;
    }

    return { kind: "complete", committedEvents, state: lastState };
  }

  private resultForFailure(
    input: RunActorTurnInput,
    status: TurnStatus,
    rejection: TurnRejection,
    committedEvents: CommittedEvent[],
    state: WorldSnapshot | null,
    contextBuilds: number,
    simulationAttempts: number,
  ): TurnResult {
    return {
      status,
      worldId: input.worldId,
      actorCharacterId: input.actorCharacterId,
      committedEvents,
      state,
      rejection,
      contextBuilds,
      simulationAttempts,
    };
  }

  private readState(worldId: string): WorldSnapshot | null {
    try {
      return this.dependencies.stateReader.getSnapshot(worldId);
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindTrustedCandidate(
  proposal: CandidateProposal,
  worldId: string,
  expectedWorldRevision: number,
  occurredAt: string,
): CandidateEvent {
  return {
    ...proposal,
    worldId,
    expectedWorldRevision,
    occurredAt,
    causeEventIds: [],
  } as CandidateEvent;
}

function isActorOwnedProposal(proposal: CandidateProposal, actorCharacterId: string): boolean {
  switch (proposal.type) {
    case "character.move":
    case "character.die":
    case "character.learn_claim":
    case "claim.record":
      return proposal.actorId === actorCharacterId;
    case "relationship.change":
      return proposal.sourceCharacterId === actorCharacterId;
    case "world.time_advance":
      return true;
  }
}

function toRejection(kind: TurnRejectionKind, error: unknown, proposalIndex: number | null): TurnRejection {
  if (error instanceof KernelError) {
    return { kind, code: error.code, message: error.message, proposalIndex };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { kind, code: error.code, message: error.message, proposalIndex };
  }
  if (error instanceof Error) {
    return { kind, code: "SIMULATION_ERROR", message: error.message, proposalIndex };
  }
  return { kind, code: "SIMULATION_ERROR", message: "Unknown Turn failure", proposalIndex };
}
