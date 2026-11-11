#!/usr/bin/env bash
# Build the synthetic seeded demo git repo in /tmp/fragility-demo/repo.
# Fixed author/date/message so the repo is identical on every run.
# Commits:
#   1. baseline (human): cart.ts + cart.test.ts
#   2. fragile PR (AI-marked): checkout module + discount rules + shallow tests
#   3. healthy branch (human, from baseline): format.ts + format.test.ts
# Dates are fixed to 2026-11-11 so the 30d/90d git windows in the demo
# see the commits; re-running later will change velocity numbers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=/tmp/fragility-demo/repo
rm -rf /tmp/fragility-demo
mkdir -p "$WORK"
node "$ROOT/scripts/gen-demo-fixture.js" "$WORK"

export GIT_AUTHOR_NAME="Ada Dev"
export GIT_AUTHOR_EMAIL="ada@example.com"
export GIT_COMMITTER_NAME="Ada Dev"
export GIT_COMMITTER_EMAIL="ada@example.com"
export GIT_AUTHOR_DATE="2026-11-11T09:00:00+07:00"
export GIT_COMMITTER_DATE="2026-11-11T09:00:00+07:00"

cd "$WORK"
git init -b main -q
git add src/cart.ts src/cart.test.ts
git commit -q -m "Add cart total with tests"

export GIT_AUTHOR_DATE="2026-11-11T10:00:00+07:00"
export GIT_COMMITTER_DATE="2026-11-11T10:00:00+07:00"
git add src/checkout.ts src/checkout.test.ts src/pricing.py src/test_pricing.py src/discount-rules.ts
git commit -q -m "Add checkout v2 (Co-Authored-By: Claude Sonnet 4.5)"

git checkout -q -b healthy HEAD~1
git checkout -q main
# healthy branch: small focused change from the baseline
mkdir -p /tmp/fragility-demo/healthy
node -e "
const fs = require('fs');
const diff = fs.readFileSync('$ROOT/examples/pr-healthy.diff', 'utf8');
const files = {};
let cur = null, inHunk = false;
for (const raw of diff.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (line.startsWith('diff --git ')) { cur = null; inHunk = false; continue; }
  const m = /^\+\+\+ b\/(.+)$/.exec(line);
  if (m) { cur = m[1]; files[cur] = []; continue; }
  if (/^@@ /.test(line)) { inHunk = true; continue; }
  if (!inHunk || !cur) continue;
  if (line.startsWith('+') && !line.startsWith('+++')) files[cur].push(line.slice(1));
}
for (const [p, lines] of Object.entries(files)) {
  fs.mkdirSync('/tmp/fragility-demo/healthy/' + p.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync('/tmp/fragility-demo/healthy/' + p, lines.join('\n') + '\n');
}
"
cp /tmp/fragility-demo/healthy/src/format.ts "$WORK/src/format.ts"
cp /tmp/fragility-demo/healthy/src/format.test.ts "$WORK/src/format.test.ts"
git checkout -q healthy
export GIT_AUTHOR_DATE="2026-11-11T11:00:00+07:00"
export GIT_COMMITTER_DATE="2026-11-11T11:00:00+07:00"
git add src/format.ts src/format.test.ts
git commit -q -m "Add USD formatter with edge-case tests"
git checkout -q main
echo "demo repo ready: $WORK (main = fragile PR, healthy = small fix)"
