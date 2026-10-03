---
name: SFP enrichment acceptance
description: Distinguish cumulative recipient output, representative business coverage, and the unrelated GHL import.
---

SFP enrichment targets are separate: 5,000 globally unique qualified, validated, policy-eligible recipients cumulatively, and a representative batch of 20 distinct businesses in each of five verticals. The latter totals 100 businesses; it does not mean 50 recipients per business.

Each business must have one primary and at most two alternate recipients, across contact/free/paid sources. At three per business, 5,000 distinct recipients require at least 1,667 businesses; a repeated 100-business pilot cannot establish that output.

The user states that there are no spending limits. Do not frame low enrichment throughput as a spending-limit problem without an actual runtime denial proving that cause.

**Why:** The user explicitly corrected spending-limit language while reporting very low ZeroBounce usage despite available credits.

**How to apply:** Diagnose distinct addresses reaching validation and actual provider dispatches, not worker heartbeats or completed internal runs. This clarification is not authorization to change provider controls or bypass safety gates.

Apollo is optional. Its lack of credits must not block other enrichment sources or ZeroBounce validation.

**Why:** The user repeated that Apollo has no credits and should not block anything; restoring Apollo was incorrectly presented as the next prerequisite.

**How to apply:** Isolate unavailable-provider failures and continue with healthy sources. Do not request Apollo credentials or credit replenishment as a condition for completing the pipeline.

Full-population accounting does not mean full-population ZeroBounce dispatch
or enqueueing. Only prioritized qualifying recipients selected by the canonical
business/program authority enter paid validation. Retaining candidate evidence
is not queue admission. The useful-recipient limit is 1–3 per business/program;
invalid/rejected selections must release their own slot for eligible alternatives
without resetting vendor usage.

**Why:** The user explicitly distinguished accounting coverage from paid
dispatch and required rejected-slot replenishment rather than blanket validation.

**How to apply:** Reconcile all records locally, record not-selected dispositions,
and enforce concurrent pending reservations plus useful commitments before
admission or dispatch. Reuse fresh receipts without extending their expiry.

**Why:** The user repeatedly clarified that their question concerned the still-unfinished enrichment work, not GHL synchronization, and explicitly required one primary and at most two alternates per business. Calling this an older goal and answering with GHL import behavior was the wrong scope.

**How to apply:** Report recipient and distinct-business progress independently. GHL imports, provider completions, classification counts, and saved business details do not establish qualified enrichment output. Require the full evidence, validation, policy, CRM-link and paused-enrollment chain, and label partial checks as partial.