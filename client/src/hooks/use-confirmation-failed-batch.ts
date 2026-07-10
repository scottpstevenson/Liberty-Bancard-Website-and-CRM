/**
 * client/src/hooks/use-confirmation-failed-batch.ts
 *
 * Batch hook for checking which contacts have a current "failed" confirmation status.
 * Designed for the Contacts list and Pipeline board — never fires one request per row.
 *
 * Key design guarantees:
 *  - Deterministic query key: IDs are filtered, deduplicated, and sorted ascending.
 *    Same ID set regardless of arrival order → same cache key → no spurious refetch.
 *  - Chunking: splits into ≤200-ID chunks and fires all in parallel.
 *    201 unique IDs → two requests (200 + 1), merged into one Map.
 *  - Loading/error policy: while any chunk is loading, or on error, returns an empty
 *    Map so no stale badges are shown. No partial results are surfaced.
 *  - Does not fire when contactIds is empty.
 */

import { useQueries } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";

const CHUNK_SIZE = 200;

export interface ConfirmationFailedStatus {
  status: "failed";
  submissionId: string;
  timestamp: string;
  formType: string | null;
  reason: string | null;
}

interface BatchResult {
  statuses: Record<string, ConfirmationFailedStatus | null>;
}

async function fetchChunk(ids: number[]): Promise<BatchResult> {
  const token = getCsrfToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-csrf-token"] = token;
  const res = await fetch("/api/contacts/confirmation-status/batch", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ contactIds: ids }),
  });
  if (!res.ok) throw new Error(`Batch confirmation status failed: ${res.status}`);
  return res.json();
}

function prepareIds(raw: (number | null | undefined)[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of raw) {
    if (id == null || !Number.isInteger(id) || id <= 0) continue;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  result.sort((a, b) => a - b);
  return result;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Returns a Map<contactId, ConfirmationFailedStatus> for contacts with a current
 * "failed" confirmation. Empty map while loading or on error (hide-on-loading policy).
 */
export function useConfirmationFailedBatch(
  rawIds: (number | null | undefined)[],
): {
  failedMap: Map<number, ConfirmationFailedStatus>;
  isLoading: boolean;
} {
  const ids = prepareIds(rawIds);
  const chunks = ids.length > 0 ? chunkArray(ids, CHUNK_SIZE) : [];

  const queries = useQueries({
    queries: chunks.map((chunkIds) => ({
      queryKey: ["/api/contacts/confirmation-status/batch", chunkIds],
      queryFn: () => fetchChunk(chunkIds),
      enabled: chunkIds.length > 0,
      retry: false,
      staleTime: 30_000,
    })),
  });

  if (chunks.length === 0) {
    return { failedMap: new Map(), isLoading: false };
  }

  const isLoading = queries.some((q) => q.isLoading);
  const hasError = queries.some((q) => q.isError);

  if (isLoading || hasError) {
    return { failedMap: new Map(), isLoading };
  }

  const failedMap = new Map<number, ConfirmationFailedStatus>();
  for (const q of queries) {
    if (!q.data) continue;
    for (const [idStr, status] of Object.entries(q.data.statuses)) {
      if (status && status.status === "failed") {
        failedMap.set(Number(idStr), status);
      }
    }
  }

  return { failedMap, isLoading: false };
}
