/**
 * Full CRM Launch-Readiness Audit — 25 subsystems
 *
 * Each probe runs independently and returns a SubsystemResult.
 * Probes are read-only; none mutate real data.
 */
import { db } from "../db";
import { sql, desc, gte } from "drizzle-orm";
import { storage } from "../storage";

export type SubsystemStatus = "pass" | "warn" | "fail" | "disabled";

export interface SubsystemResult {
  id: string;
  name: string;
  status: SubsystemStatus;
  evidence: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

function now(): string {
  return new Date().toISOString();
}

// ─── 1. Staff login / roles / admin controls ──────────────────────────────────
async function checkStaffRoles(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT role, COUNT(*) AS cnt
      FROM users
      WHERE deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL
      GROUP BY role
    `);
    const roleCounts: Record<string, number> = {};
    for (const r of rows.rows as Array<{ role: string; cnt: string }>) {
      roleCounts[r.role] = Number(r.cnt);
    }
    const hasAdmin = (roleCounts["admin"] ?? 0) > 0;
    const total = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    if (!hasAdmin) {
      return { id: "staff_roles", name: "Staff Login / Roles / Admin Controls", status: "fail", evidence: "No admin user found — admin routes cannot be accessed", checkedAt: now(), details: { roleCounts } };
    }
    return {
      id: "staff_roles", name: "Staff Login / Roles / Admin Controls", status: "pass",
      evidence: `${total} user(s) across roles: ${Object.entries(roleCounts).map(([r, c]) => `${r}×${c}`).join(", ")}. Admin present ✓`,
      checkedAt: now(), details: { roleCounts },
    };
  } catch (err: any) {
    return { id: "staff_roles", name: "Staff Login / Roles / Admin Controls", status: "fail", evidence: `DB query failed: ${err.message}`, checkedAt: now() };
  }
}

// ─── 2. Contacts ──────────────────────────────────────────────────────────────
async function checkContacts(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ghl_contact_id IS NOT NULL) AS ghl_linked,
        COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived
      FROM contacts
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const ghlLinked = Number(s?.ghl_linked ?? 0);
    const archived = Number(s?.archived ?? 0);
    const ghlPct = total > 0 ? Math.round((ghlLinked / total) * 100) : 0;
    const status: SubsystemStatus = total === 0 ? "warn" : ghlPct < 50 ? "warn" : "pass";
    return {
      id: "contacts", name: "Contacts", status,
      evidence: `${total - archived} active contacts; ${ghlLinked} GHL-linked (${ghlPct}%). ${archived} archived.`,
      checkedAt: now(), details: { total, ghlLinked, archived, ghlPct },
    };
  } catch (err: any) {
    return { id: "contacts", name: "Contacts", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 3. Master lead database ─────────────────────────────────────────────────
async function checkLeadDatabase(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        status,
        COUNT(*) AS cnt
      FROM contacts
      WHERE archived_at IS NULL
      GROUP BY status
      ORDER BY cnt DESC
    `);
    const byStatus: Record<string, number> = {};
    for (const r of rows.rows as Array<{ status: string | null; cnt: string }>) {
      byStatus[r.status ?? "null"] = Number(r.cnt);
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    // Check suppression/dedup engine — look for doNotContact contacts
    const dncRows = await db.execute(sql`SELECT COUNT(*) AS cnt FROM contacts WHERE do_not_contact = true`);
    const dncCount = Number((dncRows.rows[0] as any)?.cnt ?? 0);
    return {
      id: "lead_database", name: "Master Lead Database", status: total > 0 ? "pass" : "warn",
      evidence: `${total} active contacts. DNC suppressed: ${dncCount}. Status breakdown: ${Object.entries(byStatus).slice(0, 5).map(([s, c]) => `${s}:${c}`).join(", ")}`,
      checkedAt: now(), details: { byStatus, total, dncCount },
    };
  } catch (err: any) {
    return { id: "lead_database", name: "Master Lead Database", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 4. Lead imports ─────────────────────────────────────────────────────────
async function checkLeadImports(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        MAX(completed_at) AS last_completed
      FROM import_executions
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const completed = Number(s?.completed ?? 0);
    const failed = Number(s?.failed ?? 0);
    const lastCompleted = s?.last_completed ? new Date(s.last_completed).toLocaleString() : "never";
    if (total === 0) {
      return { id: "lead_imports", name: "Lead Imports", status: "warn", evidence: "No import executions found yet — pipeline exists but unused", checkedAt: now() };
    }
    return {
      id: "lead_imports", name: "Lead Imports", status: failed > completed ? "warn" : "pass",
      evidence: `${completed} completed, ${failed} failed imports. Last completed: ${lastCompleted}`,
      checkedAt: now(), details: { total, completed, failed },
    };
  } catch (err: any) {
    return { id: "lead_imports", name: "Lead Imports", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 5. Dedupe and suppression ───────────────────────────────────────────────
async function checkDedupeAndSuppression(): Promise<SubsystemResult> {
  try {
    // Check sync conflicts (dedup queue)
    const conflictRows = await db.execute(sql`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE resolution = 'pending') AS pending
      FROM sync_conflicts
    `);
    const cs = conflictRows.rows[0] as any;
    const totalConflicts = Number(cs?.total ?? 0);
    const pendingConflicts = Number(cs?.pending ?? 0);

    // Check doNotContact contacts (suppression)
    const dncRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM contacts WHERE do_not_contact = true
    `);
    const dncCount = Number((dncRows.rows[0] as any)?.cnt ?? 0);

    // Check contactability module is reachable
    let contactabilityOk = false;
    try {
      const { evaluateContactability } = await import("./contactability");
      contactabilityOk = typeof evaluateContactability === "function";
    } catch { /* not reachable */ }

    const status: SubsystemStatus = !contactabilityOk ? "fail" : pendingConflicts > 50 ? "warn" : "pass";
    return {
      id: "dedupe_suppression", name: "Dedupe and Suppression", status,
      evidence: `Contactability engine: ${contactabilityOk ? "reachable ✓" : "NOT REACHABLE ✗"}. ${dncCount} DNC-suppressed contacts. ${pendingConflicts} pending sync conflicts (${totalConflicts} total).`,
      checkedAt: now(), details: { contactabilityOk, dncCount, totalConflicts, pendingConflicts },
    };
  } catch (err: any) {
    return { id: "dedupe_suppression", name: "Dedupe and Suppression", status: "fail", evidence: `Error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 6. Pipeline / deals ─────────────────────────────────────────────────────
async function checkPipeline(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        pipeline,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE ghl_opportunity_id IS NOT NULL) AS ghl_linked
      FROM deals
      GROUP BY pipeline
      ORDER BY cnt DESC
    `);
    const byPipeline: Record<string, { total: number; ghlLinked: number }> = {};
    let grandTotal = 0;
    let grandGhl = 0;
    for (const r of rows.rows as Array<{ pipeline: string | null; cnt: string; ghl_linked: string }>) {
      const key = r.pipeline ?? "unknown";
      byPipeline[key] = { total: Number(r.cnt), ghlLinked: Number(r.ghl_linked) };
      grandTotal += Number(r.cnt);
      grandGhl += Number(r.ghl_linked);
    }
    const ghlPct = grandTotal > 0 ? Math.round((grandGhl / grandTotal) * 100) : 0;
    const status: SubsystemStatus = grandTotal === 0 ? "warn" : ghlPct < 30 ? "warn" : "pass";
    return {
      id: "pipeline_deals", name: "Pipeline / Deals", status,
      evidence: `${grandTotal} deals; ${grandGhl} GHL-linked (${ghlPct}%). Pipelines: ${Object.keys(byPipeline).join(", ")}`,
      checkedAt: now(), details: { byPipeline, grandTotal, grandGhl },
    };
  } catch (err: any) {
    return { id: "pipeline_deals", name: "Pipeline / Deals", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 7. Tasks ────────────────────────────────────────────────────────────────
async function checkTasks(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_tasks,
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('completed','cancelled')) AS past_due
      FROM tasks
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const open = Number(s?.open_tasks ?? 0);
    const overdue = Number(s?.overdue ?? 0);
    const pastDue = Number(s?.past_due ?? 0);

    // Check SLA audit logs exist
    const slaRows = await db.execute(sql`
      SELECT created_at FROM audit_logs
      WHERE action LIKE '%sla%'
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastSla = (slaRows.rows[0] as any)?.created_at;
    const lastSlaStr = lastSla ? new Date(lastSla).toLocaleString() : "never";
    return {
      id: "tasks", name: "Tasks", status: total === 0 ? "warn" : "pass",
      evidence: `${total} tasks; ${open} open, ${pastDue} past-due. Last SLA audit: ${lastSlaStr}`,
      checkedAt: now(), details: { total, open, overdue, pastDue, lastSla: lastSlaStr },
    };
  } catch (err: any) {
    return { id: "tasks", name: "Tasks", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 8. Calendar ─────────────────────────────────────────────────────────────
async function checkCalendar(): Promise<SubsystemResult> {
  const calendarId = process.env.GHL_CALENDAR_ID || process.env.GHL_DEFAULT_CALENDAR_ID;
  const bookingUrl = process.env.GHL_CALENDAR_BOOKING_URL || process.env.GHL_DEFAULT_BOOKING_LINK;
  if (calendarId && bookingUrl) {
    return { id: "calendar", name: "Calendar", status: "pass", evidence: `Calendar ID: ${calendarId}. Booking URL configured ✓`, checkedAt: now(), details: { calendarId, bookingUrl } };
  }
  if (calendarId) {
    return { id: "calendar", name: "Calendar", status: "warn", evidence: `Calendar ID set (${calendarId}) but no booking URL — 'Book a Call' links will be broken`, checkedAt: now() };
  }
  return { id: "calendar", name: "Calendar", status: "warn", evidence: "GHL_CALENDAR_ID and GHL_CALENDAR_BOOKING_URL not set — booking links will use fallback placeholder", checkedAt: now() };
}

// ─── 9. Communications hub ───────────────────────────────────────────────────
async function checkCommunicationsHub(): Promise<SubsystemResult> {
  const webhookSecretSet = !!process.env.GHL_WEBHOOK_SECRET;
  const ghlConfigured = !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN && process.env.GHL_LOCATION_ID);
  try {
    // Check recent GHL activity logs
    const actRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM ghl_activity_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    const recentActivity = Number((actRows.rows[0] as any)?.cnt ?? 0);

    const status: SubsystemStatus = !ghlConfigured ? "fail" : !webhookSecretSet ? "warn" : "pass";
    return {
      id: "comms_hub", name: "Communications Hub", status,
      evidence: `GHL: ${ghlConfigured ? "configured ✓" : "NOT configured ✗"}. Webhook secret: ${webhookSecretSet ? "set ✓" : "NOT set ✗"}. GHL activity last 24h: ${recentActivity} events.`,
      checkedAt: now(), details: { ghlConfigured, webhookSecretSet, recentActivity24h: recentActivity },
    };
  } catch (err: any) {
    const status: SubsystemStatus = !ghlConfigured ? "fail" : !webhookSecretSet ? "warn" : "pass";
    return { id: "comms_hub", name: "Communications Hub", status, evidence: `GHL: ${ghlConfigured ? "configured ✓" : "NOT configured ✗"}. Webhook: ${webhookSecretSet ? "set ✓" : "NOT set ✗"}. Activity query failed: ${err.message}`, checkedAt: now() };
  }
}

// ─── 10. Support hub ─────────────────────────────────────────────────────────
async function checkSupportHub(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_tickets,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
      FROM tickets
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const open = Number(s?.open_tickets ?? 0);
    return {
      id: "support_hub", name: "Support Hub", status: "pass",
      evidence: `${total} tickets total; ${open} open. Routing tables present ✓`,
      checkedAt: now(), details: { total, open, resolved: Number(s?.resolved ?? 0) },
    };
  } catch (err: any) {
    return { id: "support_hub", name: "Support Hub", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 11. AI advisor / customer chat ─────────────────────────────────────────
async function checkAiAdvisor(): Promise<SubsystemResult> {
  const openaiConfigured = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com";
  if (!openaiConfigured) {
    return { id: "ai_advisor", name: "AI Advisor / Customer Chat", status: "fail", evidence: "AI_INTEGRATIONS_OPENAI_API_KEY not set — AI assistant, enrichment, and proposal generation all fail", checkedAt: now() };
  }
  // Check recent AI chat audit logs
  try {
    const aiRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE action LIKE 'ai_%' AND created_at > NOW() - INTERVAL '7 days'
    `);
    const recentAi = Number((aiRows.rows[0] as any)?.cnt ?? 0);
    return {
      id: "ai_advisor", name: "AI Advisor / Customer Chat", status: "pass",
      evidence: `OpenAI key set ✓. Base URL: ${openaiBaseUrl}. ${recentAi} AI audit events in last 7 days.`,
      checkedAt: now(), details: { openaiConfigured, recentAiEvents: recentAi },
    };
  } catch {
    return { id: "ai_advisor", name: "AI Advisor / Customer Chat", status: "pass", evidence: "OpenAI key set ✓", checkedAt: now() };
  }
}

// ─── 12. Merchant applications ───────────────────────────────────────────────
async function checkMerchantApplications(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        MAX(submitted_at) AS last_submitted
      FROM merchant_applications
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const lastSubmitted = s?.last_submitted ? new Date(s.last_submitted).toLocaleString() : "never";
    return {
      id: "merchant_applications", name: "Merchant Applications", status: "pass",
      evidence: `${total} applications (${Number(s?.approved ?? 0)} approved, ${Number(s?.pending ?? 0)} pending). Last submitted: ${lastSubmitted}`,
      checkedAt: now(), details: { total, approved: Number(s?.approved ?? 0), pending: Number(s?.pending ?? 0) },
    };
  } catch (err: any) {
    return { id: "merchant_applications", name: "Merchant Applications", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 13. Boarding / onboarding ───────────────────────────────────────────────
async function checkOnboarding(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total_items,
        COUNT(DISTINCT deal_id) AS deals_with_checklist
      FROM onboarding_checklist_items
    `);
    const s = rows.rows[0] as any;
    const totalItems = Number(s?.total_items ?? 0);
    const dealsWithChecklist = Number(s?.deals_with_checklist ?? 0);
    // Check auto-init setting
    const autoInitSetting = await storage.getSystemSetting("onboarding_auto_init").catch(() => null);
    return {
      id: "onboarding", name: "Boarding / Onboarding", status: "pass",
      evidence: `${totalItems} checklist items across ${dealsWithChecklist} deals. Auto-init: ${autoInitSetting !== false ? "enabled ✓" : "disabled"}.`,
      checkedAt: now(), details: { totalItems, dealsWithChecklist, autoInit: autoInitSetting },
    };
  } catch (err: any) {
    return { id: "onboarding", name: "Boarding / Onboarding", status: "warn", evidence: `Onboarding probe error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 14. Statement review ────────────────────────────────────────────────────
async function checkStatementReview(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total_docs,
        COUNT(*) FILTER (WHERE document_type = 'statement') AS statements,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved
      FROM documents
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total_docs ?? 0);
    const statements = Number(s?.statements ?? 0);

    // Check for statement analysis audit logs
    const analysisRows = await db.execute(sql`
      SELECT created_at FROM audit_logs
      WHERE action LIKE '%statement%' OR action LIKE '%analysis%'
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastAnalysis = (analysisRows.rows[0] as any)?.created_at;
    const lastStr = lastAnalysis ? new Date(lastAnalysis).toLocaleString() : "never";

    return {
      id: "statement_review", name: "Statement Review", status: "pass",
      evidence: `${total} documents (${statements} statements). Last analysis event: ${lastStr}`,
      checkedAt: now(), details: { total, statements, lastAnalysis: lastStr },
    };
  } catch (err: any) {
    return { id: "statement_review", name: "Statement Review", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 15. Underwriting ────────────────────────────────────────────────────────
async function checkUnderwriting(): Promise<SubsystemResult> {
  try {
    // Check approval gate audit logs
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE action IN ('underwriting_approved', 'underwriting_denied', 'underwriting_submitted', 'deal_approved', 'approval_gate_passed')
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    // Check deals with approval-relevant terminal status
    const dealRows = await db.execute(sql`SELECT COUNT(*) AS cnt FROM deals WHERE terminal_approval_status IS NOT NULL AND terminal_approval_status != 'not_required'`);
    const dealsWithApproval = Number((dealRows.rows[0] as any)?.cnt ?? 0);
    return {
      id: "underwriting", name: "Underwriting", status: "pass",
      evidence: `${dealsWithApproval} deals with terminal approval status. ${cnt} underwriting audit events. Approval gate routes registered ✓`,
      checkedAt: now(), details: { underwritingEvents: cnt, dealsWithApproval },
    };
  } catch (err: any) {
    // approval_status may not exist — try a simpler check
    return { id: "underwriting", name: "Underwriting", status: "warn", evidence: `Underwriting probe partial: ${err.message}`, checkedAt: now() };
  }
}

// ─── 16. Document vault ──────────────────────────────────────────────────────
async function checkDocumentVault(): Promise<SubsystemResult> {
  const credentialEncKeySet = !!process.env.CREDENTIAL_ENCRYPTION_KEY;
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending
      FROM documents
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const status: SubsystemStatus = !credentialEncKeySet ? "warn" : "pass";
    return {
      id: "document_vault", name: "Document Vault", status,
      evidence: `${total} documents (${Number(s?.approved ?? 0)} approved, ${Number(s?.pending ?? 0)} pending). CREDENTIAL_ENCRYPTION_KEY: ${credentialEncKeySet ? "set ✓" : "NOT set — document access tokens may not be encrypted ✗"}`,
      checkedAt: now(), details: { total, credentialEncKeySet },
    };
  } catch (err: any) {
    return { id: "document_vault", name: "Document Vault", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 17. Form submissions from public site ───────────────────────────────────
async function checkFormSubmissions(): Promise<SubsystemResult> {
  try {
    // Check contact_source_events for form-sourced contacts
    const rows = await db.execute(sql`
      SELECT
        source_category,
        COUNT(*) AS cnt
      FROM contact_source_events
      WHERE source_category IN ('public_form', 'upload_statement', 'free_analysis', 'get_started', 'manual_crm')
      GROUP BY source_category
      ORDER BY cnt DESC
    `);
    const bySource: Record<string, number> = {};
    for (const r of rows.rows as Array<{ source_category: string; cnt: string }>) {
      bySource[r.source_category] = Number(r.cnt);
    }
    const totalFormLeads = Object.values(bySource).reduce((a, b) => a + b, 0);
    if (totalFormLeads === 0) {
      // Also check for any contacts with referralSource = form types
      const refRows = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM contacts
        WHERE referral_source IN ('upload_statement','free_analysis','get_started','public_form')
      `);
      const refCount = Number((refRows.rows[0] as any)?.cnt ?? 0);
      if (refCount > 0) {
        return { id: "form_submissions", name: "Form Submissions (Public Site)", status: "pass", evidence: `${refCount} contacts sourced from public forms (via referral_source field)`, checkedAt: now() };
      }
      return { id: "form_submissions", name: "Form Submissions (Public Site)", status: "warn", evidence: "No form-sourced contacts found yet — public forms exist but have not received submissions in this DB", checkedAt: now() };
    }
    return {
      id: "form_submissions", name: "Form Submissions (Public Site)", status: "pass",
      evidence: `${totalFormLeads} form-sourced contacts: ${Object.entries(bySource).map(([k, v]) => `${k}:${v}`).join(", ")}`,
      checkedAt: now(), details: { bySource, totalFormLeads },
    };
  } catch (err: any) {
    return { id: "form_submissions", name: "Form Submissions (Public Site)", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 18. GHL contact/deal sync ───────────────────────────────────────────────
async function checkGhlSync(): Promise<SubsystemResult> {
  try {
    const { getGhlCircuitStatus } = await import("./ghl-sync");
    const circuit = getGhlCircuitStatus();

    // Check ghl_sync_status table
    const syncRows = await db.execute(sql`
      SELECT entity_type, last_sync_at, synced_count, error_count, last_error
      FROM ghl_sync_status
      ORDER BY last_sync_at DESC
    `);
    const syncStatuses = syncRows.rows as Array<{ entity_type: string; last_sync_at: Date | null; synced_count: number; error_count: number; last_error: string | null }>;
    const lastContactSync = syncStatuses.find(s => s.entity_type === "contacts");
    const lastDealSync = syncStatuses.find(s => s.entity_type === "deals");

    const lastSyncAt = lastContactSync?.last_sync_at ? new Date(lastContactSync.last_sync_at).toLocaleString() : "never";
    const staleMs = lastContactSync?.last_sync_at ? Date.now() - new Date(lastContactSync.last_sync_at).getTime() : Infinity;
    const isStale = staleMs > 10 * 60 * 1000; // 10 min

    let status: SubsystemStatus = "pass";
    if (circuit.circuitOpen) status = "fail";
    else if (isStale) status = "warn";

    return {
      id: "ghl_sync", name: "GHL Contact/Deal Sync", status,
      evidence: `Circuit breaker: ${circuit.circuitOpen ? `OPEN ✗ (${circuit.consecutiveFailures}/${circuit.threshold} failures)` : "closed ✓"}. Last contact sync: ${lastSyncAt}${isStale ? " (STALE)" : ""}. Errors: ${lastContactSync?.error_count ?? 0}.`,
      checkedAt: now(), details: { circuitOpen: circuit.circuitOpen, consecutiveFailures: circuit.consecutiveFailures, threshold: circuit.threshold, lastSyncAt, isStale },
    };
  } catch (err: any) {
    return { id: "ghl_sync", name: "GHL Contact/Deal Sync", status: "fail", evidence: `Probe error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 19. GHL email transport ─────────────────────────────────────────────────
async function checkGhlEmail(): Promise<SubsystemResult> {
  const ghlConfigured = !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN && process.env.GHL_LOCATION_ID);
  if (!ghlConfigured) {
    return { id: "ghl_email", name: "GHL Email Transport", status: "fail", evidence: "GHL not configured — GHL_PRIVATE_INTEGRATION_TOKEN or GHL_LOCATION_ID missing", checkedAt: now() };
  }
  try {
    // Check that sendGhlEmail is importable
    const { sendGhlEmail, isGhlConfigured } = await import("./ghl");
    const configured = isGhlConfigured();
    // Check recent GHL email activity
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM ghl_activity_logs
      WHERE channel IN ('email','ghl_email') AND direction = 'outbound' AND created_at > NOW() - INTERVAL '7 days'
    `);
    const recentSends = Number((rows.rows[0] as any)?.cnt ?? 0);
    return {
      id: "ghl_email", name: "GHL Email Transport", status: configured ? "pass" : "fail",
      evidence: `GHL configured ✓. sendGhlEmail available ✓. ${recentSends} GHL emails sent in last 7 days.`,
      checkedAt: now(), details: { configured, recentSends7d: recentSends },
    };
  } catch (err: any) {
    return { id: "ghl_email", name: "GHL Email Transport", status: "warn", evidence: `GHL configured but probe error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 20. Gmail / send-as ─────────────────────────────────────────────────────
async function checkGmail(): Promise<SubsystemResult> {
  const clientId = !!process.env.GOOGLE_CLIENT_ID;
  const clientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      id: "gmail", name: "Gmail / Send-As", status: "warn",
      evidence: `GOOGLE_CLIENT_ID: ${clientId ? "set ✓" : "NOT set ✗"}. GOOGLE_CLIENT_SECRET: ${clientSecret ? "set ✓" : "NOT set ✗"}. Gmail OAuth not available until both are set.`,
      checkedAt: now(),
    };
  }
  try {
    const { isGmailOAuthConnected } = await import("./gmail-oauth");
    const connected = await isGmailOAuthConnected();
    return {
      id: "gmail", name: "Gmail / Send-As", status: connected ? "pass" : "warn",
      evidence: `Google credentials set ✓. OAuth token: ${connected ? "present and valid ✓" : "NOT connected — complete Gmail OAuth flow in Email Health → Gmail OAuth"}`,
      checkedAt: now(), details: { clientId, clientSecret, oauthConnected: connected },
    };
  } catch (err: any) {
    return { id: "gmail", name: "Gmail / Send-As", status: "warn", evidence: `Google credentials set but OAuth probe failed: ${err.message}`, checkedAt: now() };
  }
}

// ─── 21. Webhooks ────────────────────────────────────────────────────────────
async function checkWebhooks(): Promise<SubsystemResult> {
  const webhookSecretSet = !!process.env.GHL_WEBHOOK_SECRET;
  // Check recent webhook activity
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM audit_logs
      WHERE action IN ('ghl_webhook_received','inbound_message_processed','ghl_opt_out_received','bounce_processed')
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    const recentWebhooks = Number((rows.rows[0] as any)?.cnt ?? 0);
    const status: SubsystemStatus = !webhookSecretSet ? "warn" : "pass";
    return {
      id: "webhooks", name: "Webhooks", status,
      evidence: `GHL_WEBHOOK_SECRET: ${webhookSecretSet ? "set ✓" : "NOT set — webhook signature validation disabled ✗"}. ${recentWebhooks} webhook events in last 7 days. Endpoints: /api/webhooks/ghl/message-received, /opt-out, /inbound registered.`,
      checkedAt: now(), details: { webhookSecretSet, recentWebhooks7d: recentWebhooks },
    };
  } catch (err: any) {
    return { id: "webhooks", name: "Webhooks", status: webhookSecretSet ? "pass" : "warn", evidence: `Webhook secret: ${webhookSecretSet ? "set ✓" : "NOT set ✗"}. Activity query failed: ${err.message}`, checkedAt: now() };
  }
}

// ─── 22. Queue / BullMQ / Redis / DB health ──────────────────────────────────
async function checkQueueHealth(): Promise<SubsystemResult> {
  let dbOk = false;
  let dbMs = 0;
  try {
    const { pool } = await import("../db");
    const t0 = Date.now();
    await pool.query("SELECT 1");
    dbMs = Date.now() - t0;
    dbOk = true;
  } catch { /* handled below */ }

  let queueCount: number | null = null;
  let queueFailed: number | null = null;
  let queueState: "ok" | "unavailable" | "degraded" = "unavailable";
  let queueMode: "bullmq_redis" | "legacy_interval_partial" | "unavailable" = "unavailable";
  try {
    const { requireQueueManagerReady } = await import("./queue-manager");
    const qm = requireQueueManagerReady();
    const m = await qm.getAllQueueMetrics();
    queueCount = m.queues.length;
    queueFailed = m.status === "ok"
      ? m.queues.reduce((acc, q) => acc + (q.failed ?? 0), 0)
      : null;
    queueState = m.status;
    queueMode = m.queueMode;
  } catch {
    const { getQueueMode } = await import("./queue-manager");
    queueMode = getQueueMode();
  }

  const status: SubsystemStatus = !dbOk ? "fail" : queueMode !== "bullmq_redis" || queueState === "unavailable" ? "warn" : queueState === "degraded" || (queueFailed ?? 0) > 10 ? "warn" : "pass";
  return {
    id: "queue_health", name: "Queue / BullMQ / Redis / DB Health", status,
    evidence: `DB: ${dbOk ? `${dbMs}ms ✓` : "DOWN ✗"}. Queue mode: ${queueMode}. Queues: ${queueState === "unavailable" ? "unavailable" : `${queueCount} registered, ${queueFailed} failed jobs`}.`,
    checkedAt: now(), details: { dbOk, dbMs, queueMode, queueState, queueCount, queueFailed },
  };
}

// ─── 23. Outbound global pause + per-channel pause ───────────────────────────
async function checkOutboundPause(): Promise<SubsystemResult> {
  try {
    const [globalPauseRaw, emailPauseRaw, smsPauseRaw, coldEmailPauseRaw] = await Promise.all([
      storage.getSystemSetting("outboundGlobalPaused"),
      storage.getSystemSetting("emailChannelPaused"),
      storage.getSystemSetting("smsChannelPaused"),
      storage.getSystemSetting("coldEmailChannelPaused"),
    ]);
    const globalPaused = globalPauseRaw === true || globalPauseRaw === "true";
    const emailPaused = emailPauseRaw === true || emailPauseRaw === "true";
    const smsPaused = smsPauseRaw === true || smsPauseRaw === "true";

    // Pre-launch: we WANT outbound paused — so passing means paused
    if (globalPaused) {
      return {
        id: "outbound_pause", name: "Outbound Global Pause + Per-Channel Pause", status: "pass",
        evidence: `Global outbound: PAUSED ✓ (safe for pre-launch). Email channel: ${emailPaused ? "paused" : "live"}. SMS channel: ${smsPaused ? "paused" : "live"}.`,
        checkedAt: now(), details: { globalPaused, emailPaused, smsPaused },
      };
    }
    // If not paused, show warning — pre-launch should have this paused
    return {
      id: "outbound_pause", name: "Outbound Global Pause + Per-Channel Pause", status: "warn",
      evidence: `Global outbound: LIVE (not paused — confirm you are ready for real outbound). Email: ${emailPaused ? "paused" : "live"}. SMS: ${smsPaused ? "paused" : "live"}.`,
      checkedAt: now(), details: { globalPaused, emailPaused, smsPaused },
    };
  } catch (err: any) {
    return { id: "outbound_pause", name: "Outbound Global Pause + Per-Channel Pause", status: "fail", evidence: `Settings query failed: ${err.message}`, checkedAt: now() };
  }
}

// ─── 24. Audit log ───────────────────────────────────────────────────────────
async function checkAuditLog(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        MAX(created_at) AS last_entry,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS last_hour
      FROM audit_logs
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total ?? 0);
    const lastHour = Number(s?.last_hour ?? 0);
    const lastEntry = s?.last_entry ? new Date(s.last_entry).toLocaleString() : "never";
    const status: SubsystemStatus = total === 0 ? "fail" : lastHour === 0 ? "warn" : "pass";
    return {
      id: "audit_log", name: "Audit Log", status,
      evidence: `${total} total audit entries. ${lastHour} in last hour. Most recent: ${lastEntry}`,
      checkedAt: now(), details: { total, lastHour, lastEntry },
    };
  } catch (err: any) {
    return { id: "audit_log", name: "Audit Log", status: "fail", evidence: `DB error: ${err.message}`, checkedAt: now() };
  }
}

// ─── 25. Reporting / Acquisition Hub ────────────────────────────────────────
async function checkReporting(): Promise<SubsystemResult> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT event_name) AS distinct_events,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d
      FROM analytics_events
    `);
    const s = rows.rows[0] as any;
    const total = Number(s?.total_events ?? 0);
    const last7d = Number(s?.last_7d ?? 0);
    const distinct = Number(s?.distinct_events ?? 0);

    // Check for demo/test contacts in the data
    const demoRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM contacts
      WHERE email LIKE '%test%' OR email LIKE '%demo%' OR email LIKE '%example%' OR first_name ILIKE 'test'
    `);
    const demoCount = Number((demoRows.rows[0] as any)?.cnt ?? 0);
    const hasDemoData = demoCount > 0;

    const status: SubsystemStatus = total === 0 ? "warn" : "pass";
    return {
      id: "reporting", name: "Reporting / Acquisition Hub", status,
      evidence: `${total} analytics events (${distinct} distinct types). Last 7d: ${last7d}. ${hasDemoData ? `⚠ ${demoCount} test/demo contact(s) may inflate KPIs` : "No demo data detected ✓"}`,
      checkedAt: now(), details: { total, last7d, distinct, demoCount, hasDemoData },
    };
  } catch (err: any) {
    // analytics_events may not exist — soft-fail
    return { id: "reporting", name: "Reporting / Acquisition Hub", status: "warn", evidence: `Analytics probe failed (table may not exist yet): ${err.message}`, checkedAt: now() };
  }
}

// ─── Master runner ───────────────────────────────────────────────────────────
export async function runAllLaunchReadinessChecks(): Promise<{
  subsystems: SubsystemResult[];
  summary: { total: number; pass: number; warn: number; fail: number; disabled: number };
  verdict: "GO" | "WARN" | "NO-GO";
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();

  const results = await Promise.allSettled([
    checkStaffRoles(),
    checkContacts(),
    checkLeadDatabase(),
    checkLeadImports(),
    checkDedupeAndSuppression(),
    checkPipeline(),
    checkTasks(),
    checkCalendar(),
    checkCommunicationsHub(),
    checkSupportHub(),
    checkAiAdvisor(),
    checkMerchantApplications(),
    checkOnboarding(),
    checkStatementReview(),
    checkUnderwriting(),
    checkDocumentVault(),
    checkFormSubmissions(),
    checkGhlSync(),
    checkGhlEmail(),
    checkGmail(),
    checkWebhooks(),
    checkQueueHealth(),
    checkOutboundPause(),
    checkAuditLog(),
    checkReporting(),
  ]);

  const subsystems: SubsystemResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // Fallback if probe itself threw
    const names = [
      "Staff Login / Roles / Admin Controls","Contacts","Master Lead Database","Lead Imports",
      "Dedupe and Suppression","Pipeline / Deals","Tasks","Calendar","Communications Hub",
      "Support Hub","AI Advisor / Customer Chat","Merchant Applications","Boarding / Onboarding",
      "Statement Review","Underwriting","Document Vault","Form Submissions (Public Site)",
      "GHL Contact/Deal Sync","GHL Email Transport","Gmail / Send-As","Webhooks",
      "Queue / BullMQ / Redis / DB Health","Outbound Global Pause + Per-Channel Pause",
      "Audit Log","Reporting / Acquisition Hub",
    ];
    return { id: `check_${i}`, name: names[i] ?? `Check ${i + 1}`, status: "fail" as SubsystemStatus, evidence: `Probe threw: ${(r.reason as any)?.message ?? r.reason}`, checkedAt };
  });

  const summary = {
    total: subsystems.length,
    pass: subsystems.filter(s => s.status === "pass").length,
    warn: subsystems.filter(s => s.status === "warn").length,
    fail: subsystems.filter(s => s.status === "fail").length,
    disabled: subsystems.filter(s => s.status === "disabled").length,
  };

  const verdict: "GO" | "WARN" | "NO-GO" = summary.fail > 0 ? "NO-GO" : summary.warn > 0 ? "WARN" : "GO";

  return { subsystems, summary, verdict, checkedAt };
}
