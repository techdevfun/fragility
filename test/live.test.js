/**
 * Live smoke tests: the fragility name is free on npm and in the
 * techdevfun org. Soft-skip when offline (a network failure is not a
 * product failure). These run in CI via `npm run test:live`.
 */
import test from "node:test";
import assert from "node:assert/strict";

async function headOk(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    return res.status;
  } finally {
    clearTimeout(t);
  }
}

test("live: npm package 'fragility' is free (404)", async (t) => {
  let status;
  try {
    status = await headOk("https://registry.npmjs.org/fragility");
  } catch {
    t.skip("offline - npm registry unreachable");
    return;
  }
  assert.equal(status, 404);
});

test("live: org repo techdevfun/fragility is free (404)", async (t) => {
  let status;
  try {
    status = await headOk("https://api.github.com/repos/techdevfun/fragility");
  } catch {
    t.skip("offline - api.github.com unreachable");
    return;
  }
  assert.equal(status, 404);
});
