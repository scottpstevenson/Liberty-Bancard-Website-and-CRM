# C2-R10 Contact header — scoped evidence

Existing owner: **Task #2073 / C2**, implementation step 4. This corrects the
unfinished Contact outer header/action hierarchy; it is not a C3–C5 deferral.

**Final verification:** scoped PASS, 2026-10-08. See `after-receipt.json`.
The final build input hash is
`7347a06dc73f215ed7fc1f9f4997e5793772744c5ecafbaa54dfe64206132a29`;
output hash is
`05f3124d88867f7614b75cbf847f202b9658770eb6850ea25909878c8f6d27f1`.
Source HEAD is `b20e7a1ec40c70714e77738b4b892a5fc4924aef`; the input
hash also pins the effective workspace/fixture changes beyond that HEAD.

Thirteen bounded check groups passed, including real Edit, Deal, Ticket, Note,
Task, follow-up scheduler and Call persistence; current-contact binding;
clipboard values; foreign-owner non-disclosure 404; merchant denial 403; and
keyboard/modal focus return. These are not thirteen unique controls or full C2.
Both private browsers recorded zero uncaught runtime exceptions.

Phone: 390×844, header bottom 669, next-action bottom 557, navigation bottom
842, document width 390. Native zoom: actual DPR 2 / CSS viewport 720×428,
document width 720, essential status bottom 389 and next-action bottom 417.
At native 200%, actions/navigation require ordinary vertical scrolling;
keyboard access through the last overflow item and Escape focus return passed.
See [the focused last command](after-200-percent-menu.jpg).

## Delivered composition

- Existing RecordHeader and Liberty typography/tokens, compact identity, owner,
  lifecycle, consent/contactability, actual scheduled next action and pause reason.
- Log Call is the primary action; Add Note and New Task are the two secondaries.
- Other existing operations are in labelled More actions. Its viewport-bounded
  scroll preserves keyboard access at native 200% zoom.
- Five URL-backed areas remain immediately below the header. Substantial
  validation, SFP/readiness and record diagnostics are collapsed by default.
- No duplicate quick/mobile action bars or floating follow-up scheduler. The
  existing scheduler is opened through More actions with the same task handler.
- Controlled dialogs return focus to their initiating live record action;
  optional focus callbacks leave other component callers unchanged.

## Retained visual evidence

| View | Before | After |
| --- | --- | --- |
| Desktop | [before](before-desktop.jpg) | [after](after-desktop.jpg) |
| Phone | [before](before-mobile.jpg) | [after](after-mobile.jpg) |
| Native 200% | [before](before-desktop-200-percent.jpg) | [after](after-desktop-200-percent.jpg) |

The corresponding JSON files contain actual viewport/DPR, document width and
element geometry. `before-receipt.json` preserves the earlier construction;
`after-receipt.json` records the final construction and bounded checks. Failure
captures are failed harness runs, not acceptance evidence.

## Qualification and safety

The checks use a compiled client and actual registered source handlers, real
private agent login/session/CSRF and disposable PostgreSQL/Redis. They are not
published bundled-server parity or production/signed-in serving verification.
Mutation receipts include actual handler status/contact IDs; fixture database
reads verify persistence. Email/AI execution is not certified or performed.

Provider transport is denied before dispatch. The real Create Deal handler can
attempt its existing post-commit AI blueprint; denied attempts are counted
separately from external egress rather than described as zero attempts. The
final receipt records **three denied attempts and zero external egress**.

The scoped script does not run the broad C2/predeploy suites or reopen historical
Calendar-duration/pending-task receipts. Full C2/global acceptance, other role and
interior states, integrated certification and native recovery remain separately
owned. The eleven-entry sidebar remains C5.

Outbound remains paused; incoming GHL policy remains independently enabled and
unchanged. No production write, provider activation, spend, send, enrollment,
resume, permission bypass or publication.
