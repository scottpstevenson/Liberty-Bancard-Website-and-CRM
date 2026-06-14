/**
 * Statement Upload Chain — Full 11-Step Conversion Pipeline
 *
 * Each step is wrapped in an individual try/catch.
 * Failed steps are logged to audit_log but NEVER abort the chain —
 * the merchant's upload is always preserved and they always get a success response.
 */

import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { syncContactToGhl, syncDealToGhl } from "./ghl-sync";
import { syncStatementUploadToGhl } from "./ghl-form-sync";
import { isGhlConfigured } from "./ghl";
import { isSmtpConfigured, sendSmtpEmail } from "./smtp-email";
import { autoGenerateProposal } from "./proposal-engine";
import { generateDealBlueprint } from "./deal-blueprint";
import { autoEnrollFromTrigger } from "./sequence-worker";
import { ACTIVE_DEAL_STAGES, statementProposals } from "@shared/schema";
import { db } from "../db";

export interface StatementUploadInput {
  contactId: number;
  dealId?: number | null;
  fileBuffer?: Buffer;
  fileName?: string;
  source: "website" | "merchant_portal" | "dashboard" | "portal-rate-review";
  /** If provided, used to look up existing deal stages and update accordingly */
  businessName?: string;
  consentEmail?: boolean;
}

export interface ChainStepResult {
  step: number;
  name: string;
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface StatementUploadChainResult {
  contactId: number;
  dealId: number;
  documentId?: number;
  steps: ChainStepResult[];
  failedSteps: string[];
  allSuccess: boolean;
}

// Active stages that should be advanced to "Statement Received" on upload
const STAGES_TO_ADVANCE = ["New Lead", "Review In Progress"];

async function logStepFailure(
  dealId: number | null,
  step: number,
  stepName: string,
  error: string,
) {
  try {
    await storage.createAuditLog({
      action: "statement_chain_step_failed",
      entityType: "deal",
      entityId: dealId || 0,
      actorType: "system",
      details: { step, stepName, error, timestamp: new Date().toISOString() },
    });
  } catch (logErr) {
    console.error("[StatementChain] Failed to write audit log:", logErr);
  }
}

async function logChainSuccess(
  dealId: number,
  contactId: number,
  failedSteps: string[],
) {
  try {
    await storage.createAuditLog({
      action: "statement_chain_completed",
      entityType: "deal",
      entityId: dealId,
      actorType: "system",
      details: {
        contactId,
        failedSteps,
        allSuccess: failedSteps.length === 0,
        timestamp: new Date().toISOString(),
      },
    });
  } catch { /* non-critical */ }
}

function makeStep(
  step: number,
  name: string,
  success: boolean,
  error?: string,
  data?: Record<string, unknown>,
): ChainStepResult {
  if (!success) {
    console.error(`[StatementChain] Step ${step} (${name}) FAILED:`, error);
  } else {
    console.log(`[StatementChain] Step ${step} (${name}) OK${data ? ` — ${JSON.stringify(data)}` : ""}`);
  }
  return { step, name, success, error, data };
}

export async function runStatementUploadChain(
  input: StatementUploadInput,
): Promise<StatementUploadChainResult> {
  const steps: ChainStepResult[] = [];
  let dealId: number = input.dealId ?? 0;
  let documentId: number | undefined;

  console.log(`[StatementChain] Starting upload chain for contact #${input.contactId}, source=${input.source}`);

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 1 — Contact loaded (already created/resolved by caller; verify exists)
  // ────────────────────────────────────────────────────────────────────────────
  try {
    const contact = await storage.getContact(input.contactId);
    if (!contact) throw new Error("Contact not found");
    steps.push(makeStep(1, "Contact verified", true, undefined, { contactId: contact.id }));
  } catch (err: any) {
    steps.push(makeStep(1, "Contact verified", false, err.message));
    await logStepFailure(dealId || null, 1, "Contact verified", err.message);
    // Contact is critical — cannot proceed
    return {
      contactId: input.contactId,
      dealId: dealId,
      steps,
      failedSteps: steps.filter(s => !s.success).map(s => s.name),
      allSuccess: false,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 2 — Company created or linked
  // ────────────────────────────────────────────────────────────────────────────
  let companyId: number | null = null;
  try {
    const contact = await storage.getContact(input.contactId);
    const companyName = input.businessName || contact?.companyName || "";
    if (companyName) {
      const normalizedName = companyName.trim().toLowerCase();
      const allCompanies = await storage.getCompanies?.() ?? [];
      const existing = allCompanies.find(
        (c: any) => (c.legalName || "").toLowerCase() === normalizedName
          || (c.dba || "").toLowerCase() === normalizedName,
      );
      if (existing) {
        companyId = existing.id;
        steps.push(makeStep(2, "Company linked", true, undefined, { companyId: existing.id, name: companyName }));
      } else if (companyName.length > 1) {
        const newCompany = await storage.createCompany({ legalName: companyName });
        companyId = newCompany.id;
        steps.push(makeStep(2, "Company created", true, undefined, { companyId: newCompany.id, name: companyName }));
      } else {
        steps.push(makeStep(2, "Company skipped", true, undefined, { reason: "No company name" }));
      }
    } else {
      steps.push(makeStep(2, "Company skipped", true, undefined, { reason: "No company name" }));
    }
  } catch (err: any) {
    steps.push(makeStep(2, "Company linked", false, err.message));
    await logStepFailure(dealId || null, 2, "Company linked", err.message);
    // Non-critical — continue
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 3 — Deal created or advanced to "Statement Received"
  // ────────────────────────────────────────────────────────────────────────────
  try {
    if (input.dealId) {
      // Existing deal — advance stage if needed
      const existingDeal = await storage.getDeal(input.dealId);
      if (existingDeal) {
        dealId = existingDeal.id;
        if (STAGES_TO_ADVANCE.includes(existingDeal.stage)) {
          await storage.updateDeal(dealId, {
            stage: "Statement Received",
            statementReceived: true,
            ...(companyId ? { companyId } : {}),
          });
          steps.push(makeStep(3, "Deal stage advanced", true, undefined, {
            dealId, from: existingDeal.stage, to: "Statement Received",
          }));
        } else {
          await storage.updateDeal(dealId, {
            statementReceived: true,
            ...(companyId ? { companyId } : {}),
          });
          steps.push(makeStep(3, "Deal updated", true, undefined, {
            dealId, stage: existingDeal.stage, note: "Stage kept (already past Statement Received)",
          }));
        }
      } else {
        throw new Error(`Deal #${input.dealId} not found`);
      }
    } else {
      // Check for existing open deal for this contact
      const existingDeals = await storage.getDealsByContact(input.contactId);
      const openDeal = existingDeals.find(d =>
        (ACTIVE_DEAL_STAGES as readonly string[]).includes(d.stage) && !d.archivedAt,
      );
      if (openDeal) {
        dealId = openDeal.id;
        const updates: any = { statementReceived: true };
        if (STAGES_TO_ADVANCE.includes(openDeal.stage)) {
          updates.stage = "Statement Received";
        }
        if (companyId) updates.companyId = companyId;
        await storage.updateDeal(dealId, updates);
        steps.push(makeStep(3, "Existing deal updated", true, undefined, {
          dealId, stage: openDeal.stage, advanced: STAGES_TO_ADVANCE.includes(openDeal.stage),
        }));
      } else {
        // Create new deal in "Statement Received"
        const newDeal = await storage.createDeal({
          contactId: input.contactId,
          pipeline: "sales",
          stage: "Statement Received",
          statementReceived: true,
          leadSource: input.source === "website" ? "website" : input.source === "merchant_portal" ? "merchant_portal" : "dashboard",
          notes: `Statement uploaded via ${input.source}.`,
          ...(companyId ? { companyId } : {}),
        });
        dealId = newDeal.id;
        steps.push(makeStep(3, "Deal created", true, undefined, {
          dealId, stage: "Statement Received",
        }));
      }
    }
  } catch (err: any) {
    steps.push(makeStep(3, "Deal created/updated", false, err.message));
    await logStepFailure(dealId || null, 3, "Deal created/updated", err.message);
    // Non-critical — continue with whatever dealId we have
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 4 — File attached to contact + deal
  // ────────────────────────────────────────────────────────────────────────────
  if (input.fileBuffer && input.fileName) {
    try {
      const safeFileName = path.basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const diskFileName = `${Date.now()}_${safeFileName}`;
      const uploadsDir = path.join(process.cwd(), "uploads", "statements");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, diskFileName), input.fileBuffer);
      const storageKey = `statements/${diskFileName}`;

      const doc = await storage.createDocument({
        type: "merchant_statement",
        category: "Processing Statement",
        fileName: safeFileName,
        fileSize: input.fileBuffer.length,
        storageKey,
        dealId: dealId || null,
        contactId: input.contactId,
        accessScope: "internal",
        status: "pending",
        uploadedBy: `system:${input.source}`,
      });
      documentId = doc.id;
      steps.push(makeStep(4, "File attached", true, undefined, { documentId, storageKey }));
    } catch (err: any) {
      steps.push(makeStep(4, "File attached", false, err.message));
      await logStepFailure(dealId, 4, "File attached", err.message);
    }
  } else {
    steps.push(makeStep(4, "File attached", true, undefined, { note: "No file buffer — skipped" }));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 5 — AI analysis job queued  (lifecycle: pending → processing → complete)
  // ────────────────────────────────────────────────────────────────────────────
  if (dealId) {
    try {
      // Set pending immediately so the deal card reflects queued state
      await storage.updateDeal(dealId, { analysisStatus: "pending" });

      // Try BullMQ first — gives reliable retry and dead-letter on exhaustion.
      // Falls back to an in-process IIFE when Redis/BullMQ is unavailable (local dev).
      let enqueuedViaBullmq = false;
      try {
        const { enqueueStatementAnalysis } = await import("./queue-manager");
        const jobId = await enqueueStatementAnalysis(dealId);
        if (jobId) enqueuedViaBullmq = true;
      } catch { /* ignore — fallback below */ }

      if (!enqueuedViaBullmq) {
        // In-process fallback with explicit lifecycle transitions
        const capturedDealId = dealId;
        (async () => {
          try {
            await storage.updateDeal(capturedDealId, { analysisStatus: "processing" });
            await generateDealBlueprint(capturedDealId);
            await storage.updateDeal(capturedDealId, { analysisStatus: "complete" }).catch(() => {});
          } catch (err: any) {
            console.error(`[StatementChain] Blueprint job failed for deal #${capturedDealId}:`, err.message);
            await storage.updateDeal(capturedDealId, { analysisStatus: "failed" }).catch(() => {});
          }
        })();
      }

      autoGenerateProposal(dealId, input.fileBuffer).catch(err =>
        console.error(`[StatementChain] Proposal job failed for deal #${dealId}:`, err.message),
      );

      steps.push(makeStep(5, "AI analysis queued", true, undefined, {
        dealId,
        analysisStatus: "pending",
        driver: enqueuedViaBullmq ? "bullmq" : "in-process",
      }));
    } catch (err: any) {
      steps.push(makeStep(5, "AI analysis queued", false, err.message));
      await logStepFailure(dealId, 5, "AI analysis queued", err.message);
    }
  } else {
    steps.push(makeStep(5, "AI analysis queued", false, "No dealId available"));
    await logStepFailure(null, 5, "AI analysis queued", "No dealId");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 6 — Rep notified (in-app notification + email)
  // ────────────────────────────────────────────────────────────────────────────
  try {
    const contact = await storage.getContact(input.contactId);
    const deal = dealId ? await storage.getDeal(dealId) : null;
    const merchantName = input.businessName || contact?.companyName
      || `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim()
      || "Unknown";

    // Resolve rep — priority order per task spec:
    //   1. contact.assignedTo (equivalent of contact.agentId owner)
    //   2. deal.owner
    //   3. ADMIN_EMAIL fallback
    // We look up each candidate against the users table so we get the user's
    // string id (required for recipientId) AND their email (for the rep email).
    let repUserId: string | null = null;   // users.id — used as recipientId
    let repEmail: string | null = null;
    let repName: string | null = null;

    try {
      const allUsers = await storage.getUsersByRole(["admin", "manager", "agent"]);

      const findUser = (ownerKey: string | null | undefined) => {
        if (!ownerKey) return null;
        return allUsers.find(u =>
          u.email === ownerKey
          || `${u.firstName || ""} ${u.lastName || ""}`.trim() === ownerKey,
        ) ?? null;
      };

      // 1. contact.assignedTo first (spec: "contact.agentId owner")
      let matched = findUser(contact?.assignedTo);
      // 2. deal.owner as fallback
      if (!matched) matched = findUser(deal?.owner);
      // 3. ADMIN_EMAIL fallback
      if (!matched && process.env.ADMIN_EMAIL) {
        matched = allUsers.find(u => u.email === process.env.ADMIN_EMAIL) ?? null;
      }

      if (matched) {
        repUserId = matched.id;          // string user id — correct recipientId
        repEmail = matched.email ?? null;
        repName = `${matched.firstName || ""} ${matched.lastName || ""}`.trim() || matched.email || null;
      }
    } catch { /* non-fatal — fall through to ADMIN_EMAIL raw fallback */ }

    // Raw ADMIN_EMAIL fallback (no matching user row found)
    if (!repEmail) {
      repEmail = process.env.ADMIN_EMAIL || null;
      repName = "Admin";
      // recipientId stays null → notification is system-wide (visible to all admins)
    }

    const dealLink = dealId
      ? `${process.env.APP_URL || ""}/dashboard/deals/${dealId}`
      : `${process.env.APP_URL || ""}/dashboard/pipeline`;

    // In-app notification — recipientId MUST be the user's string id so that
    // getNotificationsPaginated(userId) correctly scopes it to that user's inbox.
    // When repUserId is null the notification is system-wide (recipientId IS NULL).
    await storage.createNotification({
      channel: "internal",
      title: "New Statement Uploaded",
      message: `${merchantName} uploaded a processing statement — ready for review.`,
      type: "alert",
      recipientId: repUserId ?? undefined,
      metadata: {
        contactId: input.contactId,
        dealId: dealId ?? undefined,
        link: dealLink,
        eventType: "statement_uploaded",
      },
    });

    // Email to rep (fire-and-forget)
    if (repEmail) {
      const subject = `New Statement Uploaded — ${merchantName}`;
      const body = `<p>Hi ${repName || "there"},</p>
<p><strong>${merchantName}</strong> just uploaded a processing statement and is ready for review.</p>
<p><a href="${dealLink}">View Deal #${dealId}</a></p>
<p>Log in to Liberty Bancard and review the statement to kick off the proposal.</p>
<p>— Liberty Bancard Automated Alerts</p>`;

      if (isSmtpConfigured()) {
        sendSmtpEmail({ to: repEmail, subject, html: body }).catch(err =>
          console.error("[StatementChain] Rep email (SMTP) failed:", err.message),
        );
      } else if (isGhlConfigured()) {
        const { sendGhlEmailForMerchant } = await import("./ghl");
        sendGhlEmailForMerchant({ email: repEmail, subject, body }).catch(err =>
          console.error("[StatementChain] Rep email (GHL) failed:", err.message),
        );
      }
    }

    steps.push(makeStep(6, "Rep notified", true, undefined, {
      repUserId: repUserId || "system-wide",
      repEmail: repEmail || "no-rep",
      channel: repEmail && isSmtpConfigured() ? "smtp" : repEmail && isGhlConfigured() ? "ghl" : "in-app-only",
    }));
  } catch (err: any) {
    steps.push(makeStep(6, "Rep notified", false, err.message));
    await logStepFailure(dealId, 6, "Rep notified", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 7 — GHL contact synced + lb_statement_status = "received"
  // ────────────────────────────────────────────────────────────────────────────
  try {
    const ghlContactResult = await syncContactToGhl(input.contactId);
    if (!ghlContactResult.success && !ghlContactResult.ghlContactId) {
      throw new Error(ghlContactResult.error || "GHL contact sync failed");
    }

    // Sync the deal opportunity stage in GHL
    if (dealId) {
      const dealSyncResult = await syncDealToGhl(dealId);
      if (!dealSyncResult.success) {
        console.warn(`[StatementChain] GHL deal sync failed (non-fatal): ${dealSyncResult.error}`);
      }
    }

    // Set lb_statement_status = "received" custom field
    const stmtSyncResult = await syncStatementUploadToGhl(
      input.contactId,
      input.fileName || "statement.pdf",
    );

    steps.push(makeStep(7, "GHL contact synced", true, undefined, {
      ghlContactId: ghlContactResult.ghlContactId,
      statementStatusSet: stmtSyncResult.success,
    }));
  } catch (err: any) {
    steps.push(makeStep(7, "GHL contact synced", false, err.message));
    await logStepFailure(dealId, 7, "GHL contact synced", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 8 — Pipeline stage confirmed "Statement Received"
  // ────────────────────────────────────────────────────────────────────────────
  try {
    if (dealId) {
      const deal = await storage.getDeal(dealId);
      if (deal && STAGES_TO_ADVANCE.includes(deal.stage)) {
        await storage.updateDeal(dealId, { stage: "Statement Received" });
        steps.push(makeStep(8, "Pipeline stage set", true, undefined, {
          dealId, from: deal.stage, to: "Statement Received",
        }));
      } else {
        steps.push(makeStep(8, "Pipeline stage verified", true, undefined, {
          dealId, stage: deal?.stage || "unknown",
        }));
      }
    } else {
      steps.push(makeStep(8, "Pipeline stage set", false, "No dealId"));
      await logStepFailure(null, 8, "Pipeline stage set", "No dealId");
    }
  } catch (err: any) {
    steps.push(makeStep(8, "Pipeline stage set", false, err.message));
    await logStepFailure(dealId, 8, "Pipeline stage set", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 9 — Merchant confirmation sent (GHL workflow → SMTP fallback)
  // ────────────────────────────────────────────────────────────────────────────
  try {
    const contact = await storage.getContact(input.contactId);
    const merchantEmail = contact?.email;
    const merchantName = input.businessName || contact?.companyName
      || `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim()
      || "there";

    // The GHL workflow enrollment in syncStatementUploadToGhl (step 7) already handles
    // the GHL_WORKFLOW_STATEMENT_REVIEW trigger. We add an SMTP fallback here.
    let confirmed = false;
    if (isGhlConfigured() && contact?.ghlContactId) {
      // GHL workflow already triggered in step 7 via syncStatementUploadToGhl
      confirmed = true;
      steps.push(makeStep(9, "Merchant confirmation sent", true, undefined, { channel: "ghl_workflow" }));
    } else if (isSmtpConfigured() && merchantEmail) {
      const confirmSubject = "We received your processing statement — Liberty Bancard";
      const confirmBody = `<p>Hi ${contact?.firstName || merchantName},</p>
<p>We received your processing statement and our team is reviewing it now.</p>
<p>You can expect to hear from us within <strong>1 business day</strong> with a full line-by-line breakdown and savings estimate.</p>
<p>If you have any questions in the meantime, call or text us at <strong>954-266-8214</strong>.</p>
<p>— The Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Disclaimer: Savings estimates are preliminary and depend on full statement review. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;
      const smtpResult = await sendSmtpEmail({
        to: merchantEmail,
        subject: confirmSubject,
        html: confirmBody,
      });
      confirmed = smtpResult.success;
      steps.push(makeStep(9, "Merchant confirmation sent", smtpResult.success,
        smtpResult.error, { channel: "smtp", to: merchantEmail }));
    } else {
      steps.push(makeStep(9, "Merchant confirmation sent", true, undefined, {
        note: "Skipped — no GHL contact and SMTP not configured",
      }));
      confirmed = true;
    }
  } catch (err: any) {
    steps.push(makeStep(9, "Merchant confirmation sent", false, err.message));
    await logStepFailure(dealId, 9, "Merchant confirmation sent", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 10 — Proposal draft entity created (statement_proposals table)
  // ────────────────────────────────────────────────────────────────────────────
  try {
    if (dealId) {
      const deal = await storage.getDeal(dealId);
      const contact = await storage.getContact(input.contactId);
      const merchantName = input.businessName || contact?.companyName
        || `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim()
        || "Merchant";

      // Insert a dedicated proposal row in statement_proposals.
      // This is the canonical draft proposal entity reps see on the deal detail view.
      // It is separate from deals.savingsProposal (AI-generated pricing) and
      // co_branded_proposals (partner-facing PDFs).
      const [proposalRow] = await db.insert(statementProposals).values({
        dealId,
        contactId: input.contactId,
        status: "draft",
        merchantName,
        source: input.source,
        statementFileName: input.fileName || null,
        plans: [],
        notes: "Statement received — awaiting AI analysis to populate pricing plans.",
      }).returning({ id: statementProposals.id });

      // Also flag the deal so pipeline/deal-card UI can show a "Draft Proposal" badge.
      if (deal && (!deal.proposalStatus || deal.proposalStatus === "none")) {
        await storage.updateDeal(dealId, {
          proposalStatus: "draft",
          proposalGeneratedAt: new Date(),
        });
      }

      steps.push(makeStep(10, "Proposal draft created", true, undefined, {
        dealId,
        proposalId: proposalRow?.id,
        merchantName,
        table: "statement_proposals",
      }));
    } else {
      steps.push(makeStep(10, "Proposal draft created", false, "No dealId"));
      await logStepFailure(null, 10, "Proposal draft created", "No dealId");
    }
  } catch (err: any) {
    steps.push(makeStep(10, "Proposal draft created", false, err.message));
    await logStepFailure(dealId, 10, "Proposal draft created", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 11 — Follow-up sequence enrolled
  // ────────────────────────────────────────────────────────────────────────────
  try {
    await autoEnrollFromTrigger("form_submitted", {
      contactId: input.contactId,
      dealId: dealId || undefined,
      formType: "statement_upload",
    });
    steps.push(makeStep(11, "Follow-up sequence enrolled", true, undefined, {
      contactId: input.contactId, dealId,
    }));
  } catch (err: any) {
    steps.push(makeStep(11, "Follow-up sequence enrolled", false, err.message));
    await logStepFailure(dealId, 11, "Follow-up sequence enrolled", err.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────────
  const failedSteps = steps.filter(s => !s.success).map(s => s.name);
  await logChainSuccess(dealId, input.contactId, failedSteps);

  if (failedSteps.length > 0) {
    console.warn(
      `[StatementChain] Chain completed with ${failedSteps.length} failed step(s): ${failedSteps.join(", ")}`,
    );
  } else {
    console.log(`[StatementChain] All 11 steps completed successfully for deal #${dealId}`);
  }

  return {
    contactId: input.contactId,
    dealId,
    documentId,
    steps,
    failedSteps,
    allSuccess: failedSteps.length === 0,
  };
}
