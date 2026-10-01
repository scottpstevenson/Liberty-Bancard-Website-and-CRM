---
name: SFP published build identity
description: Why SFP uses an application-issued per-Publish identity while keeping publisher verification separate.
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

**How to apply:** Keep the identity bound to the real build artifact and shared
by its replicas. Independently verify the publisher's release evidence before
audited selection. The build UUID, public health or an unsigned selector claim
alone is never execution authority. Database and job/owner gates still apply.