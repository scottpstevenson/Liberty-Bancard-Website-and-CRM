# Liberty Bancard Runtime Evidence Packet

**Target SHA:** `68eae86cbb938c6448de7ae792c24381177263f7`  
**Evidence captured:** 2026-08-16T16:05:00Z – 16:12:00Z (America/New_York = 12:05–12:12 ET)  
**Auditor:** Replit Agent (read-only; no mutations performed)  
**Register version:** LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER (2026-08-16)  

---

## Section 0 — Environment Baseline

| Field | Observed value |
|---|---|
| Local workspace HEAD SHA | `cf055e0c7217b272b28b4f2774b1cd43091667f7` ("Published your App" — **1 commit ahead of target**) |
| `origin/main` SHA | `68eae86cbb938c6448de7ae792c24381177263f7` ✓ matches target |
| SHA match for deployed process | **INDETERMINATE** — `/api/health` returns `{"status":"ok"}` with no SHA field; no build-metadata endpoint found; no `GIT_SHA` / `RENDER_GIT_COMMIT` / `REPLIT_DEPLOYMENT` env var present |
| `NODE_ENV` | `undefined` (not set in environment) |
| Database host (redacted) | `postgresql://***@helium/***` |
| Redis host (redacted) | `rediss://***@moved-goldfish-143136.upstash.io:6379/***` (Upstash) |
| Environment inspected | Replit dev workspace + shared development database + shared Upstash Redis |

**SHA integrity note:** The local Replit workspace is running from `cf055e0c`, which adds a "Published your App" commit on top of the target `68eae86c`. The running dev server process is therefore NOT at the audited SHA. `origin/main` is correctly at the target SHA. All checks below are performed against the shared development database and Redis as populated by code that may include `cf055e0c`-era behaviour. Every result is labelled accordingly.

---

## P0 — #1548 and Outbound Safety

### RV-1548-01 — Exact release deployed

| Field | Value |
|---|---|
| **RV ID** | RV-1548-01 |
| **Related finding IDs** | QUE-08, SEC-03 |
| **Verdict** | **FAIL** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | Replit dev workspace |
| **Method** | `git rev-parse HEAD`, `git rev-parse origin/main`, `curl /api/health` |
| **Observed result** | Local HEAD: `cf055e0c` (1 commit ahead). `origin/main`: `68eae86c` (target). `/api/health` returns `{"status":"ok"}` — no SHA exposed. No `GIT_SHA` env var set. |
| **Expected condition** | Every outbound-capable process reports full SHA `68eae86c…`; no mixed old process. |
| **Evidence** | `git log --oneline -3` → `cf055e0c Published your App`, `68eae86c 1548D: Bounded domain backlog preview…`. Health endpoint: `{"status":"ok"}`. |
| **Residual uncertainty** | The production deployment (Replit published app) was not independently verified — it may be running `68eae86c` from a prior publish, or `cf055e0c`. The dev server in this workspace is definitively at `cf055e0c`. |
| **Required action** | Expose deployed SHA at `/api/health` or a `/api/build` endpoint. Verify the published production app is at the correct SHA before any outbound release decision. |

---

### RV-1548-02 — Migrations 0133–0139 applied

| Field | Value |
|---|---|
| **RV ID** | RV-1548-02 |
| **Related finding IDs** | SEC-04, QUE-08 |
| **Verdict** | **PASS** (with one naming anomaly noted) |
| **Timestamp** | 2026-08-16T16:06:30Z |
| **Environment** | Shared development database |
| **Method** | `drizzle.__drizzle_migrations` query; `information_schema.tables` query; column inventory queries |
| **Observed result** | Journal entries confirmed for idx 136–142 (tags 0133–0139). All 6 new physical tables present: `outbound_pause_control`, `outbound_inflight_sends`, `zerobounce_campaigns`, `zerobounce_runs`, `logical_job_control_holds`, `post_enrichment_enrollment_intents`. PE intent column set confirmed (26 columns including `sequence_id`, `claim_token`, `lease_expires_at`, `last_error_code`, `last_error_class`, `completed_enrollment_id`). **Naming anomaly:** The ZeroBounce attempts table is named `zerobounce_attempts` in the DB, not `zerobounce_validation_attempts` as referenced in some audit documents. Journal `when` timestamps are future-dated (synthetic, consistent with documented Drizzle journal pattern). |
| **Expected condition** | Ledger/head match; pause, in-flight, ZB, hold, intent fields/FKs/indexes exist; no future/duplicate anomaly unexplained. |
| **Evidence** | `SELECT table_name FROM information_schema.tables WHERE table_name IN (…)` → 6/6 tables. Column query on `post_enrichment_enrollment_intents` → 26 columns all present. Journal idx 136=0133 through 142=0139 confirmed. `zerobounce_validation_attempts` query → "relation does not exist"; `zerobounce_attempts` confirmed. |
| **Residual uncertainty** | Production DB migration head not independently verified. Duplicate migration hash found in journal (hash `370f198d…` appears at both `1791300001001` timestamps — pre-existing anomaly from SEC-04). |
| **Required action** | Correct audit documents to reference `zerobounce_attempts` rather than `zerobounce_validation_attempts`. Verify production DB head separately. |

---

### RV-1548-03 — Isolated pause cycle works

| Field | Value |
|---|---|
| **RV ID** | RV-1548-03 |
| **Related finding IDs** | QUE-04 |
| **Verdict** | **NOT_APPLICABLE** (cannot execute safely in this environment) |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A — shared DB/Redis |
| **Method** | Static inspection only |
| **Observed result** | `test-pause-cycle-unit.ts` exists in workspace per prior static audit. Suite requires a distinct approved test DB, unique Redis prefix, and fake providers — none available in this shared environment. No artifact from a prior isolated run was found. |
| **Expected condition** | All assertions pass; cleanup proves no shared state touched; artifact attached to SHA. |
| **Evidence** | Environment cannot provide isolated DB/Redis. Execution would mutate shared state. |
| **Residual uncertainty** | Whether the test suite passes at all. No prior run artifact found. |
| **Required action** | Run on an isolated DB/Redis with fake transports; attach full output log as a release artifact. |

---

### RV-1548-04 — Coordinator convergence

| Field | Value |
|---|---|
| **RV ID** | RV-1548-04 |
| **Related finding IDs** | QUE-03, QUE-08 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:06:45Z |
| **Environment** | Shared development database |
| **Method** | Direct DB query on `outbound_pause_control`; unauthenticated probe of `/api/admin/queue-holds` |
| **Observed result** | `outbound_pause_control` row: `{state: "paused", reason: "Seeded from system_settings (paused)", epoch: 1, actor: "system-startup", committed_at: "2026-08-15T17:08:04.122Z"}`. The schema differs from spec (columns: `id, state, reason, epoch, actor, idempotency_key, committed_at` — not `desired_state`/`observed_state`). `/api/admin/queue-holds` → `{"message":"Unauthorized","reason":"not_authenticated"}`. |
| **Expected condition** | Desired/observed states and epochs agree or explicitly report degraded; no hidden bigint/500 error. |
| **Evidence** | DB query confirmed pause state. Schema mismatch from original design (no `desired_state`/`observed_state` columns — implementation uses a single `state` column). Admin endpoint requires authenticated browser session. |
| **Residual uncertainty** | Whether desired vs observed convergence is implemented differently in code. Whether the admin page renders without bigint/500 error for an authenticated admin user. Multi-process epoch consistency cannot be observed without two running processes. |
| **Required action** | Re-run check RV-1548-04 with an authenticated admin session against the admin queue-holds endpoint. |

---

### RV-1548-05 — Backlog preview accuracy

| Field | Value |
|---|---|
| **RV ID** | RV-1548-05 |
| **Related finding IDs** | QUE-07, QUE-08 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Shared development database |
| **Method** | Unauthenticated probe of `/api/admin/queue-holds`; direct DB aggregates |
| **Observed result** | Admin endpoint requires authenticated session — returned 401. Direct DB aggregates were gathered: `post_enrichment_enrollment_intents` is empty (0 rows in all statuses); `logical_job_control_holds` is empty (0 active holds). Cannot compare endpoint envelopes to direct aggregates without authenticated access. |
| **Expected condition** | Correct counts; partial source shown as partial, never zero; latency within timeout; `nonAdditive=true`. |
| **Evidence** | N/A — endpoint unreachable without auth. |
| **Residual uncertainty** | Everything about live preview accuracy. |
| **Required action** | Re-run with authenticated admin session. |

---

### RV-1548-06 — PE recovery schedule exists

| Field | Value |
|---|---|
| **RV ID** | RV-1548-06 |
| **Related finding IDs** | QUE-06, QUE-08, QUE-12 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:06:00Z |
| **Environment** | Shared Upstash Redis |
| **Method** | `ZRANGE bull:post-enrichment:repeat 0 -1 WITHSCORES` |
| **Observed result** | Exactly 1 entry in `bull:post-enrichment:repeat` sorted set. Key: `12170a3528ed54c9e7267e313c44fdbe` (hash ID only, not a human-readable name). Next execution score: `1786896900000` (~15 minutes after observation time). Worker heartbeat for `post-enrichment`: `2026-08-16T16:00:00.572Z` (age ~7-8 min at observation). |
| **Expected condition** | Exactly one `post-enrichment-intent-recovery` schedule on `post-enrichment`; expected cadence; no accidental base event schedule. |
| **Evidence** | 1 repeat entry exists. Cannot confirm the job NAME is `post-enrichment-intent-recovery` from the hash alone — BullMQ stores repeats by hash of `{name, pattern/every}`. The job data is not stored in the sorted set entry itself. |
| **Residual uncertainty** | Job name identity. Whether this is the recovery schedule or the base event schedule. Whether QUE-12 risk (interval update destroying the named recovery schedule) has been triggered. |
| **Required action** | Read the BullMQ job data from Redis to confirm job name. Verify the job's `repeat` options (name, cron/every) match the recovery schedule definition in code. |

---

### RV-1548-07 — PE intent health

| Field | Value |
|---|---|
| **RV ID** | RV-1548-07 |
| **Related finding IDs** | QUE-05, QUE-06, ENR-06 |
| **Verdict** | **PASS** (vacuous — table newly initialized) |
| **Timestamp** | 2026-08-16T16:06:20Z |
| **Environment** | Shared development database |
| **Method** | Aggregate query on `post_enrichment_enrollment_intents` |
| **Observed result** | `{pending: 0, processing: 0, completed: 0, failed: 0, expired_leases: 0, null_sequence_id: 0, oldest_row: null, max_attempts_seen: null}`. Table is empty. |
| **Expected condition** | Zero `processing` rows with null/expired unrecoverable lease; zero pending/processing null `sequence_id`; bounded age; failed reasons classified. |
| **Evidence** | All counts are zero. Table schema confirmed with all 0138/0139 columns present. |
| **Residual uncertainty** | Table is empty because it is newly created (migration 0138). No production intents have flowed through it yet. Once PE enrollment is wired and active, the QUE-05 crash window (processing+null lease) becomes live. |
| **Required action** | Re-verify after first PE enrollment intents are produced. QUE-05 residual (immediate crash window before lease is set) should be fixed before production traffic. |

---

### RV-1548-08 — PE recovery convergence

| Field | Value |
|---|---|
| **RV ID** | RV-1548-08 |
| **Related finding IDs** | QUE-05, QUE-06 |
| **Verdict** | **NOT_APPLICABLE** (requires isolated crash-injection environment) |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Static inspection only |
| **Observed result** | Crash injection, pause-mid-batch, and crash-after-enrollment scenarios cannot be exercised against shared DB without permanently mutating state. |
| **Expected condition** | One local enrollment, completed intent link, no stranded marker/intent, row-level authority check and no provider send. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Execute on isolated DB + fake transport. QUE-05 architecture residual must be resolved before this can pass even in isolation. |

---

## P0 — Outbound Safety

### RV-OUT-01 — Global pause is unavoidable

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-01 |
| **Related finding IDs** | OUT-01, OUT-02, OUT-03 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:06:45Z |
| **Environment** | Shared development database |
| **Method** | DB query on `outbound_pause_control` and `system_settings` |
| **Observed result** | `outbound_pause_control.state = "paused"`, `epoch = 1`, `committed_at = 2026-08-15T17:08:04Z`. `system_settings["outboundGlobalPaused"] = "true"` (set 2026-08-15T17:14:09Z). Both sources agree: global outbound IS paused. Adapter boundary behaviour (whether every adapter correctly blocks) cannot be verified read-only without calling adapters. |
| **Expected condition** | Every adapter returns blocked; no network/provider request; consistent epoch/reason. |
| **Evidence** | DB row shows paused. Cannot probe adapters without triggering sends. |
| **Residual uncertainty** | Whether all 6+ adapter boundaries (GHL email, GHL SMS, SMTP, Gmail, workflow enrollment, RVM) correctly observe the pause. Whether epoch is validated at send time vs only at startup. |
| **Required action** | Exercise adapter boundary test using fake/no-op transport in isolated environment with pause=true. |

---

### RV-OUT-02 — Cross-process epoch propagation

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-02 |
| **Related finding IDs** | OUT-01 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Static only |
| **Observed result** | Cannot observe two processes simultaneously in this environment. |
| **Expected condition** | New auth denied, stale decisions fail final recheck, in-flight registry drains/aborts, epochs converge. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Multi-process isolated test. |

---

### RV-OUT-03 — Startup fail-closed

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-03 |
| **Related finding IDs** | OUT-02 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Static only |
| **Observed result** | Cannot restart process with missing/malformed row safely. |
| **Expected condition** | No outbound-capable worker/fallback starts; health reports blocked/degraded. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Isolated process restart with deliberately absent or malformed `outbound_pause_control` row. |

---

### RV-OUT-04 — Independent holds survive unpause

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-04 |
| **Related finding IDs** | OUT-01, QUE-03 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:06:30Z |
| **Environment** | Shared development database |
| **Method** | Aggregate query on `logical_job_control_holds` |
| **Observed result** | `{active_holds: 0, released_holds: 0, total: 0}`. The holds table is empty — no independent holds are currently active. Cannot test hold persistence through a pause/unpause cycle with zero active holds and no ability to create test holds. |
| **Expected condition** | Only global hold transitions; every independent hold remains effective. |
| **Evidence** | Empty table. |
| **Residual uncertainty** | Whether independent holds survive unpause (the mechanism cannot be observed with no holds present). |
| **Required action** | Isolated test with injected channel/DNC/consent/validation holds. |

---

### RV-OUT-05 — A2P/SMS readiness

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-05 |
| **Related finding IDs** | OUT-07 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A — provider console required |
| **Method** | No provider access |
| **Observed result** | Cannot read TCR/A2P registration status, approved number status, or PEWC gate implementation without provider console. SMS remains paused per global outbound pause. |
| **Expected condition** | Approved active registration, correct number/location, PEWC/quiet-hours gates and SMS pause explicitly controlled. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything about A2P registration status. |
| **Required action** | Keep SMS paused. Verify A2P/TCR registration at provider console before considering any SMS release. |

---

## P0/P1 — Queue, Redis, CI, and Release Controls

### RV-QUE-01 — Redis capacity/plan

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-01 |
| **Related finding IDs** | QUE-01 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:06:00Z |
| **Environment** | Shared Upstash Redis |
| **Method** | `PING`; key count |
| **Observed result** | Redis responds `PONG`. Provider: Upstash (`moved-goldfish-143136.upstash.io`). Total `bull:*:repeat:*` keys: 1,042. Cannot read provider plan, max client count, or connection telemetry without Upstash console. |
| **Expected condition** | Capacity exceeds modeled worst case with headroom; no over-limit rejections. |
| **Evidence** | PING succeeds. Key count observable. Plan limits not readable from this environment. |
| **Residual uncertainty** | Whether current connection count / command count is within plan limits. |
| **Required action** | Read Upstash console for plan limits, current connection count, and command usage. |

---

### RV-QUE-02 — Worker health

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-02 |
| **Related finding IDs** | QUE-02 |
| **Verdict** | **PARTIAL** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Shared development database |
| **Method** | `system_settings` heartbeat key query |
| **Observed result** | 21 worker heartbeats observed. Most recent at observation time (~16:09Z): `ghl-sync` at 16:07:30 (age ~1.5 min ✓), `enrichment` at 16:00:00 (age ~9 min ✓), `post-enrichment` at 16:00:00 (age ~9 min ✓), `sequences` at 16:00:00 (age ~9 min ✓), `health-monitor` at 16:05:00 (age ~4 min ✓), `sla-checks` at 16:05:00 (age ~4 min ✓). **Stale heartbeats:** `enrollment-recovery` at 13:20:52 (age ~2h48m ⚠), `winback-outreach` at 11:14:52 (age ~4h54m ⚠), `db-backup` at 11:14:59 (age ~4h54m ⚠). **GHL sync active errors:** 4,106 sync errors + 3,244 identity conflicts in last 24h (400: 2317, 404: 1490, 422: 299). NO successful GHL sync completion in last 24h (`last_completed: null`). |
| **Expected condition** | No critical ETIMEDOUT/auth/stall; heartbeats within cadence; backlog stable/draining. |
| **Evidence** | Heartbeat timestamps from `system_settings`. Audit log counts via aggregate query on `audit_logs`. |
| **Residual uncertainty** | Queue depth per worker (WRONGTYPE error blocked Redis list reads — BullMQ uses sorted sets in newer versions). Whether stale workers are intentionally paused or stuck. |
| **Required action** | Investigate `enrollment-recovery`, `winback-outreach`, and `db-backup` stale heartbeats — confirm whether these are intentionally dormant or stuck. Investigate root cause of GHL 400/404/422 error flood — circuit breaker not tripping despite sustained failure rate. |

---

### RV-QUE-03 — One owner per logical job

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-03 |
| **Related finding IDs** | QUE-09, DAT-07 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Redis key inspection only |
| **Observed result** | Cannot determine process topology or whether legacy scheduler is running concurrently with BullMQ for the same logical jobs from this environment. |
| **Expected condition** | Exactly one active owner/fenced execution for each logical key. |
| **Evidence** | N/A |
| **Residual uncertainty** | Whether `enrollment-recovery` stale heartbeat indicates a stuck BullMQ job or a legacy interval that replaced it. |
| **Required action** | Process topology audit; compare `setInterval`-based legacy schedulers against BullMQ repeat registrations. |

---

### RV-QUE-04 — Alerts work

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-04 |
| **Related finding IDs** | QUE-02 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Static only |
| **Observed result** | Cannot inject stale heartbeat or threshold failure without mutating shared state. |
| **Expected condition** | Actionable alert/review item produced once with redacted details. |
| **Evidence** | N/A |
| **Residual uncertainty** | Whether alert delivery works at all. `ghl_circuit_alert_at` was last updated 2026-08-10 (6 days ago) despite active 24h GHL failure flood — suggests circuit alert is NOT firing for the current error pattern. |
| **Required action** | Investigate why GHL errors are not triggering the circuit breaker alert despite 4,106 sync errors in 24h. |

---

### RV-CI-01 — Exact SHA required checks

| Field | Value |
|---|---|
| **RV ID** | RV-CI-01 |
| **Related finding IDs** | SEC-03, QUE-11 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | GitHub — inaccessible from this environment |
| **Method** | N/A |
| **Observed result** | Cannot read branch protection rules or Actions check-run results without GitHub API access. `.github/workflows/wave12-ci.yml` exists in repository (static evidence only). |
| **Expected condition** | Protected `main`; exact SHA green; typecheck/build/compliance/#1548 critical suites required. |
| **Evidence** | N/A |
| **Residual uncertainty** | Whether branch protection is enforced. Whether wave12-ci.yml runs for exact SHA `68eae86c`. |
| **Required action** | Read GitHub branch protection settings and Actions result for SHA `68eae86c` via GitHub UI or API. |

---

## P1 — ZeroBounce, Identity, Provenance, and Commercial Truth

### RV-ZB-01 — ZB schema/worker deployed

| Field | Value |
|---|---|
| **RV ID** | RV-ZB-01 |
| **Related finding IDs** | OUT-06, DAT-14 |
| **Verdict** | **PASS** (schema and worker) |
| **Timestamp** | 2026-08-16T16:06:45Z |
| **Environment** | Shared development database + Redis |
| **Method** | `information_schema.tables`; `system_settings` heartbeat; Redis key inspection |
| **Observed result** | Tables present: `zerobounce_campaigns`, `zerobounce_runs`, `zerobounce_attempts` (migration 0136 applied). Worker heartbeat `worker_heartbeat_post-enrichment` at 2026-08-16T16:00:00.572Z (age ~9 min). No campaigns, runs, or attempts exist (all tables empty). No stale running run. `email_status` default = `unvalidated` (migration 0135 applied — schema default changed). |
| **Expected condition** | 0135/0136 present; one worker; no stale running run. |
| **Evidence** | `information_schema.tables` returns `zerobounce_attempts`, `zerobounce_campaigns`, `zerobounce_runs`. Heartbeat confirmed. Campaign/run tables empty (no zombie runs). |
| **Residual uncertainty** | Whether the ZB BullMQ worker specifically handles ZB campaign jobs vs just being the general post-enrichment worker. No ZB campaign has been started to prove end-to-end wiring. |
| **Required action** | NONE immediate. Note: table name is `zerobounce_attempts`, not `zerobounce_validation_attempts` — audit documents should be corrected. |

---

### RV-ZB-02 — Campaign progress

| Field | Value |
|---|---|
| **RV ID** | RV-ZB-02 |
| **Related finding IDs** | OUT-06 |
| **Verdict** | **NOT_APPLICABLE** (no campaign started) |
| **Timestamp** | 2026-08-16T16:06:20Z |
| **Environment** | Shared development database |
| **Method** | Aggregate queries on `zerobounce_campaigns`, `zerobounce_runs`, `zerobounce_attempts`; contact email_status distribution |
| **Observed result** | `zerobounce_campaigns`: 0 rows. `zerobounce_runs`: 0 rows. `zerobounce_attempts`: 0 rows. **Remaining validation candidates:** 156,894 contacts with `email_status = 'active'` (legacy unvalidated); 156,110 of those have a non-null email address. 330 contacts have `email_status = 'valid'` (already validated). |
| **Expected condition** | Counters reconcile; no duplicate claims; ETA uses server daily limit; pending attempts gate completion. |
| **Evidence** | All campaign tables empty. Contact distribution query confirmed. |
| **Residual uncertainty** | Whether a ZB API key is configured (only SERPER_API_KEY was confirmed present; ZB key status not separately probed). |
| **Required action** | Confirm ZeroBounce API key is set before starting first campaign. 156,894 contacts require validation before outbound email can be safely released. |

---

### RV-ZB-03 — Provider/budget behavior

| Field | Value |
|---|---|
| **RV ID** | RV-ZB-03 |
| **Related finding IDs** | OUT-06 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | N/A — cannot test without running a campaign |
| **Observed result** | No campaign has been started. Provider behavior cannot be verified without executing against the ZeroBounce API or a fake provider. |
| **Expected condition** | Missing key claims zero; retryable outage stops safely; daily limit atomic; no credit drift. |
| **Evidence** | N/A |
| **Residual uncertainty** | ZB API key presence, credit balance, daily limit behavior. |
| **Required action** | Run isolated test with fake ZB provider before first production campaign. |

---

### RV-DAT-01 — Commercial baseline

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-01 |
| **Related finding IDs** | DAT-01, REV-01 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:07:00Z |
| **Environment** | Shared development database |
| **Method** | Aggregate queries on `deals`, `merchant_applications` |
| **Observed result** | Deals: 747 total, all have `stage`, 0 orphan (no null contactId), 67 missing `ghl_opportunity_id`. Merchant applications: 2 total — status values are not `approved`/`pending`/`rejected` (query returned 0 for all three — different status vocabulary in use). No `record_class` or production/test/demo discriminator column found. |
| **Expected condition** | Every deal/application/contact used in KPIs has production/test/demo/import lineage; actual deal/revenue totals separately attested. |
| **Evidence** | Schema does not include `record_class`. Application status values differ from expected enumeration. |
| **Residual uncertainty** | How many of the 747 deals are real vs test/demo. How many contacts are commercial vs seeded. |
| **Required action** | Owner-approved classification report. Do not use 747 deals as a commercial metric until discriminator is added and backfill is performed (DAT-01 remains OPEN). |

---

### RV-DAT-02 — Duplicate identity

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-02 |
| **Related finding IDs** | DAT-02, DAT-11 |
| **Verdict** | **OBSERVED** (not actionable without merge plan) |
| **Timestamp** | 2026-08-16T16:07:00Z |
| **Environment** | Shared development database |
| **Method** | Normalized email group aggregate query |
| **Observed result** | 74 normalized email groups with 2+ contacts, affecting 173 contacts total. Top duplicates: `filler@godaddy.com` (4 contacts), several `info@` and `billing@` business addresses (3 contacts each). These appear to be shared business email addresses, not personal identity collisions. No automated unsafe merges detected. |
| **Expected condition** | Counts reviewed; no automated unsafe merges; campaign cohort collision-free. |
| **Evidence** | `SELECT COUNT(*) AS groups, SUM(dupe_count) AS affected_contacts FROM (…GROUP BY LOWER(TRIM(email)) HAVING COUNT(*)>1…)` → `{groups: 74, affected_contacts: 173}`. |
| **Residual uncertainty** | Phone-number duplicate groups not queried (DAT-11). Whether any duplicates are in the target outbound cohort. |
| **Required action** | Review 74 duplicate groups before campaign launch. Classify as shared business addresses vs true identity duplicates. |

---

### RV-DAT-03 — Provenance

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-03 |
| **Related finding IDs** | DAT-05 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Not queried in this pass |
| **Observed result** | `import_executions` and `contact_source_events` tables not queried. Coverage of 157,665 contacts against provenance records is unknown. |
| **Expected condition** | 100% target cohort traceable; future canonical writes reconcile atomically. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Query `contact_source_events` coverage against contact table. |

---

### RV-DAT-04 — Sensitive fields

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-04 |
| **Related finding IDs** | SEC-02 |
| **Verdict** | **PASS** (zero values stored) |
| **Timestamp** | 2026-08-16T16:07:00Z |
| **Environment** | Shared development database |
| **Method** | `COUNT(*) FILTER (WHERE field IS NOT NULL AND field != '')` on `merchant_applications` |
| **Observed result** | `{has_ssn: 0, has_routing: 0, has_account: 0}`. All three sensitive columns exist in schema but contain zero non-null non-empty values. |
| **Expected condition** | No legacy plaintext values, encryption/version metadata present, access restricted. |
| **Evidence** | Aggregate count query returned 0 for all three fields. Columns exist (confirmed by prior schema queries). |
| **Residual uncertainty** | Whether the columns are present but empty because the application flow has not been exercised yet (only 2 merchant applications exist). Encryption/tokenization architecture still absent (SEC-02 remains OPEN). |
| **Required action** | Confirm encryption architecture before any real merchant application data is submitted. |

---

## P1/P2 — Enrichment, Serper, Readiness, Scoring, and GHL

### RV-ENR-01 — Enrichment worker running

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-01 |
| **Related finding IDs** | ENR-01, ENR-02 |
| **Verdict** | **PASS** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Shared development database |
| **Method** | `system_settings` heartbeat + enrichment_progress query |
| **Observed result** | `worker_heartbeat_enrichment`: `2026-08-16T16:00:00.563Z` (age ~9 min). `enrichment_progress`: `{processed: 171, total: 200}` — a batch is actively in progress. `worker_heartbeat_post-enrichment`: `2026-08-16T16:00:00.572Z` (age ~9 min). Both enrichment workers are alive and producing recent heartbeats. |
| **Expected condition** | Heartbeat current; recent success within cadence; queue not stuck; failures classified. |
| **Evidence** | Two heartbeat keys both at 16:00:00.xxx. `enrichment_progress.processed = 171/200` indicates active batch work. |
| **Residual uncertainty** | Queue depth in Redis not readable (WRONGTYPE error on list probe). Success vs failure breakdown not visible from heartbeat timestamps alone. |
| **Required action** | NONE immediate. Fix Redis depth probe to use correct data type (`ZCARD` for sorted sets). |

---

### RV-ENR-02 — Serper configured and calling

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-02 |
| **Related finding IDs** | ENR-03 |
| **Verdict** | **PASS** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Shared development database + process environment |
| **Method** | `SERPER_API_KEY` presence check; `system_settings["serper_usage"]` |
| **Observed result** | `SERPER_API_KEY`: PRESENT (not exposed). `serper_usage` setting: `{total_calls: 26,593}`, last updated `2026-08-16T16:07:37Z` (within observation window — actively calling). |
| **Expected condition** | Configured true; recent successful call after current deployment; acceptable failure rate and quota. |
| **Evidence** | Key present. Usage record updated 16:07:37Z. total_calls = 26,593 (significant call volume). Full success/failure breakdown not available in the stored summary (only `totalCalls` was populated; `successCalls`, `failureCalls`, `lastSuccess`, `lastFailure` fields were null in the response). |
| **Residual uncertainty** | Success vs failure rate not determinable from current usage record shape. Quota remaining unknown. |
| **Required action** | Expand `serper_usage` stored structure to include per-call success/failure counts and last-success timestamp. |

---

### RV-ENR-03 — Serper enrichment yield

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-03 |
| **Related finding IDs** | ENR-03 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Not available without per-batch records |
| **Observed result** | Cannot determine email/phone/site yield improvement from Serper without per-batch before/after comparisons. |
| **Expected condition** | Search-assisted email/phone/site yield improves and errors remain below SLO. |
| **Evidence** | N/A |
| **Residual uncertainty** | Yield rate, field-fill percentage, query quality. |
| **Required action** | Add per-batch yield tracking to enrichment system. |

---

### RV-ENR-04 — Other provider health

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-04 |
| **Related finding IDs** | ENR-04 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | `system_settings` review |
| **Observed result** | No Outscraper-, Apify-, or Sunbiz-specific heartbeat or usage records found in `system_settings`. Only enrichment and Serper usage records present. |
| **Expected condition** | Configured intended providers succeed inside budget and circuit limits. |
| **Evidence** | N/A for non-Serper providers. |
| **Residual uncertainty** | Whether Outscraper/Apify are configured, called, or failing silently. |
| **Required action** | Add per-provider usage/heartbeat tracking or verify via provider console. |

---

### RV-ENR-05 — Sunbiz/discovery progress

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-05 |
| **Related finding IDs** | ENR-05 |
| **Verdict** | **PARTIAL** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Shared development database |
| **Method** | `system_settings` heartbeat |
| **Observed result** | `worker_heartbeat_discovery`: `2026-08-16T15:40:59.631Z` (age ~28 min at observation). Heartbeat is older than the other workers' 16:00 batch. `enrichment_progress`: `{processed: 171, total: 200}` — active batch. |
| **Expected condition** | Current heartbeat; monotonic progress; no stuck processing rows. |
| **Evidence** | Discovery heartbeat is ~28 min old vs other workers at ~9 min. May indicate the discovery worker runs on a longer cadence. |
| **Residual uncertainty** | Whether discovery worker is running on expected cadence or is drifting. Whether `enrichment_progress` reflects Sunbiz discovery or a different enrichment step. |
| **Required action** | Confirm expected heartbeat cadence for discovery worker. |

---

### RV-ENR-06 — Readiness coverage

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-06 |
| **Related finding IDs** | DAT-09 |
| **Verdict** | **NOT_APPLICABLE** |
| **Timestamp** | 2026-08-16T16:07:00Z |
| **Environment** | Shared development database |
| **Method** | `information_schema.columns` probe |
| **Observed result** | `readiness_score` column does NOT exist on the `contacts` table. Confirmed present columns: `consent_tier, do_not_contact, email_status, ghl_contact_id, lead_score, opted_out_email, vertical`. Readiness may be stored in a separate table not queried here. |
| **Expected condition** | <5% null in target population; no stale model version. |
| **Evidence** | Column not found in `contacts`. |
| **Residual uncertainty** | Where readiness data is stored if not in `contacts`. |
| **Required action** | Identify the actual readiness storage location and re-run check against correct table/column. |

---

### RV-ENR-07 — Lead-score coverage

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-07 |
| **Related finding IDs** | ENR-05 |
| **Verdict** | **PASS** |
| **Timestamp** | 2026-08-16T16:07:00Z |
| **Environment** | Shared development database |
| **Method** | Aggregate COUNT on `contacts.lead_score` |
| **Observed result** | `{total: 157665, null_ls: 0, has_ls: 157665, newest_score: "2026-08-16T16:05:36.211Z"}`. 100% of contacts have a lead_score. Most recent score updated within observation window. |
| **Expected condition** | Approved inventory scored with current version; backlog draining. |
| **Evidence** | `COUNT(*) FILTER (WHERE lead_score IS NULL) = 0`. `MAX(updated_at)` on contacts = `2026-08-16T16:05:36Z`. |
| **Residual uncertainty** | Whether `lead_score` column on `contacts` is the canonical scoring output or a denormalized copy. Whether scoring model version is tracked. |
| **Required action** | NONE immediate. Verify model version tracking if model changes. |

---

### RV-GHL-01 — GHL identity/circuit health

| Field | Value |
|---|---|
| **RV ID** | RV-GHL-01 |
| **Related finding IDs** | DAT-08 |
| **Verdict** | **FAIL** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | Shared development database |
| **Method** | Audit log aggregate (24h window); `system_settings["ghl_circuit_state"]` |
| **Observed result** | **Last 24 hours:** 4,106 `ghl_sync_error` events; 3,244 `ghl_sync_identity_conflict` events; 0 `ghl_sync_completed` events. Error HTTP status breakdown: 400 (2,317), 404 (1,490), 422 (299). Most recent error: `2026-08-16T16:06:08Z`. Circuit breaker state: `{open: false, consecutiveFailures: 0, updatedAt: "2026-08-16T16:03:45.357Z"}` (closed — NOT tripping despite error flood). `ghl_circuit_alert_at` last updated: `2026-08-10T22:08:07Z` (6 days ago). GHL token-related setting not found. **Coverage:** 3,370 contacts linked to GHL (2.1%); 154,295 contacts (97.9%) have no `ghl_contact_id`. 67 deals missing `ghl_opportunity_id`. |
| **Expected condition** | Qualified cohort linked; conflicts explicit; circuit stable. |
| **Evidence** | Audit log aggregate: 7,350 combined errors/conflicts in 24h. No completions. Circuit shows closed with 0 consecutive failures — the failure counter resets or the identity_conflict events are not counted as circuit failures. |
| **Residual uncertainty** | Root cause of 400/404/422 errors (token expiry? API endpoint changes? Contact data issues?). Whether circuit breaker is counting identity conflicts toward threshold. Why `ghl_circuit_alert_at` is 6 days stale despite active errors. |
| **Required action** | **URGENT**: Investigate GHL sync error flood. Confirm GHL Private Integration Token is valid. Determine why circuit breaker is not tripping. Verify whether identity conflicts (the GHL sync skip path) are correctly excluded from circuit failure counting — if so, the 4,106 `ghl_sync_error` events alone should have triggered the circuit. |

---

### RV-GHL-02 — Workflow registry

| Field | Value |
|---|---|
| **RV ID** | RV-GHL-02 |
| **Related finding IDs** | DAT-08 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | N/A — requires authenticated admin session |
| **Observed result** | Cannot run read-only live validation without authenticated session. |
| **Expected condition** | Every required workflow key resolves to an active workflow; no secret printed. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Run with authenticated admin session via the existing GHL workflow validation endpoint. |

---

## P2 — UI and Workflow Runtime

### RV-UI-01 — Queue Holds page

| Field | Value |
|---|---|
| **RV ID** | RV-UI-01 |
| **Related finding IDs** | UI-06, QUE-08 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:09:00Z |
| **Environment** | Replit dev server |
| **Method** | Unauthenticated HTTP probe |
| **Observed result** | `/api/admin/queue-holds` → `{"message":"Unauthorized","reason":"not_authenticated"}` (401). RBAC is enforced. Cannot verify admin render, non-admin block, envelope completeness, or bigint serialization without authenticated session. |
| **Expected condition** | Admin renders every envelope/degraded state; non-admin blocked; no 404/500; no additive total. |
| **Evidence** | 401 returned (correct for unauthenticated). |
| **Residual uncertainty** | Everything about authenticated render. |
| **Required action** | Re-run with authenticated admin session + non-admin session. |

---

### RV-UI-02 — Protected route/layout map

| Field | Value |
|---|---|
| **RV ID** | RV-UI-02 |
| **Related finding IDs** | UI-02 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | Not executable read-only |
| **Observed result** | Authenticated route crawl not possible without browser session. |
| **Expected condition** | Correct shell, breadcrumbs, access and no dead route. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Authenticated browser role-crawl in test environment. |

---

### RV-UI-03 — Inbox refresh

| Field | Value |
|---|---|
| **RV ID** | RV-UI-03 |
| **Related finding IDs** | UI-08 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | N/A |
| **Observed result** | Cannot send synthetic inbound event safely in shared environment. |
| **Expected condition** | Visible within SLO without manual reload. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Synthetic isolated inbound event test. |

---

### RV-REV-01 — Statement/application funnel

| Field | Value |
|---|---|
| **RV ID** | RV-REV-01 |
| **Related finding IDs** | REV-05 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | N/A |
| **Observed result** | 2 merchant applications exist in DB with status values outside the expected approved/pending/rejected enumeration. Cannot test funnel flow without a synthetic isolated merchant. |
| **Expected condition** | Canonical stages/status, audit lineage and cleanup; no real send. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Synthetic isolated merchant end-to-end with fake providers. |

---

### RV-REV-02 — Chargeback/residual reconciliation

| Field | Value |
|---|---|
| **RV ID** | RV-REV-02 |
| **Related finding IDs** | REV-06 |
| **Verdict** | **INCONCLUSIVE** |
| **Timestamp** | 2026-08-16T16:08:00Z |
| **Environment** | N/A |
| **Method** | N/A |
| **Observed result** | Source-vs-import-vs-report reconciliation not performed in this pass. |
| **Expected condition** | Counts/amounts reconcile by batch and merchant classification. |
| **Evidence** | N/A |
| **Residual uncertainty** | Everything. |
| **Required action** | Read-only source-vs-import totals query. |

---

## Additional Observed Findings (Not Directly in Register)

### Consent flag conflicts (related to DAT-06, Task #1526)

| Finding | Count |
|---|---|
| `email_status='opted_out'` but `opted_out_email=false` | **67 contacts** |
| `do_not_contact=true` but `consent_tier` not in suppressed set | **244 contacts** |
| `consent_tier` is non-canonical `'pewc'` or `'PEWC'` | **463 contacts** |

These are the data quality conflicts proposed for remediation in Task #1526. Counts have shifted since the Task #1521 audit (was 51/199/358 → now 67/244/463), suggesting new contacts are entering with mismatched flags.

### Contact email_status distribution

| Status | Count |
|---|---|
| `active` (legacy, unvalidated) | 156,894 |
| `valid` | 330 |
| `bounced` | 157 |
| `opted_out` | 252 |
| `invalid` | 1 |
| `unsafe` | 1 |
| `blocked` | 1 |
| `unvalidated` | 0 (new default for new contacts post-0135) |
| **Total** | **157,665** |

### Stale worker heartbeats (potential investigation items)

| Worker | Last heartbeat | Age at observation |
|---|---|---|
| `enrollment-recovery` | 2026-08-16T13:20:52Z | ~2h48m |
| `winback-outreach` | 2026-08-16T11:14:52Z | ~4h54m |
| `db-backup` | 2026-08-16T11:14:59Z | ~4h54m |

---

## Section 1 — Runtime Checks That Passed

| RV ID | Summary |
|---|---|
| RV-1548-02 | All migrations 0133–0139 applied; all 6 new tables present; PE intent columns complete |
| RV-1548-07 | PE intent table is empty with no stranded/null-lease rows (vacuous pass; table is freshly initialized) |
| RV-ZB-01 | ZeroBounce schema (migrations 0135/0136) deployed; tables present; worker heartbeat current; no zombie runs |
| RV-DAT-04 | Zero sensitive field values (SSN, routing, account) stored in merchant_applications |
| RV-ENR-01 | Enrichment and post-enrichment workers alive with current heartbeats; active batch in progress (171/200) |
| RV-ENR-02 | Serper configured (key present); 26,593 total calls; usage updated within observation window |
| RV-ENR-07 | 100% lead_score coverage across all 157,665 contacts; most recent score within observation window |

---

## Section 2 — Runtime Checks That Failed

| RV ID | Summary | Severity |
|---|---|---|
| RV-1548-01 | Local workspace HEAD is `cf055e0c`, not target `68eae86c`; production deployment SHA unknown | P0 |
| RV-GHL-01 | 4,106 sync errors + 3,244 identity conflicts in 24h; 0 successful completions; circuit breaker NOT tripping; 97.9% of contacts lack GHL ID | P1 |

---

## Section 3 — Runtime Checks That Remain Inconclusive

| RV ID | Blocker |
|---|---|
| RV-1548-03 | Requires isolated DB/Redis/fake-transport environment |
| RV-1548-04 | Requires authenticated admin session for `/api/admin/queue-holds` |
| RV-1548-05 | Requires authenticated admin session |
| RV-1548-06 | PE repeat job name not deducible from hash alone |
| RV-1548-08 | Requires isolated crash-injection environment |
| RV-OUT-01 | Cannot probe adapter boundaries without sending |
| RV-OUT-02 | Requires isolated multi-process environment |
| RV-OUT-03 | Requires isolated process restart with missing row |
| RV-OUT-04 | Requires isolated test with injected holds; holds table currently empty |
| RV-OUT-05 | Requires A2P/TCR provider console |
| RV-QUE-01 | Requires Upstash console for plan/connection-limit data |
| RV-QUE-02 | Worker health partial; `enrollment-recovery`, `winback-outreach`, `db-backup` heartbeats stale (2h–5h); alert mechanism not confirmed firing |
| RV-QUE-03 | Requires process topology comparison |
| RV-QUE-04 | Requires isolated alert injection; GHL circuit alert is 6 days stale despite active error flood |
| RV-CI-01 | Requires GitHub API or UI access |
| RV-ZB-02 | No campaign started; 156,894 contacts remain unvalidated |
| RV-ZB-03 | Requires isolated fake-provider test |
| RV-DAT-01 | No production/test/demo discriminator; 747 deals unclassified |
| RV-DAT-02 | Observed (74 dupe groups, 173 contacts); requires manual classification before merge |
| RV-DAT-03 | Provenance tables not queried in this pass |
| RV-ENR-03 | Serper yield not trackable; per-batch success/failure breakdown missing |
| RV-ENR-04 | Non-Serper provider heartbeats absent |
| RV-ENR-05 | Discovery worker heartbeat 28 min old; cadence not confirmed |
| RV-ENR-06 | `readiness_score` column not on `contacts`; storage location unknown |
| RV-GHL-02 | Requires authenticated admin session |
| RV-UI-01 | Requires authenticated admin + non-admin browser session |
| RV-UI-02 | Requires authenticated route crawl |
| RV-UI-03 | Requires synthetic inbound event |
| RV-REV-01 | Requires isolated synthetic merchant funnel |
| RV-REV-02 | Source-vs-import reconciliation not queried |

---

## Section 4 — Corrective Build Tasks Recommended from Failed Evidence

### CBT-1 — Resolve GHL sync error flood and circuit breaker non-trip

**Affected findings:** RV-GHL-01, DAT-08  
**Affected RV IDs:** RV-GHL-01, RV-QUE-04  
**Failure evidence:** 4,106 `ghl_sync_error` events + 3,244 `ghl_sync_identity_conflict` events in last 24 hours. Zero `ghl_sync_completed` events. Circuit breaker shows `{open: false, consecutiveFailures: 0}` despite sustained error rate. `ghl_circuit_alert_at` last updated 2026-08-10 (6 days ago). HTTP error distribution: 400 (2,317), 404 (1,490), 422 (299).  
**Relevant files/services:** `server/services/ghl.ts`, `server/services/sdr/ghl-client.ts`, circuit breaker state in `system_settings["ghl_circuit_state"]`  
**Acceptance gate:** GHL sync consecutive-failure counter increments for `ghl_sync_error` events (distinct from skips); circuit opens when threshold exceeded; alert fires within configured cooldown; OR root cause of 400/404/422 errors is identified and resolved.  
**Tests:** Existing `smoke-role-guards` workflow; add a test that confirms circuit trips after N consecutive `ghl_sync_error` audit events.  
**Kill lines:** GHL token expiry returns 401 and opens circuit within 1 sync cycle; `consecutiveFailures` increments on real HTTP errors (not identity skips); `ghl_circuit_alert_at` is updated when circuit transitions to open.

---

### CBT-2 — Expose deployed SHA at health endpoint

**Affected findings:** RV-1548-01, SEC-03  
**Affected RV IDs:** RV-1548-01, RV-CI-01  
**Failure evidence:** `/api/health` returns `{"status":"ok"}` only. No `GIT_SHA`, `RENDER_GIT_COMMIT`, or `REPLIT_DEPLOYMENT` environment variable set. Local workspace is 1 commit ahead of target SHA with no way to confirm production deployment identity.  
**Relevant files/services:** `server/routes/admin.ts` or `server/index.ts` (health endpoint), deployment configuration  
**Acceptance gate:** `GET /api/health` (or a separate `GET /api/build`) returns the deployed Git SHA; SHA is set at build/deploy time via environment variable injected by the deployment platform.  
**Tests:** Pre-deploy check that asserts SHA field is non-empty string.  
**Kill lines:** Health endpoint returns non-null `sha` field matching the release commit.

---

### CBT-3 — Investigate stale enrollment-recovery, winback-outreach, and db-backup heartbeats

**Affected findings:** RV-QUE-02, QUE-02, QUE-09  
**Affected RV IDs:** RV-QUE-02, RV-QUE-03  
**Failure evidence:** `worker_heartbeat_enrollment-recovery`: 13:20:52Z (age ~2h48m). `worker_heartbeat_winback-outreach`: 11:14:52Z (age ~4h54m). `worker_heartbeat_db-backup`: 11:14:59Z (age ~4h54m). All three are significantly stale compared to the 16:00:xx batch of other workers. Global outbound pause is active — winback-outreach may be intentionally idle, but enrollment-recovery and db-backup should not be pause-sensitive.  
**Relevant files/services:** `server/services/sequence-worker.ts` (enrollment-recovery), `server/services/content-scheduler.ts` (db-backup, winback), `server/services/queue-manager.ts`  
**Acceptance gate:** Each of the three workers either (a) emits a heartbeat on its expected cadence, OR (b) is documented as intentionally dormant during global pause with a flag that proves intentional dormancy vs stuck.  
**Tests:** Add heartbeat age assertions to pre-deploy health check for each named worker.  
**Kill lines:** All three workers emit heartbeats within 2× their expected cadence; OR explicit `paused_by_global_pause` flag distinguishes intentional from stuck.

---

*This evidence packet was produced under read-only constraints. No database rows, Redis keys, secrets, or configuration values were modified. No provider calls were made. No pauses were lifted.*

*The auditor does not declare any ledger finding `CLOSED_RUNTIME`. This packet provides evidence only; finding status updates are the operator's responsibility per the register closure procedure.*
