---
name: ZeroBounce low-usage diagnosis
description: Why ZeroBounce credits sit unused despite a large balance; the supply funnel, the stranded-intent bug, and what is policy vs defect
---
ZeroBounce is the LAST step of the SFP funnel. Every spend path (validation intents and the operator campaign path) is gated by `currentCanonicalValidationSelection`: the contact needs a live prepared recipient (`cr04_enrollment_intents` pending_validation/ready_held bound to a paused enrollment). Credit balance, provider controls and the circuit are not the limiter (production: enabled, closed, ~3.8k of 50k local units used).

**Why:** user asked (Nov 2026) why a 45k balance was unused. Daily calls fell from hundreds (Oct 14-21, the upload-cohort drain) to a handful after Oct 24 because preparation fell from ~1.8k recipients/week to ~30/week.

Measured production funnel (Nov 10, dated snapshot): ~150k legacy contacts have no verified business link (never selectable); ~9.6k linked contacts; ~6.0k linked contacts have no preparation row. Of those only ~10 are fully qualified (program vertical AND in-territory). The rest: vertical excluded and in territory ~1.3k (policy), vertical unresolved and in territory ~0.8k (classification), ~1.6k vertical unresolved with no place data, ~0.7k vertical missing/geography unresolved, ~0.2k mapped vertical but geography unresolved. ~4.7k program-vertical Florida businesses have no email contact (email discovery gap; Serper window ~85% used by Nov 10).

**How to apply:** answer "why aren't credits used" from this funnel before suggesting budget/limit changes. Levers are upstream (classification, geography/place recovery, email discovery, contact-to-business linking, the owner-set vertical/territory scope), each an owner decision. Do not bypass the canonical selection gate for ZB spend.

Stranded-intent bug (fixed): `recoverValidationIntents` selected `processing` intents with an expired lease but `enqueueValidationIntent` only accepted `pending`, so ~22 intents sat `processing` since mid-Oct. BullMQ also keeps finished jobs under the static `validation-intent-<id>` id and silently ignores a re-add; the enqueue now drops a completed/failed retained job first.

Pending-validation holds that are intentional (not bugs): `ambiguous_billing` (~115) and `shared_address_validation_in_flight` (~68, re-deferred every cycle) protect against paid replays. The bounded one-retry recovery (admin preview/authorize routes under /api/lead-ops/zerobounce-recovery, no UI, table empty in prod) is the sanctioned way to spend on them. Intents whose address has a dead-domain prefilter (~25) never spend by design.
