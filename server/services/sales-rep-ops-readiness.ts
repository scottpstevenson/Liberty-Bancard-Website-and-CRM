/**
 * Sales Rep Ops Readiness Service
 *
 * Evaluates all launch-readiness gates for the Sales Rep Operations pilot.
 * Runs are idempotent by runId = SHA-256(releaseSha||configFingerprint||populationFingerprint).
 * Gate results never contain PII or secrets.
 * A mandatory FAIL forces aggregate_verdict = 'FAIL'.
 */

import { createHash } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { featureFlags } from "./feature-flags";
import { evaluateContactability } from "./contactability";
import { readFileSync } from "fs";
import { join } from "path";

export interface GateResult {
  gate: string;
  status: "PASS" | "FAIL" | "BLOCKED_EXTERNAL" | "NOT_APPLICABLE";
  reason_code: string;
  detail: string; // never PII, never secrets
}

export interface ReadinessRunOutput {
  runId: string;
  id: number;
  releaseSha: string;
  migrationHead: string;
  configFingerprint: string;
  populationFingerprint: string;
  status: "running" | "complete" | "failed";
  gateResults: GateResult[];
  aggregateVerdict: "PASS" | "FAIL" | "BLOCKED_EXTERNAL" | null;
  startedAt: string;
  completedAt: string | null;
  triggeredByUserId: string | null;
  fromCache: boolean;
}

// ─── Fingerprinting helpers ───────────────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeConfigFingerprint(): string {
  const flagSnapshot = {
    CALL_ASSIST_ENABLED: featureFlags.CALL_ASSIST_ENABLED,
    FIELD_SALES_ENABLED: featureFlags.FIELD_SALES_ENABLED,
    policyVersion: "1.0",
  };
  return sha256hex(JSON.stringify(flagSnapshot));
}

export function computePopulationFingerprint(
  pilotRepIds: string[],
  pilotContactIds: number[],
  pilotLocationIds: number[]
): string {
  // Static fingerprint: ID-set identity only.
  // Used for idempotency key when combined with the state hash (see computePopulationStateHash).
  const sorted = {
    reps: [...pilotRepIds].sort(),
    contacts: [...pilotContactIds].sort((a, b) => a - b),
    locations: [...pilotLocationIds].sort((a, b) => a - b),
  };
  return sha256hex(JSON.stringify(sorted));
}

/**
 * Queries relevant eligibility state for the given pilot population and hashes it.
 * This hash changes when DNC, role, agent binding, or record_class changes — even
 * if the ID set is identical — so the idempotency key is invalidated on drift.
 */
export async function computePopulationStateHash(
  pilotRepIds: string[],
  pilotContactIds: number[],
  pilotLocationIds: number[]
): Promise<string> {
  if (pilotRepIds.length === 0 && pilotContactIds.length === 0 && pilotLocationIds.length === 0) {
    return sha256hex("empty");
  }
  try {
    // Include ALL mandatory gate inputs in the hash so changes to any of these
    // invalidate the cached run and force a fresh evaluation:
    //   rep state: role, agent binding status, territory assignments/criteria
    //   contact state: DNC, assignment, linked-business record_class, identity decisions
    //   location state: record_class, do_not_visit, coordinates
    //   cross-cutting: open routes today, knowledge revision count, system-wide remediation
    const [repRows, contactRows, locationRows, territoryRows, routeRows, knowledgeRow, remediationRow, identityRow] = await Promise.all([
      pilotRepIds.length > 0
        ? db.execute(sql`
            SELECT u.id, u.role, a.status AS agent_status
            FROM users u LEFT JOIN agents a ON a.user_id = u.id AND a.status = 'active'
            WHERE u.id = ANY(${pilotRepIds}::varchar[])
            ORDER BY u.id
          `)
        : Promise.resolve({ rows: [] }),
      pilotContactIds.length > 0
        ? db.execute(sql`
            SELECT c.id, c.do_not_contact, c.do_not_auto_contact, c.assigned_to, c.email_status,
                   b.record_class AS business_record_class
            FROM contacts c
            LEFT JOIN businesses b ON b.id = c.business_id
            WHERE c.id = ANY(${pilotContactIds}::integer[])
            ORDER BY c.id
          `)
        : Promise.resolve({ rows: [] }),
      pilotLocationIds.length > 0
        ? db.execute(sql`
            SELECT id, record_class, do_not_visit, latitude, longitude
            FROM businesses WHERE id = ANY(${pilotLocationIds}::integer[])
            ORDER BY id
          `)
        : Promise.resolve({ rows: [] }),
      // Territory assignments for pilot reps (criteria hash)
      pilotRepIds.length > 0
        ? db.execute(sql`
            SELECT st.id, st.criteria, sta.agent_id, sta.ends_at
            FROM sales_territories st
            JOIN sales_territory_assignments sta ON sta.territory_id = st.id
            JOIN agents a ON a.id = sta.agent_id
            WHERE a.user_id = ANY(${pilotRepIds}::varchar[])
              AND a.status = 'active'
              AND (sta.ends_at IS NULL OR sta.ends_at > NOW())
            ORDER BY st.id, sta.agent_id
          `)
        : Promise.resolve({ rows: [] }),
      // Open field routes today for pilot reps
      pilotRepIds.length > 0
        ? db.execute(sql`
            SELECT id, rep_user_id, status
            FROM field_routes
            WHERE rep_user_id = ANY(${pilotRepIds}::varchar[])
              AND route_date = CURRENT_DATE AND status = 'open'
            ORDER BY id
          `)
        : Promise.resolve({ rows: [] }),
      // Knowledge revision count
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM knowledge_source_revisions
        WHERE index_state = 'indexed' AND review_state = 'approved'
      `),
      // System-wide in-flight remediation count
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM contact_remediation_operations
        WHERE status NOT IN ('closed','cancelled')
      `),
      // Identity decisions for pilot contacts
      pilotContactIds.length > 0
        ? db.execute(sql`
            SELECT COUNT(*) AS cnt
            FROM contact_identity_candidates ic
            JOIN contact_identity_decisions d ON d.candidate_id = ic.id
            WHERE ic.candidate_type = 'contact'
              AND ic.candidate_id = ANY(${pilotContactIds}::integer[])
              AND d.decision IN ('defer','supersede')
          `)
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
    ]);
    const stateSnapshot = {
      repStates: repRows.rows,
      contactStates: contactRows.rows,
      locationStates: locationRows.rows,
      territoryStates: territoryRows.rows,
      openRoutes: routeRows.rows,
      knowledgeCount: (knowledgeRow.rows[0] as any)?.cnt ?? 0,
      remediationCount: (remediationRow.rows[0] as any)?.cnt ?? 0,
      openIdentityDecisions: (identityRow.rows[0] as any)?.cnt ?? 0,
    };
    return sha256hex(JSON.stringify(stateSnapshot));
  } catch {
    // On DB error, return a random non-cacheable hash so no stale run is returned
    return sha256hex(`state-error-${Date.now()}`);
  }
}

// ─── Journal helper ──────────────────────────────────────────────────────────

function getJournalHead(): string {
  try {
    const journalPath = join(process.cwd(), "migrations", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
    const entries: Array<{ idx: number; tag: string }> = journal.entries ?? [];
    if (entries.length === 0) return "unknown";
    const last = entries.reduce((prev, cur) => (cur.idx > prev.idx ? cur : prev));
    return last.tag;
  } catch {
    return "unknown";
  }
}

// ─── Gate evaluators ─────────────────────────────────────────────────────────

async function gateSHAParity(releaseSha: string): Promise<GateResult> {
  const envSha = process.env.RELEASE_SHA ?? "";
  if (!envSha) {
    return { gate: "sha_parity", status: "BLOCKED_EXTERNAL", reason_code: "RELEASE_SHA_ABSENT", detail: "RELEASE_SHA env var not set; cannot verify SHA parity" };
  }
  // Derive the running git SHA independently — do NOT compare env to itself
  let gitSha: string;
  try {
    const { execSync } = await import("child_process");
    gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
    if (!gitSha) throw new Error("empty output");
  } catch (err: any) {
    return { gate: "sha_parity", status: "BLOCKED_EXTERNAL", reason_code: "GIT_UNAVAILABLE", detail: `Cannot derive git HEAD SHA: ${err.message}` };
  }
  if (envSha !== gitSha) {
    return { gate: "sha_parity", status: "FAIL", reason_code: "SHA_MISMATCH", detail: `RELEASE_SHA (${envSha.slice(0, 12)}…) differs from git HEAD (${gitSha.slice(0, 12)}…) — deployed code does not match current working tree` };
  }
  return { gate: "sha_parity", status: "PASS", reason_code: "OK", detail: `RELEASE_SHA matches git HEAD: ${gitSha.slice(0, 12)}…` };
}

async function gateMigrationParity(migrationHead: string): Promise<GateResult> {
  try {
    // Compute the SHA-256 of the head migration file content (same algo drizzle uses)
    const headSqlPath = join(process.cwd(), "migrations", `${migrationHead}.sql`);
    let expectedHash: string;
    try {
      const fileContent = readFileSync(headSqlPath, "utf-8");
      expectedHash = sha256hex(fileContent);
    } catch (readErr: any) {
      return { gate: "migration_parity", status: "FAIL", reason_code: "MIGRATION_FILE_UNREADABLE", detail: `Cannot read migration file ${migrationHead}.sql: ${readErr.message}` };
    }

    // Check if this exact hash exists in the DB applied-migration ledger
    const rows = await db.execute(sql`
      SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = ${expectedHash} LIMIT 1
    `);
    if (rows.rows.length === 0) {
      // Also check by most recent applied to give a better error
      const latest = await db.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`);
      const latestHash: string = (latest.rows[0] as any)?.hash ?? "(none)";
      return { gate: "migration_parity", status: "FAIL", reason_code: "MIGRATION_NOT_APPLIED", detail: `Migration ${migrationHead} file hash not found in DB. Latest applied hash: ${latestHash.slice(0, 12)}… Expected: ${expectedHash.slice(0, 12)}…` };
    }
    return { gate: "migration_parity", status: "PASS", reason_code: "OK", detail: `Migration ${migrationHead} confirmed applied in DB (hash match: ${expectedHash.slice(0, 12)}…)` };
  } catch (err: any) {
    return { gate: "migration_parity", status: "FAIL", reason_code: "DB_ERROR", detail: `Migration parity check failed: ${err.message}` };
  }
}

async function gateMigrationJournalClean(): Promise<GateResult> {
  try {
    const journalPath = join(process.cwd(), "migrations", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
    const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries ?? [];

    // Check for duplicate when values
    const whenValues = entries.map(e => e.when);
    const whenSet = new Set(whenValues);
    if (whenSet.size !== whenValues.length) {
      return { gate: "migration_journal_clean", status: "FAIL", reason_code: "DUPLICATE_WHEN", detail: "Journal has duplicate when timestamps" };
    }

    // Check for out-of-order idx
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].idx <= entries[i - 1].idx) {
        return { gate: "migration_journal_clean", status: "FAIL", reason_code: "OUT_OF_ORDER_IDX", detail: `Journal idx out of order at entry ${entries[i].tag}` };
      }
    }

    return { gate: "migration_journal_clean", status: "PASS", reason_code: "OK", detail: `Journal is clean: ${entries.length} entries, no duplicates, in order` };
  } catch (err: any) {
    return { gate: "migration_journal_clean", status: "FAIL", reason_code: "READ_ERROR", detail: err.message };
  }
}

async function gateCallAssistFlagOff(): Promise<GateResult> {
  const on = featureFlags.CALL_ASSIST_ENABLED;
  if (on) {
    return { gate: "call_assist_flag_off", status: "FAIL", reason_code: "FLAG_ENABLED", detail: "CALL_ASSIST_ENABLED is true — must be false before pilot certification" };
  }
  return { gate: "call_assist_flag_off", status: "PASS", reason_code: "OK", detail: "CALL_ASSIST_ENABLED=false ✓" };
}

async function gateFieldSalesFlagOff(): Promise<GateResult> {
  const on = featureFlags.FIELD_SALES_ENABLED;
  if (on) {
    return { gate: "field_sales_flag_off", status: "FAIL", reason_code: "FLAG_ENABLED", detail: "FIELD_SALES_ENABLED is true — must be false before pilot certification" };
  }
  return { gate: "field_sales_flag_off", status: "PASS", reason_code: "OK", detail: "FIELD_SALES_ENABLED=false ✓" };
}

async function gateKnowledgeRevisionIndexed(): Promise<GateResult> {
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM knowledge_source_revisions
      WHERE index_state = 'indexed' AND review_state = 'approved'
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt === 0) {
      return { gate: "knowledge_revision_indexed", status: "BLOCKED_EXTERNAL", reason_code: "NO_APPROVED_INDEXED_REVISION", detail: "No knowledge_source_revisions row with index_state=indexed AND review_state=approved" };
    }
    return { gate: "knowledge_revision_indexed", status: "PASS", reason_code: "OK", detail: `${cnt} approved+indexed knowledge revision(s)` };
  } catch (err: any) {
    return { gate: "knowledge_revision_indexed", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateRepBindingUnique(): Promise<GateResult> {
  try {
    const rows = await db.execute(sql`
      SELECT user_id, COUNT(*) AS cnt
      FROM agents
      WHERE status = 'active'
      GROUP BY user_id
      HAVING COUNT(*) > 1
    `);
    if (rows.rows.length > 0) {
      return { gate: "rep_binding_unique", status: "FAIL", reason_code: "DUPLICATE_ACTIVE_AGENT_BINDING", detail: `${rows.rows.length} user_id(s) have >1 active agent record` };
    }
    return { gate: "rep_binding_unique", status: "PASS", reason_code: "OK", detail: "No user_id has >1 active agent record ✓" };
  } catch (err: any) {
    return { gate: "rep_binding_unique", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateRepRoleCorrect(pilotRepIds: string[]): Promise<GateResult> {
  if (pilotRepIds.length === 0) {
    return { gate: "rep_role_correct", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_REPS", detail: "No pilot rep IDs specified; skipping rep role check" };
  }
  try {
    // Cardinality check: all pilot rep IDs must exist as users
    const existRows = await db.execute(sql`
      SELECT id, role FROM users WHERE id = ANY(${pilotRepIds}::varchar[])
    `);
    const foundIds = new Set((existRows.rows as any[]).map(r => String(r.id)));
    const missing = pilotRepIds.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      return { gate: "rep_role_correct", status: "FAIL", reason_code: "UNKNOWN_REP_IDS", detail: `${missing.length} pilot rep ID(s) not found in users table` };
    }
    // Role check: all pilot reps must have role agent or manager
    const wrongRole = (existRows.rows as any[]).filter(r => !["agent", "manager"].includes(r.role));
    if (wrongRole.length > 0) {
      return { gate: "rep_role_correct", status: "FAIL", reason_code: "INVALID_REP_ROLE", detail: `${wrongRole.length} pilot rep(s) have invalid role` };
    }
    // Active-agent binding check: all pilot reps must have exactly one active agent record
    const agentRows = await db.execute(sql`
      SELECT user_id, COUNT(*) AS cnt FROM agents WHERE user_id = ANY(${pilotRepIds}::varchar[]) AND status = 'active'
      GROUP BY user_id
    `);
    const agentMap = new Map((agentRows.rows as any[]).map(r => [String(r.user_id), Number(r.cnt)]));
    const noAgent = pilotRepIds.filter(id => !agentMap.has(id));
    const multiAgent = pilotRepIds.filter(id => (agentMap.get(id) ?? 0) > 1);
    if (noAgent.length > 0) {
      return { gate: "rep_role_correct", status: "FAIL", reason_code: "NO_ACTIVE_AGENT_BINDING", detail: `${noAgent.length} pilot rep(s) have no active agent binding` };
    }
    if (multiAgent.length > 0) {
      return { gate: "rep_role_correct", status: "FAIL", reason_code: "MULTIPLE_ACTIVE_AGENT_BINDINGS", detail: `${multiAgent.length} pilot rep(s) have >1 active agent binding` };
    }
    return { gate: "rep_role_correct", status: "PASS", reason_code: "OK", detail: `All ${pilotRepIds.length} pilot rep(s) have valid role and exactly one active agent binding ✓` };
  } catch (err: any) {
    return { gate: "rep_role_correct", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateExactAssignmentIsolation(pilotRepIds: string[], pilotContactIds: number[]): Promise<GateResult> {
  if (pilotRepIds.length === 0 || pilotContactIds.length === 0) {
    return { gate: "exact_assignment_isolation", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_DATA", detail: "No pilot reps or contacts specified; skipping" };
  }
  try {
    // Collect pilot agent emails (the assigned_to field stores email, not user_id)
    const pilotAgentRows = await db.execute(sql`
      SELECT a.email FROM agents a
      WHERE a.user_id = ANY(${pilotRepIds}::varchar[]) AND a.status = 'active'
    `);
    const pilotEmails = (pilotAgentRows.rows as any[]).map(r => String(r.email)).filter(Boolean);

    // Require every pilot contact to have assigned_to set to a pilot rep's email.
    // Unassigned contacts (assigned_to IS NULL) also fail: each pilot contact must have
    // an explicit 1:1 mapping to exactly one pilot rep.
    const unassignedRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM contacts
      WHERE id = ANY(${pilotContactIds}::integer[])
      AND (assigned_to IS NULL OR assigned_to = '')
    `);
    const unassigned = Number((unassignedRows.rows[0] as any)?.cnt ?? 0);
    if (unassigned > 0) {
      return { gate: "exact_assignment_isolation", status: "FAIL", reason_code: "UNASSIGNED_CONTACTS", detail: `${unassigned} pilot contact(s) have no assigned rep (assigned_to is NULL/empty)` };
    }

    if (pilotEmails.length === 0) {
      return { gate: "exact_assignment_isolation", status: "FAIL", reason_code: "NO_PILOT_AGENT_EMAILS", detail: "Pilot reps have no active agent email; cannot verify assignment isolation" };
    }

    // Cross-assignment: pilot contact assigned to a non-pilot rep
    const crossRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM contacts
      WHERE id = ANY(${pilotContactIds}::integer[])
      AND assigned_to NOT IN (${sql.raw(pilotEmails.map(e => `'${e.replace(/'/g, "''")}'`).join(","))})
    `);
    const crossCnt = Number((crossRows.rows[0] as any)?.cnt ?? 0);
    if (crossCnt > 0) {
      return { gate: "exact_assignment_isolation", status: "FAIL", reason_code: "CROSS_ASSIGNMENT", detail: `${crossCnt} pilot contact(s) assigned to non-pilot rep(s)` };
    }

    return { gate: "exact_assignment_isolation", status: "PASS", reason_code: "OK", detail: `All ${pilotContactIds.length} pilot contact(s) assigned exclusively to pilot reps ✓` };
  } catch (err: any) {
    return { gate: "exact_assignment_isolation", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateContactRecordClass(pilotContactIds: number[]): Promise<GateResult> {
  if (pilotContactIds.length === 0) {
    return { gate: "contact_record_class", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_CONTACTS", detail: "No pilot contact IDs specified; skipping" };
  }
  try {
    // Cardinality check: all IDs must exist
    const existRows = await db.execute(sql`SELECT COUNT(*) AS cnt FROM contacts WHERE id = ANY(${pilotContactIds}::integer[])`);
    const existCnt = Number((existRows.rows[0] as any)?.cnt ?? 0);
    if (existCnt !== pilotContactIds.length) {
      return { gate: "contact_record_class", status: "FAIL", reason_code: "UNKNOWN_CONTACT_IDS", detail: `Requested ${pilotContactIds.length} contact IDs but only ${existCnt} found` };
    }
    // Check 1: contacts that have no linked business at all (business_id IS NULL).
    // A contact without a business cannot be canonical regardless of any business record_class.
    const unlinkedRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM contacts
      WHERE id = ANY(${pilotContactIds}::integer[]) AND business_id IS NULL
    `);
    const unlinked = Number((unlinkedRows.rows[0] as any)?.cnt ?? 0);
    if (unlinked > 0) {
      return { gate: "contact_record_class", status: "FAIL", reason_code: "NO_BUSINESS_LINK", detail: `${unlinked} pilot contact(s) have no linked business (business_id IS NULL) — cannot be canonical` };
    }
    // Check 2: contacts whose linked business is NOT canonical.
    // This also catches contacts linked to raw/unknown/system businesses.
    const nonCanonicalRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM contacts c
      JOIN businesses b ON b.id = c.business_id
      WHERE c.id = ANY(${pilotContactIds}::integer[])
        AND (b.record_class IS NULL OR b.record_class != 'canonical')
    `);
    const nonCanonical = Number((nonCanonicalRows.rows[0] as any)?.cnt ?? 0);
    if (nonCanonical > 0) {
      return { gate: "contact_record_class", status: "FAIL", reason_code: "NON_CANONICAL_BUSINESS", detail: `${nonCanonical} pilot contact(s) linked to non-canonical businesses (record_class != 'canonical')` };
    }
    return { gate: "contact_record_class", status: "PASS", reason_code: "OK", detail: `All ${pilotContactIds.length} pilot contact(s) have a linked canonical business ✓` };
  } catch (err: any) {
    return { gate: "contact_record_class", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateContactIdentityClear(pilotContactIds: number[]): Promise<GateResult> {
  if (pilotContactIds.length === 0) {
    return { gate: "contact_identity_clear", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_CONTACTS", detail: "No pilot contact IDs specified; skipping" };
  }
  try {
    // Verify ALL requested IDs actually exist as contacts (cardinality check)
    const existRows = await db.execute(sql`SELECT COUNT(*) AS cnt FROM contacts WHERE id = ANY(${pilotContactIds}::integer[])`);
    const existCnt = Number((existRows.rows[0] as any)?.cnt ?? 0);
    if (existCnt !== pilotContactIds.length) {
      return { gate: "contact_identity_clear", status: "FAIL", reason_code: "UNKNOWN_CONTACT_IDS", detail: `Requested ${pilotContactIds.length} contact IDs but only ${existCnt} found` };
    }
    // contact_identity_decisions has no direct contact_id column; it links via:
    //   contact_identity_candidates (candidate_type='contact', candidate_id=contacts.id)
    // → contact_identity_decisions (candidate_id=candidates.id)
    // A "deferred" decision indicates the identity is not resolved.
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM contact_identity_candidates ic
      JOIN contact_identity_decisions d ON d.candidate_id = ic.id
      WHERE ic.candidate_type = 'contact'
        AND ic.candidate_id = ANY(${pilotContactIds}::integer[])
        AND d.decision IN ('defer','supersede')
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt > 0) {
      return { gate: "contact_identity_clear", status: "FAIL", reason_code: "OPEN_IDENTITY_DECISIONS", detail: `${cnt} pilot contact(s) have deferred or superseded identity decisions requiring resolution` };
    }
    return { gate: "contact_identity_clear", status: "PASS", reason_code: "OK", detail: "No open identity decisions for pilot contacts ✓" };
  } catch (err: any) {
    return { gate: "contact_identity_clear", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateContactRemediationClear(pilotContactIds: number[]): Promise<GateResult> {
  if (pilotContactIds.length === 0) {
    return { gate: "contact_remediation_clear", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_CONTACTS", detail: "No pilot contact IDs specified; skipping" };
  }
  try {
    // contact_remediation_operations has no direct contact_id column (linked via run_id
    // to contact_reconciliation_runs which are system-wide). Gate checks system-wide
    // in-flight remediation operations — any pending/running operation could affect pilot contacts.
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM contact_remediation_operations
      WHERE status IN ('pending','running')
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt > 0) {
      return { gate: "contact_remediation_clear", status: "BLOCKED_EXTERNAL", reason_code: "SYSTEM_REMEDIATION_IN_PROGRESS", detail: `${cnt} remediation operation(s) are pending/running system-wide — wait for completion before certifying` };
    }
    return { gate: "contact_remediation_clear", status: "PASS", reason_code: "OK", detail: "No active remediation operations system-wide ✓" };
  } catch (err: any) {
    return { gate: "contact_remediation_clear", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateManualCallEligible(pilotContactIds: number[]): Promise<GateResult> {
  if (pilotContactIds.length === 0) {
    return { gate: "manual_call_eligible", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_CONTACTS", detail: "No pilot contact IDs specified; skipping" };
  }
  try {
    const blocked: number[] = [];
    for (const contactId of pilotContactIds) {
      try {
        const result = await evaluateContactability({
          contactId,
          channel: "manual_call",
          mode: "dryRun",
          commercialPurpose: "marketing_outreach",
        });
        if (!result.ghlPermissionPayload.lb_manual_call_allowed) {
          blocked.push(contactId);
        }
      } catch {
        blocked.push(contactId);
      }
    }
    if (blocked.length > 0) {
      return { gate: "manual_call_eligible", status: "FAIL", reason_code: "CONTACTS_NOT_CALL_ELIGIBLE", detail: `${blocked.length} pilot contact(s) failed contactability dryRun` };
    }
    return { gate: "manual_call_eligible", status: "PASS", reason_code: "OK", detail: `All ${pilotContactIds.length} pilot contacts are call-eligible ✓` };
  } catch (err: any) {
    return { gate: "manual_call_eligible", status: "FAIL", reason_code: "CONTACTABILITY_ERROR", detail: err.message };
  }
}

async function gateDncSuppressionClear(pilotContactIds: number[]): Promise<GateResult> {
  if (pilotContactIds.length === 0) {
    return { gate: "dnc_suppression_clear", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_CONTACTS", detail: "No pilot contact IDs specified; skipping" };
  }
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM contacts
      WHERE id = ANY(${pilotContactIds}::integer[])
      AND (do_not_contact = true OR do_not_auto_contact = true)
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt > 0) {
      return { gate: "dnc_suppression_clear", status: "FAIL", reason_code: "DNC_CONTACTS", detail: `${cnt} pilot contact(s) have do_not_contact or do_not_auto_contact set` };
    }
    return { gate: "dnc_suppression_clear", status: "PASS", reason_code: "OK", detail: "No DNC flags on pilot contacts ✓" };
  } catch (err: any) {
    return { gate: "dnc_suppression_clear", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateFieldLocationClass(pilotLocationIds: number[]): Promise<GateResult> {
  if (pilotLocationIds.length === 0) {
    return { gate: "field_location_class", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_LOCATIONS", detail: "No pilot location IDs specified; skipping" };
  }
  try {
    // Cardinality check: all IDs must exist
    const existRows = await db.execute(sql`SELECT COUNT(*) AS cnt FROM businesses WHERE id = ANY(${pilotLocationIds}::integer[])`);
    const existCnt = Number((existRows.rows[0] as any)?.cnt ?? 0);
    if (existCnt !== pilotLocationIds.length) {
      return { gate: "field_location_class", status: "FAIL", reason_code: "UNKNOWN_LOCATION_IDS", detail: `Requested ${pilotLocationIds.length} location IDs but only ${existCnt} found` };
    }
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM businesses
      WHERE id = ANY(${pilotLocationIds}::integer[])
      AND (
        record_class IS DISTINCT FROM 'canonical'
        OR (latitude IS NULL AND longitude IS NULL AND (street_address IS NULL OR TRIM(street_address) = ''))
        OR do_not_visit IS TRUE
      )
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt > 0) {
      return { gate: "field_location_class", status: "FAIL", reason_code: "INELIGIBLE_LOCATIONS", detail: `${cnt} pilot location(s) are non-canonical, missing location data, or DNC-visit` };
    }
    return { gate: "field_location_class", status: "PASS", reason_code: "OK", detail: `All ${pilotLocationIds.length} pilot location(s) are canonical and visitable ✓` };
  } catch (err: any) {
    return { gate: "field_location_class", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateTerritoryOverlapClear(pilotRepIds: string[]): Promise<GateResult> {
  if (pilotRepIds.length < 2) {
    return { gate: "territory_overlap_clear", status: "NOT_APPLICABLE", reason_code: "SINGLE_OR_NO_REP", detail: "Fewer than 2 pilot reps; no overlap possible" };
  }
  try {
    // Check 1: same territory assigned to more than one pilot rep
    const sameTerritoryRows = await db.execute(sql`
      SELECT st.id AS territory_id, COUNT(DISTINCT sta.agent_id) AS rep_count
      FROM sales_territories st
      JOIN sales_territory_assignments sta ON sta.territory_id = st.id
      JOIN agents a ON a.id = sta.agent_id
      WHERE a.user_id = ANY(${pilotRepIds}::varchar[])
        AND a.status = 'active'
        AND (sta.ends_at IS NULL OR sta.ends_at > NOW())
      GROUP BY st.id
      HAVING COUNT(DISTINCT sta.agent_id) > 1
    `);
    if (sameTerritoryRows.rows.length > 0) {
      return { gate: "territory_overlap_clear", status: "FAIL", reason_code: "SHARED_TERRITORY", detail: `${sameTerritoryRows.rows.length} territory(ies) assigned to multiple pilot reps` };
    }

    // Check 2: cross-territory postal code / city overlap between different territories
    // Pull all pilot rep territory criteria, then compare pairwise in application code
    const criteriaRows = await db.execute(sql`
      SELECT a.user_id, st.id AS territory_id, st.criteria
      FROM sales_territories st
      JOIN sales_territory_assignments sta ON sta.territory_id = st.id
      JOIN agents a ON a.id = sta.agent_id
      WHERE a.user_id = ANY(${pilotRepIds}::varchar[])
        AND a.status = 'active'
        AND (sta.ends_at IS NULL OR sta.ends_at > NOW())
    `);

    // Build per-rep sets of postal codes and cities
    type RepCriteria = { userId: string; postalCodes: Set<string>; cities: Set<string> };
    const repMap = new Map<string, RepCriteria>();
    for (const row of criteriaRows.rows as any[]) {
      const userId = String(row.user_id);
      const criteria = typeof row.criteria === "string" ? JSON.parse(row.criteria) : (row.criteria ?? {});
      if (!repMap.has(userId)) repMap.set(userId, { userId, postalCodes: new Set(), cities: new Set() });
      const entry = repMap.get(userId)!;
      for (const pc of Array.isArray(criteria.postalCodes) ? criteria.postalCodes : []) entry.postalCodes.add(String(pc));
      for (const city of Array.isArray(criteria.cities) ? criteria.cities : []) entry.cities.add(String(city).toLowerCase());
    }

    const repList = Array.from(repMap.values());
    let crossOverlapPairs = 0;
    for (let i = 0; i < repList.length; i++) {
      for (let j = i + 1; j < repList.length; j++) {
        const a = repList[i], b = repList[j];
        const sharedPc = [...a.postalCodes].some(pc => b.postalCodes.has(pc));
        const sharedCity = [...a.cities].some(city => b.cities.has(city));
        if (sharedPc || sharedCity) crossOverlapPairs++;
      }
    }
    if (crossOverlapPairs > 0) {
      return { gate: "territory_overlap_clear", status: "FAIL", reason_code: "TERRITORY_CRITERIA_OVERLAP", detail: `${crossOverlapPairs} pilot rep pair(s) have overlapping territory criteria (postal code or city)` };
    }

    return { gate: "territory_overlap_clear", status: "PASS", reason_code: "OK", detail: "No territory overlaps (same territory or postal code/city criteria) among pilot reps ✓" };
  } catch (err: any) {
    return { gate: "territory_overlap_clear", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateRouteCollisionClear(pilotRepIds: string[]): Promise<GateResult> {
  if (pilotRepIds.length === 0) {
    return { gate: "route_collision_clear", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_REPS", detail: "No pilot reps specified; skipping" };
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    // field_routes uses rep_user_id (varchar → users.id), not rep_id
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM field_routes fr
      WHERE fr.rep_user_id = ANY(${pilotRepIds}::varchar[])
      AND fr.route_date = ${today}::date
      AND fr.status = 'open'
    `);
    const cnt = Number((rows.rows[0] as any)?.cnt ?? 0);
    if (cnt > 0) {
      return { gate: "route_collision_clear", status: "FAIL", reason_code: "OPEN_ROUTES_TODAY", detail: `${cnt} open field_routes for pilot rep(s) on today's date` };
    }
    return { gate: "route_collision_clear", status: "PASS", reason_code: "OK", detail: "No open route collisions for today ✓" };
  } catch (err: any) {
    return { gate: "route_collision_clear", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateTestDemoLeakage(pilotContactIds: number[], pilotLocationIds: number[]): Promise<GateResult> {
  const allIds = [...pilotContactIds, ...pilotLocationIds];
  if (allIds.length === 0) {
    return { gate: "test_demo_leakage", status: "NOT_APPLICABLE", reason_code: "NO_PILOT_DATA", detail: "No pilot IDs specified; skipping" };
  }
  try {
    const [contactRows, bizRows] = await Promise.all([
      pilotContactIds.length > 0
        ? db.execute(sql`
            SELECT COUNT(*) AS cnt FROM contacts
            WHERE id = ANY(${pilotContactIds}::integer[])
            AND (
              first_name ILIKE '%test%' OR last_name ILIKE '%test%' OR email ILIKE '%test%'
              OR first_name ILIKE '%demo%' OR email ILIKE '%demo%'
              OR email ILIKE '%example%' OR email ILIKE '%liberty-test%'
            )
          `)
        : { rows: [{ cnt: "0" }] },
      pilotLocationIds.length > 0
        ? db.execute(sql`
            SELECT COUNT(*) AS cnt FROM businesses
            WHERE id = ANY(${pilotLocationIds}::integer[])
            AND (
              canonical_name ILIKE '%test%' OR canonical_name ILIKE '%demo%'
              OR canonical_name ILIKE '%example%' OR canonical_name ILIKE '%liberty-test%'
            )
          `)
        : { rows: [{ cnt: "0" }] },
    ]);
    const contactCnt = Number((contactRows.rows[0] as any)?.cnt ?? 0);
    const bizCnt = Number((bizRows.rows[0] as any)?.cnt ?? 0);
    const total = contactCnt + bizCnt;
    if (total > 0) {
      return { gate: "test_demo_leakage", status: "FAIL", reason_code: "TEST_DEMO_RECORDS", detail: `${total} test/demo record(s) found in pilot candidate set` };
    }
    return { gate: "test_demo_leakage", status: "PASS", reason_code: "OK", detail: "No test/demo/example records in pilot candidate set ✓" };
  } catch (err: any) {
    return { gate: "test_demo_leakage", status: "FAIL", reason_code: "DB_ERROR", detail: err.message };
  }
}

async function gateCiChecksRegistered(): Promise<GateResult> {
  const sha = process.env.RELEASE_SHA ?? "";
  if (!sha) {
    return { gate: "ci_checks_registered", status: "BLOCKED_EXTERNAL", reason_code: "RELEASE_SHA_ABSENT", detail: "RELEASE_SHA env var not set" };
  }
  return { gate: "ci_checks_registered", status: "PASS", reason_code: "OK", detail: "RELEASE_SHA env var present ✓" };
}

async function gateRollbackReady(): Promise<GateResult> {
  const callAssistOff = !featureFlags.CALL_ASSIST_ENABLED;
  const fieldSalesOff = !featureFlags.FIELD_SALES_ENABLED;
  if (!callAssistOff || !fieldSalesOff) {
    return { gate: "rollback_ready", status: "FAIL", reason_code: "FLAGS_ENABLED", detail: "Rollback requires both flags to be false; at least one is currently true" };
  }
  return { gate: "rollback_ready", status: "PASS", reason_code: "OK", detail: "Both flags are false — rollback by disabling flags is a no-op ✓" };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runSalesRepOpsReadiness(opts: {
  triggeredByUserId?: string;
  pilotRepIds?: string[];
  pilotContactIds?: number[];
  pilotLocationIds?: number[];
}): Promise<ReadinessRunOutput> {
  const { triggeredByUserId, pilotRepIds = [], pilotContactIds = [], pilotLocationIds = [] } = opts;

  // Derive git HEAD independently for runId computation — never use RELEASE_SHA alone,
  // because different code at the same SHA or absent RELEASE_SHA would produce collisions.
  let gitHeadSha = process.env.RELEASE_SHA ?? "";
  try {
    const { execSync } = await import("child_process");
    const gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
    if (gitSha) gitHeadSha = gitSha;
  } catch {}
  const releaseSha = gitHeadSha || process.env.RELEASE_SHA || "unknown";

  const migrationHead = getJournalHead();
  const configFingerprint = computeConfigFingerprint();
  const populationFingerprint = computePopulationFingerprint(pilotRepIds, pilotContactIds, pilotLocationIds);
  // State hash: includes live DNC/role/agent-binding/record_class eligibility state for the pilot IDs.
  // Incorporating it into the runId means that DNC changes, role changes, or agent-binding changes
  // for the SAME set of IDs produce a new runId — preventing a stale PASS from masking eligibility drift.
  const populationStateHash = await computePopulationStateHash(pilotRepIds, pilotContactIds, pilotLocationIds);
  const runId = sha256hex(`${releaseSha}||${configFingerprint}||${populationFingerprint}||${populationStateHash}`);

  // Idempotency: return existing complete run
  try {
    const existing = await db.execute(sql`
      SELECT * FROM sales_rep_ops_readiness_runs WHERE run_id = ${runId} AND status = 'complete'
    `);
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as any;
      return {
        runId: row.run_id,
        id: row.id,
        releaseSha: row.release_sha,
        migrationHead: row.migration_head,
        configFingerprint: row.config_fingerprint,
        populationFingerprint: row.population_fingerprint,
        status: row.status,
        gateResults: row.gate_results ?? [],
        aggregateVerdict: row.aggregate_verdict,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        triggeredByUserId: row.triggered_by_user_id,
        fromCache: true,
      };
    }
  } catch {}

  // Insert running row. Distinguish two cases:
  //   1. UNIQUE conflict on run_id (PG code 23505) → concurrent writer won; poll below.
  //   2. Any other DB error → propagate; receipt durability is required.
  let rowId = 0;
  {
    let insertErr: Error | null = null;
    let isConflict = false;
    try {
      const insertResult = await db.execute(sql`
        INSERT INTO sales_rep_ops_readiness_runs
          (run_id, release_sha, migration_head, config_fingerprint, population_fingerprint, status, gate_results, triggered_by_user_id)
        VALUES
          (${runId}, ${releaseSha}, ${migrationHead}, ${configFingerprint}, ${populationFingerprint}, 'running', '[]'::jsonb, ${triggeredByUserId ?? null})
        ON CONFLICT (run_id) DO NOTHING
        RETURNING id
      `);
      rowId = (insertResult.rows[0] as any)?.id ?? 0;
      // DO NOTHING returns 0 rows — that means conflict (concurrent runner won)
      isConflict = rowId === 0;
    } catch (err: any) {
      // PG unique_violation = 23505; also check detail for run_id UNIQUE
      const isUniqueViolation = /23505|unique.*run_id|duplicate key/i.test(err.message ?? "");
      if (isUniqueViolation) {
        isConflict = true;
      } else {
        insertErr = err;
      }
    }
    if (insertErr) {
      throw new Error(`[SalesRepOpsReadiness] Failed to persist readiness run receipt: ${insertErr.message}`);
    }
    if (isConflict) {
      rowId = 0; // handled in poll block below
    }
  }

  // When DO NOTHING fires (rowId=0), another process is already running with the same runId.
  // Poll briefly for the winning run to complete (up to 30s) then return it, so the caller
  // always receives a persisted result rather than an unrecorded in-progress verdict.
  if (rowId === 0) {
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 30_000;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const poll = await db.execute(sql`
          SELECT * FROM sales_rep_ops_readiness_runs WHERE run_id = ${runId} AND status = 'complete'
        `);
        if (poll.rows.length > 0) {
          const row = poll.rows[0] as any;
          return {
            runId: row.run_id,
            id: row.id,
            releaseSha: row.release_sha,
            migrationHead: row.migration_head,
            configFingerprint: row.config_fingerprint,
            populationFingerprint: row.population_fingerprint,
            status: row.status,
            gateResults: row.gate_results ?? [],
            aggregateVerdict: row.aggregate_verdict,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            triggeredByUserId: row.triggered_by_user_id,
            fromCache: true,
          };
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    // Timed out waiting for winning run — return in-progress signal
    return {
      runId,
      id: 0,
      releaseSha,
      migrationHead,
      configFingerprint,
      populationFingerprint,
      status: "running" as const,
      gateResults: [],
      aggregateVerdict: "BLOCKED_EXTERNAL" as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      triggeredByUserId: triggeredByUserId ?? null,
      fromCache: false,
    };
  }

  // Evaluate all gates concurrently
  let gateResults: GateResult[] = [];
  let finalStatus: "complete" | "failed" = "complete";

  try {
    const [
      gSha, gMigParity, gMigClean,
      gCallOff, gFieldOff, gKnowledge,
      gRepUnique, gRepRole, gExactAssign,
      gRecordClass, gIdentityClear, gRemediationClear,
      gCallEligible, gDnc, gFieldLoc,
      gTerritoryOverlap, gRouteCollision, gTestDemo,
      gCiChecks, gRollback,
    ] = await Promise.all([
      gateSHAParity(releaseSha),
      gateMigrationParity(migrationHead),
      gateMigrationJournalClean(),
      gateCallAssistFlagOff(),
      gateFieldSalesFlagOff(),
      gateKnowledgeRevisionIndexed(),
      gateRepBindingUnique(),
      gateRepRoleCorrect(pilotRepIds),
      gateExactAssignmentIsolation(pilotRepIds, pilotContactIds),
      gateContactRecordClass(pilotContactIds),
      gateContactIdentityClear(pilotContactIds),
      gateContactRemediationClear(pilotContactIds),
      gateManualCallEligible(pilotContactIds),
      gateDncSuppressionClear(pilotContactIds),
      gateFieldLocationClass(pilotLocationIds),
      gateTerritoryOverlapClear(pilotRepIds),
      gateRouteCollisionClear(pilotRepIds),
      gateTestDemoLeakage(pilotContactIds, pilotLocationIds),
      gateCiChecksRegistered(),
      gateRollbackReady(),
    ]);

    gateResults = [
      gSha, gMigParity, gMigClean,
      gCallOff, gFieldOff, gKnowledge,
      gRepUnique, gRepRole, gExactAssign,
      gRecordClass, gIdentityClear, gRemediationClear,
      gCallEligible, gDnc, gFieldLoc,
      gTerritoryOverlap, gRouteCollision, gTestDemo,
      gCiChecks, gRollback,
    ];
  } catch (err: any) {
    gateResults = [{ gate: "runner", status: "FAIL", reason_code: "RUNNER_ERROR", detail: err.message }];
    finalStatus = "failed";
  }

  // Compute aggregate verdict.
  // Kill lines:
  //   1. Any mandatory FAIL → aggregate FAIL.
  //   2. Any BLOCKED_EXTERNAL gate → aggregate BLOCKED_EXTERNAL.
  //   3. Incomplete population: reps, contacts, AND locations must ALL be non-empty.
  //      A run that certifies reps but zero contacts or zero locations has not proven
  //      the full pilot cohort is eligible — it cannot constitute a valid certification.
  //   4. Degenerate case: all population gates NOT_APPLICABLE (empty IDs on every dimension)
  //      also produces BLOCKED_EXTERNAL.
  const incompletePopulation = pilotRepIds.length === 0 || pilotContactIds.length === 0 || pilotLocationIds.length === 0;

  const POPULATION_GATES = [
    "rep_role_correct", "exact_assignment_isolation", "contact_record_class",
    "contact_identity_clear", "contact_remediation_clear", "manual_call_eligible",
    "dnc_suppression_clear", "field_location_class", "territory_overlap_clear",
    "route_collision_clear", "test_demo_leakage",
  ];
  const populationGatesAllNotApplicable = POPULATION_GATES.every(gate => {
    const g = gateResults.find(r => r.gate === gate);
    return !g || g.status === "NOT_APPLICABLE";
  });

  const hasFail = gateResults.some(g => g.status === "FAIL");
  const hasBlockedExternal = gateResults.some(g => g.status === "BLOCKED_EXTERNAL");
  const aggregateVerdict: "PASS" | "FAIL" | "BLOCKED_EXTERNAL" =
    hasFail ? "FAIL" :
    hasBlockedExternal ? "BLOCKED_EXTERNAL" :
    incompletePopulation ? "BLOCKED_EXTERNAL" : // missing a full population dimension
    populationGatesAllNotApplicable ? "BLOCKED_EXTERNAL" : // all gates skipped (degenerate)
    "PASS";

  if (rowId > 0) {
    // Receipt update must succeed — propagate errors to preserve durability.
    // The row was INSERT-ed as 'running'; if we cannot mark it 'complete'/'failed',
    // it stays as a zombie 'running' row. Callers rely on a durable completed receipt.
    await db.execute(sql`
      UPDATE sales_rep_ops_readiness_runs
      SET status = ${finalStatus},
          gate_results = ${JSON.stringify(gateResults)}::jsonb,
          aggregate_verdict = ${aggregateVerdict},
          completed_at = NOW()
      WHERE id = ${rowId}
    `);
  }

  return {
    runId,
    id: rowId,
    releaseSha,
    migrationHead,
    configFingerprint,
    populationFingerprint,
    status: finalStatus,
    gateResults,
    aggregateVerdict,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    triggeredByUserId: triggeredByUserId ?? null,
    fromCache: false,
  };
}
