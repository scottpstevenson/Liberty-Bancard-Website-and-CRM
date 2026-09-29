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

# ── 1. Pre-flight: refuse an occupied configured port ─────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo " Liberty Bancard — Pre-Deploy Wrapper"
echo "══════════════════════════════════════════════════════════════"
echo ""
SERVER_PORT="$(node -e 'const u=new URL(process.argv[1]); console.log(u.port || (u.protocol === "https:" ? "443" : "80"))' "$BASE_URL")"
echo "▶  Confirming configured port ${SERVER_PORT} is unoccupied…"

_get_port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -Pi :"$SERVER_PORT" -sTCP:LISTEN -t 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnpH "sport = :${SERVER_PORT}" 2>/dev/null \
      | grep -oP 'pid=\K[0-9]+' || true
  fi
}

_OCCUPYING_PIDS=$(_get_port_pids)
if [ -n "$_OCCUPYING_PIDS" ]; then
  echo "✗  Configured port ${SERVER_PORT} is already owned by another process."
  echo "   Refusing to signal or evict unowned pid(s): $_OCCUPYING_PIDS"
  exit 1
fi
echo "   ✓ Port ${SERVER_PORT} is free"
echo ""

# ── 2. Start the dev server in the background ─────────────────────────────────
# REL-02: the launched server must sit fully inside the repository's zero-egress
# test boundary, not just GHL_TRANSPORT_FAILFAST. VG_PROVIDER_DENY_MODE=1 is the
# canonical deny gate consumed at server/index.ts (skips live GHL/health-monitor
# provider sweeps) and server/services/queue-manager.ts (skips the operational
# provider sweep). NODE_ENV=test, SUNBIZ_ENRICHMENT_ENABLED=false, and
# SERPER_GATEWAY_ENABLED=false close the remaining live-provider surfaces this
# server could otherwise reach. This does not replace GHL_TRANSPORT_FAILFAST —
# both are required, the same pairing scripts/certification-process-env.ts
# enforces for disposable certification children.
#
# BUG FIX (Liberty Bancard enrichment completion, continuation): SERVER_PORT is
# derived from BASE_URL above and used for the port pre-flight check, but was
# never exported to this child process — server/index.ts binds
# `process.env.PORT || "5000"`, so the spawned server always bound the
# hardcoded default 5000 regardless of BASE_URL. In a workspace where the
# "Start application" workflow is already listening on 5000, this either
# collides outright or (depending on process/port timing) lets the health
# check and SHA-verification step observe THAT already-running process
# instead of the one this script just started — producing a spurious
# "SHA mismatch" that has nothing to do with the code under test. Exporting
# PORT=$SERVER_PORT makes the spawned server actually honor BASE_URL, so this
# gate can run isolated on a free port alongside an already-running dev server.
echo "▶  Starting dev server with zero-egress provider denial and disposable statement test storage…"
# Export (not just prefix) the deny-mode env so it (a) is NOT clobbered by
# `npm run dev`'s own hardcoded `NODE_ENV=development` — npm scripts execute
# their command string verbatim in a subshell, so a prefix on `npm run dev`
# itself would be overridden by that inline assignment — and (b) survives into
# `npx tsx scripts/pre-deploy.ts` below, whose `runSuite()` spreads
# `process.env` into every mandatory-suite child process. Running the server
# via `tsx server/index.ts` directly (bypassing the `dev` npm script) means
# our exported NODE_ENV=test is what the server actually sees.
export PORT="$SERVER_PORT"
export NODE_ENV=test
export VG_PROVIDER_DENY_MODE=1
export GHL_TRANSPORT_FAILFAST=true
export EMAIL_TRANSPORT_FAILFAST=true
export SMS_TRANSPORT_FAILFAST=true
export SUNBIZ_ENRICHMENT_ENABLED=false
export SERPER_GATEWAY_ENABLED=false
export STATEMENT_COMMAND_TEST_STORAGE=true
npx tsx server/index.ts &
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

# ── 4b. Prove the zero-egress/test posture, not just assume it (REL-02) ──────
# A regression here (e.g. a future edit reintroducing `npm run dev`, or an env
# var typo) must fail the gate loudly instead of silently running mandatory
# suites against a live-provider server.
echo "▶  Verifying the launched server actually reports the zero-egress/test posture…"
_HEALTH_BODY=$(curl -sf --max-time 5 "${HEALTH_URL}" 2>/dev/null || true)
_HEALTH_ENV=$(echo "$_HEALTH_BODY" | grep -o '"env":"[^"]*"' | sed 's/"env":"//;s/"//')
_HEALTH_GHL_FAILFAST=$(echo "$_HEALTH_BODY" | grep -o '"ghlTransportFailFast":[a-z]*' | sed 's/"ghlTransportFailFast"://')
if [ "$_HEALTH_ENV" != "test" ]; then
  echo ""
  echo "✗  Server reports env=\"${_HEALTH_ENV:-<missing>}\", expected \"test\"."
  echo "   The zero-egress boundary is not in effect — refusing to run mandatory suites."
  exit 1
fi
if [ "$_HEALTH_GHL_FAILFAST" != "true" ]; then
  echo ""
  echo "✗  Server reports ghlTransportFailFast=${_HEALTH_GHL_FAILFAST:-<missing>}, expected true."
  echo "   GHL fail-fast transport is not installed — refusing to run mandatory suites."
  exit 1
fi
if [ "${VG_PROVIDER_DENY_MODE:-}" != "1" ]; then
  echo ""
  echo "✗  VG_PROVIDER_DENY_MODE is not set to 1 in this wrapper's own environment."
  echo "   scripts/pre-deploy.ts's runSuite() spreads process.env into every mandatory"
  echo "   suite subprocess, so an unset value here means suites would run undenied too."
  exit 1
fi
echo "   ✓ env=test, ghlTransportFailFast=true, VG_PROVIDER_DENY_MODE=1 (inherited by pre-deploy.ts suite subprocesses)"
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
