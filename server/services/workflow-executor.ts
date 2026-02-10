import { storage } from "../storage";
import { sendGhlEmail, sendGhlSms, sendTemplatedMessage, isGhlConfigured } from "./ghl";

interface WorkflowContext {
  entityType?: string;
  entityId?: number;
  contactId?: number;
  dealId?: number;
  data?: Record<string, any>;
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

  result = result.replace(/\{\{calendarLink\}\}/g, "https://libertybancard.com/book");
  return result;
}

export async function executeWorkflowActions(
  workflowId: number,
  actions: any[],
  ctx: WorkflowContext,
  runId?: number,
  startStep: number = 0
): Promise<{ status: string; log: any[]; runId: number }> {
  const { contactId, dealId } = await resolveContext(ctx);
  const logEntries: any[] = startStep === 0
    ? [{ step: 0, action: "started", timestamp: new Date().toISOString() }]
    : [];

  let createdRunId = runId;
  if (!createdRunId) {
    const run = await storage.createWorkflowRun({
      workflowId,
      entityType: ctx.entityType || null,
      entityId: ctx.entityId || null,
      status: "running",
      currentStep: startStep,
      log: logEntries,
    });
    createdRunId = run.id;
  }

  for (let i = startStep; i < actions.length; i++) {
    const action = actions[i];
    try {
      if (action.type === "create_task") {
        await storage.createTask({
          title: await interpolateTemplate(action.title || "Auto-task", contactId, dealId),
          assignedTo: action.assignedTo || "Scott Stevenson",
          priority: action.priority || "medium",
          dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
          dealId,
          contactId,
          description: action.description ? await interpolateTemplate(action.description, contactId, dealId) : undefined,
        });
        logEntries.push({ step: i + 1, action: "create_task", title: action.title, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "send_notification") {
        await storage.createNotification({
          channel: action.channel || "internal",
          title: await interpolateTemplate(action.title || "Workflow Notification", contactId, dealId),
          message: await interpolateTemplate(action.message || "", contactId, dealId),
          type: action.notificationType || "info",
          metadata: { workflowId, dealId, contactId },
        });
        logEntries.push({ step: i + 1, action: "send_notification", title: action.title, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "create_audit_log") {
        await storage.createAuditLog({
          action: action.logAction || "workflow_action",
          entityType: ctx.entityType || "workflow",
          entityId: ctx.entityId || createdRunId,
          details: { workflowId, step: i + 1 },
        });
        logEntries.push({ step: i + 1, action: "create_audit_log", status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "update_deal" && dealId) {
        const updates: any = {};
        if (action.stage) updates.stage = action.stage;
        if (action.notes) updates.notes = action.notes;
        if (action.offerPath) updates.offerPath = action.offerPath;
        if (action.owner) updates.owner = action.owner;
        if (action.nextFollowUp) updates.nextFollowUp = new Date(Date.now() + (action.nextFollowUpHours || 24) * 3600000);
        await storage.updateDeal(dealId, updates);
        logEntries.push({ step: i + 1, action: "update_deal", updates, status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "update_contact_tags" && contactId) {
        const contact = await storage.getContact(contactId);
        if (contact) {
          const currentTags = contact.tags || [];
          const addTags = action.addTags || [];
          const removeTags = action.removeTags || [];
          const newTags = Array.from(new Set([...currentTags, ...addTags])).filter((t: string) => !removeTags.includes(t));
          await storage.updateContact(contactId, { tags: newTags });
        }
        logEntries.push({ step: i + 1, action: "update_contact_tags", status: "completed", timestamp: new Date().toISOString() });

      } else if (action.type === "send_ghl_email" && contactId) {
        if (isGhlConfigured()) {
          const subject = await interpolateTemplate(action.subject || "Liberty Bancard", contactId, dealId);
          const body = await interpolateTemplate(action.body || "", contactId, dealId);
          if (action.templateId) {
            const result = await sendTemplatedMessage({ templateId: action.templateId, contactId, dealId });
            logEntries.push({ step: i + 1, action: "send_ghl_email", templateId: action.templateId, status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
          } else {
            const result = await sendGhlEmail({ contactId, dealId, subject, body });
            logEntries.push({ step: i + 1, action: "send_ghl_email", status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
          }
        } else {
          await storage.createEmailLog({
            contactId,
            direction: "outbound",
            subject: action.subject || "Liberty Bancard",
            body: action.body || "",
            status: "queued",
            metadata: { source: "workflow", workflowId },
          });
          logEntries.push({ step: i + 1, action: "send_ghl_email", status: "queued_no_ghl", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "send_ghl_sms" && contactId) {
        if (isGhlConfigured()) {
          const body = await interpolateTemplate(action.body || "", contactId, dealId);
          if (action.templateId) {
            const result = await sendTemplatedMessage({ templateId: action.templateId, contactId, dealId });
            logEntries.push({ step: i + 1, action: "send_ghl_sms", templateId: action.templateId, status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
          } else {
            const result = await sendGhlSms({ contactId, dealId, body });
            logEntries.push({ step: i + 1, action: "send_ghl_sms", status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
          }
        } else {
          logEntries.push({ step: i + 1, action: "send_ghl_sms", status: "queued_no_ghl", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "send_packet" && contactId) {
        const packets = await storage.getCollateralPackets();
        let matchedPacket = packets.find((p: any) => p.id === action.packetId);
        if (!matchedPacket && dealId) {
          const deal = await storage.getDeal(dealId);
          matchedPacket = packets.find((p: any) => p.offerPath === deal?.offerPath && p.isActive);
        }
        if (matchedPacket && isGhlConfigured()) {
          const result = await sendGhlEmail({
            contactId, dealId,
            subject: `Your Custom Pricing Breakdown - ${matchedPacket.name}`,
            body: `<p>Hi {{contact.firstName}},</p><p>Here is your personalized information packet.</p><p>Best,<br/>Liberty Bancard</p><p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
          });
          logEntries.push({ step: i + 1, action: "send_packet", packetName: matchedPacket.name, status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "send_packet", status: "skipped", reason: !matchedPacket ? "No matching packet" : "GHL not configured", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "generate_proposal" && contactId && dealId) {
        const deal = await storage.getDeal(dealId);
        const contact = await storage.getContact(contactId);
        if (deal && contact && isGhlConfigured()) {
          const proposalBody = await interpolateTemplate(
            `<h2>Statement Analysis & Proposal</h2>
<p>Dear {{contact.firstName}},</p>
<p>After reviewing your processing statement, here is what we found:</p>
<ul>
  <li><strong>Current Effective Rate:</strong> ${deal.effectiveRate || "Pending Review"}</li>
  <li><strong>Monthly Volume:</strong> ${deal.totalVolume || "Pending Review"}</li>
  <li><strong>Recommended Path:</strong> ${deal.recommendedPath || deal.offerPath || "Custom Pricing"}</li>
</ul>
<p><strong>Next Step:</strong> <a href="{{calendarLink}}">Book a 10-minute call</a></p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
            contactId, dealId
          );
          const result = await sendGhlEmail({
            contactId, dealId,
            subject: `Your Processing Analysis is Ready - ${contact.companyName || contact.firstName}`,
            body: proposalBody,
          });
          if (deal.stage === "Review In Progress" || deal.stage === "Under Review") {
            await storage.updateDeal(dealId, { stage: "Proposal Sent" });
          }
          logEntries.push({ step: i + 1, action: "generate_proposal", status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "generate_proposal", status: "skipped", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "enroll_sequence") {
        if (action.sequenceId && contactId) {
          await storage.createSequenceEnrollment({
            sequenceId: action.sequenceId,
            contactId,
            dealId,
            status: "active",
            nextActionAt: new Date(),
            currentStep: 0,
          });
          logEntries.push({ step: i + 1, action: "enroll_sequence", sequenceId: action.sequenceId, status: "completed", timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "enroll_sequence", status: "skipped", reason: "Missing sequenceId or contactId", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "request_review" && contactId) {
        if (isGhlConfigured()) {
          const body = await interpolateTemplate(
            `<p>Hi {{contact.firstName}},</p><p>We hope your payment processing has been running smoothly since switching to Liberty Bancard!</p><p>Would you mind leaving us a quick review?</p><p>Thank you!</p><p>Best,<br/>Liberty Bancard Team</p>`,
            contactId, dealId
          );
          const result = await sendGhlEmail({
            contactId, dealId,
            subject: "How's your experience with Liberty Bancard?",
            body,
          });
          logEntries.push({ step: i + 1, action: "request_review", status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
        } else {
          logEntries.push({ step: i + 1, action: "request_review", status: "queued_no_ghl", timestamp: new Date().toISOString() });
        }

      } else if (action.type === "wait") {
        const waitMinutes = action.minutes || (action.hours || 1) * 60;
        logEntries.push({ step: i + 1, action: "wait", minutes: waitMinutes, status: "scheduled", timestamp: new Date().toISOString() });
        await storage.updateWorkflowRun(createdRunId, {
          status: "waiting",
          currentStep: i + 1,
          nextRunAt: new Date(Date.now() + waitMinutes * 60 * 1000),
          log: logEntries,
          entityType: ctx.entityType || null,
          entityId: ctx.entityId || null,
        });
        return { status: "waiting", log: logEntries, runId: createdRunId };
      } else {
        logEntries.push({ step: i + 1, action: action.type, status: "unknown_action", timestamp: new Date().toISOString() });
      }
    } catch (stepErr: any) {
      logEntries.push({ step: i + 1, action: action.type, status: "failed", error: stepErr.message, timestamp: new Date().toISOString() });
    }
  }

  await storage.updateWorkflowRun(createdRunId, {
    status: "completed",
    completedAt: new Date(),
    currentStep: actions.length,
    log: logEntries,
  });

  return { status: "completed", log: logEntries, runId: createdRunId };
}

export async function triggerWorkflowsByEvent(
  event: string,
  ctx: WorkflowContext,
  triggerConfig?: Record<string, any>
): Promise<Array<{ workflowId: number; workflowName: string; runId: number; status: string }>> {
  const results: Array<{ workflowId: number; workflowName: string; runId: number; status: string }> = [];

  try {
    const matchingWorkflows = await storage.getWorkflowsByTrigger(event);
    const activeWorkflows = matchingWorkflows.filter(w => w.enabled);

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

      const actions = (wf.actions as any[]) || [];
      if (actions.length === 0) continue;

      try {
        const result = await executeWorkflowActions(wf.id, actions, ctx);
        results.push({
          workflowId: wf.id,
          workflowName: wf.name,
          runId: result.runId,
          status: result.status,
        });

        await storage.createAuditLog({
          action: "workflow_auto_triggered",
          entityType: ctx.entityType || "system",
          entityId: ctx.entityId || result.runId,
          details: { event, workflowName: wf.name, status: result.status, actionsCount: actions.length },
        });

        console.log(`[Workflow] Auto-triggered "${wf.name}" on ${event} - ${result.status} (${actions.length} actions)`);
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
  } catch (err) {
    console.error("[Workflow] triggerWorkflowsByEvent error:", err);
  }

  return results;
}
