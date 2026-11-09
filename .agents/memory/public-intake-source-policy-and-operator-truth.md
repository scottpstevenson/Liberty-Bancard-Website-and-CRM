---
name: Public intake source policy and operator-truth traps
description: Where new public intake modes must register, and why the statement-chain operator panel never showed truth
---

- Inbound policy effects are created at claim time from the claimed (category, sourceType), and the public claim middleware runs before body validation. A new intake mode that reuses the `get_started_form` source name inherits warm requested-followup/nurture effects. Register a new source as an additive policy outside the warm-lane map instead; warm admission refuses unlisted sources. Do not edit the frozen v2 list; prove per-source policy hashes are unchanged.
- A new source type must also be added to the contact-writer valid-source set, receipt labels, the lead-ops list labels, the form payload allowlists, and the recoverable-source list used by the recovery claim (which hard-codes a sales notification key, so support needs its own).
- `contacts.phone` is NOT NULL; the writer stores `""` for a missing number, and a true PEWC with no number throws. Optional phone means gating consent on a number, not just loosening Zod.
- `ticket_comments` has no idempotency key; the support notification has no command key or typed target. Per-effect dedupe for support needs its own keys.
- The statement-chain held step is returned/logged but never persisted (completion audit keeps only failed steps and allSuccess). The operator route filters audit action names the writer never emits, and the panel component is imported but not rendered. Derive held/manual truth from durable state (setting, inbound effect state, lifecycle reason, deal analysis status).
- SEO copy for a public page lives in both the React page and `shared/seo-routes.ts`; fix both.

**Why:** found during the W-C preflight; each trap is invisible from a grep of the form pages alone.
**How to apply:** check these before adding any public form mode, support effect, or operator status view.
