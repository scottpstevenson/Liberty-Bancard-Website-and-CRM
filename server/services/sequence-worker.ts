import { storage } from "../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "./ghl";
import { getEmailSignatureHtml, getComplianceFooterHtml, isColdOutreachSequence } from "./email-signatures";
import type { SignatureType } from "./sender-policy";
import { sanitizeFirstName } from "./contact-name-utils";

/**
 * Map a sequence's triggerConfig.category to the correct email signature type.
 *
 * | Category                | Signature   | Rationale                                                        |
 * |-------------------------|-------------|------------------------------------------------------------------|
 * | operations              | accounts    | Account mgmt team identity; no cold CTAs; existing relationship  |
 * | reactivation            | accounts    | Re-engaging known contacts; cold CTA would feel inappropriate    |
 * | education               | accounts    | Educational content for merchants/prospects already in pipeline  |
 * | nurture                 | accounts    | Long-term nurture; contact knows us; no cold promo               |
 * | support                 | support     | Ticket replies and merchant-service messages                     |
 * | risk                    | support     | Account-risk / security notices routed through support team      |
 * | onboarding              | onboarding  | Merchant activation and boarding milestones                      |
 * | referral                | partners    | Referral / partner program communications                        |
 * | sales                   | sales       | Explicit sales outreach — cold signature is intentional          |
 * | cold_outreach           | sales       | SDR cold prospecting sequences                                   |
 * | sdr                     | sales       | Legacy SDR category — cold outreach context                      |
 * | sdr_cold_outbound       | sales       | SDR cold outbound sequences                                      |
 * | sdr_outbound            | sales       | SDR outbound sequences                                           |
 * | sdr_noshow_recovery     | sales       | SDR no-show recovery — still in cold pipeline                    |
 * | sdr_proposal_followup   | sales       | SDR proposal follow-up — still Scott Stevenson sender            |
 * | sdr_reply_engaged       | sales       | Engaged lead follow-up within SDR context                        |
 * | sdr_statement_chase     | sales       | Chasing a statement upload — SDR cold context                    |
 * | inbound                 | sales       | Inbound lead nurture — same cold CTA block applies               |
 * | voicemail_followup_sms  | sales       | Voicemail follow-up SMS — sales pipeline                         |
 * | hardware                | sales       | Hardware product outreach — cold CTA appropriate                 |
 * | (unrecognized)          | sales       | Safe default; logs a warning so new categories are noticed       |
 */
export function resolveSignatureType(triggerConfig: Record<string, unknown>): SignatureType {
  const category = typeof triggerConfig.category === "string" ? triggerConfig.category : "";
  switch (category) {
    // ── Account-relationship signatures (no cold CTAs) ──────────────────────
    case "operations":
    case "reactivation":
    case "education":
    case "nurture":
      return "accounts";

    // ── Support / risk ───────────────────────────────────────────────────────
    case "support":
    case "risk":
      return "support";

    // ── Onboarding ───────────────────────────────────────────────────────────
    case "onboarding":
      return "onboarding";

    // ── Partner / referral ───────────────────────────────────────────────────
    case "referral":
      return "partners";

    // ── Sales / cold outreach (all SDR variants + explicit sales) ────────────
    case "sales":
    case "cold_outreach":
    case "sdr":
    case "sdr_cold_outbound":
    case "sdr_outbound":
    case "sdr_noshow_recovery":
    case "sdr_proposal_followup":
    case "sdr_reply_engaged":
    case "sdr_statement_chase":
    case "inbound":
    case "voicemail_followup_sms":
    case "hardware":
      return "sales";

    // ── Unknown category — warn and fall back to cold sales ──────────────────
    default:
      if (category) {
        console.warn(
          `[resolveSignatureType] Unknown sequence category "${category}" — defaulting to "sales" signature. ` +
          `Add an explicit mapping in resolveSignatureType() to silence this warning.`
        );
      }
      return "sales";
  }
}
import { createPreferenceAwareNotification } from "./digest-service";
import { enrollContactInGhlWorkflow, tagContactForInboxOrganization } from "./ghl-workflow-enrollment";
import { addNote as ghlAddNote, addTag as ghlAddTag, triggerWorkflow as ghlTriggerWorkflow, isSdrGhlConfigured } from "./sdr/ghl-client";
import { getWorkflowEnvValue } from "./ghl-workflows";
import { sendSmtpEmail, isSmtpConfigured } from "./smtp-email";
import { generateUnsubscribeToken } from "./unsubscribe-token";
import { buildIdempotencyKey, hasSentStep, openSendAttempt, markSendSent, markSendFailed } from "./outbound-send-log";
import { sendGmailEmail, isGmailOAuthConnected } from "./gmail-oauth";
import type { SendChannel } from "./outbound-send-log";
import type { VoiceBotMode } from "./sdr/voice-orchestrator";
import type { AbTestConfig, AbTestResults } from "@shared/schema";
import { getCanonicalUrl } from "../lib/canonical-url";
import { verifyEmail } from "./sdr/zerobounce";
import { claimZeroBounceCredit, checkZeroBounceBudget } from "./zerobounce-daily-limiter";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ARCHITECTURE BOUNDARY — Replit Orchestrates, GHL Transports            ║
// ║                                                                          ║
// ║  This worker is the SOLE orchestration authority for all outbound        ║
// ║  sequence steps. It owns:                                                ║
// ║    • Step scheduling (BullMQ ticks, delayDays advancement)               ║
// ║    • Gate evaluation (global pause, contactability, daily-cap, DNC,      ║
// ║      quiet-hours, bounce guard, reply-stop)                              ║
// ║    • Step dispatch (email/SMS/task/call/voicemail action execution)       ║
// ║                                                                          ║
// ║  GHL is a TRANSPORT layer only in this file:                             ║
// ║    • sendGhlEmail / sendGhlSms   — deliver a message Replit composed     ║
// ║    • upsertGhlContact            — keep CRM contact record in sync       ║
// ║    • addTag / addNote            — label contact for inbox organisation   ║
// ║                                                                          ║
// ║  enrollContactInGhlWorkflow() is called at step 0 ONLY to sync the      ║
// ║  contact to GHL (upsert + inbox tags + note). It always returns          ║
// ║  method:"replit_direct" — it never triggers a GHL native workflow.       ║
// ║  See ghl-workflow-enrollment.ts for the full boundary documentation.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const GHL_WORKFLOW_ONLY = process.env.GHL_WORKFLOW_ONLY_MODE === "true";

export async function processSequenceEnrollments(): Promise<{ processed: number; errors: number }> {
  const { acquireJobLock, releaseJobLock, JOB_NAMES } = await import("./job-registry");
  const acquired = await acquireJobLock(JOB_NAMES.SEQUENCE_WORKER);
  if (!acquired) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  try {
    const dueEnrollments = await storage.getActiveEnrollments();

    for (const enrollment of dueEnrollments) {
      try {
        const sequence = await storage.getFollowUpSequence(enrollment.sequenceId!);
        if (!sequence || sequence.status !== "active") {
          continue;
        }

        const steps = await storage.getSequenceSteps(sequence.id);
        const currentStep = enrollment.currentStep || 0;

        // ── Gate (global-pause): Platform-level kill switch ────────────────────
        // Checked FIRST — before contactability, step lookup, and GHL enrollment.
        // Reads from DB on every call (getSystemSetting has no cache — confirmed).
        // A pause toggle takes effect on the very next worker tick, for every
        // enrollment, regardless of consent tier or sequence type.
        {
          const pausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
          const isPaused = pausedRaw === true || pausedRaw === "true";
          if (isPaused) {
            const pausedReasonRaw = await storage.getSystemSetting("outboundGlobalPausedReason");
            const pauseReason = typeof pausedReasonRaw === "string" ? pausedReasonRaw : "Global outbound pause active";
            // Dedup: skip audit write if already recorded for this enrollment+step
            const enrollMeta = (enrollment.metadata as Record<string, unknown> | null) ?? {};
            const alreadyPaused =
              enrollMeta._globalPauseBlockStep === currentStep &&
              enrollMeta._globalPauseBlockReason === pauseReason;
            if (!alreadyPaused) {
              await storage.updateSequenceEnrollment(enrollment.id, {
                status: "paused",
                metadata: { ...enrollMeta, _globalPauseBlockStep: currentStep, _globalPauseBlockReason: pauseReason },
              });
              await storage.createAuditLog({
                action: "sequence_step_skipped_global_pause",
                entityType: "contact",
                entityId: enrollment.contactId ?? 0,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  currentStep,
                  pauseReason,
                },
              });
            } else {
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
            }
            processed++;
            continue;
          }
        }

        // ── Gate (reply-stop): Stop sequence if contact replied since enrollment ──
        // Checks audit_logs for any inbound message processed for this contact
        // after enrollment started. Prevents sending further steps after a reply.
        if (currentStep > 0 && enrollment.contactId && enrollment.createdAt) {
          try {
            const { db: _sqDb } = await import("../db");
            const { sql: _sqSql } = await import("drizzle-orm");
            const enrolledAt = enrollment.createdAt instanceof Date ? enrollment.createdAt : new Date(enrollment.createdAt);
            const replyRows = await _sqDb.execute(_sqSql`
              SELECT id FROM audit_logs
              WHERE action = 'inbound_message_processed'
                AND entity_id = ${enrollment.contactId}
                AND created_at > ${enrolledAt}
              LIMIT 1
            `);
            if (replyRows.rows.length > 0) {
              await storage.updateSequenceEnrollment(enrollment.id, {
                status: "completed",
                completedAt: new Date(),
              });
              await storage.createAuditLog({
                action: "sequence_stopped_contact_replied",
                entityType: "contact",
                entityId: enrollment.contactId,
                actorType: "system",
                details: { enrollmentId: enrollment.id, sequenceId: sequence.id, sequenceName: sequence.name, stoppedAtStep: currentStep, reason: "contact_replied" },
              });
              processed++;
              continue;
            }
          } catch (_replyCheckErr) {
            // Non-fatal — continue processing if reply check fails
          }
        }

        if (currentStep >= steps.length) {
          await storage.updateSequenceEnrollment(enrollment.id, {
            status: "completed",
            completedAt: new Date(),
          });
          await storage.createAuditLog({
            action: "sequence_completed",
            entityType: "contact",
            entityId: enrollment.contactId || 0,
            details: { sequenceId: sequence.id, sequenceName: sequence.name },
          });
          await createPreferenceAwareNotification({ channel: "internal", title: "Sequence Completed", message: `Sequence "${sequence.name}" completed for contact #${enrollment.contactId || 0}.`, type: "info", metadata: { sequenceId: sequence.id, contactId: enrollment.contactId, eventType: "sequence_completed" } }, "sequence_completed");
          processed++;
          continue;
        }

        if (currentStep === 0 && enrollment.contactId) {
          // Gate (a): Evaluate contactability before GHL workflow enrollment (automated outreach)
          {
            const { evaluateContactability } = await import("./contactability");
            const contactabilityCheck = await evaluateContactability({
              contactId: enrollment.contactId,
              channel: "email",
              campaignType: "sequence_enrollment",
              mode: "enforcement",
            });
            if (!contactabilityCheck.allowed) {
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
              await storage.createAuditLog({
                action: "sequence_enrollment_blocked_contactability",
                entityType: "contact",
                entityId: enrollment.contactId,
                actorType: "system",
                details: {
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  channel: "email",
                  reason: contactabilityCheck.reason,
                  consentTier: contactabilityCheck.consentTier,
                  lifecycleStage: contactabilityCheck.lifecycleStage,
                },
              });
              processed++;
              continue;
            }
          }

          const triggerConfig = (sequence.triggerConfig as any) || {};
          // outboundChannels from triggerConfig allows per-sequence channel declaration.
          // When not set in triggerConfig, defaults to fail-closed (all automated channels).
          // Email-only sequences should set triggerConfig.outboundChannels = ["email"].
          const enrollResult = await enrollContactInGhlWorkflow({
            contactId: enrollment.contactId,
            sequenceName: sequence.name,
            sequenceId: sequence.id,
            vertical: triggerConfig.vertical,
            dealId: enrollment.dealId || undefined,
            outboundChannels: triggerConfig.outboundChannels,
          });

          // NOTE: enrollResult.method === "ghl_workflow" can never occur after the
          // architecture refactor in ghl-workflow-enrollment.ts. enrollContactInGhlWorkflow()
          // always returns method:"replit_direct" — it syncs the contact to GHL (upsert +
          // tags + note) but never triggers a GHL native workflow for outbound sequences.
          // Sequence orchestration stays entirely in Replit. See the architecture boundary
          // comment block at the top of this file and in ghl-workflow-enrollment.ts.

          if (enrollResult.method === "skipped") {
            await storage.updateSequenceEnrollment(enrollment.id, {
              status: "paused",
            });
            await storage.createAuditLog({
              action: "sequence_enrollment_skipped",
              entityType: "contact",
              entityId: enrollment.contactId,
              details: {
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                reason: enrollResult.reason,
              },
            });
            processed++;
            continue;
          }

          if (enrollResult.contactGhlId) {
            const triggerConfig = (sequence.triggerConfig as any) || {};
            tagContactForInboxOrganization({
              contactId: enrollment.contactId,
              ghlContactId: enrollResult.contactGhlId,
              sequenceName: sequence.name,
              vertical: triggerConfig.vertical,
            }).catch(err => console.warn("[Sequence Worker] Inbox tagging failed:", err));
          }

          if (GHL_WORKFLOW_ONLY) {
            await storage.updateSequenceEnrollment(enrollment.id, {
              status: "paused",
            });
            await storage.createAuditLog({
              action: "sequence_direct_send_blocked",
              entityType: "contact",
              entityId: enrollment.contactId,
              details: {
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                reason: "GHL_WORKFLOW_ONLY_MODE enabled — direct sends disabled",
                enrollResult: enrollResult.reason,
              },
            });
            processed++;
            continue;
          }

          if (
            enrollResult.method === "replit_direct" &&
            !enrollResult.contactGhlId &&
            enrollResult.reason !== "GHL not configured — falling back to Replit direct sends"
          ) {
            await storage.updateSequenceEnrollment(enrollment.id, {
              status: "paused",
            });
            await storage.createAuditLog({
              action: "sequence_direct_send_blocked",
              entityType: "contact",
              entityId: enrollment.contactId,
              details: {
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                reason: "GHL contact ID not confirmed — direct sends blocked until GHL sync succeeds",
                enrollResult: enrollResult.reason,
              },
            });
            processed++;
            continue;
          }
        }

        const step = steps.find(s => s.stepOrder === currentStep + 1) || steps[currentStep];
        if (!step) {
          await storage.updateSequenceEnrollment(enrollment.id, {
            status: "completed",
            completedAt: new Date(),
          });
          processed++;
          continue;
        }

        // ── Gate (daily-cap): Cold outreach email daily send cap ───────────────
        // Fast-path read: if counter is already at/above cap, defer immediately
        // without attempting GHL enrollment or send. The actual atomic reservation
        // (which prevents race-condition overshoot) happens below, inside the
        // isGhlConfigured() block — only when a real send is about to occur.
        // Both checks read the same DB row; the fast-path is purely an optimisation
        // to skip all the downstream work when the cap is visibly exhausted.
        // Warmup mode overrides the configured cap with a ramp schedule (cannot
        // be manually raised while warmup is active — safety property).
        if (step.actionType === "email" && isColdOutreachSequence(sequence)) {
          const { db: capDb } = await import("../db");
          const { outboundSendCounters } = await import("@shared/schema");
          const { eq, and } = await import("drizzle-orm");

          const capRaw = await storage.getSystemSetting("outboundDailyEmailCap");
          let dailyCap = typeof capRaw === "number" ? capRaw : parseInt(String(capRaw ?? "200"), 10) || 200;

          // Warmup mode: override cap with ramp schedule (day 1→20, day7→50, day14→100, day30→250)
          const warmupEnabledRaw = await storage.getSystemSetting("deliveryWarmupEnabled");
          if (warmupEnabledRaw === true || warmupEnabledRaw === "true") {
            const warmupStartDateRaw = await storage.getSystemSetting("deliveryWarmupStartDate");
            if (typeof warmupStartDateRaw === "string" && warmupStartDateRaw) {
              const daysSince = Math.max(1, Math.floor((Date.now() - new Date(warmupStartDateRaw).getTime()) / 86400000) + 1);
              let warmupCap: number;
              if (daysSince >= 30) warmupCap = 250;
              else if (daysSince >= 14) warmupCap = 100;
              else if (daysSince >= 7) warmupCap = 50;
              else warmupCap = 20;
              // Warmup cap cannot be overridden upward — take the lower value
              dailyCap = Math.min(dailyCap, warmupCap);
            }
          }

          const todayStr = new Date().toISOString().slice(0, 10);
          const [capRow] = await capDb
            .select({ count: outboundSendCounters.count })
            .from(outboundSendCounters)
            .where(and(
              eq(outboundSendCounters.date, todayStr),
              eq(outboundSendCounters.channel, "email"),
              eq(outboundSendCounters.scope, "cold_outreach"),
            ));
          const sendsToday = capRow?.count ?? 0;

          if (sendsToday >= dailyCap) {
            const enrollMeta = (enrollment.metadata as Record<string, unknown> | null) ?? {};
            const alreadyDeferred =
              enrollMeta._capDeferStep === step.stepOrder &&
              enrollMeta._capDeferDate === todayStr;
            if (!alreadyDeferred) {
              await storage.updateSequenceEnrollment(enrollment.id, {
                status: "paused",
                metadata: { ...enrollMeta, _capDeferStep: step.stepOrder, _capDeferDate: todayStr },
              });
              await storage.createAuditLog({
                action: "sequence_step_deferred_daily_cap",
                entityType: "contact",
                entityId: enrollment.contactId ?? 0,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  sendsToday,
                  dailyCap,
                  todayStr,
                },
              });
            } else {
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
            }
            processed++;
            continue;
          }
        }

        let contact: any = null;
        if (enrollment.contactId) {
          contact = await storage.getContact(enrollment.contactId);
          // Bounce guard: skip email steps for bounced/invalid/unsafe contacts.
          // "unsafe" covers ZeroBounce-flagged spam traps, abuse addresses, and do_not_mail —
          // including contacts that were validated by the batch/manual route before this send.
          if (contact && (contact.emailStatus === "bounced" || contact.emailStatus === "invalid" || contact.emailStatus === "unsafe")) {
            await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
            await storage.createAuditLog({
              action: "sequence_enrollment_skipped_bad_email",
              entityType: "contact",
              entityId: enrollment.contactId,
              actorType: "system",
              details: {
                enrollmentId: enrollment.id,
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                emailStatus: contact.emailStatus,
                reason: `Contact email status is '${contact.emailStatus}' — enrollment paused`,
              },
            });
            processed++;
            continue;
          }

          // ── ZeroBounce lazy validation gate ────────────────────────────────
          // Fire once per contact, only for email steps, when emailStatus is unknown.
          // Writes the result back to contacts.email_status so we never re-spend credits.
          if (
            contact &&
            step &&
            step.actionType === "email" &&
            (contact.emailStatus == null || contact.emailStatus === "active")
          ) {
            const zbStatuses = new Set(["valid", "unsafe", "unverified", "unknown"]);
            if (!zbStatuses.has(contact.emailStatus)) {
              const budgetCheck = await checkZeroBounceBudget();
              if (!budgetCheck.allowed) {
                console.warn(
                  `[SequenceWorker] ZeroBounce daily cap reached (${budgetCheck.used}/${budgetCheck.limit}), skipping validation for contact ${contact.id}`,
                );
              } else if (contact.email) {
                const credited = await claimZeroBounceCredit();
                if (credited) {
                  try {
                    const zbResult = await verifyEmail(contact.email);
                    // Write result back via raw SQL — Drizzle update().set() silently drops
                    // string columns when passed a union type; raw SQL is the safe path.
                    const { db: zbDb } = await import("../db");
                    const { sql: zbSql } = await import("drizzle-orm");
                    await zbDb.execute(zbSql`UPDATE contacts SET email_status = ${zbResult.status} WHERE id = ${contact.id}`);
                    contact = { ...contact, emailStatus: zbResult.status };

                    await storage.createAuditLog({
                      action: "zerobounce_email_validated",
                      entityType: "contact",
                      entityId: contact.id,
                      actorType: "system",
                      details: {
                        enrollmentId: enrollment.id,
                        sequenceId: sequence.id,
                        email: contact.email,
                        zbStatus: zbResult.status,
                        zbSubStatus: zbResult.subStatus ?? null,
                        skipped: zbResult.skipped ?? false,
                      },
                    });

                    // Block the send if the result is bad.
                    // "unsafe" = spam traps, abuse, do_not_mail.
                    // "invalid" and "bounced" are also undeliverable — treat them
                    // identically so we never send to an address that ZeroBounce
                    // just classified as bad in the same worker tick.
                    if (
                      zbResult.status === "unsafe" ||
                      zbResult.status === "invalid" ||
                      zbResult.status === "bounced"
                    ) {
                      await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                      await storage.createAuditLog({
                        action: "sequence_step_blocked_email_invalid",
                        entityType: "contact",
                        entityId: contact.id,
                        actorType: "system",
                        details: {
                          enrollmentId: enrollment.id,
                          sequenceId: sequence.id,
                          sequenceName: sequence.name,
                          email: contact.email,
                          zbStatus: zbResult.status,
                          zbSubStatus: zbResult.subStatus ?? null,
                          reason: `ZeroBounce flagged email as '${zbResult.status}' — enrollment paused`,
                        },
                      });
                      processed++;
                      continue;
                    }
                  } catch (zbErr) {
                    console.warn(`[SequenceWorker] ZeroBounce validation error for contact ${contact.id}:`, (zbErr as Error).message);
                    // Non-fatal: proceed with the send if ZeroBounce itself fails
                  }
                }
              }
            }
          }

          // ── SMS-step consent skip ──────────────────────────────────────────
          // When the current step is SMS and the contact is not eligible for SMS
          // outreach (i.e. evaluateContactability returns !allowed for the "sms"
          // channel), skip THIS STEP and advance to the next — do NOT pause the
          // enrollment.  Cold contacts enrolled in mixed email+SMS sequences (e.g.
          // SDR Outbound) continue receiving email steps; SMS steps resume
          // automatically once the contact completes PEWC (consentTier advances to
          // pewc_full_automation).  Contacts that ARE eligible fall through to the
          // normal SMS send path below.
          //
          // Note: hard blocks (DNC, opt-out, hard-bounce, complaint) are caught
          // earlier by the suppression gate and pause the enrollment before we ever
          // reach this check, so anything failing here is purely a consent-tier
          // (soft) block that is safe to skip.
          if (contact && step && step.actionType === "sms" && enrollment.contactId) {
            const { evaluateContactability: evalSmsContactability } = await import("./contactability");
            const smsCheck = await evalSmsContactability({
              contactId: enrollment.contactId,
              channel: "sms",
              campaignType: "sequence_step",
              mode: "enforcement",
            });
            // Only skip-and-advance for consent-tier blocks (no PEWC).
            // Non-consent failures (quiet hours, feature flag off, invalid phone,
            // carrier blocks, etc.) fall through to Gate (b) below, which applies
            // the normal per-step pause so the step can be retried later.
            const SMS_CONSENT_SOFT_TIERS = new Set(["cold_no_consent", "warm_no_pewc"]);
            const isSmsConsentBlock = !smsCheck.allowed && SMS_CONSENT_SOFT_TIERS.has(smsCheck.consentTier);
            if (isSmsConsentBlock) {
              await storage.createAuditLog({
                action: "sequence_step_skipped_sms_no_consent",
                entityType: "contact",
                entityId: enrollment.contactId,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  consentTier: smsCheck.consentTier,
                  reason: smsCheck.reason ?? "SMS step skipped — PEWC consent not collected for this contact",
                },
              });
              // Advance to the next step
              const skipNextIndex = currentStep + 1;
              const skipSortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
              const skipNextStep = skipSortedSteps[skipNextIndex];
              if (!skipNextStep) {
                await storage.updateSequenceEnrollment(enrollment.id, {
                  currentStep: skipNextIndex,
                  status: "completed",
                  completedAt: new Date(),
                });
                await storage.createAuditLog({
                  action: "sequence_completed",
                  entityType: "contact",
                  entityId: enrollment.contactId || 0,
                  details: { sequenceId: sequence.id, sequenceName: sequence.name, via: "sms_skip_final_step" },
                });
              } else {
                const skipDelayMs = ((skipNextStep.delayDays || 0) * 86400000) + ((skipNextStep.delayHours || 0) * 3600000);
                const skipNextActionAt = new Date(Date.now() + Math.max(skipDelayMs, 60000));
                await storage.updateSequenceEnrollment(enrollment.id, {
                  currentStep: skipNextIndex,
                  nextActionAt: skipNextActionAt,
                });
              }
              processed++;
              continue;
            }
          }

          // ── Suppression gate: compliance fields pre-send check ──────────────
          // Reads new compliance/suppression fields and blocks if contact is
          // opted-out, unsubscribed, hard-bounced, or complained.
          // NOTE: SMS consent is handled above as a per-step skip — it is
          // intentionally NOT included here to avoid pausing the enrollment.
          if (contact) {
            const suppressionReasons: string[] = [];
            const c = contact as any;

            if (c.optOutStatus === "opted_out") suppressionReasons.push(`opt_out_status=opted_out (channel: ${c.optOutChannel ?? "unknown"})`);
            if (c.unsubscribeStatus === "unsubscribed") suppressionReasons.push("unsubscribe_status=unsubscribed");
            if (c.bounceStatus === "hard") suppressionReasons.push(`bounce_status=hard (${c.bounceReason ?? "no reason recorded"})`);
            if (c.complaintStatus === "reported") suppressionReasons.push("complaint_status=reported");

            if (suppressionReasons.length > 0) {
              const reason = suppressionReasons.join("; ");
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
              await storage.createAuditLog({
                action: "sequence_enrollment_suppressed",
                entityType: "contact",
                entityId: enrollment.contactId,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  reason,
                  suppressionFields: suppressionReasons,
                },
              });
              processed++;
              continue;
            }
          }
        }

        let deal: any = null;
        if (enrollment.dealId) {
          deal = await storage.getDeal(enrollment.dealId);
        }

        const rawFirstName = contact?.firstName ?? "";
        const firstName = sanitizeFirstName(rawFirstName) || "there";
        if (rawFirstName && firstName === "there") {
          console.warn(`[Sequence Worker] Contact ${contact?.id} has unsendable first_name "${rawFirstName}" — substituting "there"`);
        }
        const lastName = contact?.lastName || "";
        const companyName = contact?.companyName || "your business";
        const email = contact?.email || "";

        const industry = contact?.vertical || "your industry";
        const monthlyVolume = contact?.monthlyVolume || "N/A";
        const currentProcessor = contact?.currentProvider || "your current processor";
        const estimatedSavings = contact?.estimatedResidual
          ? `$${Math.round(Number(contact.estimatedResidual) * 12).toLocaleString()}`
          : "significant savings";
        const recommendedProgram = contact?.primaryOfferPath || "Wholesale";
        const recommendedTerminal = deal?.terminalRecommendation || "Clover Flex 3";

        const serviceType = contact?.vertical || industry;
        const estimatedVolume = contact?.monthlyVolume || monthlyVolume;
        let agentName = "Liberty Bancard";
        let agentEmail = "Scott@mail.libertybancard.com";
        let agentPhone = "954-266-8214";
        if (contact?.agentId) {
          try {
            const assignedAgent = await storage.getAgent(contact.agentId);
            if (assignedAgent) {
              const fullName = [assignedAgent.firstName, assignedAgent.lastName].filter(Boolean).join(" ");
              if (fullName) agentName = fullName;
              if ((assignedAgent as any).email) agentEmail = (assignedAgent as any).email;
              if ((assignedAgent as any).phone) agentPhone = (assignedAgent as any).phone;
            }
          } catch {
            // fallback to defaults
          }
        }

        // businessName is the same concept as companyName — alias for template compat
        const businessName = companyName;

        const calendarLink =
          process.env.GHL_CALENDAR_BOOKING_URL ||
          (process.env.GHL_DEFAULT_CALENDAR_ID
            ? `https://api.leadconnectorhq.com/widget/booking/${process.env.GHL_DEFAULT_CALENDAR_ID}`
            : "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr");

        const interpolate = (text: string | null | undefined): string => {
          if (!text) return "";
          const result = text
            .replace(/\{\{firstName\}\}/g, firstName)
            .replace(/\{\{lastName\}\}/g, lastName)
            .replace(/\{\{companyName\}\}/g, companyName)
            .replace(/\{\{email\}\}/g, email)
            .replace(/\{\{contact\.firstName\}\}/g, firstName)
            .replace(/\{\{contact\.lastName\}\}/g, lastName)
            .replace(/\{\{contact\.companyName\}\}/g, companyName)
            .replace(/\{\{industry\}\}/g, industry)
            .replace(/\{\{monthlyVolume\}\}/g, monthlyVolume)
            .replace(/\{\{currentProcessor\}\}/g, currentProcessor)
            .replace(/\{\{estimatedSavings\}\}/g, estimatedSavings)
            .replace(/\{\{recommendedProgram\}\}/g, recommendedProgram)
            .replace(/\{\{recommendedTerminal\}\}/g, recommendedTerminal)
            .replace(/\{\{serviceType\}\}/g, serviceType)
            .replace(/\{\{estimatedVolume\}\}/g, estimatedVolume)
            .replace(/\{\{agentName\}\}/g, agentName)
            .replace(/\{\{agentEmail\}\}/g, agentEmail)
            .replace(/\{\{agentPhone\}\}/g, agentPhone)
            .replace(/\{\{businessName\}\}/g, businessName)
            .replace(/\{\{calendarLink\}\}/g, calendarLink)
            .replace(/\{\{contact\.vertical\}\}/g, industry)
            .replace(/\{\{vertical\}\}/g, industry);
          // Safety net: warn if any raw {{...}} template syntax survived substitution
          const remaining = result.match(/\{\{[^}]+\}\}/g);
          if (remaining) {
            console.warn(
              `[Sequence Worker] Unresolved template placeholders in outbound message ` +
              `(enrollment ${enrollment.id}, step ${step.stepOrder}, contact ${enrollment.contactId}): ` +
              remaining.join(", ")
            );
          }
          return result;
        };

        let stepExecuted = false;

        // Gate (b): Evaluate contactability before any automated send/trigger dispatch
        {
          type AutomatedActionChannel = "email" | "sms" | "voice_ai" | "ringless_vm" | "manual_call";
          const automatedChannelMap: Record<string, AutomatedActionChannel> = {
            email: "email",
            sms: "sms",
            call: "voice_ai",
            voicemail_drop: "ringless_vm",
            // "task" steps create a CRM task only — no call, no AI voice, no RVM.
            // They are gated via manual_call to block opted-out/DNC contacts after enrollment.
            task: "manual_call",
          };
          const automatedChannel = automatedChannelMap[step.actionType];
          if (automatedChannel && enrollment.contactId) {
            const { evaluateContactability } = await import("./contactability");
            const contactabilityCheck = await evaluateContactability({
              contactId: enrollment.contactId,
              channel: automatedChannel,
              campaignType: "sequence_step",
              mode: "enforcement",
            });
            if (!contactabilityCheck.allowed) {
              await storage.createAuditLog({
                action: "sequence_step_blocked_contactability",
                entityType: "contact",
                entityId: enrollment.contactId,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  actionType: step.actionType,
                  channel: automatedChannel,
                  reason: contactabilityCheck.reason,
                  consentTier: contactabilityCheck.consentTier,
                  lifecycleStage: contactabilityCheck.lifecycleStage,
                },
              });
              import("./analytics-events").then(({ recordAnalyticsEvent }) => {
                recordAnalyticsEvent({
                  eventName: "sequence_step_blocked",
                  contactId: enrollment.contactId ?? undefined,
                  sequenceId: sequence.id,
                  channel: automatedChannel,
                  blockReason: contactabilityCheck.reason,
                  consentTier: contactabilityCheck.consentTier,
                  lifecycleStage: contactabilityCheck.lifecycleStage,
                  metadata: { stepOrder: step.stepOrder, actionType: step.actionType, sequenceName: sequence.name },
                });
              }).catch(() => {});
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
              processed++;
              continue;
            }
          }
        }

        switch (step.actionType) {
          case "email": {
            const abConfig = (step.abTestConfig as AbTestConfig | null);
            const abEnabled = !!(step.variantBSubject || step.variantBBody);

            const existing = (step.abTestResults as Partial<AbTestResults> | null) ?? {};
            const currentWinner: string | null = existing.winnerSelected ?? null;

            let chosenVariant: "A" | "B" = "A";
            let subjectToSend = step.subject;
            let bodyToSend = step.body;

            if (abEnabled) {
              if (currentWinner) {
                chosenVariant = currentWinner as "A" | "B";
              } else {
                const splitRatio = abConfig?.splitRatio ?? 50;
                chosenVariant = Math.random() * 100 < splitRatio ? "A" : "B";
              }
              if (chosenVariant === "B") {
                subjectToSend = step.variantBSubject ?? step.subject;
                bodyToSend = step.variantBBody ?? step.body;
              }
            }

            let complianceFooter = "";
            if (isColdOutreachSequence(sequence) && enrollment.contactId) {
              // getCanonicalUrl() always resolves — APP_URL → REPLIT_DOMAINS →
              // https://libertybancard.com static fallback — so a missing APP_URL
              // env var no longer blocks unsubscribe link generation.
              const appUrl = getCanonicalUrl();
              const testMode = process.env.TEST_MODE === "true";
              const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
              let blockReason: string | null = null;

              if (!mailingAddress) {
                blockReason = "sequence_send_blocked_no_mailing_address";
              } else {
                try {
                  const { getUnsubscribeTokenSecret } = await import("./unsubscribe-token");
                  getUnsubscribeTokenSecret();
                } catch {
                  if (!testMode) {
                    blockReason = "sequence_send_blocked_no_unsubscribe_secret";
                  }
                }
              }

              if (blockReason) {
                await storage.createAuditLog({
                  action: blockReason,
                  entityType: "contact",
                  entityId: enrollment.contactId,
                  actorType: "system",
                  details: {
                    enrollmentId: enrollment.id,
                    sequenceId: sequence.id,
                    sequenceName: sequence.name,
                    stepOrder: step.stepOrder,
                    reason: blockReason,
                  },
                });
                await storage.updateSequenceEnrollment(enrollment.id, {
                  status: "paused",
                });
                stepExecuted = false;
                break;
              }

              if (!blockReason && mailingAddress) {
                complianceFooter = getComplianceFooterHtml(enrollment.contactId, mailingAddress, appUrl);
              }
            }

            const sigType = resolveSignatureType((sequence.triggerConfig as any) || {});
            const emailBody = interpolate(bodyToSend) + getEmailSignatureHtml(sigType) + complianceFooter;

            // ── Per-channel pause gate (email) ────────────────────────────────
            // Checked after global pause (already verified above) and contactability.
            // emailChannelPaused = all email; coldEmailChannelPaused = cold only.
            // FAIL-CLOSED: null/undefined (unset) → paused. Only explicit "false"
            // (string or boolean) releases the channel.
            {
              const emailPausedRaw = await storage.getSystemSetting("emailChannelPaused");
              const emailPaused = emailPausedRaw !== "false" && emailPausedRaw !== false;
              if (emailPaused) {
                await storage.createAuditLog({
                  action: "sequence_step_skipped_channel_pause",
                  entityType: "contact", entityId: enrollment.contactId ?? 0, actorType: "system",
                  details: { enrollmentId: enrollment.id, sequenceId: sequence.id, channel: "email", reason: "emailChannelPaused" },
                });
                await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                processed++; stepExecuted = false; break;
              }
              if (isColdOutreachSequence(sequence)) {
                const coldPausedRaw = await storage.getSystemSetting("coldEmailChannelPaused");
                const coldPaused = coldPausedRaw !== "false" && coldPausedRaw !== false;
                if (coldPaused) {
                  await storage.createAuditLog({
                    action: "sequence_step_skipped_channel_pause",
                    entityType: "contact", entityId: enrollment.contactId ?? 0, actorType: "system",
                    details: { enrollmentId: enrollment.id, sequenceId: sequence.id, channel: "cold_email", reason: "coldEmailChannelPaused" },
                  });
                  await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                  processed++; stepExecuted = false; break;
                }
              }
            }

            // ── Idempotency gate (email) ──────────────────────────────────────
            // seq-{enrollmentId}-s{stepOrder} is permanently unique per enrollment.
            // If the step was already successfully sent (e.g. after a crash retry),
            // skip the network call and advance enrollment normally.
            const emailIdemKey = buildIdempotencyKey(enrollment.id, step.stepOrder ?? 0);
            if (await hasSentStep(emailIdemKey)) {
              console.warn(`[Sequence Worker] Email step already sent (idempotent skip): ${emailIdemKey}`);
              stepExecuted = true;
              break;
            }

            // ── Channel selection ─────────────────────────────────────────────
            // Gmail OAuth  → staff/department (non-cold) when connected
            // SMTP         → cold outreach when configured (needs List-Unsubscribe header)
            // GHL          → cold outreach ONLY (Scott@mail.libertybancard.com)
            //
            // CRITICAL: Non-cold sequences MUST send via Gmail OAuth.
            // If Gmail is unavailable, block the send — do NOT fall through to GHL.
            // GHL sends from a cold-outreach domain; mixing department email through
            // that domain silently sends from the wrong address and wrong brand.
            const isColdEmail = isColdOutreachSequence(sequence);
            const useGmailForThisStep = !isColdEmail && (await isGmailOAuthConnected()) && !!contact?.email;
            const useSmtpForThisStep  = isColdEmail && isSmtpConfigured() && !!contact?.email;

            // Gmail unavailable for non-cold sequence → BLOCK, do not fall through to GHL
            if (!isColdEmail && !useGmailForThisStep) {
              const gmailBlockReason = !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET
                ? "Gmail OAuth secrets (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) not configured"
                : !process.env.CREDENTIAL_ENCRYPTION_KEY
                ? "CREDENTIAL_ENCRYPTION_KEY not set — Gmail token cannot be decrypted"
                : "Gmail OAuth not connected (complete OAuth flow at /dashboard/outbound-readiness)";
              console.warn(`[Sequence Worker] Non-cold email blocked — Gmail unavailable for enrollment ${enrollment.id}: ${gmailBlockReason}`);
              await storage.createAuditLog({
                action: "sequence_step_blocked_gmail_unavailable",
                entityType: "contact",
                entityId: enrollment.contactId ?? 0,
                actorType: "system",
                details: {
                  enrollmentId: enrollment.id,
                  sequenceId: sequence.id,
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  reason: gmailBlockReason,
                  blockedAt: new Date().toISOString(),
                },
              });
              await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
              processed++;
              stepExecuted = false;
              break;
            }

            // ── Gate (no-prospect-send): Test mode guard ─────────────────────
            // When deliveryNoProspectSendEmail is true, only allowlisted test addresses
            // can receive sends. Designed to be default-on before go-live, so accidental
            // sends to real prospects during testing are impossible.
            //
            // FAIL-CLOSED: guard runs unconditionally for all email step types.
            // If the guard is active and the contact has no resolvable email (including
            // when GHL would dispatch via contactId alone), we block the send — we never
            // let an unverifiable recipient slip through to any provider.
            {
              const noProspectRaw = await storage.getSystemSetting("deliveryNoProspectSendEmail");
              const noProspectGuard = noProspectRaw === true || noProspectRaw === "true";
              if (noProspectGuard) {
                const allowlistRaw = await storage.getSystemSetting("deliveryTestEmailAllowlist");
                const allowlist: string[] = typeof allowlistRaw === "string"
                  ? allowlistRaw.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
                  : [];
                // Fail closed: no email on contact record → cannot verify → block.
                const recipientEmail = contact?.email?.toLowerCase() ?? "";
                const isAllowed = recipientEmail.length > 0 &&
                  (allowlist.includes(recipientEmail) || recipientEmail.endsWith("@libertybancard.com"));
                if (!isAllowed) {
                  await storage.createAuditLog({
                    action: "sequence_step_blocked_no_prospect_guard",
                    entityType: "contact",
                    entityId: enrollment.contactId ?? 0,
                    actorType: "system",
                    details: {
                      enrollmentId: enrollment.id,
                      sequenceId: sequence.id,
                      sequenceName: sequence.name,
                      stepOrder: step.stepOrder,
                      recipient: recipientEmail || "(no email on record)",
                      reason: recipientEmail
                        ? "no_prospect_send_email guard active — recipient not in allowlist"
                        : "no_prospect_send_email guard active — contact has no email (fail-closed)",
                    },
                  });
                  await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                  processed++;
                  stepExecuted = false;
                  break;
                }
              }
            }

            // ── Test intercept: deliveryTestRedirectEmail ────────────────────────
            // When set, every outbound sequence email is redirected to this address.
            // Original recipient + sequence context are prepended to the subject so
            // the operator can audit exactly who each email would have gone to.
            // Safe to leave unset in production — null means no redirect.
            const testRedirectRaw = await storage.getSystemSetting("deliveryTestRedirectEmail");
            const testRedirectTo: string | null =
              typeof testRedirectRaw === "string" && testRedirectRaw.trim()
                ? testRedirectRaw.trim() : null;
            const interpolatedSubject = interpolate(subjectToSend);
            const deliverySubject = testRedirectTo
              ? `[→ ${contact?.email ?? "no-email"} | ${sequence.name} | Step ${step.stepOrder}] ${interpolatedSubject}`
              : interpolatedSubject;
            const deliveryEmailTo = testRedirectTo ?? contact?.email ?? "";

            if ((useGmailForThisStep || useSmtpForThisStep || isGhlConfigured()) && enrollment.contactId) {
              // ── Atomic cap reservation (cold outreach only) ───────────────────
              // Reserve a send slot via a single conditional upsert.  The WHERE
              // clause makes the increment a no-op when the cap is already reached,
              // which prevents concurrent workers from overshooting the daily limit.
              // Reservation happens here — inside isGhlConfigured() — so counters
              // only tick when an actual GHL send is attempted.
              let coldCapReserved = false;
              if (isColdOutreachSequence(sequence)) {
                try {
                  const { db: rsvDb } = await import("../db");
                  const { sql: rsvSql } = await import("drizzle-orm");
                  const todayRsv = new Date().toISOString().slice(0, 10);
                  const capRawRsv = await storage.getSystemSetting("outboundDailyEmailCap");
                  let dailyCapRsv = typeof capRawRsv === "number" ? capRawRsv : parseInt(String(capRawRsv ?? "200"), 10) || 200;

                  // Warmup mode: apply the same ramp cap at the atomic reservation level so
                  // concurrent workers cannot race past the warmup limit.
                  const warmupEnabledRsv = await storage.getSystemSetting("deliveryWarmupEnabled");
                  if (warmupEnabledRsv === true || warmupEnabledRsv === "true") {
                    const warmupStartRsv = await storage.getSystemSetting("deliveryWarmupStartDate");
                    if (typeof warmupStartRsv === "string" && warmupStartRsv) {
                      const daysSinceRsv = Math.max(1, Math.floor((Date.now() - new Date(warmupStartRsv).getTime()) / 86400000) + 1);
                      let warmupCapRsv: number;
                      if (daysSinceRsv >= 30) warmupCapRsv = 250;
                      else if (daysSinceRsv >= 14) warmupCapRsv = 100;
                      else if (daysSinceRsv >= 7) warmupCapRsv = 50;
                      else warmupCapRsv = 20;
                      // Warmup cap is a hard ceiling — never allow more than schedule allows
                      dailyCapRsv = Math.min(dailyCapRsv, warmupCapRsv);
                    }
                  }

                  // Conditional upsert: only increment if count < effective cap (atomic guard against race overshoot)
                  const rsvResult = await rsvDb.execute(rsvSql`
                    INSERT INTO outbound_send_counters (date, channel, scope, count, updated_at)
                    VALUES (${todayRsv}, 'email', 'cold_outreach', 1, now())
                    ON CONFLICT (date, channel, scope) DO UPDATE
                      SET count = outbound_send_counters.count + 1, updated_at = now()
                      WHERE outbound_send_counters.count < ${dailyCapRsv}
                    RETURNING count
                  `);
                  // If no row returned the WHERE guard blocked the update → cap is full
                  if (!rsvResult.rows || rsvResult.rows.length === 0) {
                    const enrollMeta2 = (enrollment.metadata as Record<string, unknown> | null) ?? {};
                    const alreadyDeferred2 =
                      enrollMeta2._capDeferStep === step.stepOrder &&
                      enrollMeta2._capDeferDate === todayRsv;
                    if (!alreadyDeferred2) {
                      await storage.updateSequenceEnrollment(enrollment.id, {
                        status: "paused",
                        metadata: { ...enrollMeta2, _capDeferStep: step.stepOrder, _capDeferDate: todayRsv },
                      });
                      await storage.createAuditLog({
                        action: "sequence_step_deferred_daily_cap",
                        entityType: "contact",
                        entityId: enrollment.contactId ?? 0,
                        actorType: "system",
                        details: {
                          enrollmentId: enrollment.id,
                          sequenceId: sequence.id,
                          sequenceName: sequence.name,
                          stepOrder: step.stepOrder,
                          dailyCap: dailyCapRsv,
                          todayStr: todayRsv,
                          source: "atomic_reservation",
                        },
                      });
                    } else {
                      await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                    }
                    processed++;
                    stepExecuted = false;
                    break;
                  }
                  coldCapReserved = true;
                } catch (reserveErr) {
                  // FAIL-CLOSED: if the atomic reservation query throws for any reason
                  // (DB error, transient fault, SQL error), we must NOT continue to send.
                  // Pause the enrollment and write an audit log so operators can investigate.
                  console.error(`[Sequence Worker] Cold cap reservation failed for enrollment ${enrollment.id} — pausing (fail-closed):`, reserveErr);
                  try {
                    await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                    await storage.createAuditLog({
                      action: "sequence_step_deferred_cap_reservation_error",
                      entityType: "contact",
                      entityId: enrollment.contactId ?? 0,
                      actorType: "system",
                      details: {
                        enrollmentId: enrollment.id,
                        sequenceId: sequence.id,
                        sequenceName: sequence.name,
                        stepOrder: step.stepOrder,
                        error: reserveErr instanceof Error ? reserveErr.message : String(reserveErr),
                        reason: "Daily cap reservation query failed — send blocked (fail-closed) to preserve warmup/cap enforcement integrity",
                      },
                    });
                  } catch (auditErr) {
                    console.error(`[Sequence Worker] Failed to write audit log for reservation error (enrollment ${enrollment.id}):`, auditErr);
                  }
                  processed++;
                  stepExecuted = false;
                  break;
                }
              }

              // Open a pending row before we attempt the send.
              // ON CONFLICT DO NOTHING means a concurrent worker that already claimed
              // this slot returns null here — that's fine, the UPDATE in markSendSent /
              // markSendFailed will still find the row the first worker inserted.
              const sendLogChannel: import("./outbound-send-log").SendChannel =
                useGmailForThisStep ? "email_gmail"
                : useSmtpForThisStep ? "email_smtp"
                : (testRedirectTo && isSmtpConfigured()) ? "email_smtp"
                : "email_ghl";
              await openSendAttempt({
                idempotencyKey:       emailIdemKey,
                sequenceId:           sequence.id,
                sequenceEnrollmentId: enrollment.id,
                contactId:            enrollment.contactId ?? undefined,
                stepOrder:            step.stepOrder ?? undefined,
                channel:              sendLogChannel,
                // For GHL sends the provider routes via contactId, not a direct address,
                // but we still record the contact's stored email so the log row is queryable.
                toAddress:            deliveryEmailTo || contact?.email || "",
                subject:              deliverySubject,
              });

              try {
                if (useGmailForThisStep && contact?.email) {
                  // Gmail API: department/staff email via OAuth2 (non-cold sequences)
                  // getCanonicalUrl() always resolves — no undefined risk.
                  const appUrlForToken = getCanonicalUrl();
                  const token = generateUnsubscribeToken(enrollment.contactId);
                  const unsubscribeUrl = `${appUrlForToken}/unsubscribe?t=${encodeURIComponent(token)}`;
                  const result = await sendGmailEmail({
                    to: deliveryEmailTo,
                    subject: deliverySubject,
                    html: emailBody,
                    category: "department_accounts",
                    unsubscribeUrl,
                  });
                  if (!result.success) throw new Error(result.error || "Gmail send failed");
                  await markSendSent({ idempotencyKey: emailIdemKey, providerMessageId: result.messageId, fromAddress: "gmail_oauth" });
                } else if (useSmtpForThisStep && contact?.email) {
                  // SMTP: cold outreach with List-Unsubscribe header
                  // getCanonicalUrl() always resolves — no undefined risk.
                  const appUrlForToken = getCanonicalUrl();
                  const token = generateUnsubscribeToken(enrollment.contactId);
                  const unsubscribeUrl = `${appUrlForToken}/unsubscribe?t=${encodeURIComponent(token)}`;
                  const result = await sendSmtpEmail({
                    to: deliveryEmailTo,
                    subject: deliverySubject,
                    html: emailBody,
                    category: "cold_outreach",
                    unsubscribeUrl,
                    unsubscribeMailto: "Scott@mail.libertybancard.com",
                  });
                  if (!result.success) throw new Error(result.error || "SMTP send failed");
                  await markSendSent({ idempotencyKey: emailIdemKey, providerMessageId: result.messageId, fromAddress: "Scott@mail.libertybancard.com" });
                } else {
                  // GHL: cold outreach from Scott@mail.libertybancard.com
                  // When test intercept is active, fall back to SMTP to the redirect address
                  // because GHL sends via contactId and would reach the real contact directly.
                  const fromEmail = isColdEmail ? "Scott@mail.libertybancard.com" : "accounts@libertybancard.com";
                  const fromName  = isColdEmail ? "Scott Stevenson" : "Liberty Bancard Account Management";
                  // replyTo ensures prospect replies land in a monitored inbox:
                  //   cold outreach → scott@libertybancard.com (not the dedicated send mailbox)
                  //   accounts      → accounts@libertybancard.com (monitored alias)
                  const replyTo   = isColdEmail ? "scott@libertybancard.com" : "accounts@libertybancard.com";
                  if (testRedirectTo && isSmtpConfigured()) {
                    const result = await sendSmtpEmail({
                      to: testRedirectTo,
                      subject: deliverySubject,
                      html: emailBody,
                      category: "cold_outreach",
                    });
                    if (!result.success) throw new Error(result.error || "SMTP redirect send failed");
                    await markSendSent({ idempotencyKey: emailIdemKey, providerMessageId: result.messageId, fromAddress: fromEmail });
                  } else {
                    const ghlResult = await sendGhlEmail({
                      contactId: enrollment.contactId,
                      subject: deliverySubject,
                      body: emailBody,
                      fromEmail,
                      fromName,
                      replyTo,
                    }) as any;
                    await markSendSent({ idempotencyKey: emailIdemKey, providerMessageId: ghlResult?.messageId, fromAddress: fromEmail });
                  }
                }
                stepExecuted = true;
              } catch (emailErr) {
                console.error(`Sequence email failed for enrollment ${enrollment.id}:`, emailErr);
                await markSendFailed({ idempotencyKey: emailIdemKey, failureReason: emailErr instanceof Error ? emailErr.message : String(emailErr) });
                // Decrement cap reservation if send failed
                if (coldCapReserved) {
                  try {
                    const { db: decDb } = await import("../db");
                    const { sql: decSql } = await import("drizzle-orm");
                    const todayDec = new Date().toISOString().slice(0, 10);
                    await decDb.execute(decSql`
                      UPDATE outbound_send_counters
                      SET count = GREATEST(0, count - 1), updated_at = now()
                      WHERE date = ${todayDec} AND channel = 'email' AND scope = 'cold_outreach'
                    `);
                  } catch (decErr) {
                    console.error(`[Sequence Worker] Cap decrement failed:`, decErr);
                  }
                }
              }
            }
            await storage.createEmailLog({
              contactId: enrollment.contactId,
              direction: "outbound",
              subject: interpolate(subjectToSend),
              body: emailBody,
              status: stepExecuted ? "sent" : "failed",
              metadata: abEnabled ? { stepId: step.id, sequenceId: sequence.id, abVariant: chosenVariant } : undefined,
            });

            if (abEnabled && stepExecuted && !currentWinner) {
              const stepLogs = await storage.getEmailLogsByStepId(step.id);
              const meta = (l: { metadata: unknown }) => l.metadata as Record<string, unknown> | null;
              const variantASent = stepLogs.filter(l => meta(l)?.abVariant === "A" && l.status === "sent").length;
              const variantBSent = stepLogs.filter(l => meta(l)?.abVariant === "B" && l.status === "sent").length;
              const aOpens = stepLogs.filter(l => meta(l)?.abVariant === "A" && l.openedAt != null).length;
              const bOpens = stepLogs.filter(l => meta(l)?.abVariant === "B" && l.openedAt != null).length;
              const aClicks = stepLogs.filter(l => meta(l)?.abVariant === "A" && l.clickedAt != null).length;
              const bClicks = stepLogs.filter(l => meta(l)?.abVariant === "B" && l.clickedAt != null).length;
              const aReplies = stepLogs.filter(l => meta(l)?.abVariant === "A" && l.repliedAt != null).length;
              const bReplies = stepLogs.filter(l => meta(l)?.abVariant === "B" && l.repliedAt != null).length;
              const totalSent = variantASent + variantBSent;
              const minSampleSize = abConfig?.minSampleSize ?? 100;
              const winnerCriteria = abConfig?.winnerCriteria ?? "open_rate";

              let winnerSelected: string | null = null;
              let winnerAt: string | null = existing.winnerAt ?? null;
              let statisticallySignificant = false;
              if (totalSent >= minSampleSize) {
                const successA = winnerCriteria === "reply_rate" ? aReplies : winnerCriteria === "click_rate" ? aClicks : aOpens;
                const successB = winnerCriteria === "reply_rate" ? bReplies : winnerCriteria === "click_rate" ? bClicks : bOpens;
                const pPooled = variantASent + variantBSent > 0 ? (successA + successB) / (variantASent + variantBSent) : 0;
                if (pPooled > 0 && pPooled < 1 && variantASent >= 5 && variantBSent >= 5) {
                  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / variantASent + 1 / variantBSent));
                  const p1 = variantASent > 0 ? successA / variantASent : 0;
                  const p2 = variantBSent > 0 ? successB / variantBSent : 0;
                  if (se > 0 && Math.abs((p1 - p2) / se) >= 1.96) {
                    statisticallySignificant = true;
                    winnerSelected = p1 >= p2 ? "A" : "B";
                    winnerAt = new Date().toISOString();
                  }
                }
              }

              await storage.updateSequenceStepAbTestResults(step.id, {
                variantASent,
                variantBSent,
                aOpens,
                bOpens,
                aClicks,
                bClicks,
                aReplies,
                bReplies,
                winnerSelected,
                winnerAt,
                startedAt: existing.startedAt ?? new Date().toISOString(),
                statisticallySignificant,
              });
            }
            break;
          }

          case "sms": {
            const abConfig = (step.abTestConfig as AbTestConfig | null);
            const abEnabled = !!(step.variantBBody);

            const existing = (step.abTestResults as Partial<AbTestResults> | null) ?? {};
            const currentWinner: string | null = existing.winnerSelected ?? null;

            let chosenVariant: "A" | "B" = "A";
            let bodyToSend = step.body;

            if (abEnabled) {
              if (currentWinner) {
                chosenVariant = currentWinner as "A" | "B";
              } else {
                const splitRatio = abConfig?.splitRatio ?? 50;
                chosenVariant = Math.random() * 100 < splitRatio ? "A" : "B";
              }
              if (chosenVariant === "B") bodyToSend = step.variantBBody ?? step.body;
            }

            // ── Per-channel pause gate (SMS) ──────────────────────────────────
            // FAIL-CLOSED: null/undefined (unset) → paused. Only explicit "false"
            // (string or boolean) releases the SMS channel.
            {
              const smsPausedRaw = await storage.getSystemSetting("smsChannelPaused");
              const smsPaused = smsPausedRaw !== "false" && smsPausedRaw !== false;
              if (smsPaused) {
                await storage.createAuditLog({
                  action: "sequence_step_skipped_channel_pause",
                  entityType: "contact", entityId: enrollment.contactId ?? 0, actorType: "system",
                  details: { enrollmentId: enrollment.id, sequenceId: sequence.id, channel: "sms", reason: "smsChannelPaused" },
                });
                await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                processed++; stepExecuted = false; break;
              }
            }

            // ── Gate (no-prospect-send): SMS test mode guard ──────────────────
            // When deliveryNoProspectSendSms is true, only allowlisted contacts
            // can receive SMS sends. Uses the email-based allowlist since phone
            // numbers are not individually listed.
            //
            // FAIL-CLOSED: guard runs unconditionally regardless of whether the
            // contact has a local phone/email record. A GHL send dispatched via
            // contactId alone bypasses local field checks — so we verify identity
            // here before any provider call.  Missing email → cannot confirm
            // allowlist membership → block (do not let GHL dispatch unverified).
            {
              const noProspectSmRaw = await storage.getSystemSetting("deliveryNoProspectSendSms");
              const noProspectSmsGuard = noProspectSmRaw === true || noProspectSmRaw === "true";
              if (noProspectSmsGuard) {
                const allowlistRaw = await storage.getSystemSetting("deliveryTestEmailAllowlist");
                const allowlist: string[] = typeof allowlistRaw === "string"
                  ? allowlistRaw.split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
                  : [];
                // Identity verified via email (authoritative field on contact record).
                // Fail closed when email is absent — we cannot confirm allowlist membership.
                const recipientEmail = (contact?.email ?? "").toLowerCase();
                const isSmsAllowed = recipientEmail.length > 0 &&
                  (allowlist.includes(recipientEmail) || recipientEmail.endsWith("@libertybancard.com"));
                if (!isSmsAllowed) {
                  await storage.createAuditLog({
                    action: "sequence_step_blocked_no_prospect_guard_sms",
                    entityType: "contact",
                    entityId: enrollment.contactId ?? 0,
                    actorType: "system",
                    details: {
                      enrollmentId: enrollment.id,
                      sequenceId: sequence.id,
                      sequenceName: sequence.name,
                      stepOrder: step.stepOrder,
                      recipientPhone: contact?.phone ?? null,
                      recipientEmail: contact?.email ?? null,
                      reason: recipientEmail
                        ? "no_prospect_send_sms guard active — contact not in allowlist"
                        : "no_prospect_send_sms guard active — contact has no email for allowlist verification (fail-closed)",
                    },
                  });
                  await storage.updateSequenceEnrollment(enrollment.id, { status: "paused" });
                  processed++;
                  stepExecuted = false;
                  break;
                }
              }
            }

            // ── Idempotency gate (SMS) ────────────────────────────────────────
            const smsIdemKey = buildIdempotencyKey(enrollment.id, step.stepOrder ?? 0);
            if (await hasSentStep(smsIdemKey)) {
              console.warn(`[Sequence Worker] SMS step already sent (idempotent skip): ${smsIdemKey}`);
              stepExecuted = true;
              break;
            }

            if (isGhlConfigured() && enrollment.contactId) {
              try {
                const ghlSmsResult = await sendGhlSms({
                  contactId: enrollment.contactId,
                  body: interpolate(bodyToSend),
                }) as any;
                await markSendSent({ idempotencyKey: smsIdemKey, providerMessageId: ghlSmsResult?.messageId, fromAddress: "ghl_sms" });
                stepExecuted = true;
              } catch (smsErr) {
                console.error(`Sequence SMS failed for enrollment ${enrollment.id}:`, smsErr);
                await markSendFailed({ idempotencyKey: smsIdemKey, failureReason: smsErr instanceof Error ? smsErr.message : String(smsErr) });
              }
            }

            await storage.createEmailLog({
              contactId: enrollment.contactId,
              direction: "outbound",
              subject: null,
              body: interpolate(bodyToSend),
              status: stepExecuted ? "sent" : "failed",
              metadata: { type: "sms", stepId: step.id, sequenceId: sequence.id, ...(abEnabled ? { abVariant: chosenVariant } : {}) },
            });

            if (abEnabled && stepExecuted && !currentWinner) {
              const stepLogs = await storage.getEmailLogsByStepId(step.id);
              const meta = (l: { metadata: unknown }) => l.metadata as Record<string, unknown> | null;
              const abLogs = stepLogs.filter(l => meta(l)?.type === "sms" && meta(l)?.abVariant);
              const variantASent = abLogs.filter(l => meta(l)?.abVariant === "A" && l.status === "sent").length;
              const variantBSent = abLogs.filter(l => meta(l)?.abVariant === "B" && l.status === "sent").length;
              const aReplies = abLogs.filter(l => meta(l)?.abVariant === "A" && l.repliedAt != null).length;
              const bReplies = abLogs.filter(l => meta(l)?.abVariant === "B" && l.repliedAt != null).length;
              const totalSent = variantASent + variantBSent;
              const minSampleSize = abConfig?.minSampleSize ?? 100;

              let winnerSelected: string | null = null;
              let winnerAt: string | null = existing.winnerAt ?? null;
              let statisticallySignificant = false;
              if (totalSent >= minSampleSize) {
                const pPooled = variantASent + variantBSent > 0 ? (aReplies + bReplies) / (variantASent + variantBSent) : 0;
                if (pPooled > 0 && pPooled < 1 && variantASent >= 5 && variantBSent >= 5) {
                  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / variantASent + 1 / variantBSent));
                  const p1 = variantASent > 0 ? aReplies / variantASent : 0;
                  const p2 = variantBSent > 0 ? bReplies / variantBSent : 0;
                  if (se > 0 && Math.abs((p1 - p2) / se) >= 1.96) {
                    statisticallySignificant = true;
                    winnerSelected = p1 >= p2 ? "A" : "B";
                    winnerAt = new Date().toISOString();
                  }
                }
              }

              await storage.updateSequenceStepAbTestResults(step.id, {
                variantASent,
                variantBSent,
                aOpens: 0,
                bOpens: 0,
                aClicks: 0,
                bClicks: 0,
                aReplies,
                bReplies,
                winnerSelected,
                winnerAt,
                startedAt: existing.startedAt ?? new Date().toISOString(),
                statisticallySignificant,
              });
            }
            break;
          }

          case "call_reminder": {
            await storage.createTask({
              title: `Call Reminder — ${firstName} ${lastName}`,
              description: `Sequence "${sequence.name}" Step ${step.stepOrder}: Manual call reminder.\n${step.body ?? ""}`,
              assignedTo: sequence.createdBy || "Unassigned",
              priority: "medium",
              dueDate: new Date(Date.now() + 24 * 3600000),
              contactId: enrollment.contactId || undefined,
              dealId: enrollment.dealId || undefined,
            });
            stepExecuted = true;
            break;
          }

          case "call": {
            const rawCallConfig = step.config
              ? (typeof step.config === "string" ? JSON.parse(step.config) : step.config)
              : null;
            const callConfig = rawCallConfig as {
              callMode?: VoiceBotMode;
              scriptType?: string;
              voicemailScript?: string;
              opening?: string;
              close?: string;
            } | null;
            const orchestratorEnabled = process.env.ORCHESTRATOR_ENABLED !== "false";

            if (!orchestratorEnabled) {
              await storage.createAuditLog({
                action: "call_step_skipped",
                entityType: "contact",
                entityId: enrollment.contactId || 0,
                details: {
                  reason: "ORCHESTRATOR_ENABLED=false — voice dispatch disabled",
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  scriptType: callConfig?.scriptType ?? null,
                },
              });
              stepExecuted = true;
              break;
            }

            if (enrollment.contactId) {
              try {
                const { triggerAiCall, VOICE_BOT_MODES } = await import("./sdr/voice-orchestrator");
                const rawCallMode = callConfig?.callMode;
                const callMode: VoiceBotMode = rawCallMode && (VOICE_BOT_MODES as readonly string[]).includes(rawCallMode)
                  ? (rawCallMode as VoiceBotMode)
                  : "intro_qualification";
                if (rawCallMode && rawCallMode !== callMode) {
                  console.warn(`[Sequence Worker] Unsupported callMode "${rawCallMode}" — falling back to intro_qualification`);
                }
                const contact = await storage.getContact(enrollment.contactId);
                if (contact?.ghlContactId) {
                  const { db } = await import("../db");
                  const { sdrMerchants } = await import("@shared/schema");
                  const { eq } = await import("drizzle-orm");
                  const [merchant] = await db
                    .select()
                    .from(sdrMerchants)
                    .where(eq(sdrMerchants.ghlContactId, contact.ghlContactId));
                  if (merchant) {
                    const result = await triggerAiCall(merchant.id, callMode);
                    if (result.success || result.scheduled) {
                      stepExecuted = true;
                    } else {
                      console.warn(`[Sequence Worker] Voice call skipped for enrollment ${enrollment.id}: ${result.reason}`);
                    }
                  }
                }
              } catch (callErr) {
                const msg = callErr instanceof Error ? callErr.message : String(callErr);
                console.error(`[Sequence Worker] Voice call failed for enrollment ${enrollment.id}: ${msg}`);
              }
            }

            if (!stepExecuted) {
              await storage.createAuditLog({
                action: "call_step_skipped",
                entityType: "contact",
                entityId: enrollment.contactId || 0,
                details: {
                  reason: "No linked merchant found for voice dispatch",
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                  scriptType: callConfig?.scriptType ?? null,
                },
              });
              stepExecuted = true;
            }
            break;
          }

          case "voicemail_drop": {
            const vmOrchestratorEnabled = process.env.ORCHESTRATOR_ENABLED !== "false";
            if (!vmOrchestratorEnabled) {
              await storage.createAuditLog({
                action: "voicemail_drop_skipped",
                entityType: "contact",
                entityId: enrollment.contactId || 0,
                details: {
                  reason: "ORCHESTRATOR_ENABLED=false — voicemail drop skipped",
                  sequenceName: sequence.name,
                  stepOrder: step.stepOrder,
                },
              });
              stepExecuted = true;
              break;
            }

            type VmConfig = { voicemailScript?: string; ghlNote?: string };
            const rawVmConfig = step.config;
            const vmConfig: VmConfig | null = rawVmConfig == null
              ? null
              : typeof rawVmConfig === "string"
                ? (JSON.parse(rawVmConfig) as VmConfig)
                : (rawVmConfig as VmConfig);
            const vmScript = interpolate(vmConfig?.voicemailScript ?? "");
            const ghlNote = vmConfig?.ghlNote ?? "";

            await storage.createAuditLog({
              action: "voicemail_drop_logged",
              entityType: "contact",
              entityId: enrollment.contactId || 0,
              details: {
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                stepOrder: step.stepOrder,
                voicemailScript: vmScript,
                ghlSetupNote: ghlNote,
              },
            });

            if (enrollment.contactId && vmScript) {
              try {
                await storage.createTask({
                  title: `Voicemail Drop — ${firstName} ${lastName}`,
                  description: `GHL Voicemail Drop for sequence "${sequence.name}" Step ${step.stepOrder}.\n\nScript (record and upload to GHL Voicemail Drops library):\n${vmScript}\n\n${ghlNote}\n\nInstruction: In GHL workflow, add a Voicemail Drop action node and select the pre-recorded audio for this script. Tag 'vm-drop-pending' on the contact signals it is ready to trigger.`,
                  assignedTo: sequence.createdBy || "Unassigned",
                  priority: "medium",
                  dueDate: new Date(Date.now() + 60000),
                  contactId: enrollment.contactId,
                  dealId: enrollment.dealId || undefined,
                });
              } catch (taskErr) {
                console.warn(`[Sequence Worker] Voicemail drop task creation failed:`, taskErr);
              }
              try {
                await storage.createNote({
                  entityType: "contact",
                  entityId: enrollment.contactId,
                  content: `Voicemail Drop: ${vmScript}`,
                  authorName: "Liberty Bancard SDR",
                });
              } catch (noteErr) {
                console.warn(`[Sequence Worker] Voicemail drop local note creation failed:`, noteErr);
              }

              if (isSdrGhlConfigured() && contact?.ghlContactId) {
                const scriptPreview = vmScript.length > 120 ? vmScript.slice(0, 117) + "..." : vmScript;
                try {
                  await ghlAddTag({ contactId: contact.ghlContactId, tags: ["vm-drop-pending"] });
                } catch (tagErr) {
                  console.warn(`[Sequence Worker] GHL tag 'vm-drop-pending' failed:`, tagErr);
                }
                try {
                  await ghlAddNote({
                    contactId: contact.ghlContactId,
                    body: `voicemail_drop_pending: ${scriptPreview}`,
                  });
                } catch (noteErr) {
                  console.warn(`[Sequence Worker] GHL voicemail note failed:`, noteErr);
                }
                try {
                  const vmWorkflowId = await getWorkflowEnvValue("GHL_WORKFLOW_VOICEMAIL_DROP");
                  if (vmWorkflowId) {
                    await ghlTriggerWorkflow({
                      workflowId: vmWorkflowId,
                      contactId: contact.ghlContactId,
                      metadata: {
                        sequenceId: sequence.id,
                        sequenceName: sequence.name,
                        stepOrder: step.stepOrder,
                        scriptPreview,
                      },
                    });
                    console.log(`[Sequence Worker] GHL_WORKFLOW_VOICEMAIL_DROP triggered for contact ${contact.ghlContactId}`);
                  }
                } catch (wfErr) {
                  console.warn(`[Sequence Worker] GHL_WORKFLOW_VOICEMAIL_DROP trigger failed:`, wfErr);
                }
              }
            }
            stepExecuted = true;
            break;
          }

          case "task": {
            // Creates a CRM task only — does NOT place a call, invoke AI voice,
            // trigger autodialing, or send an RVM.  Gate (b) above ensures this
            // path is only reached when evaluateContactability("manual_call") passes.
            await storage.createTask({
              title: interpolate(step.subject) || `Follow-up task from sequence`,
              description: `Auto-created by sequence "${sequence.name}" - Step ${step.stepOrder}`,
              assignedTo: sequence.createdBy || "Unassigned",
              priority: "medium",
              dueDate: new Date(Date.now() + 24 * 3600000),
              contactId: enrollment.contactId || undefined,
              dealId: enrollment.dealId || undefined,
            });
            stepExecuted = true;
            break;
          }

          case "wait": {
            stepExecuted = true;
            break;
          }

          default:
            stepExecuted = true;
            break;
        }

        if (stepExecuted) {
          import("./analytics-events").then(({ recordAnalyticsEvent }) => {
            recordAnalyticsEvent({
              eventName: "sequence_step_sent",
              contactId: enrollment.contactId ?? undefined,
              sequenceId: sequence.id,
              channel: step.actionType,
              metadata: { stepOrder: step.stepOrder, actionType: step.actionType, sequenceName: sequence.name },
            });
          }).catch(() => {});

          const nextStepIndex = currentStep + 1;
          const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
          const nextStep = sortedSteps[nextStepIndex];

          if (!nextStep) {
            await storage.updateSequenceEnrollment(enrollment.id, {
              currentStep: nextStepIndex,
              status: "completed",
              completedAt: new Date(),
            });
            await storage.createAuditLog({
              action: "sequence_completed",
              entityType: "contact",
              entityId: enrollment.contactId || 0,
              details: { sequenceId: sequence.id, sequenceName: sequence.name },
            });
            await createPreferenceAwareNotification({ channel: "internal", title: "Sequence Completed", message: `Sequence "${sequence.name}" completed for contact #${enrollment.contactId || 0}.`, type: "info", metadata: { sequenceId: sequence.id, contactId: enrollment.contactId, eventType: "sequence_completed" } }, "sequence_completed");
          } else {
            const delayMs = ((nextStep.delayDays || 0) * 86400000) + ((nextStep.delayHours || 0) * 3600000);
            const nextActionAt = new Date(Date.now() + Math.max(delayMs, 60000));

            await storage.updateSequenceEnrollment(enrollment.id, {
              currentStep: nextStepIndex,
              nextActionAt,
            });
          }

          await storage.createAuditLog({
            action: "sequence_step_executed",
            entityType: "contact",
            entityId: enrollment.contactId || 0,
            details: {
              sequenceId: sequence.id,
              sequenceName: sequence.name,
              stepOrder: step.stepOrder,
              actionType: step.actionType,
              subject: step.subject || "",
            },
          });

          processed++;
        }
      } catch (enrollErr) {
        console.error(`Error processing enrollment ${enrollment.id}:`, enrollErr);
        errors++;
        try {
          await storage.updateSequenceEnrollment(enrollment.id, {
            status: "paused",
          });
        } catch (_) {}
      }
    }
    await releaseJobLock(JOB_NAMES.SEQUENCE_WORKER, true);
  } catch (err: any) {
    console.error("Sequence worker error:", err);
    await releaseJobLock(JOB_NAMES.SEQUENCE_WORKER, false, err?.message ?? String(err));
  }

  if (processed > 0 || errors > 0) {
    console.log(`Sequence worker: ${processed} processed, ${errors} errors`);
  }

  return { processed, errors };
}

export async function autoEnrollFromTrigger(triggerType: string, data: {
  contactId?: number;
  dealId?: number;
  formType?: string;
}, opts?: {
  preEvaluated?: {
    contactabilityByChannel: Partial<Record<string, import("./contactability").ContactabilityResult>>;
  };
}): Promise<{ count: number; enrollmentIds: number[]; alreadyEnrolledCount: number }> {
  let enrolled = 0;
  let alreadyEnrolledCount = 0;
  const enrollmentIds: number[] = [];

  try {
    const allSequences = await storage.getFollowUpSequences();
    const activeSequences = allSequences.filter(
      s => s.status === "active" && s.triggerType === triggerType
    );

    for (const seq of activeSequences) {
      const triggerConfig = (seq.triggerConfig as any) || {};

      if (triggerType === "form_submitted" && triggerConfig.formType && triggerConfig.formType !== data.formType) {
        continue;
      }

      if (triggerType === "deal_stage_changed" && triggerConfig.toStage && triggerConfig.toStage !== (data as any).toStage) {
        continue;
      }

      if (triggerType === "deal_stage_changed" && triggerConfig.pipeline && triggerConfig.pipeline !== (data as any).pipeline) {
        continue;
      }

      if (!data.contactId) continue;

      const existing = await storage.getContactEnrollments(data.contactId);
      const alreadyInSequence = existing.some(
        e => e.sequenceId === seq.id && (e.status === "active" || e.status === "completed")
      );
      if (alreadyInSequence) {
        alreadyEnrolledCount++;
        continue;
      }

      const steps = await storage.getSequenceSteps(seq.id);

      // Pre-enrollment contactability gate — mirrors the same channel-resolution logic used
      // by Gate (b) in processSequenceEnrollments so both gates use identical channel mapping.
      {
        type AutomatedActionChannel = "email" | "sms" | "voice_ai" | "ringless_vm" | "manual_call";
        const automatedChannelMap: Record<string, AutomatedActionChannel> = {
          email: "email",
          sms: "sms",
          call: "voice_ai",
          voicemail_drop: "ringless_vm",
          // task steps create a CRM task only — gated via manual_call to block DNC contacts
          task: "manual_call",
        };

        // Resolve the FULL set of outbound channels this sequence could execute.
        // Strategy: always take the UNION of step-derived channels AND any declared
        // outboundChannels — never let a narrower declaration hide channels that steps
        // will actually try to execute (which Gate (b) checks per step.actionType).
        //
        // Step-derived: map each step.actionType → channel, same as Gate (b).
        const stepChannels = new Set<AutomatedActionChannel>();
        for (const step of steps) {
          const ch = automatedChannelMap[step.actionType];
          if (ch) stepChannels.add(ch);
        }

        // Declared: triggerConfig.outboundChannels (used by enrollContactInGhlWorkflow path)
        const declaredChannels = new Set<AutomatedActionChannel>();
        if (
          Array.isArray(triggerConfig.outboundChannels) &&
          (triggerConfig.outboundChannels as string[]).length > 0
        ) {
          for (const c of triggerConfig.outboundChannels as string[]) {
            if (["email", "sms", "voice_ai", "ringless_vm", "manual_call"].includes(c)) {
              declaredChannels.add(c as AutomatedActionChannel);
            }
          }
        }

        // Channel set for enrollment gate.
        //
        // When outboundChannels is explicitly declared in triggerConfig, use it as
        // the sole authority.  The per-step gates (SMS skip + Gate b) handle
        // compliance for channels not listed here — so setting ["email"] allows cold
        // contacts to enroll in mixed email+SMS sequences while SMS steps are skipped
        // until PEWC consent is obtained.
        //
        // When outboundChannels is NOT declared (legacy sequences), fall back to the
        // step-derived channel set so existing behaviour is preserved.  If neither
        // source produces any channels, fail-closed to all automated channels.
        let channelSet: Set<AutomatedActionChannel>;
        if (declaredChannels.size > 0) {
          // Explicit declaration wins — do NOT union with step-derived channels.
          channelSet = declaredChannels;
        } else if (stepChannels.size > 0) {
          channelSet = stepChannels;
        } else {
          // Fail-closed: no channels declared or derivable → require all automated channels
          channelSet = new Set(["email", "sms", "voice_ai", "ringless_vm"] as AutomatedActionChannel[]);
        }

        const { evaluateContactability } = await import("./contactability");
        let enrollmentBlocked = false;
        let blockedChannel: string | undefined;
        let blockReason: string | undefined;
        let blockConsentTier: string | undefined;
        let blockLifecycleStage: string | undefined;

        for (const channel of channelSet) {
          let check: import("./contactability").ContactabilityResult | undefined;

          if (opts?.preEvaluated?.contactabilityByChannel) {
            check = opts.preEvaluated.contactabilityByChannel[channel];
          }

          if (!check) {
            check = await evaluateContactability({
              contactId: data.contactId,
              channel,
              campaignType: "auto_enrollment",
              mode: "enforcement",
            });
          }

          if (!check.allowed) {
            enrollmentBlocked = true;
            blockedChannel = channel;
            blockReason = check.reason;
            blockConsentTier = check.consentTier;
            blockLifecycleStage = check.lifecycleStage;
            break;
          }
        }

        if (enrollmentBlocked) {
          await storage.createAuditLog({
            action: "auto_enrollment_blocked_contactability",
            entityType: "contact",
            entityId: data.contactId,
            actorType: "system",
            details: {
              sequenceId: seq.id,
              sequenceName: seq.name,
              triggerType,
              blockedChannel,
              reason: blockReason,
              consentTier: blockConsentTier,
              lifecycleStage: blockLifecycleStage,
            },
          });
          continue;
        }
      }

      const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
      const delayMs = firstStep
        ? ((firstStep.delayDays || 0) * 86400000) + ((firstStep.delayHours || 0) * 3600000)
        : 0;

      const newEnrollment = await storage.createSequenceEnrollment({
        sequenceId: seq.id,
        contactId: data.contactId,
        dealId: data.dealId || undefined,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date(Date.now() + Math.max(delayMs, 1000)),
      });

      if (newEnrollment?.id) {
        enrollmentIds.push(newEnrollment.id);
      }

      await storage.createAuditLog({
        action: "sequence_auto_enrolled",
        entityType: "contact",
        entityId: data.contactId,
        details: {
          sequenceId: seq.id,
          sequenceName: seq.name,
          trigger: triggerType,
        },
      });

      enrolled++;
    }
  } catch (err) {
    console.error("Auto-enrollment error:", err);
  }

  return { count: enrolled, enrollmentIds, alreadyEnrolledCount };
}
