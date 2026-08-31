---
name: CRO-07 controlled delivery, reply & feedback authority
description: Durable lessons from building a release/attempt/feedback/attribution authority layered on top of an immutable upstream "prepared but never dispatched" system.
---

## Layering a new authority on an immutable upstream system
When a new release/attempt/reconciliation layer must reference an existing immutable
"held intent" (never mutate it, never touch its disabled-dispatch contract), enforce
"one active chain per intent" as a DB constraint, not just application logic — and prove
it in certification by asserting the upstream row is byte-identical before and after the
new layer's writes. Capture that "before" baseline only *after* the upstream's own setup
flow (approval, preparation, etc.) has fully settled — capturing it mid-setup produces
false positives where the upstream's own legitimate state transitions look like
new-layer mutations.

## Immutable-after-insert linkage columns can make a documented join permanently empty
If an upstream system marks a linkage column immutable-after-insert (DB trigger) and its
own authority never populates that column while a downstream capability (e.g. real
dispatch) stays disabled, any "stop what's linked" query through that join is
correct-but-always-empty in the current disabled state. That's expected, not a bug — but
means downstream code proving "an event stops linked activity" pre-launch must target a
broader/independent join (e.g. by shared subject id) rather than the narrow linkage.

## Reply-vs-suppression matrix
An ordinary reply is not an unsubscribe/complaint. Route every feedback effect through
existing canonical consent/reachability/suppression authorities only — never reimplement
a suppression write inline in a new feedback pipeline. Consent-recording authorities that
require evidence for every kind except the strongest (e.g. global DNC) are enforcing a
real invariant; don't bypass it with inferred evidence.

## Feedback/effect application must be resumable, not commit-then-apply
Persist the feedback receipt as durable evidence, but treat "apply the canonical side
effect" as a separately resumable step keyed off whether it has already run — never as a
single all-or-nothing transaction where a post-commit throw silently loses the effect on
redelivery.

## Cap/capacity enforcement must cover every declared cap type atomically
When a release or job declares multiple independent caps (e.g. daily, hourly, canary
size), a claim must check and reserve *all* of them together in one transaction. Checking
only one cap type and treating the rest as decorative lets the others be silently
bypassed.

## Release-scoped uniqueness needs a real constraint, not just a key convention
"One release claims exactly one attempt" (or similar 1:1 invariants) must be a DB unique
constraint on the owning id, with the service-level lookup checking by that owning id
(not only by a client-supplied idempotency key) — otherwise a retry with a different
idempotency key can mint a second row for what should be a singleton relationship.

## Postgres param type-inference gotcha
A bound parameter used *only* inside `jsonb_build_object(...)` with no other typed
context fails with "could not determine data type of parameter" (`42P18`). Always cast
explicitly when a parameter's only appearance is inside a polymorphic function call.

## "Known valid attemptId" is not enough to authenticate a webhook event
A signature proves the caller holds a key for *some* registered source/account — it does
not prove that source/account was ever involved in the specific attempt the event claims
to be about. If any registered signer can name any known attemptId, a signer for source A
can forge effects against an attempt actually sent under source B. Fix: persist BOTH an
immutable provider-source AND provider-account correlation on the attempt at claim time
(from the release-approved identity, never from the webhook payload), and require the
incoming signed event to match BOTH before treating the correlation as resolved —
matching only the account is not sufficient, since a genuinely valid signer for a
*different* registered source could still name the right account. Treat a missing stored
correlation as a mismatch (fail closed), never as "no check required."

## Webhook dedup-before-auth lets one forged delivery poison a real event forever
If a receipts table dedupes on (source, provider_event_id) and persists an
invalid-signature delivery as the "seen" row for that key, the later genuinely-signed
delivery of the same event ID is silently swallowed as a replay — an attacker who cannot
even forge a valid signature can permanently block a real complaint/unsubscribe/bounce
just by sending an unsigned request first with a guessed/observed event ID. Fix: only
short-circuit as a no-op replay when the stored row (or the new delivery) is itself
unauthenticated-and-staying-that-way; when an existing unauthenticated row is superseded
by a newly *valid* signature for the same key, re-resolve correlation from the trusted
request and UPDATE the row in place so the effect-application path still runs exactly
once.

## Disposable-certification pause/capability seeding must run after migrations
Any "initialize control table" call for a capability gate (pause authority, feature
control, etc.) must run *after* migrations create that table on a fresh disposable
database, not before — calling it first silently no-ops (fail-closed default, zero rows
persisted) and every later check sees "no control row found" for the rest of the run.

## Multi-row "freeze" operations must commit atomically
When one logical action creates a parent row plus several dependent rows (e.g. a frozen
design plus its per-arm sample rows), and a resubmission-of-the-same-key path is
deliberately forbidden from creating the dependent rows again, do the parent+dependent
inserts in one transaction. If they're separate autocommit statements, a crash between
them leaves a permanently half-created parent that no future call can ever repair (the
safe-replay path intentionally skips dependent-row creation on an existing key).

## State-machine "decide" transitions need a locked compare-and-set, not read-check-write
An endpoint that reads a row, validates its state/eligibility in application code, then
issues an unconditional `UPDATE ... WHERE id = $1` is racy: two concurrent callers can
both pass the read-time check and each unconditionally overwrite the other's terminal
decision. Fix: `SELECT ... FOR UPDATE` to serialize concurrent callers, re-derive
eligibility from data read under that lock, then `UPDATE ... WHERE id = $1 AND state IN
(<eligible states>)` and treat zero rows affected as "no longer decidable" — never treat
the read-time check alone as sufficient guarantee for a terminal state transition.

## A shared/default webhook secret defeats any per-source correlation check
If a caller resolves a webhook's HMAC secret as `SECRET_<SOURCE>` with a fallback to one
shared default, then anyone holding that one default secret can sign a request under ANY
`:source` path segment and satisfy a "does this event's source match the claimed
identity's source" check that was added specifically to prevent that. Source-binding is
only as strong as secret separation: require a distinct secret per approved source with no
shared fallback, and fail closed (reject, never authenticate) when a given source has no
secret configured. Also: certification harnesses that call the signature-consuming service
function directly with a hand-set `signatureValid: true` never exercise the HTTP route's
own secret-*selection* logic — that boundary needs a real HTTP-level test (spin up just
that Express route on an ephemeral port) to actually be covered.
