/**
 * Small git wrapper. Every call is a read-only git command run in the
 * target repo directory; any failure returns null instead of throwing,
 * so the audit can degrade gracefully (signals that need git history
 * report "skipped" rather than crashing the whole run).
 */
import { execFileSync } from "node:child_process";

export function runGit(repoDir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

export function isGitRepo(dir: string): boolean {
  return runGit(dir, ["rev-parse", "--git-dir"]) !== null;
}

/** Default base for a range audit: merge-base with main, else HEAD~1. */
export function defaultBase(repoDir: string): string {
  const mb = runGit(repoDir, ["merge-base", "HEAD", "main"]);
  if (mb && mb.trim()) return mb.trim();
  const mbMaster = runGit(repoDir, ["merge-base", "HEAD", "master"]);
  if (mbMaster && mbMaster.trim()) return mbMaster.trim();
  return "HEAD~1";
}

/** Unified diff for base..HEAD. */
export function diffRange(repoDir: string, base: string): string | null {
  return runGit(repoDir, ["diff", "--no-color", `${base}..HEAD`]);
}

/**
 * blame for one file: returns a map from new-file line number to the
 * commit hash that last touched it. Only the lines we ask about are
 * returned (the caller filters to added lines).
 */
export function blameLines(
  repoDir: string,
  file: string,
  lineNos: number[],
): Map<number, string> | null {
  const out = new Map<number, string>();
  if (lineNos.length === 0) return out;
  // Blame the whole file once; ranges per line would be one git call
  // per line. Files in a diff are small enough for a single blame.
  const raw = runGit(repoDir, ["blame", "--porcelain", "--", file]);
  if (raw === null) return null;
  const lines = raw.split("\n");
  const wanted = new Set(lineNos);
  for (const l of lines) {
    // Porcelain header: <hash> <orig-line> <final-line> <num-lines>.
    // The block covers final-line .. final-line + num-lines - 1, all
    // from the same commit.
    const mHash = /^([0-9a-f]{40}) \d+ (\d+) (\d+)/.exec(l);
    if (mHash) {
      const hash = mHash[1];
      const first = parseInt(mHash[2], 10);
      const count = parseInt(mHash[3], 10);
      for (let ln = first; ln < first + count; ln++) {
        if (wanted.has(ln)) out.set(ln, hash);
      }
      continue;
    }
  }
  return out;
}

export interface CommitInfo {
  hash: string;
  authorEmail: string;
  authorName: string;
  date: string; // YYYY-MM-DD
  subject: string;
  /**
   * Full commit message (subject + body), whitespace-normalised.
   * Marker matching MUST run against this, not the subject alone:
   * the real-world convention puts `Co-Authored-By:` trailers in
   * the commit BODY, never the subject. The subject stays available
   * for display; it is a prefix of the message, never the match text.
   */
  message: string;
}

/**
 * One git log call returning every commit's full message + author +
 * date. Records are separated by %x1e (a byte that cannot appear in
 * a commit message) because %B spans lines; fields by %x00.
 */
export function logCommits(repoDir: string, sinceDays?: number): CommitInfo[] {
  const args = ["log", "--format=%H%x00%an%x00%ae%x00%ad%x00%s%x00%B%x1e", "--date=short"];
  if (sinceDays !== undefined) args.push(`--since=${sinceDays} days ago`);
  const raw = runGit(repoDir, args);
  if (raw === null) return [];
  const out: CommitInfo[] = [];
  for (const record of raw.split("\x1e")) {
    if (!record.trim()) continue;
    const parts = record.split("\x00");
    if (parts.length < 6) continue;
    out.push({
      hash: parts[0],
      authorName: parts[1],
      authorEmail: parts[2],
      date: parts[3],
      subject: parts[4],
      message: parts[5].replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/**
 * Distinct author emails touching the given paths in the last N days.
 * Path-scoped, so the count describes the changed files, not the repo.
 */
export function authorsForFiles(repoDir: string, files: string[], days: number): string[] {
  if (files.length === 0) return [];
  const raw = runGit(repoDir, [
    "log",
    `--since=${days} days ago`,
    "--format=%ae",
    "--",
    ...files,
  ]);
  if (raw === null) return [];
  return [...new Set(raw.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}

/**
 * Lines added + deleted per day over the last N days, from --numstat.
 * Returns total changed lines and the number of days that actually had
 * commits (so a quiet repo is not punished for a short history).
 */
export function velocityLines(repoDir: string, days: number): { lines: number; activeDays: number } {
  const raw = runGit(repoDir, [
    "log",
    `--since=${days} days ago`,
    "--numstat",
    "--format=%ad",
    "--date=short",
  ]);
  if (raw === null) return { lines: 0, activeDays: 0 };
  let lines = 0;
  const daysSeen = new Set<string>();
  let currentDay = "";
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    const mStat = /^(\d+)\t(\d+)\t/.exec(l);
    if (mStat) {
      lines += parseInt(mStat[1], 10) + parseInt(mStat[2], 10);
      if (currentDay) daysSeen.add(currentDay);
      continue;
    }
    const mDate = /^\d{4}-\d{2}-\d{2}$/.exec(l.trim());
    if (mDate) currentDay = mDate[0];
  }
  return { lines, activeDays: daysSeen.size };
}
