#!/bin/bash
set -e

npm install --prefer-offline --no-audit --no-fund 2>/dev/null || npm install

# Use the migration runner (non-interactive) instead of drizzle-kit push,
# which prompts when adding unique constraints to tables with existing data.
npx tsx scripts/migrate.ts

if [ -f "server/add-indexes.sql" ]; then
  psql "$DATABASE_URL" -f server/add-indexes.sql 2>/dev/null || true
fi
psql "$DATABASE_URL" -f migrations/0009_residual_reconciliation.sql 2>/dev/null || true
