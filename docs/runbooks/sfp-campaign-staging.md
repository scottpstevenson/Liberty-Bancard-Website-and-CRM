# SFP Campaign Staging (Task #2001) — Operator Runbook

## Scope and boundary
This system stages validated South Florida Prospecting (SFP) leads
(`sfp_outreach_eligibility.status='validated_outreach_eligible'`) into a
package-pinned `ready_held` state. **It never enrolls a contact into a
sequence, activates a campaign, writes to GHL, or sends anything.**
`ready_held` is the terminal state this system produces. Enrollment/launch is
a separate, later, explicitly authorized task — do not attempt to trigger it
from here.

## 1. Configuration convergence (one-time or after a package review)
Run the preview first, review the diff, then apply:

```
npx tsx -e "import('./server/services/cro03/sfp-campaign-packages.ts').then(m=>m.previewPackageConvergence()).then(r=>console.log(JSON.stringify(r,null,2)))"
```

This resolves campaigns/sequences by name (never numeric ID):
`SDR-04` (Restaurant), narrowed `SDR-05` (Med Spa), a new split Dental
campaign, narrowed `SDR-06` (Retail), narrowed `SDR-07` (Auto Repair). It
never touches `SDR-10` as a source or target.

If the preview looks correct, apply it (requires an authenticated admin
`actorId` for the audit trail):

```
npx tsx -e "import('./server/services/cro03/sfp-campaign-packages.ts').then(m=>m.applyPackageConvergence({actorId:'operator:<name>'})).then(r=>console.log(JSON.stringify(r,null,2)))"
```

Then verify:

```
npx tsx -e "import('./server/services/cro03/sfp-campaign-packages.ts').then(m=>m.verifyPackageConvergence()).then(r=>console.log(JSON.stringify(r,null,2)))"
```

Convergence never overwrites an active/approved/already-used campaign or
sequence row — a mismatch there requires human review, not a forced re-run.

**Required human step (out of scope for this task):** the five target
sequences and the narrowed/split campaigns need marketing/compliance content
review before any later task activates them. Convergence only creates the
governance shell (paused sequence, draft campaign) — it does not write new
marketing copy.

## 2. Staging a batch (manual, via Lead Ops UI or API)
1. In Lead Ops → South Florida Prospecting, review the eligible list and
   explicitly select the businesses to stage (max 25 per batch — there is no
   "select all" shortcut by design, see Defect 14).
2. Preview: `POST /api/lead-ops/sfp/staging-v2/preview` with
   `{ cohortRunId, eligibilityIds }`. Review package assignment, blocked
   reasons, and the returned `snapshotHash`/`commandKey`.
3. Execute: `POST /api/lead-ops/sfp/staging-v2/execute` with the exact
   `commandKey`/`snapshotHash` from the preview. A drifted snapshot (policy,
   package, or eligibility state changed since preview) fails closed with
   HTTP 409 and requires a fresh preview — this is expected, not a bug.
4. Confirm the receipt shows `readyHeld` count matching your selection and
   `rejected` reasons make sense for any skipped rows.

## 3. Canary before turning on recurring processing
Before enabling `recurring_enabled` for a program, stage exactly one row
manually (§2) and confirm:
- The `sfp_campaign_staging_intents` row reaches `ready_held`.
- The linked `master_leads` row has `pipeline_origin='sfp_pipeline'`.
- No `sequence_enrollments`, `campaign_queue_runs/items`, or GHL API calls
  occurred (check application logs for absence, not presence).

## 4. Enabling the recurring worker
The worker (`server/services/cro03/sfp-campaign-staging-worker.ts`) is
isolated to the `sfp-campaign-staging` background-profile capability group —
enabling it never starts `outreach`, GHL, or other send-capable workers.

Requirements, all of which must be true simultaneously:
- The `sfp-campaign-staging` capability group is running (background profile
  `full`, or `selective` with that group listed).
- `sfp_programs.is_active = true` and `recurring_enabled = true` for the
  program.
- `sfp_programs.schedule_config->>'campaignStaging'` is a positive integer
  (this is the per-tick batch size, capped at 25 regardless of the
  configured value). Existing programs are backfilled to `10` by migration
  0290; adjust via the standard program settings update path.

With all four true, the worker ticks every ~15 minutes, claims one
`sfp_stage_runs` row (`stage='campaign_staging'`) via `sfp_stage_runs`/
`sfp_stage_items` leases, and processes up to the configured batch through
the same `previewStagingV2`/`executeStagingV2` path used by the manual UI.

## 5. Telemetry
Lead Ops SFP panel shows: schedule (batch size, whether recurring is
enabled), worker capability status, backlog (eligible-but-unstaged count),
next/last run, throughput, retries, stale leases, and dead-letter counts.
Cost is reported as `0 / not applicable` — this stage makes no provider
calls.

## 6. Pause / kill-switch
- To pause recurring processing only: set `sfp_programs.recurring_enabled =
  false`, or set `schedule_config->>'campaignStaging'` to `0`. The worker
  fails closed (no-op) the next tick.
- To fully disable the capability (e.g. during an incident): remove
  `sfp-campaign-staging` from the active background-profile's selective
  group list and restart. This does not affect any other capability group,
  including `outreach`.
- Manual staging via the UI/API is independent of the recurring worker and
  can be paused separately by revoking the admin route's role grant if
  needed.

## 7. Dead-letter recovery
A `sfp_stage_items` row reaches `dead_letter` after 5 failed attempts (fixed
backoff: 1, 5, 15, 30 minutes). Dead letters are visible in the Lead Ops
telemetry panel with their `outcome_code`.

To retry a dead letter after fixing the underlying cause (e.g. a package
mapping drifted back to `current`, or a transient DB issue resolved):
```sql
UPDATE sfp_stage_items
   SET state = 'pending', attempt_count = 0, outcome_code = NULL
 WHERE id = '<item-id>' AND state = 'dead_letter';
```
The next worker tick will re-claim and reprocess it. To permanently cancel
instead, leave it in `dead_letter` — no code path resurrects it
automatically.

## 8. Reconciliation query
Rows genuinely stuck (eligible, no intent, no stage item, not selected by a
prior batch) after 24h of recurring being enabled:
```sql
SELECT e.id, e.business_id, e.validation_expires_at
  FROM sfp_outreach_eligibility e
 WHERE e.status = 'validated_outreach_eligible'
   AND e.staging_intent_id IS NULL
   AND e.validation_expires_at > NOW()
   AND NOT EXISTS (
     SELECT 1 FROM sfp_stage_items i WHERE i.business_id = e.business_id AND i.provider = 'campaign_staging'
   );
```
A non-empty result after recurring has run for a full day usually means the
program's `campaignStaging` batch size is too small for the backlog, or the
cohort isn't `frozen` yet.

## 9. What this system explicitly does not do
- Never creates a `sequence_enrollments` row.
- Never writes to `campaign_queue_runs`/`campaign_queue_items`.
- Never calls a GHL client or any outbound provider.
- Never flips `outbound_pause` state.
- Never activates a campaign or unpauses a sequence.

Activation, enrollment, and delivery for `ready_held` intents are the
explicit responsibility of a separate, later, authorized task. This
runbook's operators should treat a `ready_held` row as "ready for that next
task to pick up," not as something to push further themselves.
