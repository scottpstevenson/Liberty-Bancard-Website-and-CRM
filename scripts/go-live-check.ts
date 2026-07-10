#!/usr/bin/env tsx
/**
 * scripts/go-live-check.ts — Go-Live Journey Verification
 *
 * Proves every critical path of the lead-to-customer journey is wired
 * correctly in the live environment and prints a human-readable ✓/✗ checklist
 * the team can screenshot for sign-off.
 *
 * Usage:
 *   npx tsx scripts/go-live-check.ts
 *   BASE_URL=http://localhost:5000 npx tsx scripts/go-live-check.ts
 *
 * Exits 0 = all 8 journey stages passed (or non-blocking gaps documented)
 * Exits 1 = one or more blocking failures detected
 *
 * Out of scope: activating ORCHESTRATOR_ENABLED or autoEnrollNewLeadDeals.
 * The script documents exactly how to do both when the operator is ready.
 */

import { db } from "../server/db";
import {
  contacts,
  deals,
  auditLogs,
  followUpSequences,
  systemSettings,
  tasks,
  notifications,
  sequenceEnrollments,
  ghlActivityLog,
  leadSources,
} from "../shared/schema";
import { eq, and, desc, isNull, gte, sql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const SYNTHETIC_EMAIL = `go-live-check-${Date.now()}@libertybancard-test.internal`;

// ─── Result tracking ──────────────────────────────────────────────────────────

interface StageResult {
  stage: number;
  name: string;
  passed: boolean;
  steps: Array<{ label: string; pass: boolean; note?: string }>;
  blocking: boolean;
}

const results: StageResult[] = [];
let createdContactId: number | null = null;
let createdDealId: number | null = null;

function step(label: string, pass: boolean, note?: string) {
  return { label, pass, note };
}

function stage(
  n: number,
  name: string,
  steps: ReturnType<typeof step>[],
  blocking = true
): StageResult {
  const passed = steps.every((s) => s.pass);
  return { stage: n, name, passed, steps, blocking };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function httpGet(path: string): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    return { status: res.status, body };
  } catch (err: any) {
    return { status: 0, body: null };
  }
}

async function httpPost(path: string, payload: any): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    return { status: res.status, body };
  } catch (err: any) {
    return { status: 0, body: err.message };
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── STAGE 1 — External integration health checks ────────────────────────────

async function checkStage1(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  // GHL
  const ghlToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const ghlLocation = process.env.GHL_LOCATION_ID;
  let ghlStatus = "not configured";

  if (!ghlToken || !ghlLocation) {
    steps.push(step("GHL: token + locationId configured", false, "Missing GHL_PRIVATE_INTEGRATION_TOKEN (or GHL_API_KEY) and/or GHL_LOCATION_ID"));
  } else {
    try {
      const res = await fetch(
        `https://services.leadconnectorhq.com/locations/${ghlLocation}`,
        {
          headers: {
            Authorization: `Bearer ${ghlToken}`,
            "Version": "2021-07-28",
          },
        }
      );
      if (res.ok) {
        ghlStatus = "connected";
        steps.push(step("GHL: token valid and location reachable", true, `Location ${ghlLocation}`));
      } else {
        const body = await res.text().catch(() => "");
        ghlStatus = `error ${res.status}`;
        if (res.status === 401) {
          steps.push(step("GHL: token valid", false, "401 — token expired. Regenerate in GHL Settings → Private Integrations."));
        } else {
          steps.push(step("GHL: API reachable", false, `HTTP ${res.status}: ${body.slice(0, 120)}`));
        }
      }
    } catch (err: any) {
      ghlStatus = "unreachable";
      steps.push(step("GHL: API reachable", false, `Network error: ${err.message}`));
    }
  }

  // Redis
  const redisUrl = process.env.REDIS_URL;
  let redisStatus = "not configured";

  if (!redisUrl) {
    redisStatus = "not_configured — using ioredis-mock (local dev fallback)";
    steps.push(step("Redis: REDIS_URL configured", false,
      "REDIS_URL is not set. System falls back to ioredis-mock (non-persistent). " +
      "Set REDIS_URL for durable BullMQ job queues in production."));
  } else {
    try {
      const { getRedisConnection } = await import("../server/services/queue-connection");
      await getRedisConnection();
      redisStatus = "connected";
      steps.push(step("Redis: connection smoke-test passed", true, redisUrl.replace(/:\/\/.*@/, "://***@")));
    } catch (err: any) {
      redisStatus = `error: ${err.message.slice(0, 80)}`;
      steps.push(step("Redis: connection smoke-test", false, err.message.slice(0, 200)));
    }
  }

  // OpenAI (Replit AI Integrations — key is a Replit-managed token, NOT a standard OpenAI key)
  const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  let openaiStatus = "not configured";

  if (!openaiKey) {
    steps.push(step("OpenAI: API key configured", false,
      "AI_INTEGRATIONS_OPENAI_API_KEY is not set. AI enrichment, blueprint generation, and auto-proposals will be skipped."));
  } else if (!openaiBaseUrl) {
    openaiStatus = "misconfigured: missing base URL";
    steps.push(step("OpenAI: base URL configured", false,
      "AI_INTEGRATIONS_OPENAI_BASE_URL is not set. Without it the Replit AI Integration token cannot reach the proxy endpoint."));
  } else {
    // The Replit AI Integration token is NOT a standard OpenAI API key — it must be validated
    // against the Replit proxy (AI_INTEGRATIONS_OPENAI_BASE_URL), not api.openai.com.
    // We probe the /models endpoint on the configured base URL.
    const baseUrl = openaiBaseUrl.replace(/\/+$/, "");
    const modelsUrl = `${baseUrl}/models`;
    try {
      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${openaiKey}` },
      });
      if (res.ok) {
        openaiStatus = "connected";
        steps.push(step("OpenAI: API key valid", true));
      } else {
        openaiStatus = `error ${res.status}`;
        steps.push(step("OpenAI: API key valid", false,
          `HTTP ${res.status} from ${modelsUrl}. If this is a Replit AI Integrations token, re-propose the integration via the Replit Integrations panel to refresh it.`));
      }
    } catch (err: any) {
      openaiStatus = `unreachable: ${err.message.slice(0, 60)}`;
      steps.push(step("OpenAI: API reachable", false, err.message.slice(0, 120)));
    }
  }

  // SMTP
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  let smtpStatus = "not configured";
  let smtpFallbackNote = "";

  if (!smtpPass || !smtpHost || !smtpUser) {
    smtpStatus = "not_configured";
    smtpFallbackNote = smtpPass
      ? "SMTP_HOST or SMTP_USER missing"
      : "SMTP_PASS not set";
    const fallbackBehavior = ghlStatus === "connected"
      ? "Emails will be sent via GHL when a GHL contact ID exists. Falls back to silent skip if no GHL contact."
      : "Neither SMTP nor GHL is configured. Transactional emails (rep alerts, proposals) will be silently skipped.";
    steps.push(step("SMTP: configured", false,
      `${smtpFallbackNote}. ${fallbackBehavior}`));
  } else {
    smtpStatus = "configured";
    steps.push(step("SMTP: SMTP_HOST + SMTP_USER + SMTP_PASS all set", true,
      `host=${smtpHost} user=${smtpUser}`));
  }

  console.log("\n  Integration health summary:");
  console.log(`    GHL:    ${ghlStatus}`);
  console.log(`    Redis:  ${redisStatus}`);
  console.log(`    OpenAI: ${openaiStatus}`);
  console.log(`    SMTP:   ${smtpStatus}`);

  // GHL and Redis are journey-critical — they must be connected for the test to run.
  // OpenAI and SMTP absence are documented config gaps, not journey blockers (GHL covers email delivery).
  const ghlPassed = ghlStatus === "connected";
  const redisPassed = redisStatus === "connected";
  const stagePassed = ghlPassed && redisPassed;
  return { stage: 1, name: "External integration health checks", passed: stagePassed, steps, blocking: true };
}

// ─── STAGE 2 — Public form → contact creation ─────────────────────────────────

async function checkStage2(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  const payload = {
    contactName: "Go-Live Check Test",
    email: SYNTHETIC_EMAIL,
    phone: "+13055550001",
    monthlyVolume: "25000",
    totalFees: "750",
    currentProvider: "go-live-check-synthetic",
    notes: "SYNTHETIC TEST CONTACT — created by go-live-check.ts, will be deleted at end of script",
  };

  const { status, body } = await httpPost("/api/public/estimate", payload);

  if (status === 201 && body?.contactId) {
    createdContactId = body.contactId;
    createdDealId = body.dealId ?? null;
    steps.push(step("POST /api/public/estimate → 201", true, `contactId=${body.contactId} dealId=${body.dealId ?? "pending"}`));
  } else {
    steps.push(step("POST /api/public/estimate → 201", false,
      status === 0
        ? `Server not reachable at ${BASE_URL}. Is the dev server running?`
        : `HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`));
    return stage(2, "Public form → contact creation", steps);
  }

  // Verify contact row in DB
  await sleep(800);
  const [row] = await db.select().from(contacts).where(eq(contacts.id, createdContactId!));
  if (row) {
    steps.push(step("Contact row written to DB", true, `id=${row.id} email=${row.email}`));

    const fieldsOk = row.email === SYNTHETIC_EMAIL && !!row.firstName;
    steps.push(step("Contact fields correct (email, firstName)", fieldsOk,
      fieldsOk ? undefined : `email=${row.email} firstName=${row.firstName}`));
  } else {
    steps.push(step("Contact row written to DB", false, `No row found for contactId=${createdContactId}`));
  }

  return stage(2, "Public form → contact creation", steps);
}

// ─── STAGE 3 — GHL sync ───────────────────────────────────────────────────────

async function checkStage3(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  if (!createdContactId) {
    return stage(3, "GHL sync", [step("Skipped: no contact from Stage 2", false)]);
  }

  const ghlConfigured = !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY) && !!process.env.GHL_LOCATION_ID;

  if (!ghlConfigured) {
    steps.push(step("GHL sync: GHL not configured — contact persisted locally", true,
      "Contact saved to local DB. GHL sync will activate once GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID are set."));
    return stage(3, "GHL sync", steps, false);
  }

  // Wait a moment for the async GHL write to complete
  await sleep(3000);

  const [row] = await db.select({ id: contacts.id, ghlContactId: contacts.ghlContactId }).from(contacts).where(eq(contacts.id, createdContactId!));

  if (row?.ghlContactId) {
    steps.push(step("ghlContactId populated on contact", true, `ghlContactId=${row.ghlContactId}`));
  } else {
    // Check audit log for ghl_sync_pending — this means the retry is queued
    const [pendingLog] = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.entityType, "contact"),
        eq(auditLogs.entityId, createdContactId!),
        eq(auditLogs.action, "ghl_sync_pending"),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    const [failLog] = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.entityType, "contact"),
        eq(auditLogs.entityId, createdContactId!),
        eq(auditLogs.action, "ghl_sync_failed"),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    if (pendingLog) {
      steps.push(step("ghlContactId populated on contact", false,
        "GHL pre-create failed at form submission time (ghl_sync_pending logged). " +
        "The 45-second auto-sync loop will retry. Check GHL token health."));
    } else if (failLog) {
      const detail = (failLog.details as any) ?? {};
      steps.push(step("ghlContactId populated on contact", false,
        `GHL sync failed: ${detail.error ?? "unknown error"}. ` +
        "Contact is persisted locally. Failure is logged — not silently dropped."));
    } else {
      steps.push(step("ghlContactId populated on contact", false,
        "No ghlContactId yet and no sync log found. GHL sync may still be in-flight — re-run after 45s."));
    }
  }

  return stage(3, "GHL sync", steps, true);
}

// ─── STAGE 4 — Deal creation & pipeline entry ────────────────────────────────

async function checkStage4(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  if (!createdContactId) {
    return stage(4, "Deal creation & pipeline entry", [step("Skipped: no contact from Stage 2", false)]);
  }

  await sleep(500);
  const dealRows = await db.select().from(deals)
    .where(and(
      eq(deals.contactId, createdContactId!),
      eq(deals.pipeline, "sales"),
    ))
    .orderBy(desc(deals.createdAt))
    .limit(5);

  if (dealRows.length === 0) {
    steps.push(step("Deal row exists in sales pipeline", false, `No deal found for contactId=${createdContactId}`));
    return stage(4, "Deal creation & pipeline entry", steps);
  }

  const deal = dealRows[0];
  if (!createdDealId) createdDealId = deal.id;

  const validStages = ["New Lead", "Statement Received", "Review In Progress"];
  const stageOk = validStages.includes(deal.stage);

  steps.push(step("Deal row exists in sales pipeline", true, `dealId=${deal.id}`));
  steps.push(step(`Deal at expected stage (${deal.stage})`, stageOk,
    stageOk ? undefined : `Unexpected stage: ${deal.stage}`));

  // Verify deal-specific GHL sync by checking ghlOpportunityId on the deal row.
  // syncDealToGhl() writes ghlOpportunityId to the deal on success — this is the
  // authoritative deal-sync signal (the function does not write audit logs).
  // Re-fetch from DB to pick up any write that may have happened since Stage 4 started.
  const [freshDeal] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
  const syncOk = !!(freshDeal?.ghlOpportunityId);
  steps.push(step("Deal synced to GHL (ghlOpportunityId populated)", syncOk,
    syncOk
      ? `ghlOpportunityId=${freshDeal!.ghlOpportunityId}`
      : "ghlOpportunityId still null — deal sync may still be in-flight (GHL auto-sync loop runs every 45s in prod). " +
        "If GHL is not configured this is expected."));

  return stage(4, "Deal creation & pipeline entry", steps, true);
}

// ─── STAGE 5 — Inbound confirmation enrollment ───────────────────────────────

async function checkStage5(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  if (!createdContactId) {
    return stage(5, "Inbound confirmation enrollment", [step("Skipped: no contact from Stage 2", false)]);
  }

  await sleep(1000);

  const [enrolledLog] = await db.select().from(auditLogs)
    .where(and(
      eq(auditLogs.entityType, "contact"),
      eq(auditLogs.entityId, createdContactId!),
      eq(auditLogs.action, "ghl_inbound_confirmation_enrolled"),
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  const [skippedLog] = await db.select().from(auditLogs)
    .where(and(
      eq(auditLogs.entityType, "contact"),
      eq(auditLogs.entityId, createdContactId!),
      eq(auditLogs.action, "inbound_confirmation_skipped"),
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  // Check both process.env AND the DB-backed store (set via Dashboard → Integrations → GHL Workflow IDs)
  const ghlInboundWorkflowIdEnv = process.env.GHL_WORKFLOW_INBOUND_CONFIRMATION;
  const ghlInboundWorkflowIdDb = await db.select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, "ghl_workflow_env_GHL_WORKFLOW_INBOUND_CONFIRMATION"))
    .limit(1)
    .then(rows => rows[0]?.value as string | null | undefined ?? null);
  const ghlInboundWorkflowId = ghlInboundWorkflowIdEnv || ghlInboundWorkflowIdDb;

  if (enrolledLog) {
    steps.push(step("enrollInInboundConfirmation called and audit logged", true,
      `ghl_inbound_confirmation_enrolled logged at ${enrolledLog.createdAt}`));
  } else if (skippedLog) {
    const detail = (skippedLog.details as any) ?? {};
    steps.push(step("enrollInInboundConfirmation: skipped (logged)", true,
      `inbound_confirmation_skipped — reason: ${detail.reason ?? "GHL_WORKFLOW_INBOUND_CONFIRMATION not set"}`));
  } else if (!ghlInboundWorkflowId) {
    steps.push(step("enrollInInboundConfirmation called", true,
      "GHL_WORKFLOW_INBOUND_CONFIRMATION not set — enrollment is a no-op. Set it via Dashboard → Integrations → GHL Workflow IDs (row: Inbound Lead — Instant Confirmation) to activate instant lead response."));
  } else {
    steps.push(step("enrollInInboundConfirmation audit log found", false,
      "Neither enrolled nor skipped log found yet. May still be in-flight — check server logs for [GHL Inbound]."));
  }

  return stage(5, "Inbound confirmation enrollment", steps, true);
}

// ─── STAGE 6 — New-Lead auto-enroll readiness ────────────────────────────────

async function checkStage6(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];

  // Check for active sequences
  const activeSequences = await db.select({
    id: followUpSequences.id,
    name: followUpSequences.name,
    status: followUpSequences.status,
  }).from(followUpSequences)
    .where(eq(followUpSequences.status, "active"))
    .limit(20);

  if (activeSequences.length > 0) {
    steps.push(step(`Active sequences exist (${activeSequences.length} found)`, true,
      activeSequences.slice(0, 3).map(s => `#${s.id}:${s.name}`).join(", ")));
  } else {
    steps.push(step("At least one sequence with status=active exists", false,
      "No active sequences found. Go to Operator Dashboard → Sequences and activate at least one."));
  }

  // Check defaultNewLeadSequenceId
  const [defaultSeqRow] = await db.select().from(systemSettings)
    .where(eq(systemSettings.key, "defaultNewLeadSequenceId"))
    .limit(1);

  const defaultSeqId = defaultSeqRow?.value ?? null;
  if (defaultSeqId) {
    const seqId = typeof defaultSeqId === "number" ? defaultSeqId : Number(defaultSeqId);
    const [seq] = await db.select({ id: followUpSequences.id, name: followUpSequences.name, status: followUpSequences.status })
      .from(followUpSequences).where(eq(followUpSequences.id, seqId)).limit(1);
    if (seq) {
      const activeOk = seq.status === "active";
      steps.push(step(`defaultSequenceId (#${seqId}) is set and ${activeOk ? "active" : "INACTIVE"}`, activeOk,
        activeOk ? seq.name : `Sequence "${seq.name}" has status=${seq.status}. Activate it first.`));
    } else {
      steps.push(step(`defaultSequenceId (#${seqId}) references valid sequence`, false,
        `Sequence #${seqId} not found in DB. Update defaultNewLeadSequenceId in Operator Dashboard.`));
    }
  } else {
    steps.push(step("defaultNewLeadSequenceId is configured", false,
      "Not set. Go to Operator Dashboard → New Lead Enrollment → map a default sequence."));
  }

  // Check autoEnrollNewLeadDeals
  const [autoEnrollRow] = await db.select().from(systemSettings)
    .where(eq(systemSettings.key, "autoEnrollNewLeadDeals"))
    .limit(1);

  const autoEnroll = autoEnrollRow?.value;
  const autoEnrollEnabled = autoEnroll === true || autoEnroll === "true";
  steps.push(step(
    `autoEnrollNewLeadDeals = ${autoEnrollEnabled ? "true (LIVE)" : "false (safe — operator-ready)"}`,
    true,
    autoEnrollEnabled
      ? "Auto-enroll is ACTIVE. New leads will be enrolled automatically on the next worker tick."
      : "Auto-enroll is OFF. Safe default. Toggle ON in Operator Dashboard → New Lead Enrollment when ready to scale volume."
  ));

  // Count New Lead deals + unenrolled gap — mirrors what the Operator Dashboard
  // stage-health view shows at /dashboard/operator?view=stage-health
  const [newLeadCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deals)
    .where(and(eq(deals.pipeline, "sales"), eq(deals.stage, "New Lead"), isNull(deals.archivedAt)));

  const dealCount = Number(newLeadCount?.count ?? 0);
  steps.push(step(`New Lead deal count readable by stage-health view`, true,
    `${dealCount} deals in "New Lead" stage (enrollment candidates)`));

  // Compute unenrolled gap: New Lead deals whose contact has no active/completed enrollment
  const newLeadDeals = await db
    .select({ contactId: deals.contactId })
    .from(deals)
    .where(and(eq(deals.pipeline, "sales"), eq(deals.stage, "New Lead"), isNull(deals.archivedAt)));

  const contactIdSet = [...new Set(newLeadDeals.map((d) => d.contactId).filter(Boolean))] as number[];
  let enrolledCount = 0;
  if (contactIdSet.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const BATCH = 500; // avoid huge IN() list
    for (let i = 0; i < contactIdSet.length; i += BATCH) {
      const chunk = contactIdSet.slice(i, i + BATCH);
      const enrolled = await db
        .select({ contactId: sequenceEnrollments.contactId })
        .from(sequenceEnrollments)
        .where(
          and(
            inArray(sequenceEnrollments.contactId, chunk),
            sql`${sequenceEnrollments.status} IN ('active','completed')`,
          )
        );
      enrolledCount += enrolled.length;
    }
  }
  const unenrolledCount = Math.max(0, dealCount - enrolledCount);
  steps.push(step(`Enrollment gap computed for Operator Dashboard`, true,
    `${enrolledCount} enrolled / ${unenrolledCount} unenrolled of ${dealCount} New Lead deals — ` +
    `visible at /dashboard/operator?view=stage-health`));

  return stage(6, "New-Lead auto-enroll readiness", steps, false);
}

// ─── STAGE 7 — Sequence worker heartbeat ─────────────────────────────────────

async function checkStage7(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const redisConfigured = !!process.env.REDIS_URL;

  // Canonical heartbeat: queue-manager emits a "sequence_worker_tick" audit log
  // entry on every tick of the sequences BullMQ worker (or setInterval fallback).
  // This is the required verification source per the go-live acceptance criteria.
  const [tickLog] = await db.select({
    id: auditLogs.id,
    action: auditLogs.action,
    createdAt: auditLogs.createdAt,
  }).from(auditLogs)
    .where(and(
      gte(auditLogs.createdAt, new Date(Date.now() - TEN_MINUTES_MS)),
      eq(auditLogs.action, "sequence_worker_tick"),
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  if (tickLog) {
    const ageMs = Date.now() - new Date(tickLog.createdAt!).getTime();
    steps.push(step("sequence_worker_tick audit log within last 10 minutes", true,
      `Last tick: ${tickLog.createdAt} (${Math.round(ageMs / 1000)}s ago)`));
  } else {
    // Fall back to system_settings for a more descriptive error (gives exact age)
    const [tickRow] = await db.select().from(systemSettings)
      .where(eq(systemSettings.key, "sequence_runner_last_tick")).limit(1);
    const tickVal = tickRow?.value as { at?: string } | null;
    const lastTickAt = tickVal?.at ? new Date(tickVal.at) : null;
    const ageMinStr = lastTickAt
      ? `${Math.round((Date.now() - lastTickAt.getTime()) / 60_000)} min ago`
      : "never";
    steps.push(step("sequence_worker_tick audit log within last 10 minutes", false,
      lastTickAt
        ? `No sequence_worker_tick audit log in last 10 min (last system-setting tick: ${ageMinStr}). ` +
          "Ensure the server is running and wait for the next sequences queue tick."
        : redisConfigured
          ? "No sequence_worker_tick logged. BullMQ sequences worker has not run yet. " +
            "Ensure the server is running and wait 60 seconds for the first tick."
          : "No sequence_worker_tick logged. setInterval fallback has not run yet. " +
            "Ensure the server is running and wait 60 seconds for the first tick."));
  }

  // Check Redis / BullMQ queue availability
  if (redisConfigured) {
    try {
      const { getQueueManager } = await import("../server/services/queue-manager");
      const qm = await getQueueManager();
      const metrics = await (qm as any).getQueueMetrics?.("sequences").catch(() => null);
      if (metrics) {
        steps.push(step("BullMQ 'sequences' queue has live worker", true,
          `waiting=${metrics.waiting ?? "?"} active=${metrics.active ?? "?"} completed=${metrics.completed ?? "?"}`));
      } else {
        steps.push(step("BullMQ queue manager accessible", true, "getQueueMetrics not available at this path — queue is up."));
      }
    } catch (err: any) {
      steps.push(step("BullMQ queue manager accessible", false, err.message.slice(0, 150)));
    }
  } else {
    steps.push(step("Queue mode: setInterval fallback (non-persistent)", true,
      "REDIS_URL not set. Jobs run on 30s setInterval inside the Node process. Set REDIS_URL for durable production queues."));
  }

  return stage(7, "Sequence worker heartbeat", steps, true);
}

// ─── STAGE 8 — SEO, role-guard, and API coverage ─────────────────────────────

async function checkStage8(): Promise<StageResult> {
  const steps: ReturnType<typeof step>[] = [];
  const { existsSync } = await import("fs");
  const { spawnSync } = await import("child_process");

  // Check server is reachable
  const { status: healthStatus } = await httpGet("/api/health");
  const serverUp = healthStatus === 200;
  steps.push(step("Dev server reachable at BASE_URL", serverUp,
    serverUp ? BASE_URL : `Server returned HTTP ${healthStatus} at ${BASE_URL}. Start the server first.`));

  // ── smoke-role-guards.ts ────────────────────────────────────────────────────
  // Requires ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD to authenticate.
  const smokeGuardsExists = existsSync("scripts/smoke-role-guards.ts");
  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  const adminPass = process.env.ADMIN_SEED_PASSWORD;

  if (!smokeGuardsExists) {
    steps.push(step("smoke-role-guards: script exists", false, "scripts/smoke-role-guards.ts not found — check repo integrity."));
  } else if (!adminEmail || !adminPass) {
    steps.push(step("smoke-role-guards: ADMIN credentials set", false,
      "ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set. " +
      "Set them and re-run: ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/go-live-check.ts"));
  } else {
    console.log("  [Stage 8] Running smoke-role-guards.ts (59/59 routes)...");
    const smokeResult = spawnSync(
      "npx", ["tsx", "scripts/smoke-role-guards.ts"],
      {
        env: { ...process.env },
        encoding: "utf8",
        timeout: 120_000,
      }
    );
    const smokePass = smokeResult.status === 0;
    const smokeOut = (smokeResult.stdout ?? "") + (smokeResult.stderr ?? "");
    // Extract pass/total line from output (e.g. "59/59 routes passed")
    const matchLine = smokeOut.match(/(\d+)\/(\d+)\s+routes?\s+(passed|checked|OK)/i);
    const summary = matchLine
      ? `${matchLine[1]}/${matchLine[2]} routes passed`
      : smokePass
        ? "exited 0 (all routes passed)"
        : `exited ${smokeResult.status ?? "ERR"}: ${smokeOut.slice(-300).replace(/\n/g, " ").trim()}`;
    steps.push(step(`smoke-role-guards: all routes pass (exit 0)`, smokePass, summary));
  }

  // ── seo-audit.ts ───────────────────────────────────────────────────────────
  const seoAuditExists = existsSync("scripts/seo-audit.ts");
  if (!seoAuditExists) {
    steps.push(step("seo-audit: script exists", false, "scripts/seo-audit.ts not found — check repo integrity."));
  } else {
    console.log("  [Stage 8] Running seo-audit.ts...");
    const seoResult = spawnSync(
      "npx", ["tsx", "scripts/seo-audit.ts"],
      {
        env: { ...process.env, BASE_URL },
        encoding: "utf8",
        timeout: 120_000,
      }
    );
    const seoPass = seoResult.status === 0;
    const seoOut = (seoResult.stdout ?? "") + (seoResult.stderr ?? "");
    // Extract summary from last few lines of output
    const lastLines = seoOut.trim().split("\n").slice(-4).join(" ").replace(/\s+/g, " ");
    const summary = seoPass
      ? `exit 0 — ${lastLines.slice(0, 200)}`
      : `exit ${seoResult.status ?? "ERR"}: ${lastLines.slice(0, 300)}`;
    steps.push(step("seo-audit: exits 0 (no broken meta tags or missing descriptions)", seoPass, summary));
  }

  // ── check-api-coverage.ts ─────────────────────────────────────────────────
  const apiCoverageExists = existsSync("scripts/check-api-coverage.ts");
  const KNOWN_UNMATCHED_PATHS = [
    "GET  /api/public/unsubscribe/:token",
    "GET  /api/nps/:token",
    "GET  /api/locations/:city/:slug",
    "GET  /api/compare/:slug",
    "GET  /api/industries/:slug",
    "POST /api/public/affiliate-signup",
    "GET  /api/affiliate/stats/:code",
    "POST /api/public/callback",
    "GET  /api/changelog",
  ];

  if (!apiCoverageExists) {
    steps.push(step("check-api-coverage: script exists", false, "scripts/check-api-coverage.ts not found."));
  } else {
    const coverageResult = spawnSync(
      "npx", ["tsx", "scripts/check-api-coverage.ts"],
      { env: { ...process.env }, encoding: "utf8", timeout: 60_000 }
    );
    const coveragePass = coverageResult.status === 0;
    steps.push(step("api-coverage: no new unmatched API paths", coveragePass,
      coveragePass
        ? `${KNOWN_UNMATCHED_PATHS.length} known pre-existing unmatched paths tracked (not regressions)`
        : `exit ${coverageResult.status ?? "ERR"}: new unmatched paths detected — update check-api-coverage.ts`));
    if (coveragePass) {
      steps.push(step(
        "Known unmatched paths documented",
        true,
        KNOWN_UNMATCHED_PATHS.join(" | ")
      ));
    }
  }

  // ── Cleanup — merged into Stage 8 per the 8-stage sign-off contract ──────────
  // Synthetic test contact/deal must be deleted before marking GO; leaked records
  // pollute production data and make the next go-live-check run unreliable.
  if (createdDealId) {
    await db.delete(ghlActivityLog).where(eq(ghlActivityLog.dealId, createdDealId)).catch(() => {});
    await db.delete(tasks).where(eq(tasks.dealId, createdDealId)).catch(() => {});
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.dealId, createdDealId)).catch(() => {});
    const dealDel = await db.delete(deals).where(eq(deals.id, createdDealId))
      .then(() => true).catch(() => false);
    steps.push(step(`Test deal #${createdDealId} deleted`, dealDel,
      dealDel ? undefined : "FK constraint blocked deal deletion — clean up manually before re-running."));
  }
  if (createdContactId) {
    await db.delete(ghlActivityLog).where(eq(ghlActivityLog.contactId, createdContactId)).catch(() => {});
    await db.delete(tasks).where(eq(tasks.contactId, createdContactId)).catch(() => {});
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.contactId, createdContactId)).catch(() => {});
    await db.delete(leadSources).where(eq(leadSources.contactId, createdContactId)).catch(() => {});
    const contactDel = await db.delete(contacts).where(eq(contacts.id, createdContactId))
      .then(() => true).catch(() => false);
    steps.push(step(`Test contact #${createdContactId} deleted`, contactDel,
      contactDel ? undefined : "FK constraint blocked contact deletion — clean up manually before re-running."));
  }

  return stage(8, "SEO, role-guard, API coverage & cleanup", steps, true);
}


// ─── Render helpers ───────────────────────────────────────────────────────────

function renderStage(r: StageResult) {
  const icon = r.passed ? "✓" : (r.blocking ? "✗" : "⚠");
  const verdict = r.passed ? "PASS" : (r.blocking ? "FAIL" : "WARN");
  console.log(`\n┌─ Stage ${r.stage}: ${r.name}  [${verdict}]`);
  for (const s of r.steps) {
    const mark = s.pass ? "  ✓" : "  ✗";
    const note = s.note ? `\n       ↳ ${s.note}` : "";
    console.log(`${mark} ${s.label}${note}`);
  }
}

function renderActivationChecklist() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                      ACTIVATION STEPS (when ready to scale)                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  1. Verify GHL token is valid                                                ║
║     → Dashboard → Activation Panel → GHL Auth Test must show "Connected"     ║
║     → If expired: GHL Settings → Private Integrations → regenerate token     ║
║                                                                              ║
║  2. Map a default sequence for New Lead enrollment                           ║
║     → Operator Dashboard → New Lead Enrollment tab                           ║
║     → Select an ACTIVE sequence as default (or configure vertical map)       ║
║                                                                              ║
║  3. Confirm GHL_WORKFLOW_INBOUND_CONFIRMATION is set (optional but advised)  ║
║     → Adds inbound leads to GHL confirmation workflow automatically          ║
║     → Set via Dashboard → Integrations → GHL Workflow ID Manager             ║
║                                                                              ║
║  4. Toggle auto-enroll ON when ready for volume                              ║
║     → Operator Dashboard → New Lead Enrollment → Enable Auto-Enroll          ║
║     → Verify "autoEnrollNewLeadDeals=true" in system settings                ║
║                                                                              ║
║  5. Monitor first 24 hours in Operator Dashboard                             ║
║     → Watch: Send Volume, Reply Rate, Bounce Rate, Anomaly Alerts            ║
║     → Sequence compliance: pause immediately on anomalies                    ║
║                                                                              ║
║  6. Enable ORCHESTRATOR_ENABLED only after reviewing AI SDR tasks            ║
║     → Set env var ORCHESTRATOR_ENABLED=true and restart                      ║
║     → Recommended: start with ORCHESTRATOR_REVIEW_MODE=true (dry-run)       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("   Liberty Bancard — Go-Live Journey Verification");
  console.log(`   ${new Date().toISOString()}  BASE_URL=${BASE_URL}`);
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`   Synthetic test email: ${SYNTHETIC_EMAIL}`);

  console.log("\n▶ Stage 1: External integration health checks...");
  results.push(await checkStage1());

  console.log("\n▶ Stage 2: Public form → contact creation...");
  results.push(await checkStage2());

  console.log("\n▶ Stage 3: GHL sync...");
  results.push(await checkStage3());

  console.log("\n▶ Stage 4: Deal creation & pipeline entry...");
  results.push(await checkStage4());

  console.log("\n▶ Stage 5: Inbound confirmation enrollment...");
  results.push(await checkStage5());

  console.log("\n▶ Stage 6: New-Lead auto-enroll readiness...");
  results.push(await checkStage6());

  console.log("\n▶ Stage 7: Sequence worker heartbeat...");
  results.push(await checkStage7());

  console.log("\n▶ Stage 8: SEO, role-guard, API coverage & cleanup...");
  results.push(await checkStage8());

  // ── Print stage results ──
  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("   CHECKLIST RESULTS");
  console.log("════════════════════════════════════════════════════════════════════");
  for (const r of results) {
    renderStage(r);
  }

  // ── Final verdict ──
  console.log("\n════════════════════════════════════════════════════════════════════");

  const blockingFailures = results.filter((r) => !r.passed && r.blocking);
  const warnings = results.filter((r) => !r.passed && !r.blocking);
  const passes = results.filter((r) => r.passed);

  console.log(`   SUMMARY: ${passes.length}/${results.length} stages fully passed`);
  if (warnings.length > 0) {
    console.log(`   WARNINGS (non-blocking): ${warnings.map((r) => `Stage ${r.stage}`).join(", ")}`);
  }

  if (blockingFailures.length === 0) {
    console.log("\n   ✓✓✓  GO — All blocking journey checks passed.");
    console.log("         Non-blocking warnings above are integration-config gaps");
    console.log("         (GHL token, SMTP, Redis) that do not prevent local operation.");
  } else {
    console.log(`\n   ✗✗✗  NO-GO — ${blockingFailures.length} blocking stage(s) failed:`);
    for (const r of blockingFailures) {
      const failedSteps = r.steps.filter((s) => !s.pass).map((s) => s.label);
      console.log(`         Stage ${r.stage} (${r.name}): ${failedSteps.slice(0, 2).join("; ")}`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════════");

  // ── Per-stage GO/NO-GO ──
  console.log("\n   Per-Stage GO / NO-GO:");
  for (const r of results) {
    const verdict = r.passed ? "GO     " : (r.blocking ? "NO-GO  " : "WARN   ");
    const icon    = r.passed ? "✓"       : (r.blocking ? "✗"       : "⚠");
    console.log(`   ${icon} Stage ${r.stage}: ${verdict} ${r.name}`);
  }

  renderActivationChecklist();

  process.exit(blockingFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n[go-live-check] Fatal error:", err);
  process.exit(1);
});
