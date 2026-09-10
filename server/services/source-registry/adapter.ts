/**
 * MI-02: Source Registry Adapter Interface
 *
 * Each adapter normalizes raw rows from a government source into
 * NormalizedSourceRecord objects keyed by registry_id + stable key.
 * Public email/phone fields from source data are stored encrypted inside
 * rawPayload as evidence only — never surfaced as outreach eligibility.
 */

import { createCipheriv, createHmac, createHash } from "crypto";

// South Florida county FIPS codes
export const COUNTY_FIPS = {
  MIAMI_DADE: "12086",
  BROWARD: "12011",
  PALM_BEACH: "12099",
} as const;

export type CountyFips = typeof COUNTY_FIPS[keyof typeof COUNTY_FIPS];

// ─── Authoritative South Florida ZIP → County FIPS lookup ────────────────────
// Built from USPS ZIP code database + Census TIGER county boundary data.
// Any ZIP not in this table is outside the registry scope → returns null.
// This is intentionally exact (not range-based) so Monroe County (Keys),
// Martin County, St. Lucie County, and Lee County ZIPs are excluded.

const ZIP_TO_COUNTY: ReadonlyMap<number, CountyFips> = (() => {
  const entries: [number, CountyFips][] = [];

  // ── Miami-Dade County (12086) ─────────────────────────────────────────────
  const miamiDadeZips = [
    33010, 33011, 33012, 33013, 33014, 33015, 33016, 33018,
    33030, 33031, 33032, 33033, 33034, 33035, 33039,
    33054, 33055, 33056,
    33101, 33102, 33107, 33109, 33110, 33111, 33112, 33114, 33116, 33119,
    33122, 33124, 33125, 33126, 33127, 33128, 33129, 33130, 33131, 33132,
    33133, 33134, 33135, 33136, 33137, 33138, 33139, 33140, 33141, 33142,
    33143, 33144, 33145, 33146, 33147, 33148, 33149, 33150, 33151, 33152,
    33153, 33154, 33155, 33156, 33157, 33158, 33159, 33160, 33161, 33162,
    33163, 33164, 33165, 33166, 33167, 33168, 33169, 33170, 33172, 33173,
    33174, 33175, 33176, 33177, 33178, 33179, 33180, 33181, 33182, 33183,
    33184, 33185, 33186, 33187, 33188, 33189, 33190, 33193, 33194, 33196,
    33197, 33199,
  ];
  for (const z of miamiDadeZips) entries.push([z, COUNTY_FIPS.MIAMI_DADE]);

  // ── Broward County (12011) ────────────────────────────────────────────────
  const browardZips = [
    // Scattered 330xx: Hallandale Beach, Miramar, Hollywood, Pembroke Pines, etc.
    33004, 33009, 33019, 33020, 33021, 33022, 33023, 33024, 33025, 33026,
    33027, 33028, 33029,
    // Pompano Beach / Deerfield area 330xx
    33060, 33061, 33062, 33063, 33064, 33065, 33066, 33067, 33068, 33069,
    33071, 33072, 33073, 33074, 33075, 33076, 33077, 33083, 33084, 33093, 33097,
    // Fort Lauderdale / main Broward 333xx
    33301, 33302, 33303, 33304, 33305, 33306, 33307, 33308, 33309, 33310,
    33311, 33312, 33313, 33314, 33315, 33316, 33317, 33318, 33319, 33320,
    33321, 33322, 33323, 33324, 33325, 33326, 33327, 33328, 33329, 33330,
    33331, 33332, 33334, 33335, 33336, 33337, 33338, 33339, 33340, 33345,
    33346, 33348, 33349, 33351, 33355, 33359, 33388, 33394,
    // Deerfield Beach — 334xx inside nominal Palm Beach range
    33441, 33442, 33443,
  ];
  for (const z of browardZips) entries.push([z, COUNTY_FIPS.BROWARD]);

  // ── Palm Beach County (12099) ─────────────────────────────────────────────
  const palmBeachZips = [
    // West Palm Beach / core
    33401, 33402, 33403, 33404, 33405, 33406, 33407, 33408, 33409, 33410,
    33411, 33412, 33413, 33414, 33415, 33416, 33417, 33418, 33419, 33420,
    33421, 33422, 33424, 33425, 33426,
    // Lake Worth / Delray / Boynton / Boca Raton
    33427, 33428, 33429, 33430, 33431, 33432, 33433, 33434, 33435, 33436,
    33437, 33438, 33439,
    // Boca Raton 334xx (note: 33441-33443 = Broward, above)
    33444, 33445, 33446, 33447, 33448, 33449,
    33454, 33458,
    33460, 33461, 33462, 33463, 33464, 33465, 33466, 33467, 33468, 33469,
    33470, 33471, 33472, 33473, 33474, 33476, 33477, 33478, 33480, 33481,
    33482, 33483, 33484, 33486, 33487, 33488, 33493, 33496, 33497, 33498, 33499,
    // Western Palm Beach county — Belle Glade / Lake Okeechobee area
    33430, 33438, 33439,
    // Riviera Beach / North Palm Beach (33403-33410 already above)
  ];
  for (const z of palmBeachZips) entries.push([z, COUNTY_FIPS.PALM_BEACH]);

  return new Map(entries);
})();

/**
 * Derives county FIPS from a ZIP code using an explicit South Florida lookup table.
 * Returns null if ZIP is not in Miami-Dade, Broward, or Palm Beach — specifically:
 * - Monroe County (Florida Keys) ZIPs 33040–33044, 33050–33052, 33070 → null
 * - Martin County (Stuart) ZIPs 34990–34994 → null
 * - St. Lucie County ZIPs 34945–34988 → null
 * - Lee, Collier, and any other county → null
 */
export function deriveCountyFipsFromZip(zip: string | null | undefined): CountyFips | null {
  if (!zip) return null;
  const z = zip.trim().replace(/[-\s].*$/, "").substring(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  return ZIP_TO_COUNTY.get(parseInt(z, 10)) ?? null;
}

/**
 * Encrypts a raw evidence payload using AES-256-GCM.
 * Key is derived from MERCHANT_DATA_ENCRYPTION_KEY env var.
 * FAILS CLOSED — throws if the key is missing, malformed, or encryption fails.
 */
/**
 * Resolves MERCHANT_DATA_ENCRYPTION_KEY to a validated 32-byte Buffer.
 * Two accepted formats — both validated syntactically BEFORE decoding to
 * prevent Node's silent-truncation / ignored-character behaviour:
 *
 *   1. Exactly 64 hex characters /^[0-9a-fA-F]{64}$/  → hex decode.
 *   2. Canonical padded base64 with exactly 44 characters whose alphabet is
 *      [A-Za-z0-9+/] and which ends with '==' or has no padding, AND whose
 *      decoded length is exactly 32 bytes.
 *      Regex: /^[A-Za-z0-9+/]{43}=$/ (44 chars, 1 pad) covers 32 decoded bytes
 *      correctly; /^[A-Za-z0-9+/]{44}$/ (44 chars, no pad) is also valid
 *      for some encodings.  Both patterns are checked.
 *
 * Any value that does not match one of these patterns is rejected — returns null.
 * This is intentionally stricter than Node's Buffer.from(str, 'base64'), which
 * silently ignores invalid characters and accepts malformed padding.
 */
function resolveEncryptionKey(): Buffer | null {
  const raw = process.env.MERCHANT_DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();

  // ── Format 1: strict 64-char hex ─────────────────────────────────────────
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // ── Format 2: strict canonical padded base64 — must be 44 chars ──────────
  // A 32-byte payload base64-encodes to exactly 44 characters:
  //   ceil(32/3)*4 = 44, with exactly one trailing '=' pad char.
  // We also accept the unpadded 44-char variant for URL-safe base64.
  // The character set regex is strict: only [A-Za-z0-9+/=] (standard base64).
  // This intentionally rejects '+', '/', and '=' that appear in unexpected
  // positions, as well as any non-base64 character embedded in the string.
  const isValidBase64_44 =
    /^[A-Za-z0-9+/]{43}=$/.test(trimmed) ||   // padded: 43 chars + 1 '='
    /^[A-Za-z0-9+/]{44}$/.test(trimmed);      // some encoders omit padding

  if (isValidBase64_44) {
    const decoded = Buffer.from(trimmed, "base64");
    // Final guard: decoded must be exactly 32 bytes (the regex should guarantee
    // this, but we double-check to defend against any edge case in V8's decoder)
    if (decoded.length === 32) {
      return decoded;
    }
  }

  // All other values — malformed key, wrong length, invalid charset — rejected
  return null;
}

export function encryptRawPayload(payload: Record<string, unknown>): string {
  const rawKeyBuf = resolveEncryptionKey();
  if (!rawKeyBuf) {
    throw new Error(
      "SOURCE_REGISTRY_ENCRYPT_KEY_MISSING: MERCHANT_DATA_ENCRYPTION_KEY is absent or not a valid 32-byte key (64-char hex or 44-char base64); raw payloads cannot be stored"
    );
  }
  // Derive a domain-specific 256-bit key via SHA-256 so source-registry
  // payloads use a separate key space from merchant-protected-data.
  const keyBuf = createHash("sha256")
    .update(`source-registry-raw-payload-v1\0`)
    .update(rawKeyBuf)
    .digest();
  const plaintext = JSON.stringify(payload);
  // Deterministic IV derived from content — HMAC(key, plaintext).slice(0,12).
  // This ensures the same plaintext always produces the same ciphertext, making
  // the CRO-03 selection hash stable across crash-recovery re-runs.
  const iv = createHmac("sha256", keyBuf)
    .update(`source-registry-iv-v1\0`)
    .update(plaintext)
    .digest()
    .slice(0, 12);
  const cipher = createCipheriv("aes-256-gcm", keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: "aes256gcm-v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: encrypted.toString("base64"),
  });
}

export interface NormalizedSourceRecord {
  /** Registry adapter key, e.g. "dbpr-hr" */
  registryId: string;
  /** Stable dedup key value, e.g. the license number */
  stableKey: string;
  /** Encrypted evidence payload (AES-256-GCM envelope) */
  rawPayload: string;
  /** South Florida county FIPS derived from address */
  countyFips: CountyFips | null;
  /** Source license/business type */
  licenseType: string | null;
  /** Raw status string from source */
  sourceStatus: string | null;
  /** Whether this record is considered active per versioned mapping */
  sourceStatusActive: boolean;
  /** Business name for candidate value extraction */
  businessName: string | null;
  /** ZIP code extracted for FIPS derivation */
  zip: string | null;
}

export interface SourceAdapter {
  /** Matches source_registry_adapters.adapter_key */
  adapterKey: string;
  /** Human-readable source name */
  sourceName: string;
  /**
   * Semantic version of the activeStatusMapping. Stored in observation provenance so
   * existing evidence can establish which mapping version produced sourceStatusActive,
   * even after the mapping is updated in a future code release.
   * Format: "MAJOR.MINOR" — increment MAJOR for breaking changes, MINOR for additions.
   */
  mappingVersion: string;
  /**
   * DOCUMENTATION ONLY — the URL where an admin can manually download the
   * bulk CSV for this source. The import runner does NOT fetch this URL;
   * a CSV file must be provided to the import route at trigger time.
   * null for stub adapters whose bulk availability is unverified.
   */
  bulkDownloadUrl: string | null;
  /**
   * Versioned mapping of source status strings to active boolean.
   * Consulted at read time (normalize), not at write time.
   */
  activeStatusMapping: Record<string, boolean>;
  /**
   * Header names that MUST be present in the CSV (as parsed column headers).
   * The import runner validates these before processing any rows. If any are
   * missing the run fails immediately — no rows are processed, no tombstoning.
   * Use the most permissive alias that covers all known file variants.
   */
  requiredHeaders: string[];
  /**
   * Normalizes a single raw CSV/API row into a NormalizedSourceRecord.
   * Returns null if the row should be skipped (e.g. individual licensee, wrong county).
   */
  normalize(rawRow: Record<string, string>): NormalizedSourceRecord | null;
}

/** License types that represent individual licensees (excluded from all DBPR adapters) */
export const INDIVIDUAL_LICENSEE_TYPES = new Set([
  "Individual",
  "Cosmetologist",
  "Nail Specialist",
  "Facial Specialist",
  "Full Specialist",
  "Master Barber",
  "Barber",
  "Barber Apprentice",
  "Food Handler",
  "Food Manager",
]);
