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
#
# GHL isolation (C-03, #1626): this wrapper starts the test server with
# GHL_TRANSPORT_FAILFAST=true, which installs a fail-fast fake transport at the
# server fetch boundary — any real GHL API call throws TestTransportError.
# This replaces the old GHL_TEST_MODE flag (which no server code consumed).
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

# ── 1. Pre-flight: ensure port 5000 is free ───────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo " Liberty Bancard — Pre-Deploy Wrapper"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "▶  Checking port 5000 availability…"
_PORT_BUSY=0
if command -v lsof >/dev/null 2>&1; then
  lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1 && _PORT_BUSY=1 || true
elif command -v ss >/dev/null 2>&1; then
  ss -tlnH 'sport = :5000' 2>/dev/null | grep -q ':5000' && _PORT_BUSY=1 || true
fi
if [ "$_PORT_BUSY" -eq 1 ]; then
  echo ""
  echo "✗  Port 5000 is already in use. The pre-deploy gate starts its own server"
  echo "   and cannot share the port. Stop any existing server and try again."
  echo "   (Run: lsof -i :5000   to see what is using the port)"
  exit 1
fi
echo "   ✓ Port 5000 is free"
echo ""

# ── 2. Start the dev server in the background ─────────────────────────────────
# GHL_TRANSPORT_FAILFAST installs the fail-fast fake GHL transport (C-03).
echo "▶  Starting dev server (npm run dev) with GHL_TRANSPORT_FAILFAST=true…"
GHL_TRANSPORT_FAILFAST=true npm run dev &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# ── 3. Wait for the health endpoint ──────────────────────────────────────────
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

# ── 4. Verify the server process we started is still alive ───────────────────
# If another process was already on port 5000 (stale server), curl would have
# returned 200 against that process, not ours. Confirming our PID is still live
# catches the race between the port check and the server start.
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo ""
  echo "✗  Server process (pid $SERVER_PID) exited before or during the health poll."
  echo "   Another server may have been occupying port 5000 and responded instead."
  echo "   Ensure port 5000 is free before running this script."
  exit 1
fi

# Give Express an extra moment to finish registering all routes/middleware.
sleep 3
echo "   ✓ Server ready at ${BASE_URL} (pid $SERVER_PID)"
echo ""

# ── 5. SHA verification (if RELEASE_SHA is set) ───────────────────────────────
# Compares the sha field returned by /api/health to RELEASE_SHA to confirm the
# health endpoint is being served by the process we just started, not a stale one.
if [ -n "${RELEASE_SHA:-}" ]; then
  echo "▶  Verifying server SHA (RELEASE_SHA=${RELEASE_SHA:0:12}…)…"
  _SERVER_SHA=$(curl -sf --max-time 5 "${HEALTH_URL}" 2>/dev/null \
    | grep -o '"sha":"[^"]*"' | sed 's/"sha":"//;s/"//' || true)
  if [ -z "$_SERVER_SHA" ]; then
    echo "   ⚠  /api/health did not return a 'sha' field — skipping SHA comparison."
  elif [ "$_SERVER_SHA" != "$RELEASE_SHA" ]; then
    echo ""
    echo "✗  SHA mismatch: server returned sha=${_SERVER_SHA}"
    echo "   Expected RELEASE_SHA=${RELEASE_SHA}"
    echo "   The server may be a stale instance from a prior run."
    exit 1
  else
    echo "   ✓ Server SHA matches RELEASE_SHA (${RELEASE_SHA:0:12}…)"
  fi
  echo ""
fi

# ── 6. Run the pre-deploy gate ────────────────────────────────────────────────
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
