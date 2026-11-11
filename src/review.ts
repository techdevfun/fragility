/**
 * Signal 4 - REVIEW BOTTLENECK.
 *
 * Two numbers, both labelled as estimates from published population
 * data, never as measured rates for this PR:
 *
 * 1. Detection estimate: the diff size mapped to the SmartBear curve
 *    (analysis of 2,500 PRs): ~87% of defects caught under 100 lines,
 *    78% at 100-300, 65% at 300-600, 42% at 600-1,000, 28% above 1,000.
 *    Fewer than a quarter of PRs over 1,000 lines get any review
 *    comment at all. Source: SmartBear, cited in the README.
 * 2. Review velocity: lines merged per day over the last 30 days from
 *    git log --numstat, compared with a 400 lines/day sustainable
 *    review capacity (the top of SmartBear's effective-review band,
 *    200-400 lines per ~60-minute session). A heuristic benchmark,
 *    not a measurement of any team's capacity.
 */
import { velocityLines } from "./git.js";

export interface DetectionBand {
  maxLines: number; // inclusive upper bound of the band
  estimate: number; // percent of defects a reviewer is expected to catch
  label: string;
}

export const DETECTION_CURVE: DetectionBand[] = [
  { maxLines: 99, estimate: 87, label: "under 100 lines" },
  { maxLines: 300, estimate: 78, label: "100-300 lines" },
  { maxLines: 600, estimate: 65, label: "300-600 lines" },
  { maxLines: 1000, estimate: 42, label: "600-1,000 lines" },
  { maxLines: Number.POSITIVE_INFINITY, estimate: 28, label: "over 1,000 lines" },
];

export function detectionEstimate(totalChanged: number): DetectionBand {
  for (const b of DETECTION_CURVE) {
    if (totalChanged <= b.maxLines) return b;
  }
  return DETECTION_CURVE[DETECTION_CURVE.length - 1];
}

export const SUSTAINABLE_LINES_PER_DAY = 400;
export const EFFECTIVE_REVIEW_BAND = 400; // lines per reviewable chunk

export interface ReviewResult {
  totalChanged: number;
  band: DetectionBand;
  linesPerDay: number | null; // null when no git history
  activeDays: number;
  suggestedChunks: number;
  skippedVelocity: boolean;
}

export function analyzeReview(
  repoDir: string | null,
  totalChanged: number,
): ReviewResult {
  const band = detectionEstimate(totalChanged);
  let linesPerDay: number | null = null;
  let activeDays = 0;
  let skippedVelocity = true;
  if (repoDir) {
    const v = velocityLines(repoDir, 30);
    activeDays = v.activeDays;
    if (v.activeDays > 0) {
      linesPerDay = v.lines / v.activeDays;
      skippedVelocity = false;
    }
  }
  return {
    totalChanged,
    band,
    linesPerDay,
    activeDays,
    suggestedChunks: Math.max(1, Math.ceil(totalChanged / EFFECTIVE_REVIEW_BAND)),
    skippedVelocity,
  };
}
