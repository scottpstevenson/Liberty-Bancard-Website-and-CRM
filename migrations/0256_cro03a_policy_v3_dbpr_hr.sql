-- MI-06 follow-up: CRO-03A policy v3 — adds Restaurant and Hospitality to targetVerticals
--
-- This inserts a NEW immutable draft policy document (version=3). The existing v1 (active)
-- and v2 (draft, inconsistent target strings) are NOT modified — the append-only trigger
-- on cro03a_policy_documents prevents any UPDATE or DELETE.
--
-- Activation deferred to MI-09: before activating v3 in production, a v1-vs-v3 impact
-- preview by source and disposition is required because adding Restaurant/Hospitality
-- affects every CRO-03A source, not only DBPR-HR.
--
-- The v3 policy uses fitVersion="fit-v2" and extends targetVerticals to:
--   ["Auto", "Healthcare", "Salon/Spa", "Restaurant", "Hospitality"]
--
-- dbprHrLicenseCertification: maps every HR_ESTABLISHMENT_ALLOWLIST license type to its
-- canonical CRO-03A vertical string. Used only as a documentation/certification record
-- in the policy document; runtime vertical resolution reads the occurrence payload's
-- `vertical` field (pre-resolved by the adapter).
--
-- policy_hash is the SHA-256 of stableJson(policy) — computed using the same algorithm
-- as hashCro03Evidence() in server/services/cro03/source-staging.ts.

INSERT INTO cro03a_policy_documents
  (policy_key, version, policy, policy_hash, status, created_by)
VALUES
  ('south_florida_candidate_qualification', 3,
   '{
     "geographyReferenceVersion": "south-florida-fips-v1",
     "counties": {"Broward": "12011", "Miami-Dade": "12086", "Palm Beach": "12099"},
     "disabledCounties": {"Monroe": "12087"},
     "verticalAlgorithmVersion": "v1",
     "subverticalMapVersion": "1",
     "fitVersion": "fit-v2",
     "targetVerticals": ["Auto", "Healthcare", "Salon/Spa", "Restaurant", "Hospitality"],
     "selectedMinimum": 70,
     "reviewMinimum": 50,
     "freshnessDays": 90,
     "sourceCensus": [
       "prospects", "sunbiz_entities", "provider_csv_rows", "sdr_merchants",
       "lead_discovery_results", "master_leads", "public_web"
     ],
     "dbprHrLicenseCertification": {
       "Hotel": "Hospitality",
       "Motel": "Hospitality",
       "Resort": "Hospitality",
       "Bed and Breakfast Inn": "Hospitality",
       "Transient Apartment": "Hospitality",
       "Vacation Rental": "Hospitality",
       "Condominium Hotel": "Hospitality",
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
       "Seating": "Restaurant"
     }
   }'::jsonb,
   'defd0795dbc3829a2bf55e5e6aae58739162f0bbe8f80a3ab14f0c2c34e2fec4',
   'draft', 'system')
ON CONFLICT (policy_key, version) DO NOTHING;

-- NOTE: Do NOT run the activation UPDATE here.
-- Production activation of v3 is deferred to MI-09 after the v1-vs-v3 impact preview.
-- The cert script (scripts/certify-cro03b-csv-handoff.ts Path D) activates v3 only in
-- the disposable certification DB environment and restores the prior pointer after the test.
