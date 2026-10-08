# C2 postmerge repairs — 2026-10-08

## Scope and status

The two source-confirmed defects in the supplied postmerge report are repaired
locally. No migration, production record write, provider write, outbound
activation, GHL sync setting change or publish was performed. Full C2 acceptance
is not claimed.

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

Published runtime logs contain a GHL HTTP 400 with message
`The calendar is not found.` for the appointment reader. The reader builds a
location-scoped events request and adds the configured calendar ID, if present.
It truthfully returns HTTP 503/`provider_failed` rather than fabricating an empty
successful calendar. This is a provider calendar lookup failure; the logs do
not determine whether the calendar is missing, belongs to another location or
is unavailable to the credential. No settings were changed or permissions
broadened. Successful live provider coverage remains unverified.

### Inbox

The sampled native-message detail request returned HTTP 404. A read-only
production query found zero retained rows for its exact namespace/message key.
There are also zero retained `ghl:` source observations in the queried snapshot.
The authorized detail reader requires persisted source metadata, a linked
authorized contact, and then matching immutable source content. No retained
source means it cannot reach a thread body. This establishes the sampled
missing-observation boundary, not a provider outage or IDOR.

The list persists native observations only for mapped contacts, but management
can also see unmapped provider cards. Whether the sampled item lacks a local
contact mapping, suffered another intake failure, or was previously observed
under a different identity remains unverified without its authorized provider
source/mapping evidence. A list preview was not substituted for detail
authority, and no contact/source observation was inserted to obtain a green
test. The production list endpoint was deliberately not replayed: it can write
observations during a GET.

## Local verification

`scripts/test-c2-postmerge-repairs.ts` exercises the date helper, the actual
Calendar mutation callbacks extracted from the source, and the canonical task
predicate. It checks month-end/leap-day moves, invalid dates, DST changes,
elapsed duration, explicit invalid-time replacement, read-only/provider denial,
event/deal namespace separation, injected-store persistence/reload, failure
without a success toast, task states and unavailable-state handling.

Passes: 42 assertions in UTC, 44 in America/New_York, and 42 in
America/Los_Angeles. These repeat shared assertions in different timezones,
not 128 unique production controls. Focused syntax checks and whitespace
validation pass. The injected store is not live SQL persistence or signed-in
browser acceptance; neither is claimed. No full repository typecheck, stock CI,
production durable mutation or all-role browser suite is certified here.

A focused TypeScript check of the new date helper passes. The application was
restarted with its existing background-jobs-off profile and serves requests.
An anonymous screenshot of the Calendar route correctly renders the sign-in
page; the signed-in Calendar/editor and Contact UI were not visually verified.
Existing release-identity/configuration warnings and unrelated failed workflow
results are not reclassified as passing by this verification.

## Existing acceptance owners

Calendar configuration/provider coverage and the sampled Inbox source/mapping
boundary remain within the existing C2 reader acceptance scope. Their remaining
verification is not a new task ladder. Incoming GHL synchronization remains
independent of outbound pause; neither was modified.
