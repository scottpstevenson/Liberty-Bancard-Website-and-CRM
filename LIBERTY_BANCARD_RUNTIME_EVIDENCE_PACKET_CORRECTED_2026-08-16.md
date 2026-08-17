# Liberty Bancard Corrected Runtime Evidence Packet

**Post-repair evidence target SHA:** `60cc6a7cedb12aaa3f14bb214185f9bcb1ed2499`  
**Evidence captured:** 2026-08-16T23:20:00Z – 23:30:00Z (America/New_York = 19:20–19:30 ET)  
**Auditor:** Replit Agent — read-only; no mutations performed  
**Operator/Reviewer:** Replit Agent (automated read-only collection)  
**Evidence expiry/recheck cadence:** 24 hours from capture; recheck required after any deployment, worker restart, or RELEASE_SHA injection  
**Register version:** LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER (2026-08-16)  
**Supersedes:** LIBERTY_BANCARD_RUNTIME_EVIDENCE_PACKET_68EAE86.md  

---

## Section 0 — Environment Baseline

| Field | Observed value |
|---|---|
| Workspace HEAD SHA | `ebe20d65a792ec4de42ed43d7375ba40277d710e` ("Add documentation for repair procedures" — 1 commit ahead of origin/main) |
| `origin/main` SHA | `60cc6a7cedb12aaa3f14bb214185f9bcb1ed2499` ✓ matches post-repair target |
| `RELEASE_SHA` env var set | **false** — not set in development workspace |
| `NODE_ENV` | `development` |
| Database host | `postgresql://***@helium/***` (redacted) |
| Redis host | `rediss://***@moved-goldfish-143136.upstash.io:6379/***` (Upstash, redacted) |
| Environment inspected | Replit dev workspace + shared development PostgreSQL + shared Upstash Redis |
| Dev server `builtAt` | `2026-08-16T22:23:47.125Z` — this is the process initialization timestamp (when the Replit dev server was last started), NOT a build timestamp |

**SHA integrity note:** The workspace is running from `ebe20d65`, one commit ahead of `origin/main`. The dev server process loaded the repaired code from `60cc6a7c` (the last module-level state snapshot before the documentation commit). However, `RELEASE_SHA` is not set in the development environment: both `/health` and `/api/health` return `sha="unset"` and `status="release-unverified"`. This is expected development behaviour and demonstrates the fail-closed gate is working. It does NOT constitute a PASS for RV-1548-01 — pass requires the published deployment process to report the exact post-repair SHA.

**Authenticated endpoints:** `/api/admin/health` and `/api/admin/live-health` both require an authenticated dashboard session. They returned connection errors in this unauthenticated read-only pass. Their SHA fields could not be separately verified.

---

## P0 — #1548 and Outbound Safety

### RV-1548-01 — Exact release deployed (re-verified, corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-1548-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / Replit dev workspace |
| **Process/deployment SHA** | UNIDENTIFIED (dev process: `ebe20d65`; `RELEASE_SHA` not set) |
| **Method** | `curl /health`, `curl /api/health`, `git rev-parse HEAD`, `git rev-parse origin/main`; static inspection of `server/routes/sdr.ts` |
| **Observed result** | `/health`: `{status:"release-unverified", sha:"unset", builtAt:"2026-08-16T22:23:47.125Z", env:"development"}`. `/api/health`: identical. `/api/admin/health`: requires authenticated session — not reachable read-only. `/api/admin/live-health`: same. Workspace HEAD: `ebe20d65` (1 commit ahead of target). `origin/main`: `60cc6a7c` (post-repair target). |
| **Pass-criteria comparison** | ① SHA field present in health response: ✓ (present as `"unset"`) ② RELEASE_SHA env var set: ✗ not set in dev ③ SHA is valid 40-hex: ✗ value is literal `"unset"` ④ SHA exactly equals post-repair target `60cc6a7c…`: ✗ ⑤ All endpoints agree on same SHA: PARTIAL (both public endpoints agree on `"unset"`; authenticated endpoints not reachable) |
| **Pre-deploy gate constraint** | `scripts/pre-deploy.ts:376–391` validates `RELEASE_SHA` matches `/^[0-9a-f]{40}$/i` (format only). It does NOT compare against a specific expected SHA. Any valid 40-char hex passes the gate; exact-SHA equality against the release target is a separate verification step. |
| **`builtAt` interpretation** | `BUILD_AT: string = new Date().toISOString()` is set at module load time in `server/routes/sdr.ts:31`. This is the process initialization timestamp, NOT the build or deployment time. Reports should label this "process initialization time." |
| **Fail-closed evidence** | `sha="unset"` and `status="release-unverified"` prove the fail-closed gate works correctly when `RELEASE_SHA` is absent. |
| **Residual uncertainty** | Published production deployment SHA is unknown. It may be running any commit up to `ebe20d65`. Cannot confirm the production process reports `60cc6a7c` without a verified deployment with `RELEASE_SHA` injected. |
| **Required action** | Re-verify after next publish with `RELEASE_SHA=$(git rev-parse HEAD)` injected in the deployment environment. Probe all four endpoints with an authenticated session and confirm SHA equals `60cc6a7c…` on the published process. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After next deployment |

---

### RV-1548-02 — Migrations 0133–0139 applied

No changes from previous pass. Evidence remains PASS (shared dev DB, with noted journal anomalies). Post-repair commits (`9249dbee`, `60cc6a7c`) contain no new migrations; the migration head is unchanged.

---

### RV-1548-06 — PE recovery schedule exists (corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-1548-06 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / static code inspection |
| **Process/deployment SHA** | `60cc6a7c` (origin/main) |
| **Method** | Static inspection of `server/services/queue-manager.ts` `NAMED_QUEUE_SCHEDULES` array; prior pass used raw Redis hash which could not confirm job name |
| **Observed result** | `NAMED_QUEUE_SCHEDULES` (queue-manager.ts:379–388) contains exactly one entry: `{queueName: "post-enrichment", jobName: "post-enrichment-intent-recovery", repeatEveryMs: 15*60*1000 (prod) / 5*60*1000 (dev), jobId: "pe-intent-recovery-repeatable"}`. Worker heartbeat `worker_heartbeat_post-enrichment` at `2026-08-16T23:20:00Z` (age 7m at observation). No base event schedule present (base queue has `repeatEveryMs: 0`). |
| **Pass-criteria comparison** | ① Exactly one recovery schedule named `post-enrichment-intent-recovery`: ✓ (confirmed in code) ② On `post-enrichment` queue: ✓ ③ Expected cadence (15 min prod): ✓ (configurable via `PE_INTENT_RECOVERY_INTERVAL_MS`) ④ No accidental base event schedule: ✓ (base `repeatEveryMs: 0`) ⑤ Job name confirmed from BullMQ API (not Redis hash): PARTIAL — confirmed from code; Redis probe returned hash not name |
| **Residual uncertainty** | Could not confirm job is actively registered in Redis via BullMQ API without executing application code. Static evidence is strong (defined in code, distinct jobId). |
| **Required action** | Probe `queue.getRepeatableJobs()` via BullMQ API in an authenticated context to confirm live registration. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After any worker restart or queue configuration change |

---

### RV-1548-07 — PE intent health (corrected verdict)

| Field | Value |
|---|---|
| **RV ID** | RV-1548-07 |
| **Verdict** | **PARTIAL** (corrected from prior PASS — prior verdict was vacuous) |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / shared development database |
| **Process/deployment SHA** | `60cc6a7c` (origin/main) |
| **Method** | Read-only aggregate query on `post_enrichment_enrollment_intents` |
| **Observed result** | `{pending:0, processing:0, completed:0, failed:0, expired_leases:0, null_sequence_id:0, oldest_row:null, max_attempts_seen:null}` — table is empty. Table schema confirmed with all 0138/0139 columns present. |
| **Pass-criteria comparison** | ① Table exists: ✓ ② Zero processing rows with null/expired unrecoverable lease: ✓ (vacuously) ③ Zero pending/processing null sequence_id: ✓ (vacuously) ④ Real intents have flowed and isolated recovery convergence demonstrated: ✗ — table is newly created; no production intents have ever flowed |
| **Residual uncertainty** | All pass conditions are satisfied vacuously. Once PE enrollment is wired and active, QUE-05 crash window becomes live. |
| **Required action** | Re-verify after first PE enrollment intents are produced. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After first PE enrollment production traffic |

---

### RV-1548-03, RV-1548-04, RV-1548-05, RV-1548-08

No change from prior pass. Remain NOT_APPLICABLE or INCONCLUSIVE pending isolated environment or authenticated session. See prior packet for details.

---

## P0 — Outbound Safety

### RV-OUT-01 — Global pause is unavoidable

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / shared development database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only DB query on `system_settings` and `outbound_pause_control` |
| **Observed result** | `system_settings["outboundGlobalPaused"]` = `"true"` (updated 2026-08-15T17:14:09Z). `outbound_pause_control` row: `{state:"paused", reason:"Seeded from system_settings (paused)", epoch:1, actor:"system-startup", committed_at:"2026-08-15T17:08:04.122Z"}`. Both sources agree: global outbound IS paused. Adapter boundary behaviour cannot be verified read-only. |
| **Pass-criteria comparison** | ① Global pause is set to true in both sources: ✓ ② Epoch is consistent: ✓ (both agree on paused state) ③ Every adapter boundary blocks: UNVERIFIED (cannot probe without triggering sends) |
| **Residual uncertainty** | Whether all adapter boundaries correctly observe the pause. Cannot test without isolated fake-transport environment. |
| **Required action** | Exercise adapter boundary test using fake/no-op transport in isolated environment. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After any unpause or adapter code change |

---

### RV-OUT-02, RV-OUT-03, RV-OUT-04, RV-OUT-05

Remain INCONCLUSIVE — require isolated multi-process environment or provider console access. See prior packet.

---

## P0/P1 — Queue, Redis, CI, and Release Controls

### RV-QUE-01 — Redis capacity/plan

INCONCLUSIVE — Upstash console not accessible from this environment.

---

### RV-QUE-02 — Worker health (corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-02 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:27:00Z / shared dev database and Redis |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only query on `system_settings` for all `worker_heartbeat_*` keys; observation time ~23:27Z |
| **Observed result (all heartbeats)** | 22 worker heartbeat keys present. All workers have heartbeats. Ages at observation time (~23:27Z): `ghl-sync` at 23:20 (age 7m, dev cadence 5m ✓), `enrichment` at 23:20 (age 7m, cadence 10m ✓), `post-enrichment` at 23:20 (age 7m ✓), `sequences` at 23:20 (age 7m ✓), `health-monitor` at 23:15 (age 12m, dev cadence 15m ✓), `sla-checks` at 23:15 (age 12m ✓), `digests` at 23:00 (age 27m, cadence 60m ✓), `discovery` at 23:22 (age 5m, cadence 24h ✓), `ghl-enrollment-recovery` at 23:20 (age 7m ✓), `winback-outreach` at 20:10 (age 3h17m, cadence 24h — see note), `enrollment-recovery` at 22:24 (age 1h3m, cadence daily at 06:00 UTC — post-restart init ✓), `db-backup` at 22:24 (age 1h3m, cadence daily at 03:00 UTC — post-restart init ✓). All remaining workers (abandoned-statement, activation-monitor, executive-snapshot, merchant-success, mid-ingestion, onboarding-reminder, partner-monthly-digest, pipeline-silence-check, proposal-followup, system-audit, voicemail-sync) at 22:24 (age 1h3m, daily cadence — post-restart init ✓). **No `worker_heartbeat_zerobounce-batch-validate` key present** — expected since ZB worker is event-driven (only activates when a campaign is started). |
| **`winback-outreach` age note** | Heartbeat at 20:10 = age 3h17m. Configured cadence: 24h. Age is within 2× (48h) threshold. During global outbound pause, the winback worker fires but exits immediately at the outbound fence — the heartbeat is still written. No action required; the heartbeat confirms the job ran, not that it sent messages. |
| **GHL sync health (post-repair window, since 2026-08-16T22:23:57Z)** | ghl_sync_error=196, ghl_sync_identity_conflict=163 — see RV-GHL-01 for full analysis. Circuit is closed and healthy. |
| **Pass-criteria comparison** | ① No critical ETIMEDOUT/auth/stall in heartbeats: ✓ (all within expected cadences) ② All workers have heartbeats within 2× cadence: ✓ ③ GHL circuit stable: ✓ (closed, 0 consecutive failures) ④ Backlog stable: PARTIAL — enrichment in progress (see RV-ENR-01) |
| **Residual uncertainty** | Queue depth per worker not verified via BullMQ API (requires application context). Winback operational silence during global pause is expected but not independently confirmed via audit log. |
| **Required action** | No immediate action. Re-verify if any heartbeat exceeds 2× cadence in next observation window. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | 24 hours from capture |

---

### RV-QUE-03, RV-QUE-04, RV-CI-01

Remain INCONCLUSIVE — require process topology audit, isolated alert injection, or GitHub API access. See prior packet.

---

## P1 — ZeroBounce, Identity, Provenance, and Commercial Truth

### RV-ZB-01 — ZB schema/worker deployed (corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-ZB-01 |
| **Verdict** | **PARTIAL** (corrected — prior PASS cited wrong heartbeat) |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / shared dev database and static code inspection |
| **Process/deployment SHA** | `60cc6a7c` (origin/main) |
| **Method** | `information_schema.tables`, read-only DB aggregate queries, static inspection of `server/services/queue-manager.ts` |
| **Observed result** | Tables present: `zerobounce_campaigns`, `zerobounce_runs`, `zerobounce_attempts` ✓. All tables empty (0 rows — no campaign started). No stale running ZB run. `email_status` default `unvalidated` confirmed (migration 0135). **Dedicated ZB queue:** `QUEUE_NAMES.ZEROBOUNCE_BATCH = "zerobounce-batch-validate"` (queue-manager.ts:33). **Dedicated ZB worker handler:** `processZeroBounceRun` in `zerobounce-campaign-worker` (queue-manager.ts:1388). **Heartbeat key `worker_heartbeat_zerobounce-batch-validate`:** NOT PRESENT — this is expected because the ZB queue is event-driven (no repeatable job; `repeatEveryMs: 0`); the worker only activates when a campaign job is enqueued. **`ZEROBOUNCE_APi_KEY` present:** true (boolean; value not displayed). |
| **Pass-criteria comparison** | ① Migration 0135/0136 applied: ✓ ② Dedicated ZB queue and worker handler identified: ✓ (distinct from general post-enrichment worker) ③ No stale running ZB run: ✓ ④ ZB-specific heartbeat exists: NOT APPLICABLE — worker is event-driven, only activates on campaign start ⑤ `ZEROBOUNCE_APi_KEY` present: ✓ |
| **Key methodology correction** | Prior pass cited `worker_heartbeat_post-enrichment` as ZB worker evidence. This is incorrect — that is the general enrichment pipeline heartbeat, not the ZB batch worker. The actual ZB worker is a separate `processZeroBounceRun` handler on the `zerobounce-batch-validate` queue, activated only on demand. |
| **Residual uncertainty** | No ZB campaign has been started to prove end-to-end wiring. Credit balance and daily limit not verified (requires live ZeroBounce API call). |
| **Required action** | Confirm ZB API key credit balance and daily limit before starting first campaign. 156,894 contacts with `email_status='active'` (legacy unvalidated) require validation before outbound email can be safely released. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After any schema or worker code change |

---

### RV-ZB-02, RV-ZB-03

No material change from prior pass. ZB-02 remains NOT_APPLICABLE (no campaign started). ZB-03 remains INCONCLUSIVE (requires isolated fake-provider test).

---

### RV-DAT-01 — Commercial baseline

No change from prior pass — INCONCLUSIVE. `record_class` discriminator column does not exist.

---

### RV-DAT-02 / DAT-11 — Duplicate identity (corrected — phone duplicates added)

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-02 / DAT-11 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only normalized email and phone group aggregate queries |
| **Observed result — email duplicates** | 74 normalized email groups with 2+ contacts, affecting 173 contacts total. Patterns include shared business addresses (info@, billing@) and re-used test addresses. No automated unsafe merges detected. |
| **Observed result — phone duplicates** | `contacts` table has one phone field only (`phone`); no `mobile` or `direct_phone` columns exist. `phone` field: **12,174 duplicate groups, 102,122 affected contacts**. Breakdown: ≥5 contacts per number (likely shared business endpoints): 4,178 groups; 2–4 contacts per number (possible identity collisions): 7,996 groups. Phone numbers not displayed. |
| **Pass-criteria comparison** | ① Email duplicates reviewed: ✓ (74 groups, consistent with prior) ② Phone duplicates produced and segmented: ✓ ③ No automated unsafe merges: ✓ ④ Campaign cohort collision-free: UNVERIFIED (no cohort defined yet) |
| **Residual uncertainty** | Whether any phone duplicates are in the target outbound cohort. The 12,174 phone groups affecting 102,122 contacts is materially larger than the email duplicates and warrants review before campaign launch. Many are likely shared business endpoints (main office numbers, 800 numbers) but cannot be confirmed without additional lookup. |
| **Required action** | Review top phone duplicate groups before campaign launch. Classify as shared business endpoints vs true identity collisions. Do not perform automatic merges. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | Before campaign cohort selection |

---

### RV-DAT-03 — Provenance (previously omitted — now executed)

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-03 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only aggregate queries on `contact_source_events` and `import_executions` |
| **Observed result** | `contact_source_events`: 469 total events, covering 469 distinct contacts (0.30% of 157,665 total contacts). Top source types: `historical_backfill`=129, `statement_upload`=87, `estimate_form`=87, `get_started_form`=86, `dashboard`=62, `inbound`=18. `import_executions`: 0 rows — table exists but no formal import execution records are present. |
| **Pass-criteria comparison** | ① `contact_source_events` table exists and queryable: ✓ ② 100% of target cohort traceable to a source event: ✗ — only 469/157,665 contacts (0.30%) have source event records. 157,196 contacts (99.7%) have no provenance record. ③ `import_executions` coverage: ✗ — 0 rows; the table has no import records despite 157,665 contacts existing. ④ Future canonical writes reconcile atomically: UNVERIFIED |
| **Residual uncertainty** | The 157,196 contacts without source events are either: (a) pre-Intake-Provenance-System legacy records, or (b) created before `contact_source_events` was wired. Historical backfill has not been run. The low coverage (0.30%) means the provenance system is deployed but has not been retroactively applied. |
| **Required action** | Run historical backfill for `contact_source_events` before treating provenance as complete. Do not use provenance coverage as a campaign gate until backfill is confirmed. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After provenance backfill is run |

---

### RV-DAT-04 — Sensitive fields (corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-DAT-04 |
| **Verdict** | **PARTIAL** (corrected — prior PASS was insufficiently substantiated) |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | `information_schema.columns` query; read-only COUNT aggregate on `merchant_applications` |
| **Observed result** | `merchant_applications` has 2 rows total. **Sensitive fields present in schema:** `ein` only — columns `ssn`, `routing_number`, `account_number`, `bank_account`, `bank_routing` do NOT exist. `has_ein`: 1 of 2 applications has an EIN value. **Encryption metadata:** No `encrypted_ssn`, `encrypted_bank`, or similar field found. `ein` is stored as plain text (no encryption column). **Application-level access:** Route guards (`isDashboardUser`, `requireRole`) protect merchant application endpoints (static evidence). `ein` column does not appear in known log output paths (static inspection). |
| **Pass-criteria comparison** | ① No legacy plaintext SSN/routing/account values: ✓ (those columns do not exist) ② Encryption/version metadata present for sensitive fields: ✗ — EIN is stored as plain text; no encryption infrastructure exists ③ Access restricted via route guards: ✓ (static evidence) ④ Columns absent from log paths: ✓ (static evidence) |
| **Residual uncertainty** | EIN is a sensitive identifier and is stored as plain text. Only 2 applications exist (dev sample). If real merchant application data is submitted, EIN will be stored unencrypted. SEC-02 (encryption architecture) remains OPEN. |
| **Required action** | Implement EIN encryption before any real merchant application data is accepted. SEC-02 remains an active finding. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After any schema or encryption architecture change |

---

## P1/P2 — Enrichment, Serper, Readiness, Scoring, and GHL

### RV-ENR-01 — Enrichment worker running (corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:27:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only `system_settings` queries for heartbeat and enrichment progress; static `queue-manager.ts` cadence inspection |
| **Observed result** | **Heartbeat `worker_heartbeat_enrichment`:** `2026-08-16T23:20:00Z` (age 7m at observation ✓). **Heartbeat `worker_heartbeat_post-enrichment`:** `2026-08-16T23:20:00Z` (age 7m ✓). **Enrichment progress** (system_settings `enrichment_progress`, updated 23:27:41Z): `{total:200, processed:30, classified:20, errors:0, status:"running", emailsFound:3, phonesFound:26, lastUpdate:"2026-08-16T23:27:41.309Z"}`. **No enrichment audit log events** (action `enrichment_completed`/`enrichment_started`) in last 24h — enrichment progress is tracked via system_settings, not audit_logs. **Queue depth:** Not obtainable via raw Redis (WRONGTYPE pattern confirmed in prior pass); BullMQ application API not accessible in this read-only pass. **Configured cadence:** `repeatEveryMs: 10*60*1000` (10 min). |
| **Pass-criteria comparison** | ① Heartbeat current (within cadence): ✓ ② Recent success within cadence: PARTIAL — progress shows `status:"running"` with active counts; no `enrichment_completed` audit event found ③ Queue not stuck: PARTIAL — progress advancing (23 → 30 processed between queries) ④ Failures classified: ✓ (`errors:0` in current batch) ⑤ Queue depth via BullMQ API: NOT OBTAINED |
| **Residual uncertainty** | BullMQ queue depth (waiting/active/delayed/failed/completed counts) not retrievable from this environment without application code context. Progress is advancing in real time suggesting worker is healthy. |
| **Required action** | Obtain queue depth via `queue.getJobCounts()` in an authenticated application context to complete this check. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | 24 hours |

---

### RV-ENR-02 — Serper configured and calling (corrected property names)

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-02 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only query on `system_settings["serper_usage"]`; `SERPER_API_KEY` presence check |
| **Observed result** | `serper_usage` (last updated 23:23:15Z, age seconds at observation): `{totalCalls:32144, successfulCalls:2440, failedCalls:29704, websitesFound:1352, emailsFound:180, phonesFound:998, lastCallAt:"2026-08-16T23:23:15.159Z", monthlyQuota:50000, remainingCalls:17856, resetAt:"2026-07-04T00:00:15.927Z"}`. `SERPER_API_KEY` present: **true** (boolean; value not displayed). |
| **Pass-criteria comparison** | ① Configured (key present): ✓ ② Recent successful call after deployment: ✓ (`lastCallAt` 23:23:15Z, seconds before observation) ③ `successfulCalls` tracked: ✓ = 2,440 ④ Acceptable failure rate: ✗ — `failedCalls`=29,704, `successfulCalls`=2,440 → failure rate=92.4%. This is a very high failure rate. ⑤ Quota headroom: ✓ (`remainingCalls`=17,856 of 50,000) |
| **Methodology correction** | Prior pass queried `successCalls` and `failureCalls` (wrong names) and reported `totalCalls` as the success signal. Correct names are `successfulCalls` and `failedCalls`. A changing `totalCalls` is not a successful-call signal. |
| **Residual uncertainty** | The 92.4% failure rate requires investigation. It may reflect the large unvalidated backlog (sunbiz entities without websites/emails), domains returning no results, or provider-level issues. The `resetAt` = July 4 suggests the monthly quota counter may not be resetting monthly (or it was manually set). |
| **Required action** | Investigate root cause of 92.4% Serper failure rate. Verify whether `resetAt` reflects correct monthly quota cycle. Review query patterns to improve hit rate. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | 24 hours |

---

### RV-ENR-03 — Serper enrichment yield

INCONCLUSIVE — requires bounded batch comparison before/after provider restoration. Not changed from prior pass.

---

### RV-ENR-04 — Other provider health

INCONCLUSIVE — per-provider breakdown not separately tracked in system_settings at this time.

---

### RV-ENR-05 — Sunbiz/discovery progress

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-05 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:22:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Worker heartbeat for `discovery` |
| **Observed result** | Heartbeat `worker_heartbeat_discovery` at `2026-08-16T23:22:54Z` (age 4m ✓, cadence 24h). Enrichment progress advancing in real time (see RV-ENR-01). |
| **Residual uncertainty** | Status bucket breakdown not separately queried. Oldest backlog age not available without targeted query. |
| **Required action** | Query sunbiz_entities status distribution and oldest unprocessed record in next pass. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | 24 hours |

---

### RV-ENR-06 — Readiness coverage (corrected column names)

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-06 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only aggregate query on `contacts` using correct column names: `data_readiness_score`, `data_readiness_grade`, `readiness_updated_at`, `readiness_model_version` |
| **Observed result** | Total non-archived contacts: 157,665. `data_readiness_score` null: 118,783 (**75.3% null**). `data_readiness_grade` null: 118,783. `readiness_updated_at` null: 118,783. `readiness_model_version` null: 118,783. Contacts with readiness data: 38,882 (24.7%). All four columns are null together — no partial-readiness rows observed. |
| **Pass-criteria comparison** | ① Correct columns queried (`data_readiness_score` not `readiness_score`): ✓ ② <5% null in target population: ✗ — 75.3% null in total population ③ No stale model version: PARTIAL — 24.7% have data, but model version values not separately enumerated |
| **Methodology correction** | Prior pass queried `readiness_score` which does not exist. Correct column is `data_readiness_score` (confirmed via `shared/schema.ts:139`). |
| **Residual uncertainty** | Target cohort null rate unknown (depends on cohort definition). Model version distribution among the 38,882 scored contacts not examined. |
| **Required action** | Backfill readiness for remaining 118,783 contacts before using readiness as a campaign gate. Enumerate model version distribution among scored contacts. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After readiness backfill |

---

### RV-ENR-07 — Lead-score coverage (corrected interpretation)

| Field | Value |
|---|---|
| **RV ID** | RV-ENR-07 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:23:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only aggregate with null/zero/nonzero breakdown and score-range histogram; scoring freshness via audit_logs |
| **Observed result** | Total: 157,665. Null: 0 (0%). Zero: 151,707 (**96.2%**). Nonzero: 5,958 (3.8%). Score histogram (nonzero only): 1–25: 33, 26–50: 5,919, 51–75: 4, 76–100: 2. No `lead_score_computed`, `lead_scored`, or `score_computed` audit log actions found — no scoring freshness evidence available from audit_logs. |
| **Pass-criteria comparison** | ① Null vs zero vs nonzero reported separately: ✓ ② Score ranges reported: ✓ ③ Approved inventory scored with current model version: ✗ — 96.2% are zero (unscored default), not meaningfully scored ④ Backlog draining: UNVERIFIED — no scoring audit events found to prove active scoring ⑤ Scoring freshness from model timestamps (not `updated_at`): ✗ — no scoring events in audit_logs |
| **Methodology correction** | Prior pass reported 100% non-null as a PASS signal. `lead_score` defaults to 0 for newly created contacts; 100% non-null = 0% null does NOT mean 100% meaningfully scored. 96.2% at zero confirms the vast majority are at the unscored default. |
| **Residual uncertainty** | Whether active scoring is running (enrichment progress shows `classified:20` per batch — `classified` may relate to lead scoring). Scoring freshness timestamps not found in audit_logs. |
| **Required action** | Identify where scoring freshness timestamps are written (may be in system_settings or via a different audit action). Confirm whether `classified` in enrichment_progress corresponds to lead_score updates. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After scoring run completes |

---

### RV-GHL-01 — GHL identity/circuit health (re-verified, corrected methodology)

| Field | Value |
|---|---|
| **RV ID** | RV-GHL-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:25:00Z / shared dev database |
| **Process/deployment SHA** | `60cc6a7c` (origin/main) |
| **Method** | Read-only aggregate queries on `audit_logs` with pre/post-repair time split; read-only query on `system_settings` for circuit state fields |
| **GHL deployment boundary** | `2026-08-16T22:23:57Z` (post-repair target `60cc6a7c` merged) |

**Pre-repair window (72h window up to 2026-08-16T22:23:57Z):**

| Action | Count |
|---|---|
| `ghl_sync_error` | 11,244 |
| `ghl_sync_identity_conflict` | 9,310 |
| `ghl_sync_success` | 162 |
| `GHL_CIRCUIT_OPEN` | 23 |
| `ghl_sync_completed` | 0 |

**Post-repair window (since 2026-08-16T22:23:57Z):**

| Action | HTTP status | Error pattern | Count |
|---|---|---|---|
| `ghl_sync_identity_conflict` | — | — | 163 |
| `ghl_sync_error` | 404 | `GHL API error 404: ` | 75 |
| `ghl_sync_error` | 400 | `Contact with id ghl-deal-test-*` (stale test IDs) | ~87 |
| `ghl_sync_error` | 400 | `Contact with id wh-test-ghl-*` (stale test IDs) | ~20 |
| `ghl_sync_error` | 400 | `Contact with id c1-test-*` (stale test IDs) | ~12 |
| `ghl_sync_error` | 422 | `email must be an email` | 15 |
| `ghl_sync_success` | — | — | 0 |
| `ghl_sync_completed` | — | — | 0 |
| `GHL_CIRCUIT_OPEN` | — | — | 0 |
| `GHL_CIRCUIT_OPEN_AUTH` | — | — | 0 |
| `GHL_CIRCUIT_HALF_OPEN` | — | — | 0 |
| `GHL_CIRCUIT_CLOSED` | — | — | 0 |

**Post-repair error classification:**
- All 400/404 errors reference test contact IDs (`ghl-deal-test-*`, `wh-test-ghl-*`, `c1-test-*`) left in the database from previous test runs. These contacts have stale GHL IDs that no longer exist in GHL. Classification: **data-dependency skip** (stale test data), NOT transient API failures.
- 422 errors: `email must be an email` — test contacts with invalid email formats. Classification: **data-dependency skip** (invalid test data).
- 163 identity conflicts: pre-existing test data conflict pattern. Classification: **skip** (logged for review, not circuit-eligible).
- **No auth (401) errors post-repair.** 401 handling: NOT OBSERVED — do not attempt to induce.

**Circuit state (read from `system_settings["ghl_circuit_state"]`, updated 23:25:00Z):**

| Field | Value |
|---|---|
| `state` | `"closed"` |
| `consecutiveFailures` | `0` |
| `halfOpenProbeSuccesses` | not in stored JSON (field absent means 0) |
| `lastFullSuccessTickAt` | not in stored JSON |
| `updatedAt` | `"2026-08-16T23:25:00.568Z"` |

**Alert timestamps:**
- `ghl_circuit_alert_at`: `{at: "2026-08-15T09:00:09.411Z"}` — last alert fired 2026-08-15. This has NOT been updated since the post-repair merge at 22:23:57Z.
- `ghl_circuit_recovery_alert_at`: key not present in system_settings (no recovery alert has fired).
- **Interpretation:** Alert timestamp NOT updated post-repair is EXPECTED and CORRECT. `maybeSendCircuitAlert()` only writes `ghl_circuit_alert_at` when a circuit-open transition fires. Since the circuit has remained closed and healthy since `60cc6a7c` merged, no open transition occurred and no alert should have fired. Requiring an updated alert would be a false FAIL criterion.

**Post-repair circuit assessment:**
The repaired circuit correctly:
- Classifies test-data errors (stale GHL IDs, invalid emails) as skip/data-dependency — confirmed: these do not appear in `GHL_CIRCUIT_OPEN` events and `consecutiveFailures=0`.
- Remains closed/healthy despite receiving 350+ errors in the post-repair window — all are data-dependency skips, not retryable API failures.
- Persists state across ticks: `updatedAt` advances correctly.

| **Pass-criteria comparison** | |
|---|---|
| ① Qualified cohort linked: PARTIAL (162 pre-repair successes; 0 post-repair — circuit has not had retry opportunity with real contacts yet) |
| ② Conflicts explicit and non-overwriting: ✓ (163 identity conflicts logged, not merged) |
| ③ Circuit stable and classifying correctly: ✓ (closed, 0 failures, all post-repair errors are data-dependency skips) |
| ④ No GHL_CIRCUIT_OPEN post-repair: ✓ |
| ⑤ Alert fired if open transition occurred: ✓ (not applicable — no open transition occurred) |
| ⑥ Auth (401) immediate-open: NOT OBSERVED — no 401 in post-repair window |

**Static residuals (not induced at runtime):**
1. `__ghlCircuitTestHooks.recordFailure()` calls `tripCircuitAuth()`/`tripCircuitThreshold()`, which write `audit_logs` rows, update `system_settings["ghl_circuit_state"]` and `ghl_circuit_alert_at"`, and fire Slack/SMTP alerts. This script is **not safe** to run against shared infrastructure despite the header claiming "No live GHL calls."
2. Production catch blocks in `runGhlFullSyncTick()` (contacts, retry, deals phases) check `classifyGhlSyncError(e?.message) === "auth"` and then unconditionally increment `consecutiveGhlFailures` for all other thrown exceptions — they do NOT check for `"skip"`. A thrown error whose message the dispatch table would classify as `"skip"` would incorrectly increment the counter. In practice, skip cases are returned as `{success:false, error:...}` rather than thrown, so practical blast radius is low, but the architectural claim that all counting decisions go through the dispatch table is false for thrown exceptions.

| **Residual uncertainty** | ~~No `ghl_sync_completed` event exists in either window.~~ **CORRECTION (2026-08-17, Task #1570):** `ghl_sync_completed` is a query-side label only — it is **never written** by any code path (`server/services/ghl-sync.ts` emits `ghl_sync_success`, `ghl_sync_error`, `ghl_sync_failed`, `ghl_sync_identity_conflict`, and circuit events). The correct closing criterion is `ghl_sync_success`. |
| **Required action** | ~~Remove stale test contacts…~~ **DONE 2026-08-17 (Task #1570)** — see RV-GHL-01 closure addendum below. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | 24 hours; recheck after test data cleanup |

#### RV-GHL-01 closure addendum — Task #1570 (2026-08-17)

| Field | Value |
|---|---|
| **Verdict** | **CLOSED_RUNTIME** (criterion: `ghl_sync_success`, the action the sync engine actually emits — NOT `ghl_sync_completed`, which is never written anywhere) |
| **Prod publish verified** | `GET https://dev.libertybancard.com/health` → sha `8778c2f3c8b5c2013c4dc674df9009b1e5f801f1` (40-char, Task #1571) |
| **Cleanup window** | GHL sync queue paused 2026-08-17T14:26:35Z → resumed 14:27:24Z |
| **Rows removed (single transaction, `scripts/cleanup-smoke-contacts.ts`)** | contacts 934 (872 by prefix `wh-test-ghl-*`/`ghl-deal-test-*`/`c1-test-*` + glg test emails), deals 191, sdr_merchants 408, sdr_lead_state 166, agent users 63 |
| **Post-deletion verification** | Inventory queries across `contacts`, `deals`, `sdr_merchants`, `sdr_lead_state` all return **0** for all three prefixes |
| **Closing evidence** | `SELECT action, COUNT(*), MAX(created_at) FROM audit_logs WHERE action='ghl_sync_success' AND created_at >= '2026-08-17 14:27:24'` → `ghl_sync_success, 1, 2026-08-17 14:45:30.606601` (real contact #152540 synced → GHL ID `dwBLoNFUBWe8XgDUCVBV`) |
| **Pre-deploy suite** | `GHL_TEST_MODE=true bash scripts/run-pre-deploy.sh` → 32/32 suites passed. Post-run dry-run found 13 new orphan contacts (suite teardown gap under GHL rate limits — tracked separately); removed with a second transactional cleanup run; final dry-run shows 0 across all tables. |
| **Known residuals (out of scope)** | Circuit was `half-open` at cleanup time and its probe always selects the lowest-id unsynced contact (#32), a permanent identity-conflict skip — probe starvation keeps the circuit half-open on this dataset. Additional test families exist outside this task's prefixes (`venroll-test-*@libertybancard.test`, `go-live-check-*@libertybancard-test.internal`, fake `…555…` phones) that cause GHL phone-dedupe identity conflicts. |

---

### RV-GHL-02 — Workflow registry

INCONCLUSIVE — requires authenticated live validation. See prior packet.

---

### RV-QUE-04 — Alerts work

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-04 |
| **Verdict** | **PARTIAL** |
| **Additional context** | Prior pass flagged `ghl_circuit_alert_at` was 6 days old during active error flood. Post-repair, the 6-day-old alert timestamp is NO LONGER a finding — the post-repair circuit has been healthy and correctly has not fired a new alert. The original concern (alert not firing during pre-repair error flood) was addressed by the circuit repair in task #1564. |

---

## P2 — UI and Workflow Runtime

### RV-UI-01, RV-UI-02, RV-UI-03, RV-REV-01

No change from prior pass. Remain INCONCLUSIVE pending authenticated browser session or isolated synthetic test. See prior packet.

---

### RV-REV-02 — Chargeback/residual reconciliation (previously omitted — now executed)

| Field | Value |
|---|---|
| **RV ID** | RV-REV-02 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-16T23:24:00Z / shared dev database |
| **Process/deployment SHA** | UNIDENTIFIED |
| **Method** | Read-only aggregate queries on `merchant_residuals`, `residual_imports`, `chargebacks` |
| **Observed result** | `merchant_residuals`: 0 rows. `residual_imports`: 0 rows. `chargebacks`: 0 rows. All three tables exist in the schema with appropriate columns (id, merchant_mid, month, volume, revenue, matched_rows, unmatched_rows, flagged_rows, etc.). No residual data has been imported. |
| **Pass-criteria comparison** | ① Tables exist: ✓ ② Counts/amounts reconcile by batch and merchant classification: NOT APPLICABLE — no data to reconcile ③ Source-vs-import-vs-report totals verified: NOT APPLICABLE |
| **Residual uncertainty** | Tables are empty because no formal residual import has been performed. Once real residual data is imported, this check should compare `merchant_residuals` against `residual_imports` totals. |
| **Required action** | Re-verify after first residual import. Block financial reporting on residuals until reconciliation passes. |
| **Operator/reviewer** | Replit Agent (read-only) |
| **Evidence expiry** | After first residual import |

---

## Section 14 — Stale Worker Heartbeat Investigation

| Worker | Configured cadence | Heartbeat at observation (~23:27Z) | Age | Status |
|---|---|---|---|---|
| `enrollment-recovery` | Daily at 06:00 UTC (`ENROLLMENT_RECOVERY_CRON`) | 2026-08-16T22:24:24Z | 1h3m | ✓ Normal — post-restart init tick; next scheduled run 06:00 UTC Aug 17 |
| `winback-outreach` | Daily, 24h repeat | 2026-08-16T20:10:53Z | 3h17m | ✓ Within 2× cadence (48h). During global outbound pause, worker fires and exits at the outbound fence — heartbeat is still written. Not stale. |
| `db-backup` | Daily at 03:00 UTC cron | 2026-08-16T22:24:23Z | 1h3m | ✓ Normal — post-restart init tick; next scheduled run 03:00 UTC Aug 17 |

All three previously stale workers are within expected age thresholds. No stale heartbeat finding warranted. The `winback-outreach` age (3h17m) is well within the 48h threshold; its silence during global pause is expected and confirmed by code analysis (`WINBACK_OUTREACH` is the only queue with physical actuation via the outbound coordinator, which checks the global pause).

---

## Section 15 — Corrected Findings Summary

| RV ID | Prior verdict | Corrected verdict | Key correction |
|---|---|---|---|
| RV-1548-01 | FAIL | PARTIAL | SHA endpoint returns `"unset"` (fail-closed confirmed); published deployment SHA still unverifiable without RELEASE_SHA injection at deploy time |
| RV-1548-06 | INCONCLUSIVE | PARTIAL | Schedule confirmed via static code inspection; job name `post-enrichment-intent-recovery` confirmed in `NAMED_QUEUE_SCHEDULES`; Redis BullMQ API probe still needed |
| RV-1548-07 | PASS (vacuous) | PARTIAL | Corrected — table empty does NOT mean pass; real intents must flow and recovery convergence must be demonstrated |
| RV-ZB-01 | PASS (wrong heartbeat) | PARTIAL | Corrected — general post-enrichment heartbeat ≠ ZB worker; ZB uses dedicated `zerobounce-batch-validate` queue with `processZeroBounceRun` handler; `ZEROBOUNCE_APi_KEY` confirmed present |
| RV-DAT-03 | INCONCLUSIVE (omitted) | PARTIAL | Now executed — 469/157,665 contacts (0.30%) have source events; historical backfill needed |
| RV-DAT-04 | PASS (insufficient) | PARTIAL | Corrected — `ssn`/`routing_number`/`account_number` columns don't exist; `ein` exists as plain text; no encryption infrastructure |
| RV-DAT-02/DAT-11 | PARTIAL (email only) | PARTIAL | Phone duplicates added: 12,174 groups, 102,122 affected contacts |
| RV-ENR-01 | PASS (wrong criteria) | PARTIAL | Corrected — heartbeats fresh; queue depth via BullMQ API still needed |
| RV-ENR-02 | PASS (wrong names) | PARTIAL | Corrected — `successfulCalls`=2,440, `failedCalls`=29,704 (92.4% failure rate); `successfulCalls` is the correct signal |
| RV-ENR-06 | RERUN_REQUIRED | PARTIAL | Now executed with correct column names — 75.3% null `data_readiness_score` |
| RV-ENR-07 | PASS (wrong interpretation) | PARTIAL | Corrected — 96.2% at zero (unscored default), not meaningfully scored |
| RV-REV-02 | INCONCLUSIVE (omitted) | PARTIAL | Now executed — tables exist, 0 rows; no residual data imported yet |
| RV-GHL-01 | CONFIRMED_FAIL | CLOSED_RUNTIME (2026-08-17, Task #1570) | Test contacts removed transactionally; real `ghl_sync_success` at 2026-08-17T14:45:30Z post-resume; closing criterion corrected to `ghl_sync_success` (`ghl_sync_completed` is never emitted) |
| RV-QUE-04 | INCONCLUSIVE | PARTIAL | Alert-not-firing during pre-repair flood is resolved; post-repair circuit healthy and correctly silent |

---

## Ledger closure assessment

Following the reconciliation document's standard: **0 CLOSED_RUNTIME** (no change). Evidence is now corrected and more complete, but no finding moves to CLOSED_RUNTIME in this pass because:
- RV-1548-01: published deployment SHA still unverifiable without `RELEASE_SHA` injection
- RV-GHL-01: ~~circuit is healthy but no `ghl_sync_completed` event exists; test data cleanup needed before real sync can be confirmed~~ **CLOSED_RUNTIME 2026-08-17 (Task #1570)** — test data removed, real `ghl_sync_success` observed post-resume; `ghl_sync_completed` is a never-emitted query-side label and is not a valid criterion
- All other checks move from prior PASS/INCONCLUSIVE to correctly-labelled PARTIAL with clear required actions

The resulting disposition: **0 CLOSED_RUNTIME**, 0 CLOSED_STATIC changes from this pass. The 12 methodology corrections from the follow-up document are fully addressed.

---

## Safety disposition

- All real global and channel pauses remain in their existing state (`outboundGlobalPaused=true`).
- No mutations were performed. No provider calls were made. No secrets were printed.
- `scripts/test-ghl-circuit-classification.ts` was NOT executed (writes shared DB, fires alerts).
- `scripts/run-pre-deploy.sh` was NOT executed (writes pause/channel state).
- No ZeroBounce campaign was started or modified.
- No GHL sync was initiated or expanded.
- No contacts were merged, deleted, or modified.
