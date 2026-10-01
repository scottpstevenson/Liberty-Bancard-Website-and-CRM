# SFP per-Publish build identity

## Purpose

Routine SFP previously required `REPL_DEPLOYMENT_ID`, but the project's supported
deployment environment does not supply that variable. A workspace ID or source
SHA cannot distinguish two Publishes of the same commit.

The build now mints a UUIDv4 once per build and embeds it, together with the
source SHA, into the server artifact. `dist/sfp-publish-build.json` records the
same tuple and `dist/RELEASE_SHA` records that artifact's SHA. This is an
**application-issued published build identity**, not a fabricated Replit
platform deployment ID.

The SFP deployment discriminator is `publish-build:<uuid>`. Replicas of one
artifact share it. A rebuild of the same SHA receives a new value. It is not
generated at startup, does not depend on PID or workspace identity, and cannot
be replaced through an ambient environment-variable override of the compiled
fields. A missing/malformed manifest or runtime SHA mismatch closes the
routine-SFP identity gate. Explicit real platform identities remain compatible
with deployments/tests that do not contain a per-build manifest.

## Verification and authority

Public health exposes the nonsecret `publishBuildId`. Build output records
`[SFP Publish Artifact]`; publisher-controlled runtime logs record
`[SFP Publish Artifact Loaded]`. The read-only admin release-selection endpoint
reports the full current tuple after the corrected artifact is published.

These fields identify the artifact; they **do not authorize it**. Before using
the audited selector:

1. Independently verify the actual publisher's successful release record and
   protected logs against the intended committed source/artifact.
2. Compare its SHA and recorded build UUID with live health and current runtime
   status. Health alone, an unsigned selector claim or an offline fixture is
   insufficient publisher verification.
3. Verify production database contracts, including selector/event guards.
4. Submit the real matching tuple through the existing admin/CSRF-protected
   selector with publisher evidence and exact previous-version/SHA CAS inputs.
5. Verify owner/job readiness. An unselected build cannot acquire ownership;
   after a transfer, a retired same-SHA build cannot renew/reacquire merely
   because a lease expires or the owner row is absent.

No automatic selection, migration, sending, unpause, financial-cap change or
production SQL mutation is part of this repair.

## Focused checks

```sh
npx tsx scripts/test-sfp-publish-build-identity.ts
npm run check -- --pretty false
npm run build
npx tsx scripts/test-sfp-publish-build-identity.ts --artifact
```

The source certification launcher also includes `publish-build-identity`.
Its tests cover unique same-SHA build IDs, shared replica identity, actual
compiled runtime binding, resistance to ambient overrides, invalid/missing
identity rejection, SHA mismatch, and retired/unselected build exclusion.

This source repair does not make it live until Publish, and does not restore
the production triggers/functions omitted by Publish. Task 2060 stays open
until real production output and replenishment are measured.