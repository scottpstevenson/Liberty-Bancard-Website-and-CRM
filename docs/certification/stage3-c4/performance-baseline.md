# C4 matched-performance baseline

`scripts/test-stage3-c4-browser.ts` finishes with two comparisons against the original production build:
matched Portfolio performance (`scripts/fixtures/stage3-c4-matched-performance.ts`) and the bundled-server
rollback (`scripts/fixtures/stage3-c4-bundled-rollback.ts`). Both read the baseline from
`generated-artifacts/c4-performance-baseline`.

## Reference commit

The baseline is the production build of commit `85296699ec8d11f22750657dfe5ac34a8fd2577d`, recorded as
`C4_PERFORMANCE_BASELINE_COMMIT` in `scripts/fixtures/c4-performance-baseline.ts`. The suite refuses a baseline
whose `dist/candidate-integrity.json` names another commit, whose emitted files no longer match their recorded
hashes, or whose emitted client scripts contain React's development build or Vite's development JSX transform.
The reference commit's receipt records no build mode, so the emitted client is inspected. The same check decides
whether the build script keeps an existing baseline or rebuilds it.

## Building it

```
npx tsx scripts/build-c4-performance-baseline.ts          # keeps a verified baseline, otherwise rebuilds
npx tsx scripts/build-c4-performance-baseline.ts --force  # always rebuilds
```

The script checks out the reference commit as a detached Git worktree, links the workspace `node_modules`, and
compiles it in production mode. It takes about 40 seconds. The reference commit's `script/build.ts` does not set
`NODE_ENV` itself, so the script sets it; a compile under `NODE_ENV=test` would emit React's development build.
Under `VG_PROVIDER_DENY_MODE=1` (CI) the compile also runs with the compiler-only deny preload, and runs
`script/build.ts` through tsx's loader because the preload blocks the tsx CLI's own IPC socket in a
production-mode process. The directory is inside the workspace, so it survives a
restart, and `/generated-artifacts/` is ignored by Git and by deployment. CI runs the same script
(`ci.yml`, `c4-acceptance.yml`).

The suite never compiles the baseline itself, because the disposable certification runner denies production
compilation. Build it first:

```
npx tsx scripts/build-c4-performance-baseline.ts
NODE_ENV=production npm run build        # candidate; rebuild after any change under scripts/
npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/test-stage3-c4-browser.ts
```

## What "matched" compares

Both runs serve the workspace's API; only the client assets differ. The Portfolio reader
(`server/routes/portfolio.ts`) runs raw SQL through the pool and imports neither `shared/schema.ts` nor
`server/storage.ts`, and those two files have changed since the reference commit for unrelated work. The suite
therefore requires `server/routes/portfolio.ts` to be byte-identical to the baseline's and the table definitions
the reader queries (`contacts`, `merchantMids`, `deals`, `merchantHealthScores`, `tickets`, `tasks`) to be
unchanged in `shared/schema.ts`.
