#!/usr/bin/env node
/**
 * fragility 0.1.0 - measure the four fragility modes of AI-written code
 * on the diff you are about to merge. Offline, zero dependencies.
 *
 *   fragility audit [--base <ref>] [--diff <file>] [--repo <dir>]
 *                   [--coverage <lcov>] [--format table|json]
 *                   [--fail-under N] [--config <file>]
 *   fragility explain [signal]
 *   fragility init [dir]
 *
 * Exit codes: 0 = ROBUST or WATCH, 1 = FRAGILE (or below --fail-under),
 * 2 = input error.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDiff,
  isCodeFile,
  isTestFile,
  type ParsedDiff,
} from "./diff.js";
import {
  isGitRepo,
  defaultBase,
  diffRange,
} from "./git.js";
import { analyzeTests, testCandidatesFor, type TestFileContent } from "./testAnalysis.js";
import { analyzeAbstraction } from "./abstraction.js";
import { parseLcov, changedLineCoverage } from "./lcov.js";
import { analyzeComprehension } from "./comprehension.js";
import { analyzeReview } from "./review.js";
import {
  scoreTests,
  scoreAbstraction,
  scoreComprehension,
  scoreReview,
  compositeScore,
} from "./scoring.js";
import { loadConfig, defaultConfigJson } from "./config.js";
import { explainText } from "./explain.js";
import { renderTable, renderJson } from "./output.js";

export const VERSION = "0.1.0";

const HELP = `fragility ${VERSION} - measure how fragile AI-written code is, on the diff.

Usage:
  fragility audit [--base <ref>] [--diff <file>] [--repo <dir>]
                  [--coverage <lcov>] [--format table|json]
                  [--fail-under N] [--config <file>]
  fragility explain [tests|abstraction|comprehension|review|score]
  fragility init [dir]

Commands:
  audit     Score the four fragility modes on a git range (default:
            merge-base with main, else HEAD~1) or a diff file.
            Exit 0 = ROBUST or WATCH, 1 = FRAGILE, 2 = input error.
  explain   How a signal is measured, its thresholds, and its sources.
  init      Write fragility.config.json with the default thresholds.

Options:
  --base <ref>    Base ref for the range audit (default: merge-base).
  --diff <file>   Read a unified diff file instead of running git.
  --repo <dir>    Repo directory (default: current directory).
  --coverage <f>  LCOV file for changed-line coverage (signal 1).
  --format <f>    table (default) or json.
  --fail-under N  Exit 1 when the score is below N (default: 60).
  --config <file> Thresholds + AI markers (default: fragility.config.json).

Signals: tests, abstraction, comprehension, review. See
'fragility explain' for the measurement method of each one.`;

interface AuditOptions {
  base?: string;
  diffFile?: string;
  repo: string;
  coverageFile?: string;
  format: "table" | "json";
  failUnder: number;
  configFile?: string;
}

function parseArgs(argv: string[]): { cmd: string; opts: AuditOptions; rest: string[] } {
  const opts: AuditOptions = {
    repo: process.cwd(),
    format: "table",
    failUnder: 60,
  };
  const rest: string[] = [];
  let cmd = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "audit" || a === "explain" || a === "init") {
      cmd = a;
    } else if (a === "--base") opts.base = argv[++i];
    else if (a === "--diff") opts.diffFile = argv[++i];
    else if (a === "--repo") opts.repo = resolve(argv[++i]);
    else if (a === "--coverage") opts.coverageFile = argv[++i];
    else if (a === "--format") {
      const f = argv[++i];
      if (f !== "table" && f !== "json") throw new Error(`--format must be table or json, got "${f}"`);
      opts.format = f;
    } else if (a === "--fail-under") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n)) throw new Error("--fail-under must be a number");
      opts.failUnder = n;
    } else if (a === "--config") opts.configFile = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--version" || a === "-V") {
      console.log(`fragility ${VERSION}`);
      process.exit(0);
    } else if (a.startsWith("-")) {
      throw new Error(`unknown option "${a}" (see --help)`);
    } else {
      rest.push(a);
    }
  }
  return { cmd, opts, rest };
}

/** Content of a changed file: from disk when present, else rebuilt from the diff. */
function fileContent(repoDir: string, diffFile: { path: string; addedLines: { text: string }[] }): string | null {
  const onDisk = join(repoDir, diffFile.path);
  if (existsSync(onDisk)) {
    try {
      return readFileSync(onDisk, "utf8");
    } catch {
      return null;
    }
  }
  // New file only in the diff: the added lines ARE the file.
  return diffFile.addedLines.map((l) => l.text).join("\n") + "\n";
}

function runAudit(opts: AuditOptions): number {
  const config = loadConfig(
    opts.configFile ?? join(opts.repo, "fragility.config.json"),
  );
  const failUnder = opts.failUnder !== 60 ? opts.failUnder : config.failUnder;

  // --- 1. Get the diff -------------------------------------------------
  let diffText: string;
  let source: string;
  let gitDir: string | null = null;
  if (opts.diffFile) {
    try {
      diffText = readFileSync(opts.diffFile, "utf8");
    } catch {
      console.error(`error: cannot read diff file "${opts.diffFile}"`);
      return 2;
    }
    source = `diff file ${opts.diffFile}`;
    if (isGitRepo(opts.repo)) gitDir = opts.repo;
  } else {
    if (!isGitRepo(opts.repo)) {
      console.error(`error: "${opts.repo}" is not a git repo (use --diff <file> instead)`);
      return 2;
    }
    gitDir = opts.repo;
    const base = opts.base ?? defaultBase(opts.repo);
    const d = diffRange(opts.repo, base);
    if (d === null) {
      console.error(`error: cannot diff ${base}..HEAD in "${opts.repo}"`);
      return 2;
    }
    diffText = d;
    source = `git range ${base}..HEAD in ${opts.repo}`;
  }
  const diff: ParsedDiff = parseDiff(diffText);
  if (diff.files.length === 0) {
    console.error("error: empty diff - nothing to audit");
    return 2;
  }

  // --- 2. Signal 1: test shallowness ------------------------------------
  const codeFiles = diff.files.filter((f) => isCodeFile(f.path) && !isTestFile(f.path));
  const testFilesInDiff = diff.files.filter((f) => isTestFile(f.path));
  const allDiffPaths = diff.files.map((f) => f.path);
  const testContents: TestFileContent[] = [];
  const seenTest = new Set<string>();
  const addTestContent = (path: string, text: string) => {
    if (!seenTest.has(path)) {
      seenTest.add(path);
      testContents.push({ path, text });
    }
  };
  // Test files changed in the diff itself.
  for (const tf of testFilesInDiff) {
    const text = fileContent(opts.repo, tf);
    if (text !== null) addTestContent(tf.path, text);
  }
  // Test files on disk that cover the changed source files.
  for (const sf of codeFiles) {
    for (const cand of testCandidatesFor(sf.path, allDiffPaths)) {
      // Already covered above when the test file is in the diff.
      if (seenTest.has(cand)) continue;
      const onDisk = join(opts.repo, cand);
      if (existsSync(onDisk)) {
        try {
          addTestContent(cand, readFileSync(onDisk, "utf8"));
        } catch {
          // unreadable: skip, do not crash the audit
        }
      }
    }
  }
  const testStats = analyzeTests(testContents);
  const changedSourceLines = codeFiles.reduce((a, f) => a + f.addedLines.length, 0);

  // Optional LCOV: coverage of the changed lines only.
  let coverageRate: number | null = null;
  if (opts.coverageFile) {
    try {
      const lcov = parseLcov(readFileSync(opts.coverageFile, "utf8"));
      const cov = changedLineCoverage(
        lcov,
        codeFiles.map((f) => ({
          path: f.path,
          lineNos: f.addedLines.map((l) => l.lineNo),
        })),
      );
      coverageRate = cov.rate;
    } catch {
      console.error(`error: cannot read coverage file "${opts.coverageFile}"`);
      return 2;
    }
  }

  // --- 3. Signal 2: over-abstraction ------------------------------------
  const abstractionInputs: { path: string; text: string; changedLines: number[] }[] = [];
  for (const f of codeFiles) {
    const text = fileContent(opts.repo, f);
    if (text === null) continue;
    abstractionInputs.push({
      path: f.path,
      text,
      changedLines: f.addedLines.map((l) => l.lineNo),
    });
  }
  const abstraction = analyzeAbstraction(abstractionInputs, config.thresholds);

  // --- 4. Signal 3: comprehension debt (needs git history) --------------
  const comprehension = gitDir
    ? analyzeComprehension(
        gitDir,
        codeFiles.map((f) => ({
          path: f.path,
          lineNos: f.addedLines.map((l) => l.lineNo),
        })),
        config.markers,
      )
    : {
        orphanLines: 0,
        changedLines: 0,
        orphanRatio: 0,
        authors90d: 0,
        authorList: [],
        skipped: true,
        skipReason: "no git history",
      };

  // --- 5. Signal 4: review bottleneck ------------------------------------
  const review = analyzeReview(gitDir, diff.totalChanged);

  // --- 6. Score + output -------------------------------------------------
  const signals = [
    scoreTests(testStats, coverageRate, changedSourceLines),
    scoreAbstraction(abstraction),
    scoreComprehension(comprehension),
    scoreReview(review),
  ];
  const result = compositeScore(signals, failUnder);
  if (opts.format === "json") console.log(renderJson(result, source));
  else console.log(renderTable(result, source));
  return result.exitCode;
}

function runInit(dirArg?: string): number {
  const dir = dirArg ? resolve(dirArg) : process.cwd();
  mkdirSync(dir, { recursive: true });
  const cfgPath = join(dir, "fragility.config.json");
  if (existsSync(cfgPath)) {
    console.error(`error: ${cfgPath} already exists (refusing to overwrite)`);
    return 2;
  }
  writeFileSync(cfgPath, defaultConfigJson());
  const readme = `# fragility config\n\nThresholds and AI markers for \`fragility audit\`. Tune the numbers\nto your team; run \`fragility explain <signal>\` to see what each one\nmeans. This file is read from the repo root by default, or pass\n--config <file>.\n`;
  writeFileSync(join(dir, "fragility.config.README.md"), readme);
  console.log(`wrote ${cfgPath}`);
  console.log(`wrote ${join(dir, "fragility.config.README.md")}`);
  return 0;
}

export function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
  const { cmd, opts, rest } = parsed;
  if (!cmd) {
    console.log(HELP);
    return 0;
  }
  if (cmd === "audit") return runAudit(opts);
  if (cmd === "explain") {
    console.log(explainText(rest[0]));
    return 0;
  }
  if (cmd === "init") return runInit(rest[0]);
  console.error(`error: unknown command "${cmd}" (see --help)`);
  return 2;
}

// Run main() when this file is executed directly, including through a
// symlink on PATH (realpath resolves the symlink to dist/cli.js).
let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = "";
}
if (invoked === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
