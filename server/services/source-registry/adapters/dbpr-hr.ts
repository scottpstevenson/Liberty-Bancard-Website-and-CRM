/**
 * MI-02: DBPR Hotels & Restaurants Adapter
 * Source: myfloridalicense.com/DBPR/hotels-restaurants/licensing/public-records/
 * Key: dbpr_hr_license_number
 * Filters: explicit establishment allowlist (not individual licensees)
 */

import type { SourceAdapter, NormalizedSourceRecord } from "../adapter";
import { deriveCountyFipsFromZip, encryptRawPayload } from "../adapter";

/**
 * EXPLICIT ALLOWLIST — only establishment/business license types.
 * Any license type NOT in this set is skipped (fail-closed for unknown types).
 */
const HR_ESTABLISHMENT_ALLOWLIST = new Set([
  "Hotel",
  "Motel",
  "Resort",
  "Bed and Breakfast Inn",
  "Transient Apartment",
  "Vacation Rental",
  "Condominium Hotel",
  "Restaurant",
  "Cafeteria",
  "Snack Bar",
  "Catering Service",
  "Food Service Establishment",
  "Public Food Service Establishment",
  "Permanent Food Service",
  "Temporary Food Service",
  "Vending Machine",
  "Mobile Food Dispensing Vehicle",
  "Theme Park Food Service",
  "Catering Only",
  "Counter Service",
  "Take Out",
  "Bakery",
  "Juice Bar",
  "Deli",
  "Fast Food",
  "Drive Through",
  "Food Truck",
  "Bar",
  "Tavern",
  "Lounge",
  "Nightclub",
  "Seating",
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

export const dbprHrAdapter: SourceAdapter = {
  adapterKey: "dbpr-hr",
  sourceName: "DBPR Hotels & Restaurants",
  // Portal: https://www.myfloridalicense.com/DBPR/hotels-restaurants/
  // Bulk CSV is obtained through DBPR public records request — no stable direct download URL.
  // See docs/source-registry-sources.md for field schema and access instructions.
  bulkDownloadUrl: null,
  mappingVersion: "1.0",
  activeStatusMapping: ACTIVE_STATUS_MAPPING,
  // Minimum headers required; validated before any row is processed.
  // All aliases checked by normalize() are covered by at least one required name.
  requiredHeaders: ["LicenseNumber", "LicenseType", "LicenseStatus"],

  normalize(rawRow: Record<string, string>): NormalizedSourceRecord | null {
    const licenseNumber = (rawRow["LicenseNumber"] || rawRow["License Number"] || rawRow["LICENSE_NUMBER"] || "").trim();
    if (!licenseNumber) return null;

    const licenseType = (rawRow["LicenseType"] || rawRow["License Type"] || rawRow["LICENSE_TYPE"] || "").trim();

    // Explicit allowlist — skip any license type not in the established set
    if (!HR_ESTABLISHMENT_ALLOWLIST.has(licenseType)) return null;

    const zip = (rawRow["LocationZip"] || rawRow["Location Zip"] || rawRow["ZIP"] || rawRow["Zip"] || "").trim().substring(0, 5);
    const countyFips = deriveCountyFipsFromZip(zip);

    // Only include South Florida records
    if (!countyFips) return null;

    const sourceStatus = (rawRow["LicenseStatus"] || rawRow["License Status"] || rawRow["STATUS"] || "").trim();
    const businessName = (rawRow["BusinessName"] || rawRow["Business Name"] || rawRow["BUSINESS_NAME"] || rawRow["DBAName"] || rawRow["DBA Name"] || "").trim() || null;

    const rawPayload = encryptRawPayload({
      licenseNumber,
      businessName,
      licenseType,
      sourceStatus,
      zip,
      address: rawRow["LocationAddress"] || rawRow["Location Address"] || rawRow["ADDRESS"] || "",
      city: rawRow["LocationCity"] || rawRow["Location City"] || rawRow["CITY"] || "",
      county: rawRow["County"] || rawRow["COUNTY"] || "",
      ownerName: rawRow["OwnerName"] || rawRow["Owner Name"] || "",
      phone: rawRow["Phone"] || rawRow["PHONE"] || "",
      email: rawRow["Email"] || rawRow["EMAIL"] || "",
      originalIssueDate: rawRow["OriginalIssueDate"] || rawRow["Original Issue Date"] || "",
      expirationDate: rawRow["ExpirationDate"] || rawRow["Expiration Date"] || "",
    });

    return {
      registryId: "dbpr-hr",
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
