---
name: Collateral packet manual override
description: How manual packet-choice overrides were layered onto auto-match, and a bug pattern to watch for in truthful-state responses.
---

## Override precedence pattern
When adding a manual "override" option on top of an existing auto-match
resolver (e.g. packet-by-vertical, sequence-by-outcome), extract the
matching logic into one shared, exported helper that both the automated
caller and the new manual-override caller call. Precedence: explicit
override id > automated match > fallback. An override id that doesn't
resolve (deleted/inactive/typo'd) should fall through to the automated
match rather than erroring — treat it as "no preference" rather than "hard
fail".

**Why:** keeps auto and manual paths from drifting into two different
matching implementations over time, and avoids a bad override silently
breaking sends that would otherwise have succeeded via auto-match.

## Truthful-state bug: "resolved" vs "succeeded" are different facts
When a response reports a resolved-entity name (e.g. `packetName`,
`matchedSequenceName`) alongside a truthful outcome enum (sent/failed/etc.),
set the resolved-name field as soon as resolution succeeds — not only in
the "success" branch. It's easy to accidentally gate `packetName = x.name`
inside the `if (result.success)` block, which makes `packetName: null`
show up even when resolution worked fine and only the downstream send
failed. Caught via an end-to-end API test where a real provider error
(GHL 400) still needed to report which packet had been attempted.

**How to apply:** whenever adding a truthful-state enum response with a
companion "which thing was picked" field, write the companion field
immediately after resolution, before the try/catch around the actual send.
