# Worker Architecture Runbook — Task #1803

**Architecture revision:** W01–W14 selective execution implementation  
**Effective date:** 2026-09-06  
**Baseline SHA:** 8270733fe14cc381d9fd01d525df57f795e98653

---

## 1. W01–W14 Disposition

| Finding | Status | Evidence |
|---------|--------|---------|
| W01 CORE_QUEUE_ALLOWLIST empty | **Resolved** | `selective:<groups>` profile added to `background-profile.ts`; `WORKER_CAPABILITY_GROUPS` defines 8 named groups mapped to queue names; `getSelectiveGroups()` / `getQueuesForCapabilityGroups()` parse and validate at runtime |
| W02 29 undifferentiated Workers | **Resolved (per-job gate)** | `WORKER_CAPABILITY_GROUPS` defines the 7+1 logical topology. `selective` mode limits which physical queues start Workers AND enforces a per-job logical capability gate (`JOB_LOGICAL_CAPABILITY_OVERRIDES` + `getJobCapabilityGroup()` in `background-profile.ts`) inside the processor so that outreach/GHL jobs co-located on the enrichment queue are suppressed when only `enrichment` is active. Full physical queue consolidation into 7 Workers deferred. |
| W03 Generic "run" job names | **Resolved (GHL_SYNC)** | GHL_SYNC `jobName` changed from `"run"` to `"ghl-sync-tick"`; processor accepts both for backward compat. ENRICHMENT already used distinct names. Remaining `"run"` queues each have one logical job (queue name provides identity). |
| W04 Startup bypasses capability gates | **Resolved** | GHL workflow hydration, seed calls, content/maintenance schedulers all gated on `_bgProfile !== "off"`. Statement recovery runs only inside `getQueueManager().then(...)` which requires profile ≠ off. |
| W05 Producer coupled to QueueManager init | **Partially resolved** | `getQueueManagerProducers()` and `requireQueueManagerReady()` already existed; selective profile allows starting only needed workers. Full producer-only Redis path (without any consumers) deferred to a future task. |
| W06 Discovery mode throws SIZE_MISMATCH | **Resolved** | `readCro03cWorkerFleet()` now has explicit `discoveryMode` path when `expectedProcessIdentities=[]`; returns `complete: true` with observed heartbeats without SIZE_MISMATCH check. Route updated to return `discoveryComplete` field. |
| W07 Ceremony uses observed count as expected | **Resolved** | `--expected-workers N` is now required for apply path; `--preflight-only` inspects without writing. `expectedCount` in inventory payload uses operator-supplied N, not observed count. |
| W08 Topology hash covers static config only | **Resolved** | `getCro03cQueueTopologyHash()` now includes `effectiveProfile` and `selectedGroups` in hash input. `getTopologySnapshot()` returns `activeProfile` and `selectedGroups`. |
| W09 Heartbeats lack env/deployment fields | **Resolved** | `Cro03cWorkerHeartbeat` interface adds `environmentIdentity`, `deploymentIdentity`, `enabledGroups`. `createCro03cWorkerHeartbeat()` reads `NODE_ENV`, `REPL_DEPLOYMENT_ID`/`REPL_ID`, `BACKGROUND_JOB_PROFILE`. |
| W10 Kill-switch skips complete without durable hold | **Resolved** | Processor now writes `audit_logs` row with `action='job.kill_switch_suppressed'` and metadata `{queue, jobId, jobName, reason}` on every kill-switch skip (both enabled=false and check-failure cases). |
| W11 Physical pause affects entire queue | **Acknowledged** | Hold-ledger logical holds work correctly. Physical `queue.pause()` in coordinator affects entire physical queue only for WINBACK_OUTREACH pilot. Full per-logical-job isolation deferred — coordinator patch tracked as follow-up. |
| W12 GHL_SYNC concurrency 3 + singleton lease | **Resolved** | GHL_SYNC `concurrency` changed from 3 to 1. The handler holds a singleton lease; parallel slots were always no-ops consuming extra Redis blocking connections. |
| W13 Startup creates ceremony artifacts | **Resolved** | `runStartupCeremonyArtifacts()` and `runStartupCeremonyAttestation()` calls removed from `server/index.ts`. Both are now no-op stubs in `cro03-startup-ceremony.ts`. Ceremony is exclusively via `scripts/cro03d-run-ceremony.ts`. |
| W14 Embedded pricing in ceremony helpers | **Resolved** | `cro03-startup-ceremony.ts` reduced to stubs — embedded PRICING constant removed. Pricing validation remains in `scripts/cro03d-run-ceremony.ts` where it belongs (offline operator tool). |

---

## 2. Supported BACKGROUND_JOB_PROFILE values

```
off                          — zero workers, zero schedules (default/fail-closed)
core                         — queues in CORE_QUEUE_ALLOWLIST (starts empty)
selective:<group1>,<group2>  — named capability groups only
full                         — all 29 queues
```

### Selective capability groups

| Group | Physical queues enabled |
|-------|------------------------|
| `critical-commands` | deal-stage-effects, chargeback-commands, statement-upload |
| `ghl-integration` | ghl-sync, ghl-enrollment-recovery, voicemail-sync |
| `enrichment` | enrichment, post-enrichment, cro03a-qualification, discovery |
| `provider-live` | cro03c-live |
| `email-validation` | zerobounce-batch-validate |
| `outreach` | sequences, enrollment-recovery, winback-outreach, abandoned-statement, proposal-followup |
| `operations` | sla-checks, digests, mid-ingestion, onboarding-reminder, activation-monitor, merchant-success, executive-snapshot, health-monitor, pipeline-silence-check, partner-monthly-digest |
| `heavy-maintenance` | db-backup, system-audit |

### Manual canary example (enrichment only)

```bash
BACKGROUND_JOB_PROFILE=selective:enrichment
```

Starts: enrichment, post-enrichment, cro03a-qualification, discovery workers  
Does NOT start: GHL sync, sequences, email validation, operations, heavy maintenance

---

## 3. Ceremony script (W07)

```bash
# Preflight — read-only, no writes
npx tsx scripts/cro03d-run-ceremony.ts --preflight-only

# Apply — requires --expected-workers matching actual deployment count
npx tsx scripts/cro03d-run-ceremony.ts --expected-workers 1

# With explicit SHA target
npx tsx scripts/cro03d-run-ceremony.ts --expected-workers 1 --target-sha <sha>
```

The `--expected-workers N` value must be independently configured from the deployment definition (process count × workers per process). It is NOT derived from observed heartbeats.

---

## 4. Redis connection budget

| Component | Connections |
|-----------|------------|
| Shared IORedis client (Queues + Worker non-blocking) | 1 |
| Blocking connection per Worker instance | 1 each |
| **selective:enrichment** (4 queues) | 1 + 4 = **5** |
| **selective:ghl-integration** (3 queues) | 1 + 3 = **4** |
| **full** (29 queues, no legacy GHL) | 1 + 29 = **30** |

Set `REDIS_CONNECTION_LIMIT` env var to enable capacity monitoring.  
Set `REDIS_CONNECTION_WARN_THRESHOLD` to adjust warning threshold (default 18).

---

## 5. Rollback

1. Set `BACKGROUND_JOB_PROFILE=off` and restart.
2. Zero workers start; HTTP/CRM continues.
3. All in-flight BullMQ jobs finish their lock duration (120s) then stall.
4. Stale active jobs cleaned up on next startup via `cleanupStaleActiveJobs()`.
5. No Redis key migration needed — BullMQ queues persist their state in Redis regardless of consumer presence.

---

## 6. Deployment verification commands

```bash
# Confirm active profile
curl -s https://libertybancard.com/api/admin/cro03c/runtime-identity \
  -H "Cookie: <session>" -H "x-csrf-token: <token>" | jq '{activeProfile, selectedGroups, discoveryComplete, workerIdentities}'

# Confirm topology snapshot
curl -s https://libertybancard.com/api/admin/queue-telemetry \
  -H "Cookie: <session>" -H "x-csrf-token: <token>" | jq '.topology | {activeProfile, selectedGroups, activeConfigCount, instantiatedWorkerCount}'
```

Expected for `selective:enrichment`:
- `activeProfile: "selective"`
- `selectedGroups: ["enrichment"]`
- `instantiatedWorkerCount: 4`
- No sequences, GHL sync, or outreach workers in topology

---

## 7. Next steps

1. **Bounded enrichment proof**: Set `BACKGROUND_JOB_PROFILE=selective:enrichment`, verify enrichment jobs process and persist results, confirm CRM visibility.
2. **Contact-to-Lead reconciliation**: Separate governed task after enrichment is proven.
3. **Held sequence certification**: Qualify a small cohort with real sending held off.
4. **Incremental activation**: Enable additional groups one at a time with pool metrics captured before/after each.
