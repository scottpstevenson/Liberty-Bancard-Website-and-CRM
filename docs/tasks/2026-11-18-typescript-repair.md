# TypeScript repair — November 18, 2026

The current repository's 41 TypeScript diagnostics were reproduced and repaired on `codex/typescript-repair`, in `/Users/matt/Developer/liberty-typescript-repair`. Base: GitHub main `6a878c2478ba0b6bb19c6239f0e6e23f8d42fe18`. Implementation commit: `4b003c5d869de2e5c5ffbbff382129745b48c20d`. The subsequent report-only commit does not change application/test/configuration source.

No GitHub push, Replit sync, publication, database migration against a shared environment, provider request, outbound-control change or worker restart is part of this repair. The previously synchronized discovery checkout and both existing local previews are preserved.

## Causes and fixes

| File | Diagnostics | Cause and repair |
|---|---:|---|
| SelectedTaskPanel.test.tsx | 1 | The sparse delayed-response fixture was declared as a total Record, implying every numeric key contains a Promise. Use Partial<Record<…>> so absent promises are represented accurately. |
| MerchantApplicationsList.tsx | 1 | The shared Button has no `link` variant. Use the supported ghost variant with the intended link text styling; retain the scope toggle, handler and test ID. |
| server/db.ts | 1 | Drizzle's runtime `getTransactionConfigSQL` is internal and absent from its public declarations. Begin the transaction normally and apply nonempty options with public `setTransaction` before any callback query. Keep failed-BEGIN client destruction, rollback and release ownership. Empty options remain a normal default transaction. |
| routes/admin.ts | 2 | Express middleware inference widens route parameters to string or string array. Narrow the operation ID to a string before regex validation and receipt lookup. |
| routes/live-chat.ts | 2 | The same parameter union reaches session lookup. Reject a non-string parameter before the unchanged message/identify handlers. |
| routes/statement-review.ts | 32 | Thirty diagnostics come from async authorization not narrowing the caller's optional review value; two come from parameter unions. Explicit presence checks run after authorization, which retains responsibility for missing-record 404s. Narrow IDs before regex validation. Do not short-circuit authorization in a way that leaves missing requests unanswered. |
| deal-boarding-outbox-worker.ts | 1 | The complete-field validator did not communicate the required legal name to TypeScript. Make that existing required field explicit at the refusal and provider-call boundaries. No fabricated name, loosened completeness rule or activation bypass. |
| merchant-application-outbox-worker.ts | 1 | Property narrowing on a nullable contact ID is lost inside the queued callback. Capture the checked ID in a local constant before constructing the callback. Consent identity/effective time and claim fences are preserved. |

Locked environment: Node 22.22.0, npm 10.9.4; TypeScript 5.6.3; Express 5.2.1 with @types/express 5.0.6/core 5.1.1; Drizzle 0.45.2. No dependency, lockfile, tsconfig, compiler strictness or file-exclusion changes. No new suppression comments, non-null assertions or `any` casts were used to hide these diagnostics.

## Executed verification

Private logs are under `/Users/matt/.local/share/liberty-dev/logs/typescript-*.log`.

- Baseline compiler: 41 diagnostics across the eight files above, exit 2.
- Repaired compiler: zero diagnostics, exit 0. Final committed-source fresh check uses `NODE_OPTIONS=--max-old-space-size=6144 npm run check -- --incremental false`, rather than relying on an old incremental cache.
- Production build: `NODE_ENV=production npm run build`, exit 0; artifact SHA `4b003c5d869de2e5c5ffbbff382129745b48c20d`, build ID `faa900bf-5e7d-4098-be12-05addeeac5a2`. Existing nonfatal bundle-size/CJS import.meta warnings remain visible; build success is not a deployment claim.
- Real isolated pre-deploy runner: four selected suites passed with zero child/setup/teardown/launcher failures. Each has its own migrated PostgreSQL database and Redis namespace; external provider I/O is denied.
  - Transaction BEGIN release/configuration: 10 checks. Faulted BEGIN destruction, successful commit/release, callback rollback, configuration failure without callback execution, empty options, actual PostgreSQL serializable/read-only/deferrable settings and no option leakage.
  - New registered route boundary suite: 30 real HTTP checks using normal persisted sessions, CSRF and the global object guard. Missing/foreign reviews, authorized read/save/draft, optimistic conflict, malformed IDs, visitor message/identify and missing sessions, admin-only receipt reads. No external provider effects. This is scoped handler proof, not downstream scoring/communications execution.
  - Existing boarding worker: 76 checks, including payload fidelity, incomplete refusal, concurrent claims, ambiguous no-resubmit and secret-safe evidence.
  - Existing merchant outbox: 10 checks, including durable GHL handoff while outbound is paused and no false email completion.
- Existing mounted component tests: all four passed, including the delayed SelectedTaskPanel fixture.
- Existing work presentation: 93 checks passed.
- Existing contact/application contracts: 59 checks passed.
- Existing statement/inbox/task structural checks passed.
- CI capability manifest validates: 311 classifications, all 304 mandatory suites classified. The new route suite is registered in the actual mandatory, disposable-fixture and CI rosters. The transaction gate's description now reflects its real private PostgreSQL assertions.
- `git diff --check` passed.

## Broader failures independently compared

Two broader registered HTTP suites were run on the candidate and on a separate untouched main worktree (`/Users/matt/Developer/liberty-typescript-baseline`, same 6a878c2 base, no source changes). Both builds used the declared runtime and the production artifact identity recipe; each suite received private migrated infrastructure.

| Suite | Candidate and untouched-base result |
|---|---|
| test-stage3-c4-actions.ts | Both fail at line 97: the calendar query response omits the expected seeded event ID. This occurs before the statement-review cases. |
| test-stage3-c2-actions.ts | Both fail at line 90: the selected-task assertion expects 501 but receives 404/CRM_OBJECT_NOT_FOUND. |

These are confirmed matching baseline failures, not successful tests or a diagnosis of a production defect. Their underlying fixes are outside this TypeScript repair. Assertions were not weakened, skipped or changed to make them green. The full release roster was not run. A focused new suite directly exercises the affected routes without depending on those earlier failures.

The historical workbook recovery inputs discussed previously are independent of TypeScript compilation and were not fabricated or altered here. This branch resolves the compiler errors; it does not establish that every repository release check is green.
