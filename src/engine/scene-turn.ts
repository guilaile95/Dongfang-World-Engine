import { z } from "zod";
import { candidateProposalSchema, type CandidateProposal } from "./simulation-adapter.js";
import type { CharacterContext } from "./context-builder.js";
import type { NarrativeOutcomeProjection } from "./narrative.js";
import type { TurnRejection, TurnStatus } from "./turn-orchestrator.js";

export const EPHEMERAL_KINDS = [
  "mundane_action",
  "observation",
  "remain_in_place",
  "refusal",
  "other_low_causal",
] as const;

export type EphemeralKind = (typeof EPHEMERAL_KINDS)[number];

export const ephemeralBeatSchema = z.object({
  surface: z.string().min(1).optional(),
  kind: z.enum(EPHEMERAL_KINDS),
});

export const targetedStimulusSchema = z.object({
  speakerCharacterId: z.string().min(1),
  targetCharacterId: z.string().min(1),
  surfaceText: z.string().min(1),
  speechAct: z.enum(["ask", "tell", "other"]),
  persistence: z.enum(["ephemeral", "durable_if_future_causal"]).optional(),
}).strict();

export const unsupportedMaterialSchema = z.object({
  attempted: z.string().min(1),
  reason: z.enum(["not_entailed", "material_without_primitive", "illegal_in_context", "ambiguous"]),
  playerFacing: z.enum(["clarification", "bounded_failure", "no_effect"]),
}).strict();

export const timePolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    kind: z.literal("consume_scene_time"),
    minutes: z.number().int().min(1).max(60).optional(),
  }).strict(),
]);

export const sceneTurnPlanSchema = z.object({
  channel: z.enum(["in_world", "ooc_meta"]),
  ephemeralBeats: z.array(ephemeralBeatSchema).default([]),
  targetedStimuli: z.array(targetedStimulusSchema).default([]),
  persistentCandidates: z.array(candidateProposalSchema).default([]),
  unsupportedMaterial: z.array(unsupportedMaterialSchema).default([]),
  timePolicy: timePolicySchema.default({ kind: "none" }),
});

export type EphemeralBeat = {
  surface: string;
  kind: EphemeralKind;
};

export type TargetedStimulus = z.infer<typeof targetedStimulusSchema>;
export type UnsupportedMaterial = z.infer<typeof unsupportedMaterialSchema>;
export type TimePolicy = z.infer<typeof timePolicySchema>;
export type SceneTurnPlanDraft = z.infer<typeof sceneTurnPlanSchema>;

export interface SceneTurnPlan {
  playerContribution: string;
  channel: "in_world" | "ooc_meta";
  ephemeralBeats: EphemeralBeat[];
  targetedStimuli: TargetedStimulus[];
  persistentCandidates: CandidateProposal[];
  unsupportedMaterial: UnsupportedMaterial[];
  timePolicy: TimePolicy;
}

export type SceneTurnStatus = TurnStatus | "ephemeral_success" | "ooc";

export interface WithheldStimulus {
  stimulus: TargetedStimulus;
  reason: string;
}

export interface ResolvedSceneEnvelope {
  playerContribution: string;
  channel: "in_world" | "ooc_meta";
  observerContext: CharacterContext;
  approvedEphemeralBeats: EphemeralBeat[];
  deliveredStimuli: TargetedStimulus[];
  withheldStimuli: WithheldStimulus[];
  committedEffects: NarrativeOutcomeProjection[];
  rejectedEffects: Array<{ kind: string; code: string }>;
  npcWorldOutcomes: NarrativeOutcomeProjection[];
  unsupportedMaterial: UnsupportedMaterial[];
  timePolicy: TimePolicy;
  timeCommitted: boolean;
  continuationRan: boolean;
  turnStatus: SceneTurnStatus;
  rejection: TurnRejection | null;
}

export const MAX_SCENE_TURN_MINUTES = 60;
export const DEFAULT_SCENE_TURN_MINUTES = 10;

export const OOC_PREFIX = /^\/ooc(?:\s+|$)/i;

export function hasOocPrefix(contribution: string): boolean {
  return OOC_PREFIX.test(contribution.trim());
}

export function isContiguousSubstring(surface: string, contribution: string): boolean {
  return surface.length > 0 && contribution.includes(surface);
}
