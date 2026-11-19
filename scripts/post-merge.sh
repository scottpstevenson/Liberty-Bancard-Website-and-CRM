#!/bin/bash
set -euo pipefail
if [ "${NODE_ENV:-development}" = production ] || [ "${REPLIT_DEPLOYMENT:-}" = 1 ]; then
  echo 'Post-merge is development-only; production schema is Publish-owned' >&2
  exit 1
fi
bash scripts/with-pinned-npm.sh ci --include=dev --ignore-scripts --prefer-offline --no-audit --no-fund
node scripts/verify-development-database.mjs
# The journal owns schema changes. Do not replay ad-hoc index/residual SQL or
# swallow DDL errors; that previously recreated equivalent legacy indexes.
node node_modules/tsx/dist/cli.mjs scripts/migrate.ts
