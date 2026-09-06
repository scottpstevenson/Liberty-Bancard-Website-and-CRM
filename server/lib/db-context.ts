/**
 * db-context.ts — AsyncLocalStorage store for DB observability context.
 *
 * Any code that runs within an Express request or a named BullMQ job can
 * call setDbContext() once; every subsequent pool.connect() on that same
 * async call-stack will automatically pick up the correlation ID and
 * normalized route without any explicit parameter threading.
 *
 * Background workers that are NOT inside an Express handler should call
 * setDbContext({ correlationId: "<job-name>", normalizedRoute: "BullMQ <job-name>" })
 * at the top of their processor function.
 */

import { AsyncLocalStorage } from "async_hooks";

export interface DbContext {
  /** Short random ID (nanoid/UUID prefix) tied to one HTTP request or BullMQ job run. */
  correlationId: string;
  /**
   * Human-readable source label.
   * For HTTP: "GET /api/contacts"
   * For BullMQ workers: "BullMQ sequence-worker"
   */
  normalizedRoute: string;
}

const _store = new AsyncLocalStorage<DbContext>();

export function setDbContext(ctx: DbContext): void {
  // Run the rest of the current async execution tree with this context.
  // Callers typically invoke this at the top of a middleware or job processor
  // and then call next() / await inside the run() callback.
  _store.enterWith(ctx);
}

export function getDbContext(): DbContext | undefined {
  return _store.getStore();
}

/**
 * Run `fn` within a fresh DB context.  Prefer this in tests and BullMQ
 * processors where enterWith() would bleed into sibling async operations.
 */
export function runWithDbContext<T>(ctx: DbContext, fn: () => T): T {
  return _store.run(ctx, fn);
}
