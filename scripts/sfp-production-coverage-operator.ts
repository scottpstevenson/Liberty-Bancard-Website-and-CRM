#!/usr/bin/env tsx
/**
 * Bounded production operator for the SFP contact -> validation -> ready_held
 * -> paused-enrollment path. All mutations go through the currently published
 * application's normal admin routes; this script never connects to a database.
 *
 * Required runtime environment:
 *   SFP_PRODUCTION_BASE_URL=https://<current-published-host>
 *   ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD
 *
 * Modes:
 *   --inventory  Capture a privacy-safe, read-only snapshot of current gates.
 *   --apply      Continue only from a fresh inventory and process <= 25 rows.
 *                Requires either --strict-report=<completed /tmp aggregate JSON>
 *                or --strict-contact-ids=<comma-separated contact IDs>, plus
 *                --published-release-sha=<current /api/health SHA>.
 *
 * The outbound pause is read immediately before every mutation. This script
 * never turns it off, changes caps/budgets, dispatches, or sends.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = String(process.env.SFP_PRODUCTION_BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";
const MAX_TOTAL = 25;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_DIR = path.join(ROOT, ".local", "sfp-production-coverage");
const CHECKPOINT_PATH = path.join(RECEIPT_DIR, "checkpoint.json");
const MODE = process.argv.includes("--apply") ? "apply" : "inventory";
const STRICT_REPORT_ARG = process.argv.find((argument) => argument.startsWith("--strict-report="));
const STRICT_REPORT_INDEX = process.argv.indexOf("--strict-report");
const STRICT_REPORT_PATH = STRICT_REPORT_ARG
  ? STRICT_REPORT_ARG.slice("--strict-report=".length)
  : STRICT_REPORT_INDEX >= 0 ? process.argv[STRICT_REPORT_INDEX + 1] ?? "" : "";
const STRICT_IDS_ARG = process.argv.find((argument) => argument.startsWith("--strict-contact-ids="));
const STRICT_IDS_INDEX = process.argv.indexOf("--strict-contact-ids");
const STRICT_CONTACT_IDS_INPUT = STRICT_IDS_ARG
  ? STRICT_IDS_ARG.slice("--strict-contact-ids=".length)
  : STRICT_IDS_INDEX >= 0 ? process.argv[STRICT_IDS_INDEX + 1] ?? "" : "";
const RELEASE_SHA_ARG = process.argv.find((argument) => argument.startsWith("--published-release-sha="));
const PUBLISHED_RELEASE_SHA = RELEASE_SHA_ARG?.slice("--published-release-sha=".length) ?? "";

type Json = Record<string, any>;
type RequestResult<T = any> = { status: number; body: T };

function requiredRuntime(): void {
  if (!BASE_URL || !/^https:\/\//i.test(BASE_URL) || /localhost|127\.0\.0\.1/i.test(BASE_URL)) {
    throw new Error("Set SFP_PRODUCTION_BASE_URL to the current published HTTPS URL.");
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be present in this runtime.");
  }
}

function safeErrorText(value: unknown): string {
  const raw = String(value ?? "unknown_error");
  if (/failed query:\s*(select|with)\b/i.test(raw)) return "application_query_failed";
  return raw
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email-redacted]")
    .replace(/\+?\d[\d().\s-]{7,}\d/g, "[phone-redacted]")
    .replace(/(?:bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

async function loadStrictContactInput(reportPath: string, explicitIds: string): Promise<{
  contactIds: number[];
  source: "aggregate_report" | "explicit_id_hints" | "none";
  reportPath: string | null;
}> {
  if (reportPath && explicitIds) throw new Error("Pass either --strict-report or --strict-contact-ids, not both.");
  if (!reportPath && !explicitIds) return { contactIds: [], source: "none", reportPath: null };
  if (explicitIds) {
    const contactIds = explicitIds.split(",").map((value) => Number(value.trim()));
    if (contactIds.length > MAX_TOTAL) throw new Error(`STRICT_CONTACT_ID_LIMIT_EXCEEDED:${contactIds.length}`);
    if (contactIds.some((contactId) => !Number.isSafeInteger(contactId) || contactId < 1) ||
        new Set(contactIds).size !== contactIds.length) {
      throw new Error("STRICT_CONTACT_ID_HINTS_INVALID");
    }
    return { contactIds: contactIds.sort((a, b) => a - b), source: "explicit_id_hints", reportPath: null };
  }
  if (!reportPath || !path.resolve(reportPath).startsWith("/tmp/")) {
    throw new Error("Pass a completed /tmp aggregate report or --strict-contact-ids=<bounded IDs>; live published preview remains authoritative.");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report?.complete !== true || !Number.isSafeInteger(report?.processed) ||
      !Number.isSafeInteger(report?.total) || report.processed !== report.total) {
    throw new Error("STRICT_CONTACT_REPORT_INCOMPLETE; finish the full-pool aggregate before applying.");
  }
  const strictCandidates = asArray<Json>(report.strictCandidates);
  if (strictCandidates.length > MAX_TOTAL) {
    throw new Error(`STRICT_CONTACT_REPORT_LIMIT_EXCEEDED:${strictCandidates.length}`);
  }
  const contactIds = strictCandidates.map((candidate) => Number(candidate.contactId));
  if (contactIds.some((contactId) => !Number.isSafeInteger(contactId) || contactId < 1) ||
      new Set(contactIds).size !== contactIds.length) {
    throw new Error("STRICT_CONTACT_REPORT_IDS_INVALID");
  }
  // Offline report business IDs, hashes, and candidate evidence are deliberately
  // ignored. Explicit IDs are likewise hints only: all authorities are the
  // fresh published strict previews fetched immediately before apply.
  return {
    contactIds: contactIds.sort((a, b) => a - b),
    source: "aggregate_report",
    reportPath: path.resolve(reportPath),
  };
}

function stableKey(scope: string, data: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 24);
  return `sfp-production-coverage:${scope}:${hash}`;
}

class ProductionApi {
  private cookie = "";
  private csrf = "";

  async login(): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`production_login_failed:${response.status}`);
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
    this.cookie = cookies.map((value) => value.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!this.cookie) throw new Error("production_login_missing_session_cookie");
    const csrfResponse = await this.request("/api/csrf-token");
    if (csrfResponse.status !== 200 || typeof csrfResponse.body?.token !== "string") {
      throw new Error(`production_csrf_unavailable:${csrfResponse.status}`);
    }
    this.csrf = csrfResponse.body.token;
  }

  async request<T = any>(route: string, init: RequestInit = {}): Promise<RequestResult<T>> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (this.csrf && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrf);
    const response = await fetch(`${BASE_URL}${route}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: "non_json_response" }; }
    return { status: response.status, body: body as T };
  }

  async get<T = any>(route: string): Promise<T> {
    const result = await this.request<T>(route);
    if (result.status < 200 || result.status >= 300) {
      const body: any = result.body;
      throw new Error(`GET ${route} failed:${result.status}:${safeErrorText(body?.error ?? body?.message)}`);
    }
    return result.body;
  }

  async mutate<T = any>(route: string, body: Json): Promise<T> {
    const pause = await this.get<Json>("/api/admin/pause-state");
    if (pause?.paused !== true || !["paused", "safe_default"].includes(String(pause?.state))) {
      throw new Error(`GLOBAL_OUTBOUND_PAUSE_NOT_CONFIRMED:${safeErrorText(pause?.state ?? "unknown")}`);
    }
    const result = await this.request<T>(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.status < 200 || result.status >= 300) {
      const responseBody: any = result.body;
      throw new Error(`POST ${route} failed:${result.status}:${safeErrorText(responseBody?.error ?? responseBody?.message ?? responseBody?.code)}`);
    }
    return result.body;
  }
}

function conciseLinkPage(page: Json): Json {
  const rows = asArray<Json>(page.rows);
  const reasonCounts: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of asArray<string>(row.reasons)) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }
  return {
    count: rows.length,
    nextCursor: page.nextCursor ?? null,
    schemaReady: page.schemaReady === true,
    eligibleCount: rows.filter((row) => row.eligible === true).length,
    reasonCounts,
    rows: rows.map((row) => ({
      contactId: Number(row.contactId),
      businessId: row.businessId == null ? null : Number(row.businessId),
      sourceLinkId: row.sourceLinkId ?? null,
      sourceEntityId: row.sourceEntityId == null ? null : Number(row.sourceEntityId),
      snapshotHash: row.snapshotHash ?? null,
      eligible: row.eligible === true,
      reasons: asArray<string>(row.reasons).map(safeErrorText),
    })),
  };
}

async function previewStrictContacts(api: ProductionApi, contactIds: number[]): Promise<Json[]> {
  const previews: Json[] = [];
  for (const contactId of contactIds) {
    // Cursor preview is the published system-link authority. Using id - 1 and
    // limit 1 yields the live row for this ID when it still participates; if
    // it does not, a following row cannot be mistaken for the requested ID.
    const response = await api.get<Json>(
      `/api/admin/contact-business-system-links/preview?afterContactId=${contactId - 1}&limit=1`,
    );
    const row = asArray<Json>(response.rows).find((candidate) => Number(candidate.contactId) === contactId);
    previews.push({
      contactId,
      schemaReady: response.schemaReady === true,
      found: !!row,
      businessId: row?.businessId == null ? null : Number(row.businessId),
      sourceLinkId: row?.sourceLinkId ?? null,
      sourceEntityId: row?.sourceEntityId == null ? null : Number(row.sourceEntityId),
      snapshotHash: row?.snapshotHash ?? null,
      eligible: row?.eligible === true,
      reasons: asArray<string>(row?.reasons).map(safeErrorText),
    });
  }
  return previews;
}

async function persistReceipt(receipt: Json): Promise<void> {
  await mkdir(RECEIPT_DIR, { recursive: true });
  await writeFile(CHECKPOINT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

async function loadCheckpoint(): Promise<Json | null> {
  try {
    return JSON.parse(await readFile(CHECKPOINT_PATH, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function inventory(api: ProductionApi, strictContactIds: number[] = []): Promise<Json> {
  const pause = await api.get<Json>("/api/admin/pause-state");
  const [healthResult, programResult, runsResult, linksResult, funnelResult] = await Promise.all([
    api.request<Json>("/api/health"),
    api.request<Json>("/api/lead-ops/sfp/program"),
    api.request<Json>("/api/lead-ops/sfp/runs"),
    api.request<Json>("/api/admin/contact-business-system-links/preview?afterContactId=0&limit=25"),
    api.request<Json>("/api/lead-ops/sfp/funnel?maxPreview=25"),
  ]);
  const program = programResult.body ?? {};
  const runRows = asArray<Json>(runsResult.body?.runs ?? runsResult.body);
  const currentRun = runRows.find((run) =>
    String(run.cohortState ?? run.cohort_state) === "frozen" &&
    !run.voidedAt && !run.voided_at && !run.supersededAt && !run.superseded_at &&
    Number(run.taxonomyVersion ?? run.taxonomy_version ?? program.taxonomyVersion) === 2,
  ) ?? null;
  const currentRunId = currentRun?.id ?? currentRun?.runId ?? null;
  const [runDetailResult, validationPreviewResult] = currentRunId
    ? await Promise.all([
        api.request<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(String(currentRunId))}`),
        api.request<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(String(currentRunId))}/validation-preview`),
      ])
    : [{ status: 404, body: null }, { status: 404, body: null }];
  const runCandidatesResult = currentRunId
    ? await api.request<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(String(currentRunId))}/candidates`)
    : { status: 404, body: null };
  const frozenMembershipResult = currentRunId
    ? await api.request<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(String(currentRunId))}/free-evidence`)
    : { status: 404, body: null };
  const linkPage = linksResult.body ?? {};
  const strictContactPreviews = strictContactIds.length
    ? await previewStrictContacts(api, strictContactIds)
    : [];
  const selectedCandidates = asArray<Json>(validationPreviewResult.body?.selectedCandidates);
  const liveStrictBusinessIds = [...new Set(strictContactPreviews
    .map((item) => Number(item.businessId))
    .filter((businessId) => Number.isSafeInteger(businessId)))];
  const runMemberIds = new Set(asArray<Json>(frozenMembershipResult.body?.perBusiness)
    .map((member) => Number(member.businessId))
    .filter((businessId) => Number.isSafeInteger(businessId)));
  const frozenCohortBusinessPreviews = liveStrictBusinessIds.map((businessId) => ({
    businessId,
    runId: currentRunId == null ? null : String(currentRunId),
    httpStatus: frozenMembershipResult.status,
    isFrozenCohortMember: frozenMembershipResult.status === 200 && runMemberIds.has(businessId),
    error: frozenMembershipResult.status >= 400
      ? safeErrorText(frozenMembershipResult.body?.error ?? frozenMembershipResult.body?.message ?? "request_failed") : null,
  }));
  const frozenCohortBusinessIds = new Set(frozenCohortBusinessPreviews
    .filter((item) => item.isFrozenCohortMember)
    .map((item) => item.businessId));
  const liveBusinessByContact = new Map(strictContactPreviews
    .filter((item) => item.found && Number.isSafeInteger(Number(item.businessId)))
    .map((item) => [Number(item.contactId), Number(item.businessId)]));
  const selectedStrictContactIds = selectedCandidates
    .map((candidate) => {
      const candidateId = String(candidate.candidateId ?? "");
      const contactId = candidateId.startsWith("contact:") ? Number(candidateId.slice("contact:".length)) : NaN;
      return Number.isSafeInteger(contactId) &&
        liveBusinessByContact.get(contactId) === Number(candidate.businessId) &&
        strictContactIds.includes(contactId) ? contactId : null;
    })
    .filter((contactId): contactId is number => contactId !== null);
  const selectedNonTargetCount = Math.max(0, selectedCandidates.length - selectedStrictContactIds.length);
  const targetBusinessCandidates = asArray<Json>(runCandidatesResult.body?.candidates)
    .filter((candidate) => frozenCohortBusinessIds.has(Number(candidate.businessId)))
    .map((candidate) => ({
      businessId: Number(candidate.businessId),
      sourceKind: String(candidate.sourceKind ?? "unknown"),
      contactId: String(candidate.sourceKind) === "contact"
        ? String(candidate.evidenceId ?? "").replace(/^contact:/, "") : null,
      field: safeErrorText(candidate.field ?? "unknown"),
      disposition: safeErrorText(candidate.disposition ?? "unknown"),
      subjectType: safeErrorText(candidate.subjectType ?? "unknown"),
      sourceSubjectType: safeErrorText(candidate.sourceSubjectType ?? "unknown"),
      duplicateOfOtherEvidence: Boolean(candidate.duplicateOfEvidenceId),
      confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
    }));
  const receipt = {
    generatedAt: new Date().toISOString(),
    productionBase: BASE_URL,
    publishedRelease: {
      httpStatus: healthResult.status,
      status: healthResult.body?.status ?? "unknown",
      sha: typeof healthResult.body?.sha === "string" ? healthResult.body.sha : null,
      builtAt: healthResult.body?.builtAt ?? null,
    },
    globalPause: {
      paused: pause?.paused === true,
      state: String(pause?.state ?? "unknown"),
      epoch: Number.isSafeInteger(Number(pause?.epoch)) ? Number(pause.epoch) : null,
      source: safeErrorText(pause?.source ?? "unknown"),
      reason: safeErrorText(pause?.reason ?? ""),
    },
    program: {
      httpStatus: programResult.status,
      id: program.id ?? program.programId ?? null,
      active: program.isActive ?? program.is_active ?? program.active ?? null,
      taxonomyVersion: Number(program.taxonomyVersion ?? program.taxonomy_version ?? NaN),
      policyVersion: Number(program.policyVersion ?? program.policy_version ?? NaN),
    },
    cohortRuns: {
      httpStatus: runsResult.status,
      count: runRows.length,
      frozenV2RunId: currentRun?.id ?? currentRun?.runId ?? null,
      frozenV2RunState: currentRun ? String(currentRun.cohortState ?? currentRun.cohort_state ?? "") : null,
      runIds: runRows.map((run) => ({
        id: run.id ?? run.runId ?? null,
        state: run.cohortState ?? run.cohort_state ?? null,
        taxonomyVersion: run.taxonomyVersion ?? run.taxonomy_version ?? null,
        cohortSize: run.cohortSize ?? run.cohort_size ?? null,
      })),
    },
    currentRunDetail: {
      httpStatus: runDetailResult.status,
      id: runDetailResult.body?.id ?? runDetailResult.body?.runId ?? currentRunId,
      state: runDetailResult.body?.cohortState ?? runDetailResult.body?.cohort_state ?? null,
      programId: runDetailResult.body?.programId ?? runDetailResult.body?.program_id ?? null,
      cohortHash: runDetailResult.body?.cohortHash ?? runDetailResult.body?.cohort_hash ?? null,
      cohortSize: Number(runDetailResult.body?.cohortSize ?? runDetailResult.body?.cohort_size ?? 0),
      selectedContactScope: runDetailResult.body?.selectedContactScope ?? null,
      taxonomyVersion: runDetailResult.body?.taxonomyVersion ?? runDetailResult.body?.taxonomy_version ?? null,
      voided: Boolean(runDetailResult.body?.voidedAt ?? runDetailResult.body?.voided_at),
      superseded: Boolean(runDetailResult.body?.supersededAt ?? runDetailResult.body?.superseded_at),
    },
    validationPreview: {
      httpStatus: validationPreviewResult.status,
      gateOpen: validationPreviewResult.body?.gateOpen === true,
      gateBlockedReason: validationPreviewResult.body?.gateBlockedReason
        ? safeErrorText(validationPreviewResult.body.gateBlockedReason) : null,
      addressesForValidation: Number(validationPreviewResult.body?.addressesForValidation ?? 0),
      cohortSize: Number(validationPreviewResult.body?.cohortSize ?? 0),
      selectedSourceCounts: {
        contact: selectedCandidates.filter((candidate) => String(candidate.candidateId ?? "").startsWith("contact:")).length,
        other: selectedCandidates.filter((candidate) => !String(candidate.candidateId ?? "").startsWith("contact:")).length,
      },
      contactCandidateIds: selectedCandidates
        .map((candidate) => String(candidate.candidateId ?? ""))
        .filter((candidateId) => candidateId.startsWith("contact:"))
        .map((candidateId) => candidateId.slice("contact:".length)),
      snapshotHash: validationPreviewResult.body?.snapshotHash ?? null,
    },
    normalServicesCohortPath: {
      existingFrozenV2RunId: currentRunId,
      currentValidationSelectionCount: selectedCandidates.length,
      selectedStrictTargetContactCount: selectedStrictContactIds.length,
      selectedNonTargetCount,
      targetContactOnlyValidationSupported: validationPreviewResult.body?.scopeCapabilities?.selectedContactIds === true,
      freshFreezeSelectedContactScopeSupported: funnelResult.body?.scopeCapabilities?.scopedFreshFreeze === true,
      action: funnelResult.body?.scopeCapabilities?.scopedFreshFreeze === true &&
        validationPreviewResult.body?.scopeCapabilities?.selectedContactIds === true
        ? "Use an existing frozen run only when targets are members; otherwise preview and create a new immutable scoped run from currently verified contact links and ordinary business eligibility."
        : "The currently published service does not advertise the bounded selectedContactIds path; do not create a general freeze or spend on unrelated winners.",
    },
    strictBusinessFrozenCohortPreview: {
      runId: currentRunId,
      count: frozenCohortBusinessPreviews.length,
      membershipHttpStatus: frozenMembershipResult.status,
      rows: frozenCohortBusinessPreviews,
    },
    strictBusinessCandidatePreview: {
      httpStatus: runCandidatesResult.status,
      candidates: targetBusinessCandidates,
    },
    contactLinkPreview: {
      httpStatus: linksResult.status,
      ...conciseLinkPage(linkPage),
    },
    strictContactIdPreview: {
      count: strictContactPreviews.length,
      livePreviewCount: strictContactPreviews.filter((item) => item.found).length,
      liveEligibleCount: strictContactPreviews.filter((item) => item.found && item.eligible && item.schemaReady).length,
      rows: strictContactPreviews,
    },
    stageCounts: {
      initialPageEligibleCandidates: asArray<Json>(linkPage.rows).filter((row) => row.eligible === true).length,
      strictContactIds: strictContactIds.length,
      freshStrictContactPreviews: strictContactPreviews.filter((item) => item.found && item.eligible && item.schemaReady).length,
      systemLinksApplied: 0,
      zeroBounceRequests: 0,
      zeroBounceValid: 0,
      masterLeadsProjected: 0,
      readyHeldIntents: 0,
      pausedEnrollments: 0,
    },
    funnel: {
      httpStatus: funnelResult.status,
      error: funnelResult.status >= 400
        ? safeErrorText(funnelResult.body?.error ?? funnelResult.body?.message ?? "request_failed") : null,
      cohortSize: funnelResult.body?.funnel?.cohortSize ?? funnelResult.body?.funnel?.cohort_size ?? null,
      topCandidateCount: asArray(funnelResult.body?.topCandidates).length,
    },
    completedStages: [] as Json[],
    remainingBlockers: [] as string[],
  };
  if (healthResult.status !== 200 || receipt.publishedRelease.status !== "ok" ||
      !/^[a-f0-9]{40}$/i.test(String(receipt.publishedRelease.sha ?? ""))) {
    receipt.remainingBlockers.push("published_release_identity_unverified");
  }
  if (programResult.status !== 200) receipt.remainingBlockers.push(`program_read_http_${programResult.status}`);
  if (runsResult.status !== 200) receipt.remainingBlockers.push(`runs_read_http_${runsResult.status}`);
  if (linksResult.status !== 200) receipt.remainingBlockers.push(`system_link_preview_http_${linksResult.status}`);
  if (strictContactPreviews.some((item) => !item.found)) receipt.remainingBlockers.push("one_or_more_strict_report_ids_have_no_current_live_preview_row");
  if (strictContactPreviews.some((item) => !item.schemaReady)) receipt.remainingBlockers.push("strict_contact_link_schema_not_ready");
  if (strictContactPreviews.some((item) => item.found && !item.eligible)) receipt.remainingBlockers.push("one_or_more_strict_report_contacts_are_no_longer_live_eligible");
  if (funnelResult.status !== 200) receipt.remainingBlockers.push(`funnel_read_http_${funnelResult.status}`);
  if (validationPreviewResult.status !== 200) receipt.remainingBlockers.push(`validation_preview_http_${validationPreviewResult.status}`);
  if (validationPreviewResult.status === 200 && validationPreviewResult.body?.gateOpen !== true) {
    receipt.remainingBlockers.push(`validation_gate:${safeErrorText(validationPreviewResult.body?.gateBlockedReason)}`);
  }
  if (strictContactIds.length > 0 && selectedNonTargetCount > 0) {
    receipt.remainingBlockers.push("current_frozen_run_validation_winner_set_includes_non_target_or_non_contact_candidates; no provider request made");
  }
  if (strictContactIds.length > 0 && selectedStrictContactIds.length === 0) {
    receipt.remainingBlockers.push("no_linked_contact_selected_by_validation_preview_in_current_frozen_cohort");
  }
  if (!receipt.globalPause.paused) receipt.remainingBlockers.push("global_outbound_pause_not_confirmed");
  if (!receipt.cohortRuns.frozenV2RunId) receipt.remainingBlockers.push("current_frozen_v2_cohort_not_found");
  return receipt;
}

function stagingIntentReceipts(
  result: Json,
  expectedEligibilityIds: string[],
): Array<{ eligibilityId: string; intentId: string }> {
  const stagedIntents = asArray<Json>(result?.stagedIntents)
    .filter((item) => typeof item.eligibilityId === "string" && typeof item.intentId === "string")
    .map((item) => ({ eligibilityId: String(item.eligibilityId), intentId: String(item.intentId) }));
  if (stagedIntents.length !== Number(result?.readyHeld ?? -1) ||
      stagedIntents.some((item) => !expectedEligibilityIds.includes(item.eligibilityId)) ||
      new Set(stagedIntents.map((item) => item.intentId)).size !== stagedIntents.length) {
    throw new Error("STAGING_INTENT_ID_RECEIPT_MISSING_OR_MISMATCHED; pending command saved for safe replay; do not bridge without exact IDs.");
  }
  return stagedIntents;
}

async function bridgeReadyHeldIntents(
  api: ProductionApi,
  receipt: Json,
  completed: Json[],
  stagedIntents: Array<{ eligibilityId: string; intentId: string }>,
  blockers: string[],
): Promise<void> {
  const alreadyPaused = new Set(completed.filter((item) =>
    item.stage === "paused_enrollment_bridge" &&
    ["created", "already_bridged"].includes(item.status) &&
    item.enrollmentStatus === "paused").map((item) => String(item.intentId)));
  for (const staged of stagedIntents) {
    if (alreadyPaused.has(staged.intentId)) continue;
    const bridge = await api.mutate<Json>(
      `/api/lead-ops/sfp/staging-intents/${encodeURIComponent(staged.intentId)}/bridge-to-paused-enrollment`,
      {},
    );
    const bridgeReceipt = {
      stage: "paused_enrollment_bridge",
      intentId: staged.intentId,
      eligibilityId: staged.eligibilityId,
      status: safeErrorText(bridge.status),
      enrollmentStatus: bridge.enrollmentStatus ?? null,
      heldReason: bridge.heldReason ? safeErrorText(bridge.heldReason) : null,
    };
    completed.push(bridgeReceipt);
    if (bridge.status === "created" || bridge.status === "already_bridged") {
      if (bridge.enrollmentStatus !== "paused") {
        receipt.completedStages = completed;
        receipt.remainingBlockers = blockers;
        await persistReceipt(receipt);
        throw new Error("BRIDGED_ENROLLMENT_NOT_PAUSED; operator stopped.");
      }
      receipt.stageCounts.pausedEnrollments = Number(receipt.stageCounts.pausedEnrollments ?? 0) + 1;
    } else {
      blockers.push(`paused_enrollment_bridge_left_held:${safeErrorText(bridge.heldReason ?? bridge.status)}`);
    }
    receipt.completedStages = completed;
    receipt.remainingBlockers = blockers;
    receipt.pendingStagingCommand = null;
    receipt.updatedAt = new Date().toISOString();
    await persistReceipt(receipt);
  }
}

async function main(): Promise<void> {
  requiredRuntime();
  const api = new ProductionApi();
  await api.login();
  const checkpoint = await loadCheckpoint();

  if (MODE === "inventory") {
    const strictInput = await loadStrictContactInput(STRICT_REPORT_PATH, STRICT_CONTACT_IDS_INPUT);
    const strictContactIds = strictInput.contactIds;
    const receipt = await inventory(api, strictContactIds);
    if (checkpoint?.productionBase === BASE_URL) {
      receipt.completedStages = asArray<Json>(checkpoint.completedStages);
      receipt.stageCounts = { ...receipt.stageCounts, ...(checkpoint.stageCounts ?? {}) };
      delete receipt.stageCounts.strictReportContactIds;
      receipt.remainingBlockers = asArray<string>(receipt.remainingBlockers);
      receipt.pendingStagingCommand = checkpoint.pendingStagingCommand ?? null;
      if (strictInput.source === "none") receipt.strictContactInput = checkpoint.strictContactInput ?? null;
      const completedLinks = new Set(asArray<Json>(checkpoint.completedStages)
        .filter((item) => item.stage === "system_link" && ["applied", "replayed"].includes(item.status))
        .map((item) => `${Number(item.contactId)}:${Number(item.businessId)}`));
      const strictRows = asArray<Json>(receipt.strictContactIdPreview?.rows);
      const everyIneligibleStrictRowWasAlreadyApplied = strictRows.length > 0 &&
        strictRows.every((row) => row.found === true && row.schemaReady === true &&
          (row.eligible === true || completedLinks.has(`${Number(row.contactId)}:${Number(row.businessId)}`)));
      if (everyIneligibleStrictRowWasAlreadyApplied) {
        receipt.remainingBlockers = asArray<string>(receipt.remainingBlockers).filter((blocker: string) =>
          blocker !== "one_or_more_strict_report_contacts_are_no_longer_live_eligible");
      }
    }
    if (strictInput.source !== "none") {
      receipt.strictContactInput = {
        source: strictInput.source,
        reportPath: strictInput.reportPath ? path.relative(ROOT, strictInput.reportPath) : null,
        contactIdCount: strictContactIds.length,
        offlineHashesUsedForAuthority: false,
      };
    }
    await persistReceipt(receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  if (!STRICT_REPORT_PATH && !STRICT_CONTACT_IDS_INPUT) {
    throw new Error("STRICT_CONTACT_INPUT_REQUIRED; pass a completed aggregate report or bounded contact-ID hints for fresh live preview.");
  }
  if (!/^[a-f0-9]{40}$/i.test(PUBLISHED_RELEASE_SHA)) {
    throw new Error("PUBLISHED_RELEASE_SHA_REQUIRED; pass the exact current /api/health SHA after the intended backend release is published.");
  }
  const strictInput = await loadStrictContactInput(STRICT_REPORT_PATH, STRICT_CONTACT_IDS_INPUT);
  const strictContactIds = strictInput.contactIds;
  if (!checkpoint || checkpoint.productionBase !== BASE_URL || !checkpoint.cohortRuns?.frozenV2RunId) {
    throw new Error("Fresh --inventory checkpoint required for this production URL and a current frozen v2 cohort.");
  }
  if (checkpoint.globalPause?.paused !== true) {
    throw new Error("Inventory did not confirm the global outbound pause; no mutation attempted.");
  }
  if (checkpoint.contactLinkPreview?.schemaReady !== true) {
    throw new Error("Contact-link write contract is not ready; no mutation attempted.");
  }

  const fresh = await inventory(api, strictContactIds);
  if (fresh.globalPause?.paused !== true) throw new Error("GLOBAL_OUTBOUND_PAUSE_NOT_CONFIRMED");
  if (fresh.publishedRelease?.status !== "ok" ||
      String(fresh.publishedRelease?.sha ?? "").toLowerCase() !== PUBLISHED_RELEASE_SHA.toLowerCase()) {
    throw new Error("PUBLISHED_RELEASE_SHA_MISMATCH; no mutation attempted.");
  }
  if (fresh.program?.active !== true) throw new Error("SFP_PROGRAM_INACTIVE; no mutation attempted.");
  const priorReceipts = asArray<Json>(checkpoint.completedStages);
  const liveScope = fresh.currentRunDetail?.selectedContactScope;
  const liveScopeIds = asArray<number>(liveScope?.selectedContactIds).map(Number).sort((a, b) => a - b);
  const liveScopeTargets = asArray<Json>(liveScope?.resolvedTargets);
  const liveTargetIds = liveScopeTargets.map((target) => Number(target.contactId)).sort((a, b) => a - b);
  const recoverableLiveScope = liveScopeIds.length > 0 &&
    liveScopeIds.length <= MAX_TOTAL &&
    new Set(liveScopeIds).size === liveScopeIds.length &&
    liveScopeIds.every((id) => strictContactIds.includes(id)) &&
    liveScopeTargets.length === liveScopeIds.length &&
    liveTargetIds.every((id, index) => id === liveScopeIds[index]) &&
    liveScopeTargets.every((target) =>
      liveScopeIds.includes(Number(target.contactId)) &&
      Number.isSafeInteger(Number(target.businessId)) &&
      /^[0-9a-f-]{36}$/i.test(String(target.linkDecisionId ?? "")) &&
      Number.isSafeInteger(Number(target.linkRevision)) &&
      Number(target.linkRevision) > 0) &&
    Number(fresh.currentRunDetail?.cohortSize) === liveScopeIds.length &&
    /^[a-f0-9]{64}$/i.test(String(fresh.currentRunDetail?.cohortHash ?? "")) &&
    /^[a-f0-9]{64}$/i.test(String(liveScope?.previewSnapshotHash ?? ""));
  const recoveredScopeReceipt: Json | null = recoverableLiveScope ? {
    stage: "selected_contact_cohort_freeze",
    runId: String(fresh.currentRunDetail.id),
    selectedContactIds: liveScopeIds,
    resolvedTargets: liveScopeTargets,
    scopePreviewHash: String(liveScope.previewSnapshotHash),
    cohortHash: String(fresh.currentRunDetail.cohortHash),
    requestHash: null,
    cohortSize: liveScopeIds.length,
    newlyFrozen: false,
  } : null;
  const checkpointScopedRunId = [...asArray<Json>(checkpoint.completedStages)].reverse()
    .find((item) => item.stage === "selected_contact_cohort_freeze")?.runId ?? null;
  if (fresh.cohortRuns?.frozenV2RunId !== checkpoint.cohortRuns.frozenV2RunId &&
      fresh.cohortRuns?.frozenV2RunId !== checkpointScopedRunId &&
      !(recoveredScopeReceipt && fresh.cohortRuns?.frozenV2RunId === recoveredScopeReceipt.runId)) {
    throw new Error("FROZEN_V2_COHORT_CHANGED; rerun --inventory and review.");
  }
  if (fresh.currentRunDetail?.httpStatus !== 200 ||
      fresh.currentRunDetail?.state !== "frozen" ||
      fresh.currentRunDetail?.voided === true ||
      fresh.currentRunDetail?.superseded === true ||
      String(fresh.currentRunDetail?.programId ?? "") !== String(fresh.program?.id ?? "")) {
    throw new Error("CURRENT_FROZEN_COHORT_NOT_USABLE_FOR_THIS_PROGRAM; no mutation attempted.");
  }

  const savedContactScopeRun = [...priorReceipts].reverse().find((item) => {
    const ids = asArray<number>(item.selectedContactIds).map(Number);
    return item.stage === "selected_contact_cohort_freeze" &&
      ids.length > 0 && ids.length <= MAX_TOTAL &&
      ids.every((id) => strictContactIds.includes(id)) &&
      /^[0-9a-f-]{36}$/i.test(String(item.runId ?? "")) &&
      /^[a-f0-9]{64}$/i.test(String(item.cohortHash ?? ""));
  }) ?? recoveredScopeReceipt;
  let runId = savedContactScopeRun
    ? String(savedContactScopeRun.runId)
    : String(fresh.cohortRuns.frozenV2RunId);
  if (savedContactScopeRun) {
    const scopedRun = await api.get<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(runId)}`);
    const savedScopeIds = asArray<number>(savedContactScopeRun.selectedContactIds).map(Number).sort((a, b) => a - b);
    const returnedScopeIds = asArray<number>(scopedRun.selectedContactScope?.selectedContactIds)
      .map(Number).sort((a, b) => a - b);
    const savedTargets = asArray<Json>(savedContactScopeRun.resolvedTargets);
    const returnedTargets = asArray<Json>(scopedRun.selectedContactScope?.resolvedTargets);
    const scopeReceiptMatches = savedScopeIds.length === returnedScopeIds.length &&
      savedScopeIds.every((contactId, index) => contactId === returnedScopeIds[index]) &&
      String(scopedRun.selectedContactScope?.previewSnapshotHash ?? "") === String(savedContactScopeRun.scopePreviewHash ?? "") &&
      savedTargets.length === returnedTargets.length &&
      savedTargets.every((target) => returnedTargets.some((returned) =>
        Number(returned.contactId) === Number(target.contactId) &&
        Number(returned.businessId) === Number(target.businessId) &&
        String(returned.linkDecisionId) === String(target.linkDecisionId) &&
        Number(returned.linkRevision) === Number(target.linkRevision)));
    if (String(scopedRun.cohortState ?? "") !== "frozen" ||
        String(scopedRun.cohortHash ?? "") !== String(savedContactScopeRun.cohortHash) ||
        Number(scopedRun.cohortSize) !== asArray(savedContactScopeRun.selectedContactIds).length ||
        scopedRun.voidedAt || scopedRun.supersededAt || !scopeReceiptMatches) {
      throw new Error("SAVED_SELECTED_CONTACT_COHORT_NO_LONGER_MATCHES_RECEIPT");
    }
  }
  const pendingStage = checkpoint.pendingStagingCommand;
  const pendingSourceIds = asArray<number>(pendingStage?.strictContactIds).map(Number);
  const pendingEligibilityIds = asArray<string>(pendingStage?.eligibilityIds);
  if (pendingStage && String(pendingStage.cohortRunId) === runId &&
      pendingSourceIds.length > 0 && pendingSourceIds.every((id) => strictContactIds.includes(id)) &&
      pendingEligibilityIds.length > 0 && pendingEligibilityIds.length <= MAX_TOTAL &&
      pendingEligibilityIds.every((id) => /^[0-9a-f-]{36}$/i.test(id)) &&
      /^[a-f0-9]{64}$/i.test(String(pendingStage.snapshotHash ?? "")) &&
      /^[a-f0-9]{64}$/i.test(String(pendingStage.confirmPayloadHash ?? "")) &&
      String(pendingStage.commandKey ?? "").startsWith(`sfp-stage-v2:${runId}:`)) {
    const replayedStage = await api.mutate<Json>("/api/lead-ops/sfp/campaign-staging-v2/execute", {
      cohortRunId: String(pendingStage.cohortRunId),
      eligibilityIds: pendingEligibilityIds,
      commandKey: String(pendingStage.commandKey),
      snapshotHash: String(pendingStage.snapshotHash),
      confirmPayloadHash: String(pendingStage.confirmPayloadHash),
    });
    const stagedIntents = stagingIntentReceipts(replayedStage, pendingEligibilityIds);
    const completed = [...priorReceipts, {
      stage: "staging_v2",
      runId,
      commandKey: String(pendingStage.commandKey),
      sourceContactIds: pendingSourceIds,
      readyHeld: Number(replayedStage.readyHeld ?? 0),
      rejected: Number(replayedStage.rejected ?? 0),
      stagedIntents,
      replayed: true,
    }];
    const resumeReceipt: Json = {
      ...fresh,
      stageCounts: { ...fresh.stageCounts, ...(checkpoint.stageCounts ?? {}) },
      strictContactInput: checkpoint.strictContactInput ?? null,
      completedStages: completed,
      remainingBlockers: asArray<string>(checkpoint.remainingBlockers),
      pendingStagingCommand: null,
      updatedAt: new Date().toISOString(),
    };
    resumeReceipt.stageCounts.masterLeadsProjected = Number(replayedStage.readyHeld ?? 0);
    resumeReceipt.stageCounts.readyHeldIntents = Number(replayedStage.readyHeld ?? 0);
    await persistReceipt(resumeReceipt);
    const blockers = asArray<string>(resumeReceipt.remainingBlockers);
    await bridgeReadyHeldIntents(api, resumeReceipt, completed, stagedIntents, blockers);
    resumeReceipt.completedStages = completed;
    resumeReceipt.remainingBlockers = blockers;
    await persistReceipt(resumeReceipt);
    console.log(JSON.stringify({
      status: "resumed_pending_staging_command",
      frozenV2RunId: runId,
      stagedIntentCount: stagedIntents.length,
      pausedEnrollmentCount: resumeReceipt.stageCounts.pausedEnrollments,
      remainingBlockers: blockers,
      receiptPath: path.relative(ROOT, CHECKPOINT_PATH),
    }, null, 2));
    return;
  }
  if (pendingStage) {
    throw new Error("PENDING_STAGING_COMMAND_SCOPE_MISMATCH_OR_INVALID; manual review required before any new mutation.");
  }
  const priorStage = [...priorReceipts].reverse().find((item) => {
    const sourceIds = asArray<number>(item.sourceContactIds).map(Number);
    return item.stage === "staging_v2" && String(item.runId) === runId &&
      Array.isArray(item.stagedIntents) && sourceIds.length > 0 &&
      sourceIds.every((id) => strictContactIds.includes(id));
  });
  if (priorStage && asArray<Json>(priorStage.stagedIntents).length > 0) {
    const completed = [...priorReceipts];
    const resumeReceipt: Json = {
      ...fresh,
      stageCounts: { ...fresh.stageCounts, ...(checkpoint.stageCounts ?? {}) },
      strictContactInput: checkpoint.strictContactInput ?? null,
      completedStages: completed,
      remainingBlockers: asArray<string>(checkpoint.remainingBlockers),
      pendingStagingCommand: null,
      updatedAt: new Date().toISOString(),
    };
    const blockers = asArray<string>(resumeReceipt.remainingBlockers);
    await bridgeReadyHeldIntents(api, resumeReceipt, completed, asArray(priorStage.stagedIntents), blockers);
    resumeReceipt.completedStages = completed;
    resumeReceipt.remainingBlockers = blockers;
    await persistReceipt(resumeReceipt);
    console.log(JSON.stringify({
      status: "resumed_paused_enrollment_bridges",
      frozenV2RunId: runId,
      stagedIntentCount: asArray(priorStage.stagedIntents).length,
      pausedEnrollmentCount: resumeReceipt.stageCounts.pausedEnrollments,
      remainingBlockers: blockers,
      receiptPath: path.relative(ROOT, CHECKPOINT_PATH),
    }, null, 2));
    return;
  }

  const strictPreviews = asArray<Json>(fresh.strictContactIdPreview?.rows);
  if (strictPreviews.length !== strictContactIds.length ||
      strictPreviews.some((row) => row.schemaReady !== true)) {
    throw new Error("LIVE_STRICT_CONTACT_PREVIEW_UNAVAILABLE; no mutation attempted.");
  }
  const candidates = strictPreviews
    .filter((row) => row.found === true && row.eligible === true &&
      Number.isSafeInteger(row.contactId) && Number.isSafeInteger(row.businessId) &&
      typeof row.sourceLinkId === "string" && Number.isSafeInteger(row.sourceEntityId) &&
      typeof row.snapshotHash === "string" && /^[a-f0-9]{64}$/i.test(row.snapshotHash))
    .slice(0, MAX_TOTAL);
  const alreadyLinked = new Set(
    priorReceipts.filter((item) => item.stage === "system_link" && ["applied", "replayed"].includes(item.status))
      .map((item) => `${Number(item.contactId)}:${Number(item.businessId)}`),
  );
  const toApply = candidates.filter((item) => !alreadyLinked.has(`${Number(item.contactId)}:${Number(item.businessId)}`));

  const linkResult = toApply.length
    ? await api.mutate<Json>("/api/admin/contact-business-system-links/apply", {
        items: toApply.map((item) => ({
          contactId: Number(item.contactId),
          businessId: Number(item.businessId),
          sourceLinkId: String(item.sourceLinkId),
          sourceEntityId: Number(item.sourceEntityId),
          snapshotHash: String(item.snapshotHash),
        })),
      })
    : { outcomes: [] };
  const linkOutcomes = asArray<Json>(linkResult.outcomes).map((outcome) => ({
    stage: "system_link",
    contactId: Number(outcome.contactId),
    businessId: outcome.businessId == null ? null : Number(outcome.businessId),
    status: safeErrorText(outcome.status),
    code: outcome.code ? safeErrorText(outcome.code) : null,
    decisionId: outcome.decisionId ?? null,
  }));
  const newlySucceeded = linkOutcomes.filter((item) => item.status === "applied" || item.status === "replayed");
  const previouslySucceeded = priorReceipts.filter((item) => item.stage === "system_link" &&
    ["applied", "replayed"].includes(item.status) &&
    strictContactIds.includes(Number(item.contactId)) &&
    Number.isSafeInteger(Number(item.businessId)));
  const linksSucceeded = [...previouslySucceeded, ...newlySucceeded]
    .filter((item, index, all) => all.findIndex((other) =>
      Number(other.contactId) === Number(item.contactId) && Number(other.businessId) === Number(item.businessId)) === index);
  const validationContactIds = linksSucceeded.map((item) => Number(item.contactId)).sort((a, b) => a - b);
  const savedValidationReceipt = [...priorReceipts].reverse().find((item) =>
    item.stage === "zerobounce" && String(item.runId) === runId);
  const savedValidationIds = asArray<number>(savedValidationReceipt?.selectedContactIds)
    .map(Number).sort((a, b) => a - b);
  const savedScopeIds = asArray<number>(savedValidationReceipt?.selectedContactScope?.selectedContactIds)
    .map(Number).sort((a, b) => a - b);
  const savedValidationTargets = asArray<Json>(savedValidationReceipt?.selectedContactScope?.resolvedTargets);
  const savedCompletedContactReceipts = asArray<Json>(savedValidationReceipt?.selectedContactScope?.completedContactReceipts);
  const savedCompletedContactIds = savedCompletedContactReceipts.map((item) => Number(item.contactId)).sort((a, b) => a - b);
  const savedValidationTargetIds = savedValidationTargets.map((target) => Number(target.contactId)).sort((a, b) => a - b);
  const savedCompletedReceiptPinsMatch = savedCompletedContactReceipts.every((receipt) => {
    const target = savedValidationTargets.find((item) => Number(item.contactId) === Number(receipt.contactId));
    return !!target &&
      Number(receipt.businessId) === Number(target.businessId) &&
      String(receipt.linkDecisionId) === String(target.linkDecisionId) &&
      Number(receipt.linkRevision) === Number(target.linkRevision) &&
      /^[a-f0-9]{64}$/i.test(String(receipt.normalizedAddressHash ?? ""));
  });
  const savedValidationTargetsMatch = savedValidationReceipt &&
    savedValidationReceipt.selectedContactScope?.scopeCoverageComplete === true &&
    savedValidationIds.length === validationContactIds.length &&
    savedValidationIds.every((id, index) => id === validationContactIds[index]) &&
    savedScopeIds.length === validationContactIds.length &&
    savedScopeIds.every((id, index) => id === validationContactIds[index]) &&
    savedValidationTargetIds.length === validationContactIds.length &&
    savedValidationTargetIds.every((id, index) => id === validationContactIds[index]) &&
    savedValidationTargets.length === validationContactIds.length &&
    savedValidationTargets.every((target) => linksSucceeded.some((link) =>
      Number(link.contactId) === Number(target.contactId) &&
      Number(link.businessId) === Number(target.businessId) &&
      typeof target.linkDecisionId === "string" &&
      Number.isSafeInteger(Number(target.linkRevision)) &&
      Number(target.linkRevision) > 0)) &&
    savedCompletedContactIds.length === validationContactIds.length &&
    savedCompletedContactIds.every((id, index) => id === validationContactIds[index]) &&
    savedCompletedReceiptPinsMatch &&
    /^[a-f0-9]{64}$/i.test(String(savedValidationReceipt.snapshotHash ?? ""));
  const completed = [...priorReceipts, ...linkOutcomes];
  const linkedContactIdSet = new Set(linksSucceeded.map((item) => Number(item.contactId)));
  const currentlyEligibleContactIdSet = new Set(candidates.map((item) => Number(item.contactId)));
  const blockers = [
    ...asArray<string>(fresh.remainingBlockers).filter((blocker) =>
      !(savedValidationTargetsMatch &&
        (blocker.startsWith("validation_gate:") ||
         blocker === "no_linked_contact_selected_by_validation_preview_in_current_frozen_cohort"))),
    ...(strictContactIds.length === 0 ? ["full_pool_aggregate_has_no_strict_candidates"] : []),
    ...(strictContactIds.some((contactId) =>
      !linkedContactIdSet.has(contactId) && !currentlyEligibleContactIdSet.has(contactId))
      ? ["some_strict_report_ids_are_not_currently_live_strictly_eligible"] : []),
    ...(linksSucceeded.length === 0 && candidates.length > 0 ? ["no_system_link_writes_applied_or_replayed"] : []),
  ];
  await persistReceipt({
    ...fresh,
    downstreamCohortRunId: runId,
    updatedAt: new Date().toISOString(),
    strictContactInput: {
      source: strictInput.source,
      reportPath: strictInput.reportPath ? path.relative(ROOT, strictInput.reportPath) : null,
      contactIdCount: strictContactIds.length,
      offlineHashesUsedForAuthority: false,
    },
    stageCounts: {
      strictContactLinkCandidates: candidates.length,
      systemLinksApplied: linksSucceeded.length,
      zeroBounceRequests: savedValidationTargetsMatch ? Number(savedValidationReceipt.providerRequests ?? 0) : 0,
      zeroBounceValid: savedValidationTargetsMatch ? Number(savedValidationReceipt.validCount ?? 0) : 0,
      masterLeadsProjected: 0,
      readyHeldIntents: 0,
      pausedEnrollments: 0,
    },
    completedStages: completed,
    remainingBlockers: blockers,
  });
  let selectedContactCohortReceipt: Json | null = savedContactScopeRun ?? null;
  if (validationContactIds.length > 0) {
    if (savedContactScopeRun) {
      const frozenIds = asArray<number>(savedContactScopeRun.selectedContactIds).map(Number).sort((a, b) => a - b);
      if (frozenIds.length !== validationContactIds.length ||
          frozenIds.some((contactId, index) => contactId !== validationContactIds[index])) {
        throw new Error("SAVED_SELECTED_CONTACT_COHORT_SCOPE_MISMATCH; no validation or staging attempted.");
      }
    } else {
      const memberByBusiness = new Map(asArray<Json>(fresh.strictBusinessFrozenCohortPreview?.rows)
        .map((row) => [Number(row.businessId), row.isFrozenCohortMember === true &&
          Number(row.httpStatus) === 200]));
      const everyTargetIsCurrentMember = linksSucceeded.every((item) =>
        memberByBusiness.get(Number(item.businessId)) === true);
      if (!everyTargetIsCurrentMember) {
        const targetPreview = await api.get<Json>(
          `/api/lead-ops/sfp/funnel?maxPreview=${MAX_TOTAL}&selectedContactIds=${encodeURIComponent(validationContactIds.join(","))}`,
        );
        const previewScope = targetPreview.selectedContactScope;
        const previewIds = asArray<number>(previewScope?.selectedContactIds).map(Number).sort((a, b) => a - b);
        const resolvedTargets = asArray<Json>(previewScope?.resolvedTargets);
        const expectedBusinessByContact = new Map(linksSucceeded.map((item) =>
          [Number(item.contactId), Number(item.businessId)]));
        const candidates = asArray<Json>(targetPreview.topCandidates);
        const exactPreviewScope = targetPreview.scopeCapabilities?.selectedContactIds === true &&
          targetPreview.scopeCapabilities?.scopedFreshFreeze === true &&
          previewIds.length === validationContactIds.length &&
          previewIds.every((contactId, index) => contactId === validationContactIds[index]) &&
          resolvedTargets.length === validationContactIds.length &&
          resolvedTargets.every((target) =>
            expectedBusinessByContact.get(Number(target.contactId)) === Number(target.businessId) &&
            typeof target.linkDecisionId === "string" &&
            Number.isSafeInteger(Number(target.linkRevision))) &&
          candidates.length === validationContactIds.length &&
          candidates.every((candidate) =>
            Number.isSafeInteger(Number(candidate.contactId)) &&
            expectedBusinessByContact.get(Number(candidate.contactId)) === Number(candidate.businessId) &&
            candidate.eligible === true) &&
          /^[a-f0-9]{64}$/i.test(String(previewScope?.snapshotHash ?? ""));
        if (!exactPreviewScope) {
          throw new Error("SELECTED_CONTACT_COHORT_PREVIEW_DID_NOT_RESOLVE_EXACT_AUTHORIZED_ELIGIBLE_SCOPE; no freeze or validation attempted.");
        }
        const frozenScope = await api.mutate<Json>("/api/lead-ops/sfp/runs/freeze", {
          idempotencyKey: stableKey("selected-contact-cohort", {
            selectedContactIds: validationContactIds,
            previewSnapshotHash: String(previewScope.snapshotHash),
          }),
          maxCohortSize: MAX_TOTAL,
          selectedContactIds: validationContactIds,
          previewSnapshotHash: String(previewScope.snapshotHash),
        });
        const frozenRun = frozenScope.run;
        const frozenRunScopeIds = asArray<number>(frozenRun?.selectedContactScope?.selectedContactIds)
          .map(Number).sort((a, b) => a - b);
        const frozenRunTargets = asArray<Json>(frozenRun?.selectedContactScope?.resolvedTargets);
        const freezeReceiptPinsExactScope = frozenRunScopeIds.length === validationContactIds.length &&
          frozenRunScopeIds.every((contactId, index) => contactId === validationContactIds[index]) &&
          String(frozenRun?.selectedContactScope?.previewSnapshotHash ?? "") === String(previewScope.snapshotHash) &&
          frozenRunTargets.length === resolvedTargets.length &&
          resolvedTargets.every((target) => frozenRunTargets.some((returned) =>
            Number(returned.contactId) === Number(target.contactId) &&
            Number(returned.businessId) === Number(target.businessId) &&
            String(returned.linkDecisionId) === String(target.linkDecisionId) &&
            Number(returned.linkRevision) === Number(target.linkRevision)));
        if (String(frozenRun?.cohortState ?? "") !== "frozen" ||
            Number(frozenRun?.cohortSize) !== validationContactIds.length ||
            !/^[0-9a-f-]{36}$/i.test(String(frozenRun?.id ?? "")) ||
            !/^[a-f0-9]{64}$/i.test(String(frozenRun?.cohortHash ?? "")) ||
            !freezeReceiptPinsExactScope) {
          throw new Error("SELECTED_CONTACT_COHORT_FREEZE_RECEIPT_MISMATCH; no validation or staging attempted.");
        }
        runId = String(frozenRun.id);
        selectedContactCohortReceipt = {
          stage: "selected_contact_cohort_freeze",
          runId,
          selectedContactIds: validationContactIds,
          resolvedTargets: resolvedTargets.map((target) => ({
            contactId: Number(target.contactId),
            businessId: Number(target.businessId),
            linkDecisionId: String(target.linkDecisionId),
            linkRevision: Number(target.linkRevision),
          })),
          scopePreviewHash: String(previewScope.snapshotHash),
          cohortHash: String(frozenRun.cohortHash),
          requestHash: frozenRun.requestHash ?? null,
          cohortSize: Number(frozenRun.cohortSize),
          newlyFrozen: frozenScope.newlyFrozen === true,
        };
      }
    }
  }
  if (selectedContactCohortReceipt && !completed.some((item) =>
    item.stage === "selected_contact_cohort_freeze" && String(item.runId) === String(selectedContactCohortReceipt?.runId))) {
    completed.push(selectedContactCohortReceipt);
  }
  const receipt: Json = {
    ...fresh,
    downstreamCohortRunId: runId,
    selectedContactCohort: selectedContactCohortReceipt,
    updatedAt: new Date().toISOString(),
    strictContactInput: {
      source: strictInput.source,
      reportPath: strictInput.reportPath ? path.relative(ROOT, strictInput.reportPath) : null,
      contactIdCount: strictContactIds.length,
      offlineHashesUsedForAuthority: false,
    },
    stageCounts: {
      strictContactLinkCandidates: candidates.length,
      systemLinksApplied: linksSucceeded.length,
      zeroBounceRequests: 0,
      zeroBounceValid: 0,
      masterLeadsProjected: 0,
      readyHeldIntents: 0,
      pausedEnrollments: 0,
    },
    completedStages: completed,
    remainingBlockers: blockers,
  };
  await persistReceipt(receipt);

  let validationPreview: Json | null = null;
  let validationResult: Json | null = null;
  let targetContactCandidates: Array<{ contactId: number; businessId: number }> = [];
  if (linksSucceeded.length > 0 && strictContactIds.length > 0) {
    if (savedValidationTargetsMatch) {
      // A prior scoped validation can leave a named-contact result policy-held
      // for an independent admin decision. Reuse its immutable receipt on a
      // later operator pass so approval can continue through normal staging
      // without revalidating, broadening, or spending again.
      validationResult = savedValidationReceipt;
      targetContactCandidates = savedValidationTargets.map((target) => ({
        contactId: Number(target.contactId),
        businessId: Number(target.businessId),
      }));
      receipt.validationSelectionCoverage = {
        currentFrozenRunId: runId,
        selectedContactIds: validationContactIds,
        selectedCandidateCount: targetContactCandidates.length,
        selectedTargetContactCount: targetContactCandidates.length,
        selectedNonTargetCount: 0,
        onlyAuthorizedStrictContactsSelected: true,
        resumedFromImmutableValidationReceipt: true,
      };
    } else {
      validationPreview = await api.get<Json>(
        `/api/lead-ops/sfp/runs/${encodeURIComponent(runId)}/validation-preview?selectedContactIds=${encodeURIComponent(validationContactIds.join(","))}`,
      );
      const selected = asArray<Json>(validationPreview.selectedCandidates);
      const previewScopeIds = asArray<number>(validationPreview.selectedContactScope?.selectedContactIds)
        .map(Number).sort((a, b) => a - b);
      const previewScopeTargets = asArray<Json>(validationPreview.selectedContactScope?.resolvedTargets);
      const completedScopeReceipts = asArray<Json>(validationPreview.selectedContactScope?.completedContactReceipts);
      const completedScopeIds = completedScopeReceipts.map((item) => Number(item.contactId)).sort((a, b) => a - b);
      if (validationPreview.scopeCapabilities?.selectedContactIds !== true ||
          validationPreview.scopeCapabilities?.exactTargetOnlyTransport !== true ||
          validationPreview.scopeCapabilities?.frozenScopeCannotBeBroadened !== true) {
        throw new Error("PUBLISHED_VALIDATION_SERVICE_LACKS_SELECTED_CONTACT_SCOPE_CAPABILITY; no provider request made.");
      }
      if (validationPreview.gateOpen !== true) {
        throw new Error(`SFP_VALIDATION_GATE_BLOCKED:${safeErrorText(validationPreview.gateBlockedReason)}`);
      }
      const linkedBusinessByContact = new Map(linksSucceeded.map((item) => [Number(item.contactId), Number(item.businessId)]));
      const selectedContactCandidates = selected.map((candidate) => {
        const candidateId = String(candidate.candidateId ?? "");
        const contactId = candidateId.startsWith("contact:") ? Number(candidateId.slice("contact:".length)) : NaN;
        return { contactId, businessId: Number(candidate.businessId) };
      }).filter((candidate) =>
        Number.isSafeInteger(candidate.contactId) && Number.isSafeInteger(candidate.businessId) &&
        linkedBusinessByContact.get(candidate.contactId) === candidate.businessId);
      const selectedTargetIds = selectedContactCandidates.map((candidate) => candidate.contactId).sort((a, b) => a - b);
      const selectedIdsUnique = new Set(selectedTargetIds).size === selectedTargetIds.length;
      const completedTargetsMatch = completedScopeReceipts.length === completedScopeIds.length &&
        completedScopeReceipts.every((receipt) => {
          const target = previewScopeTargets.find((item) => Number(item.contactId) === Number(receipt.contactId));
          return !!target &&
            Number(receipt.businessId) === Number(target.businessId) &&
            String(receipt.linkDecisionId) === String(target.linkDecisionId) &&
            Number(receipt.linkRevision) === Number(target.linkRevision);
        });
      const allScopedTargets = previewScopeTargets.map((target) => ({
        contactId: Number(target.contactId),
        businessId: Number(target.businessId),
      }));
      const resolvedTargetsMatchLinks = allScopedTargets.length === validationContactIds.length &&
        previewScopeTargets.every((target) =>
          linkedBusinessByContact.get(Number(target.contactId)) === Number(target.businessId) &&
          typeof target.linkDecisionId === "string" &&
          Number.isSafeInteger(Number(target.linkRevision)) &&
          Number(target.linkRevision) > 0);
      const coveredIds = [...selectedTargetIds, ...completedScopeIds].sort((a, b) => a - b);
      const onlyAuthorizedTargetsSelected = validationPreview.selectedContactScope?.scopeCoverageComplete === true &&
        resolvedTargetsMatchLinks &&
        completedTargetsMatch &&
        selectedContactCandidates.length === selected.length &&
        selectedIdsUnique &&
        coveredIds.length === validationContactIds.length &&
        coveredIds.every((contactId, index) => contactId === validationContactIds[index]) &&
        previewScopeIds.length === validationContactIds.length &&
        previewScopeIds.every((contactId, index) => contactId === validationContactIds[index]) &&
        /^[a-f0-9]{64}$/i.test(String(validationPreview.snapshotHash ?? ""));
      targetContactCandidates = onlyAuthorizedTargetsSelected ? allScopedTargets : [];
      receipt.validationSelectionCoverage = {
        currentFrozenRunId: runId,
        selectedContactIds: validationContactIds,
        selectedCandidateCount: selected.length,
        selectedActionableContactCount: selectedContactCandidates.length,
        completedReceiptContactCount: completedScopeIds.length,
        selectedNonTargetCount: selected.length - selectedContactCandidates.length,
        onlyAuthorizedStrictContactsSelected: onlyAuthorizedTargetsSelected,
      };
      if (!onlyAuthorizedTargetsSelected) {
        blockers.push("current_frozen_run_validation_winner_set_includes_non_target_or_non_contact_candidates; no provider request made");
      } else {
        const idem = stableKey("zerobounce", {
          runId,
          snapshotHash: validationPreview.snapshotHash,
          maxValidations: MAX_TOTAL,
        });
        validationResult = await api.mutate<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(runId)}/validate`, {
          idempotencyKey: idem,
          snapshotHash: String(validationPreview.snapshotHash),
          // Use the normal 25-record service maximum. The fresh preview must
          // contain exactly the strict linked-contact targets above; no broader
          // source selection or altered application budget is permitted.
          maxValidations: MAX_TOTAL,
          selectedContactIds: validationContactIds,
        });
        completed.push({
          stage: "zerobounce",
          runId,
          snapshotHash: String(validationPreview.snapshotHash),
          selectedContactIds: validationContactIds,
          selectedContactScope: validationResult.selectedContactScope ?? null,
          addressesValidated: Number(validationResult.addressesValidated ?? 0),
          providerRequests: Number(validationResult.providerRequests ?? 0),
          validCount: Number(validationResult.validCount ?? 0),
          invalidCount: Number(validationResult.invalidCount ?? 0),
          catchAllCount: Number(validationResult.catchAllCount ?? 0),
          failedCount: Number(validationResult.failedCount ?? 0),
          eligibilityRowsCreated: Number(validationResult.eligibilityRowsCreated ?? 0),
          idempotencyKey: validationResult.idempotencyKey ?? idem,
        });
        receipt.completedStages = completed;
        receipt.stageCounts.zeroBounceRequests = Number(validationResult.providerRequests ?? 0);
        receipt.stageCounts.zeroBounceValid = Number(validationResult.validCount ?? 0);
        await persistReceipt(receipt);
      }
    }
  }

  if (validationResult && Number(validationResult.validCount ?? 0) > 0) {
    const [eligibleProspects, reviewRequiredProspects] = await Promise.all([
      api.get<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(runId)}/prospects?outreachEligible=true&limit=100&offset=0`),
      api.get<Json>(`/api/lead-ops/sfp/runs/${encodeURIComponent(runId)}/prospects?reviewRequired=true&limit=100&offset=0`),
    ]);
    const selectedContactByBusiness = new Map(targetContactCandidates.map((item) => [item.businessId, item.contactId]));
    const candidateEligibilityIds = [...new Set([
      ...asArray<Json>(eligibleProspects.prospects),
      ...asArray<Json>(reviewRequiredProspects.prospects),
    ]
      .filter((prospect) => prospect.sourceKind === "contact" &&
        ["validated_outreach_eligible", "validated_review_required"].includes(String(prospect.validationStatus)) &&
        prospect.zbOutcome === "valid" &&
        selectedContactByBusiness.has(Number(prospect.businessId)) &&
        typeof prospect.eligibilityId === "string")
      .map((prospect) => String(prospect.eligibilityId)))];
    if (candidateEligibilityIds.length > 0) {
      const stagePreview = await api.mutate<Json>("/api/lead-ops/sfp/campaign-staging-v2/preview", {
        cohortRunId: runId,
        eligibilityIds: candidateEligibilityIds.slice(0, MAX_TOTAL),
      });
      const exactEligibleIds = asArray<Json>(stagePreview.rows)
        .filter((row) => row.disposition === "eligible" && row.sourceKind === "contact" &&
          selectedContactByBusiness.get(Number(row.businessId)) === Number(row.sourceReferenceId))
        .map((row) => String(row.eligibilityId));
      const blockedByReview = asArray<Json>(stagePreview.rows).filter((row) =>
        row.disposition !== "eligible" || row.sourceKind !== "contact" ||
        selectedContactByBusiness.get(Number(row.businessId)) !== Number(row.sourceReferenceId));
      if (blockedByReview.length > 0) {
        blockers.push(`staging_preview_blocked_or_not_exact_contact:${blockedByReview.length}`);
      }
      const pendingNamedReviews = blockedByReview
        .filter((row) => row.blockedReason === "named_email_requires_eligibility_review" &&
          typeof row.eligibilityId === "string")
        .map((row) => String(row.eligibilityId));
      if (pendingNamedReviews.length > 0) {
        blockers.push(`independent_named_email_eligibility_review_required:${pendingNamedReviews.join(",")}; operator did not approve`);
      }
      if (exactEligibleIds.length > 0) {
        // Re-preview the exact eligible subset; execute only the IDs and
        // payload/snapshot pins from this fresh, bounded, no-write response.
        const exactPreview = await api.mutate<Json>("/api/lead-ops/sfp/campaign-staging-v2/preview", {
          cohortRunId: runId,
          eligibilityIds: exactEligibleIds,
        });
        const previewRows = asArray<Json>(exactPreview.rows);
        if (previewRows.length !== exactEligibleIds.length ||
            previewRows.some((row) => row.disposition !== "eligible" || row.sourceKind !== "contact" ||
              selectedContactByBusiness.get(Number(row.businessId)) !== Number(row.sourceReferenceId))) {
          blockers.push("exact_staging_preview_drifted_or_contains_non_target_rows");
        } else {
          const pendingCommand = {
            cohortRunId: runId,
            eligibilityIds: exactEligibleIds,
            snapshotHash: String(exactPreview.snapshotHash),
            commandKey: String(exactPreview.commandKey),
            confirmPayloadHash: String(exactPreview.payloadHash),
          };
          if (!/^[a-f0-9]{64}$/i.test(pendingCommand.snapshotHash) ||
              !pendingCommand.commandKey || !/^[a-f0-9]{64}$/i.test(pendingCommand.confirmPayloadHash)) {
            throw new Error("STAGING_PREVIEW_MISSING_CONFIRMATION_PINS");
          }
          receipt.pendingStagingCommand = {
            ...pendingCommand,
            strictContactIds: targetContactCandidates.map((candidate) => candidate.contactId),
          };
          await persistReceipt(receipt);
          const stagingResult = await api.mutate<Json>("/api/lead-ops/sfp/campaign-staging-v2/execute", {
            cohortRunId: pendingCommand.cohortRunId,
            eligibilityIds: pendingCommand.eligibilityIds,
            commandKey: pendingCommand.commandKey,
            snapshotHash: pendingCommand.snapshotHash,
            confirmPayloadHash: pendingCommand.confirmPayloadHash,
          });
          const stagedIntents = stagingIntentReceipts(stagingResult, exactEligibleIds);
          completed.push({
            stage: "staging_v2",
            runId,
            commandKey: pendingCommand.commandKey,
            sourceContactIds: targetContactCandidates.map((candidate) => candidate.contactId),
            readyHeld: Number(stagingResult.readyHeld ?? 0),
            rejected: Number(stagingResult.rejected ?? 0),
            stagedIntents,
          });
          receipt.completedStages = completed;
          receipt.stageCounts.masterLeadsProjected = Number(stagingResult.readyHeld ?? 0);
          receipt.stageCounts.readyHeldIntents = Number(stagingResult.readyHeld ?? 0);
          receipt.pendingStagingCommand = null;
          await persistReceipt(receipt);
          await bridgeReadyHeldIntents(api, receipt, completed, stagedIntents, blockers);
        }
      } else {
        blockers.push("no_strict_linked_contact_eligibility_is_ready_for_staging");
      }
    } else {
      blockers.push("no_validated_strict_contact_eligibility_found_for_staging");
    }
  } else if (validationResult && Number(validationResult.validCount ?? 0) === 0) {
    blockers.push("zero_valid_zero_bounce_results");
  } else if (linksSucceeded.length > 0 && !validationResult) {
    blockers.push("no_linked_contact_selected_by_validation_preview_in_current_frozen_cohort");
  }

  receipt.completedStages = completed;
  receipt.remainingBlockers = blockers;
  receipt.updatedAt = new Date().toISOString();
  await persistReceipt(receipt);
  console.log(JSON.stringify({
    globalPause: receipt.globalPause,
    publishedRelease: receipt.publishedRelease,
    frozenV2RunId: runId,
    strictContactIds: strictContactIds.length,
    linkCandidateCount: candidates.length,
    systemLinkOutcomes: linkOutcomes,
    validation: validationResult ? {
      addressesValidated: validationResult.addressesValidated,
      providerRequests: validationResult.providerRequests,
      validCount: validationResult.validCount,
      invalidCount: validationResult.invalidCount,
      catchAllCount: validationResult.catchAllCount,
      failedCount: validationResult.failedCount,
      eligibilityRowsCreated: validationResult.eligibilityRowsCreated,
      selectedStrictContactCandidates: targetContactCandidates.length,
    } : {
      status: validationPreview ? "no_target_only_validation_selection" : "not_reached",
      previewedAddresses: validationPreview?.addressesForValidation ?? fresh.validationPreview.addressesForValidation,
      selectedContactCandidates: targetContactCandidates.length,
    },
    finalStageCounts: receipt.stageCounts,
    remainingBlockers: receipt.remainingBlockers,
    receiptPath: path.relative(ROOT, CHECKPOINT_PATH),
  }, null, 2));
}

main().catch((error) => {
  console.error(safeErrorText(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});