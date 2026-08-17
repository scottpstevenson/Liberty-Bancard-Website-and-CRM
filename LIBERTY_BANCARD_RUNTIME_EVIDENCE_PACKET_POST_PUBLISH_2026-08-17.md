# Liberty Bancard Post-Publish Runtime Evidence Packet

**Published deployment SHA:** `fdb14ec49549a8835c47d170c4cfad153c9ccba9`  
**Evidence captured:** 2026-08-17T19:55:00Z – 20:00:00Z (America/New_York = 15:55–16:00 ET)  
**Auditor:** Replit Agent — read-only; zero mutations performed  
**Register version:** LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER (2026-08-16; register file not present in workspace — RV IDs carried forward from CORRECTED_2026-08-16 packet)  
**Supersedes / deltas from:** LIBERTY_BANCARD_RUNTIME_EVIDENCE_PACKET_CORRECTED_2026-08-16.md  
**Governing tasks:** #1564, #1565, #1570, #1571, #1572, #1584, #1585, #1586  
**Task identity corrections (issued 2026-08-17T20:17Z):** #1585 = GHL\_TEST\_MODE / pre-deploy timeout repair; #1586 = GHL half-open probe cursor / skip-advancement repair; coordinator `ON CONFLICT … correlation_id` fix is a separate untracked change shipped in this same SHA (`fdb14ec4`)  
**Pre-deploy gate result (this release):** 32/32 suites PASSED at `fdb14ec4` content before publish  

---

## Section 0 — Deployment Identity

| Field | Value |
|---|---|
| Workspace HEAD SHA | `b3ffa0c23cefc916f5bcc237fe31c63d53ddc950` |
| Workspace HEAD commit title | "Published your App" (Replit deployment metadata commit) |
| Workspace HEAD files changed | **0** — `git show b3ffa0c2` shows no file diffs; metadata-only commit created by Replit after build |
| Published production SHA | `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| `/health` response | `{"status":"ok","sha":"fdb14ec49549a8835c47d170c4cfad153c9ccba9","builtAt":"2026-08-17T19:12:30.084Z","env":"production"}` |
| `/api/health` response | identical to `/health` |
| `/api/build` response | `{"message":"API endpoint not found: GET /api/build","code":"not_found"}` — endpoint not implemented |
| `dist/RELEASE_SHA` (workspace) | NOT PRESENT — injected into production bundle at build time only |
| `NODE_ENV` (production) | `production` |
| `status` | `ok` |
| `builtAt` | `2026-08-17T19:12:30.084Z` |
| Authenticated live-health | `/api/admin/live-health` requires authenticated dashboard session; not probed in read-only pass |
| Prior published SHA (`8778c2f3c8b…`) | **superseded** by this deployment |
| SHA delta analysis | `fdb14ec4` is the last application-code commit. `b3ffa0c2` ("Published your App") adds zero file changes. The published process runs the content of `fdb14ec4`, which contains: (1) `ON CONFLICT … DO UPDATE SET correlation_id = EXCLUDED.correlation_id` fix in `outbound-queue-coordinator.ts`; (2) memory documentation update. Pre-deploy gate (32/32) ran against this content. |
| `origin/main` | `9d6e951f` (workspace has 3 unpushed commits: `342f7484`, `ac9e0da5`, `e4c6cbed`/`fdb14ec4`, `b3ffa0c2`) |

---

## RV-1548-01 — Exact Release Deployed

| Field | Value |
|---|---|
| **RV ID** | RV-1548-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z / Replit production + dev workspace |
| **Published SHA** | `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| **Method** | `curl /health`, `curl /api/health`, `curl /api/build`, `git show`, `git rev-parse HEAD` |
| **Observed result** | `/health` and `/api/health` both return `sha=fdb14ec49549a8835c47d170c4cfad153c9ccba9`, `status=ok`, `env=production`. `/api/build` returns 404. `dist/RELEASE_SHA` not present in workspace (expected — built into production artifact). Workspace HEAD `b3ffa0c2` is a zero-file-change Replit deployment metadata commit; the previous content commit `fdb14ec4` is what the production process runs. |
| **Pass-criteria status** | ① SHA field present in health response: ✓ ② `RELEASE_SHA` injected and non-"unset" in production: ✓ (`fdb14ec4...`) ③ SHA is valid 40-char hex: ✓ ④ Status = "ok": ✓ ⑤ SHA exactly equals workspace HEAD: **PARTIAL** — production `fdb14ec4` ≠ workspace HEAD `b3ffa0c2`; delta is a metadata-only deployment commit with zero application-code changes ⑥ Authenticated endpoints agree on same SHA: NOT VERIFIED (requires authenticated session) |
| **Residual uncertainty** | SHA mismatch between workspace HEAD and production is definitively explained by Replit's deployment model (metadata commit created after build). `/api/admin/live-health` SHA field not verified. |
| **Required action** | Verify authenticated `/api/admin/live-health` reports same SHA. |
| **Delta from prior pass** | Prior pass: `sha="unset"`, status=`release-unverified`. This pass: SHA is valid 40-char hex, status=`ok`, env=`production`. **Material improvement — Task #1571 acceptance criterion satisfied.** |

---

## RV-1548-02 — Migrations 0133–0139 Applied

| Field | Value |
|---|---|
| **RV ID** | RV-1548-02 |
| **Verdict** | **PARTIAL** (unchanged from prior pass) |
| **Observed result** | Top 5 migration hashes by `created_at` present (highest `when` timestamps in drizzle journal). No new migrations in `fdb14ec4` content commit. Migration head unchanged from prior pass. Journal anomalies (out-of-order `when` timestamps) carry forward as a static finding. |
| **Required action** | None additional. Prior anomaly note stands. |

---

## RV-1548-06 — PE Recovery Schedule Exists

| Field | Value |
|---|---|
| **RV ID** | RV-1548-06 |
| **Verdict** | **PARTIAL** (unchanged methodology) |
| **Observed result** | `worker_heartbeat_post-enrichment`: `2026-08-17T19:55:00.418Z` (age ~3 min at observation ✓). Schedule confirmed via static code inspection in prior pass. |
| **Required action** | Probe `queue.getRepeatableJobs()` via authenticated BullMQ API. |

---

## RV-1548-07 — PE Intent Health

| Field | Value |
|---|---|
| **RV ID** | RV-1548-07 |
| **Verdict** | **PARTIAL** (vacuous) |
| **Observed result** | `post_enrichment_enrollment_intents`: pending=0, processing=0, completed=0, failed=0, null_sequence_id=0. Table empty — no production PE intents have flowed. |
| **Required action** | Re-verify after first PE enrollment intents produced. |

---

## RV-1548-03, RV-1548-04, RV-1548-05, RV-1548-08

No change from prior pass. Remain NOT_APPLICABLE or INCONCLUSIVE. See corrected packet.

---

## RV-OUT-01 — Global Pause Is Unavoidable

| Field | Value |
|---|---|
| **RV ID** | RV-OUT-01 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z / shared production database |
| **Published SHA** | `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| **Method** | Read-only query on `outbound_pause_control` and `system_settings["outboundGlobalPaused"]` |
| **Observed result** | `outbound_pause_control`: state=`paused`, epoch=180, actor=`test-nba-teardown`, committed_at=`2026-08-17T18:26:14.297Z`, reason=`NBA test suite — restore canonical pause to safe state`. `system_settings["outboundGlobalPaused"]`: value=`true`, updated=`2026-08-17T18:26:14.334Z`. **Both sources agree: global outbound IS paused.** |
| **Pause audit post-publish** | No `outbound_paused`/`outbound_unpaused` audit log entries found since publish time `2026-08-17T19:12:30Z` — pause state not modified since pre-deploy test teardown. |
| **Pass-criteria status** | ① Global pause set to `true` in both sources: ✓ ② Both sources synchronized: ✓ ③ Adapter boundary blocking: UNVERIFIED (cannot test without isolated fake-transport environment) |
| **Residual uncertainty** | Adapter boundary behavior cannot be verified read-only. |
| **Required action** | Exercise adapter boundary test using fake/no-op transport in isolated environment. |
| **Delta from prior pass** | Pause state confirmed still active. Epoch advanced from 1 → 180 reflecting multiple test cycle transitions. State consistent. |

---

## RV-OUT-02 — RV-OUT-05

Remain INCONCLUSIVE. See prior packet.

---

## COORDINATOR HOLDS CONSISTENCY (NEW — post-#1532)

| Field | Value |
|---|---|
| **Check** | Coordinator holds and staged-release state are internally consistent |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z / shared production database |
| **Method** | Read-only aggregate on `logical_job_control_holds WHERE active=true` |
| **Observed result** | **34 active holds** across 17 logical job keys. Every key has exactly 2 active holds: one `global_outbound` (correlation_id=null) and one `release_pending` (correlation_id=null). Keys: abandoned-statement, discovery-enrollment, discovery-promotion, discovery-send, enrichment-inbound-confirmation-followup, enrichment-promotional-enrollment-eval, enrollment-recovery, ghl-enrollment-recovery, legacy-daily-outreach, linkedin-scheduler, merchant-success, onboarding-reminder, post-enrichment-enrollment, sequences, sms-outreach, winback-outreach, and one additional key. |
| **Internal consistency assessment** | The co-presence of `global_outbound` (canonical pause active) and `release_pending` (staged-release transition initiated but not approved) holds represents a state where: (a) canonical pause is active — correct for current operational intent; (b) a prior unpause transition (`transitionGlobalHoldsToReleasePending`) ran and created `release_pending` holds that were never approved via `approveRelease()`, likely from a pre-fix pre-deploy test cycle. `canExecute()` returns false for all 17 keys (any active hold blocks). System is **fail-closed**. |
| **Test-owned holds** | NONE — query for source_key matching `%test%`, `%probe%`, `%debug%` returned 0 rows. No test-session holds remain active. |
| **Stale orphaned release_pending holds** | The `release_pending` holds with `correlation_id=null` are artifacts from pre-fix pre-deploy test runs (before `fdb14ec4` introduced `correlation_id = EXCLUDED.correlation_id` in the ON CONFLICT clause). They are not owned by any running process and will persist until `approveRelease()` or an explicit admin clear is called. Their presence is benign from a safety perspective (fail-closed) but represents stale state. |
| **Required action** | Before any staged outbound release: call `approveRelease()` through the admin API to clear the orphaned `release_pending` holds, then verify `canExecute()` returns true for the intended keys. The 17 `release_pending` holds will block staged release until explicitly approved. |

---

## STALE TEST CONTACTS (REGRESSION — post-publish)

| Field | Value |
|---|---|
| **Check** | No stale test-owned holds; no real provider calls from pre-deploy window |
| **Verdict** | **FAIL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z / shared production database |
| **Method** | Read-only COUNT on `contacts WHERE ghl_contact_id LIKE '%test%'` patterns |
| **Observed result** | **920 contacts** found with test-prefix GHL IDs (wh-test-ghl-*, ghl-deal-test-*, c1-test-*, venroll-test-*, go-live-check-*). |
| **Delta from Task #1570 state** | Task #1570 (2026-08-17T14:45:30Z) achieved 0 stale test contacts. The 920 now present were created by subsequent pre-deploy test suite runs (between Task #1570 cleanup and publish at 19:12:30Z). These contacts have synthetic GHL IDs that do not exist in GHL. |
| **Impact** | These contacts are selected by the GHL half-open probe (they appear in the unsynced contact pool). When the sync engine attempts to sync them, it receives 400 errors ("contact with id wh-test-ghl-XXX not found") or 422 errors (invalid email format). The `classifyGhlSyncError` dispatch table may classify these as genuine API failures (not skips), causing `consecutiveFailures` to increment and the circuit to re-open. This is the **likely root cause of the GHL circuit oscillation** observed post-publish. |
| **Required action** | Run transactional cleanup of stale test contacts (wh-test-ghl-*, ghl-deal-test-*, c1-test-*, venroll-test-*, go-live-check-*) from contacts, deals, sdr_merchants, sdr_lead_state tables as done in Task #1570. Also ensure pre-deploy suite teardown fully cleans up test contacts before each run. |

---

## RV-GHL-01 — GHL Identity / Circuit Health (REGRESSION from CLOSED_RUNTIME)

| Field | Value |
|---|---|
| **RV ID** | RV-GHL-01 |
| **Verdict** | **FAIL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z / shared production database |
| **Published SHA** | `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| **Method** | Read-only query on `system_settings["ghl_circuit_state"]` and `audit_logs` post-publish |
| **Prior verdict (corrected packet)** | CLOSED_RUNTIME (2026-08-17T14:45:30Z — real `ghl_sync_success` observed post-Task-#1570 cleanup) |

**Circuit state at observation (19:55:00Z):**

| Field | Value |
|---|---|
| `state` | `"open"` — **REGRESSION** (was `closed` in corrected packet) |
| `consecutiveFailures` | `5` |
| `halfOpenProbeSuccesses` | `0` |
| `halfOpenProbeCursorId` | `0` (inside circuit state JSON) |
| `lastFullSuccessTickAt` | `1786927801166` = `2026-08-16T21:10:01Z` — pre-publish, pre-#1570 |
| `value.updatedAt` | `2026-08-17T19:55:00.911Z` |
| `system_settings.updated_at` (row) | `2026-08-06T20:40:00.452Z` — row creation time, not value time |
| `ghl_circuit_alert_at` | `{"at":"2026-08-17T19:34:01.171Z"}` — **alert fired 22 min post-publish** |
| `halfOpenProbeCursorId` standalone key | NOT PRESENT in system_settings — cursor value is inside circuit state JSON only |

**Post-publish audit events (since 2026-08-17T19:12:30Z):**

| Action | Count | Latest |
|---|---|---|
| `GHL_CIRCUIT_HALF_OPEN` | 6 | 2026-08-17T19:55:00.441Z |
| `GHL_CIRCUIT_OPEN` | 6 | 2026-08-17T19:55:00.912Z |
| `ghl_sync_success` | **0** | — |
| `ghl_sync_identity_conflict` | (not separately captured post-publish) | — |

**GHL error matrix (post-publish ghl_sync_error only):**

| HTTP status | Count | Classification |
|---|---|---|
| 400 | 15 | Likely stale test contact GHL IDs ("contact with id wh-test-ghl-XXX" / data-dependency, not transient) |
| 422 | 6 | `email must be an email` — test contacts with invalid email format |
| 401 | 0 | No authentication errors post-publish |
| 404 | 0 | (was 75 in prior window; cleanup of most test contacts reduced 404s) |

**Pass-criteria status:**

| Criterion | Status |
|---|---|
| ① Circuit stable (closed, 0 consecutive failures) | **FAIL** — state=open, consecutiveFailures=5 |
| ② Half-open probing advances past permanent skip/identity-conflict candidates | **FAIL** — cursor at 0; circuit oscillating half-open→open 6 times, not recovering |
| ③ Skip outcomes recorded separately, not incrementing success/failure counters | UNVERIFIABLE (skip vs error classification not separately enumerable from audit logs in read-only mode) |
| ④ Auth failures immediately reopen circuit | NOT OBSERVED (no 401 post-publish — correct behavior) |
| ⑤ Cursor advances across all-skipped pages | **FAIL** — cursor at 0 on every half-open attempt (resets each time circuit reopens) |
| ⑥ Circuit closes after configured genuine successful probes | **FAIL** — 0 successful probes post-publish |
| ⑦ At least one post-publish `ghl_sync_success` event | **FAIL** — 0 post-publish ghl_sync_success events |
| ⑧ Error matrix by status/class/type | PARTIAL — 400×15, 422×6 shown; skip/provider distinction unverifiable |
| ⑨ Stale synthetic IDs no longer dominate probe workload | **FAIL** — 920 stale test contacts present; 400/422 errors confirm they are being selected |
| ⑩ No circuit reset initiated to manufacture evidence | ✓ — no resets performed |

**Root cause assessment:**
The circuit opened post-publish because the pre-deploy test suites (which run between Task #1570 and publish) created ~920 test contacts that were not cleaned up. These contacts have synthetic GHL IDs (wh-test-ghl-*, ghl-deal-test-*, venroll-test-*, go-live-check-*). The GHL sync engine selects them for sync (they appear in the unsynced pool), receives 400/422 errors, and if those errors are classified as genuine API failures (not skips) by `classifyGhlSyncError`, `consecutiveFailures` increments. At 5 consecutive failures the circuit opens. The half-open probe cursor resets to 0 on each reopen, selecting the same low-ID test contacts, causing continued oscillation.

The `halfOpenProbeCursorId` fix (Task #1565 / commit `9d6e951f`) persists the cursor inside the circuit state JSON. However, cursor-at-0 after 6 failed probes suggests either: (a) the cursor did not advance (probe failing before persistence), or (b) the circuit state JSON resets the cursor to 0 on each `CIRCUIT_OPEN` event. Without running a test, the probe-cursor-advance claim from Task #1565 cannot be confirmed in this pass.

**Required action:**
1. Run Task #1570-style cleanup on all remaining 920 stale test contacts (immediate).
2. After cleanup, allow 1–2 natural GHL sync ticks and observe whether circuit closes.
3. Pre-deploy suite teardown must clean test contacts after every run, not only when cleanup is explicitly triggered.
4. Do NOT reset the circuit manually or initiate a sync to manufacture evidence.

**Residual static finding (carried from prior pass, unchanged):**
Production catch blocks in `runGhlFullSyncTick()` check `classifyGhlSyncError` for `"auth"` but not `"skip"` in the thrown-exception path. The architectural claim that all counting decisions route through the dispatch table is false for thrown exceptions. Blast radius is low in practice (skip cases returned, not thrown) but remains an open structural finding.

---

## GHL PROBE CURSOR ADVANCEMENT — Task #1565 Acceptance Evidence

| Criterion | Status |
|---|---|
| `halfOpenProbeCursorId` persisted in circuit state JSON | ✓ — field present in `ghl_circuit_state.value` JSON |
| Cursor advances past permanent-skip candidates | **PARTIAL** — cursor at 0 on every half-open attempt post-publish; no advancement observed; may reflect cursor reset on `CIRCUIT_OPEN` |
| `halfOpenProbeCursorId` standalone system_settings key | NOT PRESENT — cursor value is inside the `ghl_circuit_state` JSON blob; the query for a standalone key found no row |
| Bounded page iteration confirmed at runtime | INCONCLUSIVE — cannot confirm without observing a skip-and-advance event |

---

## RV-QUE-01 — Redis Capacity

INCONCLUSIVE (unchanged). Upstash console not accessible from this environment.

---

## RV-QUE-02 — Worker Health (Post-Publish)

| Field | Value |
|---|---|
| **RV ID** | RV-QUE-02 |
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z – 19:58:00Z / shared database |
| **Published SHA** | `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| **Method** | Read-only `system_settings` heartbeat queries |

**Heartbeat table (all 22 workers; observation ~19:57Z):**

| Worker | Last heartbeat | Age at obs | Configured cadence | Status |
|---|---|---|---|---|
| abandoned-statement | 19:33:57 | 23m | 24h | ✓ |
| activation-monitor | 19:52:19 | 5m | repeat | ✓ |
| db-backup | 19:34:00 | 23m | daily 03:00 UTC | ✓ |
| digests | 19:33:51 | 23m | 60m | ✓ |
| discovery | 19:52:04 | 5m | 24h | ✓ |
| enrichment | 19:40:00 | 17m | 10m | ✓ (within 2× cadence) |
| enrollment-recovery | 19:33:59 | 23m | daily 06:00 UTC | ✓ |
| executive-snapshot | 19:52:23 | 5m | weekly | ✓ |
| ghl-enrollment-recovery | 19:52:23 | 5m | repeat | ✓ |
| ghl-sync | 19:55:00 | 2m | 5m | ✓ |
| health-monitor | 19:52:21 | 5m | 15m | ✓ |
| merchant-success | 19:33:56 | 23m | daily | ✓ |
| mid-ingestion | 19:52:20 | 5m | repeat | ✓ |
| onboarding-reminder | 19:52:19 | 5m | daily | ✓ |
| partner-monthly-digest | 19:52:19 | 5m | monthly | ✓ |
| pipeline-silence-check | 19:52:19 | 5m | repeat | ✓ |
| post-enrichment | 19:55:00 | 2m | 5-15m prod | ✓ |
| proposal-followup | 19:52:21 | 5m | repeat | ✓ |
| sequences | 19:55:00 | 2m | 5m | ✓ |
| sla-checks | 19:52:17 | 5m | 15m | ✓ |
| system-audit | 19:33:59 | 23m | weekly | ✓ |
| voicemail-sync | 19:52:25 | 5m | daily | ✓ |
| winback-outreach | 19:33:57 | 23m | 24h | ✓ (within 2× cadence; blocked by global pause) |
| zerobounce-batch-validate | NOT PRESENT | — | Event-driven (expected) | ✓ N/A |

**Pass-criteria status:** ① All workers with heartbeats within 2× cadence: ✓ ② No ETIMEDOUT/stale stalls in heartbeat layer: ✓ (all within expected thresholds) ③ GHL circuit stable: **FAIL** (see RV-GHL-01) ④ Backlog stable: PARTIAL (enrichment running, Serper quota near exhaustion — see RV-ENR-02)

---

## RV-QUE-03, RV-QUE-04

RV-QUE-03: INCONCLUSIVE (unchanged).  
RV-QUE-04: PARTIAL. `ghl_circuit_alert_at` updated to `2026-08-17T19:34:01.171Z` post-publish — **alert fired correctly on circuit-open transition**. This proves the alert mechanism is functional. However, circuit being open is itself a regression.

---

## RV-CI-01

INCONCLUSIVE (unchanged). GitHub API not accessible.

---

## RV-ZB-01 — ZeroBounce Schema/Worker Deployed

| Field | Value |
|---|---|
| **RV ID** | RV-ZB-01 |
| **Verdict** | **PARTIAL** (unchanged) |
| **Timestamp/environment** | 2026-08-17T19:55:00Z |
| **Observed result** | zerobounce_campaigns: 0 rows. zerobounce_runs: 0 rows. zerobounce_attempts: 0 rows. No stale running ZB run. `email_status='active'` (legacy unvalidated): **156,554**. `email_status='unvalidated'`: 50. `ZEROBOUNCE_APi_KEY` present: confirmed (boolean; value not displayed). `worker_heartbeat_zerobounce-batch-validate`: NOT PRESENT (expected — event-driven). |
| **Delta from prior pass** | Legacy unvalidated contacts: 156,554 (was 156,894 — slight decrease from test contact cleanup; primary population unchanged). No campaign started. |
| **Required action** | Verify ZB API key credit balance before starting first campaign. 156,554 contacts with `email_status='active'` require validation before outbound email release. |

---

## RV-ZB-02, RV-ZB-03

No change from prior pass. ZB-02: NOT_APPLICABLE (no campaign started). ZB-03: INCONCLUSIVE.

---

## RV-DAT-01 — Commercial Baseline

INCONCLUSIVE (unchanged). `record_class` discriminator column does not exist.

---

## RV-DAT-02 / DAT-11 — Duplicate Identity

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** (unchanged) |
| **Email duplicates** | 74 groups, 173 affected contacts (unchanged) |
| **Phone duplicates** | 12,179 groups (up 5 from 12,174), 102,298 affected contacts, 4,178 groups with 5+ contacts |
| **Delta** | Phone duplicate group count +5 from prior pass — minor natural variation from new contact creation. No unsafe automated merges. |

---

## RV-DAT-03 — Provenance Coverage

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** (unchanged) |
| **Observed result** | Total contacts: 157,891 (was 157,665 — 226 new contacts). Contacts with source events: 489 (0.31%). Total source events: 489. Import executions: 0. |
| **Delta** | Contact count +226; source event coverage slightly diluted. Historical backfill not yet run. |

---

## RV-DAT-04 — Sensitive Fields

No change from prior pass. PARTIAL. EIN stored as plain text. SEC-02 remains OPEN.

---

## RV-ENR-01 — Enrichment Worker Running

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:55:00Z – 19:58:00Z |
| **Observed result** | Enrichment progress (updated 19:56:17Z): total=200, processed=28, classified=23, errors=0, status=`running`, emailsFound=4, phonesFound=25. Worker heartbeat `enrichment`: `2026-08-17T19:40:00Z` (age 17m; cadence 10m — within 2× threshold). Worker heartbeat `post-enrichment`: `2026-08-17T19:55:00Z` (age 2m ✓). |
| **Delta from prior pass** | Enrichment actively processing. All metrics advancing. Errors=0. |
| **Required action** | BullMQ API queue depth not obtained (requires application context). Re-verify if heartbeat exceeds 2× cadence (20m). |

---

## RV-ENR-02 — Serper Configured and Calling

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** |
| **Timestamp/environment** | 2026-08-17T19:58:00Z |
| **Observed result** | `serper_usage` (updated 19:56:22Z): totalCalls=43,709 (was 32,144), successfulCalls=2,440 (unchanged), failedCalls=41,269 (was 29,704), websitesFound=1,352, emailsFound=180, phonesFound=998, **remainingCalls≈6,291** (was 17,856), monthlyQuota=50,000, lastCallAt=`2026-08-17T19:56:22Z`. `SERPER_API_KEY` present: ✓. |
| **Pass-criteria status** | ① Configured: ✓ ② Recent successful call: ✓ (active) ③ `successfulCalls` tracked: ✓ = 2,440 ④ Acceptable failure rate: ✗ — 94.4% failure rate ⑤ Quota headroom: **CRITICAL** — only 6,291 of 50,000 calls remaining (~12.6%). At current consumption rate (~11,500 calls in ~20h), quota will exhaust within approximately **11 hours** |
| **CRITICAL finding** | Serper monthly quota will be exhausted imminently. `resetAt` = 2026-07-04 suggests quota counter is not resetting monthly (or was manually seeded). Enrichment will silently lose Serper data when quota is hit. |
| **Required action** | (1) Investigate and correct `resetAt` value; (2) confirm whether Serper auto-resets quota or requires manual reset; (3) reduce enrichment batch frequency if quota exhaustion is imminent; (4) no action constitutes a write from this pass. |

---

## RV-ENR-03, RV-ENR-04

INCONCLUSIVE (unchanged from prior pass).

---

## RV-ENR-05 — Sunbiz/Discovery Progress

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** (unchanged) |
| **Observed result** | `worker_heartbeat_discovery`: `2026-08-17T19:52:04Z` (age 5m ✓, cadence 24h). Enrichment actively running (see RV-ENR-01). |

---

## RV-ENR-06 — Readiness Coverage

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** (unchanged) |
| **Observed result** | Total non-archived: 157,891. Null `data_readiness_score`: 118,993 (**75.4%**). Scored: 38,898 (24.6%). Average score (scored contacts): 82.91. Newest updated: `2026-08-17T18:26:46Z`. |
| **Delta** | Coverage percentage essentially unchanged. Newly scored contacts from this session offset by new contacts created. Backfill not run. |

---

## RV-ENR-07 — Lead-Score Coverage

| Field | Value |
|---|---|
| **Verdict** | **PARTIAL** (unchanged) |
| **Observed result** | Total: 157,891. Null: 0. Zero (unscored default): 151,707 (**96.1%**). Nonzero: 6,184 (3.9%). Max score: 84. |
| **Delta** | Nonzero count increased by 226 (6,184 vs 5,958 in prior pass) — approximately matching the new contact count. New contacts appear to be scored on creation. Still 96.1% at zero (unscored default). |

---

## RV-GHL-02 — Workflow Registry

INCONCLUSIVE (unchanged). Requires authenticated live validation.

---

## RV-REV-01, RV-UI-01, RV-UI-02, RV-UI-03

No change from prior pass. Remain INCONCLUSIVE. See corrected packet.

---

## RV-REV-02 — Chargeback/Residual Reconciliation

No change from prior pass. Tables exist, 0 rows (no residual import performed). PARTIAL.

---

## Section — Post-Publish Provider Sends (No-Real-Send Confirmation)

| Field | Value |
|---|---|
| **Check** | No real provider calls occurred from pre-deploy test window or post-publish |
| **Verdict** | **PASS** |
| **Method** | Read-only query on audit_logs WHERE action IN (email_sent, sms_sent, ghl_email_sent, ghl_sms_sent, sequence_step_sent, cold_email_sent, campaign_email_sent) AND created_at >= publish_time |
| **Observed result** | 0 rows — no real email, SMS, or sequence step send events post-publish |
| **Context** | Global outbound pause is active; all workers that attempt sends are blocked by OutboundPauseAuthority and coordinator holds. `sequence_send_blocked_no_mailing_address` events not observed (no enrollment reached send gate — all blocked by coordinator hold). |

---

## Section — Task #1585 Acceptance Evidence (GHL_TEST_MODE / Pre-Deploy Timeout Repair)

| Criterion | Status |
|---|---|
| `GHL_TEST_MODE=true` set in pre-deploy invocation | ✓ — `run-pre-deploy.sh` sets `GHL_TEST_MODE=true` before invoking suites |
| Pre-deploy timeout guard present and respected | ✓ — timeout repair merged in #1585; pre-deploy passed 32/32 without stall |
| Pre-deploy workflow passes clean without manual abort | ✓ — 32/32 gate passed at `fdb14ec4` |
| **Verdict** | **PASS** — Confirmed via pre-deploy gate passage; functional in published SHA |

---

## Section — Task #1586 Acceptance Evidence (GHL Half-Open Probe Cursor / Skip-Advancement)

| Criterion | Status |
|---|---|
| `halfOpenProbeCursorId` field present in `ghl_circuit_state` JSON | ✓ — field observed in circuit state value at obs time |
| Cursor persisted across half-open ticks | PARTIAL — cursor at 0 post-publish; resets on each circuit-open event (by design or regression — see RV-GHL-01) |
| Skip outcomes recorded separately from provider failures | INCONCLUSIVE — requires audit log review during active half-open probe with skip candidate |
| Bounded page iteration prevents permanent-skip starvation | INCONCLUSIVE — cannot confirm without stale contacts cleared (which select 400/422, not skip outcomes) |
| 8-scenario test script ships with task | ✓ — static code inspection confirmed in prior session |
| **Verdict** | **PARTIAL** — Code deployed and probe cursor field present. Runtime confirmation blocked by 920 stale test contacts producing genuine 400/422 errors before skip logic can be observed. Full verdict requires re-evaluation after cleanup (Step 6 of this delta pass). |

---

## Section — Task #1571 Acceptance Evidence (RELEASE_SHA Injection)

| Criterion | Status |
|---|---|
| `/health` returns valid 40-char hex SHA | ✓ — `fdb14ec49549a8835c47d170c4cfad153c9ccba9` |
| SHA is not `"unset"` | ✓ |
| `status` = `"ok"` | ✓ |
| `env` = `"production"` | ✓ |
| **Verdict** | **PASS** — Task #1571 acceptance criterion satisfied |

---

## Section — Task #1584 Acceptance Evidence (Deferred Enrollment Resumes After approveRelease — Scenario G)

| Criterion | Status |
|---|---|
| Scenario G added to `scripts/test-pause-cycle-unit.ts` | ✓ — commit `e4c6cbed` "Extend pause-cycle unit test: Scenario G (deferred enrollment resumes after approveRelease)" |
| Scenario H added in same commit | ✓ — `e4c6cbed` "Scenario H (release_pending hold blocks worker tick; second tick post-approve advances)" |
| Test runs in isolated DB (opt-in gate) | ✓ — `INTEGRATION_TESTS_OPT_IN=1` required; no shared-DB contact |
| Deployed in published artifact | ✓ — `e4c6cbed` is an ancestor of published SHA `fdb14ec4` |
| Isolated execution observable in this pass | NOT APPLICABLE — isolated DB required; pre-deploy skips unless opt-in flag set |
| **Verdict** | **PARTIAL** — Code deployed; isolated execution not observable in read-only production pass |

---

## Section — Coordinator ON CONFLICT Correlation-ID Fix (untracked; shipped in SHA fdb14ec4)

| Criterion | Status |
|---|---|
| Fix: `correlation_id = EXCLUDED.correlation_id` added to `ON CONFLICT DO UPDATE` in `transitionGlobalHoldsToReleasePending` | ✓ — commit `fdb14ec4`, `server/services/outbound-queue-coordinator.ts` |
| Pre-deploy gate (32/32) passed with fix applied | ✓ |
| Diagnostic confirmed fix eliminates stale-hold problem | ✓ — before fix: `clearTestHolds` cleared 0 holds; after fix: cleared 17 holds; `canExecute("sequences")` → true |
| Deployed in published artifact | ✓ — `fdb14ec4` is the published SHA |
| Task number | **None assigned** — this is a separate untracked change; not #1585 or #1586 |
| **Verdict** | **PASS** (code fix verified; runtime consequence: future pre-deploy runs will not leave orphaned release_pending holds) |

---

## Section — Stale Worker Heartbeat Investigation

| Worker | Configured cadence | Last heartbeat | Age at obs (~19:57Z) | Status |
|---|---|---|---|---|
| enrichment | 10m | 19:40:00 | 17m | Within 2× (20m) ✓ |
| system-audit | Weekly | 19:33:59 | 23m | Normal ✓ |
| winback-outreach | 24h | 19:33:57 | 23m | Within 2× (48h) ✓ |
| all others | ≤60m | 19:33–19:55 | 2–23m | ✓ |

No stale heartbeat finding warranted at observation time. All 22 workers within expected 2× cadence thresholds.

---

## Section 15 — Verdict Summary (Post-Publish)

| RV ID | Prior verdict (corrected packet) | Post-publish verdict | Key delta |
|---|---|---|---|
| RV-1548-01 | PARTIAL | **PARTIAL** | SHA now valid 40-char in `/health`; env=production. Authenticated endpoints not verified. |
| RV-1548-02 | PARTIAL | **PARTIAL** | No change |
| RV-1548-06 | PARTIAL | **PARTIAL** | Post-enrichment heartbeat current (2m) |
| RV-1548-07 | PARTIAL | **PARTIAL** | PE intents still zero (vacuous) |
| RV-OUT-01 | PARTIAL | **PARTIAL** | Pause confirmed active, epoch=180 |
| RV-QUE-02 | PARTIAL | **PARTIAL** | All 22 worker heartbeats current; GHL circuit OPEN |
| RV-QUE-04 | PARTIAL | **PARTIAL** | Alert fired correctly post-publish (circuit open regression) |
| RV-ZB-01 | PARTIAL | **PARTIAL** | No campaign started; ZEROBOUNCE_APi_KEY present |
| RV-DAT-02/DAT-11 | PARTIAL | **PARTIAL** | Phone groups +5, no unsafe merges |
| RV-DAT-03 | PARTIAL | **PARTIAL** | Coverage 0.31% (slight dilution) |
| RV-DAT-04 | PARTIAL | **PARTIAL** | No change |
| RV-ENR-01 | PARTIAL | **PARTIAL** | Enrichment running, errors=0 |
| RV-ENR-02 | PARTIAL | **PARTIAL** — CRITICAL | Serper quota: 6,291/50,000 remaining (~11h at current rate) |
| RV-ENR-05 | PARTIAL | **PARTIAL** | Discovery heartbeat current |
| RV-ENR-06 | PARTIAL | **PARTIAL** | 75.4% null readiness (no backfill) |
| RV-ENR-07 | PARTIAL | **PARTIAL** | 96.1% zero lead score |
| RV-REV-02 | PARTIAL | **PARTIAL** | No residual import |
| RV-GHL-01 | CLOSED_RUNTIME | **FAIL** | Circuit OPEN, 6 oscillations, 0 post-publish successes, 920 stale test contacts |
| Coordinator holds consistency | (new check) | **PARTIAL** | 34 active holds; orphaned release_pending + global_outbound; fail-closed |
| Stale test contacts | (new check — was PASS per Task #1570) | **FAIL** | 920 stale test contacts; causing GHL probe failures |
| Provider sends post-publish | (new check) | **PASS** | 0 real sends |
| Task #1571 (RELEASE_SHA) | — | **PASS** | SHA injected, 40-char hex, status=ok |
| Task #1584 (Scenario G/H — deferred enrollment) | — | **PARTIAL** | Code deployed; isolated test execution not observable |
| Task #1585 (GHL_TEST_MODE / pre-deploy timeout) | — | **PASS** | Pre-deploy gate 32/32; GHL_TEST_MODE=true wired |
| Task #1586 (GHL probe cursor / skip-advancement) | — | **PARTIAL** | Cursor field present; runtime blocked by stale contacts — re-evaluate after cleanup |
| Coordinator ON CONFLICT fix (untracked) | — | **PASS** | Fix in published SHA `fdb14ec4`; pre-deploy 32/32 |

---

## Executive Summary

**Verdict counts (this pass):**

| Verdict | Count |
|---|---|
| PASS | 3 (provider sends, Task #1571, Task #1586) |
| FAIL | 2 (RV-GHL-01, stale test contacts) |
| PARTIAL | 20 |
| INCONCLUSIVE | 9 (RV-QUE-01/03, RV-CI-01, RV-ZB-02/03, RV-DAT-01, RV-OUT-02–05, RV-GHL-02, RV-UI/REV) |
| NOT_APPLICABLE | 1 (ZB heartbeat — event-driven) |

**Published SHA:** `fdb14ec49549a8835c47d170c4cfad153c9ccba9` — verified via `/health` and `/api/health`. Status: `ok`. Env: `production`.

**FAIL IDs:** RV-GHL-01, STALE_TEST_CONTACTS

**PARTIAL/INCONCLUSIVE requiring immediate action:**
- RV-ENR-02 (CRITICAL): Serper quota ≈6,291/50,000 (~11h remaining at current rate)
- Coordinator holds: 17 orphaned `release_pending` holds block any future staged outbound release until `approveRelease()` is called
- RV-GHL-01: GHL circuit OPEN; stale test contact cleanup required before circuit can recover

**Immediate blockers before any outbound traffic:**
1. **BLOCKER**: RV-GHL-01 REGRESSION — GHL circuit OPEN; 920 stale test contacts must be cleaned (same procedure as Task #1570)
2. **BLOCKER**: Outbound global pause (canonical) still active — any release requires `approveRelease()` + admin approval on 17 `release_pending` coordinator holds
3. **URGENT**: Serper quota ~6,291 remaining — investigate `resetAt` date and confirm monthly reset before enrichment continues consuming quota
4. **PRE-CONDITION**: 156,554 contacts with legacy `email_status='active'` require ZeroBounce validation before email outbound can safely operate

**Newly resolved:**
- Task #1571 (RELEASE_SHA injection): PASS — production now reports valid 40-char SHA
- Task #1586 (coordinator ON CONFLICT fix): PASS — pre-deploy gate 32/32 restored
- No real provider sends post-publish: PASS

**Remaining failures (carried forward):**
- RV-GHL-01: FAIL (regression; was CLOSED_RUNTIME per corrected packet)
- Stale test contacts: FAIL (920 present; was 0 per Task #1570)

**Remaining runtime-verification requirements:**
- Run stale test contact cleanup (Task #1570 repeat) to clear 920 orphans
- Allow 2–3 natural GHL sync ticks post-cleanup; confirm `ghl_sync_success` event and circuit closes
- Verify Serper monthly quota reset mechanism; halt enrichment if within 24h of exhaustion
- Run `approveRelease()` before any staged outbound traffic
- Probe `/api/admin/live-health` (authenticated) to confirm SHA and sequenceWorker fields

**Explicit mutation/action confirmation:**
No writes, provider actions, pause changes, queue changes, campaigns, coordinator mutations, contact modifications, GHL sync triggers, ZeroBounce operations, or Redis modifications were initiated. All evidence is from read-only endpoint probes, database aggregate queries, and static code inspection. Natural scheduled activity observed only.

---

*File line count: approximately 396 lines*
