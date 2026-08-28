/**
 * CRO-02 persisted commercial graph. It is shadow-only: callers must use the
 * legacy decision returned as effectiveDecision until a separate cutover.
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  authorizeUse, getCurrentClass, type ClassificationPurpose,
  type ClassificationSubjectType,
} from "./commercial-classification-authority";
import { lockCommercialGraph } from "./commercial-graph-locks";
import type {
  CommercialClass, CommercialIdentityResolution,
  CommercialOrganizationLinkResolution, CommercialProvenanceResolution,
  CommercialRelationshipResolution,
} from "@shared/schema";

export const CRO02_POLICY_VERSION = 1;
export const CRO02_SCHEMA_VERSION = 1;
export type CommercialEffect =
  | "inbound_transactional_acknowledgement" | "account_transactional"
  | "internal_notification" | "marketing_outreach" | "commercial_reporting"
  | "financial_payout" | "provider_pre_spend" | "internal_test";
type AxisRule = "required" | "optional";
type EdgeRule = { required: boolean; min: number; max: number | null };
export type CommercialPurposePolicyDocument = {
  schemaVersion: 1;
  allowedClasses: CommercialClass[];
  allowUnknownWithInboundBinding: boolean;
  testEnvironmentOnly: boolean;
  axes: { provenance: AxisRule; identity: AxisRule; organizationLink: AxisRule; relationship: AxisRule };
  edges: { dealRoots: EdgeRule; prospectContact: EdgeRule; contactBusiness: EdgeRule; companyBusiness: EdgeRule; relationshipReviews: EdgeRule };
};
const optionalEdge = (): EdgeRule => ({ required: false, min: 0, max: null });
const requiredOne = (): EdgeRule => ({ required: true, min: 1, max: 1 });
const requiredDealRoot = (): EdgeRule => ({ required: true, min: 1, max: 2 });
const policy = (overrides: Partial<CommercialPurposePolicyDocument> = {}): CommercialPurposePolicyDocument => ({
  schemaVersion: 1, allowedClasses: ["production"], allowUnknownWithInboundBinding: false,
  testEnvironmentOnly: false,
  axes: { provenance: "optional", identity: "optional", organizationLink: "optional", relationship: "optional" },
  edges: { dealRoots: optionalEdge(), prospectContact: optionalEdge(), contactBusiness: optionalEdge(),
    companyBusiness: optionalEdge(), relationshipReviews: optionalEdge() },
  ...overrides,
});
export const CRO02_PURPOSE_POLICY_DOCUMENTS: Record<CommercialEffect, CommercialPurposePolicyDocument> = {
  inbound_transactional_acknowledgement: policy({ allowUnknownWithInboundBinding: true }),
  account_transactional: policy(),
  internal_notification: policy(),
  marketing_outreach: policy({
    axes: { provenance: "optional", identity: "optional", organizationLink: "required", relationship: "required" },
    edges: { dealRoots: requiredDealRoot(), prospectContact: optionalEdge(), contactBusiness: requiredOne(),
      companyBusiness: requiredOne(), relationshipReviews: requiredOne() },
  }),
  commercial_reporting: policy(),
  financial_payout: policy(),
  provider_pre_spend: policy({
    axes: { provenance: "required", identity: "required", organizationLink: "required", relationship: "optional" },
    edges: { dealRoots: requiredDealRoot(), prospectContact: optionalEdge(), contactBusiness: requiredOne(),
      companyBusiness: requiredOne(), relationshipReviews: optionalEdge() },
  }),
  internal_test: policy({ allowedClasses: ["test", "demo", "synthetic", "unknown"], testEnvironmentOnly: true }),
};
export type DependencyVectorEntry = {
  objectType: string; objectId: string | number; revision: number; authorityVersion: number;
};
export type ShadowDecision = {
  allowed: boolean; resolution: "allowed" | "quarantined"; recordClass: CommercialClass;
  requestedSubjectType: ClassificationSubjectType; requestedSubjectId: number;
  effectiveSubjectType: ClassificationSubjectType; effectiveSubjectId: number;
  reasonCodes: string[]; provenance: CommercialProvenanceResolution;
  identity: CommercialIdentityResolution; organizationLink: CommercialOrganizationLinkResolution;
  relationship: CommercialRelationshipResolution; dependencyVector: DependencyVectorEntry[];
  dependencyFingerprint: string; policyVersion: number; schemaVersion: number;
  policyFingerprint: string; mode: "shadow"; snapshotId?: string;
};
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };
const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
export const commercialPurposePolicyFingerprint = (document: CommercialPurposePolicyDocument): string =>
  createHash("sha256").update(canonicalJson(document)).digest("hex");
function parsePurposePolicy(row: any, effect: CommercialEffect): CommercialPurposePolicyDocument | null {
  const d = row?.required_edges;
  const expected = CRO02_PURPOSE_POLICY_DOCUMENTS[effect];
  if (!row || row.purpose !== effect || Number(row.policy_version) !== CRO02_POLICY_VERSION
      || row.mode !== "shadow" || !d || commercialPurposePolicyFingerprint(d) !== commercialPurposePolicyFingerprint(expected)) return null;
  return d as CommercialPurposePolicyDocument;
}
const ranks: Record<string, number> = {
  policy: 0,
  contact: 1, deal: 2, prospect: 3, company: 4, business: 5,
  source: 19, redirect: 20, identity: 21, link: 22, mapping: 23, relationship: 24,
};
const tables: Record<ClassificationSubjectType, string> = {
  contact: "contacts", deal: "deals", prospect: "prospects",
  company: "companies", business: "businesses",
};

export function canonicalDependencyFingerprint(entries: DependencyVectorEntry[]): string {
  const normalized = entries.map(e => ({
    type: e.objectType, id: String(e.objectId), revision: e.revision,
    authorityVersion: e.authorityVersion,
  })).sort((a, b) => (ranks[a.type] ?? 100) - (ranks[b.type] ?? 100)
    || a.type.localeCompare(b.type)
    || a.id.localeCompare(b.id, undefined, { numeric: true })
    || a.revision - b.revision);
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function decideCommercialEffect(input: {
  effect: CommercialEffect; recordClass: CommercialClass;
  inboundRequestId?: string; intendedRecipientId?: number;
  requestedSubjectType?: ClassificationSubjectType; requestedSubjectId?: number;
  effectiveSubjectType?: ClassificationSubjectType; effectiveSubjectId?: number;
  provenance?: CommercialProvenanceResolution; identity?: CommercialIdentityResolution;
  organizationLink?: CommercialOrganizationLinkResolution;
  relationship?: CommercialRelationshipResolution; vector?: DependencyVectorEntry[];
  policyDocument?: CommercialPurposePolicyDocument;
}): ShadowDecision {
  const purposePolicy = input.policyDocument ?? CRO02_PURPOSE_POLICY_DOCUMENTS[input.effect];
  const provenance = input.provenance ?? "untraceable";
  const identity = input.identity ?? "unresolved";
  const organizationLink = input.organizationLink ?? "missing";
  const relationship = input.relationship ?? "unknown";
  const vector = input.vector ?? [];
  const reasonCodes: string[] = [];
  if (input.recordClass !== "production") reasonCodes.push("ROOT_CLASS_NON_PRODUCTION");
  if (provenance === "untraceable") reasonCodes.push("PROVENANCE_UNTRACEABLE");
  if (provenance === "conflicted") reasonCodes.push("PROVENANCE_CONFLICT");
  if (provenance === "invalid") reasonCodes.push("EVIDENCE_INVALID");
  if (identity === "collision") reasonCodes.push("IDENTITY_COLLISION");
  if (identity === "conflicted") reasonCodes.push("REDIRECT_UNRESOLVED");
  if (organizationLink === "conflicted" || organizationLink === "rejected") reasonCodes.push("BUSINESS_LINK_UNRESOLVED");
  if (relationship === "conflicted") reasonCodes.push("RELATIONSHIP_CONFLICT");
  const inboundEffect = input.effect === "inbound_transactional_acknowledgement";
  const inboundBound = inboundEffect
    && input.requestedSubjectType === "contact"
    && !!input.inboundRequestId?.trim()
    && input.intendedRecipientId === input.requestedSubjectId;
  const inboundUnknown = inboundBound && input.recordClass === "unknown";
  if (inboundEffect && !inboundBound) reasonCodes.push("INBOUND_BINDING_REQUIRED");
  const axisInvalid = (rule: AxisRule, value: string, accepted: string[]) =>
    rule === "required" && !accepted.includes(value);
  const fatal = axisInvalid(purposePolicy.axes.provenance, provenance, ["verified"])
    || axisInvalid(purposePolicy.axes.identity, identity, ["resolved"])
    || axisInvalid(purposePolicy.axes.organizationLink, organizationLink, ["verified"])
    || axisInvalid(purposePolicy.axes.relationship, relationship, ["decision_maker"]);
  const classAllowed = purposePolicy.allowedClasses.includes(input.recordClass);
  const ordinarilyAllowed = !fatal && classAllowed;
  const allowed = (!purposePolicy.testEnvironmentOnly || process.env.NODE_ENV === "test")
    && (inboundEffect
      ? inboundBound && (inboundUnknown && purposePolicy.allowUnknownWithInboundBinding || ordinarilyAllowed)
      : ordinarilyAllowed);
  const requestedSubjectType = input.requestedSubjectType ?? "contact";
  const requestedSubjectId = input.requestedSubjectId ?? input.effectiveSubjectId ?? 0;
  const effectiveSubjectType = input.effectiveSubjectType ?? requestedSubjectType;
  const effectiveSubjectId = input.effectiveSubjectId ?? requestedSubjectId;
  return {
    allowed, resolution: allowed ? "allowed" : "quarantined", recordClass: input.recordClass,
    requestedSubjectType, requestedSubjectId, effectiveSubjectType, effectiveSubjectId,
    reasonCodes: reasonCodes.length ? reasonCodes : allowed ? [] : ["SUBJECT_MISSING"],
    provenance, identity, organizationLink, relationship, dependencyVector: vector,
    dependencyFingerprint: canonicalDependencyFingerprint(vector),
    policyFingerprint: commercialPurposePolicyFingerprint(purposePolicy),
    policyVersion: CRO02_POLICY_VERSION, schemaVersion: CRO02_SCHEMA_VERSION, mode: "shadow",
  };
}

function legacyPurpose(effect: CommercialEffect): ClassificationPurpose {
  if (effect === "inbound_transactional_acknowledgement" || effect === "account_transactional") return "transactional_response";
  if (effect === "internal_test") return "internal_test";
  if (effect === "financial_payout") return "financial_payout";
  return effect === "commercial_reporting" ? "commercial_reporting" : "marketing_outreach";
}

export async function authorizeCommercialUse(input: {
  subjectType?: ClassificationSubjectType; subjectId: number; effect: CommercialEffect;
  inboundRequestId?: string; intendedRecipientId?: number;
  observationScope?: "all" | "owned_or_unassigned";
}) {
  const subjectType = input.subjectType ?? "contact";
  const legacyDecision = await authorizeUse({
    subjectType, subjectId: input.subjectId, purpose: legacyPurpose(input.effect),
  });
  let shadowDecision: ShadowDecision;
  try {
    // Passive dual-read observation must not create retained snapshots or
    // aggregate writes on live authorization paths. Explicit command/evidence
    // workflows opt into snapshot persistence separately.
    shadowDecision = await resolveCommercialGraph({ ...input, subjectType, persist: false });
  } catch {
    const recordClass = await getCurrentClass(subjectType, input.subjectId)
      .catch(() => "unknown" as CommercialClass);
    const failed = decideCommercialEffect({
      effect: input.effect, recordClass, requestedSubjectType: subjectType,
      requestedSubjectId: input.subjectId, effectiveSubjectType: subjectType,
      effectiveSubjectId: input.subjectId, identity: "conflicted",
    });
    shadowDecision = { ...failed, allowed: false, resolution: "quarantined",
      reasonCodes: ["PURPOSE_POLICY_INVALID"], policyVersion: 0, policyFingerprint: "" };
  }
  return {
    legacyDecision, shadowDecision, effectiveDecision: legacyDecision,
    discrepancyCode: legacyDecision.allowed === shadowDecision.allowed ? null
      : legacyDecision.allowed ? "LEGACY_ALLOWED_CRO02_QUARANTINED"
      : "LEGACY_DENIED_CRO02_ALLOWED",
  };
}

/**
 * Bounded observer for already actor-scoped consumer result sets. The legacy
 * decision remains effective for every item; observation failures are isolated
 * by authorizeCommercialUse and never alter the returned decisions.
 */
export async function authorizeCommercialUseBatch(input: {
  subjects: ReadonlyArray<{ subjectType?: ClassificationSubjectType; subjectId: number }>;
  effect: CommercialEffect; observationScope?: "all" | "owned_or_unassigned";
  maxSubjects?: number; concurrency?: number;
}) {
  const maxSubjects = Math.min(Math.max(input.maxSubjects ?? 500, 1), 2_000);
  if (input.subjects.length > maxSubjects) throw new Error("CRO02_OBSERVATION_BOUND_EXCEEDED");
  const concurrency = Math.min(Math.max(input.concurrency ?? 8, 1), 32);
  const results = new Array<Awaited<ReturnType<typeof authorizeCommercialUse>>>(input.subjects.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, input.subjects.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= input.subjects.length) break;
      const subject = input.subjects[index];
      results[index] = await authorizeCommercialUse({
        ...subject, effect: input.effect, observationScope: input.observationScope,
      });
    }
  }));
  return results;
}

/** Set-based candidate selection plus bounded graph observations for aggregates. */
export async function observeCommercialReportingPopulation(input: {
  subjectType: "contact" | "deal";
  actor?: { role?: string; email?: string | null };
  limit?: number;
  effect?: CommercialEffect;
}) {
  const limit = Math.min(Math.max(input.limit ?? 2_000, 1), 2_000);
  const isPrivileged = !input.actor || input.actor.role === "admin" || input.actor.role === "manager";
  const selected = input.subjectType === "contact"
    ? rows(await db.execute(sql`SELECT id FROM contacts
        WHERE archived_at IS NULL
          AND (${isPrivileged} OR assigned_to IS NULL OR assigned_to=${input.actor?.email ?? ""})
        ORDER BY id LIMIT ${limit}`))
    : rows(await db.execute(sql`SELECT id FROM deals
        WHERE archived_at IS NULL
          AND (${isPrivileged} OR owner IS NULL OR LOWER(owner)=LOWER(${input.actor?.email ?? ""}))
        ORDER BY id LIMIT ${limit}`));
  return authorizeCommercialUseBatch({
    subjects: selected.map((row) => ({ subjectType: input.subjectType, subjectId: Number(row.id) })),
    effect: input.effect ?? "commercial_reporting",
    observationScope: isPrivileged ? "all" : "owned_or_unassigned",
    maxSubjects: limit,
  });
}

export function assertCro02ShadowOnly(mode: string | undefined = process.env.CRO02_MODE): void {
  if (mode && mode !== "shadow") throw new Error("CRO02_SHADOW_ONLY: compare/enforce requires separately approved cutover");
}
export async function assertCro02PurposePolicies(): Promise<void> {
  const found = rows(await db.execute(sql`SELECT purpose,policy_version,required_edges,mode
    FROM commercial_purpose_policies WHERE policy_version=${CRO02_POLICY_VERSION} ORDER BY purpose`));
  const effects = Object.keys(CRO02_PURPOSE_POLICY_DOCUMENTS) as CommercialEffect[];
  if (found.length !== effects.length) throw new Error("CRO02_PURPOSE_POLICY_SET_INVALID");
  for (const effect of effects) {
    const matches = found.filter(row => row.purpose === effect);
    if (matches.length !== 1 || !parsePurposePolicy(matches[0], effect)) {
      throw new Error(`CRO02_PURPOSE_POLICY_INVALID:${effect}`);
    }
  }
}

const vectorForRevisions = (subjects: any[], memberships: any[]): DependencyVectorEntry[] => [
  ...subjects.map(r => ({
    objectType: r.subject_type, objectId: r.subject_id,
    revision: Number(r.revision), authorityVersion: Number(r.authority_version),
  })),
  ...memberships.map(m => ({
    objectType: `membership:${m.edge_type}`,
    objectId: `${m.left_subject_type}:${m.left_subject_id}:${m.right_subject_type}:${m.right_subject_id}`,
    revision: Number(m.revision), authorityVersion: Number(m.authority_version),
  })),
];

export async function resolveCommercialGraph(input: {
  contactId?: number; subjectType?: ClassificationSubjectType; subjectId?: number;
  effect: CommercialEffect; inboundRequestId?: string; intendedRecipientId?: number;
  persist?: boolean; transaction?: Executor; expectedFingerprint?: string;
}): Promise<ShadowDecision> {
  const requestedType = input.subjectType ?? "contact";
  const requestedId = input.subjectId ?? input.contactId;
  if (!requestedId) {
    const failed = decideCommercialEffect({
      effect: input.effect, recordClass: "unknown",
      requestedSubjectType: requestedType, requestedSubjectId: 0,
    });
    return { ...failed, allowed: false, resolution: "quarantined",
      reasonCodes: ["SUBJECT_MISSING"], policyVersion: 0, policyFingerprint: "" };
  }
  const run = async (tx: Executor, retryOnDiscoveryDrift = false) => {
    // The singleton control row is configuration metadata, not an observation
    // mutex. Passive authorization must never serialize globally on it.
    const lockPolicy = Boolean(input.persist || input.transaction || input.expectedFingerprint);
    const policyRows = rows(await tx.execute(sql`SELECT * FROM commercial_purpose_policies
      WHERE purpose=${input.effect} AND policy_version=${CRO02_POLICY_VERSION}
      ${lockPolicy ? sql`FOR UPDATE` : sql``}`));
    const purposePolicy = policyRows.length === 1 ? parsePurposePolicy(policyRows[0], input.effect) : null;
    if (!purposePolicy) {
      const failed = decideCommercialEffect({
        effect: input.effect, recordClass: "unknown", requestedSubjectType: requestedType,
        requestedSubjectId: requestedId, effectiveSubjectType: requestedType, effectiveSubjectId: requestedId,
      });
      return { ...failed, allowed: false, resolution: "quarantined" as const,
        reasonCodes: ["PURPOSE_POLICY_INVALID"], policyVersion: 0, policyFingerprint: "" };
    }

    const discoverContactRedirect = async (startId: number) => {
      let currentId = startId;
      const chain = [startId];
      let conflict = false;
      const visited = new Set(chain);
      for (let depth = 0; depth < 8; depth++) {
        const found = rows(await tx.execute(sql`SELECT r.id,r.survivor_contact_id,r.operation_id
          FROM contact_merge_redirects r JOIN contact_merge_operations o ON o.id=r.operation_id
          WHERE r.deprecated_contact_id=${currentId} AND r.active
            AND o.status IN ('completed','reconciliation_pending') ORDER BY r.id`));
        if (found.length > 1) { conflict = true; break; }
        if (!found.length) break;
        const next = Number(found[0].survivor_contact_id);
        if (visited.has(next) || depth === 7) { conflict = true; break; }
        visited.add(next); chain.push(next); currentId = next;
      }
      return { startId, effectiveId: currentId, chain, conflict };
    };
    const discoverCommittedContactRedirect = async (startId: number) => {
      let currentId = startId;
      const chain = [startId];
      let conflict = false;
      const visited = new Set(chain);
      for (let depth = 0; depth < 8; depth++) {
        const found = (await pool.query(`SELECT r.id,r.survivor_contact_id,r.operation_id
          FROM contact_merge_redirects r JOIN contact_merge_operations o ON o.id=r.operation_id
          WHERE r.deprecated_contact_id=$1 AND r.active
            AND o.status IN ('completed','reconciliation_pending') ORDER BY r.id`, [currentId])).rows;
        if (found.length > 1) { conflict = true; break; }
        if (!found.length) break;
        const next = Number(found[0].survivor_contact_id);
        if (visited.has(next) || depth === 7) { conflict = true; break; }
        visited.add(next); chain.push(next); currentId = next;
      }
      return { startId, effectiveId: currentId, chain, conflict };
    };
    const redirectDiscoveries: Array<Awaited<ReturnType<typeof discoverContactRedirect>>> = [];
    let effectiveId = requestedId;
    const redirectChain = [requestedId];
    let redirectConflict = false;
    if (requestedType === "contact") {
      const discovery = await discoverContactRedirect(requestedId);
      redirectDiscoveries.push(discovery);
      effectiveId = discovery.effectiveId;
      redirectChain.splice(0, redirectChain.length, ...discovery.chain);
      redirectConflict = discovery.conflict;
    }

    const root = rows(await tx.execute(sql`SELECT * FROM ${sql.identifier(tables[requestedType])}
      WHERE id=${effectiveId}`))[0];
    const reasons: string[] = [];
    if (!root) reasons.push("SUBJECT_MISSING");
    const rootRefs: Array<{ type: ClassificationSubjectType; id: number; required: boolean }> =
      [{ type: requestedType, id: effectiveId, required: true }];
    if (requestedType === "deal" && root) {
      const dealRootCount = Number(!!root.contact_id) + Number(!!root.company_id);
      const rule = purposePolicy.edges.dealRoots;
      if (rule.required && (dealRootCount < rule.min || (rule.max !== null && dealRootCount > rule.max))) reasons.push("REQUIRED_LINK_MISSING");
      if (root.contact_id) rootRefs.push({ type: "contact", id: Number(root.contact_id), required: rule.required });
      if (root.company_id) rootRefs.push({ type: "company", id: Number(root.company_id), required: rule.required });
    }
    if (requestedType === "prospect" && root) {
      const contactId = root.conversion_contact_id ?? root.contact_id;
      const count = Number(!!contactId);
      const rule = purposePolicy.edges.prospectContact;
      if (rule.required && (count < rule.min || (rule.max !== null && count > rule.max))) reasons.push("REQUIRED_LINK_MISSING");
      if (contactId) rootRefs.push({ type: "contact", id: Number(contactId), required: false });
    }
    // Deal/prospect contact dependencies consume the same bounded BT-07
    // redirect authority as a directly requested contact.
    if (requestedType !== "contact") {
      for (const ref of rootRefs.filter(r => r.type === "contact")) {
        const discovery = await discoverContactRedirect(ref.id);
        redirectDiscoveries.push(discovery);
        redirectConflict ||= discovery.conflict;
        ref.id = discovery.effectiveId;
      }
    }
    rootRefs.sort((a, b) => ranks[a.type] - ranks[b.type] || a.id - b.id);
    const graphNodes = [
      ...rootRefs.map(ref => ({ type: ref.type, id: ref.id })),
      ...redirectDiscoveries.flatMap(discovery =>
        discovery.chain.map(id => ({ type: "contact" as const, id }))),
    ].filter((node, index, all) =>
      all.findIndex(candidate => candidate.type === node.type && candidate.id === node.id) === index);
    graphNodes.sort((a, b) => ranks[a.type] - ranks[b.type] || a.id - b.id);
    const keys = graphNodes.map(r => `${r.type}:${r.id}`);
    const keyList = sql.join(keys.map(key => sql`${key}`), sql`, `);

    // Shared total order: typed nodes, membership-set sentinels, revisions,
    // then domain rows. All graph writers use the same namespace and hash.
    await lockCommercialGraph(tx, graphNodes, [
      "contact_business", "contact_redirect", "identity",
      "legacy_company_business", "relationship",
    ]);
    let graphDiscoveryDrift = false;
    for (const discovery of redirectDiscoveries) {
      const current = await discoverContactRedirect(discovery.startId);
      const committed = await discoverCommittedContactRedirect(discovery.startId);
      if (current.conflict !== discovery.conflict ||
          current.effectiveId !== discovery.effectiveId ||
          current.chain.join(":") !== discovery.chain.join(":") ||
          committed.conflict !== discovery.conflict ||
          committed.effectiveId !== discovery.effectiveId ||
          committed.chain.join(":") !== discovery.chain.join(":")) {
        graphDiscoveryDrift = true;
      }
    }
    if (graphDiscoveryDrift) {
      if (retryOnDiscoveryDrift) throw new Error("CRO02_GRAPH_DISCOVERY_DRIFT");
      reasons.push("STALE_GRAPH");
    }
    const subjectRevisions = rows(await tx.execute(sql`SELECT * FROM commercial_subject_revisions
      WHERE (subject_type || ':' || subject_id::text) IN (${keyList})
      ORDER BY CASE subject_type WHEN 'contact' THEN 1 WHEN 'deal' THEN 2 WHEN 'prospect' THEN 3 WHEN 'company' THEN 4 ELSE 5 END,subject_id FOR UPDATE`));
    const memberships = rows(await tx.execute(sql`SELECT * FROM commercial_membership_revisions
      WHERE (left_subject_type || ':' || left_subject_id::text) IN (${keyList})
         OR (right_subject_type || ':' || right_subject_id::text) IN (${keyList})
      ORDER BY edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id FOR UPDATE`));
    const lockedRoots = new Map<string, any>();
    for (const ref of rootRefs) {
      const row = rows(await tx.execute(sql`SELECT * FROM ${sql.identifier(tables[ref.type])}
        WHERE id=${ref.id} FOR UPDATE`))[0];
      lockedRoots.set(`${ref.type}:${ref.id}`, row);
      if (!row && ref.required) reasons.push("DANGLING_LINK");
      if (row && ref.type !== requestedType && ref.required && row.record_class !== "production") reasons.push("ROOT_CLASS_CONFLICT");
    }

    const contactIds = [...new Set(rootRefs.filter(r => r.type === "contact").map(r => r.id))];
    const contactIdList = sql.join(contactIds.map(id => sql`${id}`), sql`, `);
    const graphContactIds = [...new Set(graphNodes.filter(r => r.type === "contact").map(r => r.id))];
    const graphContactIdList = sql.join(graphContactIds.map(id => sql`${id}`), sql`, `);
    const redirectRows = graphContactIds.length ? rows(await tx.execute(sql`SELECT r.*,o.status AS operation_status
      FROM contact_merge_redirects r JOIN contact_merge_operations o ON o.id=r.operation_id
      WHERE r.deprecated_contact_id IN (${graphContactIdList}) OR r.survivor_contact_id IN (${graphContactIdList})
      ORDER BY r.deprecated_contact_id,r.survivor_contact_id,r.id FOR UPDATE`)) : [];
    const identityRows = contactIds.length ? rows(await tx.execute(sql`SELECT * FROM contact_identity_observations
      WHERE contact_id IN (${contactIdList}) AND superseded_at IS NULL
      ORDER BY contact_id,identity_kind,id FOR UPDATE`)) : [];
    const collisions = contactIds.length ? rows(await tx.execute(sql`SELECT mine.id
      FROM contact_identity_observations mine JOIN contact_identity_observations other
        ON other.identity_kind=mine.identity_kind AND other.lookup_token=mine.lookup_token
       AND other.contact_id<>mine.contact_id
      WHERE mine.contact_id IN (${contactIdList}) AND mine.eligibility='eligible'
        AND other.eligibility='eligible' AND mine.superseded_at IS NULL
        AND other.superseded_at IS NULL ORDER BY mine.id FOR UPDATE OF mine`)) : [];
    const links = contactIds.length ? rows(await tx.execute(sql`SELECT * FROM contact_business_link_decisions
      WHERE contact_id IN (${contactIdList}) AND superseded_at IS NULL
      ORDER BY contact_id,business_id,id FOR UPDATE`)) : [];

    const companyIds = [...new Set(rootRefs.filter(r => r.type === "company").map(r => r.id))];
    const companyIdList = sql.join(companyIds.map(id => sql`${id}`), sql`, `);
    const mappings = companyIds.length ? rows(await tx.execute(sql`SELECT * FROM legacy_company_mapping_decisions
      WHERE company_id IN (${companyIdList}) AND superseded_at IS NULL
      ORDER BY company_id,business_id,id FOR UPDATE`)) : [];
    const businessIds = [...new Set([...links, ...mappings]
      .map(r => Number(r.business_id)).filter(Number.isInteger))].sort((a, b) => a - b);
    const businessIdList = sql.join(businessIds.map(id => sql`${id}`), sql`, `);
    for (const businessId of businessIds) {
      const business = rows(await tx.execute(sql`SELECT id,record_class FROM businesses
        WHERE id=${businessId} FOR UPDATE`))[0];
      const businessRequired = purposePolicy.axes.organizationLink === "required";
      if (!business && businessRequired) reasons.push("DANGLING_LINK");
      else if (business && businessRequired && business.record_class !== "production") reasons.push("ROOT_CLASS_CONFLICT");
    }
    const reviews = contactIds.length && businessIds.length
      ? rows(await tx.execute(sql`SELECT * FROM commercial_relationship_reviews
          WHERE contact_id IN (${contactIdList}) AND business_id IN (${businessIdList})
            AND superseded_at IS NULL ORDER BY contact_id,business_id,id FOR UPDATE`)) : [];
    const sourcePointers = rootRefs.filter(ref => ref.type === "contact")
      .map(ref => lockedRoots.get(`contact:${ref.id}`))
      .filter(Boolean).map(contact => Number(contact.primary_source_event_id))
      .filter(Number.isInteger);
    const sourcePointerList = sql.join(sourcePointers.map(id => sql`${id}`), sql`, `);
    const sourceRows = sourcePointers.length
      ? rows(await tx.execute(sql`SELECT * FROM contact_source_events
          WHERE id IN (${sourcePointerList}) ORDER BY contact_id,id FOR UPDATE`)) : [];

    if (purposePolicy.axes.identity === "required"
        && (redirectConflict || redirectRows.some(r => r.operation_status === "reconciliation_pending"))) reasons.push("REDIRECT_UNRESOLVED");
    if (purposePolicy.axes.identity === "required" && collisions.length) reasons.push("IDENTITY_COLLISION");
    const effectiveLinks = links.filter(r => Number(r.contact_id) === effectiveId);
    const isReviewedVerifiedLink = (link: any) =>
      link.decision === "verified" && Boolean(link.evidence_source_event_id)
      && Boolean(link.reviewed_by) && Boolean(link.reviewed_at);
    if (requestedType === "contact" && purposePolicy.edges.contactBusiness.required) {
      const rule = purposePolicy.edges.contactBusiness;
      if (effectiveLinks.length < rule.min || (rule.max !== null && effectiveLinks.length > rule.max)) reasons.push("REQUIRED_LINK_MISSING");
      else if (effectiveLinks.some(link => !isReviewedVerifiedLink(link))) reasons.push("BUSINESS_LINK_UNRESOLVED");
    }
    if ((requestedType === "company" || companyIds.length) && purposePolicy.edges.companyBusiness.required) {
      const rule = purposePolicy.edges.companyBusiness;
      if (mappings.length < rule.min || (rule.max !== null && mappings.length > rule.max)) reasons.push("REQUIRED_LINK_MISSING");
      else if (mappings.some(r => r.decision !== "verified")) reasons.push("BUSINESS_LINK_UNRESOLVED");
    }
    if (contactIds.length && businessIds.length && purposePolicy.edges.relationshipReviews.required) {
      const rule = purposePolicy.edges.relationshipReviews;
      if (reviews.length < rule.min || (rule.max !== null && reviews.length > rule.max)) reasons.push("RELATIONSHIP_UNKNOWN");
    }
    for (const ref of rootRefs.filter(ref => ref.type === "contact")) {
      const contact = lockedRoots.get(`contact:${ref.id}`);
      if (contact?.primary_source_event_id && !sourceRows.some(source =>
        Number(source.id) === Number(contact.primary_source_event_id)
        && Number(source.contact_id) === ref.id)
        && purposePolicy.axes.provenance === "required") reasons.push("EVIDENCE_INVALID");
    }

    const vector: DependencyVectorEntry[] = [
      { objectType: "policy", objectId: `${input.effect}:${commercialPurposePolicyFingerprint(purposePolicy)}`,
        revision: CRO02_POLICY_VERSION, authorityVersion: CRO02_SCHEMA_VERSION },
      ...graphNodes.map(ref => {
        const revision = subjectRevisions.find(r => r.subject_type === ref.type && Number(r.subject_id) === ref.id);
        return { objectType: ref.type, objectId: ref.id, revision: revision ? Number(revision.revision) : -1, authorityVersion: revision ? Number(revision.authority_version) : 1 };
      }),
      ...memberships.map(m => ({ objectType: `membership:${m.edge_type}`, objectId: `${m.left_subject_type}:${m.left_subject_id}:${m.right_subject_type}:${m.right_subject_id}`, revision: Number(m.revision), authorityVersion: Number(m.authority_version) })),
      ...sourceRows.map(source => ({ objectType: "source", objectId: source.id, revision: 1, authorityVersion: 1 })),
      ...redirectRows.map(r => ({ objectType: "redirect", objectId: r.id, revision: r.active ? 1 : 0, authorityVersion: 1 })),
      ...identityRows.map(r => ({ objectType: "identity", objectId: r.id, revision: Number(r.normalization_version), authorityVersion: 1 })),
      ...links.map(r => ({ objectType: "link", objectId: r.id, revision: Number(r.revision), authorityVersion: 1 })),
      ...mappings.map(r => ({ objectType: "mapping", objectId: r.id, revision: Number(r.revision), authorityVersion: 1 })),
      ...reviews.map(r => ({ objectType: "relationship", objectId: r.id, revision: Number(r.revision), authorityVersion: 1 })),
    ];
    const provenance: CommercialProvenanceResolution = !sourcePointers.length
      ? "untraceable" : sourceRows.length === sourcePointers.length ? "verified" : "invalid";
    const identity: CommercialIdentityResolution = redirectConflict ? "conflicted"
      : collisions.length ? "collision"
      : identityRows.some(r => r.eligibility === "eligible") ? "resolved" : "unresolved";
    const organizationLink: CommercialOrganizationLinkResolution =
      effectiveLinks.length === 1
        ? (isReviewedVerifiedLink(effectiveLinks[0]) ? "verified"
          : effectiveLinks[0].decision === "verified" ? "legacy_unknown" : effectiveLinks[0].decision)
      : mappings.length === 1 ? mappings[0].decision
      : effectiveLinks.length + mappings.length > 1 ? "conflicted" : "missing";
    const relationship: CommercialRelationshipResolution =
      reviews.length === 1 ? reviews[0].decision : reviews.length > 1 ? "conflicted" : "unknown";
    let decision = decideCommercialEffect({
      effect: input.effect, recordClass: (root?.record_class as CommercialClass) ?? "unknown",
      inboundRequestId: input.inboundRequestId, intendedRecipientId: input.intendedRecipientId,
      requestedSubjectType: requestedType, requestedSubjectId: requestedId,
      effectiveSubjectType: requestedType, effectiveSubjectId: effectiveId,
      provenance, identity, organizationLink, relationship, vector, policyDocument: purposePolicy,
    });
    if (reasons.length) decision = {
      ...decision, allowed: false, resolution: "quarantined",
      reasonCodes: [...new Set([...decision.reasonCodes, ...reasons])],
    };

    // Full revision-vector reread catches changed/deleted/new membership rows.
    const subjectsAgain = rows(await tx.execute(sql`SELECT * FROM commercial_subject_revisions
      WHERE (subject_type || ':' || subject_id::text) IN (${keyList})`));
    const membershipsAgain = rows(await tx.execute(sql`SELECT * FROM commercial_membership_revisions
      WHERE (left_subject_type || ':' || left_subject_id::text) IN (${keyList})
         OR (right_subject_type || ':' || right_subject_id::text) IN (${keyList})`));
    if (canonicalDependencyFingerprint(vectorForRevisions(subjectRevisions, memberships))
        !== canonicalDependencyFingerprint(vectorForRevisions(subjectsAgain, membershipsAgain))
        || (input.expectedFingerprint && input.expectedFingerprint !== decision.dependencyFingerprint)) {
      decision = { ...decision, allowed: false, resolution: "quarantined",
        reasonCodes: [...new Set([...decision.reasonCodes, "STALE_GRAPH"])] };
    }

    if (input.persist && root && !graphDiscoveryDrift) {
      const snapshot = rows(await tx.execute(sql`INSERT INTO commercial_resolution_snapshots
        (requested_subject_type,requested_subject_id,effective_subject_type,effective_subject_id,purpose,
         policy_version,schema_version,mode,resolution,record_class,provenance_resolution,
         identity_resolution,organization_link_resolution,relationship_resolution,reason_codes,dependency_fingerprint)
        VALUES(${requestedType},${requestedId},${requestedType},${effectiveId},${input.effect},
         ${CRO02_POLICY_VERSION},${CRO02_SCHEMA_VERSION},'shadow',${decision.resolution},${decision.recordClass},
         ${provenance},${identity},${organizationLink},${relationship},
         ${JSON.stringify(decision.reasonCodes)}::jsonb,${decision.dependencyFingerprint}) RETURNING id`))[0];
      for (const entry of vector) await tx.execute(sql`INSERT INTO commercial_resolution_dependencies
        (snapshot_id,object_type,object_id,revision,authority_version,rank)
        VALUES(${snapshot.id}::uuid,${entry.objectType},${String(entry.objectId)},${entry.revision},
          ${entry.authorityVersion},${ranks[entry.objectType] ?? 100})`);
      decision.snapshotId = String(snapshot.id);
    }
    return decision;
  };
  if (input.transaction) return run(input.transaction);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        (tx: any) => run(tx, true),
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      const code = (error as any)?.code ?? (error as any)?.cause?.code;
      if ((error instanceof Error && error.message === "CRO02_GRAPH_DISCOVERY_DRIFT") || code === "40001") continue;
      throw error;
    }
  }
  throw new Error("CRO02_GRAPH_RETRY_EXHAUSTED");
}