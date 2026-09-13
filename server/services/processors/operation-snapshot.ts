/**
 * Pure activation-snapshot resolution logic (REV-05A / REV-06A).
 *
 * This module MUST NOT import `server/db` (or anything that transitively
 * does). It exists specifically so DB-less callers — e.g. the REV-05A
 * kill-line CI check, which runs under the `deterministic-static` capability
 * with no DATABASE_URL in its environment — can exercise this resolution
 * logic without triggering `server/db.ts`'s eager
 * "DATABASE_URL must be set" throw at import time.
 *
 * `server/services/processors/registry.ts` re-exports `resolveOperationSnapshot`
 * from here for its own (DB-backed) callers; import from there for normal
 * application code. Import directly from this file only when you need the
 * pure function without pulling in the DB-backed module.
 */

/**
 * resolveOperationSnapshot — Pure resolver for per-operation snapshot precedence.
 *
 * Given a list of snapshots ordered newest-first, returns the newest row that
 * explicitly lists `requiredOperation` in its supportedOperations — regardless
 * of that row's status. The caller must then validate the returned row's status.
 *
 * Revocation semantics: a newer held/expired row that lists the operation
 * BLOCKS access to an older qualifying row for the same operation. Only a newer
 * snapshot that does NOT list the operation at all is invisible to this operation's
 * resolution — it neither grants nor revokes.
 *
 * Exported for deterministic unit testing (no DB dependency).
 */
export function resolveOperationSnapshot<T extends { status: string; supportedOperations: unknown }>(
  rowsNewestFirst: T[],
  requiredOperation: string,
): T | undefined {
  return rowsNewestFirst.find(r =>
    Array.isArray(r.supportedOperations) &&
    (r.supportedOperations as string[]).includes(requiredOperation)
  );
}
