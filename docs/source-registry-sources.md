# South Florida Source Registry — Source Endpoints

_Last verified: 2026-09-10 (MI-02 implementation)_

## Overview

Five operating-merchant data sources implemented as adapters. CSV files must be obtained manually
from each source and uploaded via the admin Source Registry panel — the import runner **does not
fetch these URLs automatically**. Two county sources (Broward, Palm Beach) are stubs pending
bulk-availability verification.

**Important:** Bulk CSV download URLs for DBPR sources are not directly linkable stable endpoints;
DBPR publishes bulk extracts through a portal/request process rather than permanent download links.
Miami-Dade opendata.miamidade.gov dataset IDs may rotate. Admins must obtain current files through
the public records portals listed below and verify field schemas before upload. The `bulkDownloadUrl`
in each adapter is set to `null` for unverified/portal-access sources.

---

## 1. DBPR Hotels & Restaurants (`dbpr-hr`)

- **Portal:** https://www.myfloridalicense.com/DBPR/hotels-restaurants/
- **Public records access:** Via DBPR eProcurement/eVerify or public records request to DBPR Communications
  at `DBPR_CommunicationsRequest@myfloridalicense.com`
- **Bulk CSV availability:** Available through DBPR public records; no stable direct download URL.
  Contact portal for current export format. Past exports used `LicenseNumber`, `LicenseType`,
  `LicenseStatus`, `BusinessName`, `LocationAddress`, `LocationCity`, `LocationZip` fields.
- **Key field:** `LicenseNumber` → stable key `dbpr_hr_license_number`
- **License type filter:** Establishment and business license types only (e.g., "Hotel", "Restaurant",
  "Seating", "Public Food Service Establishment"). Individual licensee records excluded.
- **County filter:** Derived from `LocationZip` → county FIPS (Miami-Dade, Broward, Palm Beach)
- **Refresh cadence:** Weekly (DBPR publishes updated extracts periodically)
- **DBPR disclaimer:** Fields may be optional; data refreshes weekly; not for commercial solicitation.
- **Required headers (for upload validation):** `LicenseNumber`, `LicenseType`, `LicenseStatus`

---

## 2. DBPR Alcoholic Beverages & Tobacco (`dbpr-abt`)

- **Portal:** https://www.myfloridalicense.com/DBPR/alcoholic-beverages-tobacco/
- **Public records access:** Via DBPR eProcurement/eVerify or public records request (see above)
- **Bulk CSV availability:** Available through DBPR public records; no stable direct download URL.
  Past exports used `LicenseNumber`, `LicenseType`, `LicenseStatus`, `BusinessName`, `LocationZip` fields.
- **Key field:** `LicenseNumber` → stable key `dbpr_abt_license_number`
- **License type filter:** Retail beverage license types (2COP, 4COP, SRX, etc.); exclude wholesale
  and manufacturer types.
- **County filter:** Derived from address ZIP → county FIPS
- **Refresh cadence:** Weekly
- **Required headers (for upload validation):** `LicenseNumber`, `LicenseType`, `LicenseStatus`

---

## 3. DBPR Cosmetology (`dbpr-cos`)

- **Portal:** https://www.myfloridalicense.com/DBPR/cosmetology/
- **Public records access:** Via DBPR eProcurement/eVerify or public records request (see above)
- **Bulk CSV availability:** Available through DBPR public records; no stable direct download URL.
  Past exports used `LicenseNumber`, `LicenseType`, `LicenseStatus`, `BusinessName`, `LocationZip` fields.
- **Key field:** `LicenseNumber` → stable key `dbpr_cos_license_number`
- **License type filter:** Salon and spa establishment records only ("Cosmetology Salon",
  "Full-Service Salon", "Specialty Salon", "Cosmetology Booth"). Individual cosmetologist licensees excluded.
- **Note:** DBPR Cosmetology does not include barbers; barber shops use the separate DBPR Barbers dataset.
- **County filter:** Derived from address ZIP → county FIPS
- **Refresh cadence:** Weekly
- **Required headers (for upload validation):** `LicenseNumber`, `LicenseType`, `LicenseStatus`

---

## 4. DBPR Barbers (`dbpr-bar`)

- **Portal:** https://www.myfloridalicense.com/barbers/
- **Public records access:** Via DBPR public records request (see above)
- **Bulk CSV availability:** Available through DBPR public records; no stable direct download URL.
  Past exports used `LicenseNumber`, `LicenseType`, `LicenseStatus`, `BusinessName`, `LocationZip` fields.
- **Key field:** `LicenseNumber` → stable key `dbpr_bar_license_number`
- **License type filter:** Barber shop establishment records only ("Barber Shop", "Booth Rental").
  Individual barber licensees excluded.
- **County filter:** Derived from address ZIP → county FIPS
- **Refresh cadence:** Weekly
- **Required headers (for upload validation):** `LicenseNumber`, `LicenseType`, `LicenseStatus`

---

## 5. Miami-Dade Local Business Tax (`mdade-lbt`)

- **Portal:** https://opendata.miamidade.gov/
- **Dataset:** Miami-Dade Local Business Tax Receipts
- **Access method:** Miami-Dade Open Data portal CSV export. Dataset ID may change;
  search for "Local Business Tax" at opendata.miamidade.gov to find the current dataset.
  The adapter was built against an export with the following canonical header names.
- **Key field:** `Account_Number` → stable key `mdade_lbt_account_number`
- **County:** All Miami-Dade (FIPS 12086) — no ZIP filter needed
- **Refresh cadence:** Periodic (varies; Miami-Dade updates irregularly)
- **Required headers (for upload validation):** `Account_Number`, `Business_Name`, `Receipt_Status`
- **Canonical field names in export:**
  `Account_Number`, `Business_Name`, `Business_Type`, `Receipt_Status`,
  `Business_Address`, `City`, `Zip_Code`, `Owner_Name`, `Phone`, `Email`,
  `Issue_Date`, `Expiration_Date`, `NAICS_Code`

---

## Stub Adapters (unverified)

### Broward County Local Business Tax (`broward-lbt`)

- **Status:** Unverified — bulk CSV availability from Broward County not confirmed
- **Portal:** https://www.broward.org/RecordsTaxesTreasury/BusinessTaxReceipts/
- **Action needed:** Contact Broward County to confirm bulk export availability and field schema

### Palm Beach County Local Business Tax (`palm-beach-lbt`)

- **Status:** Unverified — bulk CSV availability from Palm Beach County not confirmed
- **Portal:** https://www.pbctax.com/business-tax-receipts/
- **Action needed:** Contact Palm Beach County Tax Collector to confirm bulk export availability

---

## Schema Drift Warning

Each adapter declares `requiredHeaders` that are validated before any rows are processed.
If a CSV upload fails with `SOURCE_REGISTRY_MISSING_HEADERS`, the source agency may have
changed their export format. Update the adapter's normalizer and requiredHeaders accordingly.
