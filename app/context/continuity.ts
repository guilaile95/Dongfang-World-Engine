import { PUBLIC_NS } from "./ingest.js";
import { RECENT_WINDOW } from "./recent.js";
import type { LoreHit, RankedSlice } from "../visibility/retrieve.js";

/**
 * Context pack order. Do not add Vector DB or a memory platform because
 * someone might later play hundreds of turns.
 */
export const CONTINUITY_ORDER = [
  "authoritative_state",
  "recent_scenes",
  "stable_essentials",
  "episodic_recall",
  "rolling_summary",
] as const;

export type ContinuityLayer = (typeof CONTINUITY_ORDER)[number];

export interface ContinuityEvidence {
  protocol: string;
  /** True only when real play showed the recent window was not enough. */
  recentWindowInsufficient: boolean;
  provenBy: string;
}

/**
 * First official product play. Follow-up still worked inside the window.
 * Failures were interpretation transport, sticky addressee, narrator colour.
 * This is not a trigger to expand continuity.
 */
export const EXPERIMENT_1_EVIDENCE: ContinuityEvidence = {
  protocol: "experiment-1-product-play",
  recentWindowInsufficient: false,
  provenBy: "experiment-1",
};

export interface ContinuityPack {
  observerId: string;
  namespace: string;
  state: {
    worldName: string;
    time: string;
    locationName: string;
    present: string;
    visibleItems: string;
    knownClaims: string;
    ambient: string;
    impressions: string;
  };
  recentScenes: string[];
  essentials: {
    observerName: string;
    publicRules: string;
  };
  episodic: LoreHit[];
  rollingSummary: string | null;
}

export function rollingSummaryEnabled(evidence: ContinuityEvidence | null | undefined): boolean {
  if (!evidence) {
    return false;
  }
  return evidence.recentWindowInsufficient === true && evidence.provenBy.trim().length > 0;
}

/** Hypothetical long play is not evidence. */
export function expandContinuityFor(reason: {
  hypotheticalLongPlay?: boolean;
  evidence?: ContinuityEvidence | null;
}): boolean {
  if (reason.hypotheticalLongPlay) {
    return false;
  }
  return rollingSummaryEnabled(reason.evidence);
}

export function isLegalRecallNamespace(observerNamespace: string, namespace: string): boolean {
  return namespace === PUBLIC_NS || namespace === observerNamespace;
}

export function packFromSlice(
  slice: RankedSlice,
  recentScenes: string[] = [],
  options: {
    rollingSummary?: string | null;
    evidence?: ContinuityEvidence | null;
  } = {},
): ContinuityPack {
  const observerName = slice.present.find((row) => row.id === slice.observerId)?.name ?? "";
  const claims =
    slice.claims
      .map((row) => `${row.claim.subject} ${row.claim.predicate} ${row.claim.object} (${row.state})`)
      .join("；") || "（无）";
  const episodic = slice.lore.filter(
    (row) => row.kind === "lore" && isLegalRecallNamespace(slice.namespace, row.namespace),
  );
  const summaryOn = rollingSummaryEnabled(options.evidence);
  return {
    observerId: slice.observerId,
    namespace: slice.namespace,
    state: {
      worldName: slice.worldName,
      time: slice.time,
      locationName: slice.location.name,
      present: slice.present.map((row) => row.name).join("、"),
      visibleItems: slice.visibleItems
        .map((row) => (row.carriedBy ? `${row.name}(携带)` : row.name))
        .join("、") || "（无）",
      knownClaims: claims,
      ambient: slice.ambient.join(" ") || "（无）",
      impressions: slice.memories.map((row) => row.text).join("；") || "（无）",
    },
    recentScenes: recentScenes.slice(-RECENT_WINDOW),
    essentials: {
      observerName,
      publicRules: slice.publicRules.join("；") || "（无）",
    },
    episodic,
    rollingSummary: summaryOn ? options.rollingSummary?.trim() || null : null,
  };
}

export function renderContinuity(pack: ContinuityPack): string {
  const recent = pack.recentScenes.join(" || ") || "（无）";
  const recall = pack.episodic.map((row) => row.body).join(" / ") || "（无）";
  const who = pack.essentials.observerName ? `你是${pack.essentials.observerName}` : "你在场";
  const lines = [
    `当前状态（权威）：世界=${pack.state.worldName}；时间=${pack.state.time}；地点=${pack.state.locationName}；在场=${pack.state.present}；可见物品=${pack.state.visibleItems}；你所知的说法=${pack.state.knownClaims}；当下可见=${pack.state.ambient}；你的印象=${pack.state.impressions}`,
    `最近场景（非权威，不能覆盖已发生之事）：${recent}`,
    `稳定设定：${who}；公开规则=${pack.essentials.publicRules}`,
    `相关回忆（可见性之后，非事实权威）：${recall}`,
  ];
  if (pack.rollingSummary) {
    lines.push(`滚动摘要（非权威，可重建，不能覆盖事实）：${pack.rollingSummary}`);
  }
  return lines.join("\n");
}
