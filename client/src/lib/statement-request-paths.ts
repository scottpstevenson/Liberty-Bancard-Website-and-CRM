/**
 * Exact paths between a retained website statement request and its analyst
 * review. The request side carries the retained document id; the review side
 * resolves the request's short reference server-side from the recorded upload
 * command. No name, contact or time-window matching is ever used, and a path
 * that finds nothing says so instead of opening another record.
 */
const INT_MAX = 2147483647;

export function documentIdFromSearch(search: string): number | null {
  const values = [...new Set(new URLSearchParams(search).getAll("documentId"))];
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const id = Number(values[0]);
  return Number.isSafeInteger(id) && id <= INT_MAX ? id : null;
}

/** Statements destination for a retained document (`/dashboard/statement-review?documentId=`). */
export function statementReviewHref(documentId: number): string {
  if (!Number.isSafeInteger(documentId) || documentId <= 0 || documentId > INT_MAX) throw new Error("Invalid document id");
  return `/dashboard/statement-review?documentId=${documentId}`;
}

/** Website request destination: the list, or exactly the request whose short reference is `ref`. */
export function websiteRequestHref(ref: string | null): string {
  if (ref === null) return "/dashboard/lead-ops?tab=pipeline";
  const value = ref.trim().toUpperCase();
  if (!/^[0-9A-F]{4,8}$/.test(value)) throw new Error("Invalid request reference");
  return `/dashboard/lead-ops?tab=pipeline&ref=${value}`;
}
