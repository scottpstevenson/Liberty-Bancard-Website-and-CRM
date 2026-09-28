---
name: pre-deploy SHA-mismatch under concurrent workflows
description: run-pre-deploy.sh SHA verification fails even though RELEASE_SHA propagation to the child server works correctly in isolation
---

`scripts/run-pre-deploy.sh` starts its own `npm run dev &` and then compares
`/api/health`'s `sha` field to the `RELEASE_SHA` it exported. This step can
fail with `sha=unset` even when `RELEASE_SHA` is correctly set in the
wrapper's shell.

Verified by direct isolated test: starting the server manually with
`RELEASE_SHA=<sha> PORT=<free-port> npx tsx server/index.ts` (or via
`npm run dev`) on a port not used by any other workflow returns the correct
`sha` on `/api/health` every time. `BUILD_SHA` in `server/routes/sdr.ts` is
computed once at module load from `process.env.RELEASE_SHA` — the mechanism
itself is sound.

**Why:** the `.replit` `Project` meta-workflow runs `Start application` and
`pre-deploy` as sibling tasks that can both attempt to bind port 5000. The
wrapper's own "is port 5000 free" pre-flight check can race against that
orchestration, letting it start against a stale/contended server rather than
a clean one, producing the mismatch. This is unrelated to any application
code — confirmed via `git diff <base-sha> -- scripts/run-pre-deploy.sh
scripts/pre-deploy.ts server/routes/sdr.ts` showing zero changes.

**How to apply:** when `pre-deploy` fails specifically at the "SHA mismatch"
step (not at a suite failure), do not assume the app or a recent change broke
it. First confirm no other workflow is holding port 5000, or run
`run-pre-deploy.sh` with `Start application` stopped, before treating it as a
real regression.
