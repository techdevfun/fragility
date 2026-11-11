/**
 * Scoring. Each signal produces a subscore 0-100 (100 = robust).
 * The composite FRAGILITY SCORE is the mean of the signals that ran;
 * skipped signals are excluded and the report says so. Verdicts:
 * ROBUST >= 80, WATCH 60-79, FRAGILE < 60. Every formula is documented
 * here and in `fragility explain` so a score can be checked by hand.
 */
import type { TestStats } from "./testAnalysis.js";
import type { AbstractionResult } from "./abstraction.js";
import type { ComprehensionResult } from "./comprehension.js";
import type { ReviewResult } from "./review.js";

export interface SignalScore {
  id: string;
  name: string;
  score: number | null; // null = skipped
  verdict: "ROBUST" | "WATCH" | "WEAK" | "SKIPPED";
  detail: string;
}

export interface AuditScore {
  signals: SignalScore[];
  composite: number | null;
  verdict: "ROBUST" | "WATCH" | "FRAGILE";
  exitCode: number; // 0 robust/watch, 1 fragile (or under --fail-under), 2 input error
}

function verdictFor(score: number): "ROBUST" | "WATCH" | "WEAK" {
  if (score >= 80) return "ROBUST";
  if (score >= 60) return "WATCH";
  return "WEAK";
}

/** Signal 1: test shallowness. */
export function scoreTests(
  stats: TestStats,
  coverageRate: number | null,
  changedSourceLines: number,
): SignalScore {
  if (stats.tests === 0 && changedSourceLines > 0) {
    return {
      id: "tests",
      name: "Test shallowness",
      score: 20,
      verdict: "WEAK",
      detail: `no tests found for the ${changedSourceLines} changed source lines`,
    };
  }
  let score = 100;
  const notes: string[] = [];
  if (stats.assertionsPerTest < 1) {
    score -= 40;
  }
  if (stats.weakShare > 0.5) {
    score -= 25;
    notes.push(`${Math.round(stats.weakShare * 100)}% weak assertions`);
  } else if (stats.weakShare > 0) {
    score -= 10;
    notes.push(`${Math.round(stats.weakShare * 100)}% weak assertions`);
  }
  if (stats.zeroAssertionTests > 0) {
    score -= 15;
    notes.push(`${stats.zeroAssertionTests} test(s) assert nothing`);
  }
  if (stats.tests > 0 && stats.edgeShare < 0.1) {
    score -= 10;
    notes.push("no edge-case tests");
  }
  if (coverageRate !== null) {
    score -= Math.round((1 - coverageRate) * 30);
    notes.push(`changed-line coverage ${Math.round(coverageRate * 100)}%`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const base =
    `${stats.tests} test(s), ${stats.assertions} assertion(s)` +
    (stats.tests > 0 ? ` (${stats.assertionsPerTest.toFixed(2)}/test)` : "");
  return {
    id: "tests",
    name: "Test shallowness",
    score,
    verdict: verdictFor(score),
    detail: notes.length > 0 ? `${base}; ${notes.join("; ")}` : base,
  };
}

/** Signal 2: over-abstraction. */
export function scoreAbstraction(res: AbstractionResult): SignalScore {
  if (res.functions.length === 0) {
    return {
      id: "abstraction",
      name: "Over-abstraction",
      score: 100,
      verdict: "ROBUST",
      detail: "no TS/JS functions in the changed lines",
    };
  }
  let score = 100;
  score -= Math.min(45, res.flaggedCount * 15);
  if (res.maxDepth >= 6) score -= 10;
  score = Math.max(0, score);
  const worst = res.functions
    .filter((f) => f.flagged)
    .sort((a, b) => b.depth - a.depth)[0];
  const detail =
    `${res.functions.length} changed function(s), max call depth ${res.maxDepth}, ` +
    `${res.flaggedCount} flagged` +
    (worst ? `; worst: ${worst.file}:${worst.line} ${worst.name} (${worst.reasons.join(", ")})` : "");
  return {
    id: "abstraction",
    name: "Over-abstraction",
    score,
    verdict: verdictFor(score),
    detail,
  };
}

/** Signal 3: comprehension debt. */
export function scoreComprehension(res: ComprehensionResult): SignalScore {
  if (res.skipped) {
    return {
      id: "comprehension",
      name: "Comprehension debt",
      score: null,
      verdict: "SKIPPED",
      detail: res.skipReason ?? "no git history",
    };
  }
  let score = 100;
  score -= Math.round(res.orphanRatio * 60);
  if (res.authors90d === 1) score -= 15;
  score = Math.max(0, score);
  const detail =
    `${Math.round(res.orphanRatio * 100)}% orphan lines ` +
    `(${res.orphanLines}/${res.changedLines} un-retouched since an AI-marked commit), ` +
    `${res.authors90d} ${res.authors90d === 1 ? "author" : "authors"} on these files in 90d`;
  return {
    id: "comprehension",
    name: "Comprehension debt",
    score,
    verdict: verdictFor(score),
    detail,
  };
}

/** Signal 4: review bottleneck. */
export function scoreReview(res: ReviewResult): SignalScore {
  // Map the detection estimate (87 best .. 28 worst) onto 0..100.
  const sizeScore = Math.round(((res.band.estimate - 28) / (87 - 28)) * 100);
  let score = sizeScore;
  if (res.linesPerDay !== null && res.linesPerDay > 800) {
    score -= 35;
  } else if (res.linesPerDay !== null && res.linesPerDay > 400) {
    score -= 20;
  }
  score = Math.max(0, Math.min(100, score));
  const detail =
    `${res.totalChanged} lines changed, detection estimate ${res.band.estimate}% ` +
    `(${res.band.label}, SmartBear curve)` +
    (res.linesPerDay !== null
      ? `, ${Math.round(res.linesPerDay)}/day over 30d`
      : ", velocity unknown (no git history)") +
    (res.suggestedChunks > 1 ? `; split into ~${res.suggestedChunks} chunks` : "");
  return {
    id: "review",
    name: "Review bottleneck",
    score,
    verdict: verdictFor(score),
    detail,
  };
}

export function compositeScore(signals: SignalScore[], failUnder: number): AuditScore {
  const ran = signals.filter((s) => s.score !== null) as (SignalScore & { score: number })[];
  const composite =
    ran.length === 0 ? null : Math.round(ran.reduce((a, s) => a + s.score, 0) / ran.length);
  const verdict =
    composite === null ? "FRAGILE" : composite >= 80 ? "ROBUST" : composite >= 60 ? "WATCH" : "FRAGILE";
  const exitCode = composite === null || composite < failUnder ? 1 : 0;
  return { signals, composite, verdict, exitCode };
}
