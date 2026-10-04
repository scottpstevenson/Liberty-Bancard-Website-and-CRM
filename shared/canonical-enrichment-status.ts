export interface CanonicalEnrichmentStatus {
  observedAt: string;
  scope: "production_records_with_historical_work";
  contacts: { total: number; valid: number; unvalidated: number; blocked: number };
  businesses: { total: number; mapped: number; excluded: number; unresolved: number };
  preparations: { total: number; byState: Record<string, number> };
  imports: { total: number; byState: Record<string, number> };
  providers: { total: number; byState: Record<string, number> };
  nativeContracts: { state: "verified" | "blocked"; reason: string | null };
  limitations: string[];
}