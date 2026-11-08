---
name: Receipt milestone gating and per-class cutoffs
description: Why receipts wait for the internal review handoff and how re-saving the capability must not move eligibility
---
A request receipt is only prepared once the internal work for that class exists (task/SLA/notification milestone). Each request class has its own eligibility cutoff, and re-saving the capability must not advance `eligibleFrom` for classes that were already open.
**Why:** the original sweep could tell a merchant "received" for a request nobody inside had been told about, and a re-save silently moved the cutoff, hiding older requests from the owner's intent.
**How to apply:** gate preparation on the class's internal milestone effect, keep the cutoff monotonic per class, show per-class windows in the settings card, and never replay older requests or resend a receipt that is already `sent` when recovering.
