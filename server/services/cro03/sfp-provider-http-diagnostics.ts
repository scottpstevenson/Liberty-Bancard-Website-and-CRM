/** Safe provider diagnostics only: never retain response bodies or error text. */
export type SfpApolloRequestKind = "organization_search" | "people_search" | "business_email_enrichment";
export interface SfpProviderHttpDiagnostics {
  httpStatus?: number;
  requestKind?: SfpApolloRequestKind;
  failureCode?: string | null;
}
const requestKinds = new Set(["organization_search", "people_search", "business_email_enrichment"]);
const validStatus = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;

export function safeSfpHttpClass(status: unknown): string | null {
  return validStatus(status) ? `${Math.floor(status / 100)}xx` : null;
}

export function sanitizeSfpProviderHttpDiagnostics(value: unknown): SfpProviderHttpDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const safe: SfpProviderHttpDiagnostics = {};
  if (validStatus(raw.httpStatus)) safe.httpStatus = raw.httpStatus;
  if (typeof raw.requestKind === "string" && requestKinds.has(raw.requestKind)) {
    safe.requestKind = raw.requestKind as SfpApolloRequestKind;
  }
  if (raw.failureCode === null) safe.failureCode = null;
  else if (validStatus(raw.httpStatus) &&
      (raw.failureCode === `APOLLO_HTTP_${raw.httpStatus}` ||
       (raw.failureCode === "APOLLO_PROVIDER_ERROR" && raw.httpStatus >= 200 && raw.httpStatus < 300))) {
    safe.failureCode = raw.failureCode as string;
  }
  return safe;
}

export function buildSfpProviderHttpDiagnostics(
  status: number, providerError: boolean, requestKind: SfpApolloRequestKind,
): SfpProviderHttpDiagnostics {
  if (!validStatus(status)) return {};
  return sanitizeSfpProviderHttpDiagnostics({
    httpStatus: status,
    requestKind,
    failureCode: status < 200 || status >= 300 ? `APOLLO_HTTP_${status}`
      : providerError ? "APOLLO_PROVIDER_ERROR" : null,
  });
}