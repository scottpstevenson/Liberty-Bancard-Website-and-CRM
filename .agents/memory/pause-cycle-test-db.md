---
name: Pause-cycle unit test DB setup
description: How to run scripts/test-pause-cycle-unit.ts — throwaway DB, env guards, schema-drift gotcha
---
Run: create a throwaway DB on the dev cluster (e.g. `pause_unit_test`), load schema via `pg_dump --schema-only $DATABASE_URL | psql <test-url>`, then:
`NODE_ENV=test TEST_DATABASE_URL=<url> TEST_APPROVED_DB_NAME=<dbname> TEST_REDIS_PREFIX=pause-unit-test-$(date +%s) INTEGRATION_TESTS_OPT_IN=1 npx tsx scripts/test-pause-cycle-unit.ts`

**Why:** the script refuses to run without all four guards and needs a distinct DB (identity proven via current_database()).
**Gotchas:** schema drift breaks fixture seeding silently later (contacts.phone became NOT NULL and broke the seed once); worker fixtures need a real active follow_up_sequences row + 'wait'-type steps (DB-only, no contactability gate) and nextActionAt in the past; triggerConfig {category:"operations"} skips arbitration.
