import { storage } from "../storage";
import { sendGhlEmail, sendGhlSms, isGhlConfigured } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";

export async function processSequenceEnrollments(): Promise<{ processed: number; errors: number }> {
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
          processed++;
          continue;
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
            .replace(/\{\{recommendedTerminal\}\}/g, recommendedTerminal);
        };

        let stepExecuted = false;

        switch (step.actionType) {
          case "email": {
            const emailBody = interpolate(step.body) + getEmailSignatureHtml("sales");
            if (isGhlConfigured() && enrollment.contactId) {
              try {
                await sendGhlEmail({
                  contactId: enrollment.contactId,
                  subject: interpolate(step.subject),
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
              subject: interpolate(step.subject),
              body: emailBody,
              status: stepExecuted ? "sent" : "queued",
            });
            stepExecuted = true;
            break;
          }

          case "sms": {
            if (isGhlConfigured() && enrollment.contactId) {
              try {
                await sendGhlSms({
                  contactId: enrollment.contactId,
                  body: interpolate(step.body),
                });
                stepExecuted = true;
              } catch (smsErr) {
                console.error(`Sequence SMS failed for enrollment ${enrollment.id}:`, smsErr);
              }
            }
            stepExecuted = true;
            break;
          }

          case "call_reminder": {
            await storage.createTask({
              title: interpolate(step.subject) || `Call ${firstName} ${lastName}`,
              description: `Sequence "${sequence.name}" - Step ${step.stepOrder}: Call reminder`,
              assignedTo: sequence.createdBy || "Unassigned",
              priority: "high",
              dueDate: new Date(Date.now() + 4 * 3600000),
              contactId: enrollment.contactId || undefined,
              dealId: enrollment.dealId || undefined,
            });
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
  } catch (err) {
    console.error("Sequence worker error:", err);
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
