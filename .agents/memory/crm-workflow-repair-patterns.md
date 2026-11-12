---
name: CRM workflow repair patterns
description: Durable decisions and traps from the live-audit repairs to Today/Work/Contact/Applications/Pipeline/Reports/Inbox/mobile
---

Selected-record reads use the SAME actor-scoped predicate as the list; a record the actor cannot list is an indistinguishable 404. URL metadata (`taskId`, `from`, etc.) never authorizes.
**Why:** a deep link must not become a wider read path than the list.

Counts: a failed, loading, or not-configured source is "Unavailable", never 0; distinct populations (tickets vs tasks vs deals) are not forced to equal each other. Unassigned counts describe loaded rows only.
**Why:** zero on Today reads as "nothing to do".

One business time zone (`APP_TIMEZONE`) on server and client for due/overdue; do not mix UTC and browser-local.

Service worker must not cache private API responses; an offline/503 read is "unavailable", not empty or stale.

Statement-review GET handlers: `authorizeReview` already sends the 404 for a null review. Writing `if (!review || !await authorizeReview(...)) return;` skips it and the request hangs forever. Pass the possibly-null review straight to `authorizeReview`. (The PUT handler still has the old pattern.)

Applications: `in_progress` resolves to the single Draft tab ("Draft + in progress"); `recordScope=production|all` (anything else is a 400); production hides only authoritative test/demo/synthetic record classes and keeps `unknown` visible and labelled.

Contact is a person. A business appears as verified only from a recorded link decision; consent has three states (recorded / denied / not recorded, which is not a refusal). Document expectations follow lifecycle state and create no request.

Reports drilldowns open filtered worklists with registered URL selectors (`ticketState`, `ticketSla`, `stage`) that filter the loaded rows (ticket list loads <=500) and say when the load is partial. Stalling deals, 30-day counts and category rows have no exact filter, so they stay plain numbers.

Claim of unassigned work = single record, admin/manager only, through the existing fenced PUT; the 409 text is shown verbatim; no assignment policy is added.

Known failing before this work (do not blame new changes): test-crm-operator-experience (string missing from crm-operations.ts), test-task2056-crm-ui-contracts (LeadOpsCenter wrapper regex), test-dashboard-polish calendar PUT 400, test-stage3-d-r2-contracts industry-route check, test-lead-ops-budget-removal, test-attestation-promotion-regression.
