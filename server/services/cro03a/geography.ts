export const CRO03A_GEOGRAPHY_REFERENCE_VERSION = "south-florida-fips-v1";
export const CRO03A_COUNTY_FIPS = Object.freeze({
  Broward: "12011",
  "Miami-Dade": "12086",
  "Palm Beach": "12099",
} as const);
export const CRO03A_DISABLED_COUNTY_FIPS = Object.freeze({ Monroe: "12087" } as const);

export type GeographyEvidenceClass = "verified" | "zip_inferred" | "city_inferred" | "conflicting" | "unknown";
export type GeographyResult = {
  eligible: boolean;
  evidenceClass: GeographyEvidenceClass;
  county: string | null;
  countyFips: string | null;
  referenceVersion: string;
  inputs: { state: string | null; county: string | null; countyFips: string | null; zip: string | null; city: string | null };
  reasonCodes: string[];
};

const ZIP_COUNTY: Record<string, string[]> = {
  "33010": ["Miami-Dade"], "33101": ["Miami-Dade"], "33125": ["Miami-Dade"], "33130": ["Miami-Dade"],
  "33139": ["Miami-Dade"], "33166": ["Miami-Dade"], "33172": ["Miami-Dade"], "33299": ["Miami-Dade"],
  "33301": ["Broward"], "33304": ["Broward"], "33308": ["Broward"], "33311": ["Broward"],
  "33312": ["Broward"], "33316": ["Broward"], "33324": ["Broward"], "33351": ["Broward"],
  "33401": ["Palm Beach"], "33404": ["Palm Beach"], "33407": ["Palm Beach"], "33409": ["Palm Beach"],
  "33411": ["Palm Beach"], "33417": ["Palm Beach"], "33418": ["Palm Beach"], "33480": ["Palm Beach"],
};
const CITY_COUNTY: Record<string, string[]> = {
  miami: ["Miami-Dade"], "miami beach": ["Miami-Dade"], "coral gables": ["Miami-Dade"],
  homestead: ["Miami-Dade"], "hialeah": ["Miami-Dade"], "doral": ["Miami-Dade"],
  "fort lauderdale": ["Broward"], hollywood: ["Broward"], "pompano beach": ["Broward"],
  davie: ["Broward"], "coral springs": ["Broward"], "plantation": ["Broward"],
  "boca raton": ["Palm Beach"], "west palm beach": ["Palm Beach"], delray: ["Palm Beach"],
  "delray beach": ["Palm Beach"], boynton: ["Palm Beach"], "boynton beach": ["Palm Beach"],
  wellington: ["Palm Beach"], "lake worth": ["Palm Beach"],
};
const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
const fipsFor = (county: string | null) => county ? CRO03A_COUNTY_FIPS[county as keyof typeof CRO03A_COUNTY_FIPS] ?? CRO03A_DISABLED_COUNTY_FIPS[county as keyof typeof CRO03A_DISABLED_COUNTY_FIPS] ?? null : null;
const countyForFips = (fips: string | null) => Object.entries(CRO03A_COUNTY_FIPS).find(([, value]) => value === fips)?.[0]
  ?? Object.entries(CRO03A_DISABLED_COUNTY_FIPS).find(([, value]) => value === fips)?.[0] ?? null;
const canonicalCounty = (raw: unknown): string | null => {
  const value = normalize(raw);
  if (!value) return null;
  if (value === "miami dade" || value === "miami-dade" || value === "miami dade county") return "Miami-Dade";
  if (value === "broward" || value === "broward county") return "Broward";
  if (value === "palm beach" || value === "palm beach county") return "Palm Beach";
  if (value === "monroe" || value === "monroe county") return "Monroe";
  return countyForFips(value) ?? String(raw).trim();
};

export function evaluateSouthFloridaGeography(input: {
  state?: string | null; county?: string | null; countyFips?: string | null; zip?: string | null; city?: string | null;
}): GeographyResult {
  const state = input.state?.trim().toUpperCase() || null;
  const county = canonicalCounty(input.county);
  const countyFips = input.countyFips?.trim() || fipsFor(county);
  const zip = input.zip?.trim().match(/\d{5}/)?.[0] ?? null;
  const city = input.city?.trim() || null;
  const inputView = { state, county, countyFips, zip, city };
  if (state && state !== "FL") return { eligible: false, evidenceClass: "verified", county, countyFips, referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: ["STATE_NOT_FLORIDA"] };
  const countyFromFips = countyForFips(countyFips);
  const directCounty = countyFromFips ?? county;
  const zipCandidates = zip ? ZIP_COUNTY[zip] ?? (zip.startsWith("33") ? [] : []) : [];
  const cityCandidates = city ? CITY_COUNTY[normalize(city)] ?? [] : [];
  const directKnown = directCounty && (fipsFor(directCounty) || directCounty === "Monroe");
  if ((directKnown && countyFromFips && county && countyFromFips !== county) ||
      (directKnown && zipCandidates.length && !zipCandidates.includes(directCounty)) ||
      (directKnown && cityCandidates.length && !cityCandidates.includes(directCounty))) {
    return { eligible: false, evidenceClass: "conflicting", county: directCounty, countyFips: fipsFor(directCounty), referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: ["GEOGRAPHY_EVIDENCE_CONFLICT"] };
  }
  if (directKnown) {
    const eligible = Object.prototype.hasOwnProperty.call(CRO03A_COUNTY_FIPS, directCounty);
    return { eligible, evidenceClass: "verified", county: directCounty, countyFips: fipsFor(directCounty), referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: eligible ? ["COUNTY_FIPS_VERIFIED"] : ["COUNTY_DISABLED"] };
  }
  if (zipCandidates.length === 1) {
    const selected = zipCandidates[0];
    return { eligible: selected in CRO03A_COUNTY_FIPS, evidenceClass: "zip_inferred", county: selected, countyFips: fipsFor(selected), referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: [`ZIP_MAPPED_${fipsFor(selected)}`] };
  }
  if (cityCandidates.length === 1) {
    const selected = cityCandidates[0];
    return { eligible: selected in CRO03A_COUNTY_FIPS, evidenceClass: "city_inferred", county: selected, countyFips: fipsFor(selected), referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: [`CITY_MAPPED_${fipsFor(selected)}`] };
  }
  if (zipCandidates.length > 1 || cityCandidates.length > 1) {
    return { eligible: false, evidenceClass: "conflicting", county: null, countyFips: null, referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: ["AMBIGUOUS_REFERENCE_MAPPING"] };
  }
  return { eligible: false, evidenceClass: "unknown", county: null, countyFips: null, referenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION, inputs: inputView, reasonCodes: ["GEOGRAPHY_UNKNOWN"] };
}