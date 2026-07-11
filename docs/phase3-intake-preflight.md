# Phase 3 — Universal Intake & Enrichment Routing Preflight Audit

**Date:** 2026-07-11  
**Status:** AUDIT COMPLETE — read-only document. No code was changed.  
**Purpose:** Authoritative ownership audit of every lead/contact creation and update surface, serving as the contract Phase 3 implementation must satisfy before restructuring any intake path.

---

## 1. Executive Summary

Eight distinct intake surfaces feed the Liberty Bancard platform. They write to **four different destination tables** (`prospects`, `sunbiz_entities`, `sdrMerchants`/`sdrLeadState`, and `contacts`) with widely varying provenance, deduplication, and compliance guarantees.

**Six kill lines** were identified, two of which are rated Critical. The most dangerous are:

1. **Critical** — `syncContactFromGhl` deduplicates by scanning `getContacts({limit:500})`, which silently misses any contact beyond the 500-row cap and can create unlimited duplicate contacts.
2. **Critical** — CSV Prospect Import and Sunbiz bulk uploads have **no idempotency guarantee**; re-running the same file creates duplicate rows with no detection or prevention.
3. **High** — All six marketing form handlers trigger `autoEnrollFromTrigger("form_submitted")` immediately at intake with no enrichment gate, meaning a newly-created contact with zero verified data can enter an automated outreach sequence before any enrichment runs.
4. **High** — Three intake paths (CSV import, Sunbiz uploads, registry import) create records with no `sourceCategory` field.
5. **High** — The GHL inbound sync creates new contacts with only `referralSource: "ghl_sync"` and a tag; no `sourceCategory`, no scoring trigger, no enrichment trigger.
6. **Medium** — Registry importer matches on phone number alone with no confidence threshold; a single phone digit error can merge two unrelated businesses.

No single service is currently the canonical writer for `contacts` rows. Five different call sites can create a `contacts` row: `createContactGhlFirst()` (public forms, manual entry, prospect conversion), `storage.createContact()` (GHL inbound sync), and implicitly `bridgeContactsToSdr()` and `bridgeContactsToBusiness()`.

The proposed ownership and promotion contract is at the end of this document (Section 5), marked **PROPOSED — requires approval before Phase 3 implementation begins**.

---

## 2. Eight-Source × Nine-Dimension Matrix

Legend: ✅ Clear | ⚠️ Partial/Inconsistent | ❌ Missing/Risk

| Dimension | S1: CSV Import | S2: Sunbiz COREVT | S3: GHL Inbound Sync | S4: Form Submissions | S5: Manual Dashboard | S6: Registry Importer | S7: Apollo Discovery | S8: Outscraper/Apify |
|---|---|---|---|---|---|---|---|---|
| 1. Canonical owner | ⚠️ storage.createProspectsBulk | ⚠️ storage.createSunbizEntitiesBulk | ⚠️ storage.createContact (direct) | ✅ createContactGhlFirst | ✅ createContactGhlFirst | ✅ db.update(sdrMerchants) | ⚠️ ingestBusiness → orchestrator | ⚠️ ingestBusiness → orchestrator |
| 2. Dedupe key | ❌ None | ❌ None on bulk | ⚠️ ghlContactId → email (500-row cap) | ⚠️ DB email unique constraint only | ✅ DB email unique + 409 | ⚠️ phone exact OR fuzzy name+state | ✅ domain/phone/placeId/name+city score ≥40 | ✅ Same ingestBusiness() scoring |
| 3. Provenance fields | ⚠️ listId only | ⚠️ listId + source:"corevt" | ⚠️ referralSource + tag only | ⚠️ tags + UTM (no sourceCategory) | ❌ Whatever operator sets | ✅ importId + registrySource | ✅ sourceType + importBatchId optional | ✅ sourceType + importBatchId optional |
| 4. Scoring trigger | ❌ None | ❌ None | ❌ None | ✅ scoreContact() fire-and-forget | ✅ scoreContact() fire-and-forget | ❌ None | ⚠️ Only after orchestrator sweep | ⚠️ Only after orchestrator sweep |
| 5. Enrichment trigger | ❌ Operator only | ❌ Operator only | ❌ None | ⚠️ ingestBusinessFromContact only | ⚠️ ingestBusinessFromContact only | ❌ None | ⚠️ Auto via orchestrator (SDR only) | ⚠️ Auto via orchestrator (SDR only) |
| 6. Campaign eligibility | ❌ Not until converted | ❌ Not until converted | ❌ Immediately, no gate | ❌ Immediately, before enrichment | ❌ Immediately, no gate | ❌ Not until bridged to contacts | ⚠️ SDR outreach only (not campaign engine) | ⚠️ SDR outreach only (not campaign engine) |
| 7. GHL ownership | ✅ No GHL write | ✅ No GHL write | ✅ REPLIT_OWNED_FIELDS protected | ✅ GHL-first write; REPLIT_OWNED protected on inbound | ✅ GHL-first write; protected | ✅ No GHL write | ✅ No GHL write at discovery | ✅ No GHL write at discovery |
| 8. Rollback behavior | ⚠️ ProspectList exists, no row-level rollback | ⚠️ ProspectList exists, no row-level rollback | ❌ None | ❌ None | ❌ None | ✅ importId on registryImportLog, no automated rollback | ❌ None | ❌ None |
| 9. Idempotency | ❌ Not idempotent | ❌ Not idempotent | ⚠️ Idempotent for matched; risky for new | ⚠️ No dup contact but new deal each time | ✅ 409 on duplicate email | ⚠️ Updates are idempotent; logs are not | ⚠️ Business merge idempotent; leadSources not | ⚠️ Business merge idempotent; leadSources not |

---

## 3. Kill Lines with Severity Ratings

### CRITICAL

**KL-1 — GHL inbound sync contact deduplication uses a 500-row hard cap**  
`syncContactFromGhl` calls `storage.getContacts({ limit: 500 })` to find matches by `ghlContactId` and then by email. For any database with more than 500 contacts, GHL contacts whose matching local contact falls outside the 500-row slice are silently created as new duplicate contacts. With 154K+ records, this is a near-certain daily source of duplicate contact explosion.  
_File: `server/services/ghl-sync.ts` lines 270, 307_

**KL-2 — CSV Prospect Import and Sunbiz bulk upload have no idempotency guarantee**  
`POST /api/prospects/import` and `POST /api/sunbiz/upload-corevt` both call bulk-insert functions with no uniqueness check. Re-uploading the same file creates a brand new `ProspectList` record and identical duplicate `prospects`/`sunbiz_entities` rows. There is no mechanism to detect or prevent this.  
_Files: `server/routes/prospects.ts` lines 311–380, 569–638_

### HIGH

**KL-3 — All six marketing form handlers auto-enroll into sequences before enrichment**  
`autoEnrollFromTrigger("form_submitted", ...)` and `enrollInInboundConfirmation` are called immediately (fire-and-forget) on every form submission, including contacts with unverified emails and zero enrichment. A contact with a malformed email or a test submission will enter an automated outbound sequence. The enrichment gate (`ingestBusinessFromContact`) runs in parallel, not as a prerequisite.  
_File: `server/routes/public.ts` lines 383–386, 293–294_

**KL-4 — Three intake paths produce contacts/prospects with no `sourceCategory`**  
CSV Prospect Import writes `listId` only to `prospects` table — no `sourceCategory`, no `importedFrom`, no `importBatchId` on the row itself. Sunbiz COREVT upload writes `source: "corevt"` and `listId` to `sunbiz_entities` but when promoted to `prospects` via `convertToProspect()`, no provenance field survives. Manual dashboard entry depends entirely on what the operator chooses to fill in; `sourceCategory` is not a required field and is frequently empty.  
_Files: `server/routes/prospects.ts` lines 353–365, `server/services/sunbiz-enrichment.ts` (convertToProspect)_

**KL-5 — GHL inbound sync creates new contacts with no scoring, no enrichment, immediate campaign eligibility**  
When `syncContactFromGhl` creates a new contact (no ghlContactId or email match), it calls `storage.createContact()` directly — bypassing `createContactGhlFirst()` and all its downstream triggers. No `scoreContact()`, no `ingestBusinessFromContact()`, no enrichment trigger fires. Yet the resulting contact is immediately visible in the CRM and eligible for campaign audience inclusion with nothing but a name, email, and a `"ghl-import"` tag.  
_File: `server/services/ghl-sync.ts` lines 329–343_

**KL-6 — Prospect conversion triggers `autoEnrollFromTrigger("contact_created")` with no enrichment gate**  
`POST /api/prospects/:id/convert` and the batch variant call `autoEnrollFromTrigger("contact_created")` immediately after contact creation. The `prospects` table may contain records that were never enriched (Serper, AI classification, vertical assignment). A freshly-imported CSV row with only a company name can be converted directly to a contact that enters the "New Lead" pipeline and fires sequence auto-enrollment with no enrichment requirement.  
_File: `server/routes/prospects.ts` lines 135–144, 246–253_

### MEDIUM

**KL-7 — Registry importer matches on phone number alone without a confidence threshold**  
`findMatchingMerchant()` in `registry-importer.ts` uses an exact phone match as the first deduplication step, returning immediately on first hit. A transposed digit or shared VOIP number can cause a registry row to update the wrong merchant record. Phone-only matching carries no confidence score and no human review requirement.  
_File: `server/services/sdr/registry-importer.ts` lines 286–292_

**KL-8 — Two intake paths can simultaneously write a `contacts` row for the same person**  
If a GHL contact syncs inbound while a public form submission for the same person is in flight, both `syncContactFromGhl` and `createContactGhlFirst` can attempt to create a new contacts row if the GHL sync runs before the email uniqueness constraint is hit. The DB `contacts_email_unique_idx` constraint would serialize this as a 23505 error, but only the form submission path handles that error gracefully (409). The GHL sync path propagates the error as `return null` and logs a failure, potentially leaving one of the operations in an inconsistent state.  
_Files: `server/services/ghl-sync.ts` lines 329–343, `server/routes/contacts.ts` lines 69–75_

**KL-9 — `consentTier`, `doNotContact`, `doNotAutoContact` are protected on inbound GHL sync but not on form re-submission**  
`REPLIT_OWNED_FIELDS` correctly prevents GHL inbound from overwriting compliance fields. However, `createContactGhlFirst` passes `consentSms: parseBool(consentSms)` directly from the public form body. If a merchant who previously opted out resubmits a form with `consentSms=true`, the storage write re-enables SMS consent without verifying the current opt-out state. No compliance field guard exists in the form submission path.  
_File: `server/routes/public.ts` lines 209–223_

---

## 4. Per-Source Narrative Detail

### Source 1: CSV Prospect Import (`POST /api/prospects/import`)

**What it writes:** `prospect_lists` (one row per upload) and `prospects` (one row per CSV data row). Does NOT write to `contacts`.

**Canonical owner:** `storage.createProspectsBulk()`. No other code path writes CSV-imported data simultaneously, so there is no dual-write risk at this stage. The risk begins at conversion.

**Dedupe key:** None. The import creates a `ProspectList` record and bulk-inserts all filtered rows without any uniqueness check. The only filter is `p.companyName || p.email || p.phone` — at least one of the three must be non-empty. No email uniqueness check, no name+phone dedup.

**Provenance fields:** `listId` is always set (links to the `prospect_lists` record). Column `source` does not exist on the `prospects` table schema as shown in the import; `sourceCategory` / `importedFrom` / `importBatchId` are absent. The `ProspectList` record carries `fileName` and `totalRecords` but individual prospect rows have no traceability back to the specific import file beyond the `listId` FK.

**Scoring trigger:** None at import time. Scoring only fires if the prospect is later converted to a contact via `POST /api/prospects/:id/convert`.

**Enrichment trigger:** None automatic. Enrichment is operator-triggered via `POST /api/enrichment-jobs` or the "Enrich" button per list. Serper deep enrichment, AI vertical classification, and processor detection do not fire automatically.

**Campaign eligibility:** A prospect is NOT eligible for the CRM campaign engine or sequence enrollment. Only contacts are enrolled. After conversion, `autoEnrollFromTrigger("contact_created")` fires immediately with no enrichment gate.

**GHL ownership:** No GHL write at import. GHL sync only occurs when a prospect is converted to a contact via `createContactGhlFirst()`.

**Rollback behavior:** The `ProspectList` record with `totalRecords` and `fileName` serves as an audit anchor. There is no automated or operator-facing "delete this import batch" capability. Operators can manually delete prospects filtered by `listId`, but there is no transactional rollback.

**Idempotency:** Not idempotent. Re-uploading the same CSV file creates a new `ProspectList` and duplicates all `prospects` rows. The only deduplication available is operator-driven: inspecting the `ProspectList` history and manually deleting duplicates.

---

### Source 2: Sunbiz COREVT Upload (`POST /api/sunbiz/upload-corevt`)

**What it writes:** `prospect_lists` (one row per upload) and `sunbiz_entities` (one row per parsed record). Does NOT write to `contacts` or `sdrMerchants`.

**Canonical owner:** `storage.createSunbizEntitiesBulk()`. Single writer; no dual-write risk at this stage.

**Promotion chain:** `sunbiz_entities` → `prospects` (via `convertToProspect()` — requires explicit operator action) → `contacts` (via `POST /api/prospects/:id/convert` — requires another explicit operator action). Both promotion steps require operator intervention. There is no auto-promotion path.

**Dedupe key:** No deduplication on bulk upload. The streaming parser (`streamCorevtFromZip`) emits batches and each is bulk-inserted without uniqueness checking. The single-entity import path (`/api/sunbiz/import-detail`) does check `filingNumber` uniqueness, but the COREVT bulk path does not. Re-running the same COREVT zip will create duplicate `sunbiz_entities` rows.

**Provenance fields:** `source: "corevt"`, `listId`, `enrichmentStatus: "pending"`. No `importBatchId` on individual entity rows. No `sourceCategory`. `filingNumber` provides a business-level natural key but is not enforced as unique in bulk inserts.

**Scoring trigger:** None. Sunbiz entities are not scored; scoring only applies to `contacts`.

**Enrichment trigger:** None automatic. Enrichment is operator-triggered via `/api/sunbiz/entities/:id/enrich` (single) or `/api/sunbiz/enrich-batch` (batch). `enrichmentStatus: "pending"` serves as the queue signal but nothing reads it automatically.

**Campaign eligibility:** Not eligible. Must be promoted to `prospects` then to `contacts` via two separate operator actions.

**GHL ownership:** None.

**Rollback behavior:** ProspectList record with count is the only audit anchor. No automated rollback. Because `filingNumber` is not unique-constrained on bulk upload, identifying duplicates requires listing by `listId` and comparing.

**Idempotency:** Not idempotent on bulk upload.

---

### Source 3: GHL Inbound Sync (`syncContactFromGhl`)

**What it writes:** `contacts` rows (create or update). Also writes `ghl_sync_status`, `ghl_activity_log`, and `sync_conflicts`.

**Canonical owner:** Ambiguous. `storage.syncUpdateContact()` is used for updates (preserves `updatedAt`). `storage.createContact()` is used for new contacts — this bypasses `createContactGhlFirst()` and its audit/GHL-write-first semantics.

**Dedupe key (3-tier):**
1. `ghlContactId` match — scans `getContacts({ limit: 500 })` for a local contact whose `ghlContactId` matches the incoming GHL ID. **Kill line: 500-row hard cap.**
2. Email match — if no ghlContactId match, scans the same 500-row result set for email (case-insensitive). Same 500-row cap applies.
3. Create new — if neither match found, creates a new contact record.

Confidence threshold: exact match only (no fuzzy dedup). No business name or phone fallback.

**Provenance fields:** `referralSource: "ghl_sync"`, `tags: [..., "ghl-import"]`, `lastSyncedAt`. No `sourceCategory`, no `importBatchId`.

**Scoring trigger:** None. No `scoreContact()` call in the inbound sync path.

**Enrichment trigger:** None. No `ingestBusinessFromContact()`, no Serper, no AI vertical classification triggered.

**Campaign eligibility:** Immediately eligible. Newly-created contacts have no gate preventing campaign audience inclusion or sequence enrollment.

**GHL ownership:** `REPLIT_OWNED_FIELDS` protects: `doNotContact`, `doNotAutoContact`, `consentTier`, `lifecycleStage`, `consentEmail`, `consentSms`, `smsStatus`, `emailStatus`, `phoneType`. These are stripped from all inbound GHL payloads before any write. Tags are applied unconditionally (no REPLIT_OWNED protection for array fields).

**Conflict detection:** `detectAndWriteConflicts()` compares GHL values against local values for: `firstName`, `lastName`, `email`, `phone`, `companyName`. If the local value was modified after `lastSyncedAt`, a `sync_conflicts` row is written and the field is NOT overwritten. If no local modification since last sync, GHL value wins.

**Rollback behavior:** No rollback mechanism. Each inbound sync event is logged in `ghl_activity_log` and `ghl_sync_status` but there is no batch concept or undo capability.

**Idempotency:** Idempotent for existing contacts (update path is safe). For new contacts, idempotency depends entirely on the 500-row scan — a contact beyond the cap gets created again on re-sync.

---

### Source 4: Marketing Form Submissions (`server/routes/public.ts`)

Six form handlers: `statement_upload`, `estimate`, `get_started`, `callback`, `equipment_order`, `support`.

**What it writes:** `contacts` (via `createContactGhlFirst`), `deals` (most forms), `tickets` (support), `consent_audit_log`, `pewc_decisions`, `audit_logs`.

**Canonical owner:** `createContactGhlFirst()` from `server/services/contact-writer.ts`. This is the most complete intake path: attempts GHL upsert first, then writes local DB. Fires async retry on GHL failure. All six form handlers use this function.

**Dedupe key:** No pre-check deduplication. The DB unique index on `contacts.email` (`contacts_email_unique_idx`) catches exact duplicates. On 23505 error, the handler returns a 400 (not a 409, except for `POST /api/contacts` which returns 409). For forms, duplicate email submissions from the same user result in a new contact creation attempt that will fail at the DB layer — meaning a second form submission with the same email creates a NEW DEAL linked to the existing contact (because the contact create fails but the deal create never sees the error).

**Provenance fields:** Tags array: `["src_website", "lead_XXX", "vertical_YYY", "utm_src_ZZZ"]`. UTM fields stored on contact. `referralSource` set if referral tracked. No `sourceCategory` field. No `importBatchId`.

**Scoring trigger:** `scoreContact()` fire-and-forget after creation. Runs asynchronously; result is not awaited before response is sent.

**Enrichment trigger:** `ingestBusinessFromContact()` fire-and-forget (writes to `businesses` table for dedup purposes). No Serper enrichment, no AI vertical classification triggered automatically.

**Campaign eligibility:** Immediately eligible. `autoEnrollFromTrigger("form_submitted")` and `enrollInInboundConfirmation()` fire immediately. No enrichment, scoring, or operator approval gate. This means a contact created from a spam form submission will enter the sequence enrollment path within seconds.

**GHL ownership:** `createContactGhlFirst()` attempts GHL write first. Compliance fields are protected on inbound sync via `REPLIT_OWNED_FIELDS`. However, `consentSms`/`consentEmail` from the form body are written directly to the contact without checking the existing opt-out state (Kill Line KL-9).

**Rollback behavior:** None. No batch concept for form submissions.

**Idempotency:** Partial. Same email → DB unique constraint fires → form returns 400/error. However, a new deal is not necessarily prevented (deal create runs in the chain after contact create in `runStatementUploadChain`). For `estimate` form: deal is created inline before chain, so a 23505 on contact will still result in a partial failure with audit log inconsistencies.

**Vertical classification:** `vertical` field passed directly from form body (user-supplied string). No server-side normalization via `classifyVerticalForImport()` for form submissions. The raw user input is stored.

---

### Source 5: Manual Dashboard Entry (`POST /api/contacts`)

**What it writes:** `contacts` via `createContactGhlFirst()`. Then fires: `createPreferenceAwareNotification`, `sendPushToAllReps`, `triggerWorkflowsByEvent`, `ingestBusinessFromContact`, `scoreContact`, `extractRelationshipsForContact`, `autoEnrollFromTrigger`, `routeContact`, `assignNextRep`.

**Canonical owner:** `createContactGhlFirst()` — same function as form submissions. Actor type "user" and userId recorded in audit context.

**Dedupe key:** DB unique email constraint. On duplicate, returns 409 with `existingContactId` (this is the most graceful duplicate handling of all five creation paths).

**Provenance fields:** Whatever the operator populates. No required `sourceCategory`. No `importBatchId`. `createdBy` is implicit in the audit log via `actorType: "user"` + `userId`, but not stored on the contact row directly.

**Scoring trigger:** `scoreContact()` fire-and-forget.

**Enrichment trigger:** `ingestBusinessFromContact()` fire-and-forget with `sourceLabel: "crm_contact_create"`.

**Campaign eligibility:** Immediately eligible. `autoEnrollFromTrigger("contact_created")` fires immediately.

**GHL ownership:** GHL-write-first. `_ghlSyncPending` flag returned to caller if GHL was unavailable. REPLIT_OWNED_FIELDS protected from any subsequent inbound GHL sync overwrite.

**Rollback behavior:** None. Individual delete is possible via the contact's archive/delete endpoint.

**Idempotency:** Best of the five creation paths. 409 with `existingContactId` gives the caller full information to abort or redirect.

---

### Source 6: Sunbiz Registry Import Pipeline (`server/services/sdr/registry-importer.ts`)

**What it writes:** Updates `sdrMerchants` (matched rows only) and inserts into `registryImportLog` (all rows: matched, unmatched, skipped). Does NOT write to `contacts`, `prospects`, or `sunbiz_entities`.

**Purpose:** This importer enriches existing `sdrMerchants` records with government registry data (legal name, formation date, owner name, license number). It is not a contact creation path.

**Canonical owner:** `db.update(sdrMerchants)` for matched records. No dual-write risk.

**Dedupe key (2-tier):**
1. Phone exact match — `normalizePhoneE164(rawPhone)` → exact match on `sdrMerchants.mainPhone`. No confidence threshold. Returns first hit. (Kill Line KL-7)
2. Fuzzy name match — Jaro-Winkler ≥ 0.82 on normalized business name, state must match. City and address used as tiebreakers to compute a combined score, but the threshold for a match is crossing `FUZZY_THRESHOLD = 0.82` on name alone (city/address are bonus points, not requirements). Best combined score wins.

**Provenance fields:** `importId` (UUID) on each `registryImportLog` row. `registrySource` field set on matched `sdrMerchants` (e.g., `"registry:FL"` or `"license:dental"`). This is the best batch-level provenance of all eight sources.

**Scoring trigger:** None.

**Enrichment trigger:** None. Registry data is metadata only.

**Campaign eligibility:** N/A. `sdrMerchants` are not campaign-eligible until bridged to `contacts` via `bridgeContactsToSdr()` or a manual contact conversion.

**GHL ownership:** None.

**Rollback behavior:** `registryImportLog` has `importId` per row. An operator can query all rows with a given `importId` to identify which `sdrMerchants` were updated. There is no automated rollback. Updated fields on `sdrMerchants` (legalName, ownerFirstName, etc.) are overwritten in place, so the prior values are not preserved unless in a DB audit trail.

**Idempotency:** Partially idempotent. Re-running the same file against the same database will re-update the same matched merchants with the same values (idempotent), but will also insert new `registryImportLog` rows for each record (not idempotent for the log table). Unmatched rows always insert new log entries.

---

### Source 7: Apollo Discovery (`server/services/sdr/apollo.ts` + orchestrator)

**What it writes:** Via `ingestBusiness()`: `businesses` (new or updated), `lead_sources`, `business_aliases`. Via orchestrator path: `sdrMerchants`, `sdrLeadState`, `sdr_lead_events`, `sdr_channel_attempts`.

**Canonical owner:** `ingestBusiness()` in `server/services/sdr/dedupe.ts` for the canonical business identity. `orchestrator.ts` owns the `sdrLeadState` lifecycle. No direct write to `contacts`.

**Entry path into contacts:** Discovery records only enter `contacts` via explicit operator action: either `bridgeContactsToSdr()` (which creates an `sdrMerchants` + `sdrLeadState` entry linking to an existing contact), or a manual contact creation in the CRM. There is no auto-promotion from discovery to contacts.

**Dedupe key (scored):** `findMatchingBusiness()` uses weighted scoring:
- `googlePlaceId` exact match: 60 points
- `domain` exact match: 50 points
- `phone` exact match (E.164): 40 points
- Name + city + state similarity (Jaro-Winkler ≥ 0.85 AND same city AND same state): up to 25 points

Match threshold: score ≥ 40. This means a phone-only match (40 points) is sufficient to trigger a merge, which is the same concern as KL-7.

**Source strength hierarchy:** Outscraper=90, Apify/Google=88, Apify/Yelp=85, Serper=85, Sunbiz=80. Higher-strength sources overwrite lower-strength sources for the same fields, with a 7-day freshness window.

**Provenance fields:** `sourceType`, `sourceLabel`, `importBatchId` (optional), `campaignTag` (optional) on `lead_sources`. `source` field on `sdrMerchants`. Well-structured provenance.

**Scoring trigger:** SDR-specific scoring runs inside the orchestrator sweep (`scoreLeadFull()` in `scoring.ts`) — not the CRM `leadScore` used by `contacts`. These are separate scoring systems.

**Enrichment trigger:** Automatic after discovery records enter `sdrLeadState`. Orchestrator sweep processes due leads, which can trigger Serper enrichment, processor detection, and tech stack intelligence. This is scoped to the SDR pipeline; it does NOT update `contacts.vertical` or `contacts.consentTier` unless the contact is explicitly bridged.

**Campaign eligibility:** SDR outreach only (email/SMS/call via orchestrator). Not eligible for the campaign engine that targets `contacts`. The orchestrator enforces daily send limits, business-hours checks, and bounce-rate kill switches.

**GHL ownership:** No GHL sync at discovery time. GHL write only occurs after `bridgeContactsToSdr()` creates an `sdrLeadState` with a `contactId` that already has a `ghlContactId`.

**Rollback behavior:** No batch-level rollback for Apollo discovery results. `lead_sources.importBatchId` can identify a batch's records, but no automated rollback mechanism exists.

**Idempotency:** `ingestBusiness()` is effectively idempotent for the `businesses` table (score-based merge prevents duplicates for strong signals). `lead_sources` rows are NOT deduplicated — each call to `ingestBusiness()` inserts a new `lead_sources` row regardless of whether one already exists for that source.

---

### Source 8: Outscraper + Apify Discovery (`server/services/sdr/outscraper.ts`, `apify.ts`)

**What it writes:** Same path as Apollo via `ingestBusiness()` and the orchestrator.

**Key differences from Apollo:**
- Source strength: Outscraper=90 (highest), Apify/Yelp=85 — both higher than Apollo (Apollo not explicitly listed; defaults to `csv_import=60` or `manual_upload=30` if source is mapped generically).
- Data includes `googlePlaceId` (from Outscraper Google Maps), `placeId`, `rating`, `reviewCount` — these enrich `businesses.googlePlaceId` which is the highest-weight dedup signal (60 points).
- Apify Facebook results include `facebookUrl`, which Apollo does not provide.
- Outscraper returns addresses as `full_address` concatenated strings, requiring parsing before address dedup.
- No owner/contact person data from Outscraper or Apify Google Maps (unlike Apollo which returns `ownerFirstName`, `ownerLastName`, `ownerEmail` for person-level records).

**All other dimensions** (dedupe, provenance, scoring, enrichment trigger, campaign eligibility, GHL ownership, rollback, idempotency) are identical to Source 7 above.

---

### Source 9 Cross-cut: Vertical Classification Ownership

Three distinct classification functions can assign a vertical value to a record:

**a) `classifyVerticalForImport(industry, category, companyName, keywords)`** — in `server/routes/helpers.ts`
- Regex-based keyword matching against a concatenated text string.
- Returns coarse buckets: "Restaurant", "Auto", "Retail", "Salon/Spa", "Healthcare", "Fitness/Recreation", "Food/Beverage", "Construction", "Legal", "Accounting", "Professional Services", "Transportation", "Real Estate", "Insurance", "Hospitality", "Cleaning Services", "Marketing/Media", "Technology", "Education", "Manufacturing", "Other".
- Used by: import enrichment paths (not called on form submissions; form submissions store raw user input directly).

**b) `normalizeDiscoveryVertical(category)`** — called during SDR discovery ingestion  
- Sets `sdrMerchants.subvertical` with fine-grained canonical names (e.g., "Med Spa", "Hair Salon", "Auto Repair").
- Not read from the memory files provided but referenced in `vertical-resolver.ts`.

**c) `getCanonicalLeadVertical({ subvertical, vertical })`** — in `server/services/sdr/vertical-resolver.ts`
- Prefers `subvertical` (fine-grained) over `vertical` (coarse) for any downstream consumer.
- Used by: orchestrator inbox tagging, AI reply context.

**Conflict scenario:** A contact in `contacts` has `vertical: "Salon/Spa"` (set from a form submission with user text). The same business in `sdrMerchants` has `subvertical: "Med Spa"` and `vertical: "Healthcare"` (set by discovery enrichment). If the contact is later bridged to the SDR pipeline, `sdrLeadState.vertical` is populated from `contacts.vertical` ("Salon/Spa"), not from `sdrMerchants.subvertical` ("Med Spa"). The `getCanonicalLeadVertical()` call on the lead state therefore returns "Salon/Spa" rather than the more accurate "Med Spa". The winning value depends on which system wrote last, with no conflict resolution logic.

**Risk:** Outbound sequence template selection in the orchestrator uses `normalizeVerticalKey(lead.vertical)` to pick email templates. An incorrectly bridged vertical can silently route a med spa to Salon templates or an auto repair shop to the default template, undermining all vertical-specific copy.

---

### Source 10 Cross-cut: Enrichment Trigger Audit

Based on code review across the enrichment queue handlers, BullMQ worker configuration (documented in `replit.md` as the `enrichment` queue at 10m intervals), and all eight intake paths:

**Which intake events enqueue enrichment jobs:**
- CSV Prospect Import: None automatic
- Sunbiz COREVT Upload: None automatic (`enrichmentStatus: "pending"` is a flag, not a queue entry)
- GHL Inbound Sync: None
- Form Submissions: `ingestBusinessFromContact()` fires (writes `businesses` record only, not Serper enrichment)
- Manual Dashboard Entry: `ingestBusinessFromContact()` fires
- Registry Importer: None
- Apollo Discovery: Automatic via orchestrator sweep (Serper, processor detection, tech stack)
- Outscraper/Apify: Automatic via orchestrator sweep

**Can enrichment update `contacts.vertical` or `contacts.consentTier`?**
- `ingestBusinessFromContact()` writes to `businesses` table only — does NOT update `contacts.vertical`.
- SDR orchestrator enrichment updates `sdrMerchants` and `sdrLeadState` — does NOT update `contacts` unless explicit bridge code runs.
- No enrichment path was found that modifies `contacts.consentTier`, `contacts.doNotContact`, or `contacts.doNotAutoContact`.

**Gate preventing enrichment from triggering outbound sends:**
- SDR pipeline: `isContactExcludedFromSdr()` checks `doNotContact`, `doNotAutoContact`, active deal stages, and `LB-DO-NOT-AUTO` tag before each send. This is a per-lead check, not an enrichment-phase gate.
- Campaign engine: Contactability evaluation (`evaluateContactability()`) runs during campaign audience building, not at intake time.
- **The gap:** There is no enrichment-phase gate preventing a contact from being enrolled in sequences between creation and enrichment completion. Contacts enter sequence queues immediately on `autoEnrollFromTrigger` and can receive outbound sends before enrichment has a chance to flag them as ineligible.

---

## 5. Proposed Ownership and Promotion Contract

> **PROPOSED — requires approval before Phase 3 implementation begins.**  
> This section describes design intent only. Nothing below has been implemented.

### 5.1 Single Canonical Writer for `contacts`

**Proposal:** `createContactGhlFirst()` in `server/services/contact-writer.ts` shall be the only function permitted to create a new row in the `contacts` table. All other intake paths that currently call `storage.createContact()` directly (`syncContactFromGhl`, any future bridge functions) must be refactored to route through `createContactGhlFirst()` or a new `createContactSystem()` variant that carries the same provenance, scoring, and enrichment trigger guarantees.

**Rationale:** Currently, `syncContactFromGhl` bypasses all downstream triggers. A single canonical writer ensures every contact row is born with consistent provenance, triggering, and GHL sync semantics.

### 5.2 Provenance Fields Every Intake Path Must Populate

Every `contacts` row created after Phase 3 must carry:

| Field | Required Value | Source |
|---|---|---|
| `sourceCategory` | One of: `website_form`, `manual_crm`, `ghl_sync`, `prospect_conversion`, `csv_import`, `discovery_bridge` | Set at creation time by the intake path |
| `importBatchId` | UUID; null for single-record creates | Set for any bulk or automated intake |
| `referralSource` or `leadSource` | Non-null for automated paths | Already populated by most paths; required |
| `tags` | At minimum `["src_<channel>"]` | Already implemented for form paths |

Every `prospects` row created after Phase 3 must carry:
- `importBatchId` — the `ProspectList.id` is insufficient; a row-level batch ID is required for rollback

Every `sunbiz_entities` row created after Phase 3 must carry:
- `importBatchId` at the row level (distinct from `listId`)

### 5.3 Promotion Gate: Discovery/Registry → Contacts

**Proposal:** No record in `sdrMerchants`, `sdrLeadState`, `sunbiz_entities`, or `prospects` may be promoted to `contacts` without **both** of the following gates passing:

1. **Confidence threshold gate:** The record must have a `dataReadinessScore` ≥ a defined minimum (proposed: 40/100). This requires that email, phone, or both are present and have passed basic validation, and that `vertical` has been classified by at least one enrichment pass.

2. **Operator approval gate (for bulk/automated paths):** Bulk promotions from `sunbiz_entities → prospects → contacts` must require explicit operator confirmation, not just a button click that immediately fires conversion for N records. A review queue or batch approval workflow should gate the transition.

**Rationale:** Current batch conversion (`/api/prospects/convert-batch`) converts up to 50 records with a single API call and immediately fires sequence enrollment for all of them. This is the most direct path to mass outreach of unvetted data.

**Exception:** The statement upload form (`/api/public/statement-upload`) may continue to create contacts immediately (the user has demonstrated intent by uploading a file), but `autoEnrollFromTrigger` must be deferred until `scoreContact()` and `evaluateContactability()` have resolved.

### 5.4 Scoring and Readiness Triggers After Every Promotion

After any event that transitions a record into `contacts` (regardless of intake path), the following must fire **in order** before the contact becomes eligible for campaign or sequence enrollment:

1. `scoreContact(contactId)` — must complete (not fire-and-forget) or a pending flag must block enrollment
2. `evaluateContactability(contactId)` — consent tier and channel eligibility check
3. `ingestBusinessFromContact(contactId, sourceType, sourceLabel)` — business dedup/anchor

Only after all three complete should `autoEnrollFromTrigger` be eligible to fire.

### 5.5 Idempotency Guarantee for Each Path

| Path | Proposed Guarantee |
|---|---|
| CSV Prospect Import | Deduplicate on `email` within the batch before insert; check existing prospect by email before creating; return skip count |
| Sunbiz COREVT Upload | Check `filingNumber` uniqueness before bulk insert; skip rows with existing `filingNumber` |
| GHL Inbound Sync | Replace `getContacts({limit:500})` with indexed DB query by `ghlContactId` and by `email` (no scan cap) |
| Form Submissions | Pre-check `getContactByEmail()` before `createContactGhlFirst()`; return existing contactId on match |
| Manual Dashboard | Already returns 409 with `existingContactId`; no change needed |
| Registry Importer | Already idempotent for updates; deduplicate `registryImportLog` inserts on `(importId, filingNumber)` |
| Apollo/Outscraper/Apify | Already idempotent for `businesses`; deduplicate `lead_sources` on `(businessId, sourceType, sourceExternalId)` |

### 5.6 GHL Sync Authority on Inbound

The `REPLIT_OWNED_FIELDS` set is correct and must not be reduced. Additions proposed for Phase 3:

- `sourceCategory` — should be added to `REPLIT_OWNED_FIELDS` so GHL cannot overwrite the intake provenance
- `importBatchId` — should be added to `REPLIT_OWNED_FIELDS`

### 5.7 Vertical Classification Resolution Order

When two sources disagree on `vertical` for the same contact/merchant, the following resolution order must apply:

1. Operator manual override (highest authority)
2. `normalizeDiscoveryVertical()` result from a high-confidence Serper/Outscraper enrichment
3. `classifyVerticalForImport()` result from enriched prospect data
4. Raw user input from form submission
5. GHL-synced value (lowest authority; protected by REPLIT_OWNED_FIELDS)

The winning value must be written to both `contacts.vertical` and, if a linked `sdrLeadState` exists, `sdrLeadState.vertical`, to prevent the conflict described in Section 9.

---

## 6. Relevant File Map

| File | Role |
|---|---|
| `server/routes/prospects.ts` | S1 (CSV import), S2 (Sunbiz upload/COREVT), enrichment triggers |
| `server/services/ghl-sync.ts` | S3 (GHL inbound sync), REPLIT_OWNED_FIELDS |
| `server/routes/public.ts` | S4 (all 6 form submissions) |
| `server/routes/contacts.ts` | S5 (manual dashboard entry), contact enrichment batch |
| `server/services/sdr/registry-importer.ts` | S6 (registry import pipeline) |
| `server/services/sdr/apollo.ts` | S7 (Apollo discovery source) |
| `server/services/sdr/outscraper.ts` | S8 (Outscraper source) |
| `server/services/sdr/apify.ts` | S8 (Apify/Yelp/Facebook source) |
| `server/services/sdr/orchestrator.ts` | S7+S8 (SDR pipeline sweep, lead processing, enrichment trigger) |
| `server/services/sdr/dedupe.ts` | S7+S8 (`ingestBusiness()`, `findMatchingBusiness()`, scoring) |
| `server/services/contact-writer.ts` | S4+S5 (`createContactGhlFirst()`, canonical write path) |
| `server/services/sdr/vertical-resolver.ts` | Vertical resolution: `getCanonicalLeadVertical()` |
| `server/routes/helpers.ts` | `classifyVerticalForImport()` regex classifier |
| `shared/schema.ts` | Table definitions, field names |
