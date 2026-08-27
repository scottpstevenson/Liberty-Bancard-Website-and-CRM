# Liberty Bancard — Task 1698 Self-Contained Authority and Scope Correction

Paste this message into the existing Replit Task 1698 session before implementation. It replaces any Task 1698 language that assumes the agent already knows the CR, CRO, CAR, OR, “Authority G,” consolidated-audit, or prior-task crosswalks.

## Directive

Continue Task 1698 in **PREFLIGHT + BUILD** mode, but do not rely on any audit, roadmap, finding ID, or authority label that is not reproduced in the task session. You have not been given the CR-01–CR-06 audits, OR-01–OR-05 roadmap, CRO task map, CAR finding register, “Authority G,” or the consolidated ChatGPT audit. Those names have no executable meaning by themselves.

Use the current repository as the code authority. Recapture branch, HEAD, working tree, migration head, current owners, and current call paths before editing. Treat old paths, line numbers, counts, and conclusions as claims to verify, not facts.

Task 1698 remains the first narrowly scoped campaign/sequence repair. Implement every safe, still-valid item below in the same run. Stop only for a genuine blocker or kill line. Do not merge, deploy, unpause, activate a campaign or sequence, enroll production recipients, process the production queue, call a paid provider, or send any real email/SMS.

## Existing source-of-truth owners to verify and extend

Do not create competing authorities. Locate the current implementation first, then extend these existing responsibilities:

- Campaign queueing, frozen membership, dispatch, and outcomes: current campaign engine, routes, and storage.
- SMTP commercial classification, final pause check, sender policy, unsubscribe headers, and provider call: current SMTP service.
- Compliance content: one canonical fail-closed transport renderer using the same mailing address, base URL, and unsubscribe-token configuration that readiness validates.
- Commercial record classification: current commercial-classification authority.
- Consent, suppression, and channel eligibility: current consent/contactability services.
- Global/channel pause and final epoch authorization: current outbound pause/control services.
- Reply evidence: canonical communication events plus one read-side decision returning `REPLIED`, `CONFIRMED_ABSENT`, or `UNAVAILABLE`; do not create another event store.
- Lifecycle transitions: current lifecycle service.
- Sequence eligibility, enrollment, and dispatch: current sequence services and worker.
- Promotional template registration: current sequence seeders and catalogs.
- Durable provider/send evidence: current send log, outbound message, communication event, and audit owners.

If current code proves one of these owners has changed, record that correction in the preflight VFC table and extend the actual current owner.

## Task 1698 owns now

### 1. Preserve canonical contact identity through campaign delivery

- Verify every reachable campaign SMTP dispatch branch, including frozen-contact delivery, linked-prospect/legacy delivery, retry, and recovery paths.
- Pass the resolved canonical `contactId` into the final SMTP policy boundary.
- Missing, unknown, test, demo, synthetic, or commercially unclassified records must cause zero transport calls.
- Do not weaken frozen-preview, contactability, validation, suppression, pause, coordinator, sender-policy, send-log, or classification controls.

### 2. Make compliance rendering exactly once

- Campaign and sequence callers must not pre-append compliance content that the transport appends again.
- Use one idempotent renderer for the final HTML/plain-text compliance treatment and List-Unsubscribe/One-Click headers.
- Reconcile configuration first: the renderer must use the same fail-closed mailing address, public base URL, and token authority that readiness validates.
- A hardcoded or different environment fallback must not silently replace the validated marketing address.
- Preserve exactly one postal-address block, one opt-out treatment, and one header set.
- Remove implicit promotional signature defaults such as unapproved terminal, savings, urgency, or offer copy. Promotional copy must require explicit approved input; this task does not write or approve a production campaign.

### 3. Enforce campaign authority on the server

- Align campaign reads with the existing dashboard employee policy; UI visibility is not authorization.
- Anonymous and agent roles cannot mutate campaigns.
- Managers may create and edit draft content only, after parent/object checks.
- Admins may perform the narrowly defined administrative campaign actions allowed by current policy, but a human admin must not directly execute the global provider-capable send loop.
- Retire the human HTTP global-process route or move it behind the existing internal registered-worker/command boundary.
- Use strict request allowlists. Derive `createdBy`, `updatedBy`, status, counters, activation state, and other server-owned fields from trusted server state, not request bodies.
- Every step mutation must load and authorize its parent campaign before writing.
- Rejected requests must create no preview, queue row, enrollment, provider call, or false-success audit event.

### 4. Fail closed on reply and arbitration uncertainty

- Replace ad hoc audit-log reply checks with one canonical read-side decision over communication-event evidence.
- Check before step zero and every later automated touch.
- Recheck immediately before provider I/O and immediately before terminal no-response completion.
- `REPLIED` stops incompatible future touches.
- `CONFIRMED_ABSENT` may proceed only through all normal outbound gates.
- `UNAVAILABLE`, timeout, partial disagreement, lookup error, or arbitration error must durably defer the same step with a redacted reason and zero provider I/O.
- Use conditional expected-state/step claims or an equivalent fence so a concurrent inbound reply/pause cannot lose to a stale worker.
- Retry must be idempotent and must not consume or skip the deferred step.

### 5. Make sequence completion truthful

- Centralize all exhausted/final-step branches under one idempotent terminal-outcome owner.
- No-response exhaustion must never set `ENGAGED`, create reply/engagement/score credit, or count as a conversion.
- Positive engagement remains available only from canonical evidence such as a human reply, booked meeting, received statement, or explicit authorized manual event.
- Persist a structured, queryable terminal reason. First inventory all readers of sequence completion.
- Reuse a validated server-owned metadata contract only if every directly affected API, UI, scoring, and reporting reader can query and distinguish it reliably. Otherwise add the next additive constrained migration. Do not use `db push`, edit historical SQL, or backfill production.
- Replace any directly affected metric labeled or consumed as “conversion” when it merely counts completed or enrolled records.

### 6. Make promotional seed behavior inert and idempotent

- New promotional email/SMS seed content must default to paused/draft and must never activate at startup.
- Clean, repeated, and concurrent startup must not create duplicate catalogs, active promotional content, or repeated steps.
- Do not hydrate an existing active zero-step/stub sequence with promotional steps.
- Do not rewrite, reactivate, delete, or bulk-remediate existing production seed rows in this task.
- Preserve SMS as non-launchable; no SMS provider call or registration claim is authorized.

## Authorization matrix for this task

| Action | Anonymous | Agent | Manager | Admin | Internal worker |
|---|---:|---:|---:|---:|---:|
| Read permitted campaign data | No | No unless current employee read policy explicitly permits it | Yes | Yes | Task-scoped |
| Create/edit draft campaign | No | No | Yes, strict draft fields only | Yes | No |
| Mutate draft steps | No | No | Yes after parent authorization | Yes after parent authorization | No |
| Create audience preview | No | No | Yes for draft review | Yes | Task-scoped |
| Queue frozen audience | No | No | No until explicit launch-approval policy exists | Only under existing policy; launch remains held | Approved command only |
| Process global send queue | No | No | No | No direct HTTP execution | Registered worker only |
| Activate seed content | No | No | No | Explicit later audited action, never boot-time | Never at startup |
| Invoke provider transport | No | No | No | No | Only after every canonical gate |

If current policy is stricter, preserve the stricter policy. Do not loosen authorization to match this table.

## Concurrency and side-effect order

For a campaign attempt:

1. Resolve the frozen campaign member, campaign revision, canonical contact, channel, sender, and provider.
2. Confirm worker/command authority.
3. Read classification, qualification currently required by the path, contactability, suppression, validation, pause epoch, coordinator hold, and sender state.
4. Atomically claim the existing message/send reservation.
5. Perform a final uncached reply/arbitration and pause/epoch recheck.
6. Render one body, one signature, one compliance treatment, and one header set.
7. Invoke only a fake/denied provider during tests.
8. Persist a deterministic outcome and privacy-safe evidence.

PostgreSQL and providers are not atomic. Preserve existing uncertain-outcome/reconciliation state; do not claim exactly-once delivery merely because duplicate workers are reserved.

For sequence completion:

1. Claim the expected enrollment state and step.
2. Recheck canonical reply evidence.
3. If unavailable, defer without consuming the step.
4. If replied, stop incompatible automation.
5. If confirmed absent and exhausted, persist one no-response terminal outcome without engagement credit.

## Explicitly preserved for later work

Task 1698 must not implement, delete, weaken, or silently mark complete any of the following.

### Campaign lifecycle and final customer preview

- Permanently delete only campaigns proven to be unsent drafts with no queue, activation, send, consent, unsubscribe, or audit history.
- Archive every campaign with operational history; archived campaigns cannot queue, send, retry, recover, or reactivate.
- Provide explicit archived filters without erasing history.
- Isolate campaign integration tests so failures/concurrency cannot leave operator-visible records.
- Use the same server renderer for preview and delivery.
- Render complete sandboxed sample HTML with personalization, signature, logo, mailing address, compliance treatment, and unsubscribe treatment.
- Clearly disclose sample values and create no send, provider mutation, or live unsubscribe action.
- Convert plain-text templates into safe readable HTML without trusting unsafe markup, while preserving an authoritative plain-text part.

### Launch approval, delivery controls, and provider feedback

- Immutable campaign approval revisions freezing content, audience, sender, transport, caps, and expiry; material edits invalidate approval.
- Atomic distributed sender, campaign, provider, minute, hour, day, and canary reservations.
- Provider idempotency where supported and reconciliation for timeout-after-acceptance.
- Signed, replay-safe, out-of-order-safe bounce, complaint, rejection, and unsubscribe handling projected into canonical reachability/suppression and active-enrollment stop behavior.

### CRM, enrichment, and revenue preparation

- Reconcile the separate contacts, prospects, Lead Ops/discovery, company, and deal populations into one canonical promotion/linkage process.
- Classify and quarantine test/demo/unknown records using the existing canonical classification owner, not filename or name-prefix heuristics.
- Build a durable, restart-safe, budget-aware enrichment waterfall with provenance, field confidence, freshness, dedupe disposition, decision-maker evidence, and email validation.
- Make Ready for Outreach a channel-specific, versioned qualification decision rather than a permissive contact-data count.
- Rank ICP cohorts, human-review a small audience, build approved premium copy, reconcile selected recipients to GHL, and measure statements, proposals, applications, activated merchants, and processor-confirmed revenue.

### Dashboard, task, operations, runtime, and launch proof

- Repair dashboard null-format crashes and the Pipeline API/load failure with safe correlation and retry UX.
- Make CRM tasks active-by-default, human-readable, deduplicated, related-record navigable, and safely archive reviewed automation junk.
- Inventory every queue, scheduler, crawler, interval, durable command, retry, recovery worker, provider, and owner; expose complete failures rather than sampled health.
- Run stateful/server/browser certification only with disposable PostgreSQL, an isolated unique Redis namespace, provider denial/fakes, and no inherited production credentials.
- Deploy and verify one exact certified SHA across web and workers.
- Perform a zero-provider dry run, then only after separate written authorization run a tiny real-email canary with a reviewed audience, verified sender, caps, stop thresholds, monitoring owner, rollback, and attribution.

These preserved requirements are written here because no external CR/CRO/OR audit is assumed available. Do not replace this list with an opaque task label.

## Required Task 1698 tests

- Every reachable campaign SMTP branch passes the expected canonical contact ID to fake SMTP exactly once.
- Missing/unknown/test/demo/unclassified recipient matrices invoke zero transport.
- Nested campaign and sequence rendering yields one validated address block, one opt-out treatment, and one unsubscribe header set.
- Missing or mismatched compliance configuration fails closed.
- No implicit signature promo appears without explicit input.
- Role and ownership tests cover read, create, update, step mutation, preview, queue, and global processing; request bodies cannot spoof actor/server-owned fields.
- The global processor is unreachable to human dashboard roles.
- Reply tests cover step zero, later steps, timeout/error, immediate pre-I/O race, completion race, retry, and zero-I/O defer.
- Arbitration errors fail closed with zero transport.
- Both terminal branches produce one no-response outcome and no lifecycle/score/conversion credit.
- Directly affected reporting/UI reads distinguish no-response from positive engagement.
- Sequential and concurrent seed startup create no active promotional email/SMS content, no duplicate records/steps, and no active-stub hydration.
- Existing frozen-preview, contactability, validation, pause, coordinator, sender-policy, send-log, webhook, and enrollment regressions remain green.

Use temporary safe fixtures, disposable PostgreSQL, a unique isolated Redis namespace, test mode, provider-denied child environments, and fake transports. A skipped stateful assertion is not a pass.

## Kill lines

- Fail if any campaign SMTP branch reaches transport without the correct canonical contact identity.
- Fail if a marketing message can contain duplicate or mismatched compliance treatment.
- Fail if the sole renderer can use a mailing address different from readiness authority.
- Fail if implicit signature defaults add unapproved promotional claims.
- Fail if a non-authorized role can mutate campaign state or spoof actor/server fields.
- Fail if a human dashboard role can invoke the global provider-capable processor.
- Fail if reply/arbitration uncertainty can continue to transport.
- Fail if a reply can race an early check and a stale worker can still send or record no-response completion.
- Fail if no-response completion creates engagement, score, reply, or conversion credit.
- Fail if concurrent startup or active-stub hydration creates active promotional email/SMS content.
- Stop if a paid/real provider is called, a real recipient is enrolled/contacted, production data is changed, a campaign/sequence is activated, a hold/pause is changed, or a deployment/merge is performed without separate authority.
- Stop if historical migrations are edited, `db push` is used, protected tests are skipped/weakened, or production/shared data substitutes for isolated fixtures.
- Stop if an unknown CR/CRO/CAR/OR/Authority-G label is used as a substitute for an actual requirement.

## Required final response

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- Starting and ending branch, SHA, working tree, and migration head.
- Preflight VFC table showing each old claim as confirmed, partial, false, or outdated with current `file:line` evidence.
- Verified root cause and any corrected owners/call paths.
- Implementation by `file:line`.
- Commands and PASS/FAIL results for targeted, static, isolated stateful, and server-required gates actually run.
- Post-build searches proving no task-owned bypass remains.
- Diff review proving only task-owned files changed and no secret, PII, generated junk, lockfile drift, or production configuration mutation entered the diff.
- Final VFC mapping every Task 1698 requirement and kill line to evidence and a test/gate.
- A plain-language preservation table for every deferred requirement listed above; do not cite an unexplained roadmap label.
- Clear separation between code/test proof and still-pending deployment, provider, production-data, or real-canary proof.
- **Final status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME/LAUNCH VERIFICATION PENDING, or DO NOT MERGE.

Do not call local, mocked, disposable, sampled, stale, or different-SHA evidence production verification.
