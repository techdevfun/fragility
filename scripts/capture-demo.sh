#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# Runs in a scratch dir so nothing pollutes the repo. The transcript is
# rendered to demo/fragility-demo.gif by scripts/make-gif.py.
#
# The demo repo is SYNTHETIC SEEDED (scripts/make-demo-repo.sh): a
# 1,200-line AI-style change on main, and a small healthy change on
# the `healthy` branch. All numbers in the transcript come from the
# real CLI running on that repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN=/tmp/fragility-demo/bin
bash "$ROOT/scripts/make-demo-repo.sh"
mkdir -p "$BIN"
ln -sf "$ROOT/dist/cli.js" "$BIN/fragility"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

REPO=/tmp/fragility-demo/repo
OUT="$ROOT/demo/transcript.txt"
mkdir -p "$ROOT/demo"

{
  echo "# fragility demo - real CLI output on a SYNTHETIC SEEDED fixture repo"
  echo "# (seed 20261111; main = 1,199-line AI-style change, healthy = 19-line fix;"
  echo "#  see examples/README.md and scripts/make-demo-repo.sh for provenance.)"
  echo ""
  echo "\$ fragility explain"
  fragility explain
  echo ""
  echo "\$ cd demo-repo && fragility audit --base HEAD~1"
  (cd "$REPO" && fragility audit --base HEAD~1) || echo "exit: 1"
  echo ""
  echo "\$ git checkout healthy && fragility audit --base HEAD~1"
  (cd "$REPO" && git checkout -q healthy && fragility audit --base HEAD~1)
  echo "exit: 0"
  echo ""
  echo "\$ fragility audit --diff examples/pr-fragile.diff --format json"
  (cd "$ROOT" && fragility audit --diff examples/pr-fragile.diff --format json | head -12) || echo "exit: 1"
} > "$OUT" 2>&1
echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
