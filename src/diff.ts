/**
 * Unified diff parser. Reads `git diff` output (or a diff file) and
 * reports, per file, which lines were added and where. Only added lines
 * are scored: fragility measures what a change introduces, not the
 * surrounding file.
 */

export interface AddedLine {
  lineNo: number; // 1-based line number in the NEW file
  text: string;
}

export interface DiffFile {
  path: string;
  addedLines: AddedLine[];
  removedCount: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  addedLines: number;
  removedLines: number;
  totalChanged: number; // added + removed
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const NEW_FILE_RE = /^\+\+\+ b\/(.+)$/;
const DEV_NULL = "--- /dev/null";

export function parseDiff(text: string): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let newLine = 0;
  let inHunk = false;
  let seenDevNull = false;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      current = null;
      inHunk = false;
      seenDevNull = false;
      continue;
    }
    if (line === DEV_NULL) {
      seenDevNull = true;
      continue;
    }
    if (line.startsWith("--- ") && !seenDevNull) {
      continue;
    }
    const mNew = NEW_FILE_RE.exec(line);
    if (mNew) {
      current = { path: mNew[1], addedLines: [], removedCount: 0 };
      files.push(current);
      continue;
    }
    // Fallback for diffs without a +++ line (rare): use the diff --git line.
    if (line.startsWith("diff --git ") && !current) {
      continue;
    }
    const mHunk = HUNK_RE.exec(line);
    if (mHunk) {
      newLine = parseInt(mHunk[1], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk || !current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push({ lineNo: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removedCount++;
    } else if (line.startsWith(" ") || line === "") {
      newLine++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" - no line movement.
    }
  }

  let added = 0;
  let removed = 0;
  for (const f of files) {
    added += f.addedLines.length;
    removed += f.removedCount;
  }
  return {
    files,
    addedLines: added,
    removedLines: removed,
    totalChanged: added + removed,
  };
}

/** True for files that are source or test code we can measure. */
export function isCodeFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|py)$/.test(path);
}

/** True for test files (by name convention). */
export function isTestFile(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return (
    /\.test\.(ts|tsx|js|jsx|mts|cts)$/.test(base) ||
    /\.spec\.(ts|tsx|js|jsx|mts|cts)$/.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /.*_test\.py$/.test(base) ||
    /(^|\/)tests?\//.test(path)
  );
}
