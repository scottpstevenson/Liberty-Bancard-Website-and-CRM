#!/usr/bin/env bash
# scripts/run-pre-deploy.sh — Pre-deploy gate wrapper
#
# Starts the dev server, waits for it to be ready, runs scripts/pre-deploy.ts,
# then terminates the server on exit (success, failure, or signal).
#
# Usage:
#   bash scripts/run-pre-deploy.sh
#
# Environment overrides (optional):
#   BASE_URL          Server base URL (default: http://localhost:5000)
#   MAX_WAIT_SECS     Seconds to wait for the server to become ready (default: 90)
#   GHL_TEST_MODE     Set to "true" to isolate GHL calls (passed through to gate)
#
# Why a wrapper instead of running pre-deploy.ts directly:
#   Four mandatory suites (Role Guards, SEO Audit, Sequence Compliance, and
#   New-Lead Enrollment Policy) connect to the dev server and cannot be silently
#   skipped — running pre-deploy.ts without a server causes an immediate exit 1.
#   This wrapper ensures the server is always up before the gate starts.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
HEALTH_URL="${BASE_URL}/api/health"
MAX_WAIT_SECS="${MAX_WAIT_SECS:-90}"

SERVER_PID=""

cleanup() {
  local exit_code=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "── Stopping dev server (pid $SERVER_PID) ──"
    kill "$SERVER_PID" 2>/dev/null || true
    # Give the server up to 5 s to shut down gracefully before force-killing.
    local waited=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ $waited -lt 5 ]; do
      sleep 1
      ((waited++)) || true
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "   Server stopped."
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── 1. Start the dev server in the background ─────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo " Liberty Bancard — Pre-Deploy Wrapper"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "▶  Starting dev server (npm run dev)…"
npm run dev &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# ── 2. Wait for the health endpoint ──────────────────────────────────────────
echo "▶  Waiting for ${HEALTH_URL} (up to ${MAX_WAIT_SECS}s)…"
DEADLINE=$(( SECONDS + MAX_WAIT_SECS ))
READY=0
while [ $SECONDS -lt $DEADLINE ]; do
  if curl -sf --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  # Exit early if the server process died.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "✗  Server process exited unexpectedly before becoming ready."
    exit 1
  fi
  sleep 2
done

if [ $READY -ne 1 ]; then
  echo ""
  echo "✗  Server did not become ready within ${MAX_WAIT_SECS}s."
  echo "   Check the server logs for startup errors and try again."
  exit 1
fi

# Give Express an extra moment to finish registering all routes/middleware.
sleep 3
echo "   ✓ Server ready at ${BASE_URL}"
echo ""

# ── 3. Run the pre-deploy gate ────────────────────────────────────────────────
# IMPORTANT: Do NOT set INTEGRATION_TESTS_OPT_IN here. The isolated pause
# state-machine test (scripts/test-pause-cycle-unit.ts) requires a separate
# test database and Redis prefix, and must never run in ordinary CI without
# explicit operator action. If you need to run the isolated test, set:
#   NODE_ENV=test TEST_DATABASE_URL=<test-db> TEST_REDIS_PREFIX=<prefix>
#   INTEGRATION_TESTS_OPT_IN=1 npx tsx scripts/pre-deploy.ts
# (Do NOT add INTEGRATION_TESTS_OPT_IN to this wrapper script.)
echo "▶  Running pre-deploy gate (scripts/pre-deploy.ts)…"
echo ""
npx tsx scripts/pre-deploy.ts

# The cleanup trap handles server teardown on both success and failure.
