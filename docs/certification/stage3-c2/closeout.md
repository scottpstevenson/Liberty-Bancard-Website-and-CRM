# Liberty C2 implementation closeout — 2026-10-08

## Delivery boundary

### C2-R10 — Unfinished Contact header and action hierarchy

The earlier handoff did **not** fulfill C2 implementation step 4's Contact
outer-header/action requirement. This is tracked as an unmet existing requirement
of Task #2073/C2 alongside Calendar-duration and pending-task corrections, not
new work or a deferral to C3–C5.

The compact header correction is implemented; its scoped rendered/action
verification passed on 2026-10-08. It uses the existing `RecordHeader`, Liberty tokens
and URL-backed five-area navigation; Log Call is primary, Add Note/New Task are
the two secondaries, and other permitted operations live in labelled More actions.
Substantial SFP/readiness explanations and diagnostic content are expandable,
with essential status/pause reasons retained in the header.

See `contact-header/`, `scripts/test-c2-contact-header.ts`, the
[reconciled Stage 3 spec](../../LIBERTY_BANCARD_STAGE_3_CONSOLIDATED_IMPLEMENTATION_SPEC.md)
and [Go Live ledger](../../LIBERTY_BANCARD_GO_LIVE_AUDIT_LEDGER_CURRENT.md).
Before/after desktop, phone and native 200% captures are retained. The final
receipt passes thirteen bounded check groups: real contact-bound Edit/Deal/
Ticket/Note/Task/Call and follow-up scheduling, clipboard, keyboard/menu/dialog
focus return, viewport-bounded overflow and unchanged owner/merchant denials.
Email/AI execution and production signed-in UI are not certified. This is not
an all-C2 pass. `contact-header/README.md` records exact geometry/qualification.
The final eleven-entry sidebar remains C5. Outbound stays paused; incoming GHL
synchronization remains independently enabled. No production mutation or publish.

Final R10 source HEAD: `b20e7a1ec40c70714e77738b4b892a5fc4924aef`.
Effective build input:
`7347a06dc73f215ed7fc1f9f4997e5793772744c5ecafbaa54dfe64206132a29`.
Output:
`05f3124d88867f7614b75cbf847f202b9658770eb6850ea25909878c8f6d27f1`.
Three existing Create Deal blueprint attempts were denied before provider
transport; external egress was zero. Do not describe this as zero attempts.

## Historical closeout before R10 — retained, not relabelled

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
