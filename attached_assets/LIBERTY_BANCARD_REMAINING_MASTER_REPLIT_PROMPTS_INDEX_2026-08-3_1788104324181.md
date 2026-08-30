# Liberty Bancard Remaining Master Replit Prompts

**Package date:** 2026-08-30  
**Latest verified repository baseline:** `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22`  
**Latest verified migration head:** `0194_cro03b_validation_execution_fence.sql`  
**Format:** Five independent Liberty master prompts, each combining mandatory preflight and implementation in 26–32 sections.

## 1. Package purpose

This package converts the end-to-end CRM roadmap audit into the five remaining task prompts requested for Replit:

1. CRO-05A — Inbound Revenue Operations, Assignment & Sales Handoff
2. CRO-07 — Controlled Delivery, Reply, Growth & Conversion Feedback
3. CRO-08A — Continuous Candidate Factory & Enrichment Operations
4. REV-05A — Merchant Application, Underwriting & Processor Boarding Authority
5. REV-06A — Active Merchant Success, Support & Revenue Truth

Each prompt requires Replit to verify current repository truth first, correct stale assumptions in place, continue into implementation when safe, certify on disposable infrastructure, and return an evidence-backed merge verdict.

## 2. Included prompt files

| Task | Prompt file | Sections | Primary exit condition |
|---|---|---:|---|
| CRO-05A | `REPLIT_MASTER_PROMPT_CRO05A_INBOUND_REVENUE_OPERATIONS_ASSIGNMENT_SALES_HANDOFF.md` | 26+ | Every inbound request is durable, assigned, SLA-bound, recoverable, and handed to the correct sales/application or governed campaign authority. |
| CRO-07 | `REPLIT_MASTER_PROMPT_CRO07_CONTROLLED_DELIVERY_REPLY_GROWTH_CONVERSION_FEEDBACK.md` | 26+ | CR-06 held intents have a separately governed, default-off delivery/reply/attribution capability with no prospect-send authorization. |
| CRO-08A | `REPLIT_MASTER_PROMPT_CRO08A_CONTINUOUS_CANDIDATE_FACTORY_ENRICHMENT_OPERATIONS.md` | 26+ | The CRO-03 candidate/enrichment factory can operate continuously under durable schedules, caps, recovery, and provider economics. |
| REV-05A | `REPLIT_MASTER_PROMPT_REV05A_MERCHANT_APPLICATION_UNDERWRITING_PROCESSOR_BOARDING_AUTHORITY.md` | 26+ | An approved application can reach one canonical MID and activation handoff without simulation or manual database repair. |
| REV-06A | `REPLIT_MASTER_PROMPT_REV06A_ACTIVE_MERCHANT_SUCCESS_SUPPORT_REVENUE_TRUTH.md` | 26+ | An activated MID appears consistently in processing, support, health, residual, payout, retention, and revenue views. |

## 3. Current dependency truth

| Existing phase | Current treatment |
|---|---|
| CR-04 | Preserve as the frozen promotional-audience authority. |
| CR-05 | Preserve as the operator task/work authority. |
| CR-06 | Complete for immutable campaign content, approval, cohort binding, preparation, and `READY_HELD`; do not rebuild it. |
| CRO-03A | Merged; preserve qualification and handoff authority. |
| CRO-03B | Merged at the verified baseline through migration `0194`; preserve recipe, evidence, arbitration, projection, and winning-email intent contracts. |
| CRO-03C | Task #1731 remains the separate governed live-provider activation phase. It is a hard prerequisite for CRO-08A integration, not a substitute for any prompt in this package. |

## 4. Required execution order

Recommended critical path:

1. Finish and merge CRO-03C Task #1731.
2. Build CRO-05A.
3. Build REV-05A after CRO-05A freezes its application-invite/sales-handoff contract.
4. Build REV-06A after REV-05A freezes canonical MID and activation handoff.
5. Build CRO-07 after CRO-05A freezes reply/task ownership and inbound attribution contracts.
6. Build CRO-08A after CRO-03C freezes activation, provider-operation, budget, and canary contracts.

CRO-07 and REV-05A may run in parallel after CRO-05A merges if migration numbers and shared-schema ownership are coordinated. CRO-08A may run in parallel with those after CRO-03C merges. REV-06A remains sequential after REV-05A.

## 5. Migration coordination rule

Before starting parallel Replit tasks:

- reserve non-colliding migration numbers;
- identify any shared edits to `shared/schema.ts`, queue/job registries, CI manifests, and pre-deploy registration;
- require each task to rebase or refresh its baseline before implementation;
- never edit historical migrations or reuse a migration number;
- merge schema-authority tasks before consumers that bind their new tables or lifecycle enums.

## 6. Shared non-duplication rules

All five prompts enforce these ownership boundaries:

- no second canonical contact, business, deal, application, or MID writer;
- no copied consent/suppression/contactability truth;
- no direct promotional enrollment outside CR-04 → CR-06;
- no direct task rows outside CR-05 authority;
- no stage mutation outside `advanceDealStage()`;
- no simulation or credential presence as production authority;
- no external effect before a durable operation, claim, idempotency identity, and pre-I/O authorization check;
- no approved CR-06 content mutation; improvements create a new immutable version;
- no continuous provider execution outside CRO-03C activation and CRO-08A schedule authority;
- no deal-only MID as downstream merchant truth.

## 7. Safety and external-effect posture

| Task | Build-time external posture |
|---|---|
| CRO-05A | Transactional/promotional transport held; public intake may be tested with synthetic/injected requests only. |
| CRO-07 | Delivery release capability built default-off; no prospect send authorized by the prompt. |
| CRO-08A | Continuous production schedules remain paused until exact provider and schedule activation. |
| REV-05A | Fake-provider/disposable certification mandatory; processor sandbox/live canary requires separate explicit authorization and exact environment evidence. |
| REV-06A | Processor/revenue ingestion must fail closed without real authority; merchant communications remain held unless their channel is separately enabled. |

## 8. What “complete” means

Every Replit task must report these milestones separately:

- **Preflight complete:** current code reality, census, conflicts, dependencies, and corrected plan are proven.
- **Code complete:** implementation, migrations, UI, deterministic tests, disposable integration, and registered gates pass.
- **Production connected:** exact deployed release, credentials/readiness, queues/webhooks, bounded external canaries, and monitoring are verified where the task owns them.
- **Operationally activated:** a separately authorized production control is enabled. A green build never implies this state.

No task may use “complete,” “live,” “production-ready,” or “end-to-end” without stating which milestone is actually proven.

## 9. Final whole-business gate

These five builds do not replace OPS-09A. After all remaining product tasks merge, OPS-09A must certify the exact production SHA and the complete operating journey:

`source/request → qualification → enrichment → assignment → statement/pitch/proposal → application → underwriting → processor approval → canonical MID → activation → support/processing/residuals → attribution`

The separate cold-outreach release sub-gate must still verify sender/DNS/inbox/provider readiness, consent/suppression, bounce/complaint/unsubscribe/reply ingress, caps, kill switches, and a bounded owner-approved send. None of the attached prompts silently authorizes that send.

## 10. Replit handoff instruction

Submit one prompt file per Replit task. Do not paste all five into one task. Keep each task open through its own preflight, implementation, disposable certification, post-build census, and final VFC. If an external credential, contract, or activation is unavailable, finish every provider-denied or fake-provider portion and report only the exact runtime evidence as pending.

