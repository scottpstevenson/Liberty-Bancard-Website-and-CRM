---
name: Consent Authority & Channel State
description: Rules for canonical consent subjects, events, channel projections, PEWC evidence, and immutable history.
---

Consent, suppression, and reachability must flow through the canonical consent authority. A consent subject is deterministic by entity type and record id; canonical consent facts are immutable, versioned, namespaced events. Per-channel/per-purpose projections and global DNC are rebuilt from those facts, while legacy contact and SDR fields are compatibility outputs only.

**Why:** Direct route, webhook, import, wizard, and generic-update writers had conflicting interpretations of consent. In particular, address presence and delivery outcomes were incorrectly able to manufacture or erase permission.

**How to apply:** Never add direct writes to consent booleans, DNC, opt-outs, tiers, or delivery status as a proxy for consent. Use the authority command for permission/suppression and reachability observations for bounce/invalid outcomes. Preserve restrictive equal-time ordering and canonical event keys. PEWC must bind normalized current phone plus exact disclosure version/hash and project SMS plus automated-phone authorization in the same transaction. Generic contact updates must strip authority-owned fields.