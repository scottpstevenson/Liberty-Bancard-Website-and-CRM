import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { addTag, isSdrGhlConfigured } from "./ghl-client";
import { createGhlTask } from "../ghl";

export async function handoffToHuman(
  leadId: number,
  assignedUserId: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return { success: false, error: "Lead not found" };

    if (lead.assignedOwnerType === "human") {
      return { success: false, error: "Lead is already assigned to a human rep" };
    }

    await db.update(sdrLeadState).set({
      assignedOwnerType: "human",
      assignedUserId,
      humanHandoffAt: new Date(),
      humanHandoffNote: note || null,
      ownerType: "human",
      nextActionType: null,
      nextActionAt: null,
      pausedUntil: null,
      decisionReason: `Human handoff to ${assignedUserId}${note ? `: ${note}` : ""}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    if (isSdrGhlConfigured() && lead.ghlContactId) {
      try {
        await addTag({ contactId: lead.ghlContactId, tags: ["LB-HUMAN-HANDOFF"] });
      } catch (err) {
        console.error("[HumanHandoff] Failed to add GHL tag:", err);
      }
      createGhlTask({
        contactId: lead.ghlContactId,
        title: `Lead Handoff: ${lead.companyName || "Unknown"} — follow up required`,
        description: note || "AI automation paused. This lead requires human follow-up.",
        taskType: "FOLLOW_UP",
        dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
      }).catch(err => console.warn("[HumanHandoff] createGhlTask failed (non-critical):", err.message));
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "human_handoff",
      actionType: "handoff_to_human",
      actorType: "human",
      decisionReason: `Lead claimed by ${assignedUserId}`,
      metadata: { assignedUserId, note },
    });

    await storage.createNotification({
      channel: "internal",
      recipientId: assignedUserId,
      title: "Lead Assigned to You",
      message: `${lead.companyName || "A lead"} has been assigned to you. AI automation is now paused for this lead.`,
      type: "alert",
      metadata: { leadId, merchantId: lead.merchantId, action: "human_handoff" },
    });

    console.log(`[HumanHandoff] Lead ${leadId} handed off to ${assignedUserId}`);
    return { success: true };
  } catch (err) {
    console.error("[HumanHandoff] Error:", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function returnToAi(
  leadId: number,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return { success: false, error: "Lead not found" };

    if (lead.assignedOwnerType !== "human") {
      return { success: false, error: "Lead is not currently assigned to a human" };
    }

    const previousUserId = lead.assignedUserId;

    await db.update(sdrLeadState).set({
      assignedOwnerType: "ai",
      assignedUserId: null,
      humanHandoffAt: null,
      humanHandoffNote: null,
      ownerType: "ai",
      nextActionType: "score",
      nextActionAt: new Date(),
      decisionReason: `Returned to AI${note ? `: ${note}` : ""}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    if (isSdrGhlConfigured() && lead.ghlContactId) {
      try {
        const { removeTag } = await import("./ghl-client");
        await removeTag({ contactId: lead.ghlContactId, tags: ["human-review"] });
      } catch {}
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "returned_to_ai",
      actionType: "return_to_ai",
      actorType: "human",
      decisionReason: `Lead returned to AI from ${previousUserId || "human"}`,
      metadata: { previousUserId, note },
    });

    console.log(`[HumanHandoff] Lead ${leadId} returned to AI from ${previousUserId}`);
    return { success: true };
  } catch (err) {
    console.error("[HumanHandoff] Return error:", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function blockAutomation(
  leadId: number,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [lead] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId));
    if (!lead) return { success: false, error: "Lead not found" };

    await db.update(sdrLeadState).set({
      stage: "DEAD",
      assignedOwnerType: "blocked",
      nextActionType: null,
      nextActionAt: null,
      decisionReason: `Automation permanently blocked${reason ? `: ${reason}` : ""}`,
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.id, leadId));

    if (isSdrGhlConfigured() && lead.ghlContactId) {
      try {
        await addTag({ contactId: lead.ghlContactId, tags: ["LB-DO-NOT-AUTO"] });
      } catch {}
    }

    await db.insert(sdrLeadEvents).values({
      leadStateId: leadId,
      eventType: "automation_blocked",
      actionType: "block_automation",
      decisionReason: `Permanent automation block: ${reason || "No reason given"}`,
    });

    console.log(`[HumanHandoff] Lead ${leadId} permanently blocked from automation`);
    return { success: true };
  } catch (err) {
    console.error("[HumanHandoff] Block error:", err);
    return { success: false, error: (err as Error).message };
  }
}

export function isLeadHumanOwned(lead: { assignedOwnerType?: string | null; ownerType?: string | null }): boolean {
  return lead.assignedOwnerType === "human" || lead.ownerType === "human";
}

export function isLeadBlocked(lead: { assignedOwnerType?: string | null; stage?: string | null }): boolean {
  return lead.assignedOwnerType === "blocked" || lead.stage === "DEAD";
}
