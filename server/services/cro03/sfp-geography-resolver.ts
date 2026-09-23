/**
 * sfp-geography-resolver.ts
 *
 * Deterministic, versioned, all-location geography resolver for the South
 * Florida Prospecting program. Replaces the ad-hoc single-Map lookups built
 * from unordered SQL in roi-cohort-selector.ts, which picked a "county for
 * this business" from whichever `business_locations` row happened to be
 * last into the Map, with no stable tiebreak and no persisted evidence of
 * which location/row actually decided the outcome.
 *
 * This resolver evaluates EVERY `business_locations` row for a business
 * (falling back to the `businesses` table's own city/state/postal_code when
 * a business has no location rows) and picks exactly one winner using a
 * fixed, deterministic authority order:
 *
 *   1. Evidence authority — verified > zip_inferred > city_inferred >
 *      conflicting > unknown (per server/services/cro03a/geography.ts
 *      evidenceClass semantics).
 *   2. Primary-location flag — among tied-authority candidates, a row with
 *      `is_primary = true` wins.
 *   3. Lowest stable location ID — final deterministic tiebreak.
 *
 * The pure decision function takes already-fetched location rows so it can
 * be exercised by the disposable certification suite with zero database
 * access, while the async wrapper does the one real query needed in
 * production.
 */

import { sql } from "drizzle-orm";
import {
  evaluateSouthFloridaGeography,
  type GeographyEvidenceClass,
} from "../cro03a/geography";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

/** Bump whenever the authority order, tiebreak rule, or evaluator changes. */
export const GEOGRAPHY_RESOLVER_VERSION = 2 as const;

export type GeographyResolutionOutcome = "resolved" | "outside_territory" | "conflicting" | "unresolved";

export interface LocationCandidateInput {
  /** null for the synthetic businesses-table fallback candidate (no location row). */
  locationId: number | null;
  isPrimary: boolean;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countyFips: string | null;
}

export interface GeographyResolution {
  resolverVersion: typeof GEOGRAPHY_RESOLVER_VERSION;
  outcome: GeographyResolutionOutcome;
  eligible: boolean;
  evidenceClass: GeographyEvidenceClass | null;
  county: string | null;
  countyFips: string | null;
  /** The `business_locations.id` that won, or null when resolved from the businesses-table fallback. */
  winningLocationId: number | null;
  candidatesEvaluated: number;
  reasons: string[];
}

const AUTHORITY_RANK: Record<GeographyEvidenceClass, number> = {
  verified: 4,
  zip_inferred: 3,
  city_inferred: 2,
  conflicting: 1,
  unknown: 0,
};

/**
 * Pure decision function: evaluate every candidate location, then select the
 * winner by (evidence authority DESC, isPrimary DESC, locationId ASC — with
 * the synthetic fallback candidate, locationId=null, always sorting after
 * any real location ID at equal authority/primary rank).
 */
export function resolveGeographyFromCandidates(candidates: LocationCandidateInput[]): GeographyResolution {
  if (candidates.length === 0) {
    return {
      resolverVersion: GEOGRAPHY_RESOLVER_VERSION,
      outcome: "unresolved",
      eligible: false,
      evidenceClass: null,
      county: null,
      countyFips: null,
      winningLocationId: null,
      candidatesEvaluated: 0,
      reasons: ["NO_LOCATION_CANDIDATES"],
    };
  }

  const evaluated = candidates.map((c) => ({
    candidate: c,
    result: evaluateSouthFloridaGeography({
      state: c.state, countyFips: c.countyFips, zip: c.postalCode, city: c.city,
    }),
  }));

  // Correction 6: a business that has ANY real, eligible South Florida
  // location must not have that qualifying location erased by an
  // out-of-territory HQ/primary location. `evidenceClass` alone is not
  // enough to decide the winner — "verified" applies equally to a
  // confidently-resolved OUTSIDE-territory location (e.g. a known non-FL
  // state) and a confidently-resolved INSIDE-territory one, so ranking by
  // authority alone (as before) let an outside-territory primary location
  // with tied authority beat an eligible, in-territory branch location on
  // the isPrimary tiebreak — silently dropping a real South Florida
  // presence. Eligibility is now the first sort key: any eligible
  // candidate always outranks every ineligible one, regardless of which is
  // flagged primary. Only among candidates that agree on eligibility does
  // the original (authority DESC, isPrimary DESC, lowest-id) order apply.
  evaluated.sort((a, b) => {
    const eligibleDelta = Number(b.result.eligible) - Number(a.result.eligible);
    if (eligibleDelta !== 0) return eligibleDelta;
    const authorityDelta = AUTHORITY_RANK[b.result.evidenceClass] - AUTHORITY_RANK[a.result.evidenceClass];
    if (authorityDelta !== 0) return authorityDelta;
    const primaryDelta = Number(b.candidate.isPrimary) - Number(a.candidate.isPrimary);
    if (primaryDelta !== 0) return primaryDelta;
    // Lowest stable location ID wins; the synthetic fallback (id=null) sorts last.
    const idA = a.candidate.locationId ?? Number.MAX_SAFE_INTEGER;
    const idB = b.candidate.locationId ?? Number.MAX_SAFE_INTEGER;
    return idA - idB;
  });

  const winner = evaluated[0];
  const evidenceClass = winner.result.evidenceClass;

  let outcome: GeographyResolutionOutcome;
  if (evidenceClass === "verified" || evidenceClass === "zip_inferred" || evidenceClass === "city_inferred") {
    outcome = winner.result.eligible ? "resolved" : "outside_territory";
  } else if (evidenceClass === "conflicting") {
    outcome = "conflicting";
  } else {
    outcome = "unresolved";
  }

  return {
    resolverVersion: GEOGRAPHY_RESOLVER_VERSION,
    outcome,
    eligible: winner.result.eligible,
    evidenceClass,
    county: winner.result.county,
    countyFips: winner.result.countyFips,
    winningLocationId: winner.candidate.locationId,
    candidatesEvaluated: candidates.length,
    reasons: [
      ...winner.result.reasonCodes,
      `SELECTED_BY:authority=${evidenceClass},isPrimary=${winner.candidate.isPrimary},locationId=${winner.candidate.locationId ?? "fallback"}`,
    ],
  };
}

/**
 * Fetch every `business_locations` row for a business plus its own
 * city/state/postal_code as a fallback candidate, then resolve.
 */
export async function resolveGeographyForBusiness(
  businessId: number,
  exec: { execute: (q: any) => Promise<any> },
): Promise<GeographyResolution> {
  const locationRows = rowsOf(await exec.execute(sql`
    SELECT id, is_primary, city, state, postal_code, county_fips
    FROM business_locations
    WHERE business_id = ${businessId}
  `));

  const businessRow = rowsOf(await exec.execute(sql`
    SELECT city, state, postal_code
    FROM businesses
    WHERE id = ${businessId}
  `))[0];

  const candidates: LocationCandidateInput[] = locationRows.map((r: any) => ({
    locationId: Number(r.id),
    isPrimary: Boolean(r.is_primary),
    city: r.city ?? null,
    state: r.state ?? null,
    postalCode: r.postal_code ?? null,
    countyFips: r.county_fips ?? null,
  }));

  // Always include the businesses-table fallback candidate (locationId=null)
  // so a business with zero location rows — or with location rows that all
  // resolve worse than its own top-level fields — is still evaluated fairly.
  if (businessRow) {
    candidates.push({
      locationId: null,
      isPrimary: false,
      city: businessRow.city ?? null,
      state: businessRow.state ?? null,
      postalCode: businessRow.postal_code ?? null,
      countyFips: null,
    });
  }

  return resolveGeographyFromCandidates(candidates);
}
