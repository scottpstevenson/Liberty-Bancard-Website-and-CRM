# Task #2001 Final Pre-Build Audit — Findings and Corrected Build Contract

**Audited task:** `2001 - Task 4 — Campaign/Sequence Staging and Recurring Operations`  
**Audit date:** 2026-09-24  
**Repository:** `Liberty-Bancard-Website-and-CRM`  
**Audited SHA:** `67afe14c52f8594f517bb7ed76a2cd7000655fc4` (`origin/main`)  
**Migration head:** `0289_sfp2000_policy_and_lineage` (journal index 293)  
**Verdict:** **NO-GO AS WRITTEN — GO AFTER THE CORRECTIONS IN THIS DOCUMENT ARE INCORPORATED**

## 1. Executive conclusion

Task #2001 correctly identifies the remaining SFP handoff gap: eligible prospects can be written to `sfp_campaign_staging_intents` and `master_leads`, but no governed consumer maps them to a durable vertical campaign/sequence package.

The task is not build-ready as written, however. Its proposed terminal state (`enrolled` with a paused sequence enrollment) conflicts with the repository's canonical enrollment contract and with its own no-activation scope. It also duplicates existing origin metadata, treats a reporting query as a mutation authority, omits required paid-source schema work, relies on unstable numeric campaign/sequence IDs, leaves the five-package mapping ambiguous, and proposes a second approval/execution model alongside existing CR-06 and campaign governance.

The corrected Task #2001 boundary must be:

> Select an explicit, snapshot-bound set of currently eligible SFP rows; re-run all mutable safety gates; map each row to exactly one immutable vertical package; create or update the SFP master-lead projection and staging intent atomically; and stop at `ready_held` with zero sequence enrollments, campaign queue membership, outbound messages, GHL writes, sends, or sequence/campaign activation.

Actual contact promotion, enrollment, launch approval, and delivery must remain a later, separately authorized action.

## 2. Audit evidence and limitations

### Confirmed static repository state

- The fetched `origin/main` SHA exactly matches the task's stated SHA: `67afe14c52f8594f517bb7ed76a2cd7000655fc4`.
- Task #2000 and its correction are present in history at `9bf97dd8c0dbb9d80efa3824961046dae3cf58c4` and `2bac42af069e0f50bbf5716d44f99d717e55e8af`.
- The migration head is `0289_sfp2000_policy_and_lineage`.
- The clean detached audit worktree had no repository modifications.
- `scripts/test-sfp1999-final-closeout.mjs` passed 7/7.
- `scripts/test-sfp-pipeline-correction.mjs` failed 3 of 21 structural assertions at the audited SHA. See Finding F-16.

### Runtime limitation

This audit environment had no production `DATABASE_URL`, `TEST_DATABASE_URL`, or `REDIS_URL`. Therefore, the following statements in the submitted task were **not** independently reverified and must be classified as `RUNTIME_VERIFICATION_REQUIRED`, not as current static facts:

- Production campaign IDs 5, 6, 7, 8, and 11 and their live statuses/content.
- Production sequence ID 85 and its live status.
- Counts of 13 campaigns, 117 sequences, 114 missing workflow mappings, and 18 test-like sequences.
- Zero live rows in `sfp_campaign_staging_intents`.
- Production `master_leads` counts and origin distribution.
- Whether migrations through 0289 have been deployed to production.

The repository does statically contain seed definitions with the named campaigns and the `W6 — Cold Outreach: Email + Manual Call` sequence template, but seed order or local serial IDs cannot establish production IDs.

## 3. Disposition of the submitted defect list

| Submitted defect | Audit disposition | Correction |
| --- | --- | --- |
| Staging intent has no consumer | **Confirmed** | Build a governed package-handoff consumer that stops at `ready_held`. |
| `master_leads` may lack an origin discriminator | **False / outdated** | Reuse existing `pipeline_origin='sfp_pipeline'`; do not add a second discriminator column. |
| Med Spa and Dental share one campaign | **Confirmed in seed definition; live state requires verification** | Narrow the existing Medical/Dental/Medspa package to Med Spa and create a separate Dental package, using stable logical keys rather than IDs. |
| No five governed paused vertical sequence variants | **Not proven live; statically no canonical SFP package mapping exists** | Create five paused definitions plus one authoritative package map. Do not infer availability from names alone. |
| No idempotent staging state machine | **Confirmed** | Add snapshot-bound command idempotency and a held-state machine; do not terminate at `enrolled`. |
| No recurring readiness/lease/dead-letter capability | **Partially true** | `sfp_stage_runs` and `sfp_stage_items` already contain run, lease, retry, and dead-letter primitives. Implement the missing service/worker/UI using those tables rather than creating another ledger. |
| No operator runbook | **Confirmed** | Add a runbook that ends at held staging and explicitly separates later activation. |

## 4. Required findings and corrections

### F-01 — P0: The requested `enrolled` terminal state violates the no-activation boundary

**Evidence**

- `stageForCampaign()` currently promises: “No sequence is enrolled” (`server/services/cro03/south-florida-prospecting.ts:1507-1519`).
- Canonical `storage.createSequenceEnrollment()` locks the sequence and rejects every sequence whose status is not `active` (`server/storage/automation.ts:222-246`).
- Canonical enrollment routes create `active` enrollments; they do not provide a safe “enroll into a paused sequence” staging mechanism (`server/routes/campaigns.ts:1300-1338`).
- A real enrollment is a contact-bound execution record. SFP currently creates a `master_leads` projection, not a canonical SFP contact-promotion record.
- The repository already models no-send preparation as `ready_held` in CR-06 (`cr06_preparation_runs`, `cr06_prepared_enrollments`, and `cr06_delivery_intents`; `migrations/0182_cr06_premium_campaign_governance.sql:98-167`).

**Required correction**

- Replace `staged -> approved -> enrollment_staged -> enrolled` with a no-launch state model such as:
  - `staged`
  - `operator_selected`
  - `ready_held`
  - terminal: `rejected`, `cancelled`, `superseded`
- Preserve legacy `promoted` only if existing data requires compatibility; do not use it for new Task #2001 work.
- Task #2001 must write **zero** rows to `sequence_enrollments`.
- Do not directly insert paused enrollments and do not temporarily activate a sequence to satisfy the canonical writer.
- Completion and post-publish verification must report `ready_held` counts, not “enrolled (paused)” counts.

### F-02 — P0: The task creates a competing campaign approval/execution authority

**Evidence**

- The repository already has `campaign_approvals` bound to `campaign.content_revision` (`shared/schema.ts:2590-2612`).
- CR-06 already owns versioned program/sequence/content artifacts, approval snapshots, campaign gates, preparation runs, prepared enrollments, held delivery intents, and immutable history (`migrations/0182_cr06_premium_campaign_governance.sql`, `migrations/0185_cr06_history_and_feedback.sql`).
- CR-06 deliberately ends with `READY_HELD — SENDING OFF` (`server/services/cr06-premium-campaigns.ts:1282-1291`).

**Required correction**

- Define SFP Task #2001 as an **upstream handoff** to the existing governed campaign lifecycle, not a second launch-approval system.
- Do not use the unqualified state name `approved`; it could be mistaken for campaign content approval or launch approval. Use `operator_selected` or `staging_authorized` and state explicitly that it does not authorize send, enrollment, or activation.
- The SFP intent may pin a campaign/sequence package reference, but it must not open a CR-06 gate, create delivery intents, create campaign queue members, or issue launch approval.
- A later task must explicitly adapt SFP held records into the canonical contact/CR-06 or sequence activation path. Do not silently bridge those authorities in #2001.

### F-03 — P0: The five vertical packages are ambiguous

The SFP target verticals are exactly `Med Spa`, `Dental`, `Auto Repair`, `Restaurant`, and `Retail` (`server/services/cro03/south-florida-prospecting.ts:118` and `server/services/cro03/roi-cohort-selector.ts:151-155`). The submitted task asks to split campaign 6 and also review campaign 11 for Med Spa reuse, which can create two Med Spa targets and six packages.

**Required canonical mapping**

| Stable package key | SFP vertical | Campaign action | Sequence action |
| --- | --- | --- | --- |
| `sfp.restaurant.v1` | Restaurant | Reuse/narrow the `SDR-04` campaign as a draft successor | New paused Restaurant governed sequence |
| `sfp.med_spa.v1` | Med Spa | Narrow the existing `SDR-05: Medical / Dental / Medspa` campaign to Med Spa, preserving history | New paused Med Spa governed sequence |
| `sfp.dental.v1` | Dental | Create a new draft Dental campaign split from `SDR-05` | New paused Dental governed sequence |
| `sfp.retail.v1` | Retail | Narrow `SDR-06` to the canonical Retail vertical | New paused Retail governed sequence |
| `sfp.auto_repair.v1` | Auto Repair | Narrow `SDR-07` to the canonical Auto Repair vertical | New paused Auto Repair governed sequence |

`SDR-10: Salon / Spa / Beauty` may be reviewed as source material, but it must not become a second SFP Med Spa target. It must remain outside the SFP package allowlist unless a later governed revision explicitly replaces `sfp.med_spa.v1`.

### F-04 — P0: Numeric campaign and sequence IDs are not stable identities

The task repeatedly treats campaign IDs 5/6/7/8/11 and sequence ID 85 as identities. They are serial database IDs and are not guaranteed to match on a fresh database, restored environment, or production instance.

**Required correction**

- Resolve the existing artifacts by exact logical identity and verify their properties; never hardcode the observed numeric IDs in application logic, migrations, tests, or package mapping.
- Add an immutable/versioned SFP package mapping authority, for example `sfp_campaign_package_versions`, containing:
  - stable `package_key`
  - exact normalized SFP vertical
  - `campaign_id`
  - `sequence_id`
  - campaign revision
  - sequence/content snapshot hash
  - governance status (`draft`, `review_ready`, `approved_inactive`, `retired` or an exact reuse of existing authority)
  - effective/superseded timestamps
  - created/reviewed actor and reason
- Each `sfp_campaign_staging_intents` row must pin the exact package-version ID and snapshot hash. Later edits to a campaign or sequence must not change the meaning of an existing intent.
- The mapping table is a reference/version authority only; it must not become a new send approval or dispatch authority.

### F-05 — P0: Paid-source rows cannot fit the current staging-intent schema

**Evidence**

- `sfp_outreach_eligibility` now supports a typed free/paid one-of source (`source_kind`, `candidate_id`, `paid_candidate_evidence_id`) in migration 0289.
- `sfp_campaign_staging_intents.candidate_id` remains `NOT NULL` and references only `free_discovery_candidates` (`migrations/0278_sfp_governed_operations.sql:76-94`; `shared/schema.ts:9684-9700`).
- Current `stageForCampaign()` rejects paid-source eligible rows with `paid_source_task2001_blocked` (`south-florida-prospecting.ts:1570-1578`).

**Required correction**

- Migrate staging intents to the same typed one-of evidence model:
  - `source_kind` (`free` or `paid`)
  - existing `candidate_id` made nullable for the free source
  - `paid_candidate_evidence_id` nullable for the paid source
  - optional normalized value hash copied as non-plaintext lineage
  - a database `CHECK` enforcing exactly one matching source reference
- Replace candidate-based uniqueness with `UNIQUE (eligibility_id)` or an equivalent exact eligibility identity. Nullable candidate columns must not become the idempotency authority.
- Retain the existing Task #2000 regression assertion but change it deliberately: paid rows must move from `paid_source_task2001_blocked` to the same held package path as free rows, while all one-of and safety constraints remain enforced.

### F-06 — P0: Current staging is not atomic or snapshot-bound

**Evidence**

`stageForCampaign()` performs separate writes for the staging intent, `master_leads`, eligibility link, and intent link (`south-florida-prospecting.ts:1715-1751`). A crash can leave partial state. Its idempotency behavior is an `ON CONFLICT ... DO UPDATE updated_at`, not an exact command replay contract. The preview contains aggregate counts only and no snapshot hash (`south-florida-prospecting.ts:1444-1505`).

**Required correction**

- Preview must persist or deterministically compute an ordered candidate snapshot and return:
  - snapshot hash
  - server-issued idempotency key/command key
  - exact selected eligibility IDs
  - package version/hash per row
  - eligible, held, blocked, stale, and already-staged dispositions
- Execute must require the preview snapshot hash, idempotency key, and payload hash.
- Same key + same payload returns the exact stored receipt without writes.
- Same key + different payload fails closed with HTTP 409.
- Snapshot/package/policy drift fails closed and requires a new preview.
- For each claimed item, lock the eligibility row, cohort/run, active policy pointer, and package version and atomically perform all allowed writes in one database transaction:
  - final safety recheck
  - SFP master-lead projection/upsert
  - staging intent/package pin
  - eligibility link/timestamp
  - stage-item disposition
  - run counters/audit receipt
- Have exactly one counter writer. Add crash-injection and concurrent replay tests at every write boundary.

### F-07 — P1: `getValidatedProspects()` is a report DTO, not a mutation authority

**Evidence**

`getValidatedProspects()` is paginated and returns a UI/report projection. It does not lock rows or expose the complete evidence identity needed by a transactional consumer (`south-florida-prospecting.ts:1344-1440`).

**Required correction**

- Keep `getValidatedProspects()` as the certified read/report path.
- Implement a dedicated transactional staging-candidate selector that reads exact `sfp_outreach_eligibility` rows, their typed source references, cohort/program state, active policy document/hash, and package mapping.
- Only `validated_outreach_eligible` rows may be staged. `validated_review_required` and `catch_all_review` may be shown in the UI but must not be accepted by the mutation unless a separate, explicit, versioned manual-review authority is designed and approved.

### F-08 — P1: The `master_leads` origin-discriminator requirement is obsolete

**Evidence**

- `master_leads.pipeline_origin` already exists (`shared/schema.ts:7329-7334`).
- SFP already writes `pipeline_origin='sfp_pipeline'` (`south-florida-prospecting.ts:1728-1741`).
- Migration 0278 already supplies an SFP-specific partial uniqueness index (`master_leads_sfp_business_email_uidx`).
- The MI-07 promotion service admits only `pipeline_origin='cro03_pipeline'` and rejects SFP rows (`server/services/master-leads/pipeline-promotion.ts:125-128`).

**Required correction**

- Delete the proposed “new discriminator column” migration from Task #2001.
- Reuse `pipeline_origin='sfp_pipeline'`.
- Correct the stale schema comment, which currently lists only `manual_import | cro03_pipeline`.
- Before adding any database `CHECK`, run a read-only production census of all existing `pipeline_origin` values. Do not add a constraint that could strand undeclared legacy values.
- Add regression tests proving SFP rows cannot enter the MI-07 `cro03_pipeline` promotion path.

### F-09 — P1: Sequence-family cloning can misroute one vertical to another

The W6 template correctly supplies a paused governance shape: `channelsAllowed=['email','task']`, the three named consent tiers, and `sequenceFamily='cold-email-manual-call'`. However, the generic sequence suggestion service builds a first-row-wins map by `sequenceFamily` (`server/services/sequence-eligibility.ts:266-279`). Five rows with the same family can resolve nondeterministically to the wrong vertical.

**Required correction**

- Clone the W6 governance **shape**, not its database ID or ambiguous family identity.
- Give each SFP sequence a unique stable logical family/package key (for example `sfp-cold-restaurant`, `sfp-cold-med-spa`, `sfp-cold-dental`, `sfp-cold-retail`, `sfp-cold-auto-repair`) or route exclusively through the exact package-version mapping.
- If a common parent family is useful, store it separately; do not make five execution objects indistinguishable to the current first-row-wins resolver.
- All five sequences remain paused and are ineligible for generic automatic enrollment.

### F-10 — P1: Startup seed edits will not safely converge existing production data

**Evidence**

- Campaign seeding creates only campaigns whose names are absent; it does not narrow or split existing rows (`server/services/seed-workflows.ts:73-85`).
- Sequence seeding creates missing rows and hydrates only paused/draft zero-step stubs; it deliberately does not update established rows (`server/services/seed-sequences.ts:40-115`).
- Selective background profiles skip startup seeds entirely (`server/index.ts:460-492`).

**Required correction**

- Do not rely on JSON seed edits or server startup to mutate the existing production campaign rows.
- Add an explicit, idempotent, operator-invoked configuration convergence command with:
  - read-only preview/dry run
  - exact expected current revision/hash
  - create-new-revision behavior for history-bearing artifacts
  - refusal to overwrite active, approved, or already-used content
  - apply receipt and post-apply verification
  - exact rollback/retirement behavior
- Prefer extending the repository's existing production seed-convergence pattern rather than inventing hidden startup behavior.
- Fresh-database tests must prove that no serial ID assumptions exist.

### F-11 — P1: The task does not define whether campaign or sequence is the execution engine

The repository has separate campaign queue tables/engine and follow-up sequence enrollment/worker paths. Writing both campaign membership and sequence enrollment would create two possible future send authorities for the same prospect.

**Required correction**

- For Task #2001, treat the campaign as the governed commercial/package container and the paused sequence as the referenced future execution definition.
- Write neither `campaign_queue_runs/items` nor `sequence_enrollments`.
- Store the exact campaign/sequence pair only in the immutable package version and held intent.
- A later activation task must select one canonical execution path and prove the other cannot send the same contact.

### F-12 — P1: Mutable safety gates are incomplete and use local SQL instead of canonical authorities

Current staging rechecks freshness, suppression, DBPR, and existing-customer state, but DBPR and relationship checks are ad hoc (`south-florida-prospecting.ts:1606-1639`) rather than using `businessHasDbprLineageSql` / `evaluateBusinessPromotionEligibility` or the SFP policy gate.

**Required execution-time gates**

- Cohort is frozen, not voided, and not superseded.
- Program remains active; recurring execution additionally requires `recurring_enabled` and the per-stage control to be on.
- Eligibility remains `validated_outreach_eligible` and belongs to the exact cohort/business/evidence identity.
- Validation has not expired.
- Active policy ID, version, document hash, and relevant policy inputs still match the preview; otherwise require a new preview.
- DBPR lineage is absent using the canonical DBPR authority.
- Existing-customer/relationship exclusion is absent using the canonical promotion/SFP policy authority.
- Suppression, unsubscribe, complaint, DNC, hard-bounce, invalid email, and consent-tier gates still pass.
- Business/contact is not test, demo, synthetic, internal, inactive, or noncanonical.
- Typed candidate evidence remains openable, non-suppressed/non-rejected, deduplicated, and bound to the same business/cohort.
- Package mapping is still current, its campaign remains draft, its sequence remains paused, and its pinned revisions/hashes have not changed.
- No prior held/active equivalent exists for the same eligibility and package.

All of these checks must occur inside or be transactionally bound to the final mutation.

### F-13 — P1: Plaintext handling in the task is misstated

The submitted task says, “No plaintext candidate value is introduced by this task.” Current staging actually decrypts the free candidate and persists the email in `master_leads.email` (`south-florida-prospecting.ts:1679-1687`, `1728-1741`). Paid-source support would require the same deliberate projection decision.

There is also a defect in the supposedly callback-confined Task #2000 boundary that is directly relevant to this build. `openSfpCandidatePlaintext<T>()` returns the callback's arbitrary generic result, and `sfp-validation.ts` currently calls it as `async (plaintext) => plaintext` and assigns that returned plaintext to `realEmail` (`server/services/cro03/sfp-paid-evidence-writer.ts:216-220`; `server/services/cro03/sfp-validation.ts:375-385`). Therefore the implementation does **not** enforce its own documentation that plaintext is never returned outside the callback stack. Task #2001 must not copy this escape pattern.

**Required correction**

- Replace the no-plaintext claim with an exact data-handling contract.
- Keep `resolveSfpCandidateReference()` as the typed source resolver, but correct the plaintext API before reusing it. Replace or constrain the arbitrary generic callback contract so a caller cannot return plaintext. Prefer purpose-specific audited operations—such as a validation transport operation and a transaction-bound master-lead projection—that return only sanitized outcomes, hashes, and row IDs.
- Do not use either the legacy free-only `decryptCandidateEmail()` or the current `async (plaintext) => plaintext` escape pattern in the new consumer.
- The corrected audited operation must accept the transaction executor (or provide an equivalent transaction-bound API) so evidence checks, plaintext-open audit, permitted master-lead projection, and intent finalization cannot drift across connections.
- Plaintext may be projected only to the already-authorized local destination required for the SFP master lead. It must never be stored in the staging intent, stage item, command receipt, audit payload, telemetry, logs, error text, or API response.
- The report must state which table/column receives the value and why that projection is authorized.

### F-14 — P1: The UI says “selected” but executes “all eligible”

**Evidence**

- The route accepts omitted `businessIds` and the service interprets that as “stage all eligible” (`south-florida-prospecting.ts:1521-1533`; `server/routes/lead-ops.ts:3377-3391`).
- The current button says “Stage Selected Eligible Prospects,” but the UI sends no `businessIds` (`SouthFloridaProspectingPanel.tsx:485-490`, `1076-1083`).
- The preview shows only aggregate counts and cannot identify exact targets or blocked rows.

**Required correction**

- Remove the “omitted means all” mutation behavior.
- Require either explicit eligibility IDs selected by the operator or a persisted frozen staging snapshot.
- Enforce a server-side maximum batch size; use an explicit conservative bound (25 unless a separately governed program cap is lower).
- Show row-level business, masked address, source kind, validation age, policy hash/version, target package, and exact blocked reason.
- Confirmation must display the exact selected count and package distribution.
- Return typed 400/409/422 errors for validation, replay mismatch, and safety-policy rejection instead of converting every failure to HTTP 500.

### F-15 — P1: Recurring operations need a dedicated no-send capability group

**Evidence**

- `sfp_stage_runs` already supports `campaign_staging` and `readiness_refresh`, run states, counters, claims, leases, and heartbeat (`migrations/0278_sfp_governed_operations.sql:15-48`).
- `sfp_stage_items` already supports retry and `dead_letter` plus per-item lease fields (`migrations/0278_sfp_governed_operations.sql:50-74`).
- The existing `outreach` capability group starts `sequences` and other sending-capable workers (`server/services/background-profile.ts:107-115`).
- The `enrichment` and `free-enrichment-lane` groups have different capability promises and are not appropriate homes for this consumer.

**Required correction**

- Reuse `sfp_stage_runs` and `sfp_stage_items`; do not add a parallel job ledger.
- Add a distinct physical queue and selective capability group such as `sfp-campaign-staging`.
- Enabling that group must not imply `outreach`, `sequences`, GHL, paid providers, or any send-capable queue.
- Add worker registration, heartbeat/topology visibility, bounded concurrency, lease claim/renew/expiry/reclaim, maximum attempts, retry backoff, terminal dead-letter reason, and operator retry/cancel controls.
- Schedule definitions may be installed, but execution defaults off and requires all of:
  - correct worker capability running
  - active SFP program
  - `recurring_enabled=true`
  - the campaign-staging/readiness stage enabled
  - an explicit batch/concurrency limit
- UI telemetry must show configured schedule, effective enablement, worker/profile availability, next run, last run, backlog, throughput, ETA, retries, stale leases, and dead letters.
- Staging has no provider spend. Report cost as `0 / not applicable`; do not invent a monetary cost metric. Redis/worker configuration is still an operational dependency even though provider credentials are not.

### F-16 — P1: Current baseline contains a failing structural regression suite

At audited SHA `67afe14c`, the dependency-free command:

```bash
node scripts/test-sfp-pipeline-correction.mjs
```

passes 18/21 and fails these assertions:

1. It expects the old literal `unsealCandidateEvidence("email"`, while Task #2000 now routes through `openSfpCandidatePlaintext()` and the source-aware evidence writer.
2. It expects suppression SQL text (`c.email_token_hash IN`) to remain inside `sfp-validation.ts`, while Task #2000 moved the canonical check to `isCanonicallySuppressed()`.
3. It expects an older literal role-inbox ternary, while the implementation now evaluates the versioned policy document.

These failures appear to be stale structural assertions, not proof that the runtime behavior is broken. Nevertheless, the baseline is not green.

**Required correction**

- Update this existing suite deliberately to assert the new canonical boundaries rather than obsolete implementation strings.
- Do not weaken the behavior assertions: prove both candidate/contact hashes reach the canonical suppression helper, the source-aware audited plaintext boundary is used, and named/unclassified addresses follow the active policy's required-review semantics.
- Run the Task #2000 disposable certification to distinguish stale static assertions from a real runtime regression.
- Task #2001 completion must not claim “all regressions pass” until this suite is 21/21 or its authoritative replacement is explicitly documented.

### F-17 — P2: “Test-like sequence” quarantine criteria are not a stable authority

The task references an historical count of 18 and says to use “the same criteria,” but no single canonical persisted test-like classification for follow-up sequences was identified. Name regexes and point-in-time counts are brittle.

**Required correction**

- Make the five package-version records an explicit allowlist. Only the sequence and campaign IDs pinned by a current package version may be SFP targets.
- Require target campaigns to be draft and target sequences to be paused.
- Reject names/records marked test when an authoritative record-class field exists, but do not depend on name matching as the primary control.
- Treat the historical “18” as a production census result to rederive, not an acceptance constant.

### F-18 — P2: The current seed and schema comments contain stale documentation

- `shared/schema.ts` describes `pipeline_origin` as only `manual_import | cro03_pipeline`, even though SFP uses `sfp_pipeline`.
- Submitted file/line references for `stageForCampaign()` are stale after Task #2000; the current implementation is around lines 1442-1765.
- The CI manifest is `scripts/ci-suite-manifest.ts`, not a repository-root `ci-suite-manifest.ts`.

**Required correction**

Update comments and task references as part of the build so future audits do not recreate already-solved work.

## 5. Corrected implementation contract

The following replaces the submitted numbered build steps.

1. **Recapture the baseline.** Record exact `origin/main`, migration head, clean status, and read-only production counts when credentials are available. Classify every live-only assertion as verified or pending.
2. **Reconcile existing regression drift first.** Update and pass `test-sfp-pipeline-correction.mjs` against the Task #2000 architecture without weakening its safety claims.
3. **Define the exact five-package map.** Use the mapping in F-03 and stable logical keys. Campaign 11 is reference content only, not a sixth mapping.
4. **Add versioned package references.** Create an immutable/current-version mapping from stable package key and exact vertical to campaign ID, paused sequence ID, revisions, and hashes. It is not send approval.
5. **Converge configuration explicitly.** Add a preview/apply/verify operator command that creates the Dental split, narrows the four reused campaign scopes, creates five paused sequences, and preserves active/approved/history-bearing objects by creating successors rather than overwriting them.
6. **Correct the typed staging-intent schema.** Add free/paid one-of source references, package-version pin/hash, selection/ready timestamps and actors, failure/rejection codes, and exact unique constraints. Do not add a new `master_leads` origin column.
7. **Implement a snapshot-bound preview.** Produce an ordered exact candidate set, package assignment, block reasons, snapshot hash, payload hash, and server command key. Preview is read-only.
8. **Require explicit selection.** Mutation accepts exact eligibility IDs or a persisted snapshot only, never implicit “all.” Limit each request to at most 25 or a lower governed cap.
9. **Implement transactional held staging.** Lock each exact input; re-run all gates in F-12; use the audited source-aware plaintext boundary; atomically create/update the SFP master lead, intent, eligibility link, stage item, counters, and sanitized audit receipt; end at `ready_held`.
10. **Preserve the no-send boundary.** The code path must not import or call sequence enrollment, campaign queue execution, GHL sync, outbound transport, pause mutation, or sequence/campaign activation APIs.
11. **Add the isolated recurring worker.** Reuse SFP run/item tables and add the dedicated no-send queue/capability, schedule, lease recovery, retry/dead-letter handling, and bounded catch-up controls.
12. **Build the operator UI.** Add row selection, package preview, confirmation, execution receipt, current state, schedule/worker status, throughput, backlog/ETA, retry/dead-letter controls, and a visible “READY HELD — SENDING OFF” label.
13. **Write the exact runbook.** Document configuration convergence, content/compliance review, worker activation, one-row canary, reconciliation, pause/kill switch, dead-letter recovery, and the separate later launch authority.
14. **Certify on disposable infrastructure.** Extend the existing disposable-cluster runner and register the Task #2001 suite in both `scripts/ci-suite-manifest.ts` and `scripts/pre-deploy.ts` with `requiresDisposableTestDatabase: true`.
15. **Publish only after all gates pass.** Production verification must stop after a bounded `ready_held` canary and prove zero enrollment/send/GHL/campaign-queue effects.

## 6. Required migration shape

One or more additive, journaled migrations above 0289 are expected. Exact naming may vary, but the migration must cover:

- `sfp_campaign_package_versions` (or an explicitly reused equivalent) with stable logical key, exact vertical, campaign/sequence references, revisions/hashes, lifecycle state, audit actors/timestamps, and one-current-version constraints.
- `sfp_campaign_staging_intents`:
  - nullable free `candidate_id`
  - nullable `paid_candidate_evidence_id`
  - `source_kind`
  - one-of source `CHECK`
  - unique exact `eligibility_id`
  - `package_version_id`
  - pinned package/policy/snapshot hashes
  - `operator_selected_at/by`
  - `ready_held_at`
  - terminal reason/error code
  - corrected state constraint
- Any command receipt fields/table necessary for exact same-key replay and mismatch rejection.
- Indexes for pending/selected/held state scans and lease-backed worker claims.

Do **not** create a second `master_leads` origin column. Correct its comment and add enforcement only after a live value census proves the constraint safe.

## 7. Required API and UI contract

### Preview

- Admin-only.
- Accepts exact cohort run and optional proposed eligibility IDs.
- Returns an ordered row list, package mapping, source kind, masked address, validation age, policy/package hashes, and exact disposition.
- Returns `snapshotHash`, `payloadHash`, and server `idempotencyKey`.
- Performs no writes except an optional immutable preview/command receipt if that is the chosen idempotency design.

### Execute

- Admin/operator role gated.
- Requires exact eligibility IDs, snapshot hash, payload hash, idempotency key, and explicit confirmation token.
- Rejects empty or oversized batches.
- Same key/same payload returns exact stored result.
- Same key/different payload returns 409.
- Drift or safety rejection returns typed 409/422 with sanitized reason codes.
- Response contains only identifiers, masked values, states, counts, and reason codes—never plaintext.

### Recurring controls

- Separate enable/disable from program activation.
- Defaults off.
- Shows desired and effective status, including whether the dedicated worker capability is actually running.
- Pause prevents new claims; in-flight atomic item transactions may finish. Resume safely reclaims expired leases.

## 8. Mandatory certification matrix

### Schema and migration

- Fresh database migrates through the new head.
- Upgrade from 0289 succeeds with representative legacy staged/promoted/rejected/cancelled intents.
- Free and paid source one-of constraints accept valid rows and reject zero/both/mismatched references.
- Package versions are immutable or superseded by new versions.
- No serial ID assumptions exist.

### Exact mapping

- All five canonical SFP verticals map to exactly one package.
- Unknown, ambiguous, null, broader “Medical,” “Salon,” “Service/Trades,” or “E-Commerce” inputs fail closed.
- Campaign 11 never becomes a second Med Spa target.
- Five sequences with related governance cannot be confused by `sequenceFamily` resolution.

### Eligibility and safety

- Only `validated_outreach_eligible` is admitted.
- Review-required, catch-all, stale, suppressed, DNC, unsubscribed, complaint, bounced, invalid, DBPR, existing-customer, test/demo/internal/noncanonical, voided cohort, superseded cohort, inactive program, policy drift, candidate drift, and package drift cases are rejected with exact reasons.
- Both free and paid evidence use the audited plaintext boundary.
- No plaintext appears in intent/item/receipt/audit/telemetry/log/API fields.

### Idempotency and atomicity

- Same command/same payload is exact replay.
- Same command/different payload fails closed.
- Two concurrent identical commands create one master lead/intent/held disposition.
- Crash injection after every individual write boundary leaves either the whole item committed or none of it committed.
- Run and item counters exactly reconcile with durable rows and have one writer.

### No-send kill lines

Across the full preview, manual execution, recurring execution, retry, lease-recovery, and dead-letter-retry flows, assert zero changes to:

- `sequence_enrollments`
- `campaign_queue_runs`
- `campaign_queue_items`
- `outbound_messages`
- GHL mapping/sync/outbox surfaces
- sequence/campaign active status
- outbound pause/unpause authority
- send/provider attempt tables unrelated to evidence opening

Static import/call-boundary tests must also prove the Task #2001 worker cannot import send, GHL, campaign-dispatch, or sequence-enrollment modules.

### Recurring operations

- Dedicated capability starts only its own no-send queue.
- Enabling `outreach`, `enrichment`, or `free-enrichment-lane` is not required.
- Enabling the SFP staging capability does not start `sequences`, GHL, or provider workers.
- Default-off schedule, program/stage double gate, batch bound, concurrency bound, heartbeat, lease renewal, lease expiry/reclaim, retry backoff, maximum attempts, dead letter, manual retry, and pause/resume all work.
- Backlog, ETA, throughput, and reason totals reconcile exactly with durable rows.

### Regression suites

At minimum run and pass:

- `npx tsc --noEmit -p .`
- production build
- API coverage
- role guards
- migration integrity
- fresh database migration
- `node scripts/test-sfp-pipeline-correction.mjs` (21/21 after deliberate update)
- `node scripts/test-sfp1999-final-closeout.mjs`
- `npx tsx scripts/run-sfp-certification-disposable.ts`
- the new Task #2001 disposable certification
- relevant campaign approval/queue, sequence enrollment/race, contactability, CR-04, CR-06, pause-authority, and background-profile isolation suites

All integration tests must use disposable/local infrastructure with fake transports. No live provider, GHL, campaign, schedule, contact, or production database may be touched.

## 9. Corrected completion report requirements

The completion report must state:

- baseline SHA and final SHA
- migration head
- exact five stable package keys and the runtime-resolved campaign/sequence IDs
- configuration convergence preview/apply receipt
- number of free and paid eligibility rows tested
- number of intents reaching `ready_held`
- exact idempotent replay and mismatch results
- exact safety rejection counts/reasons
- zero `sequence_enrollments`
- zero campaign queue rows
- zero outbound messages/sends
- zero GHL writes
- zero sequence/campaign activations or unpauses
- recurring queue/profile/schedule configuration and default-off proof
- every test command and result, including reconciliation of the prior 18/21 baseline suite
- explicit status split: code complete, merged, deployed, migration applied, worker configured, schedule enabled, production canary verified

The task must not use “enrolled” as shorthand for held staging.

## 10. Corrected post-publish production verification

Perform only after review, merge, deployment, and database migration:

1. Read-only verify the exact deployed SHA and migration head.
2. Run package convergence in preview mode and confirm the exact five mappings.
3. Apply the package configuration with all campaigns draft and all sequences paused; verify no active object was overwritten.
4. Confirm Task #2000 policy and eligibility tables are present and current.
5. Confirm the dedicated SFP staging worker capability is available but the recurring stage remains disabled.
6. Run a one-row preview on a real currently eligible candidate; inspect every gate and package pin.
7. Execute one explicitly confirmed canary to `ready_held`.
8. Reconcile the intent, master lead, eligibility link, stage item, run counters, package version, and audit receipt.
9. Prove zero sequence enrollments, campaign queue items, outbound messages, GHL writes, sends, activations, and unpauses during the canary window.
10. Exercise pause/resume and an artificial disposable/local dead-letter recovery; do not manufacture a production failure.
11. Leave recurring execution off until the operator separately authorizes it.
12. Record the production verification receipt. Do not mark Task #2001 production-verified merely because code and disposable tests passed.

## 11. Final build decision

Task #2001 should proceed only after the build prompt is replaced or amended with this corrected contract. The essential business outcome remains valid—five premium, governed SFP vertical packages and a durable recurring staging lane—but the completion boundary is **package-pinned `ready_held` staging**, not enrollment.

The following are release blockers:

1. Any Task #2001 path writes `sequence_enrollments`, campaign queue rows, outbound messages, or GHL mutations.
2. Paid evidence is admitted without the typed one-of schema and audited plaintext boundary.
3. Preview/execute is not snapshot-bound and exact-replay idempotent.
4. The configuration relies on production numeric IDs or startup seeding.
5. Med Spa maps to both campaigns 6 and 11, or any vertical maps to more than one current package.
6. SFP introduces a second launch approval authority instead of ending at held staging.
7. The recurring worker shares a capability group with sending or provider workers.
8. The existing 18/21 regression baseline is ignored or reported as passing.

Once these corrections are implemented and certified, Task #2001 will safely close the acquisition pipeline's campaign-package staging gap without crossing into launch or delivery.
