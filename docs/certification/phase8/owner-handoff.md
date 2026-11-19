# Phase 8 — Cleanup & Hardening owner handoff

> Current failed-check follow-up: **61 original failures classified, with a passing execution recorded for each; not 61 distinct bugs.** Eleven suites exposed shared product defects and fifty had test/harness issues. Broader full CI remains incomplete and was curtailed after scope expansion. No release acceptance, merge, push, Publish or production change. See [current repair report](check-repairs.md) and [verification receipt](check-repair-verification.json). The implementation evidence below is the historical pre-repair snapshot.

Implemented locally on `codex/phase8-cleanup-hardening` in `/Users/matt/Developer/liberty-phase8-build`. Tested implementation: **67d87d55e7f0b4585484402fa5ad58fb93b531e4**, based on GitHub main **d67d24c61acc462931c418e8068624c86144c7ae**. A subsequent documentation-only commit records these results; it does not retroactively change the tested source or make a failed gate pass.

**All seven new Phase 8 suites pass. The full required gate is red: 252/313 passed, 61 failed.** There were zero runner setup/teardown failures and zero shared-launcher failures. A failed child can still contain an unmet fixture prerequisite or unexecuted tail; this is not a count of 61 product defects. No blanket waiver, assertion deletion or release approval is implied.

## Implemented scope

- **P8-1:** Five historical files archived byte-for-byte, one completed unused script removed with exact Git recovery; actual restoration proved. Historical content tools require a disposable target and a fresh exact source/target/content/flags-bound backup. Locked build/runtime and development-only journal ownership replace ad-hoc post-merge SQL replay. Generated artifacts/cache/worktree deployment exclusions preserve platform state.
- **P8-2:** Cancellable IANA midnight scheduling, native serializable period receipts, date-scoped inbox allowance/reservation/rollback, stale-owner fencing and truthful command outcomes. Existing durable follow-up effects wrap inbox reservations and delivery; accepted/unknown replay never reserves or sends again. No new dispatcher/profile was activated.
- **P8-3:** Existing indexes and four alias pairs inspected with native catalog/dependency checks and populated synthetic query/write measurements. **Retain all four production aliases. No index DDL is proposed.** A removal experiment regressed and remains explicitly rejected; a later quiet timing pass does not override that decision. The old manual index recreation path is removed.
- **P8-4:** Current documentation overlays and the 880-path/157-Markdown baseline inventory; shared native sender eligibility/capacity, honest worker/pause/readiness observations, correct import-row labels, unavailable states and responsive activation controls. Native Mac browser editing and request-log races repaired without bypassing auth or input.

The [controlling task](../../tasks/phase8-cleanup-hardening-preflight-build.md), [20-fact matrix](fix-effectiveness.json), [scheduler map](scheduler-ownership.md), [index decisions](index-decisions.md) and [execution receipt](execution-receipt.json) contain the contracts and evidence.

## Executed checks

Runtime: **Node v22.22.0 / npm 10.9.4**. Genuine locked `npm ci`; lock SHA-256 `452de1ab7c2045bf9029ceda8cb5c15d078645c8835b2a092ba995e86d15945c`. Candidate and baseline installed hidden-lock catalogs are identical. TypeScript passes, including the isolated artifact gate's cold check. Fresh production build, dependency inventory and redacting artifact scan pass. Dependency policy: **zero high/critical**, with 16 moderate/1 low in the full locked audit retained in the dependency dispositions. The 313 mandatory entries validate in the real CI manifest.

| New Phase 8 suite | Executed result |
|---|---|
| Mounted CRM browser | 59 assertions pass |
| Populated migration upgrade | Fresh/0393 upgrade catalog parity, replay and retained data pass |
| Contracts | 43 assertions pass |
| Period ownership/counters | 31 assertions pass |
| HTTP authority/roles/unavailability | 20 assertions pass |
| Backup recovery CLI | 5 assertions pass |
| Native index investigation/retain decision | 4 assertions pass; no DDL approved |

Additional private Chrome acceptance: **15 native 200% zoom assertions pass** on the three affected screens in both themes. The mounted matrix covers 1280/768/390 CSS pixels, light/dark, keyboard focus, Back/reload, unavailable sources and desktop-layout handoff. The 59 marker includes the final no-uncaught-error assertion after the screenshot JSON's earlier counter snapshot. Real-phone/WebKit and deployed bundled-server parity are **not exercised**.

All five local CI capabilities were invoked independently, even though the actual cloud workflow would stop at the first failed prerequisite:

| CI capability | Actual result |
|---|---|
| deterministic-static | 10 pass; fails #11/109, Phase 6 workspace identity |
| deterministic-integration | 18 pass; fails #19/181, Phase 6 inventory completion evidence |
| server-required | 3 pass; fails #4/24, Contactability Engine |
| writable-build | 1/1 pass: cold typecheck, build, dependency inventory, artifact scan |
| external-security | 1/1 pass: full and production audit policy |

These are local executions of the actual runners, not a claim that GitHub Actions ran. Suites after each CI stop point are not marked CI-passed. The full disposable pre-deploy runner attempted all 313 mandatory selections, explicitly including auth concurrency. All 24 server-required selections were additionally replayed with per-suite private infrastructure and an owned server where declared necessary: **candidate 7/24 and baseline 7/24**, with identical failed assertions after run-clock-only normalization. See [paired server evidence](server-baseline-comparison.json).

## Remaining required failures

The [61-row owner table](failure-owners.md) and [structured register](failure-register.json) name each test/fixture owner, literal production imports, exact baseline record and log-block hashes. **60 failed checks also fail on original application code or prepared baseline variants; one A/B interaction remains unresolved.** Passing later retries do not erase a failed full-run check.

Important distinctions and next repair owners:

1. `test-phase7-browser.ts` fails in the full candidate at A/B Refresh with `pointer-events:none`. Candidate local CI and four prepared/exact baseline attempts pass. The unchanged tour auto-opens after one second, but that is only a hypothesis for this failure. Preserve this unresolved result and inspect dialog/tour ownership; no current production defect or Phase 8 regression is established.
2. The Phase 6 workspace-identity assertion scans ReportingHub tabs against canonical registry tabs. The nested Growth/conversion-funnel contract and earlier Phase 7 history need reconciliation; do not remove the assertion by assumption. The local CI completion wrapper separately exits **65** after `test-phase6-inventory-reads.ts` logs 37 custom checks: no recognized module assertion evidence. That exact wrapper result reproduces on the baseline. Preserve completion enforcement.
3. Native provenance/intake fixtures fail in teardown while deleting contacts referenced by immutable conversion evidence; the old reconciliation fixture seeds a missing `selector_hash`. Repair fixture ownership/order/data rather than weakening production FKs or integrity guards.
4. Existing provider/qualification/cohort/transport inventories and fixtures have failing assertions on both sources. Authorized staff alerts are unchanged; an inventory disagreement is not authorization to remove channel/commercial/pause authority. The source/fixture register preserves unresolved causes.
5. Existing browser checks reproduce assistant overlap on Contact pagination and sequence preview, mobile Contact navigation below the fold, public login token mismatch, partner profession selection and unavailable Inbox population. These are outside the three changed Phase 8 screens; their original application/runtime replays remain recorded.
6. The canonical-provider-import suite hits its unchanged **180-second** timeout on both runs. A historical Task 1999 certification also restricts working-tree changes to that task while earlier suites generate tracked receipts. These are failed workload/fixture contracts, not proof of a new index regression.
7. The Calendar comparison requires historical `e112d19e` assets. Its exact reference build fails because `attached_assets/logo-blue.png` is absent. No substitute logo was used; Calendar performance acceptance is **not exercised**. The exact recorded C4 and C5 comparison clients were prepared and their baseline replays passed.

The original 219/306 baseline includes missing build/browser prerequisites and a held auth opt-in. Do not present 87→61 as a measured product-quality improvement. Fair runtime replays are documented separately. None of these failures is silently waived as old or obsolete.

## Independent gates and controls

| Gate/state | Status |
|---|---|
| Planned / P8-1–P8-4 engineering implemented | Yes, local branch |
| G0 source/runtime/lock and private boundaries | Verified for tested implementation |
| G1 archive/recovery; G2 cleanup safety | Focused/native proofs pass; live labelled data retained |
| G3 scheduler; G4 period/counters | Native concurrency, failure, replay and DST proofs pass |
| G5 native catalog / additive upgrade | Pass for retain-all decision; consolidation not qualified |
| G6 changed UI / project docs | Focused checks pass; supplementary old agent/vendor links separately disclosed |
| G7 full required gates passed | **No: 252/313; CI capabilities stop as above** |
| Merged to main | No |
| Schema verified locally | Yes |
| G8 candidate production schema / published / live candidate readback | Not performed |
| Scheduler cutover authorized / performed | No / No |
| G9 30-day stability observation | Unverified; not inferred from uptime or elapsed time |
| Production outbound | **Paused**, database-source read at 2026-11-19 08:51:55Z |
| Production CRM Outscraper cap | **$50/month**, unchanged; fresh canonical GET confirms it |

The final [control readback](control-readback-final.json) is read-only. It reports $0.876 maximum committed liability and $49.124 remaining, with no unknown operations; it is not an invoice reconciliation or a purchase. Scope is all **CRM** Outscraper usage; direct vendor-account purchases remain outside this CRM guard. No production record cleanup, live email, provider purchase, search activation, Replit restart/sync, push or Publish was performed. No message was sent to the Replit Agent.

## Migration, cutover and rollback

Only **0394_phase8_period_ownership** is new: journal idx 397; `scheduled_period_receipts` plus `sending_identities.counter_date`. Existing allowance is preserved. Native populated upgrade/replay proves retained consumption, pause and budget data. No new schedule/control is seeded, and no production index is added/dropped. Production remains Publish-owned: no manual SQL, ledger stamping or `db:push`.

A separately authorized release must review the exact managed diff and table-lock window, stop/drain the old scheduler process before the new owner runs, and observe the serving source/schema/UI and unchanged controls. Retain additive receipts/counter dates on rollback; stop the new timer/process before restoring an older artifact. Never delete receipts, reset allowance/provider spend, globally clear Redis or replay an uncertain dispatch. Platform layer size/headroom is still unverified; local regular-file byte counts are not compressed Replit image size.

## Retention and review

Full raw logs, exact tested compiled artifacts, generated browser/native evidence and every overwritten historical output are retained under `/Users/matt/.local/share/liberty-dev/phase8-*`. The [receipt](execution-receipt.json) records exact paths and hashes. Legacy generated outputs were copied out, then their original tracked files restored. Task-generated `.local` outputs were moved to private retention after all checks; the baseline helper was restored. Only positively owned private processes/stopped clusters were cleaned. Existing Air projects, other worktrees, user Chrome sessions and shared dev services were preserved.

Representative UI: [before](ui/activation-390-dark-before.jpg), [after](ui/activation-390-dark-after.jpg), [native 200%](ui/activation-native-200-dark.jpg). Original 880 project-doc paths remain inventoried; supplemental missing memory/vendor links are retained with their limitations, not fabricated replacements or new application-defect claims.
