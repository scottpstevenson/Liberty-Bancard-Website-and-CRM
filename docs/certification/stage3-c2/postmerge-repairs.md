# C2 postmerge repairs — 2026-10-08

## Scope and status

The two source-confirmed defects are repaired locally and verified with a real
signed-in browser, registered handlers and disposable PostgreSQL. Reader
diagnosis is complete for the sampled failures. A further appointment query
defect was discovered and repaired. No migration, production record write,
provider write, outbound activation, GHL sync setting change or publish was
performed. This is the narrow postmerge repair scope, not full C2 acceptance.

## Calendar date repair

The event mutation now preserves the original browser-local start time (including
seconds/milliseconds) and positive elapsed duration when changing days. Strict
date validation rejects rollover dates and nonexistent local DST times.
Invalid original timestamps require explicit replacement start time/duration
from labeled fields. Invalid/nonpositive durations cannot silently produce a
zero-duration event. Deal follow-ups retain their own endpoint/payload;
provider appointments and read-only records cannot dispatch a write.
Failed persistence retains the editor and produces an error, not a success toast.

## Pending task count

Contact consumes the existing shared `isPendingTask` predicate, counting both
open and in-progress tasks. Loaded/unavailable distinction is retained. No new
query, authorization rule or competing task-state definition was introduced.

## Reader investigation

### Appointments

Published logs contain GHL HTTP 400 `The calendar is not found.` Live, read-only
diagnosis with the available GHL configuration confirms:

- The location matches the sampled production message namespace.
- Calendar inventory succeeds (HTTP 200) and contains three accessible calendars.
- The configured calendar is not in that inventory; exact configured-calendar
  lookup and event lookup both fail (HTTP 400). This is not a total credential
  or provider outage. Whether the inaccessible ID was deleted or belongs to
  another inaccessible location is not provable from this credential.
- All three valid calendars initially failed with HTTP 422: GHL rejects the
  unsupported `limit` parameter sent by this reader.
- Removing only that parameter produces HTTP 200 for all three calendars in
  the same location/window, with event counts 0, 2 and 0.

The reader now omits the rejected parameter, URL-encodes IDs and truthfully
reports no provider-side limit, while retaining its local 10-item queue bound,
role/contact owner filtering and explicit unavailable/error state. Actual
registered-handler fixtures test mapped-owner coverage, foreign/unmapped
exclusion for agents, management scope, successful reads and malformed-provider
failures. No calendar selection was silently substituted. The remaining
configuration decision is which valid calendar the owner intends to use;
changing that configured value was not performed.

### Inbox

The sampled native-message detail request returned HTTP 404. A read-only
production query found zero retained rows for its exact namespace/message key.
There are also zero retained `ghl:` source observations in the queried snapshot.
The authorized detail reader requires persisted source metadata, a linked
authorized contact, and then matching immutable source content. No retained
source means it cannot reach a thread body. This establishes the sampled
missing-observation boundary, not a provider outage or IDOR.

The sampled message's direct provider read succeeds (HTTP 200), is inbound,
matches the expected location and has both contact and conversation identifiers.
A production-scoped read-only lookup finds zero CRM contacts for that exact
provider contact ID, including archived contacts. Thus this sampled failure is
an unmapped contact/source observation under the existing authority rule, not
a deleted message, provider outage or proven IDOR. Management may see unmapped
provider list cards, but only mapped observations are persisted and readable
through the authorized detail resolver. Agent/foreign-owner/unmapped denial and
mapped exact detail success are covered by the real registered-handler fixture.

No preview was substituted for authoritative thread data and no contact/source
observation was inserted to force success. The production list endpoint was
deliberately not replayed: it can write observations during a GET.

## Local verification

`scripts/test-c2-postmerge-repairs.ts` exercises the date helper, the actual
Calendar mutation callbacks extracted from the source, and the canonical task
predicate. It checks month-end/leap-day moves, invalid dates, DST changes,
elapsed duration, explicit invalid-time replacement, read-only/provider denial,
event/deal namespace separation, injected-store persistence/reload, failure
without a success toast, task states and unavailable-state handling.

Passes: 42 helper/mutation assertions in UTC, 44 in America/New_York and 42 in
America/Los_Angeles. These are repeated timezone assertions, not 128 unique
production controls. The new helper's focused TypeScript check and whitespace
validation pass. The production build succeeds, retaining existing warnings.

`scripts/test-stage3-c2-actions.ts` passes 128 actual HTTP assertions using real
authentication/CSRF/role middleware, durable note/task/draft actions and reader
success/denial/error paths against private infrastructure.

`scripts/test-c2-postmerge-browser.ts` additionally passes:

- Ordinary, month-end and leap-day event moves through the actual handler into
  PostgreSQL, preserving duration, owner and contact.
- Foreign-owner and merchant denial; nonpositive end-time rejection.
- Real synthetic admin sign-in; replacement fields entered using actual
  pointer/keyboard input.
- A deliberately failed repair request leaves the SQL row/editor intact and
  renders an error without success.
- Successful repair writes the chosen start and 45-minute duration into SQL;
  reload and selection of the repaired day hydrate the saved event.
- A four-state scoped task population has two pending tasks in the authorized
  Work reader and rendered Contact count. A real task completion command changes
  both to one after reload.
- Desktop and mobile captures; no uncaught browser exceptions; zero external
  provider calls from disposable tests. Live diagnostic calls were GET-only.

Screenshots and the successful receipt are in `postmerge-browser/`. Earlier
failure captures remain historical harness failures, not current pass evidence.
Malformed event timestamps are injected into an already-authorized wire read;
the repair write, authority middleware, PostgreSQL persistence and reload are
real. This fixture does not claim that an actual production SQL row has malformed
timestamp text.

These are narrow postmerge checks, not a full repository typecheck, stock CI,
published bundled-server/all-role browser certification or production mutation.
The app's authentication remains unchanged. Existing unrelated failed workflow
results are not reclassified as passing.

## Existing acceptance owners

Calendar selection and any future approved intake/linking of the sampled Inbox
contact remain under their existing owners; neither is a new task ladder.
The causes and safe read boundaries are established. Incoming GHL synchronization
remains independent of outbound pause; neither was modified.
