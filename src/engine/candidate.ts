import { z } from "zod";
import { KernelError } from "./errors.js";

const dateTime = z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)), {
  message: "must be a parseable date-time",
});

const base = {
  worldId: z.string().min(1),
  expectedWorldRevision: z.number().int().nonnegative(),
  occurredAt: dateTime,
  causeEventIds: z.array(z.string().min(1)).default([]),
};

const moveCandidate = z.object({
  ...base,
  type: z.literal("character.move"),
  actorId: z.string().min(1),
  toLocationId: z.string().min(1),
});

const dieCandidate = z.object({
  ...base,
  type: z.literal("character.die"),
  actorId: z.string().min(1),
});

const knowledgeSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("character"),
    characterId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("event"),
    eventId: z.string().min(1),
  }),
]);

const learnClaimCandidate = z.object({
  ...base,
  type: z.literal("character.learn_claim"),
  actorId: z.string().min(1),
  claimId: z.string().min(1),
  knowledgeState: z.enum(["unknown", "rumor", "suspected", "believed", "confirmed"]),
  source: knowledgeSource.optional(),
});

const relationshipCandidate = z
  .object({
    ...base,
    type: z.literal("relationship.change"),
    sourceCharacterId: z.string().min(1),
    targetCharacterId: z.string().min(1),
    trustDelta: z.number().int().min(-100).max(100).optional(),
    hostilityDelta: z.number().int().min(-100).max(100).optional(),
    closenessDelta: z.number().int().min(-100).max(100).optional(),
    relationshipType: z.string().min(1).optional(),
  })
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

const factCandidate = z.object({
  ...base,
  type: z.literal("fact.assert"),
  factId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFrom: dateTime,
  validTo: dateTime.optional(),
});

const claimRecordCandidate = z.object({
  ...base,
  type: z.literal("claim.record"),
  claimId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
});

const timeAdvanceCandidate = z.object({
  ...base,
  type: z.literal("world.time_advance"),
  toTime: dateTime,
});

export const candidateSchema = z.discriminatedUnion("type", [
  moveCandidate,
  dieCandidate,
  learnClaimCandidate,
  relationshipCandidate,
  factCandidate,
  claimRecordCandidate,
  timeAdvanceCandidate,
]);

export type CandidateEvent = z.infer<typeof candidateSchema>;

export function parseCandidate(input: unknown): CandidateEvent {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) {
    throw new KernelError("VALIDATION_FAILED", "Candidate Event does not match the supported schema", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function normalizeTime(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new KernelError("INVALID_TIME", "Candidate contains an invalid time", { value });
  }
  return new Date(milliseconds).toISOString();
}
