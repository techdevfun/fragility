/**
 * Signal 1 - TEST SHALLOWNESS.
 *
 * Counts assertions by pattern over the test files that cover the
 * changed source files. This is a heuristic, stated as such in the
 * README and in `fragility explain`: it counts what the tests assert,
 * not whether the assertions are correct. Dynamic / table-driven tests
 * may be under-counted; the LCOV option measures what actually ran.
 *
 * Languages in v0.1.0: TypeScript/JavaScript (expect/assert) and Python
 * (assert statements). A test file is linked to a changed source file
 * by name convention (foo.test.ts <-> foo.ts, test_foo.py <-> foo.py).
 */

export interface TestStats {
  testFiles: string[];
  tests: number;
  assertions: number;
  assertionsPerTest: number;
  zeroAssertionTests: number;
  weakAssertions: number;
  weakShare: number; // weak / assertions, 0 when no assertions
  edgeCaseTests: number;
  edgeShare: number;
}

// Weak matchers: they pass on almost anything and rarely catch a real
// regression. Listed here and in the README so the rule is inspectable.
const WEAK_TS = [
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
  "toBeNaN",
];
const WEAK_PY = [/assert\s+\S+\s+is\s+not\s+None\b/, /assert\s+True\b/, /assert\s+\S+\s*$/];

const EDGE_WORDS =
  /error|edge|boundar|invalid|empty|fail|exception|reject|timeout|overflow|underflow|negative|zero|missing/i;

export interface TestFileContent {
  path: string;
  text: string;
}

/** Find the test files (by name) for one changed source file. */
export function testCandidatesFor(sourcePath: string, allFiles: string[]): string[] {
  const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const base = (sourcePath.split("/").pop() ?? "").replace(/\.(ts|tsx|js|jsx|mts|cts|py)$/, "");
  const cands: string[] = [];
  const push = (p: string) => {
    if (allFiles.includes(p) && !cands.includes(p)) cands.push(p);
  };
  const join = (...parts: string[]) => parts.filter(Boolean).join("/");
  const isPy = sourcePath.endsWith(".py");
  if (!isPy) {
    for (const ext of ["ts", "tsx", "js", "jsx", "mts", "cts"]) {
      push(join(dir, `${base}.test.${ext}`));
      push(join(dir, `${base}.spec.${ext}`));
      push(join(dir, "__tests__", `${base}.test.${ext}`));
      push(join(dir, "test", `${base}.test.${ext}`));
      push(join(dir, "tests", `${base}.test.${ext}`));
    }
  } else {
    push(join(dir, `test_${base}.py`));
    push(join(dir, `${base}_test.py`));
    push(join(dir, "tests", `test_${base}.py`));
    push(join(dir, "test", `test_${base}.py`));
  }
  return cands;
}

function countTests(text: string, isPy: boolean): { tests: number; edge: number; zeroAssertion: number } {
  let tests = 0;
  let edge = 0;
  let zeroAssertion = 0;
  if (isPy) {
    const defs = text.match(/^def (test_\w+)\s*\(/gm) ?? [];
    tests = defs.length;
    for (const d of defs) {
      const name = d.replace(/^def /, "").replace(/\s*\($/, "");
      if (EDGE_WORDS.test(name)) edge++;
    }
    // Zero-assertion tests: split on def boundaries and look for assert.
    const blocks = text.split(/^def test_\w+\s*\(/m).slice(1);
    for (const b of blocks) {
      const body = b.split(/^def /m)[0];
      if (!/\bassert\b/.test(body)) zeroAssertion++;
    }
    return { tests, edge, zeroAssertion };
  }
  // JS/TS: test( / it( blocks. Split on the block start to count
  // assertions per test.
  const starts = [...text.matchAll(/\b(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g)];
  tests = starts.length;
  for (const s of starts) {
    if (EDGE_WORDS.test(s[1])) edge++;
  }
  // Assertions per test: take the text after each test( start up to the
  // next test( start (or end of file) and count assertion calls.
  const indices = [...text.matchAll(/\b(?:test|it)\s*\(/g)].map((m) => m.index ?? 0);
  indices.push(text.length);
  for (let i = 0; i < indices.length - 1; i++) {
    const body = text.slice(indices[i], indices[i + 1]);
    if (countAssertions(body, false).total === 0) zeroAssertion++;
  }
  return { tests, edge, zeroAssertion };
}

export function countAssertions(
  text: string,
  isPy: boolean,
): { total: number; weak: number } {
  let total = 0;
  let weak = 0;
  if (isPy) {
    const asserts = text.match(/^\s*assert\s+.+$/gm) ?? [];
    total = asserts.length;
    for (const a of asserts) {
      if (WEAK_PY.some((re) => re.test(a))) weak++;
    }
    return { total, weak };
  }
  // expect(x).toY(...) - count each expect( as one assertion, and
  // assert.*( calls (node:assert).
  const expects = text.match(/\bexpect\s*\(/g) ?? [];
  const nodeAsserts = text.match(/\bassert\s*\.\s*\w+\s*\(/g) ?? [];
  const bareAsserts = text.match(/(?<![\w.])assert\s*\(/g) ?? [];
  total = expects.length + nodeAsserts.length + bareAsserts.length;
  for (const w of WEAK_TS) {
    const re = new RegExp(`\\.${w}\\s*\\(`, "g");
    weak += text.match(re)?.length ?? 0;
  }
  return { total, weak };
}

export function analyzeTests(files: TestFileContent[]): TestStats {
  let tests = 0;
  let assertions = 0;
  let weak = 0;
  let zeroAssertion = 0;
  let edge = 0;
  const testFiles: string[] = [];
  for (const f of files) {
    const isPy = f.path.endsWith(".py");
    const c = countTests(f.text, isPy);
    const a = countAssertions(f.text, isPy);
    tests += c.tests;
    assertions += a.total;
    weak += a.weak;
    zeroAssertion += c.zeroAssertion;
    edge += c.edge;
    testFiles.push(f.path);
  }
  return {
    testFiles,
    tests,
    assertions,
    assertionsPerTest: tests === 0 ? 0 : assertions / tests,
    zeroAssertionTests: zeroAssertion,
    weakAssertions: weak,
    weakShare: assertions === 0 ? 0 : weak / assertions,
    edgeCaseTests: edge,
    edgeShare: tests === 0 ? 0 : edge / tests,
  };
}
