---
name: GHL appointment calendar selection
description: Approved calendar choice and why appointment reads have their own configuration.
---

The user selected “Liberty Bancard — Sales Meeting” for the appointment reader.
Keep that selection independent of legacy outbound booking-link configuration.

**Why:** The user selected the appointment reader's calendar, not a change to
booking links or outbound configuration. The legacy calendar setting also
serves those other purposes, outside this repair's authority.

**How to apply:** Respect the reader-specific selection and its legacy fallback.
Do not silently switch to a personal or Account Management calendar, or repoint
outbound booking configuration when repairing appointment reads.

## Slug vs calendar ID
`/widget/bookings/<slug>` is a different identifier kind from the calendar ID in `/widget/booking/<id>`; compare only like with like. **How to apply:** never state a call length in copy; calendars are 30 min.
