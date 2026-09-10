/**
 * MI-02: DBPR Alcoholic Beverages & Tobacco Adapter
 * Source: myfloridalicense.com/DBPR/alcoholic-beverages-tobacco/public-records/
 * Key: dbpr_abt_license_number
 * Filters: explicit retail-on/off-premises allowlist only
 */

import type { SourceAdapter, NormalizedSourceRecord } from "../adapter";
import { deriveCountyFipsFromZip, encryptRawPayload } from "../adapter";

/**
 * EXPLICIT ALLOWLIST — only retail on-premises and package-store license types.
 * Wholesale, manufacturer, distributor, and unrecognised codes are excluded.
 * Source: Florida Division of Alcoholic Beverages and Tobacco license type table.
 */
const ABT_RETAIL_ALLOWLIST = new Set([
  // On-premises consumption
  "2COP",       // Beer/Wine On-Premises
  "4COP",       // Beer/Wine/Spirits On-Premises
  "4COP SRX",   // Restaurant/Bar Special Restaurant Exemption
  "SRX",        // Special Restaurant Exemption
  "7COP",       // Nightclub (On-Premises)
  "11C",        // Caterer (On-Premises)
  // Package stores (off-premises retail)
  "1APS",       // Package Store (spirits)
  "2APS",       // Package Store (beer/wine)
  "3PS",        // Package Store
  "5PS",        // Package Store (beer/wine/spirits)
  "8PS",        // Specialty Retail Package
  "DPS",        // Drug Store Package
  "APS",        // Airport Package Store
  // Beer/wine retail
  "BW",         // Beer/Wine (retail)
  "1PS",        // Beer Only Package
]);

const ACTIVE_STATUS_MAPPING: Record<string, boolean> = {
  "Active": true,
  "Current, Active": true,
  "Current Active": true,
  "Inactive": false,
  "Delinquent": false,
  "Revoked": false,
  "Cancelled": false,
  "Suspended": false,
  "Expired": false,
};

export const dbprAbtAdapter: SourceAdapter = {
  adapterKey: "dbpr-abt",
  sourceName: "DBPR Alcoholic Beverages & Tobacco",
  // Portal: https://www.myfloridalicense.com/DBPR/alcoholic-beverages-tobacco/
  // Bulk CSV is obtained through DBPR public records request — no stable direct download URL.
  // See docs/source-registry-sources.md for field schema and access instructions.
  bulkDownloadUrl: null,
  mappingVersion: "1.0",
  activeStatusMapping: ACTIVE_STATUS_MAPPING,
  requiredHeaders: ["LicenseNumber", "LicenseType", "LicenseStatus"],

  normalize(rawRow: Record<string, string>): NormalizedSourceRecord | null {
    const licenseNumber = (rawRow["LicenseNumber"] || rawRow["License Number"] || rawRow["LICENSE_NUMBER"] || rawRow["LicNum"] || "").trim();
    if (!licenseNumber) return null;

    const licenseType = (rawRow["LicenseType"] || rawRow["License Type"] || rawRow["LicType"] || rawRow["TYPE"] || "").trim();

    // Explicit allowlist — skip any type not in the retail set
    if (!ABT_RETAIL_ALLOWLIST.has(licenseType)) return null;

    const zip = (rawRow["LocationZip"] || rawRow["Location Zip"] || rawRow["Zip"] || rawRow["ZIP"] || rawRow["ZipCode"] || "").trim().substring(0, 5);
    const countyFips = deriveCountyFipsFromZip(zip);
    if (!countyFips) return null;

    const sourceStatus = (rawRow["LicenseStatus"] || rawRow["License Status"] || rawRow["Status"] || rawRow["STATUS"] || "").trim();
    const businessName = (rawRow["BusinessName"] || rawRow["Business Name"] || rawRow["DBAName"] || rawRow["DBA"] || "").trim() || null;

    const rawPayload = encryptRawPayload({
      licenseNumber,
      businessName,
      licenseType,
      sourceStatus,
      zip,
      address: rawRow["LocationAddress"] || rawRow["Location Address"] || rawRow["Address"] || "",
      city: rawRow["LocationCity"] || rawRow["Location City"] || rawRow["City"] || "",
      county: rawRow["County"] || rawRow["COUNTY"] || "",
      ownerName: rawRow["OwnerName"] || rawRow["Owner Name"] || "",
      phone: rawRow["Phone"] || rawRow["PHONE"] || "",
      email: rawRow["Email"] || rawRow["EMAIL"] || "",
      originalIssueDate: rawRow["OriginalIssueDate"] || rawRow["Original Issue Date"] || rawRow["IssueDate"] || "",
      expirationDate: rawRow["ExpirationDate"] || rawRow["Expiration Date"] || "",
    });

    return {
      registryId: "dbpr-abt",
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
