export interface CanonicalImportOutcome {
  executionId: string;
  sourceRowNumber: number;
  disposition: string;
  reasonCode: string;
  contactId: number | null;
  businessId: number | null;
  fulfillmentState: string | null;
  nextAttemptAt: string | null;
  originalAvailable: boolean;
  completedAt: string;
}
export interface CanonicalEnrichmentStatus {
  observedAt: string;
  scope: "production_records_with_historical_work";
  contacts: { total: number; valid: number; unvalidated: number; blocked: number };
  businesses: { total: number; mapped: number; excluded: number; unresolved: number };
  preparations: { total: number; byState: Record<string, number>;currentAvailable:boolean };
  imports: { total: number; byState: Record<string, number> };
  providers: { total: number; byState: Record<string, number> };
  recentImportOutcomes: CanonicalImportOutcome[];
  importExceptions: CanonicalImportOutcome[];
  registryProjection: {
    total: number; fulfilled: number; held: number; processing: number; pending: number; sourceUnavailable:number;
    oldestPendingAt: string | null;
    recent: {itemId:string;importRunId:string;sourceSystem:string;state:string;
      reason:string|null;businessId:number|null;nextAttemptAt:string|null}[];
  };
  nativeContracts: { state: "verified" | "blocked"; reason: string | null };
  automaticProgress: {
    projection: {
      observed: boolean; scope: "all_record_classes"; verifiedCycles: number;
      businessCursor: number; contactCursor: number;
      populationBusinesses: number; populationContacts: number;
      businessesScanned: number; contactsScanned: number;
      lastCompletedCoverage: {
        startedAt: string; completedAt: string; businessHighWater: number; contactHighWater: number;
        populationBusinesses: number; populationContacts: number; businessesScanned: number;
        contactsScanned: number; businessesChanged: number; contactsChanged: number;
      } | null;
    };
    preparation: { observed: boolean; cycles: number; afterContactId: number; scanned: number;
      prepared: number; held: number; lastCycleAt: string | null; reasons: Record<string,number> };
    validation: { available:boolean;pending: number|null; processing: number|null; oldestPendingAt: string | null };
  };
  limitations: string[];
}