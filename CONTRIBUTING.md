# Contributing

fragility is a small, focused CLI. Contributions are welcome if they
keep it that way.

- Keep it zero-dependency and offline. No network calls, no API keys,
  no telemetry, ever.
- Every measurement must be deterministic and explainable: if a number
  cannot be reproduced from the same inputs, it does not belong here.
  Document the formula in `src/explain.ts` and in the README.
- New signals start as a documented heuristic with both-direction
  tests (a case the signal must catch, and a case it must not flag).
- Run `npm run build`, `npm test`, and `node scripts/preflight.js`
  before opening a PR. The preflight is a hard gate: all public
  content is ASCII-only English.
- Fixtures are synthetic and seeded. Never commit real code, real
  commit messages, or real author names as fixtures.
