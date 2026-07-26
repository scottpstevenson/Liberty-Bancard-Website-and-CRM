/**
 * Master Lead Backfill Service
 * Idempotent migration of existing contacts into master_leads.
 *
 * Idempotency guarantees:
 *  1. Single-flight lock: rejects if a run is already in progress (checks progress key).
 *  2. Email dedupe: loads all existing master_leads emails into a Set before inserting.
 *  3. Domain dedupe: loads all existing master_leads domains into a Set before inserting.
 *  4. DB-level conflict: INSERT … ON CONFLICT (email) DO NOTHING as final safety net
 *     for the email column (partial unique index created here if not present).
 *
 * No enrollment, no outbound — rows land in master_leads with status=imported.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { randomUUID } from "crypto";

export async function runMasterLeadBackfill(): Promise<{
  total: number;
  inserted: number;
  skipped: number;
}> {
  // ── Single-flight lock: reject concurrent runs ──────────────────────────
  const existing = await storage.getSystemSetting("master_lead_backfill_progress") as any;
  if (existing?.status === "running") {
    throw new Error("A backfill run is already in progress — wait for it to complete or fail first.");
  }

  await storage.setSystemSetting("master_lead_backfill_progress", {
    status: "running",
    startedAt: new Date().toISOString(),
    inserted: 0,
    skipped: 0,
    total: 0,
    processed: 0,
  });

  try {
    // ── Ensure partial unique index on email for DB-level conflict safety ──
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS master_leads_email_unique_idx
        ON master_leads (LOWER(TRIM(email)))
        WHERE email IS NOT NULL AND TRIM(email) <> ''
    `).catch(() => {
      // Index may already exist with a different definition — non-fatal
    });

    // ── Load existing email and domain sets for in-memory dedupe ──────────
    const existingRows = await db.execute(sql`
      SELECT
        LOWER(TRIM(email))  AS email,
        LOWER(TRIM(domain)) AS domain
      FROM master_leads
      WHERE email IS NOT NULL OR domain IS NOT NULL
    `);
    const existingEmailSet = new Set<string>();
    const existingDomainSet = new Set<string>();
    for (const r of existingRows.rows as any[]) {
      if (r.email)  existingEmailSet.add(r.email);
      if (r.domain) existingDomainSet.add(r.domain);
    }

    // ── Create a batch record for this run ────────────────────────────────
    const batchName = `Backfill from contacts — ${new Date().toISOString().slice(0, 10)}`;
    const batchId = randomUUID();
    await db.execute(sql`
      INSERT INTO master_lead_batches (id, batch_name, source_method, status, imported_by)
      VALUES (${batchId}, ${batchName}, 'backfill', 'processing', 'system')
    `);

    // ── Pull candidate contacts ────────────────────────────────────────────
    const contactsResult = await db.execute(sql`
      SELECT
        id, first_name, last_name, email, phone, company_name,
        website, address, city, state,
        vertical, lead_source, source_category, import_batch_id,
        opt_out_status, unsubscribe_status, bounce_status,
        do_not_contact, existing_merchant_customer, lifecycle_stage,
        created_at
      FROM contacts
      WHERE archived_at IS NULL
        AND (
          import_batch_id IS NOT NULL
          OR lead_source IS NOT NULL
          OR source_category IN ('csv_import','sunbiz','google_ads','referral','outbound','imported_list')
        )
      ORDER BY created_at ASC
    `);

    const contacts = contactsResult.rows as any[];
    let inserted = 0;
    let skipped = 0;
    const total = contacts.length;

    const CHUNK = 100;
    for (let i = 0; i < contacts.length; i += CHUNK) {
      const chunk = contacts.slice(i, i + CHUNK);

      for (const c of chunk) {
        const email   = (c.email ?? "").toLowerCase().trim();
        const website = (c.website ?? "").trim();
        const domain  = extractDomain(website || email);

        // ── Email-or-domain dedupe (in-memory) ─────────────────────────
        if (email && existingEmailSet.has(email)) { skipped++; continue; }
        if (domain && existingDomainSet.has(domain)) { skipped++; continue; }

        // ── Determine lifecycle status based on suppression flags ───────
        let status = "imported";
        let suppressionReason: string | null = null;

        if (c.do_not_contact) {
          status = "suppressed";
          suppressionReason = "do_not_contact";
        } else if (c.existing_merchant_customer) {
          status = "client_customer";
          suppressionReason = "existing_merchant_customer";
        } else if (c.lifecycle_stage === "customer") {
          status = "client_customer";
          suppressionReason = "lifecycle_stage=customer";
        } else if (c.opt_out_status === "opted_out") {
          status = "suppressed";
          suppressionReason = "opt_out";
        } else if (c.unsubscribe_status === "unsubscribed") {
          status = "unsubscribed";
          suppressionReason = "unsubscribed";
        } else if (c.bounce_status === "hard") {
          status = "bounced";
          suppressionReason = "hard_bounce";
        }

        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;
        const normalizedPhone = (c.phone ?? "").replace(/\D/g, "").slice(0, 15) || null;
        const emailValid  = email  ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : null;
        const phoneValid  = normalizedPhone ? normalizedPhone.length >= 10 : null;

        const id = randomUUID();
        try {
          await db.execute(sql`
            INSERT INTO master_leads (
              id, import_batch_id, status,
              company, normalized_company, domain, email, phone, normalized_phone,
              contact_name, vertical, source, address, city, state, website,
              email_valid, phone_valid, sms_eligible,
              suppression_reason, created_at
            ) VALUES (
              ${id}, ${batchId}, ${status},
              ${c.company_name ?? null},
              ${(c.company_name ?? "").toLowerCase().trim() || null},
              ${domain},
              ${email || null},
              ${c.phone ?? null},
              ${normalizedPhone},
              ${name},
              ${c.vertical ?? null},
              ${c.source_category ?? c.lead_source ?? "backfill"},
              ${c.address ?? null},
              ${c.city ?? null},
              ${c.state ?? null},
              ${website || null},
              ${emailValid},
              ${phoneValid},
              ${false},
              ${suppressionReason},
              ${c.created_at ? new Date(c.created_at) : new Date()}
            )
            ON CONFLICT DO NOTHING
          `);
          inserted++;
          if (email)  existingEmailSet.add(email);
          if (domain) existingDomainSet.add(domain);
        } catch {
          // ON CONFLICT handles duplicates; any other error just skips the row
          skipped++;
        }
      }

      // Progress update after each chunk
      await storage.setSystemSetting("master_lead_backfill_progress", {
        status: "running",
        startedAt: new Date().toISOString(),
        inserted,
        skipped,
        total,
        processed: Math.min(i + CHUNK, contacts.length),
      });
    }

    // ── Finalize batch ────────────────────────────────────────────────────
    await db.execute(sql`
      UPDATE master_lead_batches
      SET status = 'completed', total_rows = ${total}, staged_count = ${inserted}
      WHERE id = ${batchId}
    `);

    await storage.setSystemSetting("master_lead_backfill_progress", {
      status: "completed",
      completedAt: new Date().toISOString(),
      inserted,
      skipped,
      total,
    });

    console.log(`[MasterLeadBackfill] Done: ${inserted} inserted, ${skipped} skipped of ${total} candidates`);
    return { total, inserted, skipped };

  } catch (err: any) {
    await storage.setSystemSetting("master_lead_backfill_progress", {
      status: "failed",
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    throw err;
  }
}

function extractDomain(value?: string): string | null {
  if (!value) return null;
  try {
    let v = value.trim();
    if (!v.startsWith("http")) v = "https://" + v;
    const url = new URL(v);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    const atIdx = value.indexOf("@");
    if (atIdx !== -1) {
      const d = value.slice(atIdx + 1).toLowerCase().trim();
      return d || null;
    }
    return null;
  }
}
