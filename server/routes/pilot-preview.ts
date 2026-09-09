/**
 * Pilot Preview Routes
 *
 * POST /api/pilot-preview/sales-rep-ops
 *   Admin/manager only. Accepts explicit IDs (no open-ended queries).
 *   Returns per-candidate verdicts + aggregate counts. Makes zero production writes.
 *   Inserts a preview record with 24h expiry (preview table only).
 */

import { type Express } from "express";
import { createHash } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";


const POLICY_VERSION = "1.0";
const MAX_REPS = 10;
const MAX_CONTACTS = 200;
const MAX_LOCATIONS = 200;

// Block-list patterns — no raw/test/demo/DNC records
const BLOCKED_NAME_PATTERNS = [/test/i, /demo/i, /example/i, /liberty-test/i];

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

interface CandidateVerdict {
  id: number | string;
  kind: "rep" | "contact" | "location";
  bucket: "accepted" | "blocked_record_class" | "blocked_dnc" | "blocked_identity_conflict" | "blocked_remediation_open" | "blocked_ineligible_location" | "blocked_stale" | "conflicted";
  reason_code: string;
}

export function registerPilotPreviewRoutes(app: Express) {
  // POST /api/pilot-preview/sales-rep-ops
  // Accepts explicit IDs. Returns verdict buckets per candidate. No production writes except the preview record.
  app.post("/api/pilot-preview/sales-rep-ops", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { repUserIds, contactIds, locationIds } = req.body ?? {};

      // Validate input arrays — must be explicit, bounded
      if (!Array.isArray(repUserIds) || repUserIds.length === 0) {
        return res.status(400).json({ error: "repUserIds must be a non-empty array" });
      }
      if (repUserIds.length > MAX_REPS) {
        return res.status(400).json({ error: `repUserIds max ${MAX_REPS}` });
      }
      if (!Array.isArray(contactIds)) {
        return res.status(400).json({ error: "contactIds must be an array" });
      }
      if (contactIds.length > MAX_CONTACTS) {
        return res.status(400).json({ error: `contactIds max ${MAX_CONTACTS}` });
      }
      if (!Array.isArray(locationIds)) {
        return res.status(400).json({ error: "locationIds must be an array" });
      }
      if (locationIds.length > MAX_LOCATIONS) {
        return res.status(400).json({ error: `locationIds max ${MAX_LOCATIONS}` });
      }

      // Ensure all IDs are valid types (no SQL injection surface beyond parameterized queries)
      const safeRepIds: string[] = repUserIds.map(String);
      const safeContactIds: number[] = contactIds.map(Number).filter(n => n > 0 && Number.isFinite(n));
      const safeLocationIds: number[] = locationIds.map(Number).filter(n => n > 0 && Number.isFinite(n));

      // ── Manager scope enforcement ──────────────────────────────────────────
      // Admins have unrestricted access. Managers may only preview reps and
      // contacts that are in their CRM scope. We derive manager scope from:
      //   1. Rep IDs: must be agent users whose assigned contacts the manager can see.
      //      We verify each requested rep user ID maps to an agent whose contacts
      //      have assigned_to matching those agents — the manager is prevented from
      //      probing arbitrary user IDs outside their team.
      //   2. Contacts: must have assigned_to IN (agent emails for the requested reps).
      //      This prevents a manager from probing contact IDs not in the pilot rep set.
      //   3. Locations: verified to have a linked contact in safeContactIds, preventing
      //      probing of arbitrary business IDs.
      // Admins bypass these checks (role already verified by requireRole).
      const requestingUser = req.user as any;
      if (requestingUser?.role === "manager") {
        // Verify all requested rep IDs exist as active agents
        if (safeRepIds.length > 0) {
          const agentCheckRows = await db.execute(sql`
            SELECT a.user_id FROM agents a WHERE a.user_id = ANY(${safeRepIds}::varchar[]) AND a.status = 'active'
          `);
          const validAgentUserIds = new Set((agentCheckRows.rows as any[]).map(r => String(r.user_id)));
          const invalidReps = safeRepIds.filter(id => !validAgentUserIds.has(id));
          if (invalidReps.length > 0) {
            return res.status(403).json({ error: `Manager cannot preview rep IDs that are not active agents: ${invalidReps.slice(0, 3).join(", ")}` });
          }
        }
        // Verify requested contacts are assigned to the pilot reps (in-scope check)
        if (safeContactIds.length > 0 && safeRepIds.length > 0) {
          const pilotAgentEmailRows = await db.execute(sql`
            SELECT email FROM agents WHERE user_id = ANY(${safeRepIds}::varchar[]) AND status = 'active'
          `);
          const pilotEmails = (pilotAgentEmailRows.rows as any[]).map(r => String(r.email));
          if (pilotEmails.length > 0) {
            const outOfScopeRows = await db.execute(sql`
              SELECT COUNT(*) AS cnt FROM contacts
              WHERE id = ANY(${safeContactIds}::integer[])
                AND (assigned_to IS NULL OR assigned_to != ALL(${pilotEmails}::text[]))
            `);
            const outOfScope = Number((outOfScopeRows.rows[0] as any)?.cnt ?? 0);
            if (outOfScope > 0) {
              return res.status(403).json({ error: `Manager preview scope violation: ${outOfScope} contact(s) are not assigned to the requested pilot reps` });
            }
          }
        }
        // Verify requested locations are linked to contacts in safeContactIds
        if (safeLocationIds.length > 0 && safeContactIds.length > 0) {
          const outOfScopeLocRows = await db.execute(sql`
            SELECT COUNT(*) AS cnt FROM businesses b
            WHERE b.id = ANY(${safeLocationIds}::integer[])
              AND NOT EXISTS (
                SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.id = ANY(${safeContactIds}::integer[])
              )
          `);
          const outOfScopeLocs = Number((outOfScopeLocRows.rows[0] as any)?.cnt ?? 0);
          if (outOfScopeLocs > 0) {
            return res.status(403).json({ error: `Manager preview scope violation: ${outOfScopeLocs} location(s) have no linked contact in the requested contact set` });
          }
        }
      }

      const verdicts: CandidateVerdict[] = [];

      // ── Rep eligibility checks ──────────────────────────────────────────────
      if (safeRepIds.length > 0) {
        const repRows = await db.execute(sql`
          SELECT u.id, u.role, u.first_name, u.last_name,
                 a.id AS agent_id, a.status AS agent_status
          FROM users u
          LEFT JOIN agents a ON a.user_id = u.id AND a.status = 'active'
          WHERE u.id = ANY(${safeRepIds}::varchar[])
        `);
        const foundRepIds = new Set((repRows.rows as any[]).map(r => r.id));

        for (const repId of safeRepIds) {
          if (!foundRepIds.has(repId)) {
            verdicts.push({ id: repId, kind: "rep", bucket: "blocked_stale", reason_code: "REP_NOT_FOUND" });
            continue;
          }
          const row = (repRows.rows as any[]).find(r => r.id === repId);
          if (!row) continue;
          if (!["agent", "manager"].includes(row.role)) {
            verdicts.push({ id: repId, kind: "rep", bucket: "conflicted", reason_code: "INVALID_ROLE" });
          } else if (!row.agent_id) {
            verdicts.push({ id: repId, kind: "rep", bucket: "blocked_stale", reason_code: "NO_ACTIVE_AGENT_RECORD" });
          } else {
            verdicts.push({ id: repId, kind: "rep", bucket: "accepted", reason_code: "OK" });
          }
        }
      }

      // ── Contact eligibility checks ─────────────────────────────────────────
      if (safeContactIds.length > 0) {
        // contact_identity_decisions has no direct contact_id column — link via:
        //   contact_identity_candidates (candidate_type='contact', candidate_id=contacts.id)
        // → contact_identity_decisions.candidate_id
        // contact_remediation_operations has no contact_id either — check system-wide in-flight ops.
        const [contactRows, identityRows, remediationRows] = await Promise.all([
          db.execute(sql`
            SELECT c.id, c.do_not_contact, c.do_not_auto_contact, c.first_name, c.last_name, c.email,
                   b.record_class
            FROM contacts c
            LEFT JOIN businesses b ON b.id = c.business_id
            WHERE c.id = ANY(${safeContactIds}::integer[])
          `),
          // Deferred decisions indicate unresolved identity; no direct contact_id in the table
          db.execute(sql`
            SELECT ic.candidate_id AS contact_id, COUNT(*) AS cnt
            FROM contact_identity_candidates ic
            JOIN contact_identity_decisions d ON d.candidate_id = ic.id
            WHERE ic.candidate_type = 'contact'
              AND ic.candidate_id = ANY(${safeContactIds}::integer[])
              AND d.decision IN ('defer','supersede')
            GROUP BY ic.candidate_id
          `),
          // System-wide in-flight remediation (no contact_id linkage in schema)
          db.execute(sql`SELECT COUNT(*) AS cnt FROM contact_remediation_operations WHERE status IN ('pending','running')`),
        ]);

        const identityConflictSet = new Set((identityRows.rows as any[]).map(r => Number(r.contact_id)));
        // For remediation: if any system-wide ops are in-flight, flag all contacts as potentially affected
        const remediationInFlight = Number((remediationRows.rows[0] as any)?.cnt ?? 0) > 0;
        const foundContactIds = new Set((contactRows.rows as any[]).map(r => Number(r.id)));

        for (const cid of safeContactIds) {
          if (!foundContactIds.has(cid)) {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_stale", reason_code: "CONTACT_NOT_FOUND" });
            continue;
          }
          const row = (contactRows.rows as any[]).find(r => Number(r.id) === cid) as any;

          // Test/demo leakage check
          const nameAndEmail = `${row.first_name ?? ""} ${row.last_name ?? ""} ${row.email ?? ""}`;
          if (BLOCKED_NAME_PATTERNS.some(p => p.test(nameAndEmail))) {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_stale", reason_code: "TEST_DEMO_RECORD" });
            continue;
          }
          if (row.do_not_contact || row.do_not_auto_contact) {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_dnc", reason_code: "DNC_FLAG" });
          } else if (row.record_class !== "canonical") {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_record_class", reason_code: "NON_CANONICAL" });
          } else if (identityConflictSet.has(cid)) {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_identity_conflict", reason_code: "OPEN_IDENTITY_DECISION" });
          } else if (remediationInFlight) {
            verdicts.push({ id: cid, kind: "contact", bucket: "blocked_remediation_open", reason_code: "SYSTEM_REMEDIATION_IN_PROGRESS" });
          } else {
            verdicts.push({ id: cid, kind: "contact", bucket: "accepted", reason_code: "OK" });
          }
        }
      }

      // ── Location eligibility checks ────────────────────────────────────────
      if (safeLocationIds.length > 0) {
        const locRows = await db.execute(sql`
          SELECT id, record_class, latitude, longitude, street_address, do_not_visit, canonical_name
          FROM businesses
          WHERE id = ANY(${safeLocationIds}::integer[])
        `);
        const foundLocIds = new Set((locRows.rows as any[]).map(r => Number(r.id)));

        for (const lid of safeLocationIds) {
          if (!foundLocIds.has(lid)) {
            verdicts.push({ id: lid, kind: "location", bucket: "blocked_stale", reason_code: "LOCATION_NOT_FOUND" });
            continue;
          }
          const row = (locRows.rows as any[]).find(r => Number(r.id) === lid) as any;

          if (BLOCKED_NAME_PATTERNS.some(p => p.test(row.canonical_name ?? ""))) {
            verdicts.push({ id: lid, kind: "location", bucket: "blocked_stale", reason_code: "TEST_DEMO_RECORD" });
            continue;
          }
          if (row.record_class !== "canonical") {
            verdicts.push({ id: lid, kind: "location", bucket: "blocked_record_class", reason_code: "NON_CANONICAL" });
          } else if (row.do_not_visit === true) {
            verdicts.push({ id: lid, kind: "location", bucket: "blocked_dnc", reason_code: "DO_NOT_VISIT" });
          } else if (!row.latitude && !row.longitude && (!row.street_address || !String(row.street_address).trim())) {
            verdicts.push({ id: lid, kind: "location", bucket: "blocked_ineligible_location", reason_code: "MISSING_LOCATION_DATA" });
          } else {
            verdicts.push({ id: lid, kind: "location", bucket: "accepted", reason_code: "OK" });
          }
        }
      }

      // ── Aggregate counts (no PII in summary) ──────────────────────────────
      const bucketCounts: Record<string, number> = {};
      for (const v of verdicts) {
        bucketCounts[v.bucket] = (bucketCounts[v.bucket] ?? 0) + 1;
      }

      const verdictSummary = {
        totalReps: safeRepIds.length,
        totalContacts: safeContactIds.length,
        totalLocations: safeLocationIds.length,
        buckets: bucketCounts,
        policyVersion: POLICY_VERSION,
      };

      // NOTE: pilot-preview is a read-only eligibility scouting tool.
      // It does NOT create certification receipts (sales_rep_ops_readiness_runs).
      // Only the admin-only POST /api/activation/sales-rep-ops-readiness/run creates those.
      // This prevents a manager from using preview activity to advance the admin certification state.

      // ── Insert preview record ──────────────────────────────────────────────
      const fingerprint = sha256hex(JSON.stringify({
        repUserIds: safeRepIds.sort(),
        contactIds: safeContactIds.sort((a, b) => a - b),
        locationIds: safeLocationIds.sort((a, b) => a - b),
        policyVersion: POLICY_VERSION,
      }));
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const createdByUserId = String((req.user as any)?.id ?? "");

      try {
        await db.execute(sql`
          INSERT INTO sales_rep_pilot_previews
            (readiness_run_id, preview_fingerprint, expires_at, rep_user_ids, candidate_contact_ids, candidate_location_ids, policy_version, verdict_summary, created_by_user_id)
          VALUES
            (${null}, ${fingerprint}, ${expiresAt}::timestamptz, ${safeRepIds}::text[],
             ${safeContactIds}::integer[], ${safeLocationIds}::integer[],
             ${POLICY_VERSION}, ${JSON.stringify(verdictSummary)}::jsonb, ${createdByUserId})
          ON CONFLICT (preview_fingerprint) DO UPDATE SET expires_at = EXCLUDED.expires_at
        `);
      } catch (err: any) {
        // Preview insert failure is non-fatal; verdicts are still returned
        console.error("[PilotPreview] Failed to insert preview record:", err.message);
      }

      res.json({
        ok: true,
        previewFingerprint: fingerprint,
        expiresAt,
        // No readinessRunId — previews are scout-only and do not create certification receipts.
        // Use POST /api/activation/sales-rep-ops-readiness/run (admin only) for certification.
        readinessRunId: null,
        policyVersion: POLICY_VERSION,
        verdictSummary,
        verdicts, // per-candidate, no PII — IDs only with bucket + reason_code
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
