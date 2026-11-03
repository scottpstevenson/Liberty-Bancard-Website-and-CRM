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

## Native feasibility packet (prepared, not executed)

Why nothing native was run: the booking writer row is absent (default denied), the outgoing GHL control is disabled (epoch 16; native review `approved`, not revoked), and no scoped test path exists. A writer enablement alone cannot overcome a disabled control, and enabling either is an owner control change outside Stage 4D.

Proposed protected test path (for the owner to approve or reject; nothing here is built):
1. A marked, operator-owned test contact (recordClass test, own phone/email) bound to one provider contact id.
2. A one-shot, expiring, admin-created authorization naming that single local contact, one calendar purpose (Sales), one operation (create), `maxMessages` 1, revocable, and consumed under a row lock (same shape as the seed authorization). Outgoing GHL stays disabled for every other contact.
3. Canary steps: create preview (read-only) -> admin apply with a UUIDv4 command id -> provider appointment id -> read-back match -> delivery proof recorded separately from acceptance -> cancel through the same path.
4. Pass conditions: exact provider id and read-back, correct recipient, no duplicate or unintended follow-up, authorization consumed once. Failure or ambiguity stays `unknown` and is not retried.

Until that path is approved and run, native acceptance is **BLOCKED**, not passed.
