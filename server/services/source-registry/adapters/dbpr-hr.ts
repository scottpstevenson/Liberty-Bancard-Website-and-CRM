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

/**
 * Maps each HR_ESTABLISHMENT_ALLOWLIST license type to its canonical CRO-03A vertical string.
 * Hospitality: lodging types (hotel, motel, resort, B&B, vacation rental, etc.)
 * Restaurant: all food/beverage service types
 * Every entry in HR_ESTABLISHMENT_ALLOWLIST must appear here — fail-closed by omission.
 */
const DBPR_HR_VERTICAL_MAP: Record<string, "Restaurant" | "Hospitality"> = {
  // Lodging → Hospitality
  "Hotel": "Hospitality",
  "Motel": "Hospitality",
  "Resort": "Hospitality",
  "Bed and Breakfast Inn": "Hospitality",
  "Transient Apartment": "Hospitality",
  "Vacation Rental": "Hospitality",
  "Condominium Hotel": "Hospitality",
  // Food & Beverage → Restaurant
  "Restaurant": "Restaurant",
  "Cafeteria": "Restaurant",
  "Snack Bar": "Restaurant",
  "Catering Service": "Restaurant",
  "Food Service Establishment": "Restaurant",
  "Public Food Service Establishment": "Restaurant",
  "Permanent Food Service": "Restaurant",
  "Temporary Food Service": "Restaurant",
  "Vending Machine": "Restaurant",
  "Mobile Food Dispensing Vehicle": "Restaurant",
  "Theme Park Food Service": "Restaurant",
  "Catering Only": "Restaurant",
  "Counter Service": "Restaurant",
  "Take Out": "Restaurant",
  "Bakery": "Restaurant",
  "Juice Bar": "Restaurant",
  "Deli": "Restaurant",
  "Fast Food": "Restaurant",
  "Drive Through": "Restaurant",
  "Food Truck": "Restaurant",
  "Bar": "Restaurant",
  "Tavern": "Restaurant",
  "Lounge": "Restaurant",
  "Nightclub": "Restaurant",
  "Seating": "Restaurant",
};

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

    const city = (rawRow["LocationCity"] || rawRow["Location City"] || rawRow["CITY"] || "").trim() || null;
    const address = (rawRow["LocationAddress"] || rawRow["Location Address"] || rawRow["ADDRESS"] || "").trim() || null;
    const phone = (rawRow["Phone"] || rawRow["PHONE"] || "").trim() || null;

    return {
      registryId: "dbpr-hr",
      stableKey: licenseNumber,
      rawPayload,
      countyFips,
      licenseType: licenseType || null,
      // Pre-resolved canonical vertical string for CRO-03A payload.
      // null is impossible here because HR_ESTABLISHMENT_ALLOWLIST.has(licenseType)
      // was verified above, and every allowlisted type is in DBPR_HR_VERTICAL_MAP.
      vertical: DBPR_HR_VERTICAL_MAP[licenseType] ?? null,
      sourceStatus: sourceStatus || null,
      sourceStatusActive: ACTIVE_STATUS_MAPPING[sourceStatus] ?? false,
      businessName,
      zip,
      // Derived from known source geography — DBPR issues licenses only in Florida
      state: "FL",
      city,
      address,
      phone,
    };
  },
};
