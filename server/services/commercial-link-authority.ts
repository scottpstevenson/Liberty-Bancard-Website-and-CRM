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

export async function assertSystemLinkDatabaseGuard(executor: any) {
  const triggerCheck = (await executor.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE c.relname='contact_business_link_decisions'
        AND t.tgname='contact_business_link_review_contract'
        AND t.tgenabled <> 'D'
        AND p.proname='enforce_reviewed_contact_business_link'
        AND position('COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED' in pg_get_functiondef(p.oid)) > 0
        AND position('contact_business_system_link_evidence' in pg_get_functiondef(p.oid)) > 0
    ) AS installed,
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE c.relname='contact_business_system_link_evidence'
        AND t.tgname='contact_business_system_link_evidence_append_only'
        AND t.tgenabled <> 'D'
        AND p.proname='cro02_system_link_evidence_append_only'
    ) AS immutable_evidence_trigger,
    to_regclass('contact_business_system_link_evidence') IS NOT NULL AS evidence_table,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='contact_business_link_decisions' AND column_name='system_evidence_id'
    ) AS evidence_column,
    (SELECT COUNT(*) = 2 FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      WHERE (rel.relname,con.conname) IN (
        ('sfp_outreach_eligibility','sfp_outreach_eligibility_source_ref_one_of_chk'),
        ('sfp_campaign_staging_intents','sfp_campaign_staging_intents_source_ref_one_of_chk')
      )
      AND con.contype='c'
      AND position('contact_business_link_decision_id' in pg_get_constraintdef(con.oid)) > 0
      AND position('contact' in pg_get_constraintdef(con.oid)) > 0
    ) AS sfp_contact_checks
  `) as any).rows?.[0];
  if (!triggerCheck?.installed || !triggerCheck?.immutable_evidence_trigger
      || !triggerCheck?.evidence_table || !triggerCheck?.evidence_column
      || !triggerCheck?.sfp_contact_checks) {
    throw new Error("COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING");
  }
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
  authorityCheck?: (tx: any) => Promise<boolean>;
}) {
  if (requiresBusiness(input.decision) !== Boolean(input.businessId)) {
    throw new Error("COMMERCIAL_LINK_DECISION_BUSINESS_MISMATCH");
  }
  if (!input.reviewerId) throw new Error("COMMERCIAL_LINK_REVIEWER_REQUIRED");
  if (input.decision === "verified" && !input.evidenceSourceEventId) throw new Error("COMMERCIAL_LINK_EVIDENCE_REQUIRED");
  return db.transaction(async (tx) => {
    if (input.authorityCheck && !(await input.authorityCheck(tx))) {
      throw new Error("COMMERCIAL_LINK_AUTHORITY_FENCE_LOST");
    }
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
    if (input.authorityCheck && !(await input.authorityCheck(tx))) {
      throw new Error("COMMERCIAL_LINK_AUTHORITY_FENCE_LOST");
    }
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

/**
 * Separate strict system-authority writer. It shares the canonical graph locks,
 * revision fence, append-only decision ledger and projection transaction with
 * admin decisions, but never supplies a reviewer identity or contact event.
 */
export async function decideSystemContactBusinessLink(input: {
  contactId: number;
  businessId: number;
  sourceLinkId: string;
  sourceEntityId: number;
  decisionKey: string;
  ruleVersion: string;
  factsHash: string;
  facts: Record<string, unknown>;
  authorityCheck: (tx: any) => Promise<boolean>;
}) {
  return db.transaction(async (tx) => {
    // Publish schema-diff can add tables/columns but does not reliably install
    // PL/pgSQL trigger functions. Never let automatic system authority silently
    // proceed without the database-enforced system/admin decision split.
    await assertSystemLinkDatabaseGuard(tx);
    const contactNode: CommercialGraphNode = { type: "contact", id: input.contactId };
    const businessNode: CommercialGraphNode = { type: "business", id: input.businessId };
    await lockCommercialGraphNodes(tx, [contactNode, businessNode]);
    await lockCommercialGraphMembershipSets(tx, [contactNode, businessNode], ["contact_business"]);
    const contact = (await tx.execute(sql`SELECT id FROM contacts WHERE id=${input.contactId} FOR UPDATE`) as any).rows?.[0];
    const business = (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0];
    if (!contact || !business) throw new Error("CRM_OBJECT_NOT_FOUND");

    const replay = (await tx.execute(sql`SELECT d.id,d.contact_id,d.business_id,e.facts_hash,
        e.source_link_id,e.source_entity_id
      FROM contact_business_link_decisions d
      JOIN contact_business_system_link_evidence e ON e.id=d.system_evidence_id
      WHERE d.decision_key=${input.decisionKey} FOR UPDATE`) as any).rows?.[0];
    if (replay) {
      if (Number(replay.contact_id) !== input.contactId || Number(replay.business_id) !== input.businessId
          || replay.facts_hash !== input.factsHash || String(replay.source_link_id) !== input.sourceLinkId
          || Number(replay.source_entity_id) !== input.sourceEntityId) {
        throw new Error("COMMERCIAL_LINK_DIVERGENT_REPLAY");
      }
      return { ...replay, replayed: true };
    }

    if (!(await input.authorityCheck(tx))) throw new Error("SYSTEM_LINK_SNAPSHOT_STALE");
    const current = (await tx.execute(sql`SELECT id,revision FROM contact_business_link_decisions
      WHERE contact_id=${input.contactId} AND superseded_at IS NULL FOR UPDATE`) as any).rows?.[0];
    if (current) throw new Error("CURRENT_LINK_DECISION_EXISTS");
    const evidence = (await tx.execute(sql`INSERT INTO contact_business_system_link_evidence
      (decision_key,contact_id,business_id,source_link_id,source_entity_id,rule_version,facts_hash,facts)
      VALUES (${input.decisionKey},${input.contactId},${input.businessId},${input.sourceLinkId}::uuid,
        ${input.sourceEntityId},${input.ruleVersion},${input.factsHash},${JSON.stringify(input.facts)}::jsonb)
      RETURNING id`) as any).rows?.[0];
    const revision = Number(current?.revision ?? 0) + 1;
    const decision = (await tx.execute(sql`INSERT INTO contact_business_link_decisions
      (contact_id,business_id,decision,decision_key,actor_id,revision,system_evidence_id,reviewed_by,reviewed_at)
      VALUES (${input.contactId},${input.businessId},'verified',${input.decisionKey},'system',${revision},
        ${evidence.id},NULL,NULL) RETURNING *`) as any).rows?.[0];
    await tx.execute(sql`UPDATE contacts SET business_id=${input.businessId},updated_at=now() WHERE id=${input.contactId}`);
    return decision;
  });
}

/**
 * Task #1999 (C4): read-only projection of the ONLY predicate that may be treated
 * as an authoritative existing contact-business link — decision='verified' AND
 * superseded_at IS NULL, with contacts.business_id consistent with that decision
 * (decideContactBusinessLink above is the sole writer that keeps them consistent).
 * A historical 'verified' row later superseded by 'rejected'/'conflicted' is
 * NEVER returned here. contact_business_link_candidates rows are never authority
 * and are intentionally excluded — callers needing review evidence must query
 * that table directly and must not treat its rows as proof of a link.
 *
 * This function does not alter decision semantics; it only reads the existing
 * append-only ledger written by decideContactBusinessLink.
 */
export interface AuthoritativeContactBusinessLink {
  contactId: number;
  businessId: number;
  decisionId: string;
  revision: number;
  decisionKey: string;
  reviewedAt: string | null;
  contactEmail: string | null;
  contactName: string | null;
  contactTitle: string | null;
}

export async function getAuthoritativeVerifiedContactLinks(
  businessIds: number[],
): Promise<AuthoritativeContactBusinessLink[]> {
  if (businessIds.length === 0) return [];
  const result = await db.execute(sql`
     SELECT d.id AS decision_id, d.revision, d.decision_key, d.contact_id, d.business_id, d.reviewed_at,
           c.email AS contact_email,
           concat_ws(' ', nullif(c.first_name, ''), nullif(c.last_name, '')) AS contact_name,
           c.title AS contact_title
      FROM contact_business_link_decisions d
      JOIN contacts c ON c.id = d.contact_id
       JOIN businesses b ON b.id=d.business_id AND b.record_class='canonical'
     WHERE d.decision = 'verified'
       AND d.superseded_at IS NULL
       AND d.business_id = ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
       -- consistency guard: contacts.business_id (the live projection) must still
       -- agree with the decision ledger, or this row is stale/inconsistent and
       -- must not be treated as authoritative.
       AND c.business_id = d.business_id
        AND c.archived_at IS NULL
        AND c.record_class NOT IN ('test','demo','synthetic')
        AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
        AND COALESCE(c.do_not_contact,FALSE)=FALSE
        AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
        AND COALESCE(c.opted_out_email,FALSE)=FALSE
        AND c.opt_out_status IS DISTINCT FROM 'opted_out'
        AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
        AND c.complaint_status IS DISTINCT FROM 'reported'
        AND c.bounce_status IS DISTINCT FROM 'hard'
        AND c.email_status NOT IN ('bounced','invalid')
        AND c.suppression_reason IS NULL
  `);
  const rowsOut = (result as any).rows ?? result ?? [];
  return rowsOut.map((r: any) => ({
    contactId: Number(r.contact_id),
    businessId: Number(r.business_id),
    decisionId: String(r.decision_id),
    revision: Number(r.revision),
    decisionKey: String(r.decision_key),
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    contactEmail: r.contact_email ?? null,
    contactName: r.contact_name ?? null,
    contactTitle: r.contact_title ?? null,
  }));
}

export interface CurrentVerifiedContactLinkPin {
  contactId: number;
  businessId: number;
  decisionId: string;
  revision: number;
  normalizedEmailHash: string;
  normalizedEmailHashVersion: 1;
}

/**
 * Transaction-friendly final-boundary guard for consumers that freeze a
 * verified contact source. It deliberately returns only a normalized address
 * digest, never the plaintext email. Passing the caller's executor keeps the
 * authority read in the same transaction/snapshot as the consumer's write.
 */
export async function getCurrentVerifiedContactLinkPin(
  input: {
    contactId: number;
    businessId: number;
    decisionId?: string | null;
    revision?: number | null;
    normalizedEmailHash?: string | null;
    normalizedEmailHashVersion?: number | null;
  },
  executor: { execute: (query: any) => Promise<any> } = db,
): Promise<CurrentVerifiedContactLinkPin | null> {
  const result = await executor.execute(sql`
    SELECT c.id AS contact_id,c.business_id,c.email,d.id AS decision_id,d.revision
      FROM contacts c
      JOIN businesses b ON b.id=c.business_id AND b.record_class='canonical'
      JOIN contact_business_link_decisions d
        ON d.contact_id=c.id AND d.business_id=c.business_id
       AND d.decision='verified' AND d.superseded_at IS NULL
     WHERE c.id=${input.contactId}
       AND c.business_id=${input.businessId}
       AND c.archived_at IS NULL
       AND c.record_class NOT IN ('test','demo','synthetic')
       AND COALESCE(c.existing_merchant_customer,FALSE)=FALSE
       AND COALESCE(c.do_not_contact,FALSE)=FALSE
       AND COALESCE(c.do_not_auto_contact,FALSE)=FALSE
       AND COALESCE(c.opted_out_email,FALSE)=FALSE
       AND c.opt_out_status IS DISTINCT FROM 'opted_out'
       AND c.unsubscribe_status IS DISTINCT FROM 'unsubscribed'
       AND c.complaint_status IS DISTINCT FROM 'reported'
       AND c.bounce_status IS DISTINCT FROM 'hard'
       AND c.email_status NOT IN ('bounced','invalid')
       AND c.suppression_reason IS NULL
       AND c.email IS NOT NULL AND BTRIM(c.email)<>''
     LIMIT 1
     FOR SHARE OF c,b,d
  `);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  if (!row) return null;
  const normalizedEmailHash = crypto.createHash("sha256")
    .update(`email\u0000${String(row.email).trim().toLowerCase()}`).digest("hex");
  if ((input.decisionId && String(row.decision_id) !== input.decisionId)
      || (input.revision != null && Number(row.revision) !== input.revision)
      || (input.normalizedEmailHash && normalizedEmailHash !== input.normalizedEmailHash)
      || (input.normalizedEmailHashVersion != null && input.normalizedEmailHashVersion !== 1)) {
    return null;
  }
  return {
    contactId: Number(row.contact_id),
    businessId: Number(row.business_id),
    decisionId: String(row.decision_id),
    revision: Number(row.revision),
    normalizedEmailHash,
    normalizedEmailHashVersion: 1,
  };
}

/**
 * Task #1999 (C4): review-evidence-only projection of contact_business_link_candidates
 * for a set of businesses. Never authoritative — callers must never suppress a
 * provider call or attach an email based solely on rows returned here.
 */
export async function getReviewOnlyContactBusinessLinkCandidates(
  businessIds: number[],
): Promise<Array<{ contactId: number; businessId: number; source: string; confidence: number }>> {
  if (businessIds.length === 0) return [];
  const result = await db.execute(sql`
    SELECT contact_id, business_id, source, confidence
      FROM contact_business_link_candidates
     WHERE business_id = ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
  `);
  const rowsOut = (result as any).rows ?? result ?? [];
  return rowsOut.map((r: any) => ({
    contactId: Number(r.contact_id),
    businessId: Number(r.business_id),
    source: String(r.source),
    confidence: Number(r.confidence),
  }));
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