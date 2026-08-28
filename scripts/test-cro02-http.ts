#!/usr/bin/env npx tsx
/**
 * CRO-02 HTTP contract proof. Starts an isolated loopback Express server,
 * mounts the real commercial-shadow route module and real CRM scope helpers,
 * and performs actual HTTP requests. External transports remain denied.
 */
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

process.env.NODE_ENV = "test";
process.env.GHL_TRANSPORT_FAILFAST = "true";
process.env.EMAIL_TRANSPORT_FAILFAST = "true";
process.env.SMS_TRANSPORT_FAILFAST = "true";

let passed = 0;
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
function containsSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /(^id$|subject.?id|contact.?id|business.?id|email|phone|name|token|raw.?evidence|evidence.?(payload|reference))/i.test(key) ||
    containsSensitiveKey(child));
}

async function main() {
  check(Boolean(process.env.TEST_DATABASE_URL), "TEST_DATABASE_URL is required; HTTP proof never skips");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  await assertDisposableTestInfrastructure({ operation: "cro02-http" });

  const [
    { pool },
    { registerCommercialShadowRoutes },
    access,
    resolution,
    linkAuthority,
  ] = await Promise.all([
    import("../server/db"),
    import("../server/routes/commercial-shadow"),
    import("../server/services/crm-object-access"),
    import("../server/services/commercial-resolution"),
    import("../server/services/commercial-link-authority"),
  ]);

  const nativeFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    throw new Error("CRO02_PROVIDER_NETWORK_DENIED");
  }) as typeof fetch;

  const nonce = crypto.randomUUID();
  const phoneSeed = parseInt(nonce.replace(/-/g, "").slice(0, 8), 16) % 9_000_000;
  const testPhone = (offset: number) => `555${String(1_000_000 + phoneSeed + offset).slice(-7)}`;
  const agentEmail = `cro02-agent-${nonce}@test.invalid`;
  await pool.query(
    `INSERT INTO users(id,email,role) VALUES
      ('cro02-evidence-submitter',$1,'manager'),
      ('cro02-reviewer',$2,'admin'),
      ('cro02-manager',$3,'manager'),
      ('cro02-admin',$4,'admin')
     ON CONFLICT(id) DO NOTHING`,
    [`cro02-submitter-${nonce}@test.invalid`, `cro02-reviewer-${nonce}@test.invalid`,
      `cro02-manager-${nonce}@test.invalid`, `cro02-admin-${nonce}@test.invalid`],
  );
  const contact = (await pool.query(
    `INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to)
     VALUES('CRO02','HTTP',$1,$2,'unknown',$3) RETURNING id`,
    [`cro02-http-${nonce}@test.invalid`, testPhone(0), agentEmail],
  )).rows[0];
  const business = (await pool.query(
    `INSERT INTO businesses(canonical_name,normalized_name,record_class)
     VALUES($1,$2,'production') RETURNING id`,
    [`CRO02 HTTP ${nonce}`, `cro02-http-${nonce}`],
  )).rows[0];
  const evidence = (await pool.query(
    `INSERT INTO contact_source_events
      (contact_id,event_key,source_category,source_type,actor_type,actor_id)
     VALUES($1,$2,'manual','reviewed_business_link','user','cro02-evidence-submitter')
     RETURNING id`,
    [contact.id, `cro02-link-evidence:${nonce}`],
  )).rows[0];
  await linkAuthority.decideContactBusinessLink({
    contactId: Number(contact.id), businessId: Number(business.id), decision: "verified",
    decisionKey: `http-link:${nonce}`, reviewerId: "cro02-reviewer",
    evidenceSourceEventId: Number(evidence.id),
  });
  const candidateContact = (await pool.query(
    `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
     VALUES('CRO02','Candidate',$1,$2,'production') RETURNING id`,
    [`cro02-candidate-${nonce}@test.invalid`, testPhone(1)],
  )).rows[0];
  await linkAuthority.recordContactBusinessLinkCandidate({
    contactId: Number(candidateContact.id), businessId: Number(business.id),
    source: "sdr_orchestration", sourceVersion: "http-proof",
    candidateKey: `http-candidate:${nonce}`, confidence: 90,
  });
  const candidateStorage = (await pool.query(
    `SELECT
       (SELECT count(*)::int FROM contact_business_link_candidates
         WHERE contact_id=$1 AND business_id=$2) AS dedicated_count,
       (SELECT count(*)::int FROM commercial_relationship_candidates
         WHERE contact_id=$1 AND business_id=$2) AS relationship_count,
       (SELECT business_id FROM contacts WHERE id=$1) AS projected_business_id`,
    [candidateContact.id, business.id],
  )).rows[0];
  check(candidateStorage.dedicated_count === 1 && candidateStorage.relationship_count === 0
      && candidateStorage.projected_business_id === null,
    "automatic link candidate stays in dedicated append-only axis without projection");
  for (const effect of ["marketing_outreach", "provider_pre_spend"] as const) {
    const candidateDecision = await resolution.resolveCommercialGraph({
      contactId: Number(candidateContact.id), effect,
    });
    check(!candidateDecision.allowed && candidateDecision.organizationLink !== "verified",
      `heuristic candidate cannot authorize ${effect}`);
  }
  const legacyProjectionContact = (await pool.query(
    `INSERT INTO contacts(first_name,last_name,email,phone,record_class,business_id)
     VALUES('CRO02','Legacy Projection',$1,$2,'production',$3) RETURNING id`,
    [`cro02-legacy-projection-${nonce}@test.invalid`, testPhone(2), business.id],
  )).rows[0];
  const legacyProjectionDecision = await resolution.resolveCommercialGraph({
    contactId: Number(legacyProjectionContact.id), effect: "provider_pre_spend",
  });
  const legacyProjectionAfter = (await pool.query(
    "SELECT business_id FROM contacts WHERE id=$1", [legacyProjectionContact.id],
  )).rows[0];
  check(!legacyProjectionDecision.allowed && legacyProjectionDecision.organizationLink !== "verified"
      && Number(legacyProjectionAfter.business_id) === Number(business.id),
    "legacy compatibility businessId is preserved but cannot authorize graph use");
  await pool.query(
    `INSERT INTO commercial_resolution_snapshots
     (requested_subject_type,requested_subject_id,effective_subject_type,effective_subject_id,purpose,
      policy_version,schema_version,mode,resolution,record_class,provenance_resolution,identity_resolution,
      organization_link_resolution,relationship_resolution,reason_codes,dependency_fingerprint)
     VALUES('contact',$1,'contact',$1,'marketing_outreach',1,1,'shadow','quarantined','unknown',
       'untraceable','unresolved','verified','unknown','["PROVENANCE_UNTRACEABLE"]'::jsonb,$2)`,
    [contact.id, crypto.createHash("sha256").update(nonce).digest("hex")],
  );
  const passiveBefore = (await pool.query(`SELECT
    (SELECT coverage_high_water FROM commercial_shadow_controls WHERE control_key='commercial')::bigint AS control_high_water,
    (SELECT COUNT(*) FROM commercial_resolution_snapshots)::bigint AS snapshots,
    (SELECT COUNT(*) FROM commercial_resolution_dependencies)::bigint AS dependencies,
    (SELECT COUNT(*) FROM commercial_shadow_aggregates)::bigint AS aggregates`)).rows[0];
  await Promise.all(Array.from({ length: 4 }, () => resolution.authorizeCommercialUse({
    subjectType: "contact", subjectId: Number(contact.id), effect: "marketing_outreach",
    observationScope: "owned_or_unassigned",
  })));
  const passiveAfter = (await pool.query(`SELECT
    (SELECT coverage_high_water FROM commercial_shadow_controls WHERE control_key='commercial')::bigint AS control_high_water,
    (SELECT COUNT(*) FROM commercial_resolution_snapshots)::bigint AS snapshots,
    (SELECT COUNT(*) FROM commercial_resolution_dependencies)::bigint AS dependencies,
    (SELECT COUNT(*) FROM commercial_shadow_aggregates)::bigint AS aggregates`)).rows[0];
  check(Object.keys(passiveBefore).every(key => Number(passiveBefore[key]) === Number(passiveAfter[key])),
    "repeated passive HTTP observations create no snapshot, dependency, aggregate, or control writes");

  const app = express();
  app.use(express.json());
  // Existing requireRole middleware is used unchanged. This pre-authentication
  // adapter is isolated to the loopback test server and represents established
  // authenticated dashboard sessions without constructing provider clients.
  app.use((req: any, _res, next) => {
    const role = req.get("x-test-role");
    req.user = role ? { id: `cro02-${role}`, role, email: role === "agent" ? agentEmail : `${role}@test.invalid` } : undefined;
    req.isAuthenticated = () => Boolean(role);
    next();
  });
  registerCommercialShadowRoutes(app);

  // Exercise shared production scope and authority services over HTTP rather
  // than reducing this suite to pure-function assertions.
  app.get("/_cro02/businesses/:id", async (req: any, res) => {
    const row = await access.authorizeBusinessAccess(req, res, Number(req.params.id));
    if (row) res.json({ accessible: true });
  });
  app.get("/_cro02/relationships/:businessId", async (req: any, res) => {
    const row = await access.authorizeBusinessAccess(req, res, Number(req.params.businessId));
    if (!row) return;
    const result = await pool.query(
      `SELECT decision FROM commercial_relationship_reviews
       WHERE business_id=$1 AND superseded_at IS NULL`,
      [req.params.businessId],
    );
    res.json({ relationships: result.rows });
  });
  app.post("/_cro02/links/:contactId", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ code: "UNAUTHORIZED" });
    try {
      await linkAuthority.decideContactBusinessLink({
        contactId: Number(req.params.contactId), businessId: Number(req.body.businessId),
        decision: "verified", decisionKey: String(req.get("Idempotency-Key") || ""),
        reviewerId: req.user.id, evidenceSourceEventId: Number(evidence.id),
        expectedRevision: Number(req.body.expectedRevision),
      });
      res.json({ ok: true });
    } catch (error: any) {
      if (error?.code === "COMMERCIAL_REVISION_CONFLICT") return res.status(409).json({ code: "COMMERCIAL_REVISION_CONFLICT" });
      throw error;
    }
  });
  app.post("/_cro02/resolve/:contactId", async (req: any, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ code: "UNAUTHORIZED" });
    if (!Number.isInteger(Number(req.params.contactId)) || !req.body?.effect) return res.status(400).json({ code: "INVALID_RESOLUTION_REQUEST" });
    const decision = await resolution.resolveCommercialGraph({ contactId: Number(req.params.contactId), effect: req.body.effect });
    res.status(decision.allowed ? 200 : 422).json({
      resolution: decision.resolution, reasonCodes: decision.reasonCodes,
      requestedSubjectMatchesEffective: true,
    });
  });
  app.post("/_cro02/inbound", (req: any, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ code: "UNAUTHORIZED" });
    const decision = resolution.decideCommercialEffect({
      effect: "inbound_transactional_acknowledgement", recordClass: "unknown",
      inboundRequestId: req.body?.inboundRequestId,
      intendedRecipientId: req.body?.intendedRecipientId,
      requestedSubjectType: "contact",
      requestedSubjectId: Number(req.body?.intendedRecipientId),
      effectiveSubjectType: "contact",
      effectiveSubjectId: Number(req.body?.intendedRecipientId),
    });
    res.status(decision.allowed ? 200 : 422).json({ resolution: decision.resolution });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const correlationId = crypto.randomUUID();
    console.error("[CRO02 isolated HTTP]", error);
    res.setHeader("X-Correlation-Id", correlationId).status(500).json({
      message: "Internal server error", code: "INTERNAL_ERROR", correlationId,
    });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("isolated HTTP server did not bind");
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await nativeFetch(`${base}${path}`, init);
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
  const as = (role: string, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { "content-type": "application/json", "x-test-role": role, ...(init.headers as Record<string, string> ?? {}) },
  });

  try {
    let result = await request("/api/commercial/coverage?purpose=marketing_outreach");
    check(result.response.status === 401, "anonymous coverage request returns 401");
    result = await request("/api/commercial/coverage?purpose=not-a-purpose", as("admin"));
    check(result.response.status === 400, "malformed purpose returns 400");

    for (const role of ["admin", "manager"]) {
      result = await request("/api/commercial/coverage?purpose=marketing_outreach", as(role));
      check(result.response.status === 200 && result.body.mode === "shadow" && result.body.scope === "all",
        `${role} receives authenticated aggregate coverage`);
      check(!containsSensitiveKey(result.body), `${role} aggregate contains no IDs, PII, tokens, or evidence`);
      check(result.body.frozenHighWater > 0 && result.body.denominator > 0 &&
        result.body.denominator >= result.body.evaluated && result.body.evaluated > 0 &&
        result.body.reconciliation.discrepancyTotal === result.body.evaluated &&
        result.body.denominator === result.body.evaluated + result.body.reconciliation.snapshotMissing,
        `${role} report reconciles distinct evaluated snapshots against all commercial roots`);
    }
    result = await request("/api/commercial/coverage?purpose=marketing_outreach", as("agent"));
    check(result.response.status === 403, "agent cannot expand privileged global coverage scope");

    result = await request(`/_cro02/businesses/${business.id}`, as("agent"));
    check(result.response.status === 200 && result.body.accessible === true, "agent can access a business through an assigned linked contact");
    result = await request("/_cro02/businesses/2147483647", as("agent"));
    const absentShape = result.body;
    check(result.response.status === 404 && absentShape.code === "CRM_OBJECT_NOT_FOUND", "absent business is non-enumerating 404");
    result = await request(`/_cro02/businesses/${business.id}`, as("merchant"));
    check(result.response.status === 404 && JSON.stringify(result.body) === JSON.stringify(absentShape),
      "unauthorized business has the same non-enumerating 404 shape");
    result = await request(`/_cro02/relationships/${business.id}`, as("agent"));
    check(result.response.status === 200 && !containsSensitiveKey(result.body), "relationship read validates endpoint scope and returns reviewed projection only");
    result = await request("/_cro02/relationships/2147483647", as("agent"));
    check(result.response.status === 404, "unscoped relationship graph is non-enumerating 404");

    result = await request(`/_cro02/links/${contact.id}`, as("admin", {
      method: "POST", headers: { "Idempotency-Key": `stale:${nonce}` },
      body: JSON.stringify({ businessId: business.id, expectedRevision: 0 }),
    }));
    check(result.response.status === 409 && result.body.code === "COMMERCIAL_REVISION_CONFLICT", "stale authority version returns privacy-safe 409");

    result = await request(`/_cro02/resolve/${contact.id}`, as("manager", {
      method: "POST", body: JSON.stringify({ effect: "marketing_outreach" }),
    }));
    check(result.response.status === 422 && result.body.resolution === "quarantined" &&
      Array.isArray(result.body.reasonCodes), "well-formed quarantined resolution returns 422");
    result = await request("/_cro02/resolve/not-an-id", as("manager", {
      method: "POST", body: JSON.stringify({ effect: "marketing_outreach" }),
    }));
    check(result.response.status === 400, "malformed resolution input returns 400");

    result = await request("/_cro02/inbound", as("manager", { method: "POST", body: "{}" }));
    check(result.response.status === 422, "unknown inbound acknowledgement without server binding is denied");
    result = await request("/_cro02/inbound", as("manager", {
      method: "POST", body: JSON.stringify({ inboundRequestId: `server:${nonce}`, intendedRecipientId: contact.id }),
    }));
    check(result.response.status === 200, "unknown inbound acknowledgement requires current intended-recipient binding");

    // Closing this process-local pool deterministically induces the real route's
    // safe error path. It is the final DB operation in the disposable process.
    await pool.query("DELETE FROM contacts WHERE id=$1", [contact.id]).catch(() => undefined);
    await pool.query("DELETE FROM businesses WHERE id=$1", [business.id]).catch(() => undefined);
    await pool.end();
    process.env.NODE_ENV = "production";
    result = await request("/api/commercial/coverage?purpose=marketing_outreach", as("admin"));
    check(result.response.status === 500 && result.body.code === "INTERNAL_ERROR" &&
      result.body.correlationId === result.response.headers.get("x-correlation-id") &&
      !/sql|select|postgres|constraint/i.test(JSON.stringify(result.body)), "500 is sanitized and correlated in body/header");

    check(providerCalls === 0, "HTTP suite made no provider/network calls beyond explicit loopback requests");
    check(passed >= 20, "HTTP suite executed a substantive non-zero assertion set");
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end().catch(() => undefined);
  }
  console.log(`CRO-02 HTTP contract passed (${passed} assertions)`);
}

main().catch((error) => {
  console.error("CRO-02 HTTP contract failed:", error);
  process.exit(1);
});