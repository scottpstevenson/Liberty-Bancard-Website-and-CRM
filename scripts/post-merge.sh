#!/bin/bash
set -e
npm install --prefer-offline --no-audit --no-fund 2>/dev/null || npm install
npm run db:push 2>/dev/null || npx drizzle-kit push --force 2>/dev/null || true
if [ -f "server/add-indexes.sql" ]; then
  psql "$DATABASE_URL" -f server/add-indexes.sql 2>/dev/null || true
fi
