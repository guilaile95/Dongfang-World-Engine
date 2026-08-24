import { randomUUID } from "node:crypto";
import { z } from "zod";
import { submitCandidates, submitEmptyProposal, type SubmitResult } from "../authority/commit.js";
import type { Candidate } from "../authority/candidate.js";
import type { WorldStore } from "../persist/store.js";

/** What the player was doing in the scene — labels, not an action menu. */
export const contributionKindSchema = z.enum([
  "low_causal",
  "observe",
  "refuse",
  "speak",
  "ask",
  "mixed",
  "world_attempt",
  "durable_attempt",
  "uncertain_attempt",
]);

export type ContributionKind = z.infer<typeof contributionKindSchema>;

const proposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("claim_record"),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  }),
  z.object({
    type: z.literal("memory_note"),
    text: z.string().min(1),
    characterId: z.string().min(1).optional(),
  }),
]);

export const interpretationSchema = z.object({
  contributions: z.array(contributionKindSchema).min(1),
  futureCausal: z.boolean(),
  outcome: z.enum(["ephemeral", "clarify", "fail", "candidate"]),
  proposals: z.array(proposalSchema).max(3),
});

export type SceneInterpretation = z.infer<typeof interpretationSchema>;

export interface BoundInterpretation {
  contributions: ContributionKind[];
  futureCausal: boolean;
  outcome: SceneInterpretation["outcome"];
  submitted: boolean;
  result: SubmitResult;
}

export function normalizeInterpretation(raw: unknown): SceneInterpretation {
  const parsed = interpretationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      contributions: ["uncertain_attempt"],
      futureCausal: false,
      outcome: "fail",
      proposals: [],
    };
  }
  const value = parsed.data;
  const allowWrite = value.outcome === "candidate" && value.futureCausal && value.proposals.length > 0;
  if (!allowWrite) {
    const outcome =
      value.outcome === "candidate" ? (value.futureCausal ? "fail" : "ephemeral") : value.outcome;
    return { ...value, futureCausal: false, outcome, proposals: [] };
  }
  return value;
}

/** Empty write is success. Never substitutes a different engine action. */
export function applyInterpretation(
  store: WorldStore,
  input: {
    worldId: string;
    playerId: string;
    interpretation: SceneInterpretation;
  },
): BoundInterpretation {
  const interpretation = normalizeInterpretation(input.interpretation);
  if (interpretation.outcome !== "candidate" || interpretation.proposals.length === 0) {
    return {
      contributions: interpretation.contributions,
      futureCausal: false,
      outcome: interpretation.outcome,
      submitted: false,
      result: submitEmptyProposal(store, input.worldId),
    };
  }
  const snapshot = store.snapshot(input.worldId);
  const candidates: Candidate[] = interpretation.proposals.map((proposal, index) => {
    if (proposal.type === "claim_record") {
      return {
        type: "claim_record",
        worldId: input.worldId,
        expectedRevision: snapshot.world.revision + index,
        claimId: `claim-${randomUUID()}`,
        subject: proposal.subject,
        predicate: proposal.predicate,
        object: proposal.object,
      };
    }
    return {
      type: "memory_note",
      worldId: input.worldId,
      expectedRevision: snapshot.world.revision + index,
      memoryId: `mem-${randomUUID()}`,
      characterId: proposal.characterId ?? input.playerId,
      text: proposal.text,
    };
  });
  const result = submitCandidates(store, { producer: "llm", candidates });
  return {
    contributions: interpretation.contributions,
    futureCausal: interpretation.futureCausal,
    outcome: result.accepted ? "candidate" : "fail",
    submitted: result.accepted,
    result,
  };
}

export function ephemeralInterpretation(): SceneInterpretation {
  return {
    contributions: ["low_causal"],
    futureCausal: false,
    outcome: "ephemeral",
    proposals: [],
  };
}
