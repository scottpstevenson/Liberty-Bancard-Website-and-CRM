import { isGhlConfigured } from "./ghl";
import { syncContactToGhl, syncDealToGhl } from "./ghl-sync";
import { triggerWorkflow, updateCustomFields, addTag, addNote, isSdrGhlConfigured } from "./sdr/ghl-client";
import { storage } from "../storage";

export type LeadSourceType =
  | "free_analysis"
  | "get_started"
  | "statement_upload"
  | "merchant_application"
  | "support"
  | "affiliate"
  | "cost_quiz"
  | "estimate"
  | "callback"
  | "equipment_order";

export interface FormSyncParams {
  contactId: number;
  dealId?: number;
  leadSource: LeadSourceType;
  formData?: Record<string, string | boolean | number | undefined>;
  skipWorkflowTrigger?: boolean;
}

function isGhlReady(): boolean {
  return isGhlConfigured() || isSdrGhlConfigured();
}

export async function syncFormSubmissionToGhl(params: FormSyncParams): Promise<{
  success: boolean;
  ghlContactId?: string;
  error?: string;
}> {
  try {
    if (!isGhlReady()) {
      console.warn(`[GHL Form Sync] GHL not configured — skipping sync for ${params.leadSource}`);
      return { success: false, error: "GHL not configured" };
    }

    const contact = await storage.getContact(params.contactId);
    if (!contact) return { success: false, error: "Contact not found" };

    const syncResult = await syncContactToGhl(params.contactId);
    if (!syncResult.success) {
      console.warn(`[GHL Form Sync] Contact sync failed for ${params.contactId}: ${syncResult.error}`);
      return { success: false, error: syncResult.error };
    }

    const ghlContactId = syncResult.ghlContactId || contact.ghlContactId;
    if (!ghlContactId) {
      return { success: false, error: "No GHL contact ID returned" };
    }

    const customFields: Record<string, string> = {};

    customFields["lb_lead_source"] = params.leadSource;

    if (contact.vertical) customFields["lb_vertical"] = contact.vertical;
    if (contact.monthlyVolume) customFields["lb_monthly_volume"] = contact.monthlyVolume;
    if (contact.currentProvider) customFields["lb_current_processor"] = contact.currentProvider;
    if (contact.primaryOfferPath) customFields["lb_preferred_program"] = contact.primaryOfferPath;
    if (contact.utmSource) customFields["lb_utm_source"] = contact.utmSource;
    if (contact.utmMedium) customFields["lb_utm_medium"] = contact.utmMedium;
    if (contact.utmCampaign) customFields["lb_utm_campaign"] = contact.utmCampaign;
    if (contact.promoCode) customFields["lb_promo_code"] = contact.promoCode;
    if (contact.landingPage) customFields["lb_landing_page"] = contact.landingPage;
    if (contact.estimatedResidual) customFields["lb_estimated_savings"] = contact.estimatedResidual;

    customFields["lb_consent_sms"] = contact.consentSms ? "yes" : "no";
    customFields["lb_consent_email"] = (contact as any).consentEmail ? "yes" : "no";

    if (contact.interestedIn0Percent) customFields["lb_interested_0_percent"] = "yes";
    if (contact.needTerminal) customFields["lb_terminal_need"] = "yes";

    if (contact.painPoints && Array.isArray(contact.painPoints) && contact.painPoints.length > 0) {
      customFields["lb_pain_points"] = contact.painPoints.join(", ");
    }

    if (params.formData) {
      for (const [key, value] of Object.entries(params.formData)) {
        if (value !== undefined && value !== null && value !== "") {
          customFields[key] = String(value);
        }
      }
    }

    if (Object.keys(customFields).length > 0) {
      try {
        await updateCustomFields(ghlContactId, customFields);
      } catch (cfErr) {
        console.error(`[GHL Form Sync] Custom field update failed for contact ${params.contactId}:`, cfErr);
      }
    }

    const sourceTag = getSourceTag(params.leadSource);
    if (sourceTag) {
      try {
        await addTag({ contactId: ghlContactId, tags: [sourceTag] });
      } catch (tagErr) {
        console.error(`[GHL Form Sync] Tag add failed:`, tagErr);
      }
    }

    if (!contact.consentSms) {
      try {
        await setGhlDnd(ghlContactId, "sms", true);
      } catch (dndErr) {
        console.error(`[GHL Form Sync] DND SMS set failed:`, dndErr);
      }
    }

    if (params.dealId) {
      syncDealToGhl(params.dealId).catch(err => {
        console.error(`[GHL Form Sync] Deal sync failed for deal ${params.dealId}:`, err);
      });
    }

    if (!params.skipWorkflowTrigger) {
      const workflowId = getInboundWorkflowId(params.leadSource);
      if (workflowId) {
        try {
          await triggerWorkflow({
            workflowId,
            contactId: ghlContactId,
            metadata: {
              leadSource: params.leadSource,
              contactId: params.contactId,
              dealId: params.dealId,
            },
          });
        } catch (wfErr) {
          console.error(`[GHL Form Sync] Workflow trigger failed:`, wfErr);
        }
      }
    }

    console.log(`[GHL Form Sync] Synced ${params.leadSource} form for contact ${params.contactId} → GHL ${ghlContactId}`);
    return { success: true, ghlContactId };
  } catch (err: any) {
    console.error(`[GHL Form Sync] Error syncing form submission:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncMerchantApplicationToGhl(applicationId: number, contactId: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlReady()) return { success: false, error: "GHL not configured" };

    const application = await storage.getMerchantApplication(applicationId);
    if (!application) return { success: false, error: "Application not found" };

    const contact = await storage.getContact(contactId);
    if (!contact) return { success: false, error: "Contact not found" };

    const syncResult = await syncContactToGhl(contactId);
    const ghlContactId = syncResult.ghlContactId || contact.ghlContactId;
    if (!ghlContactId) return { success: false, error: "No GHL contact" };

    const appFields: Record<string, string> = {
      lb_lead_source: "merchant_application",
      lb_business_type: application.businessType || "",
      lb_vertical: application.vertical || "",
    };

    if (application.estimatedMonthlyVolume) appFields["lb_monthly_volume"] = String(application.estimatedMonthlyVolume);
    if (application.avgTicket) appFields["lb_avg_ticket"] = String(application.avgTicket);
    if (application.currentProcessor) appFields["lb_current_processor"] = application.currentProcessor;
    if (application.currentRate) appFields["lb_current_processor"] += ` (${application.currentRate}%)`;
    if (application.preferredProgram) appFields["lb_preferred_program"] = application.preferredProgram;
    if (application.terminalNeeded) appFields["lb_terminal_need"] = "yes";
    if (application.terminalType) appFields["lb_terminal_need"] = application.terminalType;

    await updateCustomFields(ghlContactId, appFields);

    await addTag({ contactId: ghlContactId, tags: ["LB-MERCHANT-APP"] });

    console.log(`[GHL Form Sync] Merchant application ${applicationId} synced to GHL contact ${ghlContactId}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Form Sync] Merchant app sync error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncStatementUploadToGhl(contactId: number, fileName: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlReady()) return { success: false, error: "GHL not configured" };

    const contact = await storage.getContact(contactId);
    let ghlContactId = contact?.ghlContactId;

    if (!ghlContactId) {
      const syncResult = await syncContactToGhl(contactId);
      ghlContactId = syncResult.ghlContactId;
    }

    if (!ghlContactId) return { success: false, error: "No GHL contact" };

    await updateCustomFields(ghlContactId, {
      lb_statement_status: "received",
    });

    await addTag({ contactId: ghlContactId, tags: ["LB-STATEMENT-RECEIVED"] });

    await addNote({
      contactId: ghlContactId,
      body: `Processing statement uploaded: ${fileName}. Review pending.`,
    });

    const workflowId = process.env.GHL_WORKFLOW_STATEMENT_REVIEW;
    if (workflowId) {
      await triggerWorkflow({
        workflowId,
        contactId: ghlContactId,
        metadata: { fileName, contactId },
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Form Sync] Statement upload sync error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function syncSupportTicketToGhl(contactId: number, ticketId: number, issueType: string, description: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGhlReady()) return { success: false, error: "GHL not configured" };

    const contact = await storage.getContact(contactId);
    let ghlContactId = contact?.ghlContactId;

    if (!ghlContactId) {
      const syncResult = await syncContactToGhl(contactId);
      ghlContactId = syncResult.ghlContactId;
    }

    if (!ghlContactId) return { success: false, error: "No GHL contact" };

    await addTag({ contactId: ghlContactId, tags: ["LB-SUPPORT"] });

    await addNote({
      contactId: ghlContactId,
      body: `Support ticket #${ticketId} created.\nIssue: ${issueType}\n${description}`,
    });

    const workflowId = process.env.GHL_WORKFLOW_SUPPORT_TICKET;
    if (workflowId) {
      await triggerWorkflow({
        workflowId,
        contactId: ghlContactId,
        metadata: { ticketId, issueType },
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error(`[GHL Form Sync] Support ticket sync error:`, err.message);
    return { success: false, error: err.message };
  }
}

function getSourceTag(source: LeadSourceType): string | null {
  const tagMap: Record<LeadSourceType, string> = {
    free_analysis: "LB-QUIZ-LEAD",
    get_started: "LB-QUIZ-LEAD",
    statement_upload: "LB-STATEMENT-RECEIVED",
    merchant_application: "LB-MERCHANT-APP",
    support: "LB-SUPPORT",
    affiliate: "LB-AFFILIATE",
    cost_quiz: "LB-QUIZ-LEAD",
    estimate: "LB-ESTIMATE",
    callback: "LB-CALLBACK",
    equipment_order: "LB-EQUIPMENT-ORDER",
  };
  return tagMap[source] || null;
}

function getInboundWorkflowId(source: LeadSourceType): string | null {
  const envMap: Record<string, string | undefined> = {
    free_analysis: process.env.GHL_WORKFLOW_INBOUND_LEAD,
    get_started: process.env.GHL_WORKFLOW_INBOUND_LEAD,
    statement_upload: process.env.GHL_WORKFLOW_STATEMENT_REVIEW,
    merchant_application: process.env.GHL_WORKFLOW_MERCHANT_APP,
    support: process.env.GHL_WORKFLOW_SUPPORT_TICKET,
    affiliate: process.env.GHL_WORKFLOW_AFFILIATE_WELCOME,
    estimate: process.env.GHL_WORKFLOW_INBOUND_LEAD,
    callback: process.env.GHL_WORKFLOW_CALLBACK,
    equipment_order: process.env.GHL_WORKFLOW_EQUIPMENT_ORDER,
    cost_quiz: process.env.GHL_WORKFLOW_INBOUND_LEAD,
  };
  return envMap[source] || null;
}

async function setGhlDnd(ghlContactId: string, channel: "sms" | "email", dndActive: boolean): Promise<void> {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  if (!apiKey) return;

  const dndPayload: Record<string, any> = {
    dnd: true,
    dndSettings: {
      [channel === "sms" ? "SMS" : "Email"]: {
        status: dndActive ? "active" : "inactive",
      },
    },
  };

  try {
    const response = await fetch(`https://services.leadconnectorhq.com/contacts/${ghlContactId}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Version": "2021-07-28",
      },
      body: JSON.stringify(dndPayload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[GHL DND] Failed to set ${channel} DND for ${ghlContactId}: ${response.status} ${errText}`);
    }
  } catch (err) {
    console.error(`[GHL DND] Error setting ${channel} DND:`, err);
  }
}
