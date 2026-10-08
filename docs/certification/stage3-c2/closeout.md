# Liberty C2 implementation closeout — 2026-10-08

## Delivery boundary

Today, Records/Contact, Pipeline, Inbox and Work have the implemented Liberty
composition and retained existing authorities/actions. The user requested
closeout and explicitly stopped further full test/suite execution. That changes
the verification scope, not the truth of the remaining acceptance gates.

See `verification-status.md`, `ownership.json`, the portable inputs and
`browser-receipts.json`. Original route/panel/claim ownership and historical
global accounting remain preserved; no all95, full C1, C3/C4/C5 or native closure
is asserted. No unsupported Mine/Team/Unassigned capability is fabricated.

## Source, tested, serving and rollback identities

- Latest application source changes: `e44b40ea`, following `4df9b86e`.
- Last compiled and fully exercised C2 browser construction: full source
  `4df9b86e6e403dbdc5464dbf0b8f01162d46490d`, 335 bounded observations,
  zero external effects. Its full input/output hashes are in the receipt.
- Construction is compiled client plus registered source handlers, real
  synthetic sessions/CSRF and object middleware on disposable infrastructure.
  It is not deployed bundled-server parity.
- Final closeout commit contains reporting only; obtain its clean identity
  from Git. Do not relabel the earlier compiled receipt with that later SHA.
- Final anonymous-site compatibility/paused-Enter refinements: syntax checked,
  not rebuilt or runtime certified after the user's stop instruction.
- No merge/publication/serving equality is claimed. The running signed-in
  application was not re-certified; the unauthenticated shell renders sign-in.
- Last known browser-tested rollback reference: `4df9b86e`. Retain earlier
  merged C1 foundation `353cb381ed500dc2acf793b3b2e91a61b3aeade0`.
  Any rollback is a deliberate code checkpoint operation, not automatic DB,
  Redis or production restoration.

## Last application changes relative to the exercised source

| File | Changed symbols/behavior | Evidence |
| --- | --- | --- |
| `server/services/crm-object-access.ts` | Export existing `authorizeLiveChatAccess` without widening its policy | Focused syntax |
| `server/routes/live-chat.ts` | Consume that shared owner, replacing the private duplicate | Focused syntax |
| `server/routes/inbox.ts` | Exact local-session source projection through existing session/object access; no fabricated message body or contact | Focused syntax |
| `client/src/pages/dashboard/CommsHub.tsx` | Contact-bound draft readiness, source metadata, signal-aware link search, actor/selection-fenced link completion | Focused syntax |
| `client/src/pages/mobile/MobileInbox.tsx` | Contact-bound draft readiness and honest missing-subject label | Focused syntax |
| `scripts/test-stage3-c2-actions.ts` | Actual outside-window fixture and real live-chat handler/role/link cases | Syntax only; new cases not executed |
| `scripts/test-stage3-c2-browser.ts` | Register live-chat handler; focus actual composer before paused Enter | Syntax only; refinements not executed |

## Remaining owners and explicit nonacceptance

- C2 consumer/existing live-chat and command owners: runtime proof of final
  site-session read/link/draft behavior and focused paused Enter refinements.
- C2/G01–G12 evidence owner: complete per-control attribution, complete role
  and child-state evidence, canonical/global results reconciliation and
  final-source build/typecheck/action qualification. `actions.csv` contains
  untested inventory and separately qualified earlier browser cases, not an
  invented all-controls pass.
- Shared C1/C2 performance owner: investigate the retained 372 ms C1 input
  failure; no baseline equality or root cause has been proved.
- Existing SFP/security/import owners retain the documented deterministic-
  static, dependency high findings and CSV baseline failures. Fail-fast lanes
  not executed remain unexecuted.
- C1 residuals, C3/C4 interiors, C5 cutover, integrated certification and
  native recovery retain their existing owners. A loaded outer panel does
  not certify an interior action.

## Safety

No production writes, sends, enrollment/resume/activation, provider spend,
worker/control changes, publication, policy restoration or permission widening.
Outbound stays paused; proposal Hold for Review and independent incoming
GHL/no-echo authority are not changed. This is not release GO.
