import { z } from "zod";
import type { CompiledWorld } from "./compile.js";

const refIds = z.array(z.string().min(1)).min(1);
const visibility = z.enum(["public", "hidden"]);
const sourceRefSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(["official_novel", "official_revision", "official_supplement", "owner_protocol", "slice_authored"]),
  workOrFile: z.string().min(1),
  editionOrVersion: z.string(),
  locator: z.string().min(1),
  paraphrase: z.string().min(1),
  status: z.enum(["confirmed", "provisional", "unresolved"]),
  notes: z.string().default(""),
});

const consequenceSchema = z.object({
  type: z.enum(["fact_assert", "claim_record"]),
  id: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  visibility: visibility.optional(),
});

const exposureSchema = z.object({
  kind: z.enum(["same_location", "route_intersection", "public_broadcast", "visible_result"]),
  observerRequirements: z.array(z.string()).default([]),
  presentationDirective: z.string().min(1),
  stopReason: z.enum(["new_risk", "direction_choice", "material_information", "meaningful_npc_request", "obstacle", "destination_reached"]),
});

export const dragon2009SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  world: z.object({ id: z.literal("longzu"), title: z.string().min(1), publicName: z.string().min(1), protocolRef: z.string().min(1) }),
  chronology: z.object({
    snapshotId: z.string().min(1),
    canonicalDateOrRange: z.string().min(1),
    startTime: z.string().datetime({ offset: true }),
    playerFacingEra: z.string().min(1),
    playerFacingTimeLabel: z.string().min(1),
    publicPremise: z.string().min(1),
    sourceRefs: refIds,
  }),
  rules: z.array(z.string().min(1)),
  locations: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), visibility, parentLocationId: z.string().nullable(), sourceRefs: refIds })).min(4).max(6),
  routes: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), fromLocationId: z.string().min(1), toLocationId: z.string().min(1),
    viaLocationIds: z.array(z.string()).default([]), travelMinutes: z.number().int().positive(), bidirectional: z.boolean(), visibility,
    conditions: z.array(z.string()).default([]), sourceRefs: refIds,
  })).min(5).max(8),
  characters: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), kind: z.enum(["player_template", "npc"]), locationId: z.string().min(1),
    alive: z.boolean(), visibility, publicDescription: z.string(), privateAnchor: z.string(), organizationIds: z.array(z.string()), sourceRefs: refIds,
  })).min(1),
  facts: z.array(z.object({ id: z.string().min(1), subject: z.string().min(1), predicate: z.string().min(1), object: z.string().min(1), visibility, validFrom: z.string().min(1), validTo: z.string().nullable(), sourceRefs: refIds })),
  claims: z.array(z.object({ id: z.string().min(1), subject: z.string().min(1), predicate: z.string().min(1), object: z.string().min(1), sourceRefs: refIds })),
  knowledge: z.array(z.object({ characterId: z.string().min(1), claimId: z.string().min(1), state: z.enum(["rumor", "believed", "confirmed"]), sourceKind: z.enum(["seed", "character", "event"]), sourceRefId: z.string().min(1) })),
  items: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), locationId: z.string().nullable(), carrierId: z.string().nullable(), sourceRefs: refIds })),
  backgroundThreads: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), actorIds: z.array(z.string()), objective: z.string().min(1), initialStage: z.string().min(1),
    locationScope: z.array(z.string()), startsAt: z.string().datetime({ offset: true }), sourceRefs: refIds,
    beats: z.array(z.object({ beatId: z.string().min(1), stageFrom: z.string().min(1), stageTo: z.string().min(1), dueAt: z.string().datetime({ offset: true }).nullable(), afterMinutes: z.number().int().nonnegative().nullable(), preconditions: z.array(z.string()), consequences: z.array(consequenceSchema), exposureRules: z.array(exposureSchema) })).min(2).max(3),
  })).length(1),
  sourceRefs: z.array(sourceRefSchema).min(1),
}).superRefine((source, ctx) => {
  const ids = <T extends { id: string }>(rows: T[], path: string) => {
    const seen = new Set<string>();
    for (const [index, row] of rows.entries()) {
      if (seen.has(row.id)) ctx.addIssue({ code: "custom", message: `duplicate id: ${row.id}`, path: [path, index, "id"] });
      seen.add(row.id);
    }
    return seen;
  };
  const locations = ids(source.locations, "locations");
  ids(source.routes, "routes");
  const characters = ids(source.characters, "characters");
  ids(source.facts, "facts");
  const claims = ids(source.claims, "claims");
  ids(source.items, "items");
  ids(source.backgroundThreads, "backgroundThreads");
  const refs = ids(source.sourceRefs, "sourceRefs");
  const unresolved = new Set(source.sourceRefs.filter((row) => row.status !== "confirmed").map((row) => row.id));
  const checkRefs = (rows: Array<{ sourceRefs: string[] }>, path: string) => rows.forEach((row, index) => row.sourceRefs.forEach((id) => {
    if (!refs.has(id)) ctx.addIssue({ code: "custom", message: `missing source ref: ${id}`, path: [path, index, "sourceRefs"] });
    if (unresolved.has(id)) ctx.addIssue({ code: "custom", message: `unresolved source ref: ${id}`, path: [path, index, "sourceRefs"] });
  }));
  checkRefs([source.chronology, ...source.locations, ...source.routes, ...source.characters, ...source.facts, ...source.claims, ...source.items, ...source.backgroundThreads], "records");
  source.routes.forEach((route, index) => {
    if (!locations.has(route.fromLocationId) || !locations.has(route.toLocationId) || route.viaLocationIds.some((id) => !locations.has(id))) ctx.addIssue({ code: "custom", message: `route references missing location: ${route.id}`, path: ["routes", index] });
  });
  source.characters.forEach((row, index) => { if (!locations.has(row.locationId)) ctx.addIssue({ code: "custom", message: `character location missing: ${row.locationId}`, path: ["characters", index] }); });
  source.items.forEach((row, index) => {
    if (row.locationId && !locations.has(row.locationId)) ctx.addIssue({ code: "custom", message: `item location missing: ${row.locationId}`, path: ["items", index] });
    if (row.carrierId && !characters.has(row.carrierId)) ctx.addIssue({ code: "custom", message: `item carrier missing: ${row.carrierId}`, path: ["items", index] });
    if (Boolean(row.locationId) === Boolean(row.carrierId)) ctx.addIssue({ code: "custom", message: "item must have exactly one location or carrier", path: ["items", index] });
  });
  source.knowledge.forEach((row, index) => {
    if (!characters.has(row.characterId) || !claims.has(row.claimId) || !refs.has(row.sourceRefId)) ctx.addIssue({ code: "custom", message: "knowledge reference missing", path: ["knowledge", index] });
  });
  source.backgroundThreads.forEach((thread, index) => {
    if (thread.actorIds.some((id) => !characters.has(id))) ctx.addIssue({ code: "custom", message: "background actor missing", path: ["backgroundThreads", index, "actorIds"] });
    if (new Set(thread.beats.map((beat) => beat.beatId)).size !== thread.beats.length) ctx.addIssue({ code: "custom", message: "duplicate beat id", path: ["backgroundThreads", index, "beats"] });
    if (thread.locationScope.some((id) => !locations.has(id))) ctx.addIssue({ code: "custom", message: "background scope location missing", path: ["backgroundThreads", index, "locationScope"] });
  });
});

export type Dragon2009SnapshotSource = z.infer<typeof dragon2009SnapshotSchema>;

export function compileDragonSnapshot(source: Dragon2009SnapshotSource): CompiledWorld {
  const seedId = `seed-${source.world.id}-${source.chronology.snapshotId}`;
  const player = source.characters.find((row) => row.kind === "player_template");
  if (!player) throw new Error("SNAPSHOT_NO_PLAYER");
  return {
    seed: {
      world: { id: source.world.id, name: source.world.publicName, time: source.chronology.startTime, revision: 0, rules: source.rules },
      locations: source.locations.map((row) => ({ id: row.id, worldId: source.world.id, name: row.name })),
      characters: source.characters.map((row) => ({ id: row.id, worldId: source.world.id, name: row.name, kind: row.kind === "player_template" ? "player" : "npc", locationId: row.locationId })),
      items: source.items.map((row) => ({ id: row.id, worldId: source.world.id, name: row.name, locationId: row.carrierId ? null : row.locationId, carrierId: row.carrierId })),
      facts: source.facts.map((row) => ({ id: row.id, worldId: source.world.id, subject: row.subject, predicate: row.predicate, object: row.object, validFrom: row.validFrom, validTo: row.validTo, sourceEventId: null, sourceSeedId: seedId, sourceKind: "seed" as const })),
      claims: source.claims.map((row) => ({ id: row.id, worldId: source.world.id, subject: row.subject, predicate: row.predicate, object: row.object, recordedAt: source.chronology.startTime, sourceEventId: null, sourceSeedId: seedId, sourceKind: "seed" as const })),
      knowledge: source.knowledge.map((row) => ({ characterId: row.characterId, claimId: row.claimId, state: row.state, sourceKind: "seed" as const, sourceCharacterId: null, sourceEventId: null, sourceSeedId: seedId, learnedAt: source.chronology.startTime })),
    },
    playerId: player.id,
    packageTitle: source.world.title,
    sourceKind: "structured",
    theme: { characterId: source.backgroundThreads[0]?.actorIds[0] ?? player.id, memory: "", publicBeat: "", publicBeatScope: "same_location" },
    chronology: { era: source.chronology.playerFacingEra, timeLabel: source.chronology.playerFacingTimeLabel, publicPremise: source.chronology.publicPremise },
    materials: [],
    routes: source.routes.map((row) => ({ ...row, worldId: source.world.id })),
    backgroundThreads: source.backgroundThreads.map((row) => ({ id: row.id, worldId: source.world.id, actorIds: row.actorIds, objective: row.objective, currentStage: row.initialStage, locationScope: row.locationScope, startsAt: row.startsAt, beats: row.beats, executedBeatIds: [] })),
    sourceRefs: source.sourceRefs.map((row) => ({ ...row, worldId: source.world.id })),
    characterMetadata: Object.fromEntries(source.characters.map((row) => [row.id, { alive: row.alive, visibility: row.visibility }])),
  };
}
