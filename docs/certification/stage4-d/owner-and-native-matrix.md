# Owner and native matrix (CP5)

Native acceptance verdict: **BLOCKED**. No authorized protected test path exists: the booking writer is default-denied and outgoing GHL control is disabled (epoch 16), so no native workflow install, test enrollment, cancel disposition, calendar-purpose read or canary booking can be performed. The agent did not change any control, send, release, approve or publish.

| Step | Needs | Owner action | Agent can prepare |
|---|---|---|---|
| Native workflow slot install + one test enrollment each | outgoing GHL enabled for a marked test contact only | owner enables a protected, scoped test path | proposal for a marked-contact-only path |
| Cancel-disposition approval | owner approval record | owner | none |
| Booking-writer enablement + one canary on a marked test contact | writer row true **and** outgoing GHL write control enabled (writer alone cannot overcome a disabled control) | owner | canary script design |
| Calendar-purpose confirmation | Sales Meeting read already selected; owner confirms purpose mapping | owner | none |
| `ghl_appointment_state_status_chk` add `'no_show'` | production SQL console | owner runs the repair | SQL text (no startup DDL) |
| SFP package approval/activation | existing paired publication authority | owner | none (five-touch drafts are not auto-adopted) |

## Native feasibility packet (first version, 2026-11-03 morning — SUPERSEDED by the corrected packet below; kept as history)

Why nothing native was run: the booking writer row is absent (default denied), the outgoing GHL control is disabled (epoch 16; native review `approved`, not revoked), and no scoped test path exists. A writer enablement alone cannot overcome a disabled control, and enabling either is an owner control change outside Stage 4D.

Proposed protected test path (for the owner to approve or reject; nothing here is built):
1. A marked, operator-owned test contact (recordClass test, own phone/email) bound to one provider contact id.
2. A one-shot, expiring, admin-created authorization naming that single local contact, one calendar purpose (Sales), one operation (create), `maxMessages` 1, revocable, and consumed under a row lock (same shape as the seed authorization). Outgoing GHL stays disabled for every other contact.
3. Canary steps: create preview (read-only) -> admin apply with a UUIDv4 command id -> provider appointment id -> read-back match -> delivery proof recorded separately from acceptance -> cancel through the same path.
4. Pass conditions: exact provider id and read-back, correct recipient, no duplicate or unintended follow-up, authorization consumed once. Failure or ambiguity stays `unknown` and is not retried.

Until that path is approved and run, native acceptance is **BLOCKED**, not passed.

## Corrected native packet (2026-11-03, after the published-build audit)

Verdict unchanged: **native acceptance is BLOCKED** until the owner supplies the authority below. Nothing here enables, approves, installs, sends or books. The first version above had four defects, corrected here:

1. A create-only, one-shot permit does not authorize cancellation cleanup or a workflow install. Each operation gets its own allowance.
2. A generic `maxMessages: 1` is not a booking contract. Appointment effects need appointment-shaped limits.
3. Approval of a booking is not approval of a workflow install, a workflow enrollment, or an SMS.
4. The first version implied all 39 reference workflow slots had to be installed. They do not; only the exact slots named in an approved allowance matter.

### What the agent can finish now with every production control unchanged (read-only or drafting)

- Read-only configuration inspection of the selected workflows and calendars.
- A calendar-purpose mapping proposal (Sales Meeting read is already selected; purpose mapping awaits owner confirmation).
- A cancel-disposition draft for owner review.
- This packet, the schema repair packet, and the rehearsed disposable-database certifications.

### Separate operation allowances (each is its own owner-approved record; none implies another)

| Allowance | Must name | Effect limits |
|---|---|---|
| A1. Create one test appointment | one marked test contact (`record_class` test, operator-owned phone/email, one bound provider contact id); one location id; one calendar id; one purpose (Sales or Account); one operation `create` | at most 1 provider appointment create; 0 notifications (`toNotify=false`); 0 messages; expiry timestamp; revocable; consumed under a row lock; any write whose result is unknown is parked as `unknown`, never retried |
| A2. Cancel the appointment A1 created | the exact provider appointment id returned by A1 and its read-back version; the same contact/calendar/location | at most 1 cancel/status write; cannot name any other appointment; separate expiry, revocation and consumption; if A1 is ambiguous, cancellation is parked for the owner, not attempted |
| A3. Workflow install (only the named slots) | workflow ids and exact versions/triggers to install, in which location, by whom | install writes only; no enrollment; no send; rollback = the recorded prior version/trigger state |
| A4. Test enrollment | the marked contact, the single workflow version, its trigger | at most N enrollments (N stated), message channel stated, expiry/revocation/consumption; SMS needs its own approval and recipient authority decision |
| A5. Rollback / cleanup | for each of A1–A4, the exact compensating action and who may run it | no broad control change; no unpause of global or per-channel controls |

Preconditions that stay true regardless: enabling the booking writer alone cannot override a disabled outgoing GHL control (epoch 16); a seed permit does not authorize booking or native writes; global outbound pause (epoch 1) is not lifted for any of this; the source cold-email SMTP transport and its no-GHL-fallback rule are preserved and are not part of any native allowance.

### Pass and fail conditions (per allowance)

Pass requires: exact provider id and read-back match, correct recipient, no duplicate or unintended follow-up, the allowance consumed exactly once. Delivery proof is recorded separately from provider acceptance. Failure or ambiguity stays `unknown`, is parked, and is not retried.

### Finite owner actions

1. Decide whether to authorize A1/A2 at all, and supply the marked contact, location, calendar and purpose.
2. Decide separately whether to authorize workflow installs (A3) for named slots, and enrollments/SMS (A4).
3. Confirm the Sales/Account purpose mapping and approve or reject the cancel disposition.
4. Run or approve the `no_show` constraint repair (see `schema-repair/README.md`).
5. Use the existing paired publication authority for any SFP package change.

Until those exist, the verdict is **BLOCKED**, not passed. A fake provider does not pass it.
