# MASTER REPLIT TASK — CR-06 PREMIUM CAMPAIGNS, SEQUENCES & SENDER/PROVIDER READINESS

**Task type:** mandatory preflight + implementation + isolated verification  
**Planning baseline inspected:** `bd36d65dfa635b0efd20e8c3f702754bdf66f71e`  
**Planning migration head:** `0177_cro03_source_staging_evidence`  
**Planning CI manifest:** 82 classified suites  
**Execution order:** after CR-04 and CR-05 merge or equivalent behavior is proven  
**Preflight verdict at the inspected baseline:** **NOT BUILD-READY UNTIL CR-04/CR-05; THEN BUILD-READY WITH CONTROLLING CORRECTIONS**

## 1. Controlling instruction

Implement CR-06 as one complete campaign/sequence/readiness build. Start from clean current `main` after CR-04 and CR-05. Recapture the live repository and supersede stale line numbers or counts with evidence.

Do not split campaign lifecycle, deletion/archive safety, test isolation, preview/delivery rendering parity, sender/reply authority, preflight, attribution, or content-version requirements into new cleanup tasks. They are the work.

This is not the controlled live pilot. CR-07 owns any production cohort approval, pause release, activation, canary, or send. CR-06 must finish with campaigns/sequences/provider transport still inactive.

## 2. Objective

Turn the existing campaign and sequence catalog into a governed, versioned, testable preparation system that can answer:

- what is a template, test, draft, review-ready version, approved-but-inactive program, paused legacy program, retired history, or invalid artifact;
- which CR-04 frozen cohort and policy version it would use;
- exactly what each recipient would receive after safe rendering;
- which sender/reply route/channel/provider configuration would apply;
- whether every suppression, validation, duplicate, cap, mapping, reply, and attribution prerequisite passes;
- and why the program remains blocked from activation.

No green CR-06 result authorizes a live send.

## 3. Immutable safety boundary

CR-06 may create/edit task-owned code, additive schema, draft/template configuration, and disposable test fixtures. It must not:

- activate a campaign, sequence, provider, budget, sender, GHL workflow, or queue;
- lift global/channel pauses or change `HUMAN_SEQUENCE_DISPATCH_DISABLED`/equivalent denial to permit execution;
- send test or production email/SMS/voice/voicemail, even to an internal address, during build certification;
- run live Apollo, Outscraper, Serper, ZeroBounce, GHL, Gmail, SMTP, or SMS probes;
- generate/freeze a production cohort, enroll production contacts, or run a production cleanup;
- permanently delete any history-bearing production campaign/sequence;
- import, edit, or infer production campaign outcomes;
- deploy or run the CR-07 controlled pilot.

## 4. Required baseline recapture

Record before editing:

1. current branch/HEAD/`origin/main`/merge-base/worktree and recent merges;
2. CR-04 and CR-05 final VFC evidence;
3. migration head/integrity and CI manifest/capabilities;
4. every campaign, sequence, step, enrollment, preview, queue, message, communication-event, sender-profile, readiness, mapping, reply, and analytics table/service/route/UI;
5. every renderer/interpolator/signature/footer/unsubscribe implementation;
6. every create/update/toggle/delete/archive/queue/enroll/recover/send route and worker;
7. current compile-time/runtime pause and provider denial defaults;
8. current sender/reply identity sources and discrepancies;
9. current GHL mapping/probe/attestation paths;
10. overlapping work and all current task-owned tests.

Stop if CR-04/CR-05 are missing or if live code permits provider/campaign execution contrary to the boundary.

## 5. Prerequisites and preserved authorities

Preserve:

- CRO-02 class/provenance/identity/quarantine and CRO-03 provider/evidence/economics controls;
- CR-04 channel decisions, qualification policies, immutable cohorts, and promotional enrollment fence;
- CR-05 canonical outcomes/operator/reporting/task contracts;
- contactability, consent/suppression, provider-readiness/validation, sender policy, pause/coordinator, sequence eligibility, and communication-event authorities;
- durable campaign preview members and queue run/item ownership;
- send-time removal-only rechecks and duplicate/idempotency controls.

CR-06 governs campaign/sequence/content/sender readiness; it does not own classification, enrichment, CRM objects, or live activation.

## 6. Verified current-state findings

| ID | Finding at `bd36d65…` | Evidence | Required disposition |
|---|---|---|---|
| VFC-P01 | Campaign lifecycle is only draft/active/paused/completed/archived; it does not distinguish template/test/review/invalid. | `shared/schema.ts:1565-1595` | Add governed lifecycle/version semantics. |
| VFC-P02 | Sequences use free-text status with paused default and active legacy rows. | `shared/schema.ts:1925-1940` | Add strict governed lifecycle/compatibility adapter. |
| VFC-P03 | Sequence delete permits paused/draft hard deletion without proving absence of enrollment/send/audit history. | `server/routes/campaigns.ts:535-549`; `server/storage/automation.ts:173-178` | Prove unsent/no-history or retire/archive. |
| VFC-P04 | Campaign steps are editable only in draft, but no complete campaign archive/delete/version approval workflow exists. | `server/routes/campaigns.ts:113-217` | Add immutable version/retirement workflow. |
| VFC-P05 | HTTP queue, sequence activation, human enrollment, bulk enrollment, and provider test-send are denied. | `server/routes/campaigns.ts:251-253,475-489,860-862,1320-1322,1696-1699` | Preserve all denials through CR-06. |
| VFC-P06 | Durable campaign preview/frozen membership/queue run structures exist. | `shared/schema.ts:1631-1794`; `campaign-engine.ts:726-1007` | Adapt to CR-04 cohort/version authority; do not replace. |
| VFC-P07 | Legacy prospect campaign queue/send remains beside contact-mode flow. | `server/services/campaign-engine.ts:221-313,1050-1290` | Retire/hard-disable for future promotional execution. |
| VFC-P08 | Rendering is duplicated across sequence worker, integrations, SDR, vertical-template helper, and campaign paths. | repository renderer census; `sequence-worker.ts:1271+`; `vertical-email-sms-templates.ts:752+` | One safe renderer for preview and delivery. |
| VFC-P09 | Current helper removes unresolved placeholders with a warning, while other paths interpolate different token names. | `vertical-email-sms-templates.ts:752-769` | Unresolved required fields block approval; controlled fallbacks are explicit. |
| VFC-P10 | Sender policy has static approved identities while DB sender profiles, inbox rotation, readiness probes, and UI expose additional state. | `sender-policy.ts`; `admin.ts`; `sdr/inbox-rotation.ts`; `OutboundReadiness.tsx` | Reconcile one authoritative readiness view. |
| VFC-P11 | Outbound Readiness can write attestations/toggles and describes live probes. | `client/src/pages/dashboard/OutboundReadiness.tsx` and related routes | Keep build proof synthetic/read-only; no live attestation or unpause. |
| VFC-P12 | Current campaign analytics include durable messages/events, but older counters/status proxies remain. | campaign engine/routes/reporting | Use durable receipt/outcome authority with source status. |
| VFC-P13 | Existing seed/template content includes unsupported savings claims and broad vertical copy. | `vertical-email-sms-templates.ts`; seed scripts | Quarantine legacy content from approved program versions. |
| VFC-P14 | The attached premium playbook is draft-only and specifies four email touches on Days 1/4/8/14. | `LIBERTY_BANCARD_PREMIUM_CAMPAIGN_SEQUENCE_PLAYBOOK_…md` | Use as controlling content draft; do not silently convert it to five touches. |

## 7. Mandatory preflight searches

Inventory and classify:

- campaign/sequence/step/enrollment statuses and every status comparison;
- all create/update/toggle/delete/archive/restore/queue/enroll/retry/recover/send paths;
- all test/demo/seed/backfill campaigns and sequences, zero-step definitions, anomalous enrollments, and fixtures;
- every renderer/interpolator/markdown/HTML sanitizer, signature, logo, address, footer, opt-out, and unsubscribe injector;
- merge-field token vocabularies and fallback behavior;
- sender-policy registry, DB sender profiles, sending identities, inbox rotation, Gmail/GHL/SMTP configuration, reply routes, health/readiness UI and probes;
- campaign preview criteria/hash/members, CR-04 cohort references, queue runs/items, send-time gates;
- GHL pipeline/workflow mapping, inbound reply ingestion, bounce/unsubscribe/complaint handling, and attribution;
- campaign/sequence UI actions and misleading controls;
- all counters/analytics and whether they originate from durable receipts/events;
- content claims, savings percentages, fake familiarity, processor assumptions, unretained facts, and unresolved variables.

Produce a catalog with lifecycle, owner, step count, history facts, deletability, execution eligibility, content risk, sender/reply readiness, and CR-06 disposition. The build must not run that catalog against production unless separately authorized; use source/config and disposable fixtures.

## 8. Verified root causes

1. Campaigns and sequences evolved as execution objects before a strict governance/version lifecycle existed.
2. Safety was added at queue/send boundaries, but preview UI, content editing, sender configuration, and deletion still use different contracts.
3. Several renderers interpret different merge tokens and compliance blocks, so visual preview cannot prove delivery parity.
4. Sender identity is split among static policy, DB profiles, sending identities, OAuth/GHL probes, attestations, and channel toggles.
5. Legacy vertical content and live-history objects coexist with tests/drafts, making status labels insufficient evidence of safety.

## 9. Campaign versus sequence ownership

Enforce:

| Object | Owns |
|---|---|
| Campaign | business objective, ICP/offer, CR-04 cohort definition/version, budget/cap policy, owner, measurement plan, lifecycle, approved content bundle |
| Sequence | ordered channel actions, delays, stop rules, template references, family/lifecycle compatibility |
| Content version | immutable subject/body/text/HTML, merge-field schema, evidence slots, compliance block version, reviewer/approval |
| CR-04 cohort | exact qualified members and evidence/policy fingerprints |
| Enrollment authority | idempotent compatibility/permission fence |
| Sender readiness | approved identity/reply route/domain/channel/provider evidence |
| Delivery | CR-07 activation plus current send-time removal/block |

Do not duplicate campaign audience rules in sequences or cadence/content in campaign filters.

## 10. Governed lifecycle contract

Add a strict versioned lifecycle, adapting legacy values without erasing history:

- `template`: reusable, never executable;
- `test`: disposable/synthetic only, never production-visible/executable;
- `draft`: editable, unapproved, never executable;
- `review_ready`: immutable candidate awaiting approval, never executable;
- `approved_inactive`: approved exact version but still blocked from execution until CR-07;
- `paused_legacy`: historical active/paused object retained and non-executable;
- `retired`: history retained, permanently non-executable;
- `invalid`: quarantined due to malformed/unsafe/conflicting state;
- historical `completed`/`archived` mapped to retained non-executable compatibility states.

Do not create a newly executable `active` transition in CR-06. Any legacy active row must remain paused/denied and be classified without production mutation unless separately approved.

## 11. Version and approval contract

An approval candidate must freeze:

- campaign and sequence definition versions;
- exact ordered step/content versions and renderer version;
- merge-field schema and fallback policy;
- CR-04 policy/cohort definition reference (no production member freeze here);
- ICP/offer/objective/measurement versions;
- sender/reply/domain/channel/provider readiness references;
- caps, quiet hours, stop rules, and duplicate/contact-window policy;
- GHL/reply/attribution mapping versions;
- reviewer, reviewedAt, approval disposition, dependency fingerprint, expiry.

Any material change creates a new draft version and invalidates prior preflight approval. Approved versions are immutable.

## 12. Delete, archive, and retirement contract

Permanent deletion is admin-only and allowed only when a transactionally verified object is:

- `draft` or `test`;
- synthetic/disposable where applicable;
- never approved/activated;
- has zero cohort/preview/member/queue/enrollment/message/receipt/reply/bounce/unsubscribe/suppression/compliance/retry/recovery/audit history;
- has no dependent steps except those deleted in the same transaction;
- and passes an exact database no-history predicate immediately before deletion.

Otherwise retire/archive it and preserve history. Retired/invalid/history-bearing objects cannot queue, enroll, retry, recover, or send. Recovery workers and caches must recheck lifecycle.

## 13. Test isolation contract

Campaign/sequence tests must use:

- disposable `record_class=test` contacts/businesses/deals;
- dedicated test campaign/sequence/content IDs and isolated Redis namespace;
- fake transports that fail the suite on any network attempt;
- deterministic sample addresses/domains reserved for testing;
- cleanup after success, failure, timeout, crash, and concurrency;
- a final leak scan proving no fixture appears in production lists, Ready cohorts, Reporting, tasks, enrollments, or operator views.

Do not use production contacts or internal real inboxes merely because a “test send” is requested. CR-06 preview is zero-send.

## 14. Single renderer contract

Build one server renderer used by:

- campaign/sequence preview;
- approval preflight;
- stored delivery intent;
- future CR-07 delivery.

It must produce canonical plain text and safe HTML from the same input; escape untrusted values; prohibit unsafe markup/scripts/URLs; normalize line breaks; render signature, logo if approved, physical mailing address, compliance text, and unsubscribe treatment exactly once; produce deterministic hashes; and return structured warnings/blockers.

Required merge fields without retained evidence block approval. Optional fields use explicit reviewed fallbacks. Never silently remove unresolved tokens or invent values. Preview must disclose synthetic sample values and be sandboxed with no links/actions that mutate state.

## 15. Evidence-based personalization contract

Allowed personalization must point to current retained evidence. Initial approved slots are limited to:

- first name, company name, city;
- verified service/operational signal;
- decision role;
- assigned rep first name;
- approved calendar/secure upload link.

Never assert observed research, processor, rates, fees, volume, savings, pain, review count, location count, or operational behavior without current evidence and approved wording. CR-06 content must avoid fake familiarity and guaranteed outcomes.

## 16. Premium content family

The attached **Liberty Bancard Premium Campaign and Sequence Playbook v1.0 draft** is the controlling draft source. It specifies four email touches:

1. Day 1 — concise relevance + statement/payment-flow diagnostic offer;
2. Day 4 — one operational/workflow angle;
3. Day 8 — useful checklist/framework plus optional manual follow-up task;
4. Day 14 — respectful close-the-loop/permission message.

Do not silently implement the older five-touch wording from a prior roadmap. A fifth touch requires a separately versioned, explicitly approved content revision.

Prepare draft variants for the playbook’s three hypotheses—Florida owner-operated auto repair, med spa/dental, and home services/construction—without selecting a production winner, generating a production cohort, or activating any program. Emails are plain-text-forward, 60–120 words where applicable, one CTA, one signature, one compliance footer, and no automated SMS/voicemail/social sequence.

## 17. Sender and reply-route authority

Reconcile static `sender-policy.ts`, DB sender profiles, sending identities/inbox rotation, OAuth/GHL/SMTP configuration, readiness probes/attestations, and UI into one read authority that reports:

- category, approved From/Reply-To/display name/signature;
- domain and identity configuration source;
- monitored reply ingestion route and owner;
- health/cap/warmup evidence source and freshness;
- provider/channel availability;
- attestation issuer/expiry where manual evidence is unavoidable;
- status: `verified`, `unverified`, `unavailable`, `expired`, `conflict`, or `blocked`;
- stable reason codes and `capturedAt`.

No source may override another silently. Conflicts block approval. CR-06 may use synthetic configuration tests and read-only source inspection; it may not perform live verification, write real attestations, connect OAuth, toggle channels, or unpause.

## 18. Provider and channel readiness

- Apollo/Outscraper/Serper/ZeroBounce enrichment readiness remains owned by CRO-03 and may be referenced, not activated.
- Final email validation remains a CR-04/send-time prerequisite.
- SMTP/Gmail/GHL email delivery remains disabled in build/test.
- SMS remains blocked until number/location ownership and A2P/TCR approval are current and separately authorized.
- Voice/voicemail/social are outside the initial premium email program.
- Credential presence never equals readiness.
- Provider or readiness outage is explicit `unavailable`, never pass/zero.

## 19. Campaign preflight contract

Create one deterministic preflight report for an approved-inactive version covering:

- lifecycle and immutable versions;
- CR-04 policy/cohort definition compatibility;
- sample rendering/text/HTML parity and content hash;
- merge fields/evidence/fallbacks;
- sender/reply/domain/channel/provider readiness;
- consent/suppression/DNC/complaint/bounce/current validation rules;
- duplicate/recent-contact/concurrent-enrollment and cap/quiet-hour policies;
- sequence step order/delays/stop-on-reply/bounce/unsubscribe/complaint/pause;
- GHL/reply ingestion and canonical contact/deal/campaign attribution mappings;
- receipt/event analytics readiness;
- global/channel pause and CR-07 activation denial;
- exact blockers, warnings, dependencies, `asOf`, expiry, fingerprint.

Preflight is read-only and zero-send.

## 20. GHL, reply, and attribution boundary

Use configuration-safe, isolated proof only:

- validate local mapping schemas and referential integrity;
- use fake GHL payloads/IDs and denied transport;
- prove inbound reply/bounce/unsubscribe/complaint maps to canonical contact, deal, campaign, sequence step/content version, sender, and communication event;
- prove suppression/stop rules terminalize future work;
- prove unknown/mismatched IDs become explicit reconciliation buckets;
- never mutate live GHL, create workflows, fetch live stages, or process real replies in CR-06.

## 21. Analytics contract

Report outcomes only from durable receipts/communication events and canonical CR-05 outcomes:

- attempted/queued/sending/sent/delivered/bounced/unsubscribed/complained/replied;
- positive/negative/stop/unknown reply disposition where durably classified;
- statements, meetings, proposals, applications, wins, activated MIDs;
- exact campaign/sequence/content/sender/cohort/policy versions;
- provider/campaign cost only when backed by ledger evidence;
- source status, scope, `asOf`, and reconciliation buckets.

Never optimize on opens alone, label `converted` as reply without contract, or invent targets/outcomes.

## 22. UI contract

In the consolidated Outbound Center:

- separate Templates, Tests, Drafts, Review Ready, Approved Inactive, Paused Legacy, Retired, and Invalid;
- show authoritative counts, lifecycle reasons, owner, version, step count, history/deletability, sender/reply readiness, preflight status, and CR-04 compatibility;
- hide/disable queue/enroll/activate/test-send actions with truthful reasons;
- use the single sandboxed renderer for previews;
- show unresolved variables, unsafe claims, sender conflicts, missing mappings, and attribution blockers;
- preserve deep links, URL-backed tabs/filters, refresh, back/forward, loading/empty/partial/error/forbidden states;
- never imply that “approved inactive” is live.

## 23. Authorization and governance

Test anonymous, merchant, Agent A, Agent B, manager, and admin:

- agents do not administer campaigns/sequences/senders;
- managers may view/edit only currently authorized owned draft objects; they cannot approve, delete history, alter global sender/pause/provider readiness, or activate;
- admins may govern lifecycle/version/retirement and approve inactive versions, but still cannot activate in CR-06;
- deletion requires admin + CSRF + exact no-history recheck;
- all substituted campaign/sequence/preview/content/sender IDs fail safely;
- aggregate counts do not leak another manager’s owned objects;
- test/preview content is redacted from logs and audit summaries.

## 24. Concurrency, replay, and recovery

Prove:

- concurrent version creation yields one deterministic version/fingerprint or safe conflicts;
- approval is compare-and-set against the reviewed dependency fingerprint;
- concurrent delete/history creation cannot erase an object that gained history;
- retire/cancel fences queue/recovery workers;
- renderer output is deterministic for fixed inputs;
- repeated preflight reuses or supersedes correctly and expires on dependency change;
- duplicate preview/queue/enrollment cannot occur from replay;
- reply/bounce/unsubscribe terminalization wins races with future-step scheduling;
- crash/restart cannot make test data production-visible or make retired content executable.

Use database constraints/transactions/claims, not process-local state.

## 25. Scope and file-ownership fence

Expected task-owned areas:

- campaign/sequence/content lifecycle/version schema and services;
- campaign/sequence routes and storage safety;
- one renderer and preview/preflight service;
- sender/reply readiness read authority/adapters;
- Outbound Center/Campaigns/Sequences/Readiness UI compatibility;
- GHL/reply/attribution fake adapters and analytics adapters;
- focused tests/CI registration;
- draft premium content versions where repository conventions support them.

Do not modify CR-04 qualification semantics or CR-05 revenue/task/operator definitions except through narrow adapters. Do not implement CR-07 activation or live pilot execution.

## 26. Priority register

### P0 — must close

1. CR-04/CR-05 prerequisite proof.
2. Strict governed lifecycle/version and no-new-active transition.
3. History-safe deletion/retirement and recovery denial.
4. Disposable test isolation/leak cleanup.
5. One renderer with preview/delivery parity and fail-closed merge fields.
6. CR-04 cohort/version integration.
7. Sender/reply readiness reconciliation and conflict blocking.
8. Deterministic zero-send campaign preflight.
9. Legacy prospect promotional execution retired/hard-disabled.
10. Role/CSRF/IDOR and concurrency proof.

### P1 — required for complete acceptance

1. Premium four-touch content drafts and evidence-safe personalization.
2. GHL/reply/attribution isolated mappings.
3. Durable receipt/outcome analytics.
4. Lifecycle-aware UI and truthful disabled controls.
5. Anomalous enrollment/test/zero-step reconciliation buckets.
6. Current pause/provider-denial preservation scans.

### P2 — bounded hardening

1. Content linting/readability/accessibility polish.
2. Lifecycle catalog export for operator review.
3. Query/index improvements justified by isolated scale fixtures.

## 27. Preflight verdict

At the planning baseline, CR-06 is **NOT BUILD-READY UNTIL CR-04 AND CR-05 MERGE**. After both prerequisites pass on current `main`, it is **BUILD-READY WITH CONTROLLING CORRECTIONS**. Do not use this task to bypass the sequence or fold CR-07 into the build.

## 28. Corrected build plan

1. Recapture post-CR-05 main and build the live catalog/renderer/sender/route matrices.
2. Freeze lifecycle, version, deletion, renderer, sender, preflight, and attribution contracts.
3. Add additive schema/constraints and legacy compatibility mappings.
4. Implement immutable versioning, approval-inactive, retirement, and no-history deletion.
5. Isolate tests and quarantine unsafe/test/zero-step content from operator views.
6. Implement the single renderer and sandbox preview.
7. Reconcile sender/reply/provider/channel readiness.
8. Integrate CR-04 cohort references and removal-only execution prerequisites.
9. Implement deterministic preflight, fake GHL/reply attribution, and receipt analytics.
10. Add the four-touch premium draft variants without activation.
11. Update Outbound Center lifecycle/readiness UI.
12. Run isolated DB/Redis/HTTP/jsdom/concurrency/gate/search/diff verification.

## 29. Done looks like

- Templates/tests/drafts/review/approved-inactive/legacy/retired/invalid are explicit and non-overlapping.
- No new campaign or sequence can become active in CR-06.
- Only provably unsent/no-history disposable drafts can be permanently deleted.
- History-bearing/retired/invalid objects cannot queue, enroll, retry, recover, or send.
- Tests cannot leak into production views or retain fixtures after failure/concurrency.
- Preview and future delivery use one deterministic safe renderer.
- Unresolved required variables and unsupported claims block approval.
- CR-04 exact policy/cohort/content/sender versions are frozen in preflight.
- Sender/reply readiness is one authoritative conflict-aware view.
- Premium draft follows the attached four-touch playbook, with no invented facts or live winner selection.
- GHL/reply/attribution is proven with fakes and denied transport.
- Analytics uses durable receipts/events and canonical CR-05 outcomes.
- All providers, campaigns, sequences, pauses, GHL, and outreach remain inactive.

## 30. Kill lines

Return `DO NOT MERGE` if:

- CR-04/CR-05 are absent or bypassed;
- any new HTTP/service path can activate, enroll, queue, test-send, unpause, or call a provider;
- history-bearing objects can be hard-deleted;
- retired/invalid objects can execute or recover;
- preview and delivery use different renderers/compliance blocks;
- unresolved variables are silently removed or unsafe HTML is trusted;
- unsupported savings/familiarity/processor/pain claims enter approved content;
- sender/reply conflicts are ignored or credential presence becomes readiness;
- SMS becomes ready without A2P/TCR/number/location evidence;
- test data leaks into production/Ready/Reporting/operator views;
- live GHL/provider/email/SMS/voice or production cohort mutation occurs;
- CR-07 controlled pilot scope is implemented;
- migration history is edited, `db push` is used, or a production cleanup/backfill runs;
- task-owned disposable integration gates are skipped.

## 31. Implementation rules

- Add migrations only at the live head; preserve full journal/bootstrap integrity.
- Use strict enums/checks/constraints and immutable version rows rather than status convention alone.
- Use parameterized queries, current role/object helpers, claims, transactions, and redacted logs.
- Keep content/evidence hashes deterministic and versioned.
- Do not store secrets, raw provider payloads, real email/phone content, or unredacted previews in logs.
- Use the current single-tenant role model.
- Preserve all compile-time/runtime transport denial and pause defaults.
- Treat external/runtime verification as separate from isolated build proof.

## 32. Test requirements

Use non-empty disposable fixtures covering:

- every lifecycle transition, invalid transition, approval expiry, and legacy mapping;
- unsent no-history deletion, every history blocker, concurrent history/delete race, retirement/recovery denial;
- zero-step/test/invalid/anomalous enrollment catalog buckets;
- renderer text/HTML parity, escaping, URLs, line breaks, signature/logo/address/footer/unsubscribe exactly once;
- every allowed field, required missing field, fallback, unresolved token, unsafe HTML, unsupported claim;
- premium playbook four-touch order/delays/stop rules and three draft hypotheses;
- CR-04 cohort/policy/content/sender dependency fingerprint and invalidation;
- sender registry/profile/identity/probe conflicts, stale/expired/unavailable states;
- email/SMS/provider channel blockers and credential-presence denial;
- fake GHL/reply/bounce/unsubscribe/complaint/attribution mapping;
- durable receipt analytics and source outage envelopes;
- replay/concurrency/crash/recovery/test cleanup;
- anonymous, merchant, Agent A/B, manager/admin, CSRF, substituted IDs;
- Outbound Center loading/empty/partial/error/forbidden/deep-link/back-forward/disabled-control states;
- fail-on-any-network transport hooks.

## 33. Smoke and integration plan

With disposable PostgreSQL, isolated Redis, and fake/denied transports, prove:

`template → draft version → safe sample render → review-ready → approved-inactive → CR-04 cohort-definition compatibility → zero-send preflight → retired/blocked recovery`

Also prove fake reply/bounce/unsubscribe attribution to canonical contact/deal/campaign/step/content version without sending. Tests must leave no fixtures.

## 34. Required gates

Report exact command, exit code, and result:

- focused CR-06 lifecycle/deletion/renderer/sender/preflight static suites;
- focused disposable PostgreSQL/Redis concurrency/recovery/test-isolation suite;
- provider-denied HTTP role/CSRF suite;
- jsdom Outbound Center/preview contract suite;
- campaign preview/enforcement/sending guard, sequence eligibility/compliance/dedup/terminalization, sender policy, outbound readiness, contactability/consent/provider-readiness, CR-04, and CR-05 regression suites;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- deterministic-static, deterministic-integration, provider-denied server-required capabilities;
- route guard, API coverage, paid-provider/GHL/raw-transport/log/privacy scans;
- migration bootstrap/rerun and integrity;
- `npm run check`, `npm run build`, `git diff --check`.

Current CI provisions PostgreSQL 16 and Redis 7. Missing local infrastructure is not a COMPLETE waiver.

## 35. Post-build search verification

Prove:

- no new activation/enrollment/queue/test-send/unpause/provider path exists;
- `HUMAN_SEQUENCE_DISPATCH_DISABLED` or its stricter equivalent remains effective;
- all previews and delivery-intent creation call the shared renderer;
- unresolved placeholders are not silently erased;
- only the exact no-history service can hard-delete;
- retired/invalid/history objects are excluded from queue/recovery/send;
- legacy prospect promotional campaign execution is unreachable;
- sender/reply readiness has one authority and conflicts fail closed;
- SMS remains blocked;
- no real GHL/provider/SMTP/SMS/voice/network call, production cohort, cleanup, deployment, or outreach was added;
- CR-07 pilot logic did not leak in.

## 36. Diff review

Run status, stat, and full diff. Confirm only task-owned files changed; migration/schema/journal/tests agree; no secrets, PII, raw previews, provider payloads, production exports, generated artifacts, attached text, debug output, lockfile drift, or unrelated formatting entered the diff; and all new suites are correctly classified.

## 37. Final VFC table

| ID | Requirement | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | Governed non-executable lifecycle/version | schema/service | transition tests | PASS/FAIL |
| VFC-F02 | History-safe deletion/retirement | service/constraints | race/recovery tests | PASS/FAIL |
| VFC-F03 | Test isolation and leak-free cleanup | fixtures/scans | failure/concurrency | PASS/FAIL |
| VFC-F04 | One safe preview/delivery renderer | renderer/hash | parity/security | PASS/FAIL |
| VFC-F05 | Evidence-safe premium four-touch drafts | content versions | lint/render tests | PASS/FAIL |
| VFC-F06 | CR-04 cohort/version integration | refs/fingerprint | invalidation tests | PASS/FAIL |
| VFC-F07 | Authoritative sender/reply readiness | read service | conflict/outage tests | PASS/FAIL |
| VFC-F08 | Zero-send deterministic preflight | report/service | matrix tests | PASS/FAIL |
| VFC-F09 | Fake GHL/reply attribution and receipt analytics | adapters/events | integration | PASS/FAIL |
| VFC-F10 | No activation/external/production mutation | diff/search/log | denial gates | PASS/FAIL |

## 38. Final response format

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE;
- starting/ending SHA, branch, worktree, migration head, manifest count;
- exact CR-04/CR-05 prerequisite evidence;
- live catalog/root cause/preflight corrections;
- lifecycle/version/delete/renderer/sender/preflight/attribution contracts;
- implementation file/line evidence;
- isolated catalog/reconciliation buckets and synthetic fixture IDs only;
- every test/gate command, exit code, result;
- post-build/kill-line verification;
- explicit statement that no provider/campaign/sequence/pause/GHL/send was activated;
- CR-07 and external runtime prerequisites only as remaining risks;
- **FINAL STATUS:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE;
- branch/PR URL without merge/deploy unless explicitly authorized.

## 39. Liberty safety and practical merge standard

Block for realistic risk of accidental activation, unsafe deletion, test leakage, preview/delivery drift, fabricated personalization, unresolved variables, sender/reply conflict, duplicate enrollment/send, unattributed reply, false analytics, or external transport. Do not block a correct approved-inactive build merely because live sender attestations, production cohort selection, CR-07 canary, or production outcomes remain pending.

## 40. Relevant live files

- `shared/schema.ts`
- `server/routes/campaigns.ts`
- `server/services/campaign-engine.ts`
- `server/services/sequence-worker.ts`
- `server/services/sequence-eligibility.ts`
- `server/services/sequence-terminalization.ts`
- `server/services/sequence-enrollment-recovery.ts`
- `server/services/sequence-ab-authority.ts`
- `server/services/sender-policy.ts`
- `server/services/launch-readiness-full.ts`
- `server/services/vertical-email-sms-templates.ts`
- `server/services/seed-sequences.ts`
- `server/services/seed-vertical-campaigns.ts`
- `server/services/sdr/inbox-rotation.ts`
- `server/services/sdr/reply-intelligence.ts`
- `server/services/smtp-email.ts`
- `server/storage/automation.ts`
- `server/storage/campaigns.ts`
- `server/routes/admin.ts`
- `server/routes/gmail-oauth.ts`
- `server/routes/integrations.ts`
- `client/src/pages/dashboard/OutboundCenter.tsx`
- `client/src/pages/dashboard/Campaigns.tsx`
- `client/src/pages/dashboard/Sequences.tsx`
- `client/src/pages/dashboard/OutboundReadiness.tsx`
- `client/src/pages/dashboard/OutboundPreflight.tsx`
- `client/src/pages/dashboard/LaunchReadiness.tsx`
- `scripts/test-campaign-preview-enforcement.ts`
- `scripts/test-campaign-sending-guard.ts`
- `scripts/test-sequence-compliance.ts`
- `scripts/test-sequence-terminalization-race.ts`
- `scripts/test-sender-policy.ts`
- `scripts/test-outbound-readiness.ts`
- `scripts/ci-suite-manifest.ts`
- `.github/workflows/ci.yml`
- `migrations/meta/_journal.json`

