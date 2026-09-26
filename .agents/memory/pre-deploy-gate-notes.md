---
name: pre-deploy gate cascade & baseline noise
description: how to interpret pre-deploy.ts failures — missing journal entries cascade broadly, and a large fixed set of suites fail regardless of your change
---
- A new file in migrations/ root with no matching migrations/meta/_journal.json entry fails check-migration-integrity.ts, which cascades into unrelated-looking downstream suite failures in the same pre-deploy run. Always add the journal entry (idx/when/tag) in the same commit as any new migration file.
- This project's full `pre-deploy` gate has a large pre-existing set of suite failures unrelated to any specific change (e.g. static regex checks against unrelated source, migrations 0279–0292 missing seed-registration entries). Before assuming your change broke something, run the specific failing script directly (e.g. `npx tsx scripts/check-migration-integrity.ts`, `node scripts/test-sfp-pipeline-correction.mjs`) to see if the failure references your files at all.
- The gate starts its own dev server and runs disposable-DB suites against it concurrently; do not conflate this with the separate "Start application" workflow being live.
