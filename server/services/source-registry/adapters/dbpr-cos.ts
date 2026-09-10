/**
 * MI-02: DBPR Cosmetology Establishments Adapter
 * Source: myfloridalicense.com/DBPR/cosmetology/public-records/
 * Key: dbpr_cos_license_number
 * Filters: explicit salon/spa establishment allowlist only (NOT individual cosmetologists)
 * Note: DBPR Cosmetology does NOT include barbers — use dbpr-bar for that.
 */

import type { SourceAdapter, NormalizedSourceRecord } from "../adapter";
import { deriveCountyFipsFromZip, encryptRawPayload } from "../adapter";

/**
 * EXPLICIT ALLOWLIST — salon and spa establishment license types only.
 * Any license type NOT in this set is skipped (fail-closed for unknown types).
 */
const COS_ESTABLISHMENT_ALLOWLIST = new Set([
  "Cosmetology Salon",
  "Full-Service Salon",
  "Full Service Salon",
  "Specialty Salon",
  "Cosmetology Booth",
  "Booth Rental",
  "Cosmetology School",
  "Cosmetology Training School",
  "Salon",
  "Spa",
  "Day Spa",
  "Nail Salon",
  "Nail Specialty Salon",
  "Eyelash Extension Salon",
  "Hair Salon",
  "Hair Braiding Salon",
  "Natural Hair Braiding Salon",
  "Hair Wrapping Salon",
  "Wigs and Extensions Salon",
  "Esthetician Salon",
  "Facial Specialty Salon",
  "Establishment",
]);

const ACTIVE_STATUS_MAPPING: Record<string, boolean> = {
  "Active": true,
  "Current, Active": true,
  "Current Active": true,
  "Inactive": false,
  "Delinquent": false,
  "Suspended": false,
  "Revoked": false,
  "Expired": false,
  "Null and Void": false,
  "Cancelled": false,
};

export const dbprCosAdapter: SourceAdapter = {
  adapterKey: "dbpr-cos",
  sourceName: "DBPR Cosmetology Establishments",
  // Portal: https://www.myfloridalicense.com/DBPR/cosmetology/
  // Bulk CSV is obtained through DBPR public records request — no stable direct download URL.
  // See docs/source-registry-sources.md for field schema and access instructions.
  bulkDownloadUrl: null,
  mappingVersion: "1.0",
  activeStatusMapping: ACTIVE_STATUS_MAPPING,
  requiredHeaders: ["LicenseNumber", "LicenseType", "LicenseStatus"],

  normalize(rawRow: Record<string, string>): NormalizedSourceRecord | null {
    const licenseNumber = (rawRow["LicenseNumber"] || rawRow["License Number"] || rawRow["LICENSE_NUMBER"] || "").trim();
    if (!licenseNumber) return null;

    const licenseType = (rawRow["LicenseType"] || rawRow["License Type"] || rawRow["Type"] || rawRow["TYPE"] || "").trim();

    // Explicit allowlist — skip any license type not in the establishment set
    if (!COS_ESTABLISHMENT_ALLOWLIST.has(licenseType)) return null;

    const zip = (rawRow["LocationZip"] || rawRow["Location Zip"] || rawRow["Zip"] || rawRow["ZIP"] || "").trim().substring(0, 5);
    const countyFips = deriveCountyFipsFromZip(zip);
    if (!countyFips) return null;

    const sourceStatus = (rawRow["LicenseStatus"] || rawRow["License Status"] || rawRow["Status"] || "").trim();
    const businessName = (rawRow["BusinessName"] || rawRow["Business Name"] || rawRow["SalonName"] || rawRow["Salon Name"] || "").trim() || null;

    const rawPayload = encryptRawPayload({
      licenseNumber,
      businessName,
      licenseType,
      sourceStatus,
      zip,
      address: rawRow["LocationAddress"] || rawRow["Location Address"] || rawRow["Address"] || "",
      city: rawRow["LocationCity"] || rawRow["Location City"] || rawRow["City"] || "",
      county: rawRow["County"] || "",
      ownerName: rawRow["OwnerName"] || rawRow["Owner Name"] || "",
      phone: rawRow["Phone"] || "",
      email: rawRow["Email"] || "",
      originalIssueDate: rawRow["OriginalIssueDate"] || rawRow["Original Issue Date"] || "",
      expirationDate: rawRow["ExpirationDate"] || rawRow["Expiration Date"] || "",
    });

    return {
      registryId: "dbpr-cos",
      stableKey: licenseNumber,
      rawPayload,
      countyFips,
      licenseType: licenseType || null,
      sourceStatus: sourceStatus || null,
      sourceStatusActive: ACTIVE_STATUS_MAPPING[sourceStatus] ?? false,
      businessName,
      zip,
    };
  },
};
