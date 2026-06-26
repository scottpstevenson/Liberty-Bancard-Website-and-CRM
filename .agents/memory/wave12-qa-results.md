---
name: Wave 12 QA validation results and script fixes
description: Final exit codes for all 7 Wave 12 scripts; key bugs found and fixed during validation run.
---

## Wave 12 GO/NO-GO Results (June 26 2026)

All 6 functional gates exit 0. mobile-screenshots exits 2 (env limit).

| Script | Exit | Notes |
|--------|------|-------|
| compliance-scan.ts | 0 | 112/112 PASS after FILE_CONTEXT_RULES + category fixes |
| test-contactability.ts | 0 | 90/90 PASS |
| test-sequence-compliance.ts | 0 | 32/32 PASS |
| test-forms.ts | 0 | 10/10 PASS |
| seo-audit.ts | 0 | 421 routes, 0 failed |
| smoke-role-guards.ts | 0 | 45/45 PASS |
| mobile-screenshots.ts | 2 | Playwright env limit (not a test failure) |

## Key bugs fixed during validation

### db.execute() destructuring pattern
`const [x] = await db.execute(sql\`...\`)` fails with "not iterable" because
Drizzle+node-postgres returns a QueryResult object, not an array.
**Fix:** `const raw = await db.execute(...); const rows = Array.isArray(raw) ? raw : raw?.rows ?? []; const row = rows[0];`

### statement-upload route uses multipart/form-data
`POST /api/public/statement-upload` uses `upload.single("statementFile")` (multer).
JSON payloads return 400. Use FormData with a Blob for `statementFile`.
Fields: `contactName`, `mobile` (not `firstName`/`phone`).

### merchant_documents table does not exist
The API route prefix is `/api/merchant-documents` but the DB table is `documents`.
No separate `merchant_documents` table exists.

### sdr_merchants missing owner_first_name / owner_last_name
Schema defined them but no migration added them. Migration 0042 added them.

### compliance-scan.ts FILE_CONTEXT_RULES
The 120-line scan window misses top-level pipeline gates (SDR orchestrator,
campaign engine, sequence-worker). Added FILE_CONTEXT_RULES map with
pipeline_gated / admin_gated / transactional / sequence_worker contexts.
Any new send site added to an ungated file should be added to FILE_CONTEXT_RULES.
