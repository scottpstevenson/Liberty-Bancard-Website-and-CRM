import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, equipmentOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { sendGhlEmail, isGhlConfigured } from "../ghl";
import { selectBestInbox, recordSend, rollbackSend } from "./inbox-rotation";

export async function createEquipmentOrderForLead(leadId: number): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;

    const firstName = lead.ownerName?.split(" ")[0] || "there";
    const companyName = lead.companyName || "your business";

    let terminalType = "Clover Flex 3";
    if (lead.vertical) {
      const v = lead.vertical.toLowerCase();
      if (/restaurant|food|cafe/i.test(v)) terminalType = "Clover Station Duo";
      else if (/auto|automotive/i.test(v)) terminalType = "Dejavoo QD4";
      else if (/med.?spa|salon|beauty/i.test(v)) terminalType = "Clover Mini 3";
      else if (/dental|medical|healthcare/i.test(v)) terminalType = "Clover Flex 3";
    }

    const [order] = await db.insert(equipmentOrders).values({
      dealId: lead.dealId || undefined,
      contactId: lead.contactId || undefined,
      equipmentType: terminalType,
      quantity: 1,
      status: "ordered",
      orderedAt: new Date(),
      notes: `Auto-created from SDR pipeline for ${companyName} (lead ${leadId})`,
    }).returning();

    await db.update(sdrLeadState).set({
      stage: "BOARDED",
      nextActionType: "await_terminal_ship",
      nextActionAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      decisionReason: `Equipment order created: ${terminalType}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "equipment_ordered",
      fromStage: "CLOSED_WON",
      toStage: "BOARDED",
      actionType: "create_equipment_order",
      decisionReason: `Terminal ordered: ${terminalType}`,
      metadata: { orderId: order?.id, equipmentType: terminalType },
    });

    await storage.createNotification({
      channel: "internal",
      title: "Equipment Order Created",
      message: `Terminal (${terminalType}) ordered for ${companyName}. Deal auto-advanced to BOARDED.`,
      type: "info",
      metadata: { leadId, orderId: order?.id, equipmentType: terminalType },
    });

    if (isGhlConfigured() && lead.contactId) {
      const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
      if (selectedInbox) {
        const welcomeSubject = `Welcome to Liberty Bancard, ${firstName}!`;
        const welcomeBody = `Hi ${firstName},\n\nWelcome to Liberty Bancard! We're thrilled to have ${companyName} on board.\n\nHere's what happens next:\n\n1. Your ${terminalType} terminal has been ordered and will ship within 2-3 business days\n2. You'll receive tracking information via email once shipped\n3. Our team will reach out to schedule your setup and training session\n4. You'll be processing within days of receiving your terminal\n\nIf you have any questions in the meantime, just reply to this email.\n\nWelcome aboard!\n\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.`;

        try {
          const reserved = await recordSend(selectedInbox.id, lead.merchantId);
          if (!reserved) {
            console.warn(`[TerminalShipping] Inbox at daily cap for lead ${leadId} — welcome email skipped`);
            storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: leadId, details: `TerminalShipping inbox ${selectedInbox.emailAddress} at daily cap — welcome email not sent` }).catch(() => {});
          } else {
            try {
              await sendGhlEmail({
                contactId: lead.contactId,
                subject: welcomeSubject,
                body: welcomeBody,
                fromEmail: selectedInbox.emailAddress,
                fromName: selectedInbox.label,
              });
            } catch (sendErr) {
              await rollbackSend(selectedInbox.id);
              throw sendErr;
            }
          }
        } catch (err) {
          console.error("[TerminalShipping] Welcome email failed:", err);
        }
      }
    }

    console.log(`[TerminalShipping] Equipment order created for lead ${leadId}: ${terminalType}`);
    return true;
  } catch (err) {
    console.error("[TerminalShipping] Error creating order:", err);
    return false;
  }
}

export async function handleTerminalShipped(leadId: number, trackingNumber: string): Promise<boolean> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return false;

    const firstName = lead.ownerName?.split(" ")[0] || "there";

    await db.update(sdrLeadState).set({
      stage: "TERMINAL_SHIPPED",
      nextActionType: null,
      nextActionAt: null,
      decisionReason: `Terminal shipped, tracking: ${trackingNumber}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "terminal_shipped",
      fromStage: "BOARDED",
      toStage: "TERMINAL_SHIPPED",
      actionType: "terminal_ship_notification",
      decisionReason: `Terminal shipped with tracking: ${trackingNumber}`,
      metadata: { trackingNumber },
    });

    if (isGhlConfigured() && lead.contactId) {
      const selectedInbox = await selectBestInbox(lead.merchantId, lead.vertical || undefined);
      if (selectedInbox) {
        try {
          const reserved = await recordSend(selectedInbox.id, lead.merchantId);
          if (!reserved) {
            console.warn(`[TerminalShipping] Inbox at daily cap for lead ${leadId} — shipping notification skipped`);
            storage.createAuditLog({ action: "DAILY_CAP_REACHED", entityType: "sdr_lead", entityId: leadId, details: `TerminalShipping inbox ${selectedInbox.emailAddress} at daily cap — shipping notification not sent` }).catch(() => {});
          } else {
            try {
              await sendGhlEmail({
                contactId: lead.contactId,
                subject: `Your terminal is on the way!`,
                body: `Hi ${firstName},\n\nGreat news — your payment terminal has shipped!\n\nTracking Number: ${trackingNumber}\n\nYou should receive your terminal within 3-5 business days. Once it arrives, our team will be in touch to help with setup and training.\n\nBest,\nLiberty Bancard Team`,
                fromEmail: selectedInbox.emailAddress,
                fromName: selectedInbox.label,
              });
            } catch (sendErr) {
              await rollbackSend(selectedInbox.id);
              throw sendErr;
            }
          }
        } catch (err) {
          console.error("[TerminalShipping] Shipping notification email failed:", err);
        }
      }
    }

    console.log(`[TerminalShipping] Terminal shipped for lead ${leadId}, tracking: ${trackingNumber}`);
    return true;
  } catch (err) {
    console.error("[TerminalShipping] Error handling shipment:", err);
    return false;
  }
}
