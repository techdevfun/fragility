/**
 * Unit tests for fragility's measurement modules. Fixtures are the
 * synthetic seeded diffs in examples/ (seed 20261111) - not real code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseDiff, isCodeFile, isTestFile } from "../dist/diff.js";
import { analyzeTests, countAssertions, testCandidatesFor } from "../dist/testAnalysis.js";
import { extractFunctions, analyzeAbstraction } from "../dist/abstraction.js";
import { parseLcov, changedLineCoverage } from "../dist/lcov.js";
import { isAiMarked } from "../dist/comprehension.js";
import { detectionEstimate } from "../dist/review.js";
import {
  scoreTests,
  scoreAbstraction,
  scoreReview,
  compositeScore,
} from "../dist/scoring.js";
import { loadConfig, defaultConfigJson } from "../dist/config.js";
import { explainText } from "../dist/explain.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// --- diff parser ---------------------------------------------------------

test("diff parser: fragile fixture has 4 files, 113 added lines", () => {
  const d = parseDiff(read("examples/pr-fragile.diff"));
  assert.equal(d.files.length, 4);
  assert.equal(d.addedLines, 113);
  assert.equal(d.removedLines, 0);
  assert.equal(d.totalChanged, 113);
  const paths = d.files.map((f) => f.path);
  assert.deepEqual(paths, [
    "src/checkout.ts",
    "src/checkout.test.ts",
    "src/pricing.py",
    "src/test_pricing.py",
  ]);
  const checkout = d.files[0];
  assert.equal(checkout.addedLines.length, 76);
  assert.equal(checkout.addedLines[0].lineNo, 1);
  assert.equal(checkout.addedLines[75].lineNo, 76);
});

test("diff parser: healthy fixture has 2 files, 19 added lines", () => {
  const d = parseDiff(read("examples/pr-healthy.diff"));
  assert.equal(d.files.length, 2);
  assert.equal(d.addedLines, 19);
  assert.equal(d.totalChanged, 19);
});

test("diff parser: empty diff parses to zero files", () => {
  const d = parseDiff("");
  assert.equal(d.files.length, 0);
  assert.equal(d.totalChanged, 0);
});

test("file classifiers", () => {
  assert.equal(isCodeFile("src/a.ts"), true);
  assert.equal(isCodeFile("src/a.py"), true);
  assert.equal(isCodeFile("README.md"), false);
  assert.equal(isTestFile("src/a.test.ts"), true);
  assert.equal(isTestFile("src/test_a.py"), true);
  assert.equal(isTestFile("src/a.ts"), false);
});

// --- test analysis -------------------------------------------------------

// Rebuild a file's content from the diff's added lines.
function addedText(diffText, filePath) {
  const d = parseDiff(diffText);
  const f = d.files.find((x) => x.path === filePath);
  assert.ok(f, `no file ${filePath} in diff`);
  return f.addedLines.map((l) => l.text).join("\n");
}

test("test analysis: fragile fixture - 4 tests, 3 assertions, all weak", () => {
  const diffText = read("examples/pr-fragile.diff");
  const stats = analyzeTests([
    { path: "src/checkout.test.ts", text: addedText(diffText, "src/checkout.test.ts") },
    { path: "src/test_pricing.py", text: addedText(diffText, "src/test_pricing.py") },
  ]);
  assert.equal(stats.tests, 4);
  assert.equal(stats.assertions, 3);
  assert.equal(stats.assertionsPerTest, 0.75);
  assert.equal(stats.weakAssertions, 3);
  assert.equal(stats.weakShare, 1);
  assert.equal(stats.zeroAssertionTests, 1);
  assert.equal(stats.edgeCaseTests, 0);
});

test("test analysis: healthy fixture - 2 tests, 3 assertions, 1 edge case", () => {
  const diffText = read("examples/pr-healthy.diff");
  const stats = analyzeTests([
    { path: "src/format.test.ts", text: addedText(diffText, "src/format.test.ts") },
  ]);
  assert.equal(stats.tests, 2);
  assert.equal(stats.assertions, 3);
  assert.equal(stats.weakAssertions, 0);
  assert.equal(stats.zeroAssertionTests, 0);
  assert.equal(stats.edgeCaseTests, 1);
  assert.equal(stats.edgeShare, 0.5);
});

test("assertion counting: weak matchers both directions", () => {
  const weak = countAssertions('expect(x).toBeTruthy(); expect(y).toBeDefined();', false);
  assert.equal(weak.total, 2);
  assert.equal(weak.weak, 2);
  const strong = countAssertions('expect(x).toBe(3); expect(y).toEqual({a: 1});', false);
  assert.equal(strong.total, 2);
  assert.equal(strong.weak, 0);
  const pyWeak = countAssertions("assert result is not None\nassert True\n", true);
  assert.equal(pyWeak.total, 2);
  assert.equal(pyWeak.weak, 2);
  const pyStrong = countAssertions("assert total == 90\nassert items == []\n", true);
  assert.equal(pyStrong.total, 2);
  assert.equal(pyStrong.weak, 0);
});

test("test candidates: name conventions for TS and Python", () => {
  const all = ["src/foo.ts", "src/foo.test.ts", "src/foo.spec.ts", "src/test_foo.py", "src/foo_test.py"];
  const c = testCandidatesFor("src/foo.ts", all);
  assert.ok(c.includes("src/foo.test.ts"));
  assert.ok(c.includes("src/foo.spec.ts"));
  assert.ok(!c.includes("src/test_foo.py"));
  const cpy = testCandidatesFor("src/foo.py", all);
  assert.ok(cpy.includes("src/test_foo.py"));
  assert.ok(cpy.includes("src/foo_test.py"));
});

// --- abstraction ---------------------------------------------------------

test("abstraction: fragile fixture - 8 functions, max depth 8, 5 flagged", () => {
  const diffText = read("examples/pr-fragile.diff");
  const text = addedText(diffText, "src/checkout.ts");
  const defs = extractFunctions(text);
  assert.equal(defs.length, 8);
  const res = analyzeAbstraction([
    { path: "src/checkout.ts", text, changedLines: Array.from({ length: 76 }, (_, i) => i + 1) },
  ]);
  assert.equal(res.functions.length, 8);
  assert.equal(res.maxDepth, 8);
  assert.equal(res.flaggedCount, 5);
  const checkout = res.functions.find((f) => f.name === "checkout");
  assert.ok(checkout);
  assert.equal(checkout.params, 6);
  assert.equal(checkout.branches, 11);
  assert.equal(checkout.flagged, true);
  const leaf = res.functions.find((f) => f.name === "normalizeRule");
  assert.ok(leaf);
  assert.equal(leaf.flagged, false);
  assert.equal(leaf.depth, 1);
});

test("abstraction: healthy fixture - 1 function, 0 flagged", () => {
  const diffText = read("examples/pr-healthy.diff");
  const text = addedText(diffText, "src/format.ts");
  const res = analyzeAbstraction([
    { path: "src/format.ts", text, changedLines: [1, 2, 3, 4, 5, 6, 7, 8] },
  ]);
  assert.equal(res.functions.length, 1);
  assert.equal(res.flaggedCount, 0);
  assert.equal(res.maxDepth, 1);
});

test("abstraction: if/for/while are not misread as functions", () => {
  const text = [
    "export function run(items: number[]): number {",
    "  let total = 0;",
    "  for (const n of items) {",
    "    if (n > 0) { total += n; }",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const defs = extractFunctions(text);
  assert.deepEqual(defs.map((d) => d.name), ["run"]);
});

// --- LCOV -----------------------------------------------------------------

test("lcov: changed-line coverage of the fragile fixture is 60%", () => {
  const lcov = parseLcov(read("examples/coverage-fragile.lcov"));
  const d = parseDiff(read("examples/pr-fragile.diff"));
  const cov = changedLineCoverage(
    lcov,
    d.files
      .filter((f) => isCodeFile(f.path) && !isTestFile(f.path))
      .map((f) => ({ path: f.path, lineNos: f.addedLines.map((l) => l.lineNo) })),
  );
  assert.equal(cov.covered, 24);
  assert.equal(cov.measurable, 40);
  assert.equal(cov.rate, 0.6);
});

test("lcov: empty report gives a null rate", () => {
  const cov = changedLineCoverage(new Map(), [{ path: "src/a.ts", lineNos: [1, 2] }]);
  assert.equal(cov.rate, null);
  assert.equal(cov.measurable, 0);
});

// --- comprehension markers -------------------------------------------------

test("AI markers: both directions", () => {
  assert.equal(isAiMarked("Add checkout (Co-Authored-By: Claude Sonnet 4.5)"), true);
  assert.equal(isAiMarked("Refactor parser, generated by Copilot"), true);
  assert.equal(isAiMarked("Fix off-by-one in retry loop"), false);
  assert.equal(isAiMarked("Bump deps"), false);
});

// --- review curve ----------------------------------------------------------

test("detection estimate bands", () => {
  assert.equal(detectionEstimate(50).estimate, 87);
  assert.equal(detectionEstimate(150).estimate, 78);
  assert.equal(detectionEstimate(400).estimate, 65);
  assert.equal(detectionEstimate(800).estimate, 42);
  assert.equal(detectionEstimate(1500).estimate, 28);
});

// --- scoring ---------------------------------------------------------------

test("scoring: fragile fixture signals", () => {
  const diffText = read("examples/pr-fragile.diff");
  const stats = analyzeTests([
    { path: "src/checkout.test.ts", text: addedText(diffText, "src/checkout.test.ts") },
    { path: "src/test_pricing.py", text: addedText(diffText, "src/test_pricing.py") },
  ]);
  const s1 = scoreTests(stats, null, 83);
  assert.equal(s1.score, 10);
  assert.equal(s1.verdict, "WEAK");
  const text = addedText(diffText, "src/checkout.ts");
  const abs = analyzeAbstraction([
    { path: "src/checkout.ts", text, changedLines: Array.from({ length: 76 }, (_, i) => i + 1) },
  ]);
  const s2 = scoreAbstraction(abs);
  assert.equal(s2.score, 45);
  const s4 = scoreReview({
    totalChanged: 113,
    band: detectionEstimate(113),
    linesPerDay: null,
    activeDays: 0,
    suggestedChunks: 1,
    skippedVelocity: true,
    velocityNote: "velocity not measured (diff file has no repo context)",
  });
  assert.equal(s4.score, 85);
  const comp = compositeScore([s1, s2, s4], 60);
  assert.equal(comp.composite, 47);
  assert.equal(comp.verdict, "FRAGILE");
  assert.equal(comp.exitCode, 1);
});

test("scoring: no tests at all scores 20", () => {
  const s = scoreTests(
    {
      testFiles: [], tests: 0, assertions: 0, assertionsPerTest: 0,
      zeroAssertionTests: 0, weakAssertions: 0, weakShare: 0,
      edgeCaseTests: 0, edgeShare: 0,
    },
    null,
    50,
  );
  assert.equal(s.score, 20);
});

test("scoring: skipped signals are excluded from the composite", () => {
  const comp = compositeScore(
    [
      { id: "a", name: "A", score: 100, verdict: "ROBUST", detail: "" },
      { id: "b", name: "B", score: null, verdict: "SKIPPED", detail: "no git history" },
    ],
    60,
  );
  assert.equal(comp.composite, 100);
  assert.equal(comp.verdict, "ROBUST");
  assert.equal(comp.exitCode, 0);
});

// --- config + explain ------------------------------------------------------

test("config: defaults are valid JSON and loadable", () => {
  const cfg = loadConfig();
  assert.equal(cfg.failUnder, 60);
  assert.equal(cfg.thresholds.depth, 4);
  assert.ok(cfg.markers.length > 0);
  const parsed = JSON.parse(defaultConfigJson());
  assert.equal(parsed.failUnder, 60);
});

test("explain: each signal documents its method", () => {
  assert.match(explainText("tests"), /assertion/i);
  assert.match(explainText("abstraction"), /depth/i);
  assert.match(explainText("comprehension"), /blame/i);
  assert.match(explainText("review"), /SmartBear/i);
  assert.match(explainText(), /four fragility modes/i);
  assert.match(explainText("nope"), /Unknown signal/);
});
