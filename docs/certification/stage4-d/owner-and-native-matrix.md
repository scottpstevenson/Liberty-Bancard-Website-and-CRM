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
