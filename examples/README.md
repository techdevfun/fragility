# Examples - provenance

All files in this directory are **synthetic seeded fixtures** (seed
20261111), written by hand for fragility's tests and worked example.
They are not a real project and not real evidence about any vendor,
team, or codebase.

- `pr-fragile.diff` - a deliberately fragile change: a checkout module
  with a 6-deep call chain, a 6-parameter 11-branch function, 3 tests
  with 2 weak assertions (one test asserts nothing), plus a small
  Python helper with a weak `assert x is not None`. Expected audit:
  FRAGILE, exit 1.
- `pr-healthy.diff` - a small well-tested change: one 8-line function,
  2 tests with 3 real assertions, one edge-case test. Expected audit:
  ROBUST, exit 0.
- `coverage-fragile.lcov` - LCOV for `pr-fragile.diff`: 23 of 38
  measurable changed lines in `src/checkout.ts` were hit (60.5%),
  1 of 2 in `src/pricing.py`.

Reproduce the worked example from the repo root:

```sh
npm run build
node dist/cli.js audit --diff examples/pr-fragile.diff
node dist/cli.js audit --diff examples/pr-fragile.diff --coverage examples/coverage-fragile.lcov
node dist/cli.js audit --diff examples/pr-healthy.diff
```
