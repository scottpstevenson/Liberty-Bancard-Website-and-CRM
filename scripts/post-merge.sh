#!/bin/bash
set -e
npm install
npm run db:push
if [ -f "server/add-indexes.sql" ]; then
  psql "$DATABASE_URL" -f server/add-indexes.sql 2>/dev/null || true
fi
