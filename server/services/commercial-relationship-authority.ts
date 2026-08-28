import { sql } from "drizzle-orm";
import { db } from "../db";
import { lockCommercialGraph } from "./commercial-graph-locks";

/** Heuristic-only writer. Candidates never alter reviewed compatibility fields. */
export async function recordDecisionMakerCandidate(input: {
  contactId: number; businessId: number; source: string; sourceVersion?: string | null; confidence: number;
}) {
  if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) throw new Error("RELATIONSHIP_CANDIDATE_CONFIDENCE_INVALID");
  return db.transaction(async (tx) => {
    await lockCommercialGraph(tx, [
      { type: "contact", id: input.contactId },
      { type: "business", id: input.businessId },
    ], ["relationship"]);
    const contact = (await tx.execute(sql`SELECT id FROM contacts WHERE id=${input.contactId} FOR UPDATE`) as any).rows?.[0];
    const business = (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0];
    if (!contact || !business) throw new Error("CRM_OBJECT_NOT_FOUND");
    const candidate = (await tx.execute(sql`INSERT INTO commercial_relationship_candidates
      (contact_id,business_id,source,source_version,confidence)
      VALUES (${input.contactId},${input.businessId},${input.source},${input.sourceVersion ?? null},${input.confidence}) RETURNING *`) as any).rows?.[0];
    // Candidates are independently versioned graph evidence even though they
    // never authorize the reviewed compatibility projection.
    for (const [type, id] of [["contact", input.contactId], ["business", input.businessId]] as const) {
      await tx.execute(sql`INSERT INTO commercial_subject_revisions(subject_type,subject_id,revision,updated_at)
        VALUES(${type},${id},1,now()) ON CONFLICT(subject_type,subject_id)
        DO UPDATE SET revision=commercial_subject_revisions.revision+1,updated_at=now()`);
    }
    await tx.execute(sql`INSERT INTO commercial_membership_revisions(edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id,revision,updated_at)
      VALUES('relationship','contact',${input.contactId},'business',${input.businessId},1,now())
      ON CONFLICT(edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id)
      DO UPDATE SET revision=commercial_membership_revisions.revision+1,updated_at=now()`);
    return candidate;
  });
}

/** Sole writer for reviewed decision-maker compatibility projections. */
export async function reviewDecisionMaker(input: {
  contactId: number; businessId: number; decision: "decision_maker" | "not_decision_maker" | "unknown" | "conflicted"; actorId: string;
  reviewKey: string; expectedRevision?: number;
}) {
  return db.transaction(async (tx) => {
    await lockCommercialGraph(tx, [
      { type: "contact", id: input.contactId },
      { type: "business", id: input.businessId },
    ], ["relationship"]);
    const contact = (await tx.execute(sql`SELECT id FROM contacts WHERE id=${input.contactId} FOR UPDATE`) as any).rows?.[0];
    const business = (await tx.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR UPDATE`) as any).rows?.[0];
    if (!contact || !business) throw new Error("CRM_OBJECT_NOT_FOUND");
    const replay = (await tx.execute(sql`SELECT * FROM commercial_relationship_reviews WHERE review_key=${input.reviewKey} FOR UPDATE`) as any).rows?.[0];
    if (replay) {
      if (replay.contact_id !== input.contactId || replay.business_id !== input.businessId || replay.decision !== input.decision) throw new Error("RELATIONSHIP_DIVERGENT_REPLAY");
      return replay;
    }
    const current = (await tx.execute(sql`SELECT * FROM commercial_relationship_reviews WHERE contact_id=${input.contactId} AND business_id=${input.businessId} AND superseded_at IS NULL FOR UPDATE`) as any).rows?.[0];
    if (input.expectedRevision !== undefined && (current?.revision ?? 0) !== input.expectedRevision) throw new Error("COMMERCIAL_REVISION_CONFLICT");
    if (current) await tx.execute(sql`UPDATE commercial_relationship_reviews SET superseded_at=now() WHERE id=${current.id}`);
    const revision = (current?.revision ?? 0) + 1;
    const review = (await tx.execute(sql`INSERT INTO commercial_relationship_reviews
      (contact_id,business_id,decision,review_key,actor_id,revision) VALUES
      (${input.contactId},${input.businessId},${input.decision},${input.reviewKey},${input.actorId},${revision}) RETURNING *`) as any).rows?.[0];
    await tx.execute(sql`UPDATE contacts SET is_decision_maker=${input.decision === "decision_maker"},
      decision_maker_confidence=${input.decision === "decision_maker" ? 100 : 0}, updated_at=now() WHERE id=${input.contactId}`);
    return review;
  });
}