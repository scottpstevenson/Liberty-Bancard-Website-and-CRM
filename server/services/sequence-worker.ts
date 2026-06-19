import { storage } from "../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";
import { createPreferenceAwareNotification } from "./digest-service";
import { enrollContactInGhlWorkflow, tagContactForInboxOrganization } from "./ghl-workflow-enrollment";
import type { VoiceBotMode } from "./sdr/voice-orchestrator";
import type { AbTestConfig, AbTestResults } from "@shared/schema";

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
          const triggerConfig = (sequence.triggerConfig as any) || {};
          const enrollResult = await enrollContactInGhlWorkflow({
            contactId: enrollment.contactId,
            sequenceName: sequence.name,
            sequenceId: sequence.id,
            vertical: triggerConfig.vertical,
            dealId: enrollment.dealId || undefined,
          });

          if (enrollResult.enrolled && enrollResult.method === "ghl_workflow") {
            await storage.updateSequenceEnrollment(enrollment.id, {
              status: "completed",
              completedAt: new Date(),
            });
            await storage.createAuditLog({
              action: "sequence_delegated_to_ghl",
              entityType: "contact",
              entityId: enrollment.contactId,
              details: {
                sequenceId: sequence.id,
                sequenceName: sequence.name,
                ghlWorkflowId: enrollResult.ghlWorkflowId,
                method: enrollResult.method,
              },
            });
            await createPreferenceAwareNotification({
              channel: "internal",
              title: "Sequence Delegated to GHL",
              message: `Sequence "${sequence.name}" for contact #${enrollment.contactId} delegated to GHL workflow.`,
              type: "info",
              metadata: { sequenceId: sequence.id, contactId: enrollment.contactId, eventType: "sequence_delegated_ghl" },
            }, "sequence_delegated_ghl");
            processed++;
            continue;
          }

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

        let contact: any = null;
        if (enrollment.contactId) {
          contact = await storage.getContact(enrollment.contactId);
          // Bounce guard: skip email steps for bounced/invalid contacts
          if (contact && (contact.emailStatus === "bounced" || contact.emailStatus === "invalid")) {
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
        }

        let deal: any = null;
        if (enrollment.dealId) {
          deal = await storage.getDeal(enrollment.dealId);
        }

        const firstName = contact?.firstName || "there";
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
        if (contact?.agentId) {
          try {
            const assignedAgent = await storage.getAgent(contact.agentId);
            if (assignedAgent) {
              const fullName = [assignedAgent.firstName, assignedAgent.lastName].filter(Boolean).join(" ");
              if (fullName) agentName = fullName;
            }
          } catch {
            // fallback to default
          }
        }

        const interpolate = (text: string | null | undefined): string => {
          if (!text) return "";
          return text
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
            .replace(/\{\{agentName\}\}/g, agentName);
        };

        let stepExecuted = false;

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

            const emailBody = interpolate(bodyToSend) + getEmailSignatureHtml("sales");
            if (isGhlConfigured() && enrollment.contactId) {
              try {
                await sendGhlEmail({
                  contactId: enrollment.contactId,
                  subject: interpolate(subjectToSend),
                  body: emailBody,
                });
                stepExecuted = true;
              } catch (emailErr) {
                console.error(`Sequence email failed for enrollment ${enrollment.id}:`, emailErr);
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

            if (isGhlConfigured() && enrollment.contactId) {
              try {
                await sendGhlSms({
                  contactId: enrollment.contactId,
                  body: interpolate(bodyToSend),
                });
                stepExecuted = true;
              } catch (smsErr) {
                console.error(`Sequence SMS failed for enrollment ${enrollment.id}:`, smsErr);
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
                  description: `GHL Voicemail Drop for sequence "${sequence.name}" Step ${step.stepOrder}.\n\nScript (record and upload to GHL Voicemail Drops library):\n${vmScript}\n\n${ghlNote}`,
                  assignedTo: sequence.createdBy || "Unassigned",
                  priority: "medium",
                  dueDate: new Date(Date.now() + 60000),
                  contactId: enrollment.contactId,
                  dealId: enrollment.dealId || undefined,
                });
              } catch (noteErr) {
                console.warn(`[Sequence Worker] Voicemail drop task creation failed:`, noteErr);
              }
              try {
                await storage.createNote({
                  entityType: "contact",
                  entityId: enrollment.contactId,
                  content: `Voicemail Drop: ${vmScript}`,
                  authorName: "Liberty Bancard SDR",
                });
              } catch (noteErr) {
                console.warn(`[Sequence Worker] Voicemail drop note creation failed:`, noteErr);
              }
            }
            stepExecuted = true;
            break;
          }

          case "task": {
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
}): Promise<number> {
  let enrolled = 0;

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
      if (alreadyInSequence) continue;

      const steps = await storage.getSequenceSteps(seq.id);
      const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
      const delayMs = firstStep
        ? ((firstStep.delayDays || 0) * 86400000) + ((firstStep.delayHours || 0) * 3600000)
        : 0;

      await storage.createSequenceEnrollment({
        sequenceId: seq.id,
        contactId: data.contactId,
        dealId: data.dealId || undefined,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date(Date.now() + Math.max(delayMs, 1000)),
      });

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

  return enrolled;
}
