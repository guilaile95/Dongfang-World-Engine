import { z } from "zod";
import type { Producer } from "./types.js";

const producerSchema = z.enum(["system", "llm"]);

const knowledgeSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), eventId: z.string().min(1) }),
  z.object({ kind: z.literal("character"), characterId: z.string().min(1) }),
  z.object({ kind: z.literal("seed"), seedId: z.string().min(1) }),
]);

const envelope = {
  worldId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
};

export const candidateSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelope,
    type: z.literal("fact_assert"),
    factId: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    validFrom: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("claim_record"),
    claimId: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("character_learn_claim"),
    characterId: z.string().min(1),
    claimId: z.string().min(1),
    knowledgeState: z.enum(["rumor", "believed", "confirmed"]),
    source: knowledgeSourceSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal("time_advance"),
    toTime: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("memory_note"),
    memoryId: z.string().min(1),
    characterId: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("character_move"),
    characterId: z.string().min(1),
    locationId: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("item_place"),
    itemId: z.string().min(1),
    locationId: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("item_carry"),
    itemId: z.string().min(1),
    characterId: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("background_thread_advance"),
    threadId: z.string().min(1),
    beatId: z.string().min(1),
    stageFrom: z.string().min(1),
    stageTo: z.string().min(1),
  }),
]);

export type Candidate = z.infer<typeof candidateSchema>;

export interface ParsedLlmOutput {
  schemaValid: boolean;
  candidate: Candidate | null;
  issues: string[];
}

/** Schema check only. Never writes and never grants Truth. */
export function parseLlmCandidate(input: unknown): ParsedLlmOutput {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaValid: false,
      candidate: null,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }
  return { schemaValid: true, candidate: parsed.data, issues: [] };
}

export function parseProducer(value: unknown): Producer {
  return producerSchema.parse(value);
}
