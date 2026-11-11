/**
 * End-to-end tests: the real CLI (dist/cli.js) on the fixture diffs and
 * on real temporary git repos built in os.tmpdir. Fixture diffs are
 * synthetic seeded (seed 20261111); the git repos are built by git
 * itself inside the test, so blame/log behaviour is genuine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

function runCli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? ROOT,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function git(dir, ...args) {
  execFileSync("git", ["-c", "user.name=Test Dev", "-c", "user.email=test@example.com", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  });
}

/** A temp git repo with a small human baseline commit. Returns the dir. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fragility-e2e-"));
  git(dir, "init", "-b", "main");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "util.ts"), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  writeFileSync(
    join(dir, "src", "util.test.ts"),
    'import { add } from "./util";\n\ntest("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\n',
  );
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Add util with tests");
  return dir;
}

test("e2e: fragile fixture diff -> FRAGILE, exit 1, composite 47", () => {
  const r = runCli(["audit", "--diff", "examples/pr-fragile.diff"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /FRAGILE/);
  assert.match(r.out, /FRAGILITY SCORE 47\/100/);
  assert.match(r.out, /Test shallowness\s+10\s+WEAK/);
  assert.match(r.out, /Over-abstraction\s+45\s+WEAK/);
  assert.match(r.out, /SKIPPED/);
});

test("e2e: fragile fixture with coverage -> tests score 0, composite 43", () => {
  const r = runCli([
    "audit", "--diff", "examples/pr-fragile.diff",
    "--coverage", "examples/coverage-fragile.lcov",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.out, /changed-line coverage 60%/);
  assert.match(r.out, /FRAGILITY SCORE 43\/100/);
});

test("e2e: healthy fixture diff -> ROBUST, exit 0, composite 100", () => {
  const r = runCli(["audit", "--diff", "examples/pr-healthy.diff"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /FRAGILITY SCORE 100\/100 - ROBUST/);
});

test("e2e: json output parses and carries the verdict", () => {
  const r = runCli(["audit", "--diff", "examples/pr-fragile.diff", "--format", "json"]);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.equal(j.tool, "fragility");
  assert.equal(j.composite, 47);
  assert.equal(j.verdict, "FRAGILE");
  assert.equal(j.exitCode, 1);
  assert.equal(j.signals.length, 4);
  assert.equal(j.signals[2].verdict, "SKIPPED");
});

test("e2e: missing diff file -> exit 2", () => {
  const r = runCli(["audit", "--diff", "examples/no-such.diff"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot read diff file/);
});

test("e2e: empty diff -> exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "fragility-empty-"));
  const p = join(dir, "empty.diff");
  writeFileSync(p, "");
  const r = runCli(["audit", "--diff", p], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /empty diff/);
});

test("e2e: --fail-under raises the bar", () => {
  const r = runCli(["audit", "--diff", "examples/pr-healthy.diff", "--fail-under", "101"]);
  assert.equal(r.code, 1);
});

test("e2e: explain prints the measurement method", () => {
  const r = runCli(["explain", "tests"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /assertion/i);
  assert.match(r.out, /weak/i);
});

test("e2e: explain with no signal lists all four", () => {
  const r = runCli(["explain"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /comprehension/);
  assert.match(r.out, /review/);
});

test("e2e: init writes a config and refuses to overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "fragility-init-"));
  const r1 = runCli(["init", dir]);
  assert.equal(r1.code, 0);
  assert.ok(existsSync(join(dir, "fragility.config.json")));
  const cfg = JSON.parse(readFileSync(join(dir, "fragility.config.json"), "utf8"));
  assert.equal(cfg.failUnder, 60);
  assert.equal(cfg.thresholds.depth, 4);
  const r2 = runCli(["init", dir]);
  assert.equal(r2.code, 2);
  assert.match(r2.err, /already exists/);
});

test("e2e: --help and --version exit 0", () => {
  assert.equal(runCli(["--help"]).code, 0);
  assert.match(runCli(["--help"]).out, /fragility 0\.1\.0/);
  assert.match(runCli(["--version"]).out, /0\.1\.0/);
  assert.equal(runCli(["--version"]).code, 0);
});

test("e2e: git range audit - AI-marked commit shows as orphan lines", () => {
  const dir = makeRepo();
  // A big AI-marked commit: deep call chain + shallow tests.
  const fragileSrc = [
    "function step1(x: number): number { return x + 1; }",
    "function step2(x: number): number { return step1(x) + 1; }",
    "function step3(x: number): number { return step2(x) + 1; }",
    "function step4(x: number): number { return step3(x) + 1; }",
    "function step5(x: number): number { return step4(x) + 1; }",
    "export function pipeline(x: number): number { return step5(x); }",
    "",
  ].join("\n");
  writeFileSync(join(dir, "src", "pipe.ts"), fragileSrc);
  writeFileSync(
    join(dir, "src", "pipe.test.ts"),
    'import { pipeline } from "./pipe";\n\ntest("pipeline runs", () => {\n  expect(pipeline(1)).toBeTruthy();\n});\n',
  );
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Add pipeline (Co-Authored-By: Claude Sonnet 4.5)");
  const r = runCli(["audit", "--base", "HEAD~1"], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /FRAGILE/);
  assert.match(r.out, /100% orphan lines/);
  assert.match(r.out, /Over-abstraction/);
  assert.doesNotMatch(r.out, /SKIPPED/);
});

test("e2e: git range audit - small human commit is ROBUST", () => {
  const dir = makeRepo();
  writeFileSync(
    join(dir, "src", "util.ts"),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function mul(a: number, b: number): number {\n  if (a < 0 || b < 0) throw new Error("negative");\n  return a * b;\n}\n',
  );
  writeFileSync(
    join(dir, "src", "util.test.ts"),
    'import { add, mul } from "./util";\n\ntest("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\n\ntest("rejects negative factors", () => {\n  expect(() => mul(-1, 2)).toThrow("negative");\n  expect(mul(2, 3)).toBe(6);\n});\n',
  );
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Add mul with edge-case tests");
  const r = runCli(["audit", "--base", "HEAD~1"], dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /ROBUST/);
  assert.match(r.out, /0% orphan lines/);
});

test("e2e: audit outside a git repo without --diff -> exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "fragility-nogit-"));
  const r = runCli(["audit"], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /not a git repo/);
});
