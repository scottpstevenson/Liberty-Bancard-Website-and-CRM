# VG-01 through VG-04 Runtime and Outreach Certification — 2026-08-27

**Tested live-main SHA:** `78ae07e8c5ffb643467a93dc42b95834d65289a8`  
**Observed published SHA:** `f2cfa4aade9b24435128c9bd5787ad01f5281563`  
**Evidence cutoff:** 2026-08-27T02:55:09Z  
**Authoritative register:** 39 of 39 IDs structurally reconciled with fail-closed status validation
**Redacted evidence packet:** `docs/VG_RUNTIME_EVIDENCE_PACKET_78ae07e8_2026-08-27.md`

## Executive verdict

| Decision | Verdict | Blocking evidence |
|---|---|---|
| Release | **NO-GO** | Published web and all 25 observed worker queues report `f2cfa4aa…`, not live-main `78ae07e8…`; main is unprotected; fresh scans report 31 high dependency findings and two high SAST findings. |
| Email pilot | **NO-GO** | No exact-current-release runtime proof, controlled test inbox, isolated execution environment, or approved provider receipt evidence. |
| SMS | **NO-GO** | TCR/A2P registration and number/location ownership evidence is unavailable; no SMS was sent. |
| Mass scale | **NO-GO** | Mandatory: queue headroom, 24-hour telemetry, classification, provenance, readiness, provider health, browser flows, and finance reconciliation do not pass. |

## VG verdicts

- **VG-01 — NO-GO.** Static controls pass, but exact-release deployment, authenticated runtime controls, branch protection, isolated pause-cycle evidence, and A2P evidence do not.
- **VG-02 — NO-GO.** Production aggregates show all 155,356 contacts, 1,571 deals, and 1,221 companies classified as `unknown`; only 144 contacts have primary source pointers; readiness/scoring coverage is materially incomplete.
- **VG-03 — NO-GO.** Serper, Outscraper, GHL, ZeroBounce, and SMTP configuration exists, but approved current-release health/cost/registry evidence is absent. Apollo is not configured and was not probed.
- **VG-04 — NO-GO.** Static routes and guards were mapped, but browser-use is unavailable, the role-guard workflow skipped on an unreachable server, and no isolated authenticated fixture environment exists.

## Passed evidence

- GitHub CI run `33016539222` on exact SHA `78ae07e8c5ffb643467a93dc42b95834d65289a8`: Static Checks and Integration Tests succeeded.
- Local exact-main typecheck and production build succeeded.
- Deterministic-static runner passed 19/19 suites.
- Migration integrity passed 361 checks; compliance scan passed 106/106 call sites; sender policy passed 82/82.
- CI manifest recognizes 59/59 mandatory suites.
- API coverage found no new unmatched client paths; SEO audit passed 421 routes with 12 warnings.

These passes do not override runtime, governance, data, provider, or browser failures.

## Current-release identity

- Live GitHub main and tested checkout: `78ae07e8c5ffb643467a93dc42b95834d65289a8`.
- `dev.libertybancard.com`, `libertybancard.com`, and the Replit deployment URL returned HTTP 200 from `/api/health`, all reporting `f2cfa4aade9b24435128c9bd5787ad01f5281563`, production, built at 2026-08-27T01:10:26.811Z.
- Deployment logs exposed 25 unique ready queues, processId 37, processIdentity null, all reporting the same stale SHA.
- Authenticated live-health and queue-metrics endpoints returned 401. No production login was performed because that would create session state.

## Governance and security

- GitHub reports `main` is not protected.
- Dependency audit: 0 critical, 31 high, 39 moderate, 6 low. High packages include drizzle-orm, multer, nodemailer, path-to-regexp, sharp, undici, uuid, vite, ws, and xlsx.
- SAST high findings: historical password-reset migration content and OG route path handling. Both require human triage.
- Privacy scan reported 93 mostly logging-oriented findings; this packet preserves counts only and emits no identifiers.

## Production read-only aggregate snapshot

- Commercial classification: contacts unknown 155,356; deals unknown 1,571; companies unknown 1,221.
- Provenance: contacts with primary source 144; without 155,212; source events 146; import executions 0.
- Email validation: active 155,249; valid 32; bounced 61; opted_out 13; subscribed 1.
- Readiness/scoring: readiness grade and version null 116,769; lead-score zero 152,000; positive 3,356.
- GHL linkage: linked 1,921; missing 153,435.

## Isolation and prohibitions honored

- Stateful runners failed closed because `TEST_DATABASE_URL` is absent; the normal database was not substituted.
- The existing failed pre-deploy workflow is excluded. This certification did not invoke `scripts/run-pre-deploy.sh`.
- No production write, migration, reconciliation, hold/pause change, backfill, deployment, real-recipient send, or live GHL/Apollo/ZeroBounce/Serper/SMTP certification call was performed.
- Uploaded instruction files remain untracked.

## Required remediation order

1. Triage or remediate the fresh high security findings.
2. Enable protected-main required checks.
3. Deploy exact live-main SHA or a reviewed descendant; reconcile every web/worker SHA and process identity.
4. Provision disposable PostgreSQL, isolated Redis, and fake providers; execute migration twice plus all stateful/server/browser suites.
5. Quarantine unclassified KPI rows and complete approved provenance/readiness/scoring remediation.
6. Obtain provider/TCR and authenticated runtime evidence without sending.
7. Run VG-04 role/browser and financial reconciliation matrices; regenerate the validated register.
