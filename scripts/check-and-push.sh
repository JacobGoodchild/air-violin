#!/bin/sh
# Runs all tests; commits and pushes only if every test passed. Usage: scripts/check-and-push.sh "commit message"
set -e
cd "$(dirname "$0")/.."
out=$(timeout 590 npm test 2>&1 || true)
echo "$out" | grep -E "^not ok|^# (pass|fail)"
echo "$out" | grep -q "^# fail 0" || { echo "TESTS FAILED: not committing"; exit 1; }
git add -A
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019c4bPga9d32jCACJhRxzWD"
git push origin main 2>&1 | tail -1
git push origin main:claude/gracious-sagan-ajnctq 2>&1 | tail -1
