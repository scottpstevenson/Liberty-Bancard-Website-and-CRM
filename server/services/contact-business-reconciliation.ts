import crypto from "node:crypto";
import { pool } from "../db";
import { auditChange } from "./audit-change";
import { recordContactBusinessLinkCandidate } from "./commercial-link-authority";

const WORKFLOW = "indexed_contact_business_suggestions_v1";
const CHECKPOINT_ACTION = "contact_business_reconciliation_checkpoint";
const PAGE_LIMIT_MAX = 100;
const SHARED_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com",
  "hotmail.com", "live.com", "aol.com", "icloud.com", "me.com", "msn.com",
  "proton.me", "protonmail.com", "mail.com", "comcast.net", "att.net",
]);
const LEGAL_SUFFIXES = /\b(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\b/g;
let localReconciliationLock = false;

export interface ContactBusinessSuggestionState {
  workflow?: string;
  jobId: string;
  status: "idle" | "running" | "ready" | "paused" | "completed" | "error";
  cursorContactId: number;
  scannedContacts: number;
  suggestionsRecorded: number;
  ambiguousContacts: number;
  unmatchedContacts: number;
  batchSize: number;
  startedAt: string | null;
  updatedAt: string;
  lastError: string | null;
}

export interface ContactBusinessMatchInput {
  companyName: string | null | undefined;
  email: string | null | undefined;
  website: string | null | undefined;
}

export interface ContactBusinessDomainMatch {
  businessId: number;
  canonicalName: string;
  normalizedName: string;
  websiteDomain: string;
}

export function normalizeBusinessName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[&+]/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBusinessDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    return host && !host.includes(" ") ? host : null;
  } catch {
    return null;
  }
}

export function contactBusinessNameCorroborates(
  contactName: string | null | undefined,
  businessName: string | null | undefined,
): boolean {
  const contact = normalizeBusinessName(contactName);
  const business = normalizeBusinessName(businessName);
  if (contact.length < 4 || business.length < 4) return false;
  if (contact === business) return true;
  const contactTokens = new Set(contact.split(" ").filter(token => token.length > 1));
  const businessTokens = new Set(business.split(" ").filter(token => token.length > 1));
  if (contactTokens.size < 2 || businessTokens.size < 2) return false;
  const shared = [...contactTokens].filter(token => businessTokens.has(token)).length;
  return shared / Math.min(contactTokens.size, businessTokens.size) >= 0.8;
}

export function matchContactToBusinesses(
  contact: ContactBusinessMatchInput,
  domainBusinesses: ContactBusinessDomainMatch[],
): { matches: Array<{ business: ContactBusinessDomainMatch; confidence: number }>; ambiguous: boolean } {
  const emailDomain = normalizeBusinessDomain(contact.email?.split("@").at(-1));
  const websiteDomain = normalizeBusinessDomain(contact.website);
  const eligibleDomains = new Set<string>();
  if (websiteDomain) eligibleDomains.add(websiteDomain);
  if (emailDomain && !SHARED_EMAIL_DOMAINS.has(emailDomain)) eligibleDomains.add(emailDomain);
  const sameDomain = domainBusinesses.filter(business => {
    const domain = normalizeBusinessDomain(business.websiteDomain);
    return Boolean(domain && eligibleDomains.has(domain));
  });
  const matches = sameDomain
    .filter(business => contactBusinessNameCorroborates(contact.companyName, business.normalizedName)
      || contactBusinessNameCorroborates(contact.companyName, business.canonicalName))
    .map(business => ({
      business,
      // Confidence reflects name corroboration, not a winner chosen from a shared domain.
      confidence: normalizeBusinessName(contact.companyName)
        === normalizeBusinessName(business.normalizedName)
        || normalizeBusinessName(contact.companyName) === normalizeBusinessName(business.canonicalName)
        ? 90 : 80,
    }));
  return { matches, ambiguous: sameDomain.length > 1 || matches.length > 1 };
}

function boundedLimit(value: number | undefined, fallback = 50): number {
  return Math.max(1, Math.min(PAGE_LIMIT_MAX, Math.trunc(value ?? fallback)));
}

function asState(details: unknown): ContactBusinessSuggestionState | null {
  const state = details as Partial<ContactBusinessSuggestionState> | null;
  if (!state || typeof state !== "object" || typeof state.jobId !== "string"
      || !["idle", "running", "ready", "paused", "completed", "error"].includes(String(state.status))) return null;
  return state as ContactBusinessSuggestionState;
}

async function loadState(): Promise<ContactBusinessSuggestionState | null> {
  const { rows } = await pool.query<{ details: unknown }>(`
    SELECT details
      FROM audit_logs
     WHERE action = $1 AND entity_type = 'contact_business_reconciliation'
     ORDER BY id DESC
     LIMIT 1
  `, [CHECKPOINT_ACTION]);
  const details = rows[0]?.details;
  const state = asState(details);
  return state?.workflow === WORKFLOW ? state : null;
}

async function saveState(state: ContactBusinessSuggestionState, actorId: string | null = null) {
  await auditChange({
    userId: actorId,
    actorType: actorId ? "user" : "system",
    actorId,
    action: CHECKPOINT_ACTION,
    entityType: "contact_business_reconciliation",
    entityKey: WORKFLOW,
    details: { ...state, workflow: WORKFLOW },
  });
}

async function withReconciliationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (localReconciliationLock) throw new Error("CONTACT_BUSINESS_RECONCILIATION_ALREADY_RUNNING");
  localReconciliationLock = true;
  const client = await pool.connect().catch((error: unknown) => {
    localReconciliationLock = false;
    throw error;
  });
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [WORKFLOW],
    );
    acquired = Boolean(lock.rows[0]?.acquired);
    if (!acquired) throw new Error("CONTACT_BUSINESS_RECONCILIATION_ALREADY_RUNNING");
    return await operation();
  } finally {
    try {
      if (acquired) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [WORKFLOW]).catch(() => {});
    } finally {
      client.release();
      localReconciliationLock = false;
    }
  }
}

async function getContactBatch(afterId: number, limit: number) {
  const { rows } = await pool.query(`
    SELECT id, company_name, email, website
      FROM contacts
     WHERE id > $1
       AND business_id IS NULL
       AND archived_at IS NULL
       AND record_class NOT IN ('test', 'demo', 'synthetic')
     ORDER BY id
     LIMIT $2
  `, [afterId, limit]);
  return rows as Array<{ id: number; company_name: string | null; email: string; website: string | null }>;
}

async function discoverContactMatches(contact: {
  id: number;
  company_name: string | null;
  email: string;
  website: string | null;
}, persistCandidates = true) {
  const domains = new Set<string>();
  const emailDomain = normalizeBusinessDomain(contact.email?.split("@").at(-1));
  const websiteDomain = normalizeBusinessDomain(contact.website);
  if (websiteDomain) domains.add(websiteDomain);
  if (emailDomain && !SHARED_EMAIL_DOMAINS.has(emailDomain)) domains.add(emailDomain);
  if (domains.size === 0 || !normalizeBusinessName(contact.company_name)) return { count: 0, ambiguous: false };

  // Exact indexed domain probe only. We never form a contact × Sunbiz Cartesian join.
  const { rows } = await pool.query<ContactBusinessDomainMatch>(`
    SELECT id AS "businessId", canonical_name AS "canonicalName",
           normalized_name AS "normalizedName", website_domain AS "websiteDomain"
      FROM businesses
     WHERE website_domain = ANY($1::text[])
       AND record_class NOT IN ('test', 'demo', 'synthetic')
     ORDER BY id
     LIMIT 21
  `, [[...domains]]);
  if (rows.length > 20) return { count: 0, ambiguous: true };
  const result = matchContactToBusinesses({
    companyName: contact.company_name,
    email: contact.email,
    website: contact.website,
  }, rows.map(row => ({
    businessId: Number(row.businessId),
    canonicalName: row.canonicalName,
    normalizedName: row.normalizedName,
    websiteDomain: row.websiteDomain,
  })));
  for (const match of persistCandidates ? result.matches : []) {
    const candidateKey = crypto.createHash("sha256")
      .update(`${WORKFLOW}:${contact.id}:${match.business.businessId}`)
      .digest("hex");
    await recordContactBusinessLinkCandidate({
      contactId: Number(contact.id),
      businessId: match.business.businessId,
      source: "sdr_orchestration",
      sourceVersion: WORKFLOW,
      candidateKey,
      confidence: match.confidence,
    });
  }
  return { count: result.matches.length, ambiguous: result.ambiguous };
}

export async function previewContactBusinessReconciliation(limit = 25) {
  const batchSize = boundedLimit(limit);
  const contacts = await getContactBatch(0, batchSize);
  let suggested = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const contact of contacts) {
    const matches = await discoverContactMatches(contact, false);
    suggested += matches.count;
    if (matches.ambiguous) ambiguous += 1;
    if (matches.count === 0) unmatched += 1;
  }
  return {
    mode: "bounded_read_only_preview",
    sampleLimit: batchSize,
    sampledContacts: contacts.length,
    sampleSuggestions: suggested,
    sampleAmbiguousContacts: ambiguous,
    sampleUnmatchedContacts: unmatched,
    eligibleUnlinkedContacts: null,
    totalCountStatus: "not_counted_to_keep_preview_bounded",
    paidProviderCalls: 0,
    writes: 0,
    note: "Preview performs indexed matching only and does not persist candidates or decisions.",
  };
}

async function processOnePage(state: ContactBusinessSuggestionState, actorId: string | null) {
  try {
    const page = await getContactBatch(state.cursorContactId, state.batchSize);
    if (page.length === 0) {
      state.status = "completed";
      state.lastError = null;
      state.updatedAt = new Date().toISOString();
      await saveState(state, actorId);
      return state;
    }
    let pageSuggestions = 0;
    let pageAmbiguous = 0;
    let pageUnmatched = 0;
    for (const contact of page) {
      const matches = await discoverContactMatches(contact);
      pageSuggestions += matches.count;
      if (matches.ambiguous) pageAmbiguous += 1;
      if (matches.count === 0) pageUnmatched += 1;
    }
    state.cursorContactId = Number(page[page.length - 1].id);
    state.scannedContacts += page.length;
    state.suggestionsRecorded += pageSuggestions;
    state.ambiguousContacts += pageAmbiguous;
    state.unmatchedContacts += pageUnmatched;
    // The workflow is operator-stepped: one bounded keyset page per start or
    // resume request. "ready" means safely checkpointed and awaiting an operator,
    // not an invisible background worker.
    state.status = page.length < state.batchSize ? "completed" : "ready";
    state.lastError = null;
    state.updatedAt = new Date().toISOString();
    await saveState(state, actorId);
    return state;
  } catch (error) {
    state.status = "error";
    state.lastError = error instanceof Error ? error.message.slice(0, 240) : "Unknown reconciliation failure";
    state.updatedAt = new Date().toISOString();
    await saveState(state, actorId);
    throw error;
  }
}

export async function startContactBusinessReconciliation(input: { batchSize?: number; actorId: string }) {
  return withReconciliationLock(async () => {
    const current = await loadState();
    if (current?.status === "running") throw new Error("CONTACT_BUSINESS_RECONCILIATION_ALREADY_RUNNING");
    if (current && current.status !== "completed") throw new Error("CONTACT_BUSINESS_RECONCILIATION_RESUME_REQUIRED");
    const batchSize = boundedLimit(input.batchSize, 50);
    const now = new Date().toISOString();
    const state: ContactBusinessSuggestionState = {
      jobId: crypto.randomUUID(),
      status: "running",
      cursorContactId: 0,
      scannedContacts: 0,
      suggestionsRecorded: 0,
      ambiguousContacts: 0,
      unmatchedContacts: 0,
      batchSize,
      startedAt: now,
      updatedAt: now,
      lastError: null,
    };
    await saveState(state, input.actorId);
    await auditChange({
      userId: input.actorId, action: "contact_business_reconciliation_started",
      entityType: "contact_business_reconciliation", entityKey: state.jobId,
      details: { batchSize, cursorContactId: 0, paidProviderCalls: 0 },
    });
    return processOnePage(state, input.actorId);
  });
}

export async function pauseContactBusinessReconciliation(actorId: string) {
  return withReconciliationLock(async () => {
    const state = await loadState();
    if (!state) throw new Error("CONTACT_BUSINESS_RECONCILIATION_NOT_FOUND");
    if (state.status !== "completed") state.status = "paused";
    state.updatedAt = new Date().toISOString();
    await saveState(state, actorId);
    await auditChange({
      userId: actorId, action: "contact_business_reconciliation_paused",
      entityType: "contact_business_reconciliation", entityKey: state.jobId,
      details: { cursorContactId: state.cursorContactId },
    });
    return state;
  });
}

export async function resumeContactBusinessReconciliation(actorId: string) {
  return withReconciliationLock(async () => {
    const state = await loadState();
    if (!state) throw new Error("CONTACT_BUSINESS_RECONCILIATION_NOT_FOUND");
    if (state.status === "completed") throw new Error("CONTACT_BUSINESS_RECONCILIATION_ALREADY_COMPLETED");
    state.status = "running";
    state.lastError = null;
    state.updatedAt = new Date().toISOString();
    await saveState(state, actorId);
    await auditChange({
      userId: actorId, action: "contact_business_reconciliation_resumed",
      entityType: "contact_business_reconciliation", entityKey: state.jobId,
      details: { cursorContactId: state.cursorContactId },
    });
    return processOnePage(state, actorId);
  });
}

export async function getContactBusinessReconciliationProgress() {
  const state = await loadState();
  return state ?? {
    jobId: null,
    status: "idle",
    cursorContactId: 0,
    scannedContacts: 0,
    suggestionsRecorded: 0,
    ambiguousContacts: 0,
    unmatchedContacts: 0,
    batchSize: 50,
    startedAt: null,
    updatedAt: null,
    lastError: null,
  };
}

export async function listContactBusinessSuggestions(input: {
  afterCreatedAt?: string;
  afterId?: string;
  limit?: number;
}) {
  const limit = boundedLimit(input.limit);
  const afterCreatedAt = input.afterCreatedAt ?? "1970-01-01T00:00:00.000Z";
  const afterId = input.afterId ?? "00000000-0000-0000-0000-000000000000";
  const { rows } = await pool.query(`
    SELECT candidate.id AS "candidateId", candidate.contact_id AS "contactId",
           candidate.business_id AS "businessId", candidate.confidence,
           candidate.source, candidate.source_version AS "sourceVersion",
           candidate.created_at AS "createdAt",
           contact.company_name AS "contactCompanyName",
           contact.email AS "contactEmail", contact.business_id AS "projectedBusinessId",
           ARRAY_REMOVE(ARRAY[
             CASE WHEN contact.archived_at IS NOT NULL THEN 'archived' END,
             CASE WHEN contact.record_class IN ('test', 'demo', 'synthetic') THEN 'non_production_contact' END,
             CASE WHEN COALESCE(contact.existing_merchant_customer, false) THEN 'existing_customer' END,
             CASE WHEN COALESCE(contact.do_not_contact, false) OR COALESCE(contact.opted_out_email, false)
                       OR COALESCE(contact.opt_out_status, 'active') = 'opted_out'
                       OR COALESCE(contact.unsubscribe_status, 'active') = 'unsubscribed'
                       OR COALESCE(contact.bounce_status, 'none') = 'hard'
                       OR COALESCE(contact.complaint_status, 'none') = 'reported'
                       OR contact.suppression_reason IS NOT NULL THEN 'suppressed_contact' END,
             CASE WHEN business.record_class IN ('test', 'demo', 'synthetic') THEN 'non_production_business' END,
             CASE WHEN COALESCE(business.do_not_visit, false) THEN 'business_do_not_visit' END
           ], NULL) AS "safetyFlags",
           business.canonical_name AS "businessName", business.website_domain AS "businessDomain",
           count(*) OVER (PARTITION BY candidate.contact_id)::int AS "contactCandidateCount",
           (SELECT count(*)::int FROM businesses same_domain
             WHERE same_domain.website_domain = business.website_domain) AS "domainBusinessCount",
           decision.id AS "currentDecisionId", decision.decision AS "currentDecision",
           decision.revision AS "currentRevision"
      FROM current_contact_business_link_candidates candidate
      JOIN contacts contact ON contact.id = candidate.contact_id
      JOIN businesses business ON business.id = candidate.business_id
      LEFT JOIN LATERAL (
        SELECT id, decision, revision FROM contact_business_link_decisions d
         WHERE d.contact_id = candidate.contact_id AND d.superseded_at IS NULL
         ORDER BY d.revision DESC LIMIT 1
      ) decision ON true
     WHERE (candidate.created_at, candidate.id) > ($1::timestamptz, $2::uuid)
     ORDER BY candidate.created_at, candidate.id
     LIMIT $3
  `, [afterCreatedAt, afterId, limit]);
  return {
    candidates: rows.map(row => ({
      ...row,
      contactCandidateCount: Number(row.contactCandidateCount),
      domainBusinessCount: Number(row.domainBusinessCount),
      ambiguous: Number(row.contactCandidateCount) > 1 || Number(row.domainBusinessCount) > 1,
      projectedBusinessId: row.projectedBusinessId === null ? null : Number(row.projectedBusinessId),
      currentRevision: row.currentRevision === null ? 0 : Number(row.currentRevision),
      safetyFlags: row.safetyFlags ?? [],
      reviewBlocked: (row.safetyFlags ?? []).length > 0,
      isVerified: row.currentDecision === "verified"
        && Number(row.projectedBusinessId) === Number(row.businessId),
    })),
    nextCursor: rows.length ? {
      createdAt: new Date(rows[rows.length - 1].createdAt).toISOString(),
      id: rows[rows.length - 1].candidateId,
    } : null,
    limit,
  };
}

export async function assertCurrentContactBusinessSuggestion(input: {
  candidateId: string;
  contactId: number;
  businessId: number;
}) {
  const { rows } = await pool.query(`
    SELECT id, contact_id, business_id
      FROM current_contact_business_link_candidates
     WHERE id = $1::uuid AND contact_id = $2 AND business_id = $3
     LIMIT 1
  `, [input.candidateId, input.contactId, input.businessId]);
  return rows.length > 0;
}