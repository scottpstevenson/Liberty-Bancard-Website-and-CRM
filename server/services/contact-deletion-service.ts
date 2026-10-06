/**
 * Product contact-erasure boundary.
 *
 * The previous implementation's two FK inventories disagreed with its delete
 * statements and omitted immutable consent/intake and cascaded task/ticket
 * authority events. Parent fixture class cannot authorize child/history erasure.
 *
 * Until the full FK + semantic + pending-work graph and shared writer fences are
 * certified, preview AND execution return the same explicit retention blocker.
 * No database connection or deletion is attempted, even by a direct caller.
 * Archive/restore remains available. Whole disposable-DB teardown is separate.
 */
import { blockedContactErasure } from "./contact-retention-policy";

export interface DependencyBlock {
  contactId: number;
  reason: string;
  details: string;
}
export interface InventoryResult {
  eligible: number[];
  blocked: DependencyBlock[];
}
export interface DeleteBatchResult {
  deleted: number;
  failed: Array<{ contactId: number; error: string }>;
}

export async function inventoryDependencies(contactIds: number[]): Promise<InventoryResult> {
  return { eligible: [], blocked: blockedContactErasure(contactIds) };
}

export async function coordinatePendingJobs(contactIds: number[]): Promise<{
  safe: number[]; blocked: DependencyBlock[];
}> {
  return { safe: [], blocked: blockedContactErasure(contactIds) };
}

export async function executeDeleteBatch(
  eligibleIds: number[], _operationId: string,
): Promise<DeleteBatchResult> {
  if (eligibleIds.length > 100) throw new Error("executeDeleteBatch: batch size must be ≤100");
  return { deleted: 0, failed: blockedContactErasure(eligibleIds).map(block => ({
    contactId: block.contactId, error: `${block.reason}: ${block.details}`,
  })) };
}
