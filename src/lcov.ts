/**
 * LCOV parser. Reads a coverage tracefile and reports, per source file,
 * which lines were executed (hit count > 0). Only the lines the diff
 * added are scored, so a high whole-repo percentage cannot hide an
 * untested change.
 */

export interface LcovFile {
  path: string;
  /** line number -> hit count */
  lines: Map<number, number>;
}

export function parseLcov(text: string): Map<string, LcovFile> {
  const files = new Map<string, LcovFile>();
  let current: LcovFile | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const p = line.slice(3);
      current = { path: p, lines: new Map() };
      files.set(p, current);
    } else if (line.startsWith("DA:") && current) {
      const parts = line.slice(3).split(",");
      const no = parseInt(parts[0], 10);
      const hits = parseInt(parts[1], 10);
      if (!Number.isNaN(no) && !Number.isNaN(hits)) current.lines.set(no, hits);
    } else if (line === "end_of_record") {
      current = null;
    }
  }
  return files;
}

/**
 * Coverage of the CHANGED lines only. A changed line counts as covered
 * when the report lists it with hits > 0. Lines the report does not
 * mention (comments, blanks, declarations) are excluded from the
 * denominator, so the number is honest about what the report can see.
 */
export function changedLineCoverage(
  lcov: Map<string, LcovFile>,
  changed: { path: string; lineNos: number[] }[],
): { covered: number; measurable: number; rate: number | null } {
  let covered = 0;
  let measurable = 0;
  for (const c of changed) {
    // Match by suffix: reports often carry an absolute or prefixed path.
    let entry: LcovFile | undefined;
    for (const [p, f] of lcov) {
      if (p === c.path || p.endsWith("/" + c.path) || c.path.endsWith("/" + p)) {
        entry = f;
        break;
      }
    }
    if (!entry) continue;
    for (const no of c.lineNos) {
      const hits = entry.lines.get(no);
      if (hits === undefined) continue; // not executable / not in report
      measurable++;
      if (hits > 0) covered++;
    }
  }
  return {
    covered,
    measurable,
    rate: measurable === 0 ? null : covered / measurable,
  };
}
