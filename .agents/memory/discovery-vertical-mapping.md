---
name: Discovery vertical classification mapping
description: How canonical (granular) verticals coexist with the coarse classifyVertical() bucket for SDR discovery leads, and where each is read.
---

Two parallel vertical concepts exist on purpose and must not be merged:

- **Coarse bucket** (`classifyVertical()` output, stored in `sdrMerchants.vertical` / `sdrLeadState.vertical`): used by calendar routing (`scheduling.ts`), GHL custom-field sync (`ghl-sync-rules.ts`), and chat/smart-reply generation. Do not repoint these callers at the canonical vertical — they expect the coarse label shape.
- **Canonical vertical** (`normalizeDiscoveryVertical()` output, stored in `sdrMerchants.subvertical`): matches the exact vertical label strings used by `smart-router.ts` ROUTING_RULES (e.g. "Med Spa" vs. the coarse "Salon/Spa"/"Healthcare" buckets it would otherwise fall into). Used when promoting a lead to a contact so `contacts.vertical` carries the granular label smart-router needs.

**Why:** `classifyVertical()` intentionally collapses distinct high-value verticals (Med Spa, Dental) into generic buckets (Salon/Spa, Healthcare) for its original consumers. Campaign routing needs the granular distinction, so a second mapper was added alongside it rather than changing the original — changing `classifyVertical()` would have silently broken calendar/GHL-sync/chat-reply behavior.

**How to apply:** When adding a new call site that needs vertical info, check which of the two behaviors it wants before wiring it up. Contact/campaign-routing code should prefer `merchant.subvertical` (canonical) with fallback to the coarse `vertical` field. Anything touching calendars, GHL custom fields, or auto-reply tone should keep using the coarse `classifyVertical()`-derived value. Note: `server/services/sdr/orchestrator.ts` inbox-tagging (sendEmailStep/sendSmsStep) still uses the coarse `lead.vertical` for sequence-name resolution — this was left as a known gap (see follow-up task), not an oversight.
