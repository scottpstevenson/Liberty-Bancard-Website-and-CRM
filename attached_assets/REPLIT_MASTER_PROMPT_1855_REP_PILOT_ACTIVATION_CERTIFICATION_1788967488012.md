# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK #1855 — Sales Rep Pilot Activation & Exact-Release Certification

## MODE

PREFLIGHT, finish missing code-owned activation controls, certify in disposable state, and stop at the explicit owner authorization gate before any real employee or production-cohort write.

This task depends on merged/deployed #1852, #1853, and #1854 plus upstream #1834–#1836. Re-fetch `origin/main`, record exact dependency SHAs and migration head, and verify the deployed application/schema separately. Do not recreate missing dependencies inside this task.

The task may add readiness code, deterministic certification, preview-only pilot plans, and reversible feature controls. It may not create/invite the two real hires, change their roles, assign production contacts or field stops, enable Call Assist/Field Sales in production, start routes, place calls, or send/enroll anything without a later explicit owner instruction naming the users and bounded cohort.

## WHAT & WHY

Create one governed launch path for the two-person cold-call/door-to-door pilot. Code merged is not the same as deployed, migrated, configured, populated, certified, activated, or authorized. The launch gate must prove each state independently and produce an exact-release receipt before the owner decides whether to activate real users and a small canonical cohort.

## SOURCE-OF-TRUTH MAP

| Concern | Canonical owner |
|---|---|
| Release/readiness | Existing launch-readiness, System Audit, Activation Panel, and certification-receipt architecture |
| Contact quality/remediation | #1834/#1835 |
| Identity crosswalk evidence | #1836 |
| Staff knowledge/Call Assist | #1852 |
| Rep identity/call operations | #1853 |
| Territory/field visits | #1854 |
| Feature flags | Existing canonical feature flag + wizard override authority |
| Authorization | Existing auth/RBAC and CRM object-access services |

## DONE LOOKS LIKE

1. A Sales Rep Operations readiness run freezes exact application SHA, deployed SHA when observable, migration head, policy/prompt versions, current knowledge revision set, relevant feature flags, population high-water marks, and timestamp.
2. Gate results are durable and reason-coded: `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE`. No green aggregate hides a red mandatory gate.
3. Readiness proves unique active user↔agent binding, exact-assignment isolation, agent-role route access, quotas, canonical-contact/manual-call eligibility, field-location/territory/route safety, and attribution of calls/visits/tasks/statements/appointments.
4. The production pilot preview contains only explicitly selected canonical production contact IDs and business-location IDs. Raw Sunbiz/prospect/master-lead rows, test/demo/system records, DNC/suppressed/manual-call-blocked contacts, unresolved identity conflicts, and unverified locations are excluded with reasons.
5. All feature flags remain false until exact-release certification passes and a separate owner authorization is recorded.
6. A disposable end-to-end test proves: rep login → own My Day → manual-call claim → read-only Call Assist → call outcome → follow-up/statement request; and rep login → own Field Day → stop claim → visit disposition → revisit task. All external providers are faked and automated outbound remains denied.
7. A dry-run production readiness report uses aggregate counts only and exposes no raw PII or credentials.
8. The final receipt distinguishes code, merge, deployment, migration, credentials/provider health, knowledge publication, real-user provisioning, data assignment, feature activation, pilot start, and outbound state.
9. Rollback instructions can disable the feature flags, release claims/routes, and unassign the pilot cohort without deleting historical audit/call/visit records.

## REQUIRED IMPLEMENTATION

### 1. Dependency and exact-release preflight

- Verify the merge SHAs and migrations for #1852–#1854 in git and the journal.
- Compare repository SHA, running deployment SHA/build ID, and production migration head using existing read-only readiness probes. A mismatch is not a code pass.
- Audit existing launch-readiness, Activation Panel, System Audit, route guard, audit, receipt, feature flag, and CI owners. Extend them; do not create a separate launch console.
- Verify all upstream deterministic suites before adding new code.

### 2. Durable readiness run/receipt

If the existing receipt model cannot represent this subsystem, add the next additive migration for a typed Sales Rep Operations readiness run and gate results. Store hashes/IDs and aggregate counts, never contact PII or secrets. Enforce one immutable receipt per exact release/config/population fingerprint and idempotent rerun.

Required gates:

- exact repo/deploy SHA parity;
- migration parity and clean journal;
- #1852 published/indexed staff revision readiness and provider configuration state;
- Call Assist default-off and no-side-effect certification;
- unique active user-agent mapping and role correctness;
- exact-assignment/cross-agent isolation;
- selected contact record class, identity, quality, remediation, and manual-call eligibility;
- call claim/outcome/task/statement idempotency and actor attribution;
- calendar ownership and appointment integration state;
- field location class/address/coordinate provenance, territory overlap, route/stop collision, and visit-policy readiness;
- test/demo leakage checks;
- feature flag state and rollback readiness;
- required CI/pre-deploy checks for the exact SHA.

### 3. Preview-only pilot plan

Add an admin-only preview endpoint/UI that accepts explicit candidate IDs and intended rep user IDs but makes no production changes. It returns:

- user/agent readiness per intended rep;
- contact/location accepted, blocked, conflicted, already assigned, and stale counts;
- reason buckets and exact policy versions;
- proposed balanced assignment summary without exposing other reps’ data;
- feature flags/configuration still required;
- a stable preview fingerprint and expiration.

Do not accept an open-ended query meaning “all eligible.” Require a hard maximum and explicit IDs/frozen cohort. Do not store plaintext secrets or unnecessary PII in the preview.

### 4. Disposable end-to-end certification

Boot the real routes with a disposable DB, isolated queues/cache namespace, fake OpenAI, fake GHL, and denied network. Seed admin, manager, rep A/B, canonical contacts/business locations, quality/eligibility states, knowledge revisions, tasks, and route stops. Prove:

- own-data success and cross-agent 404 denials;
- no deal requirement for a cold-call contact;
- current manual-call eligibility recheck and atomic claim;
- Call Assist citations and zero CRM/outbound side effects;
- one call log/follow-up/statement effect under replay;
- one field-stop claimant under concurrency;
- one visit/revisit effect under replay;
- manager metrics equal drill-down records;
- flags disabled deny feature routes;
- no external provider/network call;
- exact teardown with no leaked holds, sessions, claims, routes, fixtures, settings, or audit pollution outside the disposable namespace.

### 5. Operator activation panel

Extend the existing Activation Panel/System Audit surface with a Sales Rep Operations card showing dependency SHA, schema parity, knowledge readiness, rep binding, eligible pilot counts, appointments/provider state, field readiness, feature flags, certification receipt, blockers, and rollback instructions.

No button in this task may directly invite users or activate a production cohort. At most, render the exact follow-up command/checklist requiring a new explicit authorization.

### 6. Rollback and monitoring contract

Document/code the existing reversible controls:

- disable Call Assist and Field Sales flags;
- stop new claims/routes while allowing historical reads;
- release/expire active pilot claims safely;
- cancel future pilot routes and unassign the pilot cohort through audited commands;
- preserve calls, visits, assignment history, and readiness receipts;
- monitor denial/error rates, stale claims, claim conflicts, provider unavailable, Call Assist low confidence, and cross-agent access attempts.

## AUTHORIZATION MATRIX

| Action | Agent | Manager | Admin |
|---|---:|---:|---:|
| View own readiness | Own only | Team | All |
| Run certification | No | Read-only where current policy permits | Yes |
| Preview pilot | No | Yes | Yes |
| Activate real users/cohort | No | No | **Not authorized by this task** |
| Enable production feature flags | No | Existing policy, but **not authorized here** | **Not authorized here** |
| Enable automated outbound | No | No | Out of scope |

## OUT OF SCOPE

- Implementing missing #1852–#1854 features inside this task.
- Enrichment, bulk crosswalk execution, dedupe, or canonical promotion.
- Creating/inviting real employee accounts or storing their personal data.
- Assigning any production cohort or starting field routes.
- Configuring OpenAI/GHL/maps credentials or publishing staff sources.
- Automated calls, AI voice, recording/transcription, RVM, SMS, email, sequences, or GHL writes.
- Production deployment unless separately requested through the normal release process.

## KILL LINES

- STOP if any dependency SHA/schema/policy is missing or the running deployment cannot be tied to the certified SHA.
- STOP if a readiness aggregate can pass while a mandatory gate is red/unknown.
- STOP if pilot preview includes staging/raw/non-production, DNC/suppressed, identity-conflicted, or stale records.
- STOP if certification touches shared/production state or real providers.
- STOP if feature flags or real assignments are changed without a new explicit owner authorization.
- STOP if rollback deletes historical evidence or cannot prevent new work immediately.
- STOP if automated outbound is enabled or implied by “activation.”
- STOP if a second readiness/receipt/feature-flag authority is created.

## REQUIRED GATES / FINAL RESPONSE

Run every dependency’s registered deterministic and disposable suites; exact-release identity checks; migration validation/clean replay if a migration is added; role/object matrix; no-provider/no-network proof; feature-flag denial; concurrency/idempotency; teardown leak detection; typecheck; production build; pre-deploy/compliance; and `git diff --check` under pinned engines.

Return exact starting/ending SHA and migration head; dependency matrix; VFC; gate/receipt table; preview aggregate; implementation evidence; provider/network denial proof; teardown proof; diff review; kill-line proof; rollback steps; and merge verdict.

Finish with separate states:

- Code complete: YES/NO
- Merged: YES/NO
- Deployed exact SHA: YES/NO/UNKNOWN
- Production schema current: YES/NO/UNKNOWN
- Credentials/providers configured: YES/NO/UNKNOWN
- Staff knowledge published: YES/NO
- Real rep users provisioned/bound: YES/NO
- Production contacts/locations assigned: YES/NO
- Call Assist enabled: YES/NO
- Field Sales enabled: YES/NO
- Pilot started: YES/NO
- Automated outbound enabled: **NO**

The expected completion state for this task is certified code and a preview-ready launch gate, with all real-user/data/feature activation fields still **NO** until separately authorized.
