---
name: Destination-local selected context
description: Retain selected-record context only within its typed destination, not every sibling workspace.
---
Aliases and child selectors must explicitly preserve the destination's existing selected-record format. Do not infer a new key from an entity name or assume a global context allowlist includes it.

**Why:** Selected-record identity can use a generic key whose meaning is supplied by the destination. Globally carrying that key into sibling readers can reinterpret the same integer in another namespace; dropping it loses the exact authorized context.

**How to apply:** Inspect the existing selected-record reader before extending navigation. Retain malformed/conflicting inputs so the reader denies them without a default request; closing removes only that destination's selected identity. Test alias, selection, reload and closing against the exact reader.
