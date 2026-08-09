import { db } from "../../db";
import { sdrLeadState, sdrComplianceState, sdrLeadEvents, sdrMerchants } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq } from "drizzle-orm";
import { updateCustomFields, addTag, isSdrGhlConfigured, ensureGhlBootstrapped } from "./ghl-client";

export async function onStageChange(merchantId: number, newStage: string, oldStage?: string): Promise<void> {
  if (!isSdrGhlConfigured()) return;
  await ensureGhlBootstrapped();

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId) return;

  try {
    await updateCustomFields(merchant.ghlContactId, {
      lb_merchant_id: String(merchantId),
      lb_current_stage: newStage,
    });

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "stage_change",
      channel: "system",
      actorType: "system",
      payloadJson: { from: oldStage, to: newStage },
    });

    if (newStage === "NURTURE" && oldStage !== "NURTURE") {
      const { enrollInGhlWorkflowCompliant } = await import("../ghl-workflows");
      enrollInGhlWorkflowCompliant({ workflowKey: "long_term_nurture", ghlContactId: merchant.ghlContactId, metadata: { merchantId, fromStage: oldStage } }).catch(err =>
        console.error(`[SDR Sync] GHL long_term_nurture enrollment error for merchant ${merchantId}:`, err)
      );
    }

    console.log(`[SDR Sync] Updated GHL stage for merchant ${merchantId}: ${oldStage} -> ${newStage}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SDR Sync] Failed to sync stage change for merchant ${merchantId}:`, errMsg);
  }
}

export interface ScoreUpdate {
  fitScore?: number;
  revenueScore?: number;
  reachabilityScore?: number;
  priorityScore?: number;
}

export async function onScoreChange(merchantId: number, scores: ScoreUpdate): Promise<void> {
  if (!isSdrGhlConfigured()) return;
  await ensureGhlBootstrapped();

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId) return;

  try {
    const fields: Record<string, string> = {};
    if (scores.fitScore !== undefined) fields.lb_fit_score = String(scores.fitScore);
    if (scores.revenueScore !== undefined) fields.lb_revenue_score = String(scores.revenueScore);
    if (scores.reachabilityScore !== undefined) fields.lb_reachability_score = String(scores.reachabilityScore);
    if (scores.priorityScore !== undefined) fields.lb_priority_score = String(scores.priorityScore);

    if (Object.keys(fields).length > 0) {
      await updateCustomFields(merchant.ghlContactId, fields);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SDR Sync] Failed to sync scores for merchant ${merchantId}:`, errMsg);
  }
}

export async function onHumanHandoff(merchantId: number): Promise<void> {
  if (!isSdrGhlConfigured()) return;
  await ensureGhlBootstrapped();

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId) return;

  try {
    await addTag({ contactId: merchant.ghlContactId, tags: ["LB-HUMAN-HANDOFF"] });
    await updateCustomFields(merchant.ghlContactId, { lb_owner_type: "human" });

    await db.update(sdrLeadState)
      .set({ ownerType: "human", updatedAt: new Date() })
      .where(eq(sdrLeadState.merchantId, merchantId));

    console.log(`[SDR Sync] Human handoff for merchant ${merchantId}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SDR Sync] Failed human handoff for merchant ${merchantId}:`, errMsg);
  }
}

export async function onOptOut(merchantId: number, channel: "sms" | "email" | "call" | "all"): Promise<void> {
  const updates: Partial<{
    smsAllowed: boolean;
    emailAllowed: boolean;
    callAllowed: boolean;
    dncBlock: boolean;
  }> = {};

  if (channel === "sms" || channel === "all") updates.smsAllowed = false;
  if (channel === "email" || channel === "all") updates.emailAllowed = false;
  if (channel === "call" || channel === "all") updates.callAllowed = false;
  if (channel === "all") updates.dncBlock = true;

  const [existing] = await db.select().from(sdrComplianceState).where(eq(sdrComplianceState.merchantId, merchantId));
  if (existing) {
    await db.update(sdrComplianceState)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sdrComplianceState.merchantId, merchantId));
  } else {
    await db.insert(sdrComplianceState).values({
      merchantId,
      ...updates,
    });
  }

  await db.update(sdrMerchants)
    .set({ doNotContactFlag: channel === "all", updatedAt: new Date() })
    .where(eq(sdrMerchants.id, merchantId));

  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType: "opt_out",
    channel,
    actorType: "merchant",
    payloadJson: { channel, action: "opt_out" },
  });

  console.log(`[SDR Sync] Opt-out recorded for merchant ${merchantId}, channel: ${channel}`);
}

export interface AppointmentData {
  appointmentId?: string;
  id?: string;
  calendarId?: string;
  status?: string;
  [key: string]: unknown;
}

export async function onAppointmentBooked(merchantId: number, appointmentData: AppointmentData): Promise<void> {
  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));

  const meetingId = appointmentData.appointmentId || appointmentData.id || null;

  if (state) {
    await db.update(sdrLeadState)
      .set({
        currentStage: "MEETING_SET",
        meetingId,
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sdrLeadState.merchantId, merchantId));
  } else {
    await db.insert(sdrLeadState).values({
      merchantId,
      currentStage: "MEETING_SET",
      meetingId,
    });
  }

  await onStageChange(merchantId, "MEETING_SET", state?.currentStage);

  await db.insert(sdrLeadEvents).values({
    merchantId,
    eventType: "appointment_booked",
    channel: "calendar",
    actorType: "merchant",
    payloadJson: appointmentData,
  });
}

export async function syncLeadStateToGhl(merchantId: number): Promise<void> {
  if (!isSdrGhlConfigured()) return;

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId) return;

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));
  if (!state) return;

  try {
    const fields: Record<string, string> = {
      lb_merchant_id: String(merchantId),
      lb_current_stage: state.currentStage,
      lb_owner_type: state.ownerType || "ai",
    };

    if (state.fitScore !== null) fields.lb_fit_score = String(state.fitScore);
    if (state.revenueScore !== null) fields.lb_revenue_score = String(state.revenueScore);
    if (state.reachabilityScore !== null) fields.lb_reachability_score = String(state.reachabilityScore);
    if (state.priorityScore !== null) fields.lb_priority_score = String(state.priorityScore);
    if (merchant.vertical) fields.lb_vertical = merchant.vertical;

    await updateCustomFields(merchant.ghlContactId, fields);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SDR Sync] Failed to sync full lead state for merchant ${merchantId}:`, errMsg);
  }
}
