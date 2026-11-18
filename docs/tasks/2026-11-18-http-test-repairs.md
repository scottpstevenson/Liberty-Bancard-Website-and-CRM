# HTTP test repairs — November 18, 2026

Implemented on `codex/http-test-repairs` in `/Users/matt/Developer/liberty-http-test-repairs`. Independently inspected base: GitHub main `46abde0c0089b29c71ebca4790c62c2c5335e9c0`. Implementation: `1d85a3b80a4501bcba0c5ef8c0213746bafea75a`. This report is a subsequent documentation-only change.

## Findings and repairs

1. **Calendar application bug:** `getCalendarEventsByDateRange` interpolated raw JavaScript Dates into SQL against timestamp-without-time-zone columns. The locked pg driver serializes those parameters using the host timezone; the columns discard the offset. Drizzle writes these columns using UTC ISO timestamps. Bind both bounds through the calendar column encoder so reads and writes use the same representation. Preserve the existing exclusive upper boundary, overlap semantics and owner authorization. The HTTP regression now tests three request windows across UTC, New York and Kolkata process timezones, with real writes, reads and foreign-owner denials.
2. **Incorrect selected-task fixture:** C2 used a contact ID as a task ID and expected an absent-handler 501. The registered owner in `server/routes/tickets-tasks.ts` already implements scoped selected-task reads and correctly returns 404 for missing tasks. Test an explicitly absent task, then create a real task through the command endpoint and assert successful reads for its authorized employees, foreign-owner denial, nonemployee denial, malformed-ID rejection and access revocation after contact reassignment. No task handler or authorization guard was relaxed.
3. **Disposable database timezone:** After the first assertions were repaired, C4 exposed a chat snapshot mismatch and C2 exposed a past-go-live mismatch. The private initdb cluster inherited the Mac's timezone: default CURRENT_TIMESTAMP values in naive timestamp columns differed from UTC fixture writes. Start only the test-owned socket-only PostgreSQL process with `timezone=UTC`. Its real launcher integration test now verifies UTC despite a New York host and retains socket isolation and canonical dump/restore/catalog checks. Shared database and application settings are unchanged.

## Executed verification

Used the declared Node 22.22.0 and npm 10.9.4 runtime with the existing locked dependency installation. A fresh run against untouched current base reproduced both initial failures (0/2). Both complete suites then passed against the committed implementation and its recorded production-build identity:

- `NODE_ENV=production npm run build` passed; candidate identity was generated with the production recipe and pinned to implementation SHA `1d85a3b`.
- `node --import tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/test-stage3-c4-actions.ts --only scripts/test-stage3-c2-actions.ts` passed **2/2**: C4 **330 bounded HTTP cases** plus scoped assertions; C2 **138 actual HTTP assertions**. Child failures, suite setup/teardown failures and shared launcher failures were all zero.
- Actual `scripts/test-local-rehearsal-integration.ts` passed, including executable PostgreSQL integration, not a missing-binary skip.
- `scripts/test-local-rehearsal-core.ts`, `scripts/test-stage3-c2-contracts.ts` (286 counted assertions plus boundary checks), and `scripts/test-stage3-c4-contracts.ts` passed.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run check -- --incremental false` passed with zero TypeScript diagnostics.
- `git diff --check` passed.

The registered source handlers ran against private migrated PostgreSQL/Redis infrastructure with provider egress denied and outbound pause confirmed before the suites. The compiled artifact was verified by the fixture; this is not deployed bundled-server acceptance or a full release-roster approval.

Final logs are in `/Users/matt/.local/share/liberty-dev/logs/http-repairs-final-*.log`. Fresh HTTP evidence and build hashes are archived privately in `/Users/matt/.local/share/liberty-dev/http-repairs/`; the pre-existing tracked certification receipts were restored unchanged. Test-generated private VAPID signing material was removed from the worktree and excluded from Git.

## Operational boundaries

No GitHub push, Replit sync, publish, shared database migration, shared worker/app restart, production configuration change or outbound-control change was performed. GitHub main remained `46abde0` at the final remote check. Existing previews on localhost 5187 and 5188 both continued to return HTTP 200. Outbound remains paused; the repair does not require unpausing it.
