/**
 * Canonical boarding case resolver (R01-3 / R03). Resolves which merchant application belongs to an
 * onboarding deal using ONLY exact relationships:
 *   - direct:       merchant_applications.deal_id = onboarding deal
 *   - sales_source: the application is bound to the sales deal the onboarding deal was created from
 *                   (deals.sales_deal_id), AND the application's contact equals the onboarding deal's contact.
 * There is no same-contact fallback. Boarding itself requires the DIRECT binding; a sales_source match is
 * reported so an explicit, audited bridge can move the application — never a silent FK change.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditChange } from "./audit-change";

export type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (r?.rows ?? r) as any[];

export interface ResolvedBoardingApplication {
  kind: "direct" | "sales_source" | "none";
  applicationId: number | null;
  applicationDealId: number | null;
  salesDealId: number | null;
}

export async function resolveBoardingApplication(exec: Exec, onboardingDealId: number): Promise<ResolvedBoardingApplication> {
  const dealRows = rowsOf(await exec.execute(sql`SELECT id, contact_id, sales_deal_id FROM deals WHERE id = ${onboardingDealId} LIMIT 1`));
  const deal = dealRows[0] as { id: number; contact_id: number | null; sales_deal_id: number | null } | undefined;
  if (!deal) return { kind: "none", applicationId: null, applicationDealId: null, salesDealId: null };
  const direct = rowsOf(await exec.execute(sql`SELECT id FROM merchant_applications WHERE deal_id = ${onboardingDealId} ORDER BY id LIMIT 1`))[0];
  if (direct) return { kind: "direct", applicationId: direct.id, applicationDealId: onboardingDealId, salesDealId: deal.sales_deal_id };
  if (deal.sales_deal_id != null && deal.contact_id != null) {
    const src = rowsOf(await exec.execute(sql`
      SELECT a.id FROM merchant_applications a
      JOIN deals s ON s.id = a.deal_id AND s.id = ${deal.sales_deal_id} AND s.contact_id = ${deal.contact_id}
      WHERE a.contact_id = ${deal.contact_id}
      ORDER BY a.id LIMIT 1`))[0];
    if (src) return { kind: "sales_source", applicationId: src.id, applicationDealId: deal.sales_deal_id, salesDealId: deal.sales_deal_id };
  }
  return { kind: "none", applicationId: null, applicationDealId: null, salesDealId: deal.sales_deal_id };
}

export type BridgeResult =
  | { bridged: true; applicationId: number; fromDealId: number }
  | { bridged: false; reason: "already_direct" | "no_exact_source_application" | "deal_not_onboarding" };

/** Explicit, audited, locked bridge. Moves ONLY the exact source application; refuses everything else. */
export async function bridgeApplicationToOnboarding(onboardingDealId: number, actorId: string | null): Promise<BridgeResult> {
  return db.transaction(async (tx) => {
    const d = rowsOf(await tx.execute(sql`SELECT id, pipeline, contact_id, sales_deal_id FROM deals WHERE id = ${onboardingDealId} FOR UPDATE`))[0];
    if (!d || d.pipeline !== "onboarding") return { bridged: false as const, reason: "deal_not_onboarding" as const };
    const resolved = await resolveBoardingApplication(tx, onboardingDealId);
    if (resolved.kind === "direct") return { bridged: false as const, reason: "already_direct" as const };
    if (resolved.kind !== "sales_source" || resolved.applicationId == null) {
      return { bridged: false as const, reason: "no_exact_source_application" as const };
    }
    const locked = rowsOf(await tx.execute(sql`
      SELECT id, deal_id FROM merchant_applications WHERE id = ${resolved.applicationId} AND deal_id = ${resolved.salesDealId} FOR UPDATE`))[0];
    if (!locked) return { bridged: false as const, reason: "no_exact_source_application" as const };
    await tx.execute(sql`
      UPDATE merchant_applications SET deal_id = ${onboardingDealId}, updated_at = NOW(), state_version = COALESCE(state_version,0) + 1
      WHERE id = ${resolved.applicationId} AND deal_id = ${resolved.salesDealId}`);
    await auditChange({
      userId: actorId, actorType: actorId ? "user" : "system",
      action: "merchant_application_bridged_to_onboarding",
      entityType: "merchant_application", entityId: resolved.applicationId,
      details: { fromDealId: resolved.salesDealId, toDealId: onboardingDealId },
    }, tx as any);
    return { bridged: true as const, applicationId: resolved.applicationId, fromDealId: resolved.salesDealId! };
  });
}
