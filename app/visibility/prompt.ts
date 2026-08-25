import { packFromSlice, renderContinuity, type ContinuityEvidence } from "../context/continuity.js";
import type { RankedSlice } from "./retrieve.js";

export function packPrompt(
  slice: RankedSlice,
  recentScenes: string[] = [],
  options: {
    rollingSummary?: string | null;
    evidence?: ContinuityEvidence | null;
  } = {},
): string {
  return renderContinuity(packFromSlice(slice, recentScenes, options));
}
