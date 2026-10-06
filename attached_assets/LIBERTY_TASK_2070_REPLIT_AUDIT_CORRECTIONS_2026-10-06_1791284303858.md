# Task #2070 — complete repository audit and Replit correction addendum

**Liberty Stage 3 / Task B — Durable Rep Workflow Repairs**  
**Reviewed 2026-10-06. Source audit complete; implementation and behavioral gates remain open.**

Final baseline/health recheck: `2026-10-06T10:46:32.733363+00:00`. Reviewed attachment SHA256: `6499c0a6a86186d1515f660585577e54f50b5efcd0f8a680c2d9adf61e5e5211`.

## Send-back directive

Reconcile this addendum into the supplied Task #2070 before building. Retain one Task B and its existing B-G01–B-G12 gates. Implement the grouped corrections below through the current application and upstream Task A authorities. Do not restart the audit, replace working capabilities, invent a new task ladder, or declare implementation complete from source searches.

The supplied prompt is substantially grounded in the current repository. It nevertheless leaves important writer, authorization, retention, identity, metric-consumer and regression gaps that could survive a literal implementation. This addendum makes those requirements explicit. **No task code was changed by this review.** “Confirmed” below means the stated source behavior is present at the reviewed commit; it does not mean a production exploit, data loss or browser failure was reproduced.

Required operating state remains **outbound PAUSED; incoming GHL contact sync independently ENABLED**. Public health does not prove the current settings or successful sync. Check the existing authorities with denied transports in fixtures, and preserve that separation in implementation.

## 1. Fresh evidence and corrections to the preflight

| Item | Fresh audit result |
| --- | --- |
| Repository | `scottpstevenson/Liberty-Bancard-Website-and-CRM`; latest main fetched read-only |
| HEAD and refreshed origin/main | `00d75d79c739bb60920790d546af1ab8fb470fe9`; identical, no newer main found |
| Production public health | HTTP200, status `ok`, serving SHA `1699d14806eefb88270c5fac12ef3635cb42ff97`, builtAt `2026-10-06T08:43:20.878Z`, publishBuildId `052b25cb-e613-4f5c-a515-426dd4000aca`, env `production`, ghlTransportFailFast `false` |
| Source relationship | Serving and HEAD tree `ed16aaf360b046357da5ef4a65bf7042791d5291`; no tracked source diff. This is source equality, not build/install/schema/runtime certification. |
| Package identity | package.json SHA256 `ee31b22d58d5d1a03d7f2606560504ffdc160430021cf8fdc32ec6fe6ec4706c`; package-lock.json SHA256 `3fa1797f812dff3117bdd95408b34fd7283618d7307d71e6272177bdc89e63c4` |
| Migration source | 337 entries; last idx336, tag `0333_canonical_relationship_lookup_indexes`, when1800000015700. Applied production schema was not queried. Refresh before allocating an additive migration. |
| Local audit toolchain | Node `v24.19.0`, npm `11.9.0`. This differs from the task's reported Replit Node22.22.0/npm10.9.4. These are different environments, not evidence the Replit report is false. No supported-toolchain install/test pass claimed here. |
| Executed | Task/source reads, complete B reference-row census, source searches (including all16 supplementary grep commands, exit0), fresh Git fetch/ref/tree comparisons, manifest/lock/journal identities, public health GET and `git diff --check` exit0. No tracked code changes. |
| Not executed | Dependency install, build, CI suites, DB/Redis probes, server startup, authenticated browser actions, production mutations, invite delivery, AI/provider calls, native GHL/history inspection or deployment |
| Current CI evidence | Combined commit statuses returned no statuses. The available workflow-run lookup is scoped to PR-associated runs and returned none. These results do not establish that push CI passed, failed or did not run. Obtain the actual current run receipts. Historical Task A failures remain historical until compared with the current baseline. |

Source permalink baseline: <https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/tree/00d75d79c739bb60920790d546af1ab8fb470fe9>.

The attachment's “origin/main two commits behind / no fetch” is superseded by this fresh fetch. Its source and serving SHAs remain valid. Its §13 **CURRENT PREFLIGHT / gate column is blank in all56 rows**; relevant qualifications are embedded in the preceding column. Populate the explicit column using §6 below. Do not silently inherit dated “CONFIRMED CURRENT” counts as today's measurements.

## 2. Preserve these existing repairs and correct overbroad claims

| Existing capability | Current source evidence | Required treatment |
| --- | --- | --- |
| Canonical task reads | `server/services/task-read-authority.ts:27-70`; list calls it in `server/routes/tickets-tasks.ts:170-192` | Reuse it. Repair writer/consumer discrepancies rather than create another task metric authority. |
| Durable inbound orchestration | `server/services/inbound-request-authority.ts:553-645`; authority task creation in `server/storage/tasks.ts:248-300` | Preserve occurrence keys, replay/work/SLA links and held effects. Repair eligible identity and ownership handoff. |
| Existing email composers | `client/src/components/EmailComposer.tsx:44-103`; DashboardLayout global context and ContactDetail record context already exist | “No composer” is false. Add durable, contextual draft persistence to these components. |
| Existing provision/resend routes | `server/routes/activation.ts:1792-1948+`; existing `server/services/auth-actions.ts` | “No invite capability” is false. Surface it and fake its transport in tests; reuse token authority. |
| Existing archive/restore | `server/routes/crm-operations.ts:154-175`; `server/storage/contacts.ts:369-394` | Preserve current UI/transaction/audit. Add validation/concurrency/readback coverage; do not replace it based on an old no-op report. |
| Existing workflow security | `server/routes/workflows.ts:121-216` | Admin/manager and entity guards are present. Preserve them; stale edit/delete-history issues are separate. |
| Existing relationship graph guards | `server/routes/relationships.ts:17-64,73-127,156-188,203-290` | Both write endpoints and graph counterparties are checked; raw heuristic graph data is withheld from agents. Do not report a fresh blanket graph IDOR. Company association gaps remain separate. |
| Existing normal enrollment fence | `server/storage/automation.ts:222-244` | Locks the sequence and rejects every status other than `active`. Do not claim it only rejects draft or add a second competing fence. Background paused preparation requires a separate retirement check. |
| Existing sequence toggle allowlist | `server/routes/campaigns.ts:812-839` | Only active→paused and draft/paused→active; other states409. Preserve this. If retirement is a separate flag, explicitly check that flag here. |
| Existing ticket prospective contact check | `server/routes/tickets-tasks.ts:100-104` | New contact is authorized with exact assignment. Do not claim the task retargeting defect applies identically to tickets. Ticket atomicity/version gaps remain. |
| Existing Pipeline/Ticket deep-link parsing | `Pipeline.tsx:1340-1348`; `Tickets.tsx:506-516` | Both read `?id`. Prove target resolution beyond a limited/filtered list; do not claim query support is entirely absent. |
| Current privileged manager CRM policy | `server/services/crm-object-access.ts:11-18,100-118` | Managers have privileged global CRM scope; use the existing policy. Do not invent agent-like assignment restrictions for managers. Campaign ownership is a separate existing policy. |
| Separate company and business domains | `shared/schema.ts:1714+,4652+,4898+` | Both tables use numeric IDs but identify different resources. Equal numeric IDs do not authorize a company through business access. |
| Public SSR regression repair | `server/ssrShared.ts`; `scripts/test-ssr-style-isolation.ts` | Preserve the dedicated lower-priority `ssr-fallback` layer. Do not apply an older competing CSS patch or undertake C redesign in B. |

Historical native opportunity deletions, original callback/ticket identities, exact39 workflow bindings,33 deletes/4 archives/18 pauses and1175→0 native opportunity claims cannot be certified from present code or health. They retain their individual D/later evidence owners and do not stop independent B implementation.

## 3. Consolidated corrections, fixes and additions

These are **14 correction bundles on existing Task B scopes**, not14 newly proven original findings. They retain the original CRM3/REF register and existing repair-group/task counts. P0 here means stop the affected unsafe deletion operation; P1 means a permission/state-contract repair; P2 means correctness/workflow/regression completion. These priorities do not require suspending unrelated safe work.

### 2070-C01 — Complete all task mutation paths, authorization and atomicity — P1

**Maps to:** R04, V02/B10/B-C05; CRM3-05/18; REF-005/010/049/050/055/067. **Gates:** B-G01/02/03/08.

Confirmed code gaps:

- `tickets-tasks.ts:38-46` rejects all unlinked agent tasks even though `task-read-authority.ts:48-49` allows the agent's owned unlinked tasks. Existing object-access helpers also permit some unassigned linked records while canonical task reads use exact linked ownership. Define and implement the approved action policy explicitly; task visibility and authority must not disagree accidentally.
- Task PUT `:217-226` checks the existing task, then verifies only existence/link coherence for the prospective contact/deal/ticket. `storage/tasks.ts:338-349` is not actor authorization. An agent with access to the original task can submit a valid foreign destination without the corresponding new-destination access check. This is source-confirmed; no production exploit was attempted.
- Task PUT `:229-238` commits the authority transition before updating the remaining fields in a second transaction. Ticket PUT `:105-118` has the same split. A later failure can leave a committed state/assignee event and incomplete field update. The server's current fence is not a client stale-edit precondition.
- `crm-operations.ts:262-267` bulk assign returns submitted length, while `storage/tasks.ts:444-445` writes only legacy `assignedTo`, leaving canonicalAssignee/fence/events unchanged.
- DELETE task `crm-operations.ts:274-307` locates the object using a filtered, limited management list. If the ID is absent from that list, the conditional ownership check is skipped, yet deletion proceeds. The remaining check compares ID/username, while canonical task identity is email. `storage.getTaskById` already exists at `tasks.ts:149-152`.
- Bulk soft delete `tasks.ts:457-471` commits chunks independently, so a later failure can partially apply a selected operation. Single/bulk delete do not provide a shared versioned lifecycle event contract.

Required implementation:

1. Reuse indexed ID reads and existing authorities. Check the stored object and every prospective linked destination before any effect. Resolve the effective merged relationship fields, including an explicitly cleared link. Enforce strict positive integer IDs and bounded, deduplicated bulk sets.
2. Require a client expected version/fence for edit/reassign/complete/reopen/delete. Commit legacy+canonical fields, all edited fields, authority event and applicable durable local audit atomically. Inject a failure between steps to prove full rollback.
3. Use one assignment command for single/bulk/current B writers, with canonical eligible identity and actual changed/not-found/already-applied outcomes. Do not return input length as changed count.
4. Make owned unlinked task actions usable under the approved policy, while foreign and unauthorized linked tasks remain denied. A task-assignee change alone does not authorize a foreign linked contact/deal.
5. For selected bulk operations, authorize the entire set before writes and define atomic/conflict semantics. Preserve history through soft deletion; do not route through raw hard-delete helpers.
6. Preserve GHL deletion safety. Fake `propagateTaskDeleteToGhl` during acceptance. Define the local result when native deletion is blocked; never remove pause gates, send native deletes, or claim native cleanup from a local tombstone.

Add fixtures for IDs outside the first5000/list class, owned unlinked tasks, new foreign endpoints, mixed IDs, stale edits, bulk reassignment changing canonical identity, completion plus description failure, reopen, retry-after-commit and paused GHL propagation. Existing delete404/denial must occur before transport invocation.

### 2070-C02 — Make routing handoff visible and durable across identities and record ownership — P1

**Maps to:** R04/B09/B10/B-C05; CRM3-18/23; REF-010/025/050/055. **Gates:** B-G03/09.

`inbound-request-authority.ts:393-450` chooses from env policy flags/static load, not current user/agent state; serviceHours is not evaluated, and its snapshot merely says configured. Request advisory locking is per request, so it does not reserve shared rep capacity across concurrent requests. `:585-600` creates the task under the chosen ID, while canonical task reads require email and exact ownership of all linked contact/deal/ticket records. The orchestration does not itself update contact assignment/deal owner. Thus **ID→email conversion alone cannot prove the assigned rep can see or act on the linked task**. Replay can retrieve a prior authority task while a later decision has a different assignee.

`toolkit.ts:63-86` independently selects unpaused configured reps and updates a system-setting pool without a shared selection lock. `inbox-ownership.ts:155-182,257-270,342-344` still supplies hardcoded/display-name task assignees. Manual Tasks inputs also use free text.

Required implementation:

- One approved eligibility resolver maps stable userId/linked agent to the canonical task/CRM identity. Recheck role, current lifecycle state and actual agent eligibility at write time. Display names and hardcoded “Scott” are labels, not authority.
- Specify the authority and priority of inbound env policy versus the admin Round Robin configuration. Reuse an existing policy path; do not add a third routing engine. Preserve existing permitted management/global policy.
- For each request, preserve an existing legitimate record owner, or perform an explicitly authorized contact/deal ownership handoff. Never take a foreign owned contact merely to make a task visible. If handoff is denied/unavailable, create visible management review work and record why.
- Freeze/preserve the accepted assignment through replay or use an audited versioned reassignment command updating request/task/required ownership consistently. Do not recompute a different winner while returning an old task as “assigned.”
- Evaluate service hours against declared timezone, holidays/closed intervals and clock, or label unsupported configuration honestly; no configured:true certification. If capacity is enforced, reserve/recheck actual capacity under a shared lock, with replay-safe release. Static policy load must not pretend to reserve concurrency capacity.
- Census manual, toolkit, inbox escalation/appointment and authority-created task writers; consume the same identity resolver and active-user checks. Keep no-pool/ineligible work visible in an authorized unassigned review queue.

Acceptance must use userId different from email and duplicate display names; confirm the selected rep's **actual Tasks list, metrics and action endpoint**, plus contact/deal ownership and request/task/SLA links. Include conflicting preexisting owners, inactive/deactivated/non-agent reps, two requests racing for the last slot, replay, no pool and fault recovery. No production reassignment.

### 2070-C03 — Finish metric consumer census, digest and factual briefing states — P2

**Maps to:** R02/R04/V02/V03/B-C01; CRM3-05; REF-005/045. **Gates:** B-G02/12.

The task correctly identifies daily-briefing gaps, but omits `server/services/digest-service.ts`. Its task queries at `:87-98` use raw legacy status and omit canonical state, deletedAt, linked record class/archive and actor predicates; completed tasks likewise use a separate raw query. These can disagree with canonical Tasks/Home after the proposed briefing fix.

`daily-briefing.ts:45-92,190-198` omits overdueTaskCount, degradation and pause facts from AI input. `:128-149` substitutes0 on SLA/inbox failure, and the named unread count is actually a global same-day inbound audit-event proxy. Closed Won uses updatedAt in the briefing, whereas closedAt is the relevant existing event field used by digest; reconcile with A's declared metric definition. `Overview.tsx:609-612` renders `(kpi?.tasks.overdue || 0)` as “None overdue,” including an unavailable KPI. Generic degraded warnings do not turn displayed0 into a valid measurement.

Required implementation:

- Census **all B task-count/list/summary readers**, including both digest summaries and notification payloads. Consume task-read-authority for counts and rows. Distinct management digest versus personal task scopes must be declared and labelled; do not equate unlike scopes.
- Expose the DTO's population, actor, record class, time window/timezone, asOf, snapshot and per-section status. A frozen asOf does not freeze separate concurrent DB statements; use a shared statement/transaction snapshot where equality is required or disclose the difference.
- Null/unavailable/degraded values remain unknown through API, TypeScript and UI. No zero fallback, “all caught up,” “None overdue,” empty-success or missing-error suppression. A valid measured0 remains0.
- Compute unread from an approved scoped inbox source, or rename it “inbound events today” with its actual scope. Do not relabel audit-event counts as unread messages.
- Pass overdue/degraded/paused facts into the fake-testable briefing. Keep factual numbers/statuses deterministic outside model prose; handle missing, failing and contradictory fake model responses. No real OpenAI calls.
- Retain working refresh bypass; do not call it a no-op. Show cached-daily snapshot/generatedAt versus refreshed facts. Invalidate Tasks, canonical KPI and dependent briefs/notifications after committed actions. Reconcile session caches on logout/account switch.
- Build digest/read fixtures without running its schedule or delivery functions. Keep other finance/leaderboard metric drift with A/later owners unless a B-edited consumer depends on it.

### 2070-C04 — Scope notification content and counts before actor-specific state — P1

**Maps to:** R04/V19/B-C02/B-C03; CRM3-05; REF-049. **Gates:** B-G01/04/09.

`storage/notifications.ts:109-168` gives every recipient personal plus NULL-recipient global rows; unread and list do not apply identical preference predicates. Shared `isRead`/deletion updates at `:178-213,248-275` change the shared row for global notices. `routes/notifications.ts` uses `isAuthenticated`, so it is not inherently limited to CRM dashboard roles. TaskAssigned `tickets-tasks.ts:199-200` and TicketUpdated `:120+` omit recipientId. `digest-service.ts:333-342` only evaluates event preferences when recipientId exists. This turns record-specific content into global notices, beyond the stale-link problem.

Required implementation:

1. Resolve intended recipient(s) at creation, using stable user identity. Task/ticket/contact-specific notifications are not global broadcasts. Genuine organization broadcasts need a declared audience/role/resource policy.
2. Apply audience and record access **before returning title, message, metadata, count or target**. A denied link after exposing a foreign task title is insufficient. Preserve intended personal merchant/partner notifications without exposing CRM-wide content to portal users.
3. Add the smallest actor-notification read/dismiss state keyed uniquely by userId+notificationId; project legacy shared notices without altering retained body/audit evidence. Historical global read provenance is unknown unless recorded; do not manufacture it.
4. All header, list, unread count, read-one, read-all, delete/dismiss and clear aliases use the same authorized/preference/state population. Total and unread intentionally remain different measures.
5. Validate IDs and bounded positive integer limit/nonnegative integer offset; report missing/no-op accurately. Sort by createdAt plus unique ID for stable ties; reset/refresh accumulated pages after mutations and actor changes.

Prove two actors plus a portal role, personal/global/foreign notices, disabled preferences, read/dismiss/clear on one actor leaving the other unchanged, malformed input and count/content denial. Tests must inspect persisted projections, not only optimistically removed cards.

### 2070-C05 — Authorized typed notification destinations and actual record resolution — P2

**Maps to:** R04/V19; REF-049; existing workspace context. **Gates:** B-G04/12.

`Notifications.tsx:116-160` accepts any finite numeric ID, accepts arbitrary metadata links beginning `/` (including protocol-relative `//...`), and produces generic list query targets. Pipeline and Tickets already parse `?id`; Tickets only finds the target within its loaded list. No `?id` parser was found in LiveChat. A valid-looking link therefore does not prove selected-record context, authorized access or an explicit missing state.

Required implementation:

- Prefer typed, strict positive integer entity IDs and a declared destination map. Treat stale/malformed legacy metadata as unavailable. Do not honor protocol-relative/external/malformed/raw arbitrary routes. Explicitly reconcile conflicting entity/legacy IDs.
- Reuse existing contact detail and Pipeline/Tickets query conventions. Resolve a requested target through its authorized ID endpoint even if outside the loaded page/filter; show denied/missing/archived/unavailable states without existence leaks. Do not silently land on a generic board or open the wrong record.
- Trace RFI/chat/SDR/import metadata against actual consumers; implement a B-bounded context handler or an honest supported fallback. No broad C route cutover.
- Maintain accessible link/action focus, back/reload, correct selected record and stable notification state on return.

Fixture coverage includes every produced target kind, conflicting IDs, deleted/stale objects, foreign entities, target beyond current pagination and `//example.invalid`. Use repository-local fixtures; do not navigate to a malicious URL to prove validation.

### 2070-C06 — Complete draft persistence and honest inbox/readiness action states — P2

**Maps to:** R12/V10/B11; CRM3-13; REF-001/002/007/016/019/022/047/051/062. **Gates:** B-G05/12.

The attachment's durable-draft gap is correct. Existing `EmailComposer.tsx`, `AiInbox.tsx` and source rows in `storage/inbox.ts` do not establish a versioned server reply draft. Inbox's delivered:false draft-only response at `inbox.ts:926-944` does not persist the reply body. Do not implement persistence by calling an existing send route while paused.

Required details to make the task executable:

- Define a bounded draft DTO: stable draftId, authenticated actor, supported explicit contact/inbox source identity, channel, subject/body, savedAt and version. Namespace unified-inbox source IDs so equal numeric IDs from different sources cannot collide. Derive actor and author identity on the server.
- Record context must be explicit and authorized for read/save/reopen; global composer without a recipient must say so and must not guess a contact. Recheck on ownership/source changes. Current global shell already opens a composer; preserve that capability.
- Support create/save/update/reopen with expectedVersion and idempotent retry semantics. Keep unsaved text on failure; show saving/saved/error/conflict with reload/retain-copy choices. Close/cancel must not unexpectedly send, create or discard without the intended interaction.
- Never mark saved draft as delivered, ready, scheduled or enrolled. Retain separate inbox coverage/failure/filter/cursor DTOs and proven source cursor safeguards.
- `contact-readiness.ts:82-87,138-145` rejects a fixed placeholder list but allows generic internal synthetic identities matching the regex. Use existing synthetic identity policy to prevent placeholder completeness credit; do not globally change legal contactability or infer the whole100-contact historical cohort.
- Distinguish syntax/completeness, channel consent, suppression, role authority, missing configuration, source ingestion and global send pause. A paused test409 is expected; keep send attempts at zero effects, without unpausing for “verification.”

Acceptance: same draft survives reload/reopen and server read; actor/source collision and forged ID denied; two-editor stale conflict, lost response after commit and ownership change; true empty versus loading/error/partial inbox; pause409 with zero email/SMS/invite/AI/provider effects.

### 2070-C07 — Full retention contract, including deal-only and semantic dependencies — P0

**Maps to:** R09/R10/B08/B-C04; REF-023/064/068. **Gates:** B-G06/07/08.

The prompt already flags three evidence tables; the repair must cover the **complete dependency graph**, not only remove those three DELETE statements.

Confirmed in `server/services/contact-deletion-service.ts`:

- Header `:9-26` identifies protected consent/provenance; inventory `:89-278` and locked recheck `:332-418` omit consent_audit_logs, import_row_dispositions and contact_source_events, while `:525-529` explicitly deletes them.
- `coordinatePendingJobs:274-282` is a no-op returning every selected ID safe, despite its old protective role. `:530-533` actually deletes all contact sequence enrollments; comments about force-cancel are not cancellation evidence.
- Child deal selection `:430-444` classifies disposal from financial-child absence without checking each child deal's record_class; a test contact cannot authorize deleting a production/unknown child deal.
- `:455-474` deletes deal outbox/effect/history/linked records including deal-only email_logs and residual_import_rows. Contact-only email dependency checks cannot protect evidence attached only to the deal.
- The transaction locks contact rows at `:309+`, not a complete semantic child/work graph. Incomplete preview/recheck contracts can produce eligibility differences, FK exceptions or races; no actual production erasure is asserted.

Required repair:

1. Derive one explicit retention/dependency contract used by preview and locked execute, including current migrations/FKs **and non-FK/JSON/semantic references**: contact/deal task/ticket authority receipts, inbox/send histories, consent, import/source lineage, boarding/effect outboxes, residual imports, campaign/package/workflow runs, native IDs/tombstones and pending worker/effect states.
2. Protected evidence blocks product permanent deletion regardless of fixture class. Keep tombstones/archive/review status instead. Do not drop constraints, add cascades, null evidence identity, relabel classes or silently erase provenance to force success.
3. Validate every child resource's own class and authority. Lock/recheck applicable parent and mutable dependencies in a consistent order, with current writers participating in the same fence where necessary. Unknown/incomplete retention truth denies that destructive action.
4. Pending active/paused work requires an explicit, safe retained cancellation/retirement policy, never a no-op “safe” declaration. Worker leases/native effects remain held; audit intent and outcome.
5. Return bounded reason codes that match actual preserved dependencies. Bulk denial/partial eligibility rules must remain explicit and auditable, with unauthorized mixed sets producing zero writes.

Before any product delete fixture, include: each protected evidence table independently, deal-only email/import/outbox, test contact linked to production/unknown deal, active/paused enrollment, JSON authority reference, dependency inserted concurrently, worker-held object, stale snapshot/version and safe no-history fixture. Assert retained rows/receipts/IDs unchanged. Teardown may dispose of the entire proved disposable DB separately; it does not relax application retention.

### 2070-C08 — Contact lifecycle and privacy state must be truthful and conflict-aware — P1

**Maps to:** R09/R10/V17/B07/B08/B12; REF-012/021/023/024/030/068. **Gates:** B-G06/07.

Retain existing archive/restore and admin frozen preview/execute routes. Enforce strict IDs, expected state/version, ownership/class/dependency rechecks and deterministic repeated outcomes. Archive/restore changes visibility; it must not reenroll, restore consent, send or purge. Exercise the actual menu, confirmation/cancel, response, persisted state, audit and reload. Preserve manager global authority and admin-only permanent-delete boundary.

`ConsentAudit.tsx:175-178` labels every non-opt_in action “Opt Out,” while `consent-authority.ts:31-36,118-134` includes unknown/PEWC/global-DNC/restriction kinds. Use an exhaustive typed display map with neutral unknown handling; counts/filter scope must match displayed vocabulary. Unchecked consent is not opt-out. Display evidence facts without altering canonical eligibility or deleting history.

`admin.ts:1159-1167` passes raw privacy request bodies to `storage/misc.ts:235-248`; schema status is free text and UI supplies processedAt. Require a server status allowlist, transition/version validation, verified subject identity, authenticated operator/server timestamps, evidence/block reason and retained audit. User-supplied processedAt/actor/proof are not authority. “Administrative review completed,” “denied/retention hold” and “erasure actually executed” must be distinct. B provides no purge executor and must not claim erasure from a dropdown status.

Concurrent/replayed privacy and archive edits must return conflict or the same accepted result; failed commands must not show success. Preserve immutable consent/intake/audit evidence under every lifecycle action.

### 2070-C09 — Account lifecycle must fence existing role, token and session entry points — P1

**Maps to:** R02/B09/B-C05; CRM3-14/23; REF-020/025/052. **Gates:** B-G01/03/09.

The missing authoritative account lifecycle is a valid upgrade. `shared/models/auth.ts:16-36` has no lifecycle state; a separate agent inactive flag is not account deactivation. Existing auth-actions already provides durable invite/reset authority; reuse it.

Required corrections:

- Check authoritative active/inactive state in current local password strategy `replitAuth.ts:299-318`, deserialize `:325-333`, authenticated requests/session checks `:895-960`, MFA continuation, trusted-device flow, invite/set-password and password-reset consumption. Existing sessions and pending credentials cannot reactivate an inactive account. Authority read failure is fail-closed.
- The current `/api/auth/google` at `:830-832` redirects to a configuration-error login; there is no working OIDC callback to certify here. Test the present disabled behavior. Do not add Google/OIDC implementation just to satisfy a copied checklist; retain future-enabled entry-point requirements.
- Serialize last-effective-admin checks across **existing role update** `admin.ts:347-371`, new deactivate/reactivate and relevant provisioning/recovery paths. The current role update directly changes role and invalidates sessions asynchronously; a new deactivate-only guard would leave demotion as a bypass. Count effective eligible admins, not just role strings.
- Commit lifecycle/role/audit/session authority coherently. Immediate access denial must come from persisted authoritative state; do not depend on fire-and-forget session invalidation succeeding. Revoke or fence existing invite/reset/MFA/trusted-device continuations according to the existing authorities, retaining immutable action receipts.
- Preserve stable userId, open assignments, history and attribution. Deactivation removes routing eligibility; reactivation restores approved access without enabling outbound or silently reassigning prior work. Keep recovery available to another eligible admin.
- Retain existing provisioning collision semantics unless the existing contract explicitly changes. Fake SMTP; expose bounded lifecycle/provision/resend controls on the existing user pages. Sanitize returned DTOs: lifecycle/role responses must not expose passwordHash, reset/invite secrets, TOTP secret/backup codes or trusted-device material. Current role handler only strips passwordHash from the returned row.

Prove two-admin concurrent demotion/deactivation, last-admin/self-lockout prevention, inactive existing session and new login, pending MFA/reset/invite continuation, trusted-device path, denied authority read, reactivation, active-user routing and retained attribution. Do not use a real administrator account or send an invitation.

### 2070-C10 — Lifecycle retirement must cover background writers and retained workflow history — P1

**Maps to:** R10/V20/B13; CRM3-16/17; REF-011/026/027/028/029/056/066. **Gates:** B-G08/10.

`storage/automation.ts:173` deletes a sequence parent; history/FKs prevent broad hard deletion. Normal enrollment already locks and requires active. However `canonical-recipient-preparation-worker.ts:65-89` discovers sequence bindings without a retirement predicate, and `canonical-recipient-preparation.ts:164-181,294-302` can insert/reuse **paused** memberships directly. A new retire flag/status applied only in the UI and normal createSequenceEnrollment leaves this separate writer capable of recreating work. Outbound pause is not a lifecycle fence.

Required implementation:

- Choose additive retirement/archive representation after reader/writer/schema census. Active membership/send work is not removed. Preserve sequence steps, enrollment lineage, package/campaign authority, deliveries/replies/bounces and native history.
- Apply retirement at actual background transaction/write authority, selectors, current package binding and direct upserts; use a consistent lock/fence with retirement. Keep selectors and list/history/count DTOs coherent. Don't alter policy for live paused sequences unnecessarily.
- Preserve existing toggle allowlist; if retirement is a separate field, check it explicitly in toggle/edit/run/prepare routes. Restore visibility does not activate, send or resume membership.
- Use recoverable retirement for objects with history. A permitted no-history draft hard delete needs complete dependency validation and atomic child/parent removal. Generic FK failure is not an acceptable success/error contract.
- `workflows.ts:168-175` calls `storage/workflows.ts:129-130` parent DELETE; `schema.ts:2115` links retained runs. Define409/protected-history or recoverable retirement for workflows too. Do not delete workflowRuns to make Delete work.
- Existing workflow saves need expected version and same-transaction audit; concurrent toggle/save/delete/run reads must honor the lifecycle contract. Cancel already closes locally without API write; retain it.
- Ticket resolution/cancellation remains a recoverable authority transition with retained work and audit; no new ticket hard-delete operation. Campaign/stalled membership cleanup stays bounded to exact authorized local IDs and histories, never name-based/native cleanup.

Fixtures: active/paused/history/no-history draft, retired sequence discovered by background candidate query, direct paused upsert after retirement, concurrent retirement/preparation, stale edit/toggle/restore, workflow with historical/running run and ticket resolve/reopen. No native execution or campaign activation.

### 2070-C11 — Include existing notes and tighten company association resource policy — P1

**Maps to:** R04/R08; CRM3-21/24/26; REF-031/048/053/056. **Gates:** B-G01/10/12.

Notes were part of Task B's durable rep workflow but are not explicit in the supplied implementation steps/relevant files/gates. They already exist and need a bounded repair, not a new notes application.

`routes/activity.ts:191-245` guards only contact entityType on note list/create/edit/delete. Deal and other supplied entity types lack the equivalent object-access check. `schema.ts:3115-3131` allows client author fields and free entityType. `storage/notes.ts:104-127` directly writes content/deletes; update does not set updatedAt. ContactDetail already provides note edit/pin controls (`:2673-2688`), and pin is scoped to contact/note in `contacts.ts:2731+`.

Required notes contract: supported entityType allowlist and strict IDs, authorize that entity before list/content/count/write; authorize stored target on update/delete and disallow forged reparenting. Derive author/operator from the actual session. Update timestamps/version and meaningful audit for durable mutations; use safe content bounds/trim and actual changed outcomes. Preserve the existing pin handler and test pin/unpin, create/edit/cancel/delete or approved recoverable note removal, reload, owner change and stale edit. No customer note deletion during audit.

Company associations are a separate resource path:

- `crm-operations.ts:110-136` PATH contact is covered for agents by the global object guard, but POST companyId is not scoped by that guard before insertion/extraction. `storage/contacts.ts:350-366` performs raw association reads/writes.
- Actual unlink route is **DELETE `/api/contact-companies/:id`**, not a contact path plus link ID. It reads the stored association and authorizes its contact at `:139-146`; preserve that guard. It has no matching company endpoint policy and missing associations return early without an explicit404 response.
- Existing `relationships.ts` already checks both heuristic relationship endpoints and counterparties. Do not weaken those protections or confuse reviewed system links with heuristic/manual association evidence.

Define the approved company read/link/unlink policy for agents versus privileged management, check existence and both actual resources, authorize before count/extraction, strictly parse IDs and return missing/error outcomes. Use transactions/idempotent uniqueness where required; avoid exposing foreign company contact membership from linking one owned contact. Extraction failure after accepted commit must be retained as truthful retry/degraded state, not swallowed as “all reconciled.” Do not call business authorization on an unrelated company ID. Preserve current system-link rules without imposing universal manual-link review on permitted human actions.

### 2070-C12 — Make relationship/editor states truthful without broad UI redesign — P2

**Maps to:** R08/B13/B-C06; CRM3-21/24/26; REF-043/044/048/053/056. **Gates:** B-G10/12.

`RelationshipsTab.tsx:72-83` turns a non-OK graph response into empty nodes/edges. Distinguish forbidden/unavailable, loading, successful empty, filtered-empty and failure/retry. The server already suppresses raw heuristic edges for agent roles; **do not relax that policy just to populate an agent graph**. Explain permitted reviewed relationship evidence and use existing authorized record actions.

For the B-changed contact relationships, notes, workflow editor and lifecycle controls, define the exact request → persisted result → reload contract. Use existing shared buttons/dialogs/error states and Liberty tokens. Add keyboard focus, accessible pending/saved/error/conflict and narrow-phone behavior only for these controls. Do not implement C1–C5 navigation/layout/typography cutover in B.

Onboarding, boarding refresh, application/document sections and the large REF-053 composite retain their assigned C/Stages5–6 or later action tests. A generic page load or relationship save does not close processor/MID/document/call/BIN/review/success workflows.

### 2070-C13 — Execute supported Knowledge SQL and prove filtered/error contracts — P2

**Maps to:** V21/R08; CRM3-24/25; REF-054. **Gates:** B-G11/12.

`services/knowledge-base.ts:134-145` calls `(db as any).execute({sql,params})`; adjacent tagged SQL is the supported pattern. Repair all supplied status/audience filter combinations using parameterized supported Drizzle SQL, without raw interpolation or casts that hide unsupported execution. Preserve existing admin/manager role guard in `routes/knowledge-admin.ts:27-50`.

`KnowledgeAdmin.tsx:61-67,138-141,217-224` collapses failed lists to empty. Add real loading/error/retry and labelled filtered/global counts. Whole-library stats may legitimately differ from filtered rows; equal numbers are required only for identical scopes. **16 is a historical/cohort observation**, not a universal current-production expected count. Seed16 only in a declared disposable fixture if the fixture requires it; do not seed/import/reindex production or call embedding/AI.

Prove actual migrated query execution: no filters, each filter, combined filters, invalid values, SQL-special strings, successful empty, injected DB failure, retry and denied role. Compare fixture IDs/population, not only stats totals.

### 2070-C14 — Preserve the public-site repair and run truthful canonical acceptance — P1/P2

**Maps to:** R01/A-REG-01 and Task B delivery; all B parents. **Gates:** B-G01/12 and relevant functional gates.

The original Task A broke public styling and a later repair is retained in `server/ssrShared.ts`. Current `scripts/test-ssr-style-isolation.ts` exists but is not registered in `scripts/ci-suite-manifest.ts`. Register it under its actual capability and run it; do not replace the behavioral public-page smoke with source regex alone.

Add a bounded regression smoke on a proved disposable preview: actual server-served public homepage and `/upload-statement`, initial SSR and hydrated/reloaded view, desktop and narrow phone, logo dimensions, Liberty colors/spacing, layout overflow, CTA route and focus. No form submission/upload/provider effect is required for this regression. Preserve the `@layer ssr-fallback, theme, base, components, utilities` order and fallback marker. No Tailwind upgrade, global CSS refactor, lockfile churn or public redesign is authorized by B.

Use current `.github/workflows/ci.yml`, `scripts/ci-suite-manifest.ts`, runner and pre-import guards, supported Node22.22.0/npm10.9.4. Meaningful new actual-handler/DB/browser tests enter the manifest under truthful capabilities. Do not reclassify tests to skip required infrastructure, add production-default fallback credentials, patch node_modules, bypass private registry URLs or suppress baseline failures.

For each gate distinguish NOT RUN, FAIL, PASS with receipt, historical receipt and external/native pending. Capture tested SHA, command/exit, fixture/schema/clock, actual session/CSRF, persisted outcome, effect counts and artifact path. Register the new regression and B behavior tests once; do not repeatedly run unrelated broad suites after clean passes without a new reason.

## 4. Replacement implementation sequence inside the same Task B

1. **Baseline/contracts:** refresh affected source, use A task/CRM/inbound/inbox/auth authorities and inspect exact schema/FKs. Keep existing retention and side-effect kill lines.
2. **Safe schema/retention:** additive migrations for the minimal version/draft/actor-state/account/retirement contracts. Repair complete product-deletion retention before any delete fixture. Do not edit applied migrations or run production DDL.
3. **One durable work command path:** atomic task/ticket edits, canonical single/bulk assignment, prospective scope, eligible routing and ownership visibility; include notes. Keep record-specific notifications recipient-scoped.
4. **Facts and communications UI:** canonical counts including digest reads, factual briefing/null/cache states, actor notifications, typed destinations, contextual drafts and readiness. No live sends or provider calls.
5. **Recoverable lifecycle/admin:** contact archive/restore, privacy transition labels, sequence/campaign/workflow retirement and current background fences, account lifecycle through existing auth entry points and role changes.
6. **Bounded existing-page repairs:** Knowledge SQL/error states and relationship/editor action feedback; preserve Liberty/public SSR design. C retains complete navigation/design work.
7. **Acceptance/handoff:** run the existing12 gates with the additions below, current canonical CI and actual fixture browser actions. Update each original reference row plus the existing spec/ledger with exact verified/partial/external dispositions. Deliver reviewable code and receipts; deployment and final Stage3 GO remain separate.

These are execution groups within #2070, not seven additional Replit tasks. Work may proceed independently where dependencies permit; an unavailable native receipt or browser session does not justify skipping source repairs.

## 5. Gate amendments, additional destinations and grep checks

| Gate | Add these explicit acceptance checks to the supplied matrix |
| --- | --- |
| B-G01 | Canonical identity/action policy, all prospective resources, note entity policy, notification content audience; preserve existing A guards and role rules |
| B-G02 | Digest counts/rows; true null in UI; scoped/renamed inbox facts; deterministic AI facts; compatible snapshot scopes; action cache invalidation |
| B-G03 | Actual linked record ownership+task visibility; replay assignee coherence; real capacity race; service-hour evaluation; current-user exclusion across toolkit/inbox/manual writers |
| B-G04 | Recipient/content authorization before DTO/count, portal negative case, actor projections on every alias, strict/stable paging and all typed target consumers |
| B-G05 | Source-namespaced actor draft keys, server readback/version/retry/owner change; no-recipient global composer; pause and source degradation distinct; zero sends/generation |
| B-G06 | Typed vocabulary, privacy version/identity/operator/timestamp/evidence; administrative completion distinct from erasure; all consent/provenance survives lifecycle |
| B-G07 | Complete contact+deal/semantic retention graph, child class, pending work, concurrent dependency; full archive/menu/cancel/reload; no product deletion until safe contract repaired |
| B-G08 | Task/ticket atomic lifecycle; retirement at canonical background preparation/direct upserts; history retention and no-history delete; restore keeps sends held |
| B-G09 | Last-admin fence includes existing role changes; current inactive account checked at password/deserialize/MFA/trusted/invite/reset/session paths; current Google redirect expected; safe DTOs; fake invite |
| B-G10 | Existing notes per entity/author/version/audit; exact company association route/resource policy; existing graph guards; workflow stale save plus retained-run delete contract |
| B-G11 | Real supported filtered DB execution/error/retry; historical16 limited to declared fixture; preserved role guard and zero indexing/provider effects |
| B-G12 | Registered SSR style regression plus SSR→hydration desktop/phone public smoke; actual changed-action browser receipts; all56 rows filled; honest canonical CI and source/merged/deployed distinctions |

### Additional relevant files missing or insufficiently explicit in the supplied list

- `server/routes/activity.ts`, `server/storage/notes.ts` — existing durable notes and typed scope.
- `server/storage/workflows.ts` — parent deletion/history and versioned editor persistence.
- `server/services/digest-service.ts` — competing task metrics, notification preference callers and delivery boundary.
- `server/services/auth-actions.ts` and its existing tests — durable invite/reset reuse and lifecycle fence.
- `server/services/canonical-recipient-preparation.ts`, `server/services/canonical-recipient-preparation-worker.ts` — direct paused membership writers and retirement.
- `client/src/pages/dashboard/Tickets.tsx`, `Pipeline.tsx`, `LiveChat.tsx`, and actual RFI/SDR target consumers — requested-record resolution and unavailable state.
- `server/ssrShared.ts`, `scripts/test-ssr-style-isolation.ts` — preserve/public regression assurance.
- Existing migration definitions for every affected FK/semantic authority; allocate new names only after refreshed journal inventory.

These add to the original relevant files; they do not replace it. Change a file only where the traced repair needs it.

### Execute these supplementary before/after source searches

Run from the actual repo root; capture exit and bounded output. Matches require review, not blanket deletion. Source grep is supplementary to handler/DB/browser proof.

```bash
rg -n 'authorizeTaskScope|assertTaskLinkedObjectScope|getTaskById|transitionAuthorityTask|transitionAuthorityTicket' server/routes/tickets-tasks.ts server/storage/tasks.ts
rg -n 'bulk-assign|bulk-delete|getTasks|propagateTaskDeleteToGhl|bulkAssignTasks|bulkSoftDeleteTasks' server/routes/crm-operations.ts server/storage/tasks.ts
rg -n 'INBOUND_ASSIGNMENT_POLICY_JSON|serviceHours|capacity|currentOwner|createAuthorityTask|canonicalAssignee' server/services/inbound-request-authority.ts server/storage/tasks.ts
rg -n 'assignNextRep|userId|assignedTo|Scott' server/routes/toolkit.ts server/routes/inbox-ownership.ts client/src/pages/dashboard/Tasks.tsx
rg -n 'COUNT\(.*|status !=|due_date|completed_at|overdueTaskCount|readTaskMetrics' server/services/digest-service.ts server/routes/daily-briefing.ts server/services/task-read-authority.ts
rg -n 'sectionStatus|None overdue|overdue|generatedAt|invalidateQueries' client/src/pages/dashboard/Overview.tsx client/src/pages/dashboard/Tasks.tsx
rg -n 'recipientId|preferenceCondition|isRead|markAll|clearAll|limit|offset' server/routes/notifications.ts server/storage/notifications.ts server/services/digest-service.ts server/routes/tickets-tasks.ts
rg -n 'getNotificationLink|startsWith|asNumber|URLSearchParams|useSearch' client/src/pages/dashboard/Notifications.tsx client/src/pages/dashboard/Pipeline.tsx client/src/pages/dashboard/Tickets.tsx client/src/pages/dashboard/LiveChat.tsx
rg -n 'consent_audit_logs|import_row_dispositions|contact_source_events|email_logs|residual_import_rows|coordinatePendingJobs|DELETE FROM|FOR UPDATE|record_class' server/services/contact-deletion-service.ts
rg -n 'entityType|authorId|authorName|createNote|updateNote|deleteNote|pin' server/routes/activity.ts server/storage/notes.ts shared/schema.ts
rg -n 'role|invalidateAllUserSessions|deactivat|reactivat|totp|trusted|reset|deserializeUser|auth/google' server/routes/admin.ts server/replit_integrations/auth/replitAuth.ts server/services/auth-actions.ts shared/models/auth.ts
rg -n 'follow_up_sequences|sequence_enrollments|status|retir|FOR SHARE|FOR UPDATE' server/services/canonical-recipient-preparation.ts server/services/canonical-recipient-preparation-worker.ts server/storage/automation.ts
rg -n 'deleteWorkflow|updateWorkflow|workflowRuns|version|expected' server/routes/workflows.ts server/storage/workflows.ts shared/schema.ts
rg -n 'contact-companies|companyId|extractRelationships|canScopeRelationshipCounterparty|canExposeRelationship' server/routes/crm-operations.ts server/routes/relationships.ts server/storage/contacts.ts
rg -n 'listKnowledgeSources|execute|sql|isError|retry|sources' server/services/knowledge-base.ts client/src/pages/dashboard/KnowledgeAdmin.tsx
rg -n 'ssr-fallback|data-ssr-fallback-styles|test-ssr-style-isolation' server/ssrShared.ts scripts/test-ssr-style-isolation.ts scripts/ci-suite-manifest.ts .github/workflows/ci.yml
git diff --check
git diff --stat
```

### Canonical execution checks retained from the original task

The commands below are build acceptance instructions, **NOT RUN by this source reviewer**. Verify the exact current workflow before execution. Use supported toolchain and a clean disposable checkout; no dependency intent changes.

```bash
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npx tsx scripts/test-dependency-policy-evidence.ts
npx tsx scripts/test-inventory-artifact-dependencies.ts
npx tsx scripts/ci-suite-manifest.ts --check
npx tsx scripts/run-ci-suites.ts --capability deterministic-static
npx tsx scripts/run-ci-suites.ts --capability external-security
npx tsx scripts/run-ci-suites.ts --capability writable-build
```

Use current strict real-lock dependency-policy arguments and retain receipts. Integration requires CI's dedicated PostgreSQL/Redis, exact DATABASE_URL=TEST_DATABASE_URL, reserved unique Redis namespace and repository provider/transport guards **before imports/startup**. Do not print secrets, copy production settings, flush shared Redis or use db:push. Follow existing child-server namespace ownership; do not assume the wrapper's namespace equals a guessed parent prefix.

```bash
npx tsx scripts/test-certification-process-env.ts
npx tsx scripts/test-certification-provider-deny.ts
npx tsx scripts/test-certification-server-readiness.ts
npx tsx scripts/test-certification-redis-reservation.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-integration
```

Then start only the owned denied certification server using the current workflow's fixture/readiness contract and private port; execute server-required and changed-action browser suites. Do not start schedules or production-connected server just to obtain a pass. A blocked infrastructure proof blocks that command, not independent source repair.

## 6. All56 Task B reference entries — explicit current disposition and closure owner

The source register is **13 CRM3 +43 REF entries**. Composite findings and overlapping repair scopes remain linked; these are not56 unique bugs. The original95-entry master register is preserved. Each historical count or event needs its own original evidence; fixing a current root cause does not retroactively prove it. The following replaces the blank CURRENT PREFLIGHT / gate cells without overwriting dated source evidence.

| Original ID | Current source disposition / exact boundary | B gate and remaining owner |
| --- | --- | --- |
| CRM3-03 | Upstream incoming/no-echo authority retained; present health is not import proof. B workflow consumer checks only. | B-G01/10; A sync authority; D/Stage4 native proof |
| CRM3-04 | Configured/health is not operational execution. Preserve A runtime DTO; B action feedback and failure states. | B-G01/10; C5 diagnostics; D live execution |
| CRM3-05 | Canonical reads present; briefing/digest/UI/writer discrepancies source-confirmed, C01/C03/C04. No fresh production count. | B-G02/04; A shared definition; D live equality |
| CRM3-13 | Inbox source/cursor controls exist; contextual draft/readiness explanations need C06. Real ingestion remains unverified. | B-G05; C2; Stage4/D ingestion |
| CRM3-14 | Preserve A collection/per-ID guards; current B account lifecycle upgrade C09. No blanket role pass. | B-G01/09; Stage9 security |
| CRM3-16 | A aggregate repair retained; lifecycle/history/background retirement C10. Native stalled population not freshly counted. | B-G08; A aggregates; Stage4/D native |
| CRM3-17 | A manager read policy retained; prove actual lifecycle counts/UI without broadening access. | B-G08/12; C3; D live consumer |
| CRM3-18 | Orchestration exists; identity, eligibility, capacity and ownership visibility gaps C01/C02 confirmed. | B-G03/09; D dated ticket evidence |
| CRM3-21 | B notes/relationships/workflow and truthful actions C11/C12 only. Full clutter/layout redesign remains C. | B-G10/12; C1/C2/C4/C5 |
| CRM3-23 | Provision/resend absence disproved; discoverability and recoverable account lifecycle C09 remain. | B-G09; C5 layout; Stage9 recovery |
| CRM3-24 | Specific Knowledge/graph error-empty issues confirmed; do not generalize every empty section as a defect. | B-G10/11/12; C and Stages5–6 other sections |
| CRM3-25 | Knowledge SQL/error confirmed; workflow guards already present. Whole training/security certification remains separate. | B-G01/10/11; Stages8/9 |
| CRM3-26 | Company association/notes/action scope C11 and honest graph C12. Existing graph guards preserved. | B-G10/12; C4; Stages5–6 lifecycle |
| REF-001 | Paused email-test409 is expected, not a defect to remove; dated result not freshly replayed. | B-G05; D/Stage4 real delivery |
| REF-002 | Outbound health test blocking is expected under pause; fake transport proves no effect. | B-G05; Stage4 later delivery |
| REF-005 | Old numerical mismatch is historical; present canonical read plus consumer/writer gaps confirmed. | B-G02; D live scoped comparison |
| REF-007 | Inbox partial-source/cursor protections present; fresh fixture multi-source failure/coverage proof required. | B-G05; Stage4 provider ingestion |
| REF-010 | Seven-ticket count/identities are dated. C02 current routing gaps confirmed; no speculative ticket correction. | B-G03; D exact original receipts |
| REF-011 | A fanout/runtime truth repair retained. B retirement/history C10; native39/stalled counts pending. | B-G08; A counts; Stage4/D native IDs |
| REF-012 | Typed consent label defect confirmed C08. Old localhost/curl event facts require IDs; retain logs. | B-G06/07; D historical event receipts |
| REF-016 | Cap/missing-SMTP configuration is not itself a bug or permission to raise spend/unpause. | B-G05; Stage4 configuration/native proof |
| REF-017 | 0/39 workflow bindings is an external/datetime observation, not current source-proven absence. | B-G01/10 local feedback; Stage4/D exact bindings |
| REF-019 | No-composer claim disproved by existing global/contact composers; durable drafts C06 remain. | B-G05 |
| REF-020 | No-invite claim disproved by existing provision/resend routes; bounded UI/fake delivery C09. | B-G09 |
| REF-021 | Pending request alone is expected; raw-body/unversioned privacy transitions confirmed C08. | B-G06; no B erasure execution |
| REF-022 | Unauthorized/paused outbound denial is expected; fixture distinguishes role from pause. | B-G05; Stage4 sending |
| REF-023 | Prior disposable bulk400 not reproduced is dated. Current protected evidence omissions C07 confirmed. | B-G07; D any historical failure receipt |
| REF-024 | Archive implementation exists. Prior no-op not reproduced; current version/strict-input/browser proof required. | B-G07 |
| REF-025 | Recoverable account deactivate/reactivate is a current upgrade gap C09; hard-delete not required. | B-G09 |
| REF-026 | Use retained ticket resolution/cancellation, not blanket ticket hard deletion. Atomicity C01. | B-G08; Stages5–6 support loop |
| REF-027 | Sequence parent-only deletion/history dependency gap confirmed; governed retirement C10. Old SQL failure receipt separate. | B-G08 |
| REF-028 | Bounded campaign retirement/history upgrade C10; no proof every campaign lacks every lifecycle capability. | B-G08; C3; Stage4 native execution |
| REF-029 | Exact local stalled membership retirement only. Source counts cannot authorize bulk/native cleanup. | B-G08; Stage4/D immutable membership receipts |
| REF-030 | Old Delete Contact UI observation not freshly reproduced; existing frozen delete flow retained and tested. | B-G07; C2 menu layout |
| REF-031 | Relationship lifecycle is an upgrade/composite; specific company/notes gaps C11 confirmed. | B-G10; C4; Stages5–6 full chain |
| REF-037 | Historical native sample task/opportunity deletion unverified; never repeat cleanup for evidence. | B-G07/08 local fixtures; D native tombstones |
| REF-038 | Native duplicate GoLive claim unverified; names alone not immutable lifecycle evidence. | D native IDs; B history retention only |
| REF-043 | Prior settled onboarding loading issue not reproduced is historical; no new checklist action pass. | C4/Stages5–6; B-G10 shared error treatment only |
| REF-044 | Disabled refresh with zero submissions is expected in that dated state; eligible action not tested here. | C4/Stages5–6; D eligible fixture |
| REF-045 | Blanket missing briefing superseded by existing API; current factual/degraded/AI gaps C03. | B-G02 |
| REF-047 | Unsettled Ready queue observation remains unverified; no inferred empty population or pause→zero. | B-G05; C2/D timed eligible/source fixture |
| REF-048 | Dated app/document counts not remeasured. B relationship context/empty-error only, not MID certification. | B-G10/12; C4/Stages5–6 |
| REF-049 | Total versus unread can legitimately differ. Content/state/prefs/destination gaps C04/C05 confirmed;1815 history not inspected. | B-G04; D exact old target/history |
| REF-050 | Empty/disabled pool observation is configuration, not engine absence; current separate-policy identity gaps C02. | B-G03/09 |
| REF-051 | Placeholder completeness gap C06; no current159443 score/activity measurement or population assertion. | B-G05; D exact score/activity lineage |
| REF-052 | No current multi-role/MFA browser pass. C09 lifecycle/entry-point fixtures required. | B-G09; Stage9 comprehensive security |
| REF-053 | Composite upgrades retained individually; B existing notes/relationships/workflow only. No blanket tools/forms/calls success. | B-G10/12 B slice; C/later specific owners |
| REF-054 | Knowledge unsupported SQL/error-empty confirmed C13.16/progress are historical; localStorage is not certification. | B-G11; Stage8 training |
| REF-055 | Original callback/search/count/history not rechecked; orchestration exists, current visibility/identity C02. | B-G03; D original159443/ticket receipts |
| REF-056 | Workflow role/entity guards repaired; Cancel local. Stale save/history C10 and real fixture save proof remain. | B-G01/10; Stage4/D native run |
| REF-062 | 100-row/all-contact no-activity inference unverified; C06 never closes that population claim. | B-G05 readiness slice; D original cohort/versions |
| REF-064 | 33 deletes/4 archives/18 pauses remain historical receipt obligations; no repeat production cleanup. | D immutable IDs/actor/time/receipts |
| REF-065 | 1175→0 native opportunity deletion/restore remains unverified by local code. | D native lineage/tombstones/backups |
| REF-066 | Inflated joined-row interpretation superseded by A aggregate repair; true unique population still needs receipt. | B-G08 local history; A counts; Stage4/D population |
| REF-067 | Historical corrected ticket identities not established; no speculative identity rewrite. | D original IDs/before-after/audit; B-G03 new fixtures |
| REF-068 | Erasing consent/audit recommendation declined; typed display and complete retention C07/C08 required. | B-G06/07; preserve immutable evidence |

## 7. Completion report Replit must return after the build

Return one consolidated build handoff with:

- Changed-file purpose and before/after behavior for each correction bundle and original assigned subclaim.
- Actual B-G01–B-G12 results with exact receipts and exceptions, including the canonical CI baseline comparison. Source searches alone cannot close mutation/runtime gates.
- Stable identity/actor/class/time-window definitions; exact migration/schema version, test clock, sessions/CSRF and fixture IDs; persisted/reopened outcomes and unwanted-effect counts.
- All56 explicit reference dispositions. Preserve95 original entries and existing grouped roadmap. Mark source repaired, behavior verified, historical unverified, expected control, upgrade and remaining external/C/Stage owner separately.
- Outbound remains paused; incoming sync remains independently enabled; zero live invite/email/SMS/AI/provider/native mutation effects from the task's tests. A fake result must be labelled fake.
- Rollback/restore: additive data retained; retire/archive does not activate; user recovery without last-admin loss; no irreversible native history recreated or claimed recovered.
- Source commit, merged status, artifact/build/schema evidence and deployed/live status separately. This task does not authorize deployment or final Stage3 certification.

**Review outcome:** incorporate the14 bounded correction bundles and the filled56-row register, then implement and run the supplied Task B. The current source review does not certify completed repairs or live business actions. Current source defects are actionable now; external history remains a specifically assigned evidence obligation rather than an excuse to restart or stall the build.
