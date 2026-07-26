/**
 * Master Lead Import Service
 * Handles staged ingestion of priority lead sheets into master_leads table.
 * No enrollment or outbound — rows are staged for review only.
 */
import { randomUUID } from "crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, pool } from "../db";
import { masterLeads, masterLeadBatches } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

// Column header mapping from sheet to DB fields
const SHEET_COLUMN_MAP: Record<string, keyof LeadRow> = {
  // Case-insensitive; we lowercase+trim before lookup
  "company": "company",
  "normalized_company": "normalizedCompany",
  "domain": "domain",
  "email": "email",
  "email_type": "emailType",
  "phone": "phone",
  "normalized_phone": "normalizedPhone",
  "contact_name": "contactName",
  "contact_title": "contactTitle",
  "merchant_vertical": "vertical",
  "liberty_quality_score": "qualityScore",
  "liberty_fit_tier": "fitTier",
  "outreach_readiness": "outreachReadiness",
  "readiness_reason": "readinessReason",
  "source": "source",
  "source_path": "sourcePath",
  "source_modified_date": "sourceModifiedDate",
};

interface LeadRow {
  company?: string;
  normalizedCompany?: string;
  domain?: string;
  email?: string;
  emailType?: string;
  phone?: string;
  normalizedPhone?: string;
  contactName?: string;
  contactTitle?: string;
  vertical?: string;
  qualityScore?: number;
  fitTier?: string;
  outreachReadiness?: string;
  readinessReason?: string;
  source?: string;
  sourcePath?: string;
  sourceModifiedDate?: string;
}

function normPhone(p: string): string {
  return p.replace(/\D/g, "");
}

function normDomain(d: string): string {
  return d.toLowerCase().trim().replace(/^www\./, "");
}

/**
 * Attempt to fetch sheet data via Google Drive API export (CSV export endpoint).
 * Uses the installed google-drive connector: GET /drive/v3/files/{fileId}/export?mimeType=text/csv
 * This works when the file is shared with the connected Google account.
 * Returns rows on success, or throws with a descriptive error on failure.
 */
export async function fetchSheetViaApi(
  sheetId: string,
  _tabName = "CRM Staging"
): Promise<{ rows: Record<string, string>[]; headers: string[] }> {
  const connectors = new ReplitConnectors();

  // First verify the file is accessible (gives a better error message than export)
  const metaResp = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${sheetId}?fields=id,name,mimeType`,
    { method: "GET" }
  );
  if (!metaResp.ok) {
    const body = await metaResp.text().catch(() => "");
    if (metaResp.status === 401 || metaResp.status === 403) {
      throw new Error(
        `Permission denied (HTTP ${metaResp.status}). The Google account connected to this Repl does not have access to this sheet. ` +
        `Share the sheet with the connected Google account or use the CSV export path below.`
      );
    }
    if (metaResp.status === 404) {
      throw new Error(
        `Sheet not found (HTTP 404). Verify the Sheet ID is correct and the file has not been deleted. ` +
        `Sheet ID should come from the URL: …/spreadsheets/d/SHEET_ID/edit`
      );
    }
    throw new Error(`Google Drive API error ${metaResp.status}: ${body.slice(0, 200)}`);
  }

  // Export as CSV (works for Google Sheets; note: exports first/active tab only — user must export CRM Staging specifically)
  const exportResp = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${sheetId}/export?mimeType=text%2Fcsv`,
    { method: "GET" }
  );
  if (!exportResp.ok) {
    const body = await exportResp.text().catch(() => "");
    throw new Error(`CSV export failed (HTTP ${exportResp.status}): ${body.slice(0, 200)}`);
  }

  const csvText = await exportResp.text();
  if (!csvText.trim()) throw new Error("Sheet export returned empty content");

  // Parse CSV
  const { parse: csvParse } = await import("csv-parse/sync");
  const records = csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  if (records.length === 0) throw new Error("Sheet export contained no data rows");
  const headers = Object.keys(records[0]);
  return { rows: records, headers };
}

function mapRowToLead(raw: Record<string, string>): LeadRow {
  const lead: LeadRow = {};
  for (const [key, value] of Object.entries(raw)) {
    const norm = key.toLowerCase().trim();
    const field = SHEET_COLUMN_MAP[norm];
    if (field && value) {
      if (field === "qualityScore") {
        (lead as any)[field] = parseFloat(value) || undefined;
      } else {
        (lead as any)[field] = value;
      }
    }
  }
  return lead;
}

export interface ImportBatchResult {
  batchId: string;
  totalRows: number;
  stagedCount: number;
  duplicateCount: number;
  suppressedCount: number;
  invalidCount: number;
}

/**
 * Process rows into master_leads with dedup and suppression checks.
 * Dedup order: domain → email → normalized_phone → normalized_company
 */
export async function processMasterLeadBatch(
  batchId: string,
  rows: Record<string, string>[],
  provenance: {
    sheetId?: string;
    sheetName?: string;
    tabName?: string;
  }
): Promise<ImportBatchResult> {
  let stagedCount = 0;
  let duplicateCount = 0;
  let suppressedCount = 0;
  let invalidCount = 0;
  const totalRows = rows.length;

  // ── Suppression sets ────────────────────────────────────────────────────────
  // Pull all DNC, bounced, opted-out, and existing customer emails/phones
  const [suppressedEmails, suppressedPhones, existingDomains] = await Promise.all([
    pool.query<{ email: string }>(
      `SELECT LOWER(TRIM(email)) as email FROM contacts
       WHERE do_not_contact = true
          OR email_status IN ('bounced','unsubscribed','opted_out')
          OR opted_out_email = true
         AND archived_at IS NULL
       UNION
       SELECT LOWER(TRIM(email)) FROM contacts
       WHERE lifecycle_stage IN ('customer','merchant')
         AND archived_at IS NULL`
    ).then(r => new Set(r.rows.map(x => x.email).filter(Boolean))),

    pool.query<{ phone: string }>(
      `SELECT REGEXP_REPLACE(phone, '[^0-9]', '', 'g') AS phone FROM contacts
       WHERE do_not_contact = true AND archived_at IS NULL AND phone IS NOT NULL AND phone <> ''`
    ).then(r => new Set(r.rows.map(x => x.phone).filter(p => p.length >= 10))),

    pool.query<{ website: string }>(
      `SELECT LOWER(TRIM(REPLACE(REPLACE(website,'https://',''),'http://','www.'))) AS website
       FROM contacts WHERE website IS NOT NULL AND website <> '' AND archived_at IS NULL`
    ).then(r => new Set(
      r.rows.map(x => x.website?.replace(/^www\./, "").split("/")[0]).filter(Boolean)
    )),
  ]);

  // ── Within-batch dedup tracking ─────────────────────────────────────────────
  const seenDomains = new Set<string>();
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenCompanies = new Set<string>();

  // ── Also check against already-staged rows in this batch (domain/email) ─────
  // (fresh batch — no prior rows yet, so we track as we go)

  const CHUNK = 500;
  const firstCanonicalByDomain = new Map<string, string>(); // domain → masterLeads.id
  const firstCanonicalByEmail = new Map<string, string>();
  const firstCanonicalByPhone = new Map<string, string>();
  const firstCanonicalByCompany = new Map<string, string>();

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const inserts: (typeof masterLeads.$inferInsert)[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const raw = chunk[j];
      const lead = mapRowToLead(raw);
      const rowNumber = i + j + 2; // 1-indexed, +1 for header row

      const email = (lead.email || "").toLowerCase().trim();
      const phone = normPhone(lead.normalizedPhone || lead.phone || "");
      const domain = lead.domain ? normDomain(lead.domain) : "";
      const company = (lead.normalizedCompany || lead.company || "").toLowerCase().trim();

      // Skip completely empty rows
      if (!email && !phone && !domain && !company) {
        invalidCount++;
        continue;
      }

      // ── Suppression check ─────────────────────────────────────────────────
      let suppressionReason: string | undefined;
      if (email && suppressedEmails.has(email)) {
        suppressionReason = "email_suppressed";
      } else if (phone && phone.length >= 10 && suppressedPhones.has(phone)) {
        suppressionReason = "phone_dnc";
      } else if (domain && existingDomains.has(domain)) {
        suppressionReason = "domain_existing_contact";
      }

      if (suppressionReason) {
        suppressedCount++;
        inserts.push({
          id: randomUUID(),
          importBatchId: batchId,
          status: "suppressed",
          suppressionReason,
          ...lead,
          email: email || undefined,
          normalizedPhone: phone || undefined,
          sheetId: provenance.sheetId,
          sheetName: provenance.sheetName,
          tabName: provenance.tabName,
          rowNumber,
        });
        continue;
      }

      // ── Within-batch dedup ────────────────────────────────────────────────
      let duplicateOfId: string | undefined;
      if (domain && firstCanonicalByDomain.has(domain)) {
        duplicateOfId = firstCanonicalByDomain.get(domain);
      } else if (email && firstCanonicalByEmail.has(email)) {
        duplicateOfId = firstCanonicalByEmail.get(email);
      } else if (phone && phone.length >= 10 && firstCanonicalByPhone.has(phone)) {
        duplicateOfId = firstCanonicalByPhone.get(phone);
      } else if (company && firstCanonicalByCompany.has(company)) {
        duplicateOfId = firstCanonicalByCompany.get(company);
      }

      if (duplicateOfId) {
        duplicateCount++;
        inserts.push({
          id: randomUUID(),
          importBatchId: batchId,
          status: "duplicate",
          duplicateOfId,
          canonicalLeadId: duplicateOfId,
          ...lead,
          email: email || undefined,
          normalizedPhone: phone || undefined,
          sheetId: provenance.sheetId,
          sheetName: provenance.sheetName,
          tabName: provenance.tabName,
          rowNumber,
        });
        continue;
      }

      // ── Stage the row ─────────────────────────────────────────────────────
      const newId = randomUUID();
      if (domain) firstCanonicalByDomain.set(domain, newId);
      if (email) firstCanonicalByEmail.set(email, newId);
      if (phone && phone.length >= 10) firstCanonicalByPhone.set(phone, newId);
      if (company) firstCanonicalByCompany.set(company, newId);

      stagedCount++;
      inserts.push({
        id: newId,
        importBatchId: batchId,
        status: "staged",
        ...lead,
        email: email || undefined,
        normalizedPhone: phone || undefined,
        sheetId: provenance.sheetId,
        sheetName: provenance.sheetName,
        tabName: provenance.tabName,
        rowNumber,
      });
    }

    if (inserts.length > 0) {
      await db.insert(masterLeads).values(inserts);
    }

    // Update batch progress after each chunk
    await db.update(masterLeadBatches)
      .set({
        stagedCount: sql`staged_count + ${inserts.filter(r => r.status === "staged").length}`,
        duplicateCount: sql`duplicate_count + ${inserts.filter(r => r.status === "duplicate").length}`,
        suppressedCount: sql`suppressed_count + ${inserts.filter(r => r.status === "suppressed").length}`,
        invalidCount: sql`invalid_count + ${inserts.filter(r => r.status === "invalid").length}`,
      })
      .where(eq(masterLeadBatches.id, batchId));
  }

  // Finalize batch
  await db.update(masterLeadBatches)
    .set({
      status: "completed",
      totalRows,
      stagedCount,
      duplicateCount,
      suppressedCount,
      invalidCount,
    })
    .where(eq(masterLeadBatches.id, batchId));

  return { batchId, totalRows, stagedCount, duplicateCount, suppressedCount, invalidCount };
}
