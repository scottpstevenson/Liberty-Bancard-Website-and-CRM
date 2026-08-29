#!/usr/bin/env npx tsx
/**
 * CRO-02 structural certification.
 *
 * This deliberately inspects the TypeScript syntax tree. Comments, strings
 * which merely look like code, and branches proven unreachable by a literal
 * `false` are not evidence and cannot cause a pass or a violation.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

type RouteManifest = { file: string; method: string; route: string; roles?: string[] };
const ROOT = process.cwd();
const TYPESCRIPT_ROOTS = ["server/routes", "server/services", "server/storage"];
const CLASS_VALUES = ["production", "test", "demo", "synthetic", "unknown"];
const AXIS_VALUES = {
  COMMERCIAL_PROVENANCE_VALUES: ["verified", "untraceable", "legacy_unknown", "conflicted", "invalid"],
  COMMERCIAL_IDENTITY_VALUES: ["resolved", "unresolved", "collision", "conflicted", "legacy_unknown"],
  COMMERCIAL_ORGANIZATION_LINK_VALUES: ["verified", "missing", "conflicted", "legacy_unknown", "rejected"],
  COMMERCIAL_RELATIONSHIP_VALUES: ["decision_maker", "not_decision_maker", "unknown", "conflicted"],
  COMMERCIAL_EVIDENCE_KINDS: ["classification_event", "contact_source_event", "import_row_disposition", "identity_observation", "merge_operation", "merge_redirect", "business_link_decision", "legacy_company_mapping_decision", "relationship_review"],
} as const;
const ROUTES: RouteManifest[] = [
  { file: "server/routes/contacts.ts", method: "patch", route: "/api/contacts/:id/decision-maker" },
  { file: "server/routes/commercial-shadow.ts", method: "get", route: "/api/commercial/coverage", roles: ["admin", "manager"] },
  { file: "server/routes/commercial-shadow.ts", method: "get", route: "/api/commercial/discrepancies", roles: ["admin", "manager"] },
];
const SOLE_WRITERS = {
  businessIdentity: new Set(["server/services/organization-resolver.ts", "server/services/organization-service.ts"]),
  businessProjection: new Set(["server/services/commercial-link-authority.ts"]),
  relationshipProjection: new Set(["server/services/commercial-relationship-authority.ts"]),
  classProjection: new Set(["server/services/commercial-classification-authority.ts"]),
};
const CONSUMERS = new Map<string, { boundary: string; authority?: string; compatibility?: string }>([
  ["server/services/revenue-read-authority.ts", { boundary: "revenue read and CRO-01 pipeline", authority: "authorizeCommercialUseBatch" }],
  ["server/routes/analytics.ts", { boundary: "analytics routes", authority: "observeCommercialReportingPopulation" }],
  ["server/services/executive-kpi.ts", { boundary: "executive KPI", authority: "observeCommercialReportingPopulation" }],
  ["server/services/digest-service.ts", { boundary: "daily and weekly digest", authority: "observeCommercialReportingPopulation" }],
  ["server/services/sdr/funnel-metrics.ts", { boundary: "SDR funnel", authority: "observeCommercialReportingPopulation" }],
  ["server/routes/portfolio.ts", { boundary: "portfolio and merchant views", authority: "observeCommercialReportingPopulation" }],
  ["server/routes/merchants.ts", { boundary: "merchant detail and MID views", authority: "observeCommercialReportingPopulation" }],
  ["server/routes/residuals.ts", { boundary: "residual and payout views", authority: "observeCommercialReportingPopulation" }],
  ["server/routes/statement-review.ts", { boundary: "statement review", authority: "observeCommercialReportingPopulation" }],
  ["server/routes/boarding.ts", { boundary: "application and MID boarding", authority: "observeCommercialReportingPopulation" }],
  ["server/services/provider-readiness-control.ts", { boundary: "provider readiness and pre-spend", authority: "authorizeCommercialUse" }],
  ["server/services/contactability.ts", { boundary: "contactability", authority: "authorizeCommercialUse" }],
  ["server/services/smtp-email.ts", { boundary: "SMTP final transport", authority: "authorizeCommercialUse" }],
  ["server/services/ghl.ts", { boundary: "GHL final transports", authority: "authorizeCommercialUse" }],
  ["server/services/campaign-engine.ts", { boundary: "campaign preview and frozen membership", authority: "authorizeCommercialUse" }],
  ["server/services/sequence-worker.ts", { boundary: "sequence inputs", authority: "authorizeCommercialUseBatch" }],
]);

let checks = 0;
function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`CRO02_AUTHORITY_FAILURE: ${message}`);
  checks++;
}
function read(file: string) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function source(file: string, text = read(file)) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function filesUnder(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const next = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(next) : entry.isFile() && /\.tsx?$/.test(entry.name) ? [next] : [];
  });
}
function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}
function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
}
function isDead(node: ts.Node): boolean {
  for (let cursor: ts.Node | undefined = node; cursor; cursor = cursor.parent) {
    if (ts.isIfStatement(cursor) && cursor.thenStatement.pos <= node.pos && node.end <= cursor.thenStatement.end &&
        (cursor.expression.kind === ts.SyntaxKind.FalseKeyword ||
          (ts.isNumericLiteral(cursor.expression) && Number(cursor.expression.text) === 0))) return true;
  }
  return false;
}
function walk(sf: ts.SourceFile, visit: (node: ts.Node) => void) {
  const go = (node: ts.Node) => {
    if (isDead(node)) return;
    visit(node);
    ts.forEachChild(node, go);
  };
  go(sf);
}
function routeCalls(sf: ts.SourceFile) {
  const found: Array<{ method: string; route: string; call: ts.CallExpression }> = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    const route = literal(node.arguments[0]);
    if (["get", "post", "put", "patch", "delete"].includes(method) && route) found.push({ method, route, call: node });
  });
  return found;
}
function arrayConstant(sf: ts.SourceFile, name: string): string[] | undefined {
  let result: string[] | undefined;
  walk(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name || !node.initializer) return;
    let init: ts.Expression = node.initializer;
    if (ts.isAsExpression(init)) init = init.expression;
    if (ts.isArrayLiteralExpression(init)) result = init.elements.map(literal).filter((v): v is string => v !== undefined);
  });
  return result;
}
function importsAuthority(sf: ts.SourceFile, symbol: string, moduleSuffix: string): boolean {
  let imported = false;
  walk(sf, (node) => {
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)?.endsWith(moduleSuffix) &&
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some((e) => e.name.text === symbol)) imported = true;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        literal(node.arguments[0])?.endsWith(moduleSuffix)) imported = true;
  });
  return imported;
}

const schema = source("shared/schema.ts");
ok(JSON.stringify(arrayConstant(schema, "COMMERCIAL_CLASS_VALUES")) === JSON.stringify(CLASS_VALUES), "commercial class enum changed");
for (const [name, values] of Object.entries(AXIS_VALUES)) {
  ok(JSON.stringify(arrayConstant(schema, name)) === JSON.stringify(values), `${name} changed or became non-literal`);
}

for (const expected of ROUTES) {
  const sf = source(expected.file);
  const matching = routeCalls(sf).filter((r) => r.method === expected.method && r.route === expected.route);
  ok(matching.length === 1, `${expected.method.toUpperCase()} ${expected.route} must be registered exactly once`);
  if (expected.roles) {
    const roleCalls = matching[0].call.arguments.filter(ts.isCallExpression).filter((arg) =>
      ts.isIdentifier(arg.expression) && arg.expression.text === "requireRole");
    ok(roleCalls.length === 1, `${expected.route} must have one requireRole guard`);
    ok(JSON.stringify(roleCalls[0].arguments.map(literal)) === JSON.stringify(expected.roles), `${expected.route} role scope drifted`);
  }
}
const routeIndex = source("server/routes.ts");
let registrationCount = 0;
walk(routeIndex, (node) => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "registerCommercialShadowRoutes") registrationCount++;
});
ok(registrationCount === 1, "commercial shadow routes must be registered exactly once");

const violations: string[] = [];
for (const file of TYPESCRIPT_ROOTS.flatMap(filesUnder)) {
  const sf = source(file);
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "set") return;
    const object = node.arguments[0];
    if (!object || !ts.isObjectLiteralExpression(object)) return;
    const fields = new Set(object.properties.map(propertyName).filter(Boolean));
    const receiver = node.expression.expression.getText(sf);
    const updatesContacts = /\bupdate\s*\(\s*contacts\s*\)/.test(receiver);
    if (updatesContacts && fields.has("businessId") && !SOLE_WRITERS.businessProjection.has(file)) violations.push(`${file}: contacts.businessId`);
    if (updatesContacts && (fields.has("isDecisionMaker") || fields.has("decisionMakerConfidence")) &&
        !SOLE_WRITERS.relationshipProjection.has(file)) violations.push(`${file}: decision-maker projection`);
    if (fields.has("recordClass") && !SOLE_WRITERS.classProjection.has(file)) violations.push(`${file}: commercial class projection`);
  });
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
        !["insert", "update"].includes(node.expression.name.text) ||
        !node.arguments.some((arg) => ts.isIdentifier(arg) && arg.text === "businesses")) return;
    if (!SOLE_WRITERS.businessIdentity.has(file)) violations.push(`${file}: raw canonical business writer`);
  });
  walk(sf, (node) => {
    if (!ts.isTaggedTemplateExpression(node)) return;
    const sqlText = node.template.getText(sf).toLowerCase().replace(/\s+/g, " ");
    if (/update contacts set[^;]*business_id\s*=/.test(sqlText) && !SOLE_WRITERS.businessProjection.has(file))
      violations.push(`${file}: raw SQL contacts.business_id writer`);
    if (/update contacts set[^;]*(is_decision_maker|decision_maker_confidence)\s*=/.test(sqlText) &&
        !SOLE_WRITERS.relationshipProjection.has(file)) violations.push(`${file}: raw SQL decision-maker writer`);
    if (/update (contacts|deals|prospects|companies|businesses) set[^;]*record_class\s*=/.test(sqlText) &&
        !SOLE_WRITERS.classProjection.has(file)) violations.push(`${file}: raw SQL class writer`);
  });
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    if (node.expression.text === "reviewDecisionMaker" && file !== "server/services/commercial-relationship-authority.ts" &&
        !importsAuthority(sf, "reviewDecisionMaker", "commercial-relationship-authority")) violations.push(`${file}: unowned relationship call`);
    if (node.expression.text === "decideContactBusinessLink" && file !== "server/services/commercial-link-authority.ts" &&
        !importsAuthority(sf, "decideContactBusinessLink", "commercial-link-authority")) violations.push(`${file}: unowned link call`);
  });
}
ok(violations.length === 0, `raw authority writers found:\n${violations.join("\n")}`);

for (const file of [
  "server/routes/imports.ts",
  "server/scripts/import-leads.ts",
  "server/services/sdr/dedupe.ts",
  "server/services/sdr/orchestrator.ts",
]) {
  const text = read(file);
  ok(text.includes("recordContactBusinessLinkCandidate"),
    `${file} must persist automatic matches as non-authoritative candidates`);
  ok(!text.includes("decideContactBusinessLink"),
    `${file} must not persist reviewed contact/business truth`);
}
const reviewedLinkMigration = read("migrations/0172_cro02_reviewed_contact_business_links.sql");
for (const marker of [
  "contact_business_link_candidates", "current_contact_business_link_candidates",
  "candidate_key", "supersedes_candidate_id", "evidence_source_event_id",
  "REFERENCES contact_source_events(id) ON DELETE RESTRICT", "reviewed_by", "reviewed_at",
  "COMMERCIAL_LINK_EVIDENCE_SUBJECT_MISMATCH",
  "COMMERCIAL_LINK_REVIEWER_MUST_BE_INDEPENDENT",
]) ok(reviewedLinkMigration.includes(marker), `reviewed link migration marker missing: ${marker}`);
ok(!/\bUPDATE\s+contacts\b/i.test(reviewedLinkMigration),
  "0172 must not rewrite the compatibility business projection");
ok(!/\bUPDATE\s+contact_business_link_decisions\s+SET\b/i.test(reviewedLinkMigration),
  "0172 must not retire or mutate historical link decisions");
const linkAuthoritySource = read("server/services/commercial-link-authority.ts");
ok(linkAuthoritySource.includes("INSERT INTO contact_business_link_candidates"),
  "candidate writer must use its dedicated link-candidate table");
ok(!linkAuthoritySource.includes("INSERT INTO commercial_relationship_candidates"),
  "contact/business candidates must not contaminate the relationship axis");

for (const [file, manifest] of CONSUMERS) {
  const sf = source(file);
  if (manifest.compatibility) {
    ok(manifest.compatibility.length >= 24, `${manifest.boundary} compatibility exception lacks an explicit rationale`);
    continue;
  }
  const authority = manifest.authority!;
  ok(importsAuthority(sf, authority, "commercial-resolution"), `${manifest.boundary} does not import the sole dual-read authority`);
  let calls = 0;
  walk(sf, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === authority) calls++;
  });
  ok(calls > 0, `${manifest.boundary} imports but never calls ${authority}`);
}

const resolution = source("server/services/commercial-resolution.ts");
const resolutionText = read("server/services/commercial-resolution.ts");
let effectiveIsLegacy = false;
let policyClassPredicate = false;
walk(resolution, (node) => {
  if (ts.isPropertyAssignment(node) && propertyName(node) === "effectiveDecision" &&
      ts.isIdentifier(node.initializer) && node.initializer.text === "legacyDecision") effectiveIsLegacy = true;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "includes" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "allowedClasses") policyClassPredicate = true;
});
ok(effectiveIsLegacy, "effective decision is not structurally the legacy decision");
ok(policyClassPredicate, "resolver no longer evaluates class through the persisted purpose policy");
const graphLocks = read("server/services/commercial-graph-locks.ts");
ok(graphLocks.includes("cro02:v1:node:") &&
  graphLocks.includes("cro02:v1:membership-set:") &&
  graphLocks.includes("hashtextextended(${key}, 1700)"),
  "graph resolver and writers do not share the versioned advisory namespace");
ok(resolutionText.includes("lockCommercialGraph(tx"),
  "resolver bypasses the shared graph lock authority");
ok(resolutionText.includes("CRO02_GRAPH_DISCOVERY_DRIFT") &&
  resolutionText.includes("discoverContactRedirect(discovery.startId)") &&
  resolutionText.includes("discoverCommittedContactRedirect(discovery.startId)") &&
  resolutionText.includes("input.persist && root && !graphDiscoveryDrift"),
  "resolver can persist redirect/root discovery made before the graph fence");
ok(linkAuthoritySource.includes("lockCommercialGraphNodes") &&
  linkAuthoritySource.includes("lockCommercialGraphMembershipSets"),
  "reviewed link/mapping writers bypass the shared graph lock order");
ok((linkAuthoritySource.match(/lockCommercialGraphMembershipSets\(tx/g) ?? []).length >= 3,
  "candidate, reviewed-link, or legacy-mapping writer bypasses membership fencing");
const classificationAuthoritySource = read("server/services/commercial-classification-authority.ts");
ok(classificationAuthoritySource.includes("lockCommercialGraphNodes(tx"),
  "classification writer locks roots/revisions before the shared graph node fence");
ok(classificationAuthoritySource.includes("graphNodes.push({ type: \"contact\"") &&
  classificationAuthoritySource.includes("graphNodes.push({ type: \"company\"") &&
  classificationAuthoritySource.includes("CLASSIFICATION_GRAPH_STALE"),
  "production deal classification does not fence and revalidate linked commercial roots");
const identityAuthoritySource = read("server/services/contact-identity.ts");
ok(identityAuthoritySource.includes("lockCommercialGraph(executor") &&
  identityAuthoritySource.includes("lockCommercialGraphNodes(executor, nodes)") &&
  identityAuthoritySource.includes("lockCommercialGraphMembershipSets(executor, nodes, [\"identity\"])") &&
  identityAuthoritySource.includes("recordContactIdentityObservationsForPgContacts"),
  "identity observation adapters bypass the shared graph lock order");
ok(identityAuthoritySource.includes("CONTACT_REDIRECT_IDENTITY_STATUSES") &&
  identityAuthoritySource.includes('"committed"') &&
  identityAuthoritySource.includes('"reconciliation_pending"') &&
  identityAuthoritySource.includes('"completed"') &&
  identityAuthoritySource.includes("isContactMergeEffectHoldState"),
  "live redirect authority does not separate canonical identity from temporary effect holds");
ok(resolutionText.includes("isIdentityAuthoritativeRedirectState") &&
  resolutionText.includes("isContactMergeEffectHoldState") &&
  resolutionText.includes("CONTACT_MERGE_CONSENT_HANDOFF_PENDING"),
  "commercial redirect readers drifted from the shared redirect-state contract");
const sequenceWorkerSource = read("server/services/sequence-worker.ts");
const promotionalWorkerSource = read("server/services/queue-manager.ts");
const promotionalEligibilitySource = read("server/services/promotional-enrollment-eligibility.ts");
const abandonedStatementSource = read("server/services/abandoned-statement-worker.ts");
ok(sequenceWorkerSource.includes("sequence_step_merge_handoff_deferred") &&
  sequenceWorkerSource.includes("redirect.effectHold"),
  "sequence work does not retryably defer the temporary merge hold");
ok(sequenceWorkerSource.indexOf("if (redirect.effectHold)") <
  sequenceWorkerSource.indexOf("if (resolvedContactId !== enrollment.contactId)"),
  "sequence work rewrites redirect provenance before enforcing the temporary hold");
ok(promotionalWorkerSource.includes("redirect.effectHold") &&
  promotionalWorkerSource.includes("CONTACT_MERGE_EFFECT_HOLD_REASON"),
  "promotional enrollment work does not defer the temporary merge hold");
ok(promotionalWorkerSource.includes("recoverDeferredPromotionalEnrollments") &&
  promotionalEligibilitySource.includes("RESUBMISSION_RECOVERY_MARKER") &&
  promotionalEligibilitySource.includes("FOR UPDATE SKIP LOCKED"),
  "promotional merge-hold recovery is not durable or does not preserve resubmission intent");
ok(abandonedStatementSource.includes("redirect.effectHold") &&
  abandonedStatementSource.includes("Leave the request untouched"),
  "periodic abandoned-statement work does not retry the temporary merge hold");
const mergeAuthoritySource = read("server/services/contact-merge.ts");
ok((mergeAuthoritySource.match(/lockCommercialGraph\(tx/g) ?? []).length >= 2 &&
  mergeAuthoritySource.includes("[\"contact_redirect\"]"),
  "merge execution/undo bypass the shared redirect graph lock order");
const lockOrderMigration = read("migrations/0173_cro02_graph_lock_order.sql");
ok(!lockOrderMigration.includes("pg_advisory_xact_lock") &&
  lockOrderMigration.includes("CREATE OR REPLACE FUNCTION cro02_bump_graph_membership"),
  "graph revision trigger still discovers advisory locks after domain-row locking");

const contactability = source("server/services/contactability.ts");
const contactabilityText = read("server/services/contactability.ts");
let contactabilityBindingType = false;
let inboundAuthorizationBound = false;
let accountTransactionalPresent = false;
walk(contactability, (node) => {
  if (ts.isInterfaceDeclaration(node) && node.name.text === "ContactabilityInput") {
    const names = new Set(node.members.map(member => member.name && propertyName(member as ts.PropertySignature)));
    contactabilityBindingType = names.has("inboundRequestId") && names.has("intendedRecipientContactId");
  }
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) ||
      node.expression.text !== "authorizeCommercialUse" || !ts.isObjectLiteralExpression(node.arguments[0])) return;
  const properties = new Set(node.arguments[0].properties.map(propertyName));
  inboundAuthorizationBound ||= properties.has("inboundRequestId") && properties.has("intendedRecipientId");
  accountTransactionalPresent ||= node.arguments[0].getText().includes('"account_transactional"');
});
ok(contactabilityBindingType, "contactability input lacks the typed inbound request/recipient binding");
ok(inboundAuthorizationBound, "contactability does not pass both inbound binding fields to commercial authority");
ok(accountTransactionalPresent, "unbound transactional contactability is not mapped to account_transactional");
ok(contactabilityText.includes("isContactMergeEffectHoldState") &&
  !contactabilityText.includes("status IN ('executing', 'committed')"),
  "contactability merge fence drifted from the shared temporary-hold contract");
ok(!/status IN \('committed','reconciliation_pending'\)[\s\S]{0,80}LIMIT 1/.test(contactabilityText),
  "contactability samples one merge operation and can miss another active hold");

const migration = read("migrations/0166_cro02_shadow_graph.sql");
for (const constraint of [
  "num_nonnulls(", "ON DELETE RESTRICT", "CHECK(mode='shadow')",
  "commercial_resolution_snapshots", "commercial_resolution_dependencies",
  "commercial_subject_revisions", "commercial_membership_revisions",
  "contact_business_link_decisions", "legacy_company_mapping_decisions",
  "commercial_relationship_candidates", "commercial_relationship_reviews",
  "payload_hash", "preview_dependency_fingerprint", "executor_id", "execution_fence",
]) ok(migration.includes(constraint), `migration constraint/object missing: ${constraint}`);
const aggregateMigration = read("migrations/0167_cro02_shadow_aggregates.sql");
ok(aggregateMigration.includes("commercial_resolution_snapshot_id") && aggregateMigration.includes("campaign_preview_members"), "campaign snapshot layering is absent");
const reporting = read("server/services/commercial-shadow-reporting.ts");
ok(/DISTINCT ON \(s\.requested_subject_type, s\.requested_subject_id\)/.test(reporting) &&
  /SELECT COUNT\(\*\)::int FROM universe/.test(reporting) &&
  !/\bSELECT\s+[^;]*(?:c\.)?(?:email|phone|first_name|last_name)\b/i.test(reporting) &&
  !/\b(samples?|subjectIds?|contactIds?)\s*:/.test(reporting),
  "aggregate report cardinality/privacy boundary drifted");
ok(!/resolveCommercialGraph\(\{ \.\.\.input, subjectType, persist: true \}\)/.test(resolutionText) &&
  !resolutionText.includes("persistAggregateObservation"),
  "passive dual-read observation must not persist snapshots or aggregate writes");

// Scanner self-test: comments/string literals do not create routes or writes,
// and a literal-dead branch cannot either. A live route remains observable.
const self = source("self-test.ts", `
  // app.patch("/api/contacts/:id/decision-maker", handler)
  const decoy = "app.patch('/api/contacts/:id/decision-maker', handler)";
  if (false) app.patch("/api/contacts/:id/decision-maker", handler);
  app.get("/live", handler);
`);
ok(routeCalls(self).length === 1 && routeCalls(self)[0].route === "/live", "AST scanner comments/dead-code self-test failed");

console.log(`CRO-02 authority guard passed (${checks} structural checks)`);