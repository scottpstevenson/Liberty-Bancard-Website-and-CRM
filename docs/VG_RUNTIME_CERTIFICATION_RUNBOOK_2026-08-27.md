# VG-01 through VG-04 Certification Runbook — 2026-08-27

## Safety contract

- Never point stateful certification commands at shared development or production databases.
- Require a distinct `TEST_DATABASE_URL`, unique `TEST_REDIS_PREFIX`, `NODE_ENV=test`, `INTEGRATION_TESTS_OPT_IN=1`, and `GHL_TRANSPORT_FAILFAST=true`.
- Use fake SMTP, SMS, GHL, ZeroBounce, Serper, Apollo, and OCR/AI transports with controlled test recipients only.
- Never clear production pause/holds, run a backfill, recompute production data, perform a live provider probe, or use `scripts/run-pre-deploy.sh` for this certification.

## 1. Freeze identity and source

```bash
git fetch origin main
git switch -c agent/vg-certification origin/main
git rev-parse HEAD
sha256sum attached_assets/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_1786901209005.md
```

Expected source checksum: `a97f1772aa6a494ac46c13009c50adade1c7c000b7df3f5eec2e5ab90dc9e897`. Leave uploaded instructions untracked.

## 2. Safe static gates

```bash
npm run check
npm run build
npx tsx scripts/ci-suite-manifest.ts --check
npx tsx scripts/check-migration-integrity.ts
npx tsx scripts/compliance-scan.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-static
npx tsx scripts/test-security-controls.ts
npx tsx scripts/scan-csrf-fetch.ts
npx tsx scripts/scan-tracked-files.ts
npx tsx scripts/scan-paid-provider-adapters.ts
npx tsx scripts/test-ghl-route-pause-gates-1629.ts
npx tsx scripts/test-sender-policy.ts
```

Also run fresh dependency, SAST, and privacy scans. Critical/high findings block release until triaged.

## 3. Disposable infrastructure and canonical migration twice

Provision PostgreSQL separately from all shared databases and an approved test Redis endpoint/namespace. Do not derive the test database by renaming the normal `DATABASE_URL`.

```bash
export NODE_ENV=test
export DATABASE_URL="$TEST_DATABASE_URL"
export TEST_REDIS_PREFIX="vg1687-unique-run-"
export REDIS_PREFIX="$TEST_REDIS_PREFIX"
export INTEGRATION_TESTS_OPT_IN=1
export GHL_TRANSPORT_FAILFAST=true

npx tsx scripts/test-infrastructure-guard.ts
npx tsx server/db-migrate.ts
npx tsx server/db-migrate.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-integration
```

Any skip, unreachable server, timeout, or unavailable fixture is a non-pass. The second migration must be a no-op.

## 4. Isolated server-required matrix

Start the app on a non-conflicting test port using only the disposable environment, then run:

```bash
npx tsx scripts/run-ci-suites.ts --capability server-required
npx tsx scripts/smoke-role-guards.ts
npx tsx scripts/test-crm-operator-experience.ts
npx tsx scripts/test-new-lead-enrollment-policy.ts
npx tsx scripts/test-pause-fence.ts
npx tsx scripts/test-pause-cycle-unit.ts
npx tsx scripts/test-contactability.ts
npx tsx scripts/test-sequence-compliance.ts
npx tsx scripts/test-provider-readiness-controls.ts
npx tsx scripts/test-bt12-revenue-state-reconciliation-integration.ts
npx tsx scripts/test-commercial-classification.ts
```

Capture exact SHA, exit code, duration, hashed test database identity, Redis prefix, fake-provider request count, and cleanup proof.

## 5. Production read-only evidence

Allowed: public GET health, deployment metadata/logs, GitHub metadata, and database-tool-enforced read-only counts, sums, or status buckets. Cap any sample at 100 and enforce a 5-second timeout where supported. Do not create a production login session without separate approval.

Collect web/worker SHA census, authenticated live-health/topology, 24-hour queue/Redis telemetry, and counts-only classification, collision, provenance, sensitive-field, ZeroBounce, readiness, scoring, GHL, and financial evidence.

## 6. VG-04 browser matrix

Use isolated admin, manager, agent A, agent B, and merchant identities. Obtain CSRF with `GET /api/csrf-token`; pass its `token` value in `X-CSRF-Token` for authenticated POST/PATCH/DELETE. Use UUIDv4 idempotency keys for statement/application submissions.

| Surface | Route | Roles and APIs | Fixtures and fakes | Screenshot checkpoints |
|---|---|---|---|---|
| Queue Holds | `/dashboard/operator?view=queue-metrics` | Admin controls; review queue admin/manager; queue metrics/history/DLQ APIs | Playwright route mocks; never pause live queues | loading, healthy, hold/epoch, DLQ, degraded, forbidden |
| Inbox | `/dashboard/comms-hub`; legacy SMS inbox redirect | Dashboard list; assignment-scoped provider actions | Synthetic inbound event and fake conversation provider | list, live refresh, partial metadata, ownership denial, empty/error |
| Ownership | contacts, contact detail, portfolio | Agent A vs agent B indirect-object access; broader admin/manager | Two-agent synthetic contact/deal/chargeback graph | owner allowed, non-owner forbidden, no data flash |
| Statement/application | `/upload-statement`, `/merchant-application`, dashboard detail | Public statement exemption only where defined; dashboard CSRF required | Synthetic PDF/CSV, fake OCR/AI/GHL/SMTP, encrypted data | upload, replay, recovery, conflict, final lineage |
| Chargebacks | dashboard chargeback list/detail | Dashboard plus parent authorization; delete admin/manager | Synthetic evidence and fake card-brand transport | list/detail, file auth, submit denial, provider failure |
| Residual/revenue | financial hub and residual views | Admin/manager import, approval, reporting | Existing reconciliation CSV fixtures in disposable DB | import, exact decimals, exclusion of non-production rows |

Capture loading, data, empty, error, forbidden, deep-link refresh, mobile/desktop shell, back, and forward states for each role.

## 7. Provider boundaries

Apollo is not configured and must not be live-probed. Configuration is independent of Outscraper. For GHL, ZeroBounce, Serper, Outscraper, SMTP, and SMS use boolean presence plus approved read-only usage/health reports only. SMS remains NO-GO until active TCR/A2P and number/location ownership are documented.

## 8. Validate and decide

```bash
npx tsx scripts/validate-vg-runtime-register.ts \
  docs/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_2026-08-27.md
```

GO requires every launch-critical row to be `PASS_CURRENT_RELEASE` for one deployed SHA/environment and not expired. Email and SMS require separate pilot evidence. Mass scale remains NO-GO until operational, data, provider, queue, UI, and finance gates pass.

## Rollback and incident triggers

Keep pauses/holds closed and stop promotion for mixed SHAs, escaped provider mutations, non-idempotent migrations, startup fail-open, absent branch protection, unaccepted critical/high findings, unclassified data, or unreconciled finance totals. Preserve failed evidence, repair on a dedicated branch, rerun CI, merge/deploy, and repeat the full register.
