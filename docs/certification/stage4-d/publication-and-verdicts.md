# Publication and verdicts

Last updated 2026-11-03 (after the published-build audit and completion pass).

## Publication identity (current)

| Item | Value |
|---|---|
| Serving build | commit `548812f0`, build id `77138085-bcf3-4620-afee-0c69ab641d14`, built 2026-11-03T18:22:41Z |
| What it contains | Stage 4D as merged and published: R1 booking-create recovery, R2 zoned time, GPA-99 fix, scanner changes, role-guard extension |
| Repository head at the time of this update | `087a657e`, which also contains later Payarc changes that are **not** in the serving build |
| Not in the serving build | this pass's fixes: the SDR webhook signature middleware import fix, the specialized `message-received` STOP consent fix, the stage 4D journey/performance suites, the schema repair packet and the doc corrections. They need a normal Publish. The Payarc changes are separate and are not part of Stage 4D. |
| Schema | no migration, no startup DDL. The `no_show` constraint repair is a packet only (`schema-repair/`), not applied to production. |

Historical claim, kept as dated history: "Nothing in Stage 4D was published ... uncommitted working-tree changes on top of HEAD `73272418`" was true when the first Stage 4D pass was written (2026-11-03 morning). It stopped being true when that work was committed and published as `548812f0`. Do not rely on it.

The agent made no commit and no deploy. Production controls were not changed: outbound pause (paused, epoch 1), outgoing GHL (disabled, epoch 16), incoming GHL (enabled), booking writer row absent (default denied).

## Verdicts (kept separate)

| Verdict | Result | Basis |
|---|---|---|
| Application | **Published build correct for what was exercised; two further server defects found and fixed after it (not yet published).** R1 recovery, R2 zoned time and GPA-99 are green on a disposable database. | See "What ran" below. |
| Data / counts | **Reconciled for the dated production read-only snapshot; no data was changed.** | `content-and-count-reconciliation.md`. Unit, predicate, record class and as-of are stated per number. |
| SFP prep / staging | **Certified on a disposable database only.** No production staging run, no recipient release. | Staging worker, supply throughput and bad-source journey suites. |
| Content / CTA | **Unchanged.** The live packages are three-step. Five-touch drafts verified and not adopted or approved. | Content, preview, CTA suites. |
| Native GHL / calendar | **BLOCKED.** No authorized protected path exists. | `owner-and-native-matrix.md`. A fake provider does not pass it. |
| Roles / UI / performance | **Roles and Calendar console verified in a real browser on a disposable database. Calendar performance measured in matched fixtures only.** Production performance is not measured by the agent. | `browser-control-matrix.md`, `performance-receipt.md`. |
| Publication / schema / rollback | **Published build identified. Schema repair and rollback packet rehearsed on a disposable database; production DDL needs the owner's normal authority.** | `schema-repair/README.md`. |

## Overall

Stage 4D is **not** declared complete because code is published. Application and disposable-database acceptance are green. Native acceptance is blocked, the `no_show` constraint repair is unapplied in production, and this pass's two server fixes are unpublished.

## What ran this pass (disposable database and fakes only)

- R1 (`test-stage4d-booking-recovery`, `stage4c2-completion-pass`, `stage4c2-calendar-contract`, `stage4d-integrated-acceptance`): pass.
- R3: `ghl-projection-authority` GPA-99 now passes (1/1 on the previously failing check; handler unchanged).
- Bad-source journey (`test-stage4d-bad-source-journey`, 16 checks, 726 fixtures): pass.
- Signed reply/STOP/bounce through both entrances (`test-stage4d-signed-reply-journey`, 31 checks, real HTTP routes, Ed25519 fixture key, failed-commit retry, zero provider egress): pass.
- Partner-organization session denied (401) on the booking resolve route with no receipt written: `scripts/smoke-role-guards.ts`, pass.
- Browser: `test-stage4c2-workspace-browser` 187 checks, `test-stage4b-workspace-browser` 27 checks, `test-stage4c1-browser` 41 checks: pass.
- Matched Calendar performance (`test-stage4d-calendar-performance`): pass within the 25% + 150 ms bound.
- Schema repair rehearsal (`test-stage4d-appointment-constraint-repair`, 15 checks): pass.

## Not run

- Native acceptance of any kind (blocked).
- Production performance measurement, production staging, production sends, bookings, provider jobs, activation, backfill.
- Browser verification of the Campaigns ownership filter and the Program Health held-expiry note (see `browser-control-matrix.md`).
- Real-path seed send (design decision pending), production cold-email infrastructure proof.
- Full TypeScript check (the spec forbids it).
- Full pre-deploy roster (only selected disposable suites and the focused gates listed in `repair-and-test-receipts.json` were run).

## Known open items

- Two server fixes in this pass need Publish (see table).
- `ghl_appointment_state_status_chk` in production lacks `no_show`; repair packet is ready, owner-run.
- The booking-writer flag is read through Drizzle, which parses a jsonb string a second time. Only a double-encoded jsonb string reads back as `"true"`; a plain jsonb `"true"` or boolean reads as boolean `true` and the writer stays **denied** (fails closed). Anyone enabling the writer must verify the read-back through the app. This pass did not change the handler.
- Scanner baselines D20 are adjudicated in `requirements.md`.
- SLA task failures (184 historical) need an owner disposition. No worker was activated.
- Program Health once showed a skeleton-only state before loading, which was not a persistent outage. An optional bounded read with a visible timeout and retry would help.
