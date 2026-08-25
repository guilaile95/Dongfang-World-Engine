import { randomUUID } from "node:crypto";
import { z } from "zod";
import { submitCandidates, submitEmptyProposal, type SubmitResult } from "../authority/commit.js";
import type { Candidate } from "../authority/candidate.js";
import type { WorldStore } from "../persist/store.js";
import type { LocationRouteRecord } from "../authority/types.js";
import { resolveItemId, resolveLocationId } from "../world/resolve.js";

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
  z.object({
    type: z.literal("character_move"),
    location: z.string().min(1),
  }),
  z.object({
    type: z.literal("item_place"),
    item: z.string().min(1),
    location: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("item_carry"),
    item: z.string().min(1),
  }),
]);

export const interpretationSchema = z.object({
  channel: z.enum(["in_world", "ooc_meta"]).optional(),
  contributions: z.array(contributionKindSchema).min(1),
  futureCausal: z.boolean().optional().default(false),
  outcome: z.enum(["ephemeral", "clarify", "fail", "candidate"]),
  proposals: z.array(proposalSchema).max(4),
  timePolicy: z.object({
    kind: z.enum(["none", "bounded_action", "route_travel", "explicit_wait"]),
    minutes: z.number().int().nonnegative().nullable(),
    routeId: z.string().nullable(),
    untilTime: z.string().nullable(),
  }).optional(),
  strategyIntent: z.object({
    kind: z.enum(["follow_route", "wait", "leave_area", "continue_current_task"]),
    targetLocationId: z.string().nullable(),
    routeId: z.string().nullable(),
    untilTime: z.string().nullable(),
    completionCondition: z.string().min(1),
  }).nullable().optional(),
});

export type SceneInterpretation = z.infer<typeof interpretationSchema>;

export interface BoundInterpretation {
  contributions: ContributionKind[];
  futureCausal: boolean;
  outcome: SceneInterpretation["outcome"];
  submitted: boolean;
  parsed: boolean;
  result: SubmitResult;
}

const SPEECH = new Set<ContributionKind>(["speak", "ask"]);
const DIARY = /日记|写进日记|写下来|记在本子|写进本子/;

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
    addresseeId?: string | null;
    parsed?: boolean;
    interpretation: SceneInterpretation;
    routes?: LocationRouteRecord[];
    idempotencyKey?: string;
  },
): BoundInterpretation {
  const interpretation = normalizeInterpretation(input.interpretation);
  const parsed = input.parsed ?? true;
  if (interpretation.outcome !== "candidate" || interpretation.proposals.length === 0) {
    return {
      contributions: interpretation.contributions,
      futureCausal: false,
      outcome: interpretation.outcome,
      submitted: false,
      parsed,
      result: submitEmptyProposal(store, input.worldId),
    };
  }
  const snapshot = store.snapshot(input.worldId);
  const spoken = interpretation.contributions.some((kind) => SPEECH.has(kind));
  const player = snapshot.characters.find((row) => row.id === input.playerId);
  const built: Candidate[] = [];
  let unresolved = false;
  let playerLoc = player?.locationId ?? "";
  for (const proposal of interpretation.proposals) {
    const expectedRevision = snapshot.world.revision + built.length;
    if (proposal.type === "claim_record") {
      built.push({
        type: "claim_record",
        worldId: input.worldId,
        expectedRevision,
        claimId: `claim-${randomUUID()}`,
        subject: proposal.subject,
        predicate: proposal.predicate,
        object: proposal.object,
      });
      continue;
    }
    if (proposal.type === "memory_note") {
      const diarySelf = DIARY.test(proposal.text);
      const bindToAddressee = Boolean(!diarySelf && spoken && input.addresseeId && !proposal.characterId);
      built.push({
        type: "memory_note",
        worldId: input.worldId,
        expectedRevision,
        memoryId: `mem-${randomUUID()}`,
        characterId: proposal.characterId ?? (bindToAddressee ? input.addresseeId as string : input.playerId),
        text: proposal.text,
      });
      continue;
    }
    if (proposal.type === "character_move") {
      const locationId = resolveLocationId(snapshot, proposal.location);
      if (!locationId || !player) {
        unresolved = true;
        break;
      }
      if (playerLoc === locationId) {
        continue;
      }
      if (input.routes && input.routes.length > 0 && !input.routes.some((route) =>
        (route.fromLocationId === playerLoc && route.toLocationId === locationId)
        || (route.bidirectional && route.toLocationId === playerLoc && route.fromLocationId === locationId))) {
        unresolved = true;
        break;
      }
      built.push({
        type: "character_move",
        worldId: input.worldId,
        expectedRevision,
        characterId: input.playerId,
        locationId,
      });
      playerLoc = locationId;
      continue;
    }
    const itemId = resolveItemId(snapshot, proposal.item);
    if (!itemId || !player) {
      unresolved = true;
      break;
    }
    if (proposal.type === "item_place") {
      const here = proposal.location && /桌|这里|身旁/.test(proposal.location);
      const locationId = here
        ? playerLoc
        : proposal.location
          ? resolveLocationId(snapshot, proposal.location)
          : playerLoc;
      if (!locationId) {
        unresolved = true;
        break;
      }
      const item = snapshot.items.find((row) => row.id === itemId);
      if (item?.locationId === locationId && item.carrierId === null) {
        continue;
      }
      built.push({
        type: "item_place",
        worldId: input.worldId,
        expectedRevision,
        itemId,
        locationId,
      });
      snapshot.items = snapshot.items.map((row) =>
        row.id === itemId ? { ...row, locationId, carrierId: null } : row,
      );
      continue;
    }
    const item = snapshot.items.find((row) => row.id === itemId);
    if (item?.carrierId === input.playerId) {
      continue;
    }
    built.push({
      type: "item_carry",
      worldId: input.worldId,
      expectedRevision,
      itemId,
      characterId: input.playerId,
    });
    snapshot.items = snapshot.items.map((row) =>
      row.id === itemId ? { ...row, locationId: null, carrierId: input.playerId } : row,
    );
  }
  if (unresolved) {
    return {
      contributions: interpretation.contributions,
      futureCausal: false,
      outcome: "clarify",
      submitted: false,
      parsed,
      result: submitEmptyProposal(store, input.worldId),
    };
  }
  if (built.length === 0) {
    return {
      contributions: interpretation.contributions,
      futureCausal: false,
      outcome: "ephemeral",
      submitted: false,
      parsed,
      result: submitEmptyProposal(store, input.worldId),
    };
  }
  const result = submitCandidates(store, { producer: "llm", candidates: built, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  return {
    contributions: interpretation.contributions,
    futureCausal: interpretation.futureCausal,
    outcome: result.accepted ? "candidate" : "fail",
    submitted: result.accepted,
    parsed,
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
