/**
 * Signal 2 - OVER-ABSTRACTION.
 *
 * Regex-based metrics over the TS/JS functions that contain added
 * lines: delegation depth (longest chain of calls to locally defined
 * functions), parameter count, branch count, function length. This is
 * NOT a full AST analysis - thresholds are conservative and a flagged
 * function is a prompt to look, not a verdict on its own. Python
 * abstraction analysis is roadmap; v0.1.0 measures TS/JS only.
 */

export interface FunctionMetric {
  name: string;
  file: string;
  line: number;
  params: number;
  branches: number;
  length: number;
  depth: number; // delegation depth (1 = calls no local function)
  flagged: boolean;
  reasons: string[];
}

export interface AbstractionResult {
  functions: FunctionMetric[];
  flaggedCount: number;
  maxDepth: number;
}

export interface Thresholds {
  depth: number;
  params: number;
  branches: number;
  length: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  depth: 4,
  params: 5,
  branches: 10,
  length: 80,
};

const BRANCH_RE = /\b(if|else\s+if|for|while|switch|case|catch)\b|&&|\|\||\?[^:?]+:/g;

interface FnDef {
  name: string;
  params: string;
  startLine: number; // 1-based, line of the opening brace
  bodyStart: number; // index into the text where the body starts
  bodyEnd: number; // index just past the matching closing brace
  body: string;
}

/** Extract function definitions from a TS/JS file's text. */
export function extractFunctions(text: string): FnDef[] {
  const lines = text.split("\n");
  const defs: FnDef[] = [];
  // function name(params) { | const name = (params) => { | name(params) { (method)
  const patterns: { re: RegExp; nameIdx: number; paramsIdx: number }[] = [
    { re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/g, nameIdx: 1, paramsIdx: 2 },
    { re: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^{]+)?=>\s*\{/g, nameIdx: 1, paramsIdx: 2 },
    { re: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/g, nameIdx: 1, paramsIdx: 2 },
    { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/gm, nameIdx: 1, paramsIdx: 2 },
  ];
  const seen = new Set<string>();
  // Keywords that look like a method header but are control flow.
  const RESERVED = new Set([
    "if", "else", "for", "while", "switch", "catch", "return", "do",
    "try", "finally", "with", "class", "function",
  ]);
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const name = m[p.nameIdx];
      if (RESERVED.has(name)) continue;
      const params = m[p.paramsIdx];
      const braceIdx = text.indexOf("{", m.index + m[0].length - 1);
      if (braceIdx === -1) continue;
      const key = `${name}@${braceIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Brace-match to find the body end.
      let depth = 0;
      let i = braceIdx;
      let inStr: string | null = null;
      let escaped = false;
      for (; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === inStr) inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      const body = text.slice(braceIdx + 1, i);
      const startLine = text.slice(0, braceIdx).split("\n").length;
      void lines;
      defs.push({ name, params, startLine, bodyStart: braceIdx + 1, bodyEnd: i, body });
    }
  }
  return defs.sort((a, b) => a.startLine - b.startLine);
}

/** Count calls to locally defined functions inside a body. */
function localCalls(body: string, localNames: Set<string>): string[] {
  const out: string[] = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (localNames.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

export function analyzeAbstraction(
  files: { path: string; text: string; changedLines: number[] }[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): AbstractionResult {
  const functions: FunctionMetric[] = [];
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx|mts|cts)$/.test(f.path)) continue;
    const defs = extractFunctions(f.text);
    const names = new Set(defs.map((d) => d.name));
    // Call graph: name -> names it calls.
    const graph = new Map<string, string[]>();
    for (const d of defs) graph.set(d.name, localCalls(d.body, names));
    const depthOf = (name: string, seen: Set<string>): number => {
      if (seen.has(name)) return 1; // cycle guard
      seen.add(name);
      const calls = graph.get(name) ?? [];
      let best = 1;
      for (const c of calls) best = Math.max(best, 1 + depthOf(c, new Set(seen)));
      return best;
    };
    for (const d of defs) {
      const endLine = d.startLine + d.body.split("\n").length;
      const touchesChange = f.changedLines.some(
        (ln) => ln >= d.startLine && ln <= endLine,
      );
      if (!touchesChange) continue;
      const params =
        d.params.trim() === ""
          ? 0
          : d.params.split(",").filter((p) => p.trim() !== "").length;
      const branches = d.body.match(BRANCH_RE)?.length ?? 0;
      const length = d.body.split("\n").length;
      const depth = depthOf(d.name, new Set());
      const reasons: string[] = [];
      if (depth >= thresholds.depth) reasons.push(`call depth ${depth} >= ${thresholds.depth}`);
      if (params >= thresholds.params) reasons.push(`${params} params >= ${thresholds.params}`);
      if (branches >= thresholds.branches) reasons.push(`${branches} branches >= ${thresholds.branches}`);
      if (length > thresholds.length) reasons.push(`${length} lines > ${thresholds.length}`);
      functions.push({
        name: d.name,
        file: f.path,
        line: d.startLine,
        params,
        branches,
        length,
        depth,
        flagged: reasons.length > 0,
        reasons,
      });
    }
  }
  return {
    functions,
    flaggedCount: functions.filter((f) => f.flagged).length,
    maxDepth: functions.reduce((m, f) => Math.max(m, f.depth), 0),
  };
}
