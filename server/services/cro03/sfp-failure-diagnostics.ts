/** Preserve bounded driver metadata, never SQL, parameters, or raw messages. */
export function safeSfpFailureDiagnostics(error: unknown): {
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  column: string | null;
  domainCode: string | null;
} {
  const result = {
    sqlState: null as string | null,
    constraint: null as string | null,
    table: null as string | null,
    column: null as string | null,
    domainCode: null as string | null,
  };
  let current: any = error;
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = String(current.code ?? "");
    if (!result.sqlState && /^[0-9A-Z]{5}$/.test(code)) result.sqlState = code;
    for (const key of ["constraint", "table", "column"] as const) {
      const value = current[key];
      if (!result[key] && typeof value === "string" && /^[a-z_][a-z0-9_]{0,127}$/.test(value)) {
        result[key] = value;
      }
    }
    const domainCode = String(current.message ?? "").match(/^(SFP_[A-Z0-9_]+)(?=[:\s]|$)/)?.[1];
    if (!result.domainCode && domainCode && domainCode.length <= 120) result.domainCode = domainCode;
  }
  return result;
}

/** Canonical scheduled steps use the same bounded driver metadata. In particular,
 * Drizzle's outer message is SQL plus parameters and must never be logged here. */
export function safeCanonicalEnrichmentFailureDiagnostics(error: unknown) {
  const diagnostic = safeSfpFailureDiagnostics(error);
  let failureKind: string | null = null;
  let transactionPhase: string | null = null;
  let current: any = error;
  for (let depth=0; current && depth<4; depth++,current=current.cause) {
    if (["preparation_owner_claim","preparation_commit","preparation_cursor_claim","preparation_retirement",
      "link_owner_claim","link_bootstrap","link_cursor_claim","link_commit",
      "import_owner_claim","import_cursor_claim","import_finalize","import_failure"]
        .includes(current.canonicalTransactionPhase)) transactionPhase=current.canonicalTransactionPhase;
    const message=String(current.message ?? "");
    const domainCode=message.match(/^(CANONICAL_[A-Z0-9_]+|COMMERCIAL_[A-Z0-9_]+|CONTACT_LINK_[A-Z0-9_]+)(?=[:\s]|$)/)?.[1];
    if (!diagnostic.domainCode && domainCode && domainCode.length<=120) diagnostic.domainCode=domainCode;
    if (/timeout exceeded when trying to connect|connection timeout/i.test(message)) failureKind="connection_timeout";
    else if (/connection terminated|connection closed/i.test(message)) failureKind="connection_terminated";
  }
  return {...diagnostic,failureKind,transactionPhase};
}