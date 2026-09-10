/**
 * MI-02: Miami-Dade Local Business Tax Adapter
 * Source: opendata.miamidade.gov/Business/Local-Business-Tax-Receipts/
 * Key: mdade_lbt_account_number
 * County FIPS: 12086 (Miami-Dade) — all records are in this county by definition
 */

import type { SourceAdapter, NormalizedSourceRecord } from "../adapter";
import { encryptRawPayload, COUNTY_FIPS } from "../adapter";

const ACTIVE_STATUS_MAPPING: Record<string, boolean> = {
  "Active": true,
  "ACTIVE": true,
  "Current": true,
  "CURRENT": true,
  "Paid": true,
  "PAID": true,
  "Expired": false,
  "EXPIRED": false,
  "Cancelled": false,
  "CANCELLED": false,
  "Inactive": false,
  "INACTIVE": false,
  "Delinquent": false,
  "DELINQUENT": false,
  "Revoked": false,
  "REVOKED": false,
};

export const mdadeLbtAdapter: SourceAdapter = {
  adapterKey: "mdade-lbt",
  sourceName: "Miami-Dade Local Business Tax",
  // Socrata OData CSV export endpoint (public, no auth required)
  // Portal: https://opendata.miamidade.gov/ — search "Local Business Tax Receipts"
  // Dataset ID may change; obtain current CSV from portal. No stable direct download URL.
  // See docs/source-registry-sources.md for canonical field schema.
  bulkDownloadUrl: null,
  mappingVersion: "1.0",
  activeStatusMapping: ACTIVE_STATUS_MAPPING,
  // Use the canonical Miami-Dade export field names (underscored format from opendata.miamidade.gov).
  // The normalizer also checks camelCase aliases (AccountNumber, BusinessName, etc.) for
  // compatibility with other potential export variants.
  requiredHeaders: ["Account_Number", "Business_Name", "Receipt_Status"],

  normalize(rawRow: Record<string, string>): NormalizedSourceRecord | null {
    const accountNumber = (
      rawRow["Account_Number"] ||
      rawRow["AccountNumber"] ||
      rawRow["Account Number"] ||
      rawRow["ACCOUNT_NUMBER"] ||
      rawRow["account_number"] ||
      ""
    ).trim();
    if (!accountNumber) return null;

    const businessName = (
      rawRow["Business_Name"] ||
      rawRow["BusinessName"] ||
      rawRow["Business Name"] ||
      rawRow["BUSINESS_NAME"] ||
      rawRow["business_name"] ||
      ""
    ).trim() || null;

    const sourceStatus = (
      rawRow["Receipt_Status"] ||
      rawRow["ReceiptStatus"] ||
      rawRow["Status"] ||
      rawRow["STATUS"] ||
      rawRow["status"] ||
      ""
    ).trim();

    const businessType = (
      rawRow["Business_Type"] ||
      rawRow["BusinessType"] ||
      rawRow["Business Type"] ||
      rawRow["BUSINESS_TYPE"] ||
      rawRow["business_type"] ||
      ""
    ).trim();

    const zip = (
      rawRow["Zip_Code"] ||
      rawRow["ZipCode"] ||
      rawRow["Zip"] ||
      rawRow["ZIP"] ||
      rawRow["zip_code"] ||
      ""
    ).trim().substring(0, 5);

    // All Miami-Dade LBT records are county FIPS 12086 by definition
    const countyFips = COUNTY_FIPS.MIAMI_DADE;

    const rawPayload = encryptRawPayload({
      accountNumber,
      businessName,
      businessType,
      sourceStatus,
      zip,
      address: rawRow["Business_Address"] || rawRow["Address"] || rawRow["business_address"] || "",
      city: rawRow["City"] || rawRow["CITY"] || rawRow["city"] || "",
      ownerName: rawRow["Owner_Name"] || rawRow["OwnerName"] || rawRow["Owner Name"] || "",
      phone: rawRow["Phone"] || rawRow["PHONE"] || rawRow["phone"] || "",
      email: rawRow["Email"] || rawRow["EMAIL"] || rawRow["email"] || "",
      issueDate: rawRow["Issue_Date"] || rawRow["IssueDate"] || rawRow["Issue Date"] || "",
      expirationDate: rawRow["Expiration_Date"] || rawRow["ExpirationDate"] || rawRow["Expiration Date"] || "",
      naicsCode: rawRow["NAICS_Code"] || rawRow["NaicsCode"] || rawRow["NAICS"] || "",
    });

    return {
      registryId: "mdade-lbt",
      stableKey: accountNumber,
      rawPayload,
      countyFips,
      licenseType: businessType || null,
      sourceStatus: sourceStatus || null,
      sourceStatusActive: ACTIVE_STATUS_MAPPING[sourceStatus] ?? false,
      businessName,
      zip,
    };
  },
};
