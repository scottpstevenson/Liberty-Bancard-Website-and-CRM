# Stage 5 — Application to MID: verdicts

Date: 2026-11-04. Baseline HEAD `d20e597a`. The preflight confirmed all 24 findings (S5-01…S5-24).
All 24 findings are addressed in source and verified at the fixture layer. Layers are reported separately. Nothing here is a production, native or release claim.

## Findings and where each is proven

| Finding | Change (summary) | Fixture evidence (disposable DB, real handlers/services, provider denied) |
|---|---|---|
| S5-01 | Server-side submission completeness (stored draft merged with the final body); protected/consent fields validated; refusals leave no outbox rows or state change and never echo values. | `stage5-application-contract` |
| S5-02 | Durable, hashed, scoped prefill capability with canonical object authorization; operator relinks validated; lifecycle timestamps are server-derived. | `stage5-application-contract` |
| S5-03 | Narrow validated operator editor DTO; transitions derived from the shared graph; stale edits conflict; draft filter covers draft + in_progress; operator list and pending count are SQL read models (paged, uncapped total, escaped search). | `stage5-application-contract` (75 checks) |
| S5-04 | Durable submission identity and truthful autosave state in the public wizard. | Source only (client). Not browser-driven. |
| S5-05 | Consent evidence bound to the contact's current phone; ambiguous contact/mailbox matches are held, not first-match linked. | `stage5-application-contract` |
| S5-06 | Application outbox settlement fenced on claim status and attempt. | `stage5-boarding-worker` |
| S5-07 | Underwriting engine: missing/invalid/contradictory evidence → review; no fallback thresholds. | `stage5-underwriting-evidence` (27) |
| S5-08 | GHL pause no longer blocks the local decision. Approve/reject is now ONE transaction: decision CAS + stage move + effect intents + audit; illegal transition, injected audit failure and concurrent calls roll back/produce one winner. GHL task and notification run after commit. | `stage5-underwriting-override` (25), `stage5-boarding-routes` (44) |
| S5-09 | Queue/approved lists are paged `{rows,total,limit,offset,hasMore}` with uncapped totals; latest decision per deal is deterministic (created_at, id); KPI "now" counts and the queue list share one cohort; event counts are labelled as events; stats are SQL aggregates; Refresh refetches every reader; the empty copy no longer claims everything is approved. | `stage5-underwriting-read-model` (21, >500 fixtures); browser journey |
| S5-10 | Condition integrity: strict commands, transition graph, supersede instead of delete, waive/reverse rules, race-safe init, durable owed-chase rows with held unknown outcomes. Migration `0380`. | `stage5-underwriting-conditions` (47) |
| S5-11 | Boarding payload only from the application; incomplete payload dead-letters before transport. | `stage5-boarding-worker` (62) |
| S5-12 | Typed fenced settlement; ambiguous provider outcome is never delivered or resent. | `stage5-boarding-worker` |
| S5-13 | Idempotency key bound to one deal/application/processor. | `stage5-boarding-routes` (incl. 4-way barrier) |
| S5-14 | Per-attempt dispatch fence and DISPATCH_STARTED marker; a crash after dispatch is never re-sent. | `stage5-boarding-worker` |
| S5-15 | One shared readiness contract at enqueue and at dispatch; document/e-sign needs are explicit `native_policy_required` gates. | `stage5-boarding-routes`, `stage5-boarding-worker` |
| S5-16 | Sandbox host `testapi.payarc.net` accepted; foreign hosts rejected. | `stage5-boarding-routes` (source check) |
| S5-17 | Payarc codec: HTTP failures classified, strict unwrapping, no fabricated identity or estimate. | `stage5-payarc-codec` (29) |
| S5-18 | Versioned atomic status-observation apply. | `stage5-status-apply` (14) |
| S5-19 | Bulk refresh validated, de-duplicated, capped, per-deal authorized. | `stage5-boarding-routes` |
| S5-20 | Deterministic canonical MID write and alias; no one-per-deal uniqueness added. | `stage5-boarding-routes` |
| S5-21 | Registry reads canonical MIDs, masked, with totals. | `stage5-boarding-routes` |
| S5-22 | Stable panel Idempotency-Key; truthful toast. | Source-checked only. Not browser-driven. |
| S5-23 | E-sign status GET is a pure read; provider refresh is a separate governed POST that reports unavailable; scoped document reader states; no fake cooldown; public timeline/shipping promises removed. | `stage5-application-contract` (last checks source-only); focused browser journey for the detail view |
| S5-24 | Outbox workers selected by profile/capability group; rules GET is pure. | `stage5-boarding-routes` |

## Verdicts by layer

- **Source:** all changes are in the working tree. Nothing was committed manually and nothing was published. No dependency or lockfile change. Migration `0380` added with a text-append journal entry; `check-migration-integrity.ts` passes.
- **Fixture:** PASS. Latest runs: `stage5-boarding-worker` 62, `stage5-underwriting-evidence` 27, `stage5-boarding-routes` 44, `stage5-payarc-codec` 29, `stage5-status-apply` 14, `stage5-application-contract` 75, `stage5-underwriting-conditions` 47, `stage5-underwriting-read-model` 21, `stage5-underwriting-override` 25 — all disposable-DB runs with the provider-deny boundary. Also: `check-processor-kill-lines` 18/18, `test-merchant-application-security` 271/0, `check-migration-integrity` pass, `test-cro01-revenue-contract-static` pass, pre-deploy static outbound-pause scan accepted the touched worker files.
- **UI (focused browser, rebuilt candidate, private Chromium, real admin session, no external egress):** PASS for the 10-check journey in `scripts/test-stage5-browser.ts`; receipt and screenshots in `docs/certification/stage5/browser/`. Covered: Underwriting at 1280 light/dark, 768 dark, 390 light (KPI review+hold equals the queue badge, pager, no horizontal overflow), paging disjointness, a real-pointer approve override (badge and KPI drop together), Merchant Applications list at 1280/768/390 and its detail view (e-sign state/controls). The browser pass found and fixed two defects: the pager Next button sat under the floating assistant button, and the longer tab label overlapped at 390px.
- **UI not browser-verified:** `BoardingPanel` (S5-22), the public application wizard (S5-04), and the operator edit form (S5-02/03 editor); these are source/esbuild-checked only. Roles other than admin were not driven in the browser (manager/agent access is proven at the handler layer).
- **Not run:** `scripts/test-forms.ts` (live HTTP finalize) was not updated or run; the submission contract is proven by `stage5-application-contract` at the service layer instead.
- **Native / production:** NOT RUN. No production write, activation snapshot, boarding submission, e-sign, backfill or publish. `native-packet.md` is prepared, not executed.
- **Release:** not published. Publish is the owner's step. Outbound pauses and the GHL outgoing/incoming settings were not touched.

## Baseline note

The earlier baseline failure in `test-merchant-application-security.ts` ("workflow_enroll propagates missing ghlContactId") no longer fails; the file passes 271/0 on the current tree.
