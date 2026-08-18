# Liberty Bancard Full GitHub Audit

**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Audited GitHub ref:** `main`  
**Audited SHA:** `34dabc12da8cffba583855305046cd04aec3b760`  
**Audit date:** 2026-08-18  
**Mode:** Read-only repository inspection and reconciliation. No repository, database, Redis, provider, deployment, pause, or production mutation was performed.

## Executive verdict

The recent GHL, Serper, ZeroBounce, pause-control, and pre-deploy work materially improved the system, but it did not resolve the original audit program as a whole.

The eight original audits reconcile to **77 deduplicated findings** at the current GitHub SHA:

| Status | Count |
|---|---:|
| `CLOSED_STATIC` | 11 |
| `CLOSED_RUNTIME` | 0 |
| `PARTIALLY_CLOSED` | 21 |
| `OPEN` | 29 |
| `RUNTIME_VERIFICATION_REQUIRED` | 12 |
| `SUPERSEDED` | 4 |
| **Total** | **77** |

This means **62 findings still require build work or current-release runtime proof** (`OPEN`, `PARTIALLY_CLOSED`, or `RUNTIME_VERIFICATION_REQUIRED`). The 39-row runtime register is only the runtime-evidence subset; it is not the full backlog.

## Highest-risk current findings

### 1. Public repository still contains database backups and operational artifacts

- GitHub reports the repository as public.
- The current tree tracks seven compressed database backups under `backups/` and hundreds of files under `attached_assets/`.
- Current tracked inventory includes **818 files** across those two directories.
- Removing files from the tip alone would not remove them from Git history.

**Disposition:** `SEC-01 OPEN`, P0 containment. Make the repository private, inventory exposure, rotate affected credentials, remove generated data from version control, and perform an approved history-cleanup procedure.

### 2. Sensitive merchant fields remain plaintext application fields

`shared/schema.ts` still defines `owner_ssn`, `bank_routing_number`, and `bank_account_number` as ordinary text. `server/routes/merchants.ts` accepts them and `server/routes/boarding.ts` forwards them to the processor. No application-layer field encryption/tokenization is present on this path.

**Disposition:** `SEC-02 OPEN`, P0 security architecture.

### 3. Canonical outbound enforcement is not actually universal

`server/services/ghl-form-sync.ts` performs raw GHL mutations for opportunities, contact tasks, contact creation, and DND updates. The file does not use `OutboundPauseAuthority`; instead it is exempted by the pre-deploy scanner and compliance scanner. Public form/application paths invoke this service.

This reopens the broad claim that every outbound provider boundary is canonical. The pause-control architecture is strong, but this raw mutation surface remains outside it.

**Disposition:** `OUT-03 PARTIALLY_CLOSED`, P0 safety boundary.

### 4. Consent and email-status semantics still disagree

Examples at the current SHA include:

- `server/routes/public.ts` assigns `consentEmail` from `consentSms` in one intake path.
- `server/routes/conversation-ai-config.ts` treats missing email status as `active` and checks `opted-out`.
- Other code uses canonical `opted_out` and `unvalidated` values.
- Imports still default absent legacy values to `active` in at least one path.

This creates inconsistent channel eligibility and reporting decisions.

**Disposition:** `DAT-06 OPEN` and `OUT-05 OPEN`, P0/P1.

### 5. CI is materially narrower than the release gate

The only GitHub Actions workflow runs compliance, API coverage, Redis topology, role guards, contactability, sequence compliance, form tests, SEO, and screenshots. It does **not** require `npm run check`, a production build, or several safety-critical suites now present in pre-deploy: GHL circuit/cursor/identity, Serper gateway/admin/cooldown, ZeroBounce campaign, post-enrichment recovery, release identity, NBA, or pause-authority coverage.

No pull-request workflow run was returned for the audited SHA by the GitHub connector, and branch-protection requirements could not be established.

**Disposition:** `SEC-03 PARTIALLY_CLOSED`, `QUE-11 PARTIALLY_CLOSED`, P0 release control.

### 6. Migration journal chronology remains non-reproducible

The journal contains 145 entries, including duplicate journal index `130` and future-dated timestamps for migrations `0133` through `0141` relative to this audit. Runtime observations can prove tables exist, but they do not prove a clean database can reproduce the same schema safely.

**Disposition:** `SEC-04 OPEN`, P0 release/data safety.

### 7. Post-enrichment recovery still has a crash window

The immediate producer can commit an intent as `processing` without a claim token or lease. Recovery reclaims expired leases, so a process crash after commit and before execution can leave an unrecoverable row. The dedicated recovery test is omitted from CI and contains assertions that do not conclusively exercise competing claims and terminal failure.

**Disposition:** `QUE-05 PARTIALLY_CLOSED`, `QUE-06 OPEN`, P0/P1.

### 8. Queue schedule ownership can still be destroyed by interval updates

`QueueManager.updateQueueRepeatInterval()` removes every repeatable job on the physical queue before adding the base schedule. On a queue that also owns named schedules, this can remove `post-enrichment-intent-recovery`.

**Disposition:** `QUE-12 OPEN`, P1.

### 9. Canonical data architecture is largely unimplemented

The following original requirements remain open:

- no universal `record_class` for production/test/demo/import records;
- no normalized-email identity enforcement;
- fragmented phone normalization and no safe phone identity model;
- no complete reversible merge ledger or all-FK transfer plan;
- direct `storage.createContact()` callers remain outside `writeContact()`;
- no authoritative `businesses` organization layer;
- no fully reconciled consent/suppression event model.

**Disposition:** `DAT-01` through `DAT-06` remain open or partial.

### 10. Commercial truth and UI reconciliation remain blocked by data classification

Pipeline, portfolio, applications, reporting, residuals, and other financial surfaces have no universal production/test/demo discriminator. Navigation still exposes overlapping CRM, Lead Ops, Outreach, Imports, and operator surfaces. A hard-coded pipeline fetch limit is not a durable pagination model. The virtual-terminal page redirects, but its server routes and processing implementation remain active.

**Disposition:** most `UI-01`–`UI-13` and `REV-01`–`REV-07` remain open, partial, or runtime-required.

## What the recent task cluster did close or materially improve

The following are real improvements and are credited in the ledger without over-claiming adjacent scope:

- fail-closed pause authority, startup ordering, epoch checks, and removal of caller bypasses;
- coordinator hold ledger, staged release, correlation-scoped test cleanup, and expanded pause-cycle tests;
- static send-boundary scanning and a much larger pre-deploy suite;
- persistent GHL circuit state, deterministic probe cursor, invalid-contact handling, skip classification, and admin visibility;
- canonical Serper gateway, budget/circuit/window accounting, alerts, admin controls, and merchant cooldown;
- durable ZeroBounce campaign/run/attempt infrastructure, daily cap, scheduled batch, admin UI, and contact history;
- transactional provenance for canonical contact writes and import executions in the repaired paths;
- build-time `dist/RELEASE_SHA` creation through `.replit`, health reporting, and a pre-deploy SHA assertion;
- Queue Holds and backlog preview UI.

These improvements close specific static acceptance criteria. They do not automatically close privacy, identity, consent, provenance backfill, commercial truth, all-provider runtime health, UI architecture, or revenue workflow findings.

## Domain conclusions

| Domain | Current conclusion |
|---|---|
| Security/privacy/release | P0 exposure and plaintext-sensitive-field risks remain. Release identity implementation exists, but current deployed SHA evidence is still required. |
| Outbound/contactability | Global pause architecture is strong; universal provider-boundary and purpose/contactability enforcement is not complete. |
| Queues/workers | Coordinator and test coverage improved; legacy scheduler ownership, PE recovery, named schedules, CI coverage, and runtime capacity remain unresolved. |
| Canonical data | Most foundational architecture remains open: classification, identity, merges, organization authority, consent vocabulary, and historical lineage. |
| Enrichment/providers | Serper, GHL, and ZeroBounce implementations improved substantially. Current-release success/yield/backlog evidence is still required, and other provider health remains unknown. |
| UI/operator experience | New provider panels exist, but the original navigation, route-ownership, role, pagination, synthetic-data, and lifecycle simplification program is largely unfinished. |
| Revenue/commercial truth | Not ready for trustworthy executive reporting or optimization until classification and state-owner work is completed. |

## Verification limitations

- This pass inspected the full checked-out GitHub tree and commit history at `34dabc12` plus the eight original audits and supplied evidence packets.
- A clean local dependency install could not be completed in the audit container because package downloads/cache writes failed in the environment. Static code, configuration, migration, test, and workflow inspection continued; no test result is invented.
- The user supplied a later Replit report that the full pre-deploy gate passed 34/34 before the latest publish. That is useful historical evidence, but it is not a GitHub Actions result and does not establish every recurring runtime claim for `34dabc12`.
- Historical runtime evidence from older SHAs is retained as context but expires for release-sensitive claims after later deployments.

## Governing outputs

1. `LIBERTY_BANCARD_AUDIT_RECONCILIATION_LEDGER_CURRENT.md` — authoritative 77-row active tracker.
2. `LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_CURRENT.md` — exact 39-row runtime subset with current disposition.
3. `LIBERTY_BANCARD_RECONCILED_MASTER_INDEX_CURRENT.md` — concise authority and priority map.
4. `LIBERTY_BANCARD_NEXT_BUILD_TRANCHES.md` — ordered implementation plan covering all residual findings.

The eight original audits remain immutable historical inputs. The four current files above should be used for new work.
