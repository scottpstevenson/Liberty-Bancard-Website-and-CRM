# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK

**CRO-04 — Channel-Qualified Cohort & Ready Authority**

**Primary findings:** `CAR-021`, `CAR-022`, `CAR-023`

## MODE

PREFLIGHT + BUILD

First verify this task against the exact current codebase. Implement only after CRO-02 and CRO-03 are merged or the current repository contains verified equivalent classification/provenance/identity and durable provider-evidence contracts. If prerequisites are present, continue directly through implementation, isolated tests, gates, grep verification, and diff review. If missing, finish the complete preflight/audit and stop only the blocked implementation portion.

Do not turn completeness, lead score, hot/warm/cold, phone presence, enrichment status, lifecycle stage, or a campaign filter into a substitute for channel eligibility. Do not weaken `evaluateContactability`, ZeroBounce currentness, classification quarantine, consent/suppression, sequence eligibility, frozen campaign membership, or send-time checks.

Extend existing owners. Build one versioned qualification/cohort decision authority consumed by Ready lists/counts, campaign preview/freeze, export/assignment, enrollment, and send-time enforcement. Queue membership and send-time authorization remain distinct: a frozen qualifying decision may admit a candidate, while current send-time enforcement may remove/block it and may never silently add a record outside the frozen cohort.

Complete the audit end to end even if a P0 or kill-line failure is found. Return the total P0/P1/P2 corrections and exact code evidence.

Required sequence:

Repository baseline → prerequisite VFC → surface/consumer inventory → targeted searches → verified root cause → decision-authority check → blast radius → data/auth/concurrency/external checks → P0/P1/P2 register → preflight verdict → corrected build plan → kill lines → implementation → isolated tests/gates → post-build searches → diff review → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Recapture:

- branch, HEAD, `origin/main`, ancestry, and commit subjects;
- status, staged/unstaged/untracked state, and unrelated work;
- origin/visibility/protection evidence available locally;
- migration SQL/journal head;
- CI workflow and suite capabilities;
- active qualification/readiness/contactability/campaign contract versions;
- exact prerequisite commits for CRO-02 and CRO-03.

Verified planning baseline on 2026-08-27:

- remote: `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git`;
- live `origin/main`: `2f463398029fdc5adcd992ac4f068f81a2dfe640`;
- Task 1699/CRO-01 is merged;
- CRO-02 and CRO-03 are not present on this baseline;
- migration head: `0165_outbound_send_claim_lease.sql` / journal index `169`, tag `0165_outbound_send_claim_lease`, `when=1794900000000`;
- clean detached inspection showed no diff or `git diff --check` output.

Independently recapture. Preserve unrelated work; never reset or clean another task’s changes.

## 2. PREREQUISITE CHECK

Required:

1. CRO-01 canonical revenue object/count contract.
2. CRO-02 commercial class, primary provenance, identity resolution, decision-maker relationship state, and quarantine.
3. CRO-03 durable provider observations, candidates/arbitration, current ZeroBounce evidence, and terminal/cost reconciliation.

**Current finding: NOT SATISFIED.** Only CRO-01 is merged on the planning baseline. Full preflight is allowed; implementation must wait. When the prerequisites merge, recapture their actual contracts rather than relying on this prompt’s anticipated names.

## 3. VERIFIED FROM CODE — PREFLIGHT

Recapture and update:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Ready for Outreach already represents one channel-qualified cohort | FALSE | The current predicate requires non-archived, phone **or** an acceptable email status, not-DNC, not-skipped, and no active/paused enrollment. It has no class, provenance, identity, decision-maker, current provider evidence, ICP/offer, owner/shared-pool, reply route, campaign/content version, policy version, or expiry. | `server/services/outreach-queue-membership.ts:1-20` |
| VFC-02 | Phone presence cannot admit an email-opted-out row to Ready | FALSE | The membership expression is `phone OR acceptable email`; a phone can satisfy membership even when email is opted out. That may be valid for manual-call candidacy but is false for `READY_EMAIL`. | `server/services/outreach-queue-membership.ts:9-14` |
| VFC-03 | Ready list, count, and assignee filter use one predicate | PARTIAL | List and count call the shared predicate; the assignees endpoint repeats the SQL manually and can drift. | `server/routes/outreach-queue.ts:63-65,97-136,147-189` |
| VFC-04 | Starting outreach uses the canonical sequence eligibility owner | FALSE | The start route duplicates archived/DNC/phone-or-email checks and directly inserts `sequence_enrollments`; it does not call `canEnrollContactInSequence` before enrollment. | `server/routes/outreach-queue.ts:195-230,233-309`; `server/services/sequence-eligibility.ts:26-115` |
| VFC-05 | Contact readiness is already campaign readiness | FALSE | `contact-readiness.ts` explicitly measures record completeness only and excludes consent, lifecycle, lead score, and behavioral signals. | `server/services/contact-readiness.ts:1-55` |
| VFC-06 | Campaign preview uses a complete qualification decision | FALSE | CRM preview filters target verticals and optional completeness threshold, then calls email contactability. It lacks one decision for class/provenance/identity/decision-maker/ICP-offer/ownership/reply/content-version inputs. | `server/services/campaign-engine.ts:558-704` |
| VFC-07 | Campaign criteria hash captures every material qualification input | FALSE | The hash includes verticals, target list, step content digest, readiness threshold, and readiness model version; it does not represent the full qualification policy/evidence generations. | `server/services/campaign-engine.ts:465-495` |
| VFC-08 | Frozen campaign members are already a reusable canonical cohort decision | PARTIAL | Preview members persist contact, email generation/token, eligibility decision, reason codes, and readiness version, and queueing rechecks current validation/contactability. They are campaign-preview-specific and not the shared Ready/export/assignment/enrollment authority. | `shared/schema.ts:1559-1578`; `server/services/campaign-engine.ts:742-767,885-948` |
| VFC-09 | All campaign audience paths use the same contact-mode authority | FALSE | A legacy prospect campaign path still filters prospect status/DNC/email/score and only calls contactability when a prospect has a linked contact. | `server/services/campaign-engine.ts:221-309` |
| VFC-10 | Sequence eligibility and contactability can be replaced by qualification | FALSE | `canEnrollContactInSequence` owns consent-tier/lifecycle/family enrollment checks; `evaluateContactability` remains the canonical current send permission gate. CRO-04 must compose them, not replace them. | `server/services/sequence-eligibility.ts:26-115`; `server/services/contactability.ts:308-313,627-702` |
| VFC-11 | Send-time queueing is unrestricted by current evidence | OUTDATED | Current frozen CRM campaign queueing detects subject-generation/token changes, checks current provider validation, and calls enforcement contactability before creating messages. Preserve this removal-only behavior. | `server/services/campaign-engine.ts:885-948` |
| VFC-12 | Ready and campaign records are proven clean in production | UNVERIFIED | Historical authenticated counts are observations, not current proof. No production query is authorized by this build prompt. | runtime boundary |

Inspect complete route/worker paths; grep hits alone are not proof.

## 4. REQUIRED SEARCH / GREP CHECKS

Inventory every selector and consumer of “ready,” “eligible,” “qualified,” “hot/warm/cold,” “readiness,” “outreach,” and “campaign audience,” including:

- `/api/outreach-queue` list/count/assignees/start/skip and all client surfaces;
- daily briefing and Ready badge/count consumers;
- `contact-readiness` and backfill/model-version logic;
- `contactability`, commercial classification, provider readiness, consent/suppression, DNC, channel status, lifecycle, ownership, identity, and decision-maker evidence;
- sequence eligibility, manual/bulk/automatic enrollment, sequence worker, and direct enrollment inserts/updates;
- campaign target scores, filter criteria, verticals, readiness threshold, preview, targeting hash, frozen members, queue runs/items, activation, send-time checks, and legacy prospect campaigns;
- export/download, assignment, list membership, CRM task producers, and any GHL projection using independent predicates;
- sender identity/reply-route readiness and content/campaign versions;
- qualification/readiness fields in contacts, prospects, SDR merchants/leads, and AI outputs;
- every UI-generated filter and every raw SQL builder;
- migrations, route guards, tests, CI manifest, and provider/outbound-deny controls.

Return a consumer-to-decision matrix with exact file/line evidence. Never print contact identities, message bodies, audience samples, or provider payloads.

## 5. VERIFIED ROOT CAUSE

| Original Assumption | Verified Reality | Required Correction |
|---|---|---|
| Ready is one boolean population | Readiness is being inferred from contact fields and page-specific gates | Create versioned channel-specific decisions with stable reasons |
| Phone OR email means outreach-ready | It only indicates some reachable-looking field | Separate `READY_MANUAL_CALL`, `READY_EMAIL`, and `READY_SMS` |
| Completeness score measures qualification | It explicitly measures record completeness only | Preserve it as one input, never the final decision |
| Campaign preview is the cohort authority | It is campaign-specific and uses partial criteria | Compile the same qualification policy and persist a reusable decision/cohort identity |
| Enrollment and send checks are consistent | Some sequence routes use shared eligibility; outreach queue start inserts directly | Route all enrollment through one orchestration authority |
| A frozen cohort should bypass current checks | Current contactability/provider evidence may change | Freeze admission; allow send-time recheck to remove/block only |

Root cause: multiple features evolved their own meanings of readiness. The platform has strong individual authorities—classification, completeness, identity, provider validation, contactability, sequence eligibility, frozen preview membership—but no single versioned composition that says which record is ready for which channel, offer, owner, campaign, content, and time.

## 6. SOURCE-OF-TRUTH / DECISION CHECK

Preserve these independent truths:

- **Commercial existence/class:** CRO-02.
- **Primary provenance and identity resolution:** CRO-02.
- **Provider observations/current email validation:** CRO-03 and current BT-10 owner.
- **Data completeness:** `contact-readiness.ts` only.
- **Consent/suppression/current send permission:** `contactability.ts` and its existing authorities.
- **Sequence-specific enrollment compatibility:** `sequence-eligibility.ts`.
- **Revenue object membership:** CRO-01.
- **Channel/campaign qualification composition:** new CRO-04 decision authority.
- **Frozen campaign audience:** membership derived from a versioned CRO-04 decision/cohort.
- **Current send authorization:** re-evaluated at send time; never frozen as permission forever.

The qualification authority must return a structured decision, not one score:

- subject/contact and canonical business IDs;
- channel (`email`, `manual_call`, `sms`);
- decision (`READY_EMAIL`, `READY_MANUAL_CALL`, `READY_SMS`, `BLOCKED`);
- stable reason codes and evidence references;
- class/provenance/identity/readiness/provider/contactability/ICP/offer/ownership/reply-route/content versions;
- subject mutation generations and high-water marks;
- policy/ruleset version;
- evaluated/valid-until timestamps;
- deterministic decision and cohort hashes.

## 7. QUALIFICATION POLICY

Do not collapse the following dimensions:

1. **Data completeness** — whether required fields exist and are structurally valid.
2. **Identity confidence** — whether person/business endpoints are resolved without an active collision.
3. **Commercial class/provenance** — production class plus a primary traceable source.
4. **ICP fit** — vertical, geography, size, processing indicators, or other versioned business criteria.
5. **Offer fit** — evidence that the selected Liberty offer/campaign is appropriate.
6. **Channel eligibility** — current email/SMS/manual-call permission and contact evidence.
7. **Campaign readiness** — ownership, monitored reply route, sender, content/template version, and campaign-specific constraints.
8. **Priority** — ordering after eligibility; never permission.

Minimum `READY_EMAIL` inputs:

- production class;
- primary provenance;
- resolved contact/business identity and no active merge/collision;
- decision-maker evidence or explicit reviewed role disposition;
- current valid winning email plus current positive validation generation/freshness;
- email-specific consent/suppression/contactability allowed;
- current completeness model after material mutations;
- ICP and offer fit under versioned policy;
- owner/shared-pool policy;
- monitored reply route and approved sender identity;
- campaign/content/template version when campaign-scoped;
- unexpired decision.

`READY_MANUAL_CALL` must have its own phone/identity/DNC/manual-policy rules and cannot imply email readiness. `READY_SMS` must require SMS-specific permission and phone evidence. A blocked result must retain all applicable stable reasons, not only the first failure.

## 8. BLAST RADIUS

### In scope

- One versioned qualification policy/decision service.
- Channel-specific Ready states and stable reason taxonomy.
- Deterministic policy/decision/cohort hashes, expiry, generations, and invalidation.
- Validated server-side cohort-definition compiler for approved UI filters.
- Ready list/count/assignees/badge/daily briefing backed by one decision authority.
- Campaign preview/frozen membership backed by the same authority.
- Export/assignment/enrollment consumers aligned to the same decision and scope.
- Outreach queue start routed through canonical enrollment orchestration/eligibility, with atomic idempotency.
- Send-time recheck preserved as current removal-only enforcement.
- Aggregate-only reconciliation proving identical population/count per policy/version/scope.
- Focused UI truthfulness: channel label, reasons, policy time/version, loading/empty/error/forbidden/pagination/refresh.

### Out of scope

- Production cohort generation, campaign activation, enrollment, export, assignment, send, provider call, deployment, or GHL mutation.
- Rebuilding CRO-02/CRO-03 authorities.
- Changing consent/suppression law/policy or weakening contactability.
- Redesigning campaigns, sequences, dashboard, or CRM navigation broadly.
- Campaign content/HTML improvements, task cleanup, Inbox/GHL repair, attribution, or pilot launch.
- Using qualification to auto-promote class, merge identity, or mutate canonical facts.

List exact expected and excluded files before editing.

## 9. DATA / SCHEMA CHECK

**Migration expected: YES, after prerequisite recapture.**

Current campaign-preview membership contains useful frozen fields but is not a reusable policy decision/cohort authority. Add the smallest additive model for policy versions, decisions, cohort definitions/runs/members, reason codes, evidence/generation references, expiry, and invalidation. Reuse current eligibility snapshots and frozen campaign member/queue structures where safe.

Do not preassign a migration number because CRO-02 and CRO-03 will advance the head. At execution time use the next valid unique journal entry.

No `db push`, migration-history edit, production migration, production backfill, or production cohort build. Bootstrap disposable PostgreSQL twice.

## 10. AUTHORIZATION CHECK

| Action | Agent | Manager | Admin | Operations/Compliance |
|---|---:|---:|---:|---:|
| View Ready list/count | Own/shared-pool policy | Team | Global | As authorized |
| View block reasons | Own objects only | Team aggregate/detail | Global | As authorized |
| Define policy/filter | No | Propose | Approve | Compliance/ops approval where required |
| Build dry-run cohort | Scoped only | Team | Global dry run | Approved purpose |
| Freeze campaign audience | No by default | As current campaign role | As current campaign role | Approved campaign |
| Assign/export/enroll | Existing object policy plus channel decision | Team scope | Admin scope | Separate production approval |
| Activate/send | No by this task | No by this task | No by local access alone | Separate explicit approval |

Authorization must be inside decision/list/count queries before aggregation. Client hiding is not authorization. Another agent’s records, counts, reasons, owner, or existence must not leak.

## 11. CONCURRENCY / IDEMPOTENCY / INVALIDATION CHECK

Verify:

- one policy version and canonical normalized filter definition;
- deterministic hashes independent of JSON key order, page size, and query ordering;
- one decision per subject/channel/policy/evidence generation/offer context;
- exact replay returns the same decision; divergent inputs yield a new hash/version;
- cohort build has snapshot high-water mark, claim/lease/fencing, terminal member dispositions, and exact totals;
- counts and rows use the same predicate/snapshot/role scope;
- mutation of class, provenance, identity, decision-maker, email/phone, validation, consent/suppression, readiness, ICP, offer, ownership, reply route, sender, campaign, or content invalidates or expires the affected decision;
- a frozen campaign cohort cannot add new members at queue/send time;
- current send-time checks can remove/block members and persist a reason;
- concurrent Ready-start/enrollment calls create one active enrollment and use canonical eligibility;
- stale/expired decisions fail closed with stable reason codes.

## 12. EXTERNAL SIDE-EFFECT CHECK

All proof is local and isolated. Tests must deny provider, GHL, SMTP/SMS/voice, campaign activation, enrollment worker, export delivery, deployment, and production database transports.

Do not claim a production cohort is clean, a sender/reply route is monitored, or production eligibility improved without authorized runtime evidence. Code/test proof establishes behavior only.

## 13. P0 / P1 / P2 CORRECTION REGISTER

### P0 — required before merge

- Do not implement until CRO-02/CRO-03 prerequisites are merged.
- Replace phone-or-email Ready semantics with explicit channel-specific decisions.
- Require class/provenance/identity/provider/contactability and other policy inputs; no score/status shortcut.
- Route outreach queue enrollment through the canonical sequence/enrollment authority.
- Make Ready list/count/assignees and campaign preview/freeze consume one decision contract.
- Preserve send-time current enforcement as removal-only; never add outside the frozen cohort.
- Apply role/object scope before counts and reasons.

### P1 — required for completion unless proven unrelated

- Add versioned policy/decision/cohort hashes, expiry, generation references, and invalidation.
- Compile approved UI filters into validated server definitions; reject unknown/raw predicates.
- Align daily briefing, badge, export, assignment, and enrollment consumers.
- Add aggregate reconciliation with stable reason buckets and one `asOf`.
- Add concurrency, replay, authorization, migration, browser-equivalent, and provider/outbound-denied tests.

### P2 — follow-up hardening

- Policy authoring UX, cohort comparison, reason drill-down, and review workflows beyond minimum truthfulness.
- Production cohort calibration and conversion-lift tuning after controlled pilots.
- Additional channel/offer policies after compliance and operational review.

## 14. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

**Current verdict: NOT BUILD-READY.** CRO-02 and CRO-03 are absent from live main. Finish preflight; do not implement. Once both are merged/equivalent, expected verdict is `BUILD-READY WITH CORRECTIONS` unless recapture changes the findings.

## 15. CORRECTED BUILD PLAN

1. Recapture baseline and prove CRO-01/02/03 prerequisites.
2. Inventory every readiness/eligibility/score/filter consumer and produce a decision matrix.
3. Define versioned channel qualification policy, reason taxonomy, evidence-generation inputs, and normalized filter grammar.
4. Add the smallest additive policy/decision/cohort schema and service.
5. Implement `READY_EMAIL`, `READY_MANUAL_CALL`, `READY_SMS`, and `BLOCKED` without collapsing dimensions.
6. Replace Ready list/count/assignees/badge/daily briefing selectors with the shared authority.
7. Compile campaign UI criteria to the same server decision and freeze exact members/versions.
8. Route start/export/assignment/enrollment through the decision plus existing object/sequence authorities.
9. Preserve queue/send-time current contactability/provider checks and persist removal reasons.
10. Add aggregate reconciliation and truthful UI states.
11. Add static, migration, integration, role, replay, concurrency, invalidation, browser-equivalent, and outbound-denied tests.
12. Run gates, searches, diff review, and final VFC.

## 16. DONE LOOKS LIKE

- Data completeness, identity confidence, commercial class/provenance, ICP fit, offer fit, channel eligibility, campaign readiness, and priority are distinct decisions/inputs.
- One versioned service returns channel-specific Ready/Blocked results with stable reasons and expiry.
- Phone presence never makes an opted-out or invalid email `READY_EMAIL`.
- Hot/warm/cold, enrichment status, and completeness score never substitute for channel permission.
- Ready list, count, assignees, badge, daily briefing, campaign preview/freeze, export, assignment, and enrollment use the same policy decision for the same scope/version.
- UI filters compile to validated server criteria and are included in the cohort hash.
- Every frozen cohort has deterministic membership, policy/evidence versions, snapshot boundary, exact totals, and reasons.
- Material mutations invalidate/expire affected decisions.
- Outreach queue start uses canonical sequence eligibility and idempotent enrollment.
- Send-time enforcement rechecks current state, may remove/block only, and records the reason.
- Role scope applies equally to rows, totals, details, reasons, and reconciliation.
- No production cohort, provider, GHL, campaign, deployment, enrollment, export, or outreach mutation occurs.

## 17. KILL LINES

- STOP if CRO-02 or CRO-03 is not merged/equivalent.
- STOP if one score/boolean/status substitutes for the structured channel decision.
- STOP if phone presence can produce `READY_EMAIL` for an email-ineligible contact.
- STOP if unknown/non-production, untraceable, unresolved identity, stale provider evidence, suppressed, or expired records can qualify.
- STOP if list and count or two task-owned consumers use different populations for the same policy/version/scope.
- STOP if UI filter strings become unvalidated raw SQL or bypass server policy.
- STOP if outreach queue enrollment bypasses sequence eligibility/contactability or creates duplicate active work.
- STOP if queue/send time can add members not in the frozen cohort.
- STOP if send-time enforcement is weakened or frozen eligibility is treated as permanent permission.
- STOP if cross-agent rows/counts/reasons leak.
- STOP if provider/GHL/campaign/deployment/export/enrollment/outreach or production data is mutated.
- STOP if a competing class/provider/contactability/sequence/contact/business authority is introduced.
- STOP if `db push`, migration-history edits, or unapproved production backfill occurs.

Record failures and finish the independent audit.

## 18. IMPLEMENTATION RULES

Use current project patterns, parameterized queries, normalized validated criteria, stable reason codes, safe hashes/tokens, role helpers, and privacy-preserving not-found behavior. Keep one policy version and one `asOf` per cohort snapshot.

No broad redesign, navigation rewrite, dependency/lockfile churn, production config mutation, provider activation, or unrelated cleanup. Never expose PII, audience samples, message bodies, provider payloads, or secret values in reconciliation/logs.

## 19. TEST REQUIREMENTS

Use non-empty isolated fixtures. Cover:

- each dimension independently missing/present/conflicted/stale;
- `READY_EMAIL`, `READY_MANUAL_CALL`, `READY_SMS`, and multi-reason `BLOCKED`;
- phone plus opted-out/invalid/stale email remains not `READY_EMAIL`;
- email-ready but not SMS-ready, manual-call-ready but not email-ready, and fully blocked;
- non-production, missing provenance, unresolved identity, missing decision-maker, stale completeness, ICP mismatch, offer mismatch, unassigned, no reply route, stale sender/content/campaign version;
- ZeroBounce token/generation/freshness current and stale;
- list/count/assignees/badge/daily briefing/campaign preview/freeze/export/assignment/enrollment population equality;
- filter normalization, unknown filter rejection, hash determinism, page-size independence;
- decision expiry and invalidation on every material input mutation;
- snapshot/replay/concurrent cohort build and exact member equations;
- frozen membership cannot grow at queue/send time;
- send-time class/provider/contactability changes remove/block with reason;
- first/concurrent/replayed outreach start creates one enrollment through canonical eligibility;
- anonymous, Agent A, Agent B, manager, admin direct API matrix;
- loading, empty, error, forbidden, deep-link, refresh, pagination, filter, and back/forward UI behavior;
- provider/GHL/outbound/export/deployment transports denied;
- migration empty bootstrap and second application.

Tests fail on empty/skipped fixtures.

## 20. SMOKE / INTEGRATION PLAN

Build a synthetic path:

`production/source-resolved identity → durable enrichment evidence → channel decision → Ready list/count → frozen campaign cohort → queue-time current check → send-time removal-only check`

Prove positive and every blocked reason, then mutate email generation, consent, class, identity, owner, reply route, and content version to prove invalidation.

Do not activate or send.

## 21. REQUIRED GATES

Run and report command, exit code, result:

- focused CRO-04 deterministic/disposable/browser-equivalent suites;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- deterministic-static capability;
- disposable migrations twice and deterministic-integration capability;
- provider/outbound-denied server and server-required capability;
- `npx tsx scripts/check-route-guards.ts`;
- API coverage/security and direct enrollment/write scans;
- commercial-classification, provider-readiness, contactability, and sequence-eligibility authority scans;
- `npx tsx scripts/check-migration-integrity.ts`;
- `npm run check`;
- `npm run build`;
- `git diff --check`.

Do not invent passes or label mock/local evidence production verification.

## 22. POST-BUILD GREP CHECKS

Prove:

- Ready membership no longer uses bare phone-or-email semantics;
- no task-owned consumer uses lead score/hot-warm-cold/enriched/completeness as channel permission;
- list/count/assignees/badge/daily briefing/campaign/export/assignment/enrollment route through the shared decision;
- no changed raw SQL duplicates the task-owned population;
- outreach queue start calls canonical enrollment/sequence eligibility;
- no direct active enrollment insert bypass remains in changed scope;
- campaign queue/send cannot add outside frozen membership;
- send-time current enforcement remains present;
- policy/hash includes every material task-owned input/version;
- no production/provider/GHL/campaign/deployment/export/enrollment/outreach mutation was added;
- no CRO-05 operator or CRO-06 campaign-content scope leaked in.

## 23. DIFF REVIEW

Run status, diff stat, staged/unstaged full diff, and `git diff --check`. Confirm only CRO-04-owned files changed; no prerequisite rewrites, secrets, PII, audience data, raw messages, provider payloads, generated artifacts, unrelated assets, lockfile drift, formatting sweep, or production configuration mutation.

## 24. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Structured channel decisions | `file:line` | dimension matrix | PASS/FAIL |
| VFC-F02 | Phone cannot imply email readiness | `file:line` | negative fixture | PASS/FAIL |
| VFC-F03 | One population across consumers | `file:line` | equality reconciliation | PASS/FAIL |
| VFC-F04 | Validated criteria and deterministic hash | `file:line` | grammar/hash tests | PASS/FAIL |
| VFC-F05 | Version/expiry/invalidation | `file:line` | mutation tests | PASS/FAIL |
| VFC-F06 | Canonical enrollment orchestration | `file:line` | replay/concurrency tests | PASS/FAIL |
| VFC-F07 | Frozen membership/removal-only send | `file:line` | queue/send tests | PASS/FAIL |
| VFC-F08 | Role/privacy scope | `file:line` | HTTP role matrix | PASS/FAIL |
| VFC-F09 | Safe migration | `file:line` | bootstrap twice/integrity | PASS/FAIL |
| VFC-F10 | No production/external mutation | diff/search | denied transports | PASS/FAIL |

Expand for every Done Looks Like row and kill line.

## 25. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- **Repository State:** starting/ending SHA, worktree, migration head.
- **Prerequisite State:** exact CRO-01/02/03 evidence.
- **Verified Root Cause and Assumption Corrections.**
- **P0 / P1 / P2 Corrections:** complete set.
- **Qualification / Cohort Contract:** decisions, inputs, reasons, versions, expiry, invalidation.
- **Implementation:** `file:line — change`.
- **Before/After Reconciliation:** aggregate-only member/count/reason equality.
- **Tests/Gates:** command, exit code, result.
- **Grep and Kill-Line Verification.**
- **Runtime/Operations Verification:** code/test versus production cohort/sender/reply truth.
- **Remaining Risks and Owner Actions.**
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE.
- **Branch/PR URL:** never merge/deploy/activate/enroll/send without explicit authorization.

## 26. RELEVANT FILES / AREAS TO VERIFY

- `server/services/outreach-queue-membership.ts`
- `server/routes/outreach-queue.ts`
- `server/routes/daily-briefing.ts`
- `server/services/contact-readiness.ts`
- `server/services/contact-readiness-backfill.ts`
- `server/services/contactability.ts`
- `server/services/provider-readiness-control.ts`
- `server/services/sequence-eligibility.ts`
- `server/services/sequence-worker.ts`
- `server/services/campaign-engine.ts`
- `server/routes/campaigns.ts`
- `server/storage/campaigns.ts`
- `server/storage/contacts.ts`
- `client/src/pages/dashboard/OutreachQueue.tsx`
- `client/src/pages/dashboard/Campaigns.tsx`
- `client/src/pages/dashboard/Overview.tsx`
- `client/src/pages/dashboard/Contacts.tsx`
- `shared/schema.ts`
- `migrations/meta/_journal.json`
- `scripts/check-route-guards.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/check-migration-integrity.ts`
- `.github/workflows/ci.yml`

Locate current names and owners first.

## 27. FINAL DIRECTIVE

Do not implement on the verified planning baseline because CRO-02 and CRO-03 are absent. Finish the entire preflight and correction register. When both prerequisites are merged/equivalent, recapture current main and proceed directly through the safe build. Keep production cohort generation, provider/GHL operations, exports, assignments, enrollments, campaign activation, deployment, and all outreach untouched.
