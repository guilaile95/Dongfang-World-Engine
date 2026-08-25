import { randomUUID } from "node:crypto";
import { z } from "zod";
import { submitCandidates, submitEmptyProposal, type SubmitResult } from "../authority/commit.js";
import type { Candidate } from "../authority/candidate.js";
import type { WorldStore } from "../persist/store.js";
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
  contributions: z.array(contributionKindSchema).min(1),
  futureCausal: z.boolean().optional().default(false),
  outcome: z.enum(["ephemeral", "clarify", "fail", "candidate"]),
  proposals: z.array(proposalSchema).max(4),
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
const REMEMBER_SPEECH = /记住|别忘|不要忘|记着|牢记|说定/;

export function isRememberSpeech(playerLine: string): boolean {
  return REMEMBER_SPEECH.test(playerLine) && !DIARY.test(playerLine);
}

const MOVE_SPEECH = /回家|走进|进入|回到|前往|来到|去/;

export function withObviousMove(
  interpretation: SceneInterpretation,
  input: { playerLine: string; locationId: string | null; currentLocationId: string },
): SceneInterpretation {
  if (!input.locationId || input.locationId === input.currentLocationId || !MOVE_SPEECH.test(input.playerLine)) {
    return interpretation;
  }
  if (interpretation.proposals.some((row) => row.type === "character_move")) {
    return interpretation;
  }
  return {
    ...interpretation,
    contributions: [...new Set([...interpretation.contributions, "world_attempt" as const])],
    futureCausal: true,
    outcome: "candidate",
    proposals: [
      ...interpretation.proposals,
      { type: "character_move", location: input.locationId },
    ],
  };
}

/** Engine-side: explicit “remember this” to a present addressee is durable Memory, not Fact. */
export function withSpokenMemory(
  interpretation: SceneInterpretation,
  input: { addresseeId: string; playerLine: string },
): SceneInterpretation {
  if (!isRememberSpeech(input.playerLine)) {
    return interpretation;
  }
  const existing = interpretation.proposals.find((row) => row.type === "memory_note");
  const text = existing && existing.type === "memory_note" ? existing.text : `玩家让你记住：${input.playerLine.trim()}`;
  const proposals: SceneInterpretation["proposals"] = [
    ...interpretation.proposals.filter((row) => row.type !== "memory_note"),
    { type: "memory_note", text, characterId: input.addresseeId },
  ];
  const contributions = [...new Set([...interpretation.contributions, "speak" as const, "durable_attempt" as const])];
  return {
    ...interpretation,
    contributions,
    futureCausal: true,
    outcome: "candidate",
    proposals,
  };
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
    addresseeId?: string | null;
    parsed?: boolean;
    interpretation: SceneInterpretation;
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
  const result = submitCandidates(store, { producer: "llm", candidates: built });
  return {
    contributions: interpretation.contributions,
    futureCausal: interpretation.futureCausal,
    outcome: result.accepted ? "candidate" : "fail",
    submitted: result.accepted,
    parsed,
    result,
  };
}

export function ensureSpokenMemory(
  store: WorldStore,
  input: { worldId: string; addresseeId: string; playerLine: string },
): SubmitResult | null {
  if (!isRememberSpeech(input.playerLine)) {
    return null;
  }
  const snapshot = store.snapshot(input.worldId);
  const already = snapshot.memories.some(
    (row) =>
      row.characterId === input.addresseeId
      && (row.text.includes(input.playerLine.trim()) || row.text.startsWith("玩家让你记住")),
  );
  if (already) {
    return null;
  }
  const result = submitCandidates(store, {
    producer: "llm",
    candidates: [
      {
        type: "memory_note",
        worldId: input.worldId,
        expectedRevision: snapshot.world.revision,
        memoryId: `mem-${randomUUID()}`,
        characterId: input.addresseeId,
        text: `玩家让你记住：${input.playerLine.trim()}`,
      },
    ],
  });
  return result.accepted ? result : null;
}

const CARRY_SPEECH = /背上|拿起|捡起|拾起|收好|收进|放进书包|放入书包|装进书包|带上|取走/;

export function ensureObviousCarry(
  store: WorldStore,
  input: { worldId: string; playerId: string; playerLine: string },
): SubmitResult | null {
  if (!CARRY_SPEECH.test(input.playerLine)) {
    return null;
  }
  const snapshot = store.snapshot(input.worldId);
  const player = snapshot.characters.find((row) => row.id === input.playerId);
  const itemId = resolveItemId(snapshot, input.playerLine);
  const item = itemId ? snapshot.items.find((row) => row.id === itemId) : null;
  if (!player || !item || item.carrierId === input.playerId) {
    return null;
  }
  if (item.locationId !== player.locationId) {
    return null;
  }
  const result = submitCandidates(store, {
    producer: "llm",
    candidates: [
      {
        type: "item_carry",
        worldId: input.worldId,
        expectedRevision: snapshot.world.revision,
        itemId: item.id,
        characterId: input.playerId,
      },
    ],
  });
  return result.accepted ? result : null;
}

export function ensureObviousMove(
  store: WorldStore,
  input: { worldId: string; playerId: string; playerLine: string },
): SubmitResult | null {
  if (!MOVE_SPEECH.test(input.playerLine)) {
    return null;
  }
  const snapshot = store.snapshot(input.worldId);
  const player = snapshot.characters.find((row) => row.id === input.playerId);
  const dest = resolveLocationId(snapshot, input.playerLine);
  if (!player || !dest || dest === player.locationId) {
    return null;
  }
  const result = submitCandidates(store, {
    producer: "llm",
    candidates: [
      {
        type: "character_move",
        worldId: input.worldId,
        expectedRevision: snapshot.world.revision,
        characterId: input.playerId,
        locationId: dest,
      },
    ],
  });
  return result.accepted ? result : null;
}

export function ephemeralInterpretation(): SceneInterpretation {
  return {
    contributions: ["low_causal"],
    futureCausal: false,
    outcome: "ephemeral",
    proposals: [],
  };
}
