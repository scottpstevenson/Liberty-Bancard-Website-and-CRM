/**
 * Typed, read-only contract of the derived catalog (Stage 4A). Shared by the server derivation and the dashboard so the
 * screen renders exactly what the API returns. No values are computed here.
 */
export type CatalogClass = "current" | "template" | "historical" | "uninstalled" | "unresolved";
export type ReadinessValue = "yes" | "no" | "unavailable";
export interface ReadinessFact { state: ReadinessValue; basis: string }
/**
 * Facts are deliberately separate and none implies another: `configured` is installation only (the pins resolve),
 * `selected` is package-current selection, `contentVerified` and `qualified` rest on read content/hash evidence,
 * `statusActive` is only a status/pause reading, `runtimeSelected` is the profile selection of the serving process,
 * and `operationalEvidence` / `nativeEffectVerified` stay unavailable until their own receipts are read.
 */
export interface CatalogReadiness {
  configured: ReadinessFact;
  selected: ReadinessFact;
  contentVerified: ReadinessFact;
  qualified: ReadinessFact;
  paused: ReadinessFact;
  statusActive: ReadinessFact;
  runtimeSelected: ReadinessFact;
  operationalEvidence: ReadinessFact;
  nativeEffectVerified: ReadinessFact;
}

export interface CatalogAsset {
  kind: "campaign" | "sequence";
  id: number;
  name: string;
  catalogClass: CatalogClass;
  reason: string;
  /** Package versions that pin this asset (any lifecycle). */
  pinnedBy: { packageVersionId: string; packageKey: string; lifecycleState: string }[];
  retiredAt: string | null;
}

export interface CatalogPackage {
  packageKey: string;
  vertical: string;
  packageVersionId: string;
  lifecycleState: string;
  catalogClass: CatalogClass;
  /** Why an unresolved class was assigned (pin conflict), otherwise the lifecycle that decided it. */
  classReason: string;
  campaignId: number;
  sequenceId: number;
  pinsResolved: boolean;
  readiness: CatalogReadiness;
}

export interface CatalogTruth {
  asOf: string;
  scope: "full_catalog_whole_population";
  available: boolean;
  unavailableReason: string | null;
  packages: CatalogPackage[];
  campaigns: CatalogAsset[];
  sequences: CatalogAsset[];
  /** Plan entries with no installed package row. Empty when the plan source is not supplied. */
  uninstalledPackageKeys: string[];
  counts: Record<CatalogClass, number> | null;
  cr06: { governedArtifacts: number | null; state: "empty" | "populated" | "unavailable"; note: string };
  cro07: { productionConnected: boolean; note: string };
  /** status='active' sequences are reported as a raw count only and are never readiness proof. */
  statusActiveSequences: { count: number | null; note: string };
}
