import { storage } from "../storage";
import { sendTemplatedMessage, isGhlConfigured } from "./ghl";
import { advanceDealStage } from "./deal-stage-service";
import { updateContactLocalFirst } from "./contact-writer";
import { resolvePacketVertical, GENERAL_FALLBACK_VERTICAL } from "../../shared/collateral-packet-verticals";
import { applyConsentCommand } from "./consent-authority";
import crypto from "crypto";
import { runFollowupEffect } from "./followup-effects";
import { applyLocalWorkflowAction } from "./workflow-local-actions";
import { workflowDefinitionPin } from "./workflow-run-lease";
import { renderMessage, type TokenSource } from "./message-token-registry";
import { FIRST_PARTY_BOOK_URL, resolveSalesBooking } from "./message-cta-contract";
import { escapeHtml, type RenderFormat } from "./message-render";
import {
  classifyCr06SequencePurpose,
  decideCr06PromotionalLifecycle,
} from "./cr06-promotional-lifecycle-decision";

async function canSendWorkflowTemplate(templateId: number, contactId: number): Promise<{ allowed: boolean; reason?: string; boundPhone?: string }> {
  const template = await storage.getMessageTemplate(templateId);
  if (!template || !template.isActive || !["email", "sms"].includes(template.channel)) {
    return { allowed: false, reason: "Workflow template is missing, inactive, or has an unsupported channel" };
  }
  if (template.channel === "sms") return canSendWorkflowSms(contactId, "workflow_template");
  const { evaluateContactability } = await import("./contactability");
  const decision = await evaluateContactability({
    contactId,
    channel: template.channel as "email" | "sms",
    campaignType: "workflow_template",
    mode: "enforcement",
  });
  return { allowed: decision.allowed, reason: decision.reason };
}

/**
 * SMS permission for a workflow step from the canonical consent authority. The returned number is the one the decision
 * was made for; it travels with the send so a number change before dispatch is refused instead of texting the new owner.
 */
async function canSendWorkflowSms(contactId: number, purpose: string): Promise<{ allowed: boolean; reason?: string; boundPhone?: string }> {
  const { resolveSmsRecipient } = await import("./sms-recipient-authority");
  const resolution = await resolveSmsRecipient({ contactId, purpose });
  if (!resolution.allowed) return { allowed: false, reason: `${resolution.code}: ${resolution.reason}` };
  return { allowed: true, boundPhone: resolution.phone };
}

export async function sendWorkflowEmail(params: { contactId: number; dealId?: number; subject: string; body: string }) {
  const { channelOrchestrator } = await import("./transports/index");
  return channelOrchestrator.sendEmail(params);
}

export async function sendWorkflowSms(params: { contactId: number; dealId?: number; body: string; boundPhone?: string | null }) {
  const { channelOrchestrator } = await import("./transports/index");
  const result = await channelOrchestrator.sendSms({ ...params, purpose: "workflow_sms" });
  // A fence refusal carries its reason in skipReason; without mapping it the receipt and step log lose why nothing went out.
  return result.success ? result : { ...result, error: result.error ?? result.skipReason ?? "sms_not_sent" };
}

export interface WorkflowContext {
  entityType?: string;
  entityId?: number;
  contactId?: number;
  dealId?: number;
  data?: Record<string, any>;
  occurrenceId?: string;
}

async function resolveContext(ctx: WorkflowContext): Promise<{ contactId?: number; dealId?: number }> {
  let contactId = ctx.contactId;
  let dealId = ctx.dealId;

  if (ctx.entityType === "deal" && ctx.entityId) {
    dealId = ctx.entityId;
    if (!contactId) {
      const deal = await storage.getDeal(dealId);
      contactId = deal?.contactId || undefined;
    }
  } else if (ctx.entityType === "contact" && ctx.entityId) {
    contactId = ctx.entityId;
  }

  return { contactId, dealId };
}

/**
 * Resolves which collateral packet should be sent for a given contact/deal.
 * Match order: explicit packetId override -> deal.offerPath -> resolved
 * deal.vertical -> General/Local Business fallback. Shared by the
 * workflow-executor's `send_packet` action and any manual "send packet"
 * entry points (e.g. the call outcome UI) so both paths stay consistent.
 */
export function resolveCollateralPacket(
  packets: any[],
  opts: { packetId?: number; deal?: any }
): any | undefined {
  const { packetId, deal } = opts;
  let matchedPacket = packets.find((p: any) => p.id === packetId && p.isActive !== false);
  if (!matchedPacket && deal) {
    matchedPacket = packets.find((p: any) => p.offerPath && p.offerPath === deal.offerPath && p.isActive);
    if (!matchedPacket) {
      const canonicalVertical = resolvePacketVertical(deal.vertical);
      if (canonicalVertical) {
        matchedPacket = packets.find((p: any) => p.vertical === canonicalVertical && p.isActive);
      }
    }
  }
  if (!matchedPacket) {
    matchedPacket = packets.find((p: any) => p.vertical === GENERAL_FALLBACK_VERTICAL && p.isActive);
  }
  return matchedPacket;
}

async function interpolateTemplate(text: string, contactId?: number, dealId?: number): Promise<string> {
  if (!text) return "";
  let result = text;

  if (contactId) {
    const contact = await storage.getContact(contactId);
    if (contact) {
      result = result
        .replace(/\{\{contact\.firstName\}\}/g, contact.firstName || "")
        .replace(/\{\{contact\.lastName\}\}/g, contact.lastName || "")
        .replace(/\{\{contact\.companyName\}\}/g, contact.companyName || "")
        .replace(/\{\{contact\.email\}\}/g, contact.email || "")
        .replace(/\{\{firstName\}\}/g, contact.firstName || "")
        .replace(/\{\{lastName\}\}/g, contact.lastName || "")
        .replace(/\{\{companyName\}\}/g, contact.companyName || "")
        .replace(/\{\{contact\.vertical\}\}/g, contact.vertical || "");
    }
  }

  if (dealId) {
    const deal = await storage.getDeal(dealId);
    if (deal) {
      result = result
        .replace(/\{\{deal\.stage\}\}/g, deal.stage || "")
        .replace(/\{\{deal\.offerPath\}\}/g, deal.offerPath || "")
        .replace(/\{\{deal\.effectiveRate\}\}/g, deal.effectiveRate || "")
        .replace(/\{\{deal\.totalVolume\}\}/g, deal.totalVolume || "");
    }
  }

  // Sales booking is delivered through the first-party /book adapter only when the shared configuration is valid;
  // otherwise the token stays unresolved so the step is blocked rather than sending a dead or wrong calendar.
  if (workflowCalendarLink()) result = result.replace(/\{\{calendarLink\}\}/g, workflowCalendarLink()!);
  return result;
}

function workflowCalendarLink(): string | null {
  return resolveSalesBooking(process.env as Record<string, string | undefined>).available ? FIRST_PARTY_BOOK_URL : null;
}

/**
 * Final-send rendering for workflow email/SMS steps. Uses the same registry and renderer as publication checks and
 * previews: unsupported or unresolved tokens throw (the step fails and nothing is sent), values are escaped for the
 * output format, and non-person first names render a generic greeting.
 */
async function renderWorkflowMessage(text: string, contactId: number, dealId: number | undefined, format: RenderFormat): Promise<string> {
  const contact = await storage.getContact(contactId);
  if (!contact) throw new Error("Contact not found for message rendering");
  const deal = dealId ? await storage.getDeal(dealId) : undefined;
  const source: TokenSource = {
    contact: {
      firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone,
      companyName: contact.companyName, vertical: contact.vertical,
    },
    deal: deal ? {
      stage: deal.stage, offerPath: deal.offerPath, effectiveRate: deal.effectiveRate, totalVolume: deal.totalVolume,
    } : null,
    calendarLink: workflowCalendarLink(),
  };
  return renderMessage("workflow", text, source, format).output;
}


const CONTEXT_DATA_KEYS = ["classification", "channel", "messageId", "eventId", "dayNumber", "purpose", "appointmentId", "callId", "disposition"];
/** The minimum authoritative inputs persisted with a run (never a raw payload). */
export function persistableWorkflowContext(ctx: WorkflowContext): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of CONTEXT_DATA_KEYS) if (ctx.data && ctx.data[key] !== undefined && ctx.data[key] !== null) data[key] = ctx.data[key];
  return {
    entityType: ctx.entityType ?? null, entityId: ctx.entityId ?? null, contactId: ctx.contactId ?? null, dealId: ctx.dealId ?? null,
    occurrenceId: ctx.occurrenceId ?? null, data,
  };
}
function contextFromStored(stored: unknown, fallback: WorkflowContext): WorkflowContext {
  if (!stored || typeof stored !== "object") return fallback;
  const s = stored as Record<string, any>;
  return {
    entityType: s.entityType ?? fallback.entityType, entityId: s.entityId ?? fallback.entityId,
    contactId: s.contactId ?? fallback.contactId, dealId: s.dealId ?? fallback.dealId,
    occurrenceId: s.occurrenceId ?? fallback.occurrenceId, data: { ...(fallback.data ?? {}), ...(s.data ?? {}) },
  };
}

/** Progress writes are fenced by the run's lease token when one is held; a lost lease writes nothing. */
async function saveRunFenced(runId: number, token: string | undefined, patch: Record<string, unknown>): Promise<boolean> {
  if (!token) { await storage.updateWorkflowRun(runId, patch as any); return true; }
  const { db } = await import("../db");
  const { workflowRuns } = await import("@shared/schema");
  const { and, eq, gt, sql } = await import("drizzle-orm");
  const rows = await db.update(workflowRuns).set(patch as any)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.leaseToken, token), gt(workflowRuns.leaseExpiresAt, sql`now()`))).returning({ id: workflowRuns.id });
  return rows.length === 1;
}
const NOT_DELIVERED_STATUSES = new Set(["failed", "unknown_outcome", "queued_no_ghl", "blocked"]);

type StepSendResult = { success: boolean; error?: string; unknown?: boolean; replay?: boolean };
const SEND_ACTIONS = new Set(["send_ghl_email", "send_ghl_sms", "send_packet", "generate_proposal", "request_review"]);
export const RUN_TERMINAL_STATUSES = ["completed", "failed", "cancelled", "blocked"];

/**
 * Per-step, per-channel send receipt. The receipt is written before the provider call; a resumed or re-claimed run
 * replays an accepted step without sending again and never re-sends over an unknown outcome.
 */
async function guardedSend(
  runId: number, stepIndex: number, channel: string,
  send: () => Promise<{ success: boolean; error?: string }>,
): Promise<StepSendResult> {
  const outcome = await runFollowupEffect(
    { effectKey: `wf:${runId}:${stepIndex}:${channel}`, ownerKind: "workflow_run", ownerId: String(runId), channel: `${channel}` },
    send,
  );
  if (outcome.state === "accepted") return { success: true, replay: outcome.replay };
  if (outcome.state === "unknown") return { success: false, unknown: true, error: outcome.detail ?? "dispatch_outcome_unknown" };
  return { success: false, error: outcome.detail };
}

const stepStatus = (r: StepSendResult) => r.unknown ? "unknown_outcome" : r.success ? "completed" : "failed";

/**
 * Honest run outcome from the step log. A run is "completed" only when no step failed, was blocked, had an unknown
 * outcome, or was only queued locally. Skipped steps stay visible in the log and are counted, never hidden.
 * `delivered` counts send steps whose receipt is accepted.
 */
export function classifyWorkflowRunOutcome(log: ReadonlyArray<{ action?: string; status?: string }>): {
  status: "completed" | "failed" | "blocked"; delivered: number; failed: number; blocked: number; skipped: number;
} {
  let delivered = 0, failed = 0, blocked = 0, skipped = 0;
  // After a controlled retry the same step appears more than once; the latest entry per step and action is its outcome.
  const lastIndex = new Map<string, number>();
  log.forEach((entry, index) => { const step = (entry as { step?: number }).step; if (typeof step === "number" && step > 0) lastIndex.set(`${step}:${entry.action}`, index); });
  for (const [index, entry] of log.entries()) {
    const step = (entry as { step?: number }).step;
    if (typeof step === "number" && step > 0 && lastIndex.get(`${step}:${entry.action}`) !== index) continue;
    if (entry.status === "failed") failed++;
    else if (entry.status === "queued_no_ghl" || entry.status === "unknown_outcome" || entry.status === "blocked") blocked++;
    else if (entry.status === "skipped" || entry.status === "unknown_action") skipped++;
    else if (entry.status === "completed" && SEND_ACTIONS.has(entry.action ?? "")) delivered++;
  }
  return { status: failed > 0 ? "failed" : blocked > 0 ? "blocked" : "completed", delivered, failed, blocked, skipped };
}

export async function executeWorkflowActions(
  workflowId: number,
  actions: any[],
  ctx: WorkflowContext,
  runId?: number,
  startStep: number = 0,
  options: { retryCompletedSteps?: ReadonlySet<number>; leaseToken?: string } = {},
): Promise<{ status: string; log: any[]; runId: number; delivered?: number; replay?: boolean }> {
  const workflow = await storage.getWorkflow(workflowId);
  if (!workflow || workflow.retiredAt || !workflow.enabled) {
    const log: any[] = [{ action: "workflow_unavailable", status: "blocked", timestamp: new Date().toISOString() }];
    // A waiting/running run whose workflow is gone is parked visibly (terminal blocked), never left due for every scan.
    if (runId) {
      const existing = await storage.getWorkflowRun(runId);
      if (existing && !RUN_TERMINAL_STATUSES.includes(existing.status || "")) {
        const merged = [...(Array.isArray(existing.log) ? existing.log as any[] : []), ...log];
        await storage.updateWorkflowRun(runId, { status: "blocked", completedAt: new Date(), log: merged });
      }
    }
    return { status: "blocked", log, runId: runId ?? 0 };
  }
  let leaseToken: string | undefined;
  if (runId) {
    const existing = await storage.getWorkflowRun(runId);
    if (!existing || existing.workflowId !== workflowId || RUN_TERMINAL_STATUSES.includes(existing.status || "")) {
      return { status: "blocked", log: [{ action: "run_unavailable", status: "blocked" }], runId };
    }
    // Resume from the inputs the run started with (contact/deal pairing, occurrence, event facts), not from the entity id alone.
    ctx = contextFromStored((existing as { inputContext?: unknown }).inputContext, ctx);
    leaseToken = options.leaseToken;
    if (!leaseToken) {
      // A caller without a claim must take the lease; a run another worker owns is not touched.
      const { randomUUID } = await import("node:crypto");
      const { pool } = await import("../db");
      const token = randomUUID();
      const taken = await pool.query(
        `UPDATE workflow_runs SET lease_token = $2, lease_expires_at = now() + interval '10 minutes'
          WHERE id = $1 AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING id`, [runId, token]);
      if (!taken.rows[0]) return { status: "blocked", log: [{ action: "run_owned_elsewhere", status: "blocked" }], runId };
      leaseToken = token;
    }
    // A run resumes only against the definition it was created for; a changed workflow cannot be resumed at a stale step.
    if (existing.inputPin && existing.inputPin !== workflowDefinitionPin(actions)) {
      const log = [...(Array.isArray(existing.log) ? existing.log as any[] : []),
        { step: startStep, action: "resume", status: "blocked", reason: "workflow_definition_changed", timestamp: new Date().toISOString() }];
      await storage.updateWorkflowRun(runId, { status: "blocked", completedAt: new Date(), log });
      return { status: "blocked", log, runId };
    }
  }
  const { contactId, dealId } = await resolveContext(ctx);
  let logEntries: any[] = [];
  const lostLease = (): { status: string; log: any[]; runId: number } =>
    ({ status: "lease_lost", log: [{ action: "lease_lost", status: "blocked" }], runId: createdRunId ?? 0 });

  let createdRunId = runId;
  if (!createdRunId) {
    logEntries = [{ step: 0, action: "started", timestamp: new Date().toISOString() }];
    const newToken = (await import("node:crypto")).randomUUID();
    // One run per (workflow, occurrence): a retried event returns the existing run instead of starting a second one.
    const occurrenceKey = ctx.occurrenceId ? `${ctx.entityType ?? "none"}:${ctx.entityId ?? 0}:${ctx.occurrenceId}` : null;
    try {
      const run = await storage.createWorkflowRun({
        workflowId,
        entityType: ctx.entityType || null,
        entityId: ctx.entityId || null,
        status: "running",
        currentStep: startStep,
        log: logEntries,
        occurrenceKey,
        inputPin: workflowDefinitionPin(actions),
        inputContext: persistableWorkflowContext(ctx),
        leaseToken: newToken,
        leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      } as any);
      createdRunId = run.id;
      leaseToken = newToken;
    } catch (createErr: any) {
      if (occurrenceKey && (createErr?.code === "23505" || createErr?.cause?.code === "23505")) {
        const { db } = await import("../db");
        const { workflowRuns } = await import("@shared/schema");
        const { and, eq } = await import("drizzle-orm");
        const [existingRun] = await db.select().from(workflowRuns)
          .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.occurrenceKey, occurrenceKey))).limit(1);
        if (existingRun) {
          const existingLog = Array.isArray(existingRun.log) ? existingRun.log as any[] : [];
          return { status: existingRun.status || "running", log: existingLog, runId: existingRun.id, delivered: classifyWorkflowRunOutcome(existingLog).delivered, replay: true };
        }
      }
      throw createErr;
    }
  } else if (options.retryCompletedSteps) {
    const existingRun = await storage.getWorkflowRun(createdRunId);
    logEntries = Array.isArray(existingRun?.log) ? [...(existingRun!.log as any[])] : [];
    logEntries.push({ step: startStep, action: "retry_started", timestamp: new Date().toISOString() });
  } else if (startStep > 0) {
    const existingRun = await storage.getWorkflowRun(createdRunId);
    logEntries = Array.isArray(existingRun?.log) ? [...(existingRun!.log as any[])] : [];
    logEntries.push({ step: startStep, action: "wait_resumed", timestamp: new Date().toISOString() });
  }

  for (let i = startStep; i < actions.length; i++) {
    const action = actions[i];
    // Controlled retry: a step that already completed (accepted send, task, update) is never repeated.
    if (options.retryCompletedSteps?.has(i + 1)) continue;
    // Fence: an expired or superseded worker stops here and writes nothing further for this run.
    if (leaseToken) {
      const { renewWorkflowRunLease } = await import("./workflow-run-lease");
      if (!(await renewWorkflowRunLease(createdRunId!, leaseToken))) return lostLease();
    }
    // A send re-checks that the workflow is still enabled and unretired at the action boundary.
    if (SEND_ACTIONS.has(action.type)) {
      const current = await storage.getWorkflow(workflowId);
      if (!current || current.retiredAt || !current.enabled) {
        logEntries.push({ step: i + 1, action: action.type, status: "blocked", reason: "workflow_unavailable", timestamp: new Date().toISOString() });
        break;
      }
    }
    try {
      if (action.type === "create_task") {
        const task = await storage.createAuthorityTask({
          title: await interpolateTemplate(action.title || "Auto-task", contactId, dealId),
          assignedTo: action.assignedTo || undefined,
          priority: action.priority || "medium",
          dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
          dealId,
          contactId,
          description: action.description ? await interpolateTemplate(action.description, contactId, dealId) : undefined,
        }, { commandKey: `wf_task:${createdRunId}:${i + 1}` });
        const assignmentStatus = task.assignedTo ? "assigned" : "unassigned_review_required";
        if (!task.assignedTo) {
          await storage.createAuditLog({
            action: "workflow_task_assignment_review_required",
            entityType: ctx.entityType || "workflow",
            entityId: ctx.entityId || createdRunId,
            details: {
              workflowId,
              workflowRunId: createdRunId,
              step: i + 1,
              taskId: task.id,
              reasonCode: "REVIEW_REQUIRED_NO_ASSIGNEE",
            },
          });
        }
        logEntries.push({ step: i + 1, action: "create_task", title: action.title, assignmentStatus, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "send_notification") {
        const notification = {
          channel: action.channel || "internal",
          title: await interpolateTemplate(action.title || "Workflow Notification", contactId, dealId),
          message: await interpolateTemplate(action.message || "", contactId, dealId),
          type: action.notificationType || "info",
          metadata: { workflowId, dealId, contactId },
        };
        // Notification and its run/step receipt commit together; a lost lease or failed write leaves neither.
        const outcome = await applyLocalWorkflowAction(createdRunId!, i + 1, leaseToken, (tx) => storage.createNotification(notification, tx).then(() => undefined));
        if (outcome === "lost_lease") return lostLease();
        logEntries.push({ step: i + 1, action: "send_notification", title: action.title, status: "completed", ...(outcome === "replay" ? { replay: true } : {}), timestamp: new Date().toISOString() });

      } else if (action.type === "create_audit_log") {
        const outcome = await applyLocalWorkflowAction(createdRunId!, i + 1, leaseToken, (tx) => storage.createAuditLog({
          action: action.logAction || "workflow_action",
          entityType: ctx.entityType || "workflow",
          entityId: ctx.entityId || createdRunId,
          details: { workflowId, step: i + 1 },
        }, tx).then(() => undefined));
        if (outcome === "lost_lease") return lostLease();
        logEntries.push({ step: i + 1, action: "create_audit_log", status: "completed", ...(outcome === "replay" ? { replay: true } : {}), timestamp: new Date().toISOString() });

      } else if (action.type === "update_deal" && dealId) {
        if (action.stage) {
          await advanceDealStage(dealId, action.stage, "workflow_update_deal");
        }
        const nonStageUpdates: any = {};
        if (action.notes) nonStageUpdates.notes = action.notes;
        if (action.offerPath) nonStageUpdates.offerPath = action.offerPath;
        if (action.owner) nonStageUpdates.owner = action.owner;
        if (action.pipeline) nonStageUpdates.pipeline = action.pipeline;
        if (action.nextFollowUp) nonStageUpdates.nextFollowUp = new Date(Date.now() + (action.nextFollowUpHours || 24) * 3600000);
        if (Object.keys(nonStageUpdates).length > 0) {
          await storage.updateDeal(dealId, nonStageUpdates);
        }
        logEntries.push({ step: i + 1, action: "update_deal", stage: action.stage, updates: nonStageUpdates, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "update_contact_tags" && contactId) {
        const contact = await storage.getContact(contactId);
        if (contact) {
          const currentTags = contact.tags || [];
          const addTags = action.addTags || [];
          const removeTags = action.removeTags || [];
          const newTags = Array.from(new Set([...currentTags, ...addTags])).filter((t: string) => !removeTags.includes(t));
          await updateContactLocalFirst(contactId, { tags: newTags });
        }
        logEntries.push({ step: i + 1, action: "update_contact_tags", status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "send_ghl_email" && contactId) {
        if (isGhlConfigured()) {
          if (action.templateId) {
            const permission = await canSendWorkflowTemplate(action.templateId, contactId);
            const result: StepSendResult = permission.allowed
              ? await guardedSend(createdRunId, i, "email", () => sendTemplatedMessage({ templateId: action.templateId, contactId, dealId }))
              : { success: false, error: permission.reason };
            logEntries.push({ step: i + 1, action: "send_ghl_email", templateId: action.templateId, status: stepStatus(result), error: result.error, timestamp: new Date().toISOString() });
          } else {
            const subject = await renderWorkflowMessage(action.subject || "Message from Liberty Bancard", contactId, dealId, "subject");
            const body = await renderWorkflowMessage(action.body || "", contactId, dealId, "html");
            const result = await guardedSend(createdRunId, i, "email", () => sendWorkflowEmail({ contactId, dealId, subject, body }));
            logEntries.push({ step: i + 1, action: "send_ghl_email", status: stepStatus(result), error: result.error, timestamp: new Date().toISOString() });
          }
        } else {
          await storage.createEmailLog({
            contactId,
            direction: "outbound",
            subject: action.subject || "Message from Liberty Bancard",
            body: action.body || "",
            status: "queued",
            metadata: { source: "workflow", workflowId },
          });
          logEntries.push({ step: i + 1, action: "send_ghl_email", status: "queued_no_ghl", reason: "ghl_not_configured_nothing_delivered", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "send_ghl_sms" && contactId) {
        if (isGhlConfigured()) {
          if (action.templateId) {
            const permission = await canSendWorkflowTemplate(action.templateId, contactId);
            const result: StepSendResult = permission.allowed
              ? await guardedSend(createdRunId, i, "sms", () => sendTemplatedMessage({ templateId: action.templateId, contactId, dealId, boundPhone: permission.boundPhone, purpose: "workflow_template" }))
              : { success: false, error: permission.reason };
            logEntries.push({ step: i + 1, action: "send_ghl_sms", templateId: action.templateId, status: stepStatus(result), error: result.error, timestamp: new Date().toISOString() });
          } else {
            const body = await renderWorkflowMessage(action.body || "", contactId, dealId, "text");
            // Decided inside the receipt so a replayed accepted step is never re-judged, and a refusal stays re-claimable.
            const result = await guardedSend(createdRunId, i, "sms", async () => {
              const permission = await canSendWorkflowSms(contactId, "workflow_sms");
              if (!permission.allowed) return { success: false, error: permission.reason };
              return sendWorkflowSms({ contactId, dealId, body, boundPhone: permission.boundPhone });
            });
            logEntries.push({ step: i + 1, action: "send_ghl_sms", status: stepStatus(result), error: result.error, timestamp: new Date().toISOString() });
          }
        } else {
          logEntries.push({ step: i + 1, action: "send_ghl_sms", status: "queued_no_ghl", reason: "ghl_not_configured_nothing_delivered", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "send_packet" && contactId) {
        const packets = await storage.getCollateralPackets();
        const deal = dealId ? await storage.getDeal(dealId) : undefined;
        const matchedPacket = resolveCollateralPacket(packets, { packetId: action.packetId, deal });
        if (matchedPacket && isGhlConfigured()) {
          const packetBody = await renderWorkflowMessage(`<p>Hi {{contact.firstName}},</p><p>Here is your personalized information packet.</p><p>Best,<br/>Liberty Bancard</p><p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`, contactId, dealId, "html");
          const result = await guardedSend(createdRunId, i, "email", () => sendWorkflowEmail({
            contactId, dealId,
            subject: `Your Custom Pricing Breakdown - ${matchedPacket.name}`,
            body: packetBody,
          }));
          logEntries.push({ step: i + 1, action: "send_packet", packetName: matchedPacket.name, status: stepStatus(result), timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "send_packet", status: "skipped", reason: !matchedPacket ? "No matching packet" : "GHL not configured", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "generate_proposal" && contactId && dealId) {
        const deal = await storage.getDeal(dealId);
        const contact = await storage.getContact(contactId);
        if (deal && contact && isGhlConfigured()) {
          const proposalBody = await renderWorkflowMessage(
            `<h2>Statement Analysis & Proposal</h2>
<p>Dear {{contact.firstName}},</p>
<p>After reviewing your processing statement, here is what we found:</p>
<ul>
  <li><strong>Current Effective Rate:</strong> ${escapeHtml(deal.effectiveRate || "Pending Review")}</li>
  <li><strong>Monthly Volume:</strong> ${escapeHtml(deal.totalVolume || "Pending Review")}</li>
  <li><strong>Recommended Path:</strong> ${escapeHtml(deal.recommendedPath || deal.offerPath || "Custom Pricing")}</li>
</ul>
<p><strong>Next Step:</strong> <a href="{{calendarLink}}">Book a call</a></p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
            contactId, dealId, "html"
          );
          // The proposal email is one durable touch (run, step, channel). The deal moves to "Proposal Sent" only when
          // the receipt says the proposal was accepted; a failed or unknown send never advances the stage.
          const result = await guardedSend(createdRunId, i, "email", () => sendWorkflowEmail({
            contactId, dealId,
            subject: `Your Processing Analysis is Ready - ${contact.companyName || contact.firstName}`,
            body: proposalBody,
          }));
          if (result.success && deal.stage === "Review In Progress") {
            await advanceDealStage(dealId, "Proposal Sent", "workflow_generate_proposal");
          }
          logEntries.push({ step: i + 1, action: "generate_proposal", status: stepStatus(result), ...(result.error ? { error: result.error } : {}), timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "generate_proposal", status: "skipped", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "enroll_sequence") {
        if (contactId) {
          let resolvedSequenceId: number | undefined = action.sequenceId;
          if (!resolvedSequenceId && action.sequenceName) {
            const sequences = await storage.getFollowUpSequences();
            const match = sequences.find((s: any) =>
              s.name?.toLowerCase() === (action.sequenceName as string).toLowerCase()
            );
            resolvedSequenceId = match?.id;
          }
          if (resolvedSequenceId) {
            const sequence = await storage.getFollowUpSequence(resolvedSequenceId);
            const decision = decideCr06PromotionalLifecycle({
              boundary: "workflow_enrollment",
              purpose: sequence ? classifyCr06SequencePurpose(sequence) : "promotional",
            });
            if (!sequence || !decision.allowed) {
              logEntries.push({ step: i + 1, action: "enroll_sequence", sequenceId: resolvedSequenceId, status: "skipped", reason: !sequence ? "Sequence not found" : decision.reasonCode, timestamp: new Date().toISOString() });
            } else {
              await storage.createSequenceEnrollment({
                sequenceId: resolvedSequenceId,
                contactId,
                dealId,
                status: "active",
                nextActionAt: new Date(),
                currentStep: 0,
              });
              logEntries.push({ step: i + 1, action: "enroll_sequence", sequenceId: resolvedSequenceId, sequenceName: action.sequenceName, status: "completed", timestamp: new Date().toISOString() });
            }
          } else {
            logEntries.push({ step: i + 1, action: "enroll_sequence", status: "skipped", reason: "Sequence not found or not specified", timestamp: new Date().toISOString() });
          }
        } else {
          logEntries.push({ step: i + 1, action: "enroll_sequence", status: "skipped", reason: "Missing contactId", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "vas_upsell_enrollment" && contactId) {
        // Day-30 VAS cross-sell propensity engine.
        // Maps merchant vertical → targeted VAS sequences and creates enrollments
        // subject to the standard contactability/suppression gates.
        try {
          const { triggerDay30VasUpsell } = await import("./vas-upsell");
          const vasResult = await triggerDay30VasUpsell(contactId, dealId);
          logEntries.push({
            step: i + 1,
            action: "vas_upsell_enrollment",
            skipped: vasResult.skipped,
            skipReason: vasResult.skipReason,
            vertical: vasResult.vertical,
            sequencesAttempted: vasResult.sequencesAttempted,
            enrolled: vasResult.enrolled,
            alreadyEnrolled: vasResult.alreadyEnrolled,
            blocked: vasResult.blocked,
            enrollmentIds: vasResult.enrollmentIds,
            status: vasResult.skipped ? "skipped" : "completed",
            timestamp: new Date().toISOString(),
          });
        } catch (vasErr: any) {
          console.error("[Workflow] vas_upsell_enrollment failed:", vasErr.message);
          logEntries.push({ step: i + 1, action: "vas_upsell_enrollment", status: "failed", error: vasErr.message, timestamp: new Date().toISOString() });
        }

      } else if (action.type === "pause_enrollments" && contactId) {
        const paused = await storage.pauseAllActiveEnrollments(contactId);
        logEntries.push({ step: i + 1, action: "pause_enrollments", paused, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "request_review" && contactId) {
        if (isGhlConfigured()) {
          const body = await renderWorkflowMessage(
            `<p>Hi {{contact.firstName}},</p><p>We hope your payment processing has been running smoothly since switching to Liberty Bancard!</p><p>Would you mind leaving us a quick review?</p><p>Thank you!</p><p>Best,<br/>Liberty Bancard Team</p>`,
            contactId, dealId, "html"
          );
          const result = await guardedSend(createdRunId, i, "email", () => sendWorkflowEmail({
            contactId, dealId,
            subject: "How's your experience with Liberty Bancard?",
            body,
          }));
          logEntries.push({ step: i + 1, action: "request_review", status: stepStatus(result), ...(result.error ? { error: result.error } : {}), timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "request_review", status: "queued_no_ghl", reason: "ghl_not_configured_nothing_delivered", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "create_onboarding_checklist" && dealId) {
        const existingSteps = await storage.getOnboardingStepsByDeal(dealId);
        if (existingSteps.length > 0) {
          logEntries.push({ step: i + 1, action: "create_onboarding_checklist", status: "skipped", reason: "Steps already exist", timestamp: new Date().toISOString() });
        } else {
          const onboardingSteps = [
            { stepName: "Welcome & Kickoff", stepOrder: 1, status: "completed" as const },
            { stepName: "Application Submitted", stepOrder: 2, status: "pending" as const },
            { stepName: "Documents Collected", stepOrder: 3, status: "pending" as const },
            { stepName: "Underwriting Review", stepOrder: 4, status: "pending" as const },
            { stepName: "Approved", stepOrder: 5, status: "pending" as const },
            { stepName: "Terminal Ordered", stepOrder: 6, status: "pending" as const },
            { stepName: "Go-Live Scheduled", stepOrder: 7, status: "pending" as const },
            { stepName: "Live & Processing", stepOrder: 8, status: "pending" as const },
          ];
          for (const step of onboardingSteps) {
            await storage.createOnboardingStep({
              dealId,
              stepName: step.stepName,
              stepOrder: step.stepOrder,
              status: step.status,
              completedAt: step.status === "completed" ? new Date() : undefined,
            });
          }
          logEntries.push({ step: i + 1, action: "create_onboarding_checklist", status: "completed", stepsCreated: onboardingSteps.length, timestamp: new Date().toISOString() });
        }

      } else if (action.type === "wait") {
        const waitMinutes = action.minutes || (action.hours || 1) * 60;
        logEntries.push({ step: i + 1, action: "wait", minutes: waitMinutes, status: "scheduled", timestamp: new Date().toISOString() });
        const saved = await saveRunFenced(createdRunId, leaseToken, {
          status: "waiting",
          currentStep: i + 1,
          nextRunAt: new Date(Date.now() + waitMinutes * 60 * 1000),
          log: logEntries,
          entityType: ctx.entityType || null,
          entityId: ctx.entityId || null,
          inputContext: persistableWorkflowContext(ctx),
          leaseToken: null, leaseExpiresAt: null,
        });
        if (!saved) return lostLease();
        return { status: "waiting", log: logEntries, runId: createdRunId };
      } else {
        logEntries.push({ step: i + 1, action: action.type, status: "unknown_action", timestamp: new Date().toISOString() });
      }
    } catch (stepErr: any) {
      logEntries.push({ step: i + 1, action: action.type, status: "failed", error: stepErr.message, timestamp: new Date().toISOString() });
    }
    // A required send that was refused, queued locally or left unknown stops dependent progress (later steps, a wait,
    // a stage move). The hold stays visible in the log; an action marked optional does not stop the run.
    const lastEntry = logEntries[logEntries.length - 1];
    if (SEND_ACTIONS.has(action.type) && lastEntry && NOT_DELIVERED_STATUSES.has(lastEntry.status) && !action.optional && i < actions.length - 1) {
      logEntries.push({ step: i + 1, action: "halted", status: "held", reason: `required_step_not_delivered:${lastEntry.status}`, timestamp: new Date().toISOString() });
      break;
    }
  }

  const outcome = classifyWorkflowRunOutcome(logEntries);
  const finalSaved = await saveRunFenced(createdRunId, leaseToken, {
    status: outcome.status,
    completedAt: new Date(),
    currentStep: actions.length,
    log: logEntries,
    leaseToken: null, leaseExpiresAt: null,
  });
  if (!finalSaved) return lostLease();

  return { status: outcome.status, log: logEntries, runId: createdRunId, delivered: outcome.delivered };
}

/**
 * Controlled retry of a failed or blocked run, for callers that own a retry cadence (e.g. the application reminder scan).
 * Only definitely-undelivered work is retried: completed steps (including accepted sends) are skipped and their receipts
 * replay; a refused send is re-claimable. An unknown outcome, a changed workflow definition or a missing/disabled
 * workflow is NOT retried: the run stays parked for review.
 */
export async function retryFailedWorkflowRun(runId: number): Promise<
  { state: "retried"; status: string; delivered: number } | { state: "needs_review" | "not_retryable"; reason: string }
> {
  const run = await storage.getWorkflowRun(runId);
  if (!run || !["failed", "blocked"].includes(run.status || "")) return { state: "not_retryable", reason: "run_not_failed_or_blocked" };
  const log = (Array.isArray(run.log) ? run.log : []) as Array<{ step?: number; action?: string; status?: string; reason?: string }>;
  const latest = new Map<string, { status?: string }>();
  for (const e of log) if (typeof e.step === "number" && e.step > 0) latest.set(`${e.step}:${e.action}`, e);
  if ([...latest.values()].some(e => e.status === "unknown_outcome")) return { state: "needs_review", reason: "unknown_outcome_requires_review" };
  if (log.some(e => e.reason === "workflow_definition_changed")) return { state: "needs_review", reason: "workflow_definition_changed" };
  // workflow_runs.workflow_id is nullable (a deleted/unlinked definition): park for review before any id-required call.
  const workflowId = run.workflowId;
  if (workflowId === null || workflowId === undefined) return { state: "needs_review", reason: "workflow_unavailable" };
  const workflow = await storage.getWorkflow(workflowId);
  if (!workflow || workflow.retiredAt || !workflow.enabled) return { state: "needs_review", reason: "workflow_unavailable" };
  const actions = (workflow.actions as any[]) || [];
  if (run.inputPin && run.inputPin !== workflowDefinitionPin(actions)) return { state: "needs_review", reason: "workflow_definition_changed" };
  const completed = new Set<number>();
  for (const [key, e] of latest) if (e.status === "completed" || e.status === "scheduled") completed.add(Number(key.split(":")[0]));
  const { pool } = await import("../db");
  const retryToken = (await import("node:crypto")).randomUUID();
  const reopened = await pool.query(
    `UPDATE workflow_runs SET status = 'running', completed_at = NULL, lease_token = $2, lease_expires_at = now() + interval '10 minutes'
      WHERE id = $1 AND status IN ('failed','blocked') AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING id`, [runId, retryToken]);
  if (!reopened.rows[0]) return { state: "not_retryable", reason: "another_worker_reopened_run" };
  const result = await executeWorkflowActions(workflowId, actions,
    { entityType: run.entityType || undefined, entityId: run.entityId || undefined } as WorkflowContext, runId, 0, { retryCompletedSteps: completed, leaseToken: retryToken });
  return { state: "retried", status: result.status, delivered: result.delivered ?? 0 };
}

export async function triggerWorkflowsByEvent(
  event: string,
  ctx: WorkflowContext,
  triggerConfig?: Record<string, any>
): Promise<Array<{ workflowId: number; workflowName: string; runId: number; status: string; delivered?: number; replay?: boolean }>> {
  const results: Array<{ workflowId: number; workflowName: string; runId: number; status: string; delivered?: number; replay?: boolean }> = [];

  try {
    const matchingWorkflows = await storage.getWorkflowsByTrigger(event);
    const activeWorkflows = matchingWorkflows.filter(w => w.enabled && !w.retiredAt);

    const eventClassification = ctx.data?.classification?.intent as string | undefined;

    for (const wf of activeWorkflows) {
      if (triggerConfig && wf.triggerConfig) {
        const wfConfig = wf.triggerConfig as Record<string, any>;
        let configMatch = true;
        for (const [key, value] of Object.entries(triggerConfig)) {
          if (wfConfig[key] !== undefined && wfConfig[key] !== value) {
            configMatch = false;
            break;
          }
        }
        if (!configMatch) continue;
      }

      if (wf.triggerConditions) {
        const conditions = wf.triggerConditions as Record<string, any>;
        if (conditions.classification) {
          if (!eventClassification || eventClassification !== conditions.classification) {
            continue;
          }
        }
      }

      const actions = (wf.actions as any[]) || [];
      if (actions.length === 0) continue;

      try {
        const result = await executeWorkflowActions(wf.id, actions, ctx);
        results.push({
          workflowId: wf.id,
          workflowName: wf.name,
          runId: result.runId,
          status: result.status,
          delivered: result.delivered,
          replay: result.replay,
        });

        await storage.createAuditLog({
          action: "workflow_auto_triggered",
          entityType: ctx.entityType || "system",
          entityId: ctx.entityId || result.runId,
          details: { event, workflowName: wf.name, status: result.status, actionsCount: actions.length, classification: eventClassification },
        });

        console.log(`[Workflow] Auto-triggered "${wf.name}" on ${event}${eventClassification ? ` [${eventClassification}]` : ""} - ${result.status} (${actions.length} actions)`);
      } catch (execErr: any) {
        console.error(`[Workflow] Failed to execute "${wf.name}":`, execErr.message);
        results.push({
          workflowId: wf.id,
          workflowName: wf.name,
          runId: 0,
          status: "error",
        });
      }
    }

    if (event === "inbound_message" && eventClassification === "unsubscribe" && ctx.entityId) {
      const contactId = ctx.entityType === "contact" ? ctx.entityId : undefined;
      if (contactId) {
        try {
          const occurrenceId = String(
            ctx.occurrenceId ?? ctx.data?.messageId ?? ctx.data?.eventId ?? triggerConfig?.messageId ??
            triggerConfig?.eventId ?? crypto.randomUUID(),
          );
          const inboundChannel = ctx.data?.channel;
          const withdrawalChannels = inboundChannel === "sms"
            ? ["sms", "automated_phone"] as const
            : inboundChannel === "email"
              ? ["email"] as const
              : [] as const;
          if (withdrawalChannels.length > 0) {
            await Promise.all(withdrawalChannels.map((channel) => applyConsentCommand({
              subject: { type: "contact", id: contactId },
              kind: "opt_out",
              channel,
              purpose: "outreach",
              eventNamespace: "workflow_unsubscribe",
              eventKey: `${ctx.entityId}:${event}:unsubscribe:${occurrenceId}:${channel}`,
              source: "workflow_executor",
              evidence: { event, classification: eventClassification, channel, occurrenceId },
              details: { event, classification: eventClassification, channel, occurrenceId },
            })));
          } else {
            await applyConsentCommand({
              subject: { type: "contact", id: contactId },
              kind: "global_dnc",
              purpose: "outreach",
              eventNamespace: "workflow_unsubscribe",
              eventKey: `${ctx.entityId}:${event}:unsubscribe:${occurrenceId}:global`,
              source: "workflow_executor",
              evidence: { event, classification: eventClassification, occurrenceId },
              details: { event, classification: eventClassification, occurrenceId },
            });
            await storage.pauseAllActiveEnrollments(contactId);
          }

          const contact = await storage.getContact(contactId);
          if (!inboundChannel && contact?.ghlContactId) {
            const { enrollInGhlWorkflow } = await import("./ghl-workflows");
            enrollInGhlWorkflow({ workflowKey: "unsubscribe", ghlContactId: contact.ghlContactId }).catch(
              (err: any) => console.warn("[Workflow] GHL unsubscribe enrollment failed (non-blocking):", err?.message)
            );
          }

          console.log(`[Workflow] Unsubscribe compliance applied for contact ${contactId}: consent revoked, enrollments paused`);
        } catch (unsubErr: any) {
          console.error("[Workflow] Unsubscribe compliance steps failed:", unsubErr.message);
        }
      }
    }
  } catch (err) {
    console.error("[Workflow] triggerWorkflowsByEvent error:", err);
  }

  return results;
}
