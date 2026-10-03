import { sql } from "drizzle-orm";
import { lockCommercialGraphNodes,lockCommercialGraphMembershipSets } from "../commercial-graph-locks";
import type { CommercialGraphNode } from "../commercial-graph-locks";
import { relationshipReasonsSql } from "../../../shared/relationship-evidence-sql";

export type SfpRecipientAssociationPin = { contactId: number;decisionId: string;revision: number };
export async function lockSfpRecipientAssociationGraph(tx: any,businessId: number,pins: SfpRecipientAssociationPin[]) {
  if (!pins.length) return;
  const nodes: CommercialGraphNode[] = [{type:"business",id:businessId},
    ...pins.map(pin=>({type:"contact" as const,id:pin.contactId}))];
  await lockCommercialGraphNodes(tx,nodes);
  await lockCommercialGraphMembershipSets(tx,nodes,["contact_business"]);
}
/** Borrowed source facts must retain their real, current relationship authority. */
export async function sfpRecipientAssociationCurrent(tx: any,businessId: number,address: string,
  pins: SfpRecipientAssociationPin[]) {
  if (!pins.length) return true;
  const result = await tx.execute(sql`SELECT count(*)::integer AS matched
    FROM (VALUES ${sql.join(pins.map(pin=>sql`(${pin.contactId}::integer,
      ${pin.decisionId}::uuid,${pin.revision}::integer)`),sql`, `)}) wanted(contact_id,decision_id,revision)
    JOIN contacts c ON c.id=wanted.contact_id AND c.business_id=${businessId}
      AND lower(trim(c.email))=${address.trim().toLowerCase()} AND c.archived_at IS NULL
    JOIN contact_business_link_decisions d ON d.id=wanted.decision_id
      AND d.contact_id=c.id AND d.business_id=${businessId} AND d.revision=wanted.revision
      AND d.decision='verified' AND d.superseded_at IS NULL
    LEFT JOIN contact_business_system_link_evidence evidence ON evidence.id=d.system_evidence_id
    WHERE evidence.id IS NULL OR ${sql.raw(relationshipReasonsSql("c.id","c.business_id",
      "evidence.source_link_id","evidence.source_entity_id"))}<@ARRAY['current_link_decision_exists']::text[]`);
  return Number((result?.rows ?? result)[0]?.matched)===pins.length;
}