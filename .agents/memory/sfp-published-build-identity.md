---
name: SFP published build identity
description: Routine SFP publish handoff, same-SHA identity, and the separate manual publisher-verification path.
---

An application-issued per-build UUID is a legitimate published-artifact
discriminator, not a claim that Replit assigned a platform deployment ID.
Workspace identity and source SHA cannot distinguish two Publishes of the same
commit. A new identity per worker startup would incorrectly split replicas.

**Why:** Requiring a custom platform-deployment variable stalled routine SFP
after successful publication. The supported environment did not supply that
variable, and the available deployment metadata exposed no deployment ID to
retrieve. Generating identity in the build avoids asking the user to discover
an undocumented platform identifier while preserving same-SHA redeploy fencing.

**How to apply:** Keep identity bound to the real build artifact and shared by
replicas. Routine production publishes automatically advance the audited
selector and owner together under the user-approved publish policy. This is
published-artifact admission, not fabricated independent publisher evidence.
Manual selection still requires independently reviewed publisher evidence.
Database/job fencing, provider spending and outbound gates still apply.

Routine publishing must not leave SFP work held until someone manually selects
the new SHA.

**Why:** The user explicitly required and approved automatic audited handoff,
with deliberate pauses, budgets and send approvals preserved.

**How to apply:** Require a compiled SHA-bound build identity/time and the
documented published-runtime flag. Retired identities cannot reselect, and
unknown older builds cannot advance past immutable build history or a manual
selection. Manual rollback stays effective until a genuinely newer build;
rebuilding older source intentionally creates a new publish identity/time.
Never let lease expiry, process restart or a same-SHA replica mint release
authority. A revoked owner requires explicit operator transfer, not revival.