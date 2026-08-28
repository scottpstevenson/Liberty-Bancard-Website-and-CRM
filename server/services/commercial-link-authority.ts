import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
  type CommercialGraphNode,
} from "./commercial-graph-locks";

export type LinkDecision = "verified" | "missing" | "conflicted" | "legacy_unknown" | "rejected";
export type MappingDecision = Exclude<LinkDecision, "missing">;

export class CommercialRevisionConflict extends Error {
  readonly code = "COMMERCIAL_REVISION_CONFLICT";
  constructor() { super("Commercial link revision is stale"); }
}

function requiresBusiness(decision: LinkDecision | MappingDecision) {
  return decision === "verified";
}

/** Heuristic/import discovery only. This never changes verified truth/projection. */
export async function recordContactBusinessLinkCandidate(input: {
  contactId: number;
  businessId: number;
  source: "csv_import" | "legacy_import" | "sdr_dedupe" | "sdr_orchestration";
  sourceVersion?: string | null;
  candidateKey: string;
  confidence: number;
}) {
  if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 99) {
    throw new Error("COMMERCIAL_LINK_CANDIDATE_CONFIDENCE_INVALID");
  }
  if (!input.candidateKey) throw new Error("COMMERCIAL_LINK_CANDIDATE_KEY_REQUIRED");
  return db.transaction(async (tx) => {
    await lockCommercialGraphNodes(tx, [
      { type: "contact", id: input.contactId },
      { type: "business", id: input.businessId },
    ]);
    await lockCommercialGraphMembershipSets(tx, [
      { type: "contact", id: input.contactId },
      { type: "business", id: input.businessId },
    ], ["contact_business"]);
    const contact = (await tx.execute(sql`SELECT id FROM contacts WHERE id=${input.contactId} FOR UPDATE`) as any).rows?.[0];
    const business = (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0];
    if (!contact || !business) throw new Error("CRM_OBJECT_NOT_FOUND");
    const replay = (await tx.execute(sql`SELECT * FROM contact_business_link_candidates
      WHERE candidate_key=${input.candidateKey}`) as any).rows?.[0];
    if (replay) {
      if (replay.contact_id !== input.contactId || replay.business_id !== input.businessId
          || replay.source !== input.source || replay.source_version !== (input.sourceVersion ?? null)
          || replay.confidence !== input.confidence) {
        throw new Error("COMMERCIAL_LINK_CANDIDATE_DIVERGENT_REPLAY");
      }
      return replay;
    }
    return (await tx.execute(sql`INSERT INTO contact_business_link_candidates
      (contact_id,business_id,source,source_version,candidate_key,confidence)
      VALUES (${input.contactId},${input.businessId},${input.source},${input.sourceVersion ?? null},
        ${input.candidateKey},${input.confidence}) RETURNING *`) as any).rows?.[0];
  });
}

/** Sole writer of contact/business link truth and its contacts.businessId projection. */
export async function decideContactBusinessLink(input: {
  contactId: number; businessId?: number | null; decision: LinkDecision; decisionKey: string;
  reviewerId: string; evidenceSourceEventId?: number | null; expectedRevision?: number;
}) {
  if (requiresBusiness(input.decision) !== Boolean(input.businessId)) {
    throw new Error("COMMERCIAL_LINK_DECISION_BUSINESS_MISMATCH");
  }
  if (!input.reviewerId) throw new Error("COMMERCIAL_LINK_REVIEWER_REQUIRED");
  if (input.decision === "verified" && !input.evidenceSourceEventId) throw new Error("COMMERCIAL_LINK_EVIDENCE_REQUIRED");
  return db.transaction(async (tx) => {
    const reviewer = (await tx.execute(sql`SELECT role FROM users WHERE id=${input.reviewerId}`) as any).rows?.[0];
    if (!reviewer || reviewer.role !== "admin") throw new Error("COMMERCIAL_LINK_REVIEWER_ROLE_INVALID");
    const contactNode: CommercialGraphNode = { type: "contact", id: input.contactId };
    await lockCommercialGraphNodes(tx, [contactNode]);
    const currentHint = (await tx.execute(sql`SELECT business_id FROM contact_business_link_decisions
      WHERE contact_id=${input.contactId} AND superseded_at IS NULL`) as any).rows?.[0];
    const nodes: CommercialGraphNode[] = [
      contactNode,
      ...(input.businessId ? [{ type: "business" as const, id: input.businessId }] : []),
      ...(currentHint?.business_id ? [{ type: "business" as const, id: Number(currentHint.business_id) }] : []),
    ];
    await lockCommercialGraphNodes(tx, nodes.filter(node => node.type === "business"));
    await lockCommercialGraphMembershipSets(tx, nodes, ["contact_business"]);
    const replay = (await tx.execute(sql`SELECT * FROM contact_business_link_decisions WHERE decision_key=${input.decisionKey} FOR UPDATE`) as any).rows?.[0];
    if (replay) {
      if (replay.contact_id !== input.contactId || replay.business_id !== (input.businessId ?? null)
          || replay.decision !== input.decision || replay.reviewed_by !== input.reviewerId
          || replay.evidence_source_event_id !== (input.evidenceSourceEventId ?? null)) {
        throw new Error("COMMERCIAL_LINK_DIVERGENT_REPLAY");
      }
      return replay;
    }
    const contact = (await tx.execute(sql`SELECT id FROM contacts WHERE id=${input.contactId} FOR UPDATE`) as any).rows?.[0];
    const business = input.businessId ? (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0] : true;
    if (!contact || !business) throw new Error("CRM_OBJECT_NOT_FOUND");
    if (input.evidenceSourceEventId) {
      const evidence = (await tx.execute(sql`SELECT contact_id,actor_type,actor_id
        FROM contact_source_events WHERE id=${input.evidenceSourceEventId} FOR SHARE`) as any).rows?.[0];
      if (!evidence || evidence.contact_id !== input.contactId) {
        throw new Error("COMMERCIAL_LINK_EVIDENCE_SUBJECT_MISMATCH");
      }
      if (evidence.actor_type === "user" && evidence.actor_id === input.reviewerId) {
        throw new Error("COMMERCIAL_LINK_REVIEWER_MUST_BE_INDEPENDENT");
      }
    }
    const current = (await tx.execute(sql`SELECT * FROM contact_business_link_decisions WHERE contact_id=${input.contactId} AND superseded_at IS NULL FOR UPDATE`) as any).rows?.[0];
    if (input.expectedRevision !== undefined && (current?.revision ?? 0) !== input.expectedRevision) throw new CommercialRevisionConflict();
    if (current) await tx.execute(sql`UPDATE contact_business_link_decisions SET superseded_at=now() WHERE id=${current.id}`);
    const revision = (current?.revision ?? 0) + 1;
    const row = (await tx.execute(sql`INSERT INTO contact_business_link_decisions
      (contact_id,business_id,decision,decision_key,actor_id,revision,evidence_source_event_id,reviewed_by,reviewed_at)
      VALUES (${input.contactId},${input.businessId ?? null},${input.decision},${input.decisionKey},
        ${input.reviewerId},${revision},${input.evidenceSourceEventId ?? null},${input.reviewerId},now()) RETURNING *`) as any).rows?.[0];
    // Projection belongs in the same authority transaction as immutable truth.
    await tx.execute(sql`UPDATE contacts SET business_id=${input.decision === "verified" ? input.businessId! : null},updated_at=now() WHERE id=${input.contactId}`);
    return row;
  });
}

/** Sole writer for legacy-company to canonical-business mapping decisions. */
export async function decideLegacyCompanyMapping(input: {
  companyId: number; businessId?: number | null; decision: MappingDecision; decisionKey: string;
  actorId?: string | null; expectedRevision?: number;
}) {
  if (requiresBusiness(input.decision) !== Boolean(input.businessId)) throw new Error("COMMERCIAL_MAPPING_DECISION_BUSINESS_MISMATCH");
  return db.transaction(async (tx) => {
    const companyNode: CommercialGraphNode = { type: "company", id: input.companyId };
    await lockCommercialGraphNodes(tx, [companyNode]);
    const currentHint = (await tx.execute(sql`SELECT business_id FROM legacy_company_mapping_decisions
      WHERE company_id=${input.companyId} AND superseded_at IS NULL`) as any).rows?.[0];
    const nodes: CommercialGraphNode[] = [
      companyNode,
      ...(input.businessId ? [{ type: "business" as const, id: input.businessId }] : []),
      ...(currentHint?.business_id ? [{ type: "business" as const, id: Number(currentHint.business_id) }] : []),
    ];
    await lockCommercialGraphNodes(tx, nodes.filter(node => node.type === "business"));
    await lockCommercialGraphMembershipSets(tx, nodes, ["legacy_company_business"]);
    const replay = (await tx.execute(sql`SELECT * FROM legacy_company_mapping_decisions WHERE decision_key=${input.decisionKey} FOR UPDATE`) as any).rows?.[0];
    if (replay) {
      if (replay.company_id !== input.companyId || replay.business_id !== (input.businessId ?? null) || replay.decision !== input.decision) throw new Error("COMMERCIAL_MAPPING_DIVERGENT_REPLAY");
      return replay;
    }
    const company = (await tx.execute(sql`SELECT id FROM companies WHERE id=${input.companyId} FOR UPDATE`) as any).rows?.[0];
    const business = input.businessId ? (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0] : true;
    if (!company || !business) throw new Error("CRM_OBJECT_NOT_FOUND");
    const current = (await tx.execute(sql`SELECT * FROM legacy_company_mapping_decisions WHERE company_id=${input.companyId} AND superseded_at IS NULL FOR UPDATE`) as any).rows?.[0];
    if (input.expectedRevision !== undefined && (current?.revision ?? 0) !== input.expectedRevision) throw new CommercialRevisionConflict();
    if (current) await tx.execute(sql`UPDATE legacy_company_mapping_decisions SET superseded_at=now() WHERE id=${current.id}`);
    const revision = (current?.revision ?? 0) + 1;
    const row = (await tx.execute(sql`INSERT INTO legacy_company_mapping_decisions
      (company_id,business_id,decision,decision_key,actor_id,revision)
      VALUES (${input.companyId},${input.businessId ?? null},${input.decision},${input.decisionKey},${input.actorId ?? null},${revision}) RETURNING *`) as any).rows?.[0];
    return row;
  });
}