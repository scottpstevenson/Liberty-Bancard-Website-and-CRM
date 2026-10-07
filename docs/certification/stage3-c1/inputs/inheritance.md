# Retained Recovery Inheritance Audit

## What & Why
Refresh all five existing Stage 3 C build contracts after merged Task #2071, without starting implementation, duplicating recovery ownership or implying full acceptance. This is a read-only source/diff audit and task-plan update, not a deployment, live data census, transport action or certification run.

## Current baseline and provenance
- Verified local HEAD and origin/main: `442fd044f10f52db4bf391dabcb1299403314eaf` (Task #2071 local code-fix delivery). Worktree clean at source inspection.
- Task #2071 delivery diff is against parent `94a4742d5d1953ea8102071aee2b9b5553ad1d06`: 29 paths, 1,369 insertions/91 deletions. Parent added the inaccessible spec4 placeholder. Original Stage3 preflight baseline `5d19e8c5410ffb5dea754fba894fe0be4d158642` is historical; merged A/B remain inherited.
- No employee page, App routing, layout, permission-inventory, Queue Holds, Operator navigation or launch-readiness source changed in this range. Their original C1–C5 findings and exact anchors remain applicable; none are closed by recovery delivery.
- Checked-in recovery status uses intermediate working HEAD `64c6b704aca2cd6f0b8c067b30474e7118cf4044` and historical observed API `1699d14806eefb88270c5fac12ef3635cb42ff97`. Neither is today's local/merged identity nor fresh serving/worker proof. No live build/data query was made for this audit.
- Spec4 remains exactly39 bytes: `{"detail":"File stream access denied."}`. Its tracking changed, not its accessibility. No intended spec4 permission/navigation content has been reviewed or adopted.

## Shipped source corrections
| Contract | Verified current anchors | What must be inherited |
| --- | --- | --- |
| Immutable original identity | `server/services/provider-import-identity.ts:8-40,42-139,142-185` | Exact execution/row/raw/acquisition/mapped/accounting/coordinate and original provenance verification; supported staging-failure mismatch only. Native immutable-guard + owner/live-token checks. Append versioned bridge on SAME source subject; never rewrite original fingerprints or fabricate identity equality. |
| Fingerprint/retention/renewal | `server/services/provider-import-evidence.ts:14-23,32-79`; `server/services/canonical-import-recovery-contract.ts:8-68` | Same shared verifier across retrieval, retention and qualified live claims. Preserve raw v2/v3 distinctions and stable source subject; no duplicated memberships/candidates/contacts or weaker UI-side fallback. |
| Bounded selector and fairness | `server/services/canonical-import-recovery-worker.ts:22-79,119-163` | Durable committed-claim lane rotation ordinary/legacy/hold; scalar selection before workbook JSON extraction; one live item lock and existing token/expiry/owner boundaries. Tick limits remain250items/30s. No UI-triggered replay/tick or activation. |
| Current native hold evidence | `server/services/canonical-provider-import.ts:136-175,307-365`; `server/services/contact-business-evidence-page.ts:66-86`; `server/services/organization-resolver.ts:95-106` | Current identity/claim checks and all candidate/relationship alternatives/revisions in ambiguity/affiliation snapshots. Hold evidence appends, historical receipts immutable. A terminal or completed label is not expected mailbox/business/provenance fulfillment. |
| Opt-in diagnostic measurement | `server/services/primary-lock-capture.ts:79-112,119-200`; `server/routes/import-lock-diagnostics.ts:7-14`; `server/lib/lock-trace.ts:4-6` | Admin-protected POST opts into bounded CPU/event-loop/observer round-trip/process-instance metrics. Default/automatic capture not opted in. No pool/timeout/lease/retry policy increase or performance remedy; local telemetry isn't production causality. Do not mount-trigger even a diagnostic POST. |
| Certification integration | `scripts/ci-suite-manifest.ts:318-337`; `scripts/pre-deploy.ts:104-119`; native topology/disposable/test files below | Audited recovery and transaction/lease checks remain mandatory. New fixture metadata/fresh migrated test DB/native manifest/schema checks are preserved. Test existence/registration is not gate success. |

## Actual acceptance limits
Read the newer `docs/certification/audited-retained-recovery-status.md` as the disposition authority alongside the older `canonical-retained-recovery-release.md`. The older raw/population reconstruction/reconciliation table is historical limited proof and MUST NOT be reused to claim the original authentic CRM graph or current production is certified.

The delivery status records, rather than this audit independently reproducing:
- 20 synthetic audited identity/fairness/hold/EXPLAIN checks and seven private-original identity checks passed. Full native topology and existing graph preservation are expressly not certified by these focused checks.
- Local workbook intake/recovery:2,914 rows; canonical intake79checks; leases135; lock observer28; typecheck/manifest/migration checks reported passed. Keep separate ordinary fresh-process restart versus deferred recovery/replay proofs.
- Exact configured release remains failed:125/172 passed,45 executed failures,2 opt-in skips,0 delegated/unverified or gate-control failures. Equal baseline failure count is not per-failure equality or permission to suppress gates.
- Earlier extended native restore refused `23505 contacts_email_unique_idx`; subsequent bounded17-table capture was independently rejected for revision drift (6 groups matched,11 changed). No verified revision manifest/full-population native recover/replay acceptance resulted. Source-absent columns differ from explicit NULL; preserve real defaults and source values/native constraints, never merge/archive/remove uniqueness just to seed tests.
- Production cycles/convergence not accepted; API/worker identity and causal delay proof open. Failed primary observation, correlated checkout and local CPU/loop measurements do not prove the historical6–15s delay cause. No speculative performance remedy.
- Original scope remains1,472 originals/1,277 mailbox occurrences/195 business-only rows, not distinct-contact/send-ready-recipient targets. Original immutable coordinates/fingerprints/provenance and protected foreign decisions remain mandatory.

## Ownership and five-task impact
- **#2072 C1:** unchanged147-route foundation and URL/theme primitives. Inherit current provider/source identity and expanded certification census; no twelfth recovery destination or final shell activation.
- **#2073 C2:** unchanged25routes/30panels/25Contact sections. Imported People/Leads use actual actor-scoped reads; row/completion/mailbox/membership/qualified-recipient populations remain distinct. Link only actual verified typed relationships; do not normalize conflicted relationships or turn identity proof into contactability/send permission.
- **#2074 C4:** unchanged38routes/67panels and metric/report repairs. Retained business/source rows do not become merchants/activated deals/revenue by receipt. Preserve actual eligible merchant/deal/class predicates and distinct populations; no financial/native certification inferred from recovery counts.
- **#2075 C3:** direct inheritance of merged2071 identity verifier/bounded recovery/current hold snapshot/native fixture authority. Historical mismatch-unreachable, no-fairness or absent revision-bound hold diagnoses are source-repaired, not new C3 implementation scope. Integrate the same status/import/history owners, preserve compatible identity/evidence/detail state; don't add parallel recovery, rewrite history or trigger it. Show recovery receipts/work/qualification/source freshness distinctly only through available read contracts; unavailable remains unavailable. No new polling/DTO/SQL authority to manufacture a recovery completeness metric.
- **#2076 C5:** diagnostics may expose compatible existing opt-in bounded measurements only behind actual guarded user action. No generic performance/remediation button or observer-on-mount. Retain all existing permission/Queue Holds/readiness/Operator fixes—they are unrelated, still pending. Certification display separates local milestone, recorded check, blocked authentic topology, failed release, unpublished/current-runtime unknown. Final shell requires C1–C4 workspace receipts, not false full recovery green.
- **#2077:** existing draft owns full authentic native retained-population/foreign-decision/replay/restart certification and failed release baseline analysis; do not duplicate within C tasks or declare it passed from merged2071.
- **#2078:** existing draft owns fresh primary causal diagnosis and independently verified post-publication API/worker ordinary-cycle/full convergence acceptance; no publish/live writes/control changes authorized here.
- Add the already merged #2071 as a direct inherited-base dependency to C1; C2/C4/C3/C5 inherit it transitively through their existing serialization. Keep C1→C2→C4→C3→C5 unchanged. Do NOT depend on draft #2077/#2078 or block independent UI implementation on later production acceptance. Any affected full native/runtime claim remains unaccepted with exact owner; final shell workspace acceptance does not close native recovery.

## Fresh audit checks
- Re-ran all42 exact C1–C5 SectionD grep commands at current HEAD: C1 six exit0/expected new-registry-symbol scan exit1; C2 eight exit0; C3 nine exit0; C4 eight exit0; C5 ten exit0. No new CRM symbols introduced by2071. Full supplementary transcripts `/tmp/stage3-c{1..5}-head442fd-grep.log`.
- Current literal App routes245/distinct dashboard patterns147; assigned partition counts and309historical panels unchanged. Source grep/census is not action coverage or readiness.
- Source diff whitespace check clean; Node22.22.0/npm10.9.4. No installed local tsx or tsc, so no current canonical CI/typecheck/build/DB/browser rerun. Prior169manifest preflight is historical; delivery status reports172, which requires stock executor verification.
- No private ignored originals/graph inputs read or exposed; no DB/Redis/HTTP/provider/browser/runtime observation/mutation performed. Task-agent run claims are cited as recorded receipts only. Don't use absent/lost private logs to claim independent reproduction.

## Done looks like
All five existing draft contracts retain their full original prompt/register/visual/action/kill-line requirements, use current inherited source SHA with old findings marked historical where applicable, preserve shipped recovery code and truthful limits, and name exact remaining owners. No duplicate build task, UI scope expansion or deploy authorization.

## Out of scope
Code implementation, production data census, private-original export/recovery/replay, canonical certification execution, production publication/control changes, new provider policies and release GO.

## Steps
1. Refresh each existing contract's current inherited HEAD and historical evidence labelling without erasing the original audit lineage.
2. Bind exact shipped identity/selector/hold/diagnostic invariants and ownership boundaries to each affected workspace's implementation and action fixtures.
3. Require current stock gate/172-suite census revalidation, preserving existing common no-effects/role/action rules and unresolved native/production claims.
4. Update existing task descriptions/dependencies only; preserve original eleven destinations and serialized ownership, leaving native continuation to the existing follow-ups.

## Relevant files
- `server/services/provider-import-identity.ts`
- `server/services/provider-import-evidence.ts`
- `server/services/canonical-import-recovery-contract.ts`
- `server/services/canonical-import-recovery-worker.ts`
- `server/services/canonical-provider-import.ts`
- `server/services/contact-business-evidence-page.ts`
- `server/services/organization-resolver.ts`
- `server/services/primary-lock-capture.ts`
- `server/routes/import-lock-diagnostics.ts`
- `server/lib/lock-trace.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/pre-deploy.ts`
- `scripts/run-retained-import-recovery-disposable.ts`
- `scripts/certification/retained-native-topology.ts`
- `scripts/certification/test-audited-retained-import-recovery.ts`
- `scripts/certification/test-provider-import-recovery.ts`
- `scripts/certification/test-canonical-provider-import.ts`
- `scripts/certification/test-canonical-transaction-leases.ts`
- `docs/certification/audited-retained-recovery-status.md`
- `docs/certification/canonical-retained-recovery-release.md`
- `.local/tasks/liberty-stage3-c-preflight-common.md`
