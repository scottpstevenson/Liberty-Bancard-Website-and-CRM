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