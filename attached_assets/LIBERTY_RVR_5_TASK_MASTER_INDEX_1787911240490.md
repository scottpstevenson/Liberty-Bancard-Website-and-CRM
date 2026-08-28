# Liberty Bancard — Runtime Certification Remediation: Five-Task Master Index

## Authority and purpose

This package converts the non-CRM code and infrastructure gaps from the August 26–27 VG runtime work into five self-contained `PREFLIGHT + BUILD` tasks. It does **not** create another runtime register. The authoritative completed evidence set remains:

1. `docs/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_78ae07e8_2026-08-27.md`
2. `docs/VG_RUNTIME_EVIDENCE_PACKET_78ae07e8_2026-08-27.md`
3. `docs/VG_RUNTIME_OUTREACH_CERTIFICATION_78ae07e8_2026-08-27.md`

The supporting runbook and validators remain canonical. New runs append a new SHA/date-qualified evidence set; they do not overwrite or reinterpret historical results.

## Drafting baseline

- Remote `origin/main` recaptured at `c5d0baa8c697778caccaed4dba74e456c9a07063`.
- Migration head: `0165_outbound_send_claim_lease.sql`, journal index `169`.
- Certification implementation commit: `0e947faac9f7cd6aafbd634366e38e2dcd912f25`.
- Certification tested SHA: `78ae07e8c5ffb643467a93dc42b95834d65289a8`.
- Certification observed deployed SHA: `f2cfa4aade9b24435128c9bd5787ad01f5281563`.
- Each executor must independently recapture current main and correct stale claims before implementation.

## Task package

| Task | Purpose | Primary ownership | Parallel status |
|---|---|---|---|
| RVR-01 | Repository artifact containment and scanner recurrence prevention | `.gitignore`, tracked-file scanner/tests, explicit confirmed artifacts | Safe beside CRO-01 with file fence |
| RVR-02 | Portable deterministic dependency install and reachable advisory remediation | package/lockfile, dependency install workflow, minimal consumers | Safe beside CRO-01; no suite-manifest edits |
| RVR-03 | Current high SAST, path safety, privacy, and logging remediation | existing auth/path/redaction/security-scan owners | Preflight parallel; implement after overlap check |
| RVR-04 | Portable isolated DB/Redis/provider-denied certification and required gates | existing certification wrappers, workflow, capability runner | Coordinate `ci-suite-manifest.ts` with CRO-01 |
| RVR-05 | Exact release/process identity, job ownership, queue telemetry, and alerts | queue manager, logical manifest, job registry, health/metrics | Safe beside CRO-01; no schema by default |

## Corrections already incorporated

- The runtime register was completed last night; no register-refresh task is created.
- Current main contains seven tracked test-statement PDFs, not the six observed at the earlier certification cutoff.
- Current main already contains substantial isolated certification infrastructure. RVR-04 must extend it or return `NOT NEW TASK`, never rebuild it.
- Current lockfile contains Replit-internal resolutions while CI bypasses the lockfile. RVR-02 treats those as one reproducibility defect.
- Advisory and privacy counts are historical until rerun; every finding requires reachability/context review.
- Exact deployed SHA, 24-hour telemetry, provider plan, branch protection, and alert delivery are operations evidence—not facts code tests can fabricate.

## Recommended execution and merge order

### Parallel wave A

1. RVR-01 — repository containment.
2. RVR-02 — dependency/lockfile portability.
3. RVR-05 — release identity and queue telemetry.
4. RVR-03 read-only preflight; implementation only after changed-file overlap is known.

### Coordinated wave B

5. RVR-04 after RVR-02 and after CRO-01’s suite-manifest changes are merged or explicitly coordinated. It validates the final portable dependency graph and runs the current aggregate suite set.

### Operations closure after all five

These are not additional build tasks:

1. Repository administrator enables protected-main required checks and verifies the exact SHA.
2. Release owner deploys one reviewed exact SHA with full process identities.
3. Approved operator runs the isolated and read-only runtime checks and publishes a new validated register/evidence packet/certification verdict.

## File-ownership fences

| Shared area | Owner/rule |
|---|---|
| `scripts/ci-suite-manifest.ts` | CRO-01 while active; RVR-04 rebases/coordinates afterward |
| `.github/workflows/ci.yml` | RVR-02 owns install steps; RVR-04 owns services/capability execution; coordinate one final workflow diff |
| `package-lock.json` | RVR-02 only |
| `migrations/**`, `_journal.json` | None of the five by default; stop and coordinate before any migration |
| Queue/job/release services | RVR-05 only |
| Scanner and explicit artifact removals | RVR-01 only |
| Auth/path/redaction callsites | RVR-03 only after overlap proof |
| CRM/contact/prospect/deal/campaign/sequence/provider business logic | Out of scope for all five |

## Global kill lines

- No task may deploy, unpause, send, call paid providers, mutate production data, rewrite shared history, or change branch protection without explicit authorization.
- No task may expose secrets, PII, statement contents, provider payloads, raw job data, or unsafe scanner matches.
- No task may use `db push`, shared/production test state, global Redis cleanup, or skipped/empty fixtures.
- No task may call local/static evidence production verification.
- No task may duplicate canonical scanner, migration, test-capability, queue, scheduler, release, pause, redaction, or error authorities.
- Any overlapping active-task file must be coordinated or deferred, never silently merged.

## Package completion definition

The five-task package is complete only when each task has an evidence-backed final VFC and merge verdict, required code changes are merged, administrator/release operations are separately completed, and a new exact-SHA runtime evidence set records the resulting dispositions. A green build does not itself authorize outreach or close provider/data/CRM rows outside this package.
