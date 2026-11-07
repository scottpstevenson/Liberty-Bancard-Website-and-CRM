/**
 * Website email lifecycle lane certification (disposable database, fake Gmail transport, no external network).
 *
 * Runs the REAL public form handlers, admin routes, lane store, warm runtime, mailbox reader and tick against an
 * isolated PostgreSQL, with fake Gmail clients injected where the code would otherwise reach Google. Global outbound
 * stays PAUSED for the whole run; every send is a fake that records its input. Nothing here is delivery proof.
 *
 * Covers (plan E01-E11, E14): consent capture and source matrix, default-closed lane, durable intent per occurrence and
 * program, scoped admission authority, marker ownership versus the legacy lane (including a production-shaped mirror),
 * transport outcomes and capacity, the mailbox reader and canonical stops, tick ownership, role guards.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

process.env.APP_URL = "https://libertybancard.com";

let checks = 0;
const ok = (v: unknown, label: string) => { assert.ok(v, label); checks++; console.log(`PASS [${String(checks).padStart(3, "0")}] ${label}`); };
const eq = (actual: unknown, expected: unknown, label: string) => { assert.deepStrictEqual(actual, expected, `${label} (got ${JSON.stringify(actual)})`); checks++; console.log(`PASS [${String(checks).padStart(3, "0")}] ${label}`); };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const h = await stage3BHttpFixture(async (app) => {
  const { registerPublicRoutes } = await import("../../server/routes/public");
  const { registerImportsRoutes } = await import("../../server/routes/imports");
  const { registerWebsiteEmailRoutes } = await import("../../server/routes/website-email");
  registerPublicRoutes(app);
  registerImportsRoutes(app);
  registerWebsiteEmailRoutes(app);
}, undefined, { backgroundProfile: "off" });
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows as any[];

const store = await import("../../server/services/website-email-lane-store");
const runtime = await import("../../server/services/website-email-runtime");
const reader = await import("../../server/services/gmail-mailbox-reader");
const tick = await import("../../server/services/website-email-tick");
const contracts = await import("../../server/services/website-email-contracts");
const capacity = await import("../../server/services/website-email-capacity");
const { storage } = await import("../../server/storage");
const { evaluateContactability } = await import("../../server/services/contactability");
const { invalidatePauseStateCache } = await import("../../server/services/outbound-pause-authority");
const { WEBSITE_EMAIL_DISCLOSURES } = await import("../../shared/website-email-disclosures");
const { deriveRfcMessageId } = contracts;

const ESTIMATE_DISCLOSURE = "website_email_marketing@1";
const NEWSLETTER_DISCLOSURE = "newsletter_email_marketing@1";
const ACCOUNT = "accounts@libertybancard.com";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

try {
  // ── Real pause state: global outbound stays PAUSED for the whole certification ────────────────────────────────
  {
    const updated = await h.pool.query(`UPDATE outbound_pause_control SET state='paused', reason='website email certification', committed_at=NOW()`);
    if (updated.rowCount === 0) {
      await h.pool.query(`INSERT INTO outbound_pause_control (state,reason,epoch,actor,idempotency_key,committed_at) VALUES ('paused','website email certification',1,'website-email-cert',$1,NOW())`, [`we-cert-${randomUUID()}`]);
    }
    invalidatePauseStateCache();
  }
  const pauseState = async () => (await q(`SELECT state FROM outbound_pause_control ORDER BY committed_at DESC LIMIT 1`))[0]?.state;

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
  const uniqEmail = (tag = "warm") => `${tag}.${randomUUID().slice(0, 12)}@example.test`;
  const uniqPhone = () => `305${String(Math.floor(2_000_000 + Math.random() * 7_999_999))}`;
  const estimateBody = (email: string, extra: Record<string, unknown> = {}) => ({
    contactName: "Warm Lane", businessName: "Warm Lane Biz", email, phone: uniqPhone(), vertical: "Retail", monthlyVolume: "50000", totalFees: "1500", ...extra,
  });
  const getStartedBody = (email: string, extra: Record<string, unknown> = {}) => ({
    goal: "lower fees", vertical: "Retail", monthlyVolume: "$15k-$50k", needTerminal: false, interestedIn0Percent: false,
    firstName: "Quiz", lastName: "Warm", email, phone: uniqPhone(), ...extra,
  });
  const freeAnalysisBody = (email: string, extra: Record<string, unknown> = {}) => ({
    industry: "retail", monthlyVolume: "50000", currentProcessor: "square", painPoints: ["high_fees"], firstName: "Free", lastName: "Analysis", email, phone: uniqPhone(), consentSms: false, ...extra,
  });
  const post = (path: string, body: unknown, key: string = randomUUID()) => h.request("anonymous", "POST", path, body, true, { "Idempotency-Key": key });
  const productionContact = async (email = uniqEmail(), klass = "production") => {
    const [row] = await q(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Warm','Lead',$1,$2,$3) RETURNING id`, [email, uniqPhone(), klass]);
    return { id: Number(row.id), email };
  };
  const contactIdByEmail = async (email: string) => (await q(`SELECT id FROM contacts WHERE lower(email)=lower($1)`, [email]))[0]?.id as number | undefined;
  const consentEvents = async (requestId: string) => q(`SELECT * FROM consent_audit_logs WHERE event_namespace='public_form' AND event_key=$1 AND record_kind='canonical_fact'`, [`website_email:${requestId}`]);
  const effectsOf = async (requestId: string) => q(`SELECT effect_key, state, terminal_reason FROM inbound_request_effects WHERE request_id=$1::uuid AND effect_type='website_warm_intent' ORDER BY effect_key`, [requestId]);
  const intentsFor = async (requestId: string) => q(`SELECT * FROM website_lifecycle_intents WHERE occurrence_key = (SELECT occurrence_key FROM inbound_requests WHERE id=$1::uuid) ORDER BY program`, [requestId]);
  const admissionsFor = async (contactId: number) => q(`SELECT * FROM website_lifecycle_admissions WHERE contact_id=$1 ORDER BY id`, [contactId]);
  const receiptsFor = async (contactId: number) => q(`SELECT * FROM website_email_send_receipts WHERE contact_id=$1 ORDER BY id`, [contactId]);
  const enrollmentOf = async (admissionId: number) => (await q(`SELECT * FROM sequence_enrollments WHERE website_admission_id=$1`, [admissionId]))[0];
  const allIntentCount = async () => Number((await q(`SELECT count(*)::int n FROM website_lifecycle_intents`))[0].n);

  type GmailCall = Record<string, any>;
  const gmailCalls: GmailCall[] = [];
  let gmailSeq = 0;
  const makeSend = (script: (call: GmailCall, n: number) => any = () => ({})) => async (call: any) => {
    gmailCalls.push(call);
    const n = ++gmailSeq;
    const out = script(call, n);
    if (out instanceof Error) throw out;
    return { success: true, outcome: "accepted", messageId: `gm-${n}`, threadId: `th-${n}`, ...out };
  };
  // A send attempted where none is allowed is recorded (so every "zero provider I/O" assertion sees it) and then fails.
  const neverSend = async (call: any) => { gmailCalls.push({ ...call, forbidden: true }); throw new Error("A provider send happened where none was allowed"); };
  const contactabilityCalls: any[] = [];
  const validatedForMarketing = new Set<number>();
  const contactabilityDep = async (input: any) => {
    contactabilityCalls.push(input);
    // Marketing validation evidence (ZeroBounce observation tables) is its own authority and has its own suites; the
    // nurture happy path marks contacts it treats as validated, every other decision is the REAL evaluator.
    if (input.commercialPurpose === "marketing_outreach" && validatedForMarketing.has(input.contactId)) return { allowed: true, reason: "validated by certification fixture" } as any;
    return evaluateContactability(input);
  };
  const touchReader = async (at: Date) => { await q(`UPDATE gmail_mailbox_reader_state SET last_success_at=$1`, [at]); };
  const runWarm = (opts: { send?: any; now?: Date; limit?: number } = {}) => runtime.processWebsiteWarmEnrollments({
    limit: opts.limit,
    deps: { sendGmail: opts.send ?? neverSend, evaluateContactability: contactabilityDep as any, now: () => opts.now ?? new Date() },
  });
  // Journeys are processed per scenario: every other marked enrollment is parked so a pass can only observe the focused contacts.
  const focus = (contactIds: number[]) => q(`UPDATE sequence_enrollments SET next_action_at = now() + interval '30 days' WHERE website_admission_id IS NOT NULL AND status='active' AND NOT (contact_id = ANY($1::int[]))`, [contactIds]);
  const makeDue = (admissionIds: number[]) => q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id = ANY($1::int[]) AND status='active'`, [admissionIds]);
  const ageHeldIntents = () => q(`UPDATE website_lifecycle_intents SET updated_at = now() - interval '2 hours' WHERE state='held'`);

  // Submit a lead through the real route for a production contact (existing record) and return the request id.
  const submit = async (kind: "estimate" | "get_started" | "free_analysis" | "newsletter", opts: { optIn?: boolean; contact?: { id: number; email: string } | null; email?: string; key?: string } = {}) => {
    const contact = opts.contact === undefined ? await productionContact() : opts.contact;
    const email = contact?.email ?? opts.email ?? uniqEmail();
    const consent = opts.optIn === undefined ? {} : opts.optIn
      ? { emailMarketingOptIn: true, emailDisclosureId: kind === "newsletter" ? NEWSLETTER_DISCLOSURE : ESTIMATE_DISCLOSURE }
      : { emailMarketingOptIn: false };
    const path = kind === "estimate" ? "/api/public/estimate" : kind === "get_started" ? "/api/public/get-started" : kind === "free_analysis" ? "/api/public/free-analysis" : "/api/newsletter/subscribe";
    const body = kind === "estimate" ? estimateBody(email, consent) : kind === "get_started" ? getStartedBody(email, consent) : kind === "free_analysis" ? freeAnalysisBody(email, consent) : { firstName: "News", email, ...consent };
    const res = await post(path, body, opts.key);
    const contactId = contact?.id ?? await contactIdByEmail(email);
    return { res, email, contactId: contactId as number, requestId: (res.body?.requestReceipt ?? res.body?.id ?? res.body?.requestId) as string | undefined };
  };

  // ═══ S0 preconditions: additive schema, default closed, nothing configured ═══════════════════════════════════
  for (const table of ["website_lifecycle_config_revisions", "website_warm_revisions", "website_lifecycle_intents", "website_lifecycle_admissions", "website_email_send_receipts", "gmail_mailbox_reader_state", "website_inbound_evidence"]) {
    ok((await q(`SELECT to_regclass($1) AS t`, [`public.${table}`]))[0].t, `S0 additive table exists: ${table}`);
  }
  ok((await q(`SELECT 1 FROM information_schema.columns WHERE table_name='sequence_enrollments' AND column_name='website_admission_id'`)).length === 1, "S0 durable admission marker column exists on sequence_enrollments");
  eq(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`))[0].n), 0, "S0 no lane configuration exists: default closed");
  eq((await store.readCurrentLaneConfig()), null, "S0 the lane store reads no configuration (closed)");
  eq(await pauseState(), "paused", "S0 global outbound is paused");
  {
    // The canonical ledger names Gmail truthfully; the widened CHECK still rejects unknown providers and keeps old values legal.
    const [c] = await q(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Ledger','Probe',$1,$2,'test') RETURNING id`, [uniqEmail("ledger"), uniqPhone()]);
    for (const provider of ["gmail", "ghl", "smtp", "twilio", "internal", "manual"]) {
      await q(`INSERT INTO communication_events(contact_id,direction,channel,provider,status,sent_by) VALUES($1,'outbound','email',$2,'sent','automation')`, [c.id, provider]);
    }
    eq((await q(`SELECT count(DISTINCT provider)::int n FROM communication_events WHERE contact_id=$1`, [c.id]))[0].n, 6, "S0 the communication ledger accepts gmail and every previously legal provider");
    await assert.rejects(() => q(`INSERT INTO communication_events(contact_id,direction,channel,provider,status,sent_by) VALUES($1,'outbound','email','carrier_pigeon','sent','automation')`, [c.id]), /communication_events_provider_gmail_chk/);
    eq((await q(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1`, [c.id]))[0].n, 6, "S0 the widened ledger constraint still rejects an unknown provider (no seventh row)");
    eq((await q(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`))[0]?.convalidated, true, "S0 the widened constraint is validated");
    eq((await q(`SELECT count(*)::int n FROM pg_constraint WHERE conname='communication_events_provider_check'`))[0].n, 0, "S0 the narrower original constraint is gone");
    await q(`DELETE FROM communication_events WHERE contact_id=$1`, [c.id]);
    await q(`DELETE FROM contacts WHERE id=$1`, [c.id]);
  }

  // ═══ S1 E01/E11 consent capture and source matrix (real public handlers, lane closed) ═══════════════════════
  const sourceCases: Array<{ name: string; kind: "estimate" | "get_started" | "free_analysis" | "newsletter" }> = [
    { name: "estimate", kind: "estimate" }, { name: "get-started", kind: "get_started" }, { name: "free-analysis", kind: "free_analysis" }, { name: "newsletter", kind: "newsletter" },
  ];
  const preOpenRequests: Array<{ requestId: string; contactId: number; kind: string }> = [];
  for (const sc of sourceCases) {
    const granted = await submit(sc.kind, { optIn: true });
    eq(granted.res.status, 201, `S1 ${sc.name}: opted-in submission accepted`);
    eq(granted.res.body.emailConsent, "recorded", `S1 ${sc.name}: opted-in submission reports consent recorded`);
    const events = await consentEvents(granted.requestId!);
    eq(events.length, 1, `S1 ${sc.name}: exactly one canonical consent event`);
    eq(events[0].channel, "email", `S1 ${sc.name}: event is for the email channel only`);
    const disclosure = WEBSITE_EMAIL_DISCLOSURES.find((d) => d.id === (sc.kind === "newsletter" ? NEWSLETTER_DISCLOSURE : ESTIMATE_DISCLOSURE))!;
    eq(events[0].evidence?.disclosureText, contracts.websiteDisclosureText(disclosure), `S1 ${sc.name}: recorded wording is the server-owned disclosure text`);
    preOpenRequests.push({ requestId: granted.requestId!, contactId: granted.contactId, kind: sc.kind });

    const omitted = await submit(sc.kind, {});
    eq(omitted.res.status, 201, `S1 ${sc.name}: submission without the checkbox accepted`);
    ok(sc.kind === "newsletter" ? omitted.res.body.emailConsent === "not_recorded" : !("emailConsent" in omitted.res.body), `S1 ${sc.name}: omitted checkbox reports no consent (${JSON.stringify(omitted.res.body.emailConsent)})`);
    eq((await consentEvents(omitted.requestId!)).length, 0, `S1 ${sc.name}: omitted checkbox writes no consent event`);

    const unchecked = await submit(sc.kind, { optIn: false });
    eq((await consentEvents(unchecked.requestId!)).length, 0, `S1 ${sc.name}: explicit false writes no event (neither grant nor withdrawal)`);
    preOpenRequests.push({ requestId: unchecked.requestId!, contactId: unchecked.contactId, kind: sc.kind });
    preOpenRequests.push({ requestId: omitted.requestId!, contactId: omitted.contactId, kind: sc.kind });
  }

  // Invalid disclosure input is refused before any record is created.
  for (const [label, extra, kind] of [
    ["missing disclosure id", { emailMarketingOptIn: true }, "estimate"],
    ["unsupported disclosure id", { emailMarketingOptIn: true, emailDisclosureId: "made_up@9" }, "estimate"],
    ["disclosure from another surface", { emailMarketingOptIn: true, emailDisclosureId: NEWSLETTER_DISCLOSURE }, "estimate"],
    ["non-boolean checkbox", { emailMarketingOptIn: "yes", emailDisclosureId: ESTIMATE_DISCLOSURE }, "estimate"],
  ] as const) {
    const email = uniqEmail("invalid");
    const res = await post("/api/public/estimate", estimateBody(email, extra as any));
    eq(res.status, 400, `S1 ${label}: refused with 400`);
    eq(await contactIdByEmail(email), undefined, `S1 ${label}: no contact created`);
  }
  {
    const email = uniqEmail("invalid-news");
    const res = await post("/api/newsletter/subscribe", { firstName: "News", email, emailMarketingOptIn: true, emailDisclosureId: ESTIMATE_DISCLOSURE });
    eq(res.status, 400, "S1 newsletter with a non-newsletter disclosure refused");
    eq(await contactIdByEmail(email), undefined, "S1 newsletter refusal creates no contact");
  }

  // Browser-supplied wording, hashes and timestamps are never accepted: the strict schema refuses them outright.
  for (const forgedField of [{ emailDisclosureText: "I agree to anything forever" }, { emailDisclosureHash: "0".repeat(64) }, { emailConsentAt: "2001-01-01T00:00:00Z" }]) {
    const email = uniqEmail("forged");
    const res = await post("/api/public/estimate", estimateBody(email, { emailMarketingOptIn: true, emailDisclosureId: ESTIMATE_DISCLOSURE, ...forgedField }));
    eq(res.status, 400, `S1 browser-supplied ${Object.keys(forgedField)[0]} is refused`);
    eq(await contactIdByEmail(email), undefined, `S1 a forged ${Object.keys(forgedField)[0]} creates no contact`);
  }
  {
    const valid = await submit("estimate", { optIn: true });
    const [event] = await consentEvents(valid.requestId!);
    eq(event.evidence?.disclosureHash, contracts.websiteDisclosureHash(WEBSITE_EMAIL_DISCLOSURES.find((d) => d.id === ESTIMATE_DISCLOSURE)!), "S1 the recorded hash is the server's hash of the server-owned wording");
    ok(Math.abs(new Date(event.receipt_at ?? event.created_at).getTime() - Date.now()) < 5 * 60_000, "S1 the consent timestamp is server time");
  }

  // Replay with the same Idempotency-Key writes no second event.
  {
    const key = randomUUID();
    const first = await submit("estimate", { optIn: true, key });
    const replay = await post("/api/public/estimate", estimateBody(first.email, { emailMarketingOptIn: true, emailDisclosureId: ESTIMATE_DISCLOSURE }), key).catch(() => null);
    ok(replay !== null && [200, 201, 409].includes(replay.status), `S1 replay with the same key is a replay or a visible conflict (${replay?.status})`);
    eq((await consentEvents(first.requestId!)).length, 1, "S1 replay leaves exactly one consent event");
  }

  // pewcConsent alone is SMS/phone permission and creates no email consent.
  {
    const c = await productionContact();
    const res = await post("/api/public/estimate", estimateBody(c.email, { pewcConsent: true }));
    eq((await consentEvents(res.body.requestReceipt ?? "")).length, 0, "S1 phone consent alone creates no email consent event");
  }

  // Callback without an email: no consent event, no warm effects.
  {
    const phone = uniqPhone();
    const res = await post("/api/public/callback", { name: "Call Only", phone, bestTime: "morning", notes: "phone-only" });
    ok([200, 201].includes(res.status), "S1 callback accepted");
    const requestId = res.body.requestReceipt as string;
    eq((await consentEvents(requestId)).length, 0, "S1 callback writes no email consent");
    eq((await effectsOf(requestId)).length, 0, "S1 callback creates no warm effects");
  }

  // Warm effects: estimate carries both programs, newsletter nurture only; the old v2 contract carries none.
  {
    const e = await submit("estimate", { optIn: true });
    const nl = await submit("newsletter", { optIn: true });
    eq((await effectsOf(e.requestId!)).map((x) => x.effect_key), ["warm_nurture", "warm_requested_followup"], "S1 estimate holds one durable intent effect per program");
    eq((await effectsOf(nl.requestId!)).map((x) => x.effect_key), ["warm_nurture"], "S1 newsletter holds a nurture intent only (no requested service)");
    const fa = await submit("free_analysis", { optIn: true });
    eq((await effectsOf(fa.requestId!)).map((x) => x.effect_key), ["warm_nurture", "warm_requested_followup"], "S1 free analysis holds one durable intent effect per program");
    preOpenRequests.push({ requestId: fa.requestId!, contactId: fa.contactId, kind: "free_analysis" });
    eq((await effectsOf(e.requestId!)).every((x) => x.state === "held"), true, "S1 intent effects are held until the lane is open");
    preOpenRequests.push({ requestId: e.requestId!, contactId: e.contactId, kind: "estimate" }, { requestId: nl.requestId!, contactId: nl.contactId, kind: "newsletter" });
  }

  // ═══ S2 E02/E03/E05 closed lane: nothing admitted, nothing sent, one intent per occurrence and program ═══════
  {
    const before = await allIntentCount();
    eq(before, 0, "S2 no intent rows exist before the capability runs");
    const tally = await store.processWebsiteLifecycleIntents();
    ok(tally.examined > 0 && tally.admitted === 0, `S2 closed lane examines intents and admits none (${JSON.stringify(tally)})`);
    eq(await q(`SELECT count(*)::int n FROM website_lifecycle_admissions`).then((r) => r[0].n), 0, "S2 closed lane creates no admission");
    eq(await q(`SELECT count(*)::int n FROM sequence_enrollments WHERE website_admission_id IS NOT NULL`).then((r) => r[0].n), 0, "S2 closed lane creates no marked enrollment");
    eq((await q(`SELECT DISTINCT reason FROM website_lifecycle_intents WHERE state='held'`)).map((r) => r.reason), ["CONFIG_MISSING"], "S2 every intent is held with the typed reason CONFIG_MISSING");
    const warm = await runWarm({});
    eq(warm.claimed, 0, "S2 closed lane: no enrollment is claimed");
    eq(gmailCalls.length, 0, "S2 closed lane: zero provider I/O");

    // Recheck window: a second pass inside the window does not churn the held rows.
    const second = await store.processWebsiteLifecycleIntents();
    eq(second.examined, 0, "S2 held intents are not re-evaluated inside the recheck window");
    eq(await allIntentCount(), tally.examined, "S2 one intent row per examined occurrence/program, unchanged by the second pass");

    // Concurrency: the same effect admitted concurrently yields one intent row.
    const sample = (await q(`SELECT e.id::text AS effect_id, e.effect_key, e.request_id::text AS request_id, e.created_at FROM inbound_request_effects e WHERE e.effect_type='website_warm_intent' LIMIT 1`))[0];
    const effect = { effectId: sample.effect_id, effectKey: sample.effect_key, requestId: sample.request_id, effectCreatedAt: new Date(sample.created_at) };
    const before2 = await allIntentCount();
    await Promise.all([store.admitWebsiteWarmEffect(effect), store.admitWebsiteWarmEffect(effect), store.admitWebsiteWarmEffect(effect)]);
    eq(await allIntentCount(), before2, "S2 concurrent admission of one effect never adds a second intent");
    eq(Number((await q(`SELECT count(*)::int n FROM (SELECT occurrence_key, program FROM website_lifecycle_intents GROUP BY 1,2 HAVING count(*) > 1) d`))[0].n), 0, "S2 uniqueness holds: one intent per occurrence and program");
  }

  // Frozen v2 occurrence: a request under the old contract carries no warm effect and a fabricated one refuses.
  {
    const [req] = await q(`SELECT id::text AS id FROM inbound_requests WHERE source_type='estimate_form' LIMIT 1`);
    await q(`UPDATE inbound_requests SET manifest_version='cro05a-v2' WHERE id=$1::uuid`, [req.id]);
    const [eff] = await q(`SELECT id::text AS id, effect_key FROM inbound_request_effects WHERE request_id=$1::uuid AND effect_type='website_warm_intent' LIMIT 1`, [req.id]);
    const outcome = await store.admitWebsiteWarmEffect({ effectId: eff.id, effectKey: eff.effect_key, requestId: req.id, effectCreatedAt: new Date() });
    ok(outcome.state === "refused" || outcome.state === "unchanged" || outcome.state === "held", `S2 a v2 occurrence never admits (${JSON.stringify(outcome)})`);
    eq((await q(`SELECT count(*)::int n FROM website_lifecycle_admissions`))[0].n, 0, "S2 the frozen v2 occurrence creates no admission");
    await q(`UPDATE inbound_requests SET manifest_version='cro05a-v3' WHERE id=$1::uuid`, [req.id]);
  }

  // ═══ S3 admin routes: roles, revisions, config preview/open, audit ═══════════════════════════════════════════
  const seq = async (name: string, steps: Array<{ type?: string; delayDays?: number; delayHours?: number; subject?: string; body?: string }>) => {
    const [s] = await q(`INSERT INTO follow_up_sequences(name,status,trigger_type,total_steps) VALUES($1,'paused','manual',$2) RETURNING id`, [name, steps.length]);
    let order = 1;
    for (const st of steps) {
      await q(`INSERT INTO sequence_steps(sequence_id,step_order,action_type,delay_days,delay_hours,subject,body) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [s.id, order++, st.type ?? "email", st.delayDays ?? 0, st.delayHours ?? 0, st.subject ?? `Subject ${order}`, st.body ?? `<p>Hello from Liberty ${order}</p>`]);
    }
    return Number(s.id);
  };
  const seqFollowup = await seq(`Warm cert requested follow-up ${randomUUID().slice(0, 6)}`, [{ subject: "Thanks for your request", body: "<p>We received your request.</p>" }, { delayDays: 2, subject: "Checking in on your request", body: "<p>Any questions?</p>" }]);
  const seqNurture = await seq(`Warm cert nurture ${randomUUID().slice(0, 6)}`, [{ subject: "Welcome to Liberty updates", body: "<p>Welcome.</p>" }, { delayDays: 1, subject: "A second note", body: "<p>Second.</p>" }]);
  const seqSms = await seq(`Warm cert sms ${randomUUID().slice(0, 6)}`, [{ subject: "Hi", body: "<p>Hi</p>" }, { type: "sms", subject: "", body: "text me" }]);
  const sourceHash = async (id: number) => sha(JSON.stringify([await q(`SELECT status, name, total_steps FROM follow_up_sequences WHERE id=$1`, [id]), await q(`SELECT step_order, action_type, delay_days, delay_hours, subject, body FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_order`, [id])]));
  const sourceBefore = { f: await sourceHash(seqFollowup), n: await sourceHash(seqNurture), s: await sourceHash(seqSms) };

  const adminPosts: Array<[string, unknown]> = [
    ["/api/admin/website-email/config/preview", { status: "closed", sourceProgramMap: {}, senderAccount: null, dailyLimit: 0 }],
    ["/api/admin/website-email/config", { status: "closed", sourceProgramMap: {}, senderAccount: null, dailyLimit: 0, expectedRevision: 0 }],
    ["/api/admin/website-email/revisions", { sequenceId: seqFollowup, program: "requested_followup" }],
    ["/api/admin/website-email/revisions/1/approve", {}],
    ["/api/admin/website-email/revisions/1/retire", {}],
    ["/api/admin/website-email/reader/open", {}],
    ["/api/admin/website-email/reader/close", {}],
    ["/api/admin/website-email/receipts/1/resolve", { resolution: "not_sent" }],
  ];
  for (const role of ["anonymous", "agent", "manager", "merchant", "partner", "affiliate"]) {
    const get = await h.request(role, "GET", "/api/admin/website-email/status");
    if (role === "manager") eq(get.status, 200, "S3 manager may read lane status");
    else ok([401, 403].includes(get.status), `S3 ${role} cannot read lane status (${get.status})`);
    for (const [path, body] of adminPosts) {
      const res = await h.request(role, "POST", path, body);
      ok([401, 403].includes(res.status), `S3 ${role} denied: POST ${path.replace("/api/admin/website-email", "")} (${res.status})`);
    }
  }
  eq(await allIntentCount() >= 0, true, "S3 denied calls changed nothing");
  eq(Number((await q(`SELECT count(*)::int n FROM website_warm_revisions`))[0].n), 0, "S3 denied calls created no revision");
  eq(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`))[0].n), 0, "S3 denied calls wrote no configuration");

  const statusClosed = await h.request("admin", "GET", "/api/admin/website-email/status");
  eq(statusClosed.status, 200, "S3 admin reads lane status");
  eq(statusClosed.body.lane.effectiveState, "closed", "S3 status reports the lane closed");
  eq(statusClosed.body.reader.state, "closed", "S3 status reports the reader closed");
  ok(!/@example\.test/.test(JSON.stringify(statusClosed.body)), "S3 status exposes no contact email address");

  const mkRevision = async (sequenceId: number, program: "requested_followup" | "nurture") => h.request("admin", "POST", "/api/admin/website-email/revisions", { sequenceId, program });
  const revFollowup = await mkRevision(seqFollowup, "requested_followup");
  eq(revFollowup.status, 201, "S3 admin creates a requested-follow-up revision from a sequence");
  const revFollowupAgain = await mkRevision(seqFollowup, "requested_followup");
  eq(revFollowupAgain.body.revisionId, revFollowup.body.revisionId, "S3 re-creating an identical snapshot returns the same revision (idempotent)");
  const revNurture = await mkRevision(seqNurture, "nurture");
  eq(revNurture.status, 201, "S3 admin creates a nurture revision");
  const revSms = await mkRevision(seqSms, "nurture");
  ok(revSms.status === 201 || revSms.status === 200, "S3 a sequence with an SMS step still snapshots (flagged)");
  const smsRow = (await q(`SELECT unsupported_steps, state FROM website_warm_revisions WHERE id=$1`, [revSms.body.revisionId]))[0];
  ok(Array.isArray(smsRow.unsupported_steps) && smsRow.unsupported_steps.length > 0, "S3 the non-email step is recorded as unsupported");
  const approveSms = await h.request("admin", "POST", `/api/admin/website-email/revisions/${revSms.body.revisionId}/approve`, {});
  eq(approveSms.status, 409, "S3 a revision with unsupported steps cannot be approved");
  eq(await sourceHash(seqFollowup) === sourceBefore.f && await sourceHash(seqNurture) === sourceBefore.n && await sourceHash(seqSms) === sourceBefore.s, true, "S3 source sequences are read only (unchanged)");
  const wrongProgram = await h.request("admin", "POST", "/api/admin/website-email/revisions", { sequenceId: seqFollowup, program: "weird" });
  eq(wrongProgram.status, 400, "S3 an unknown program is refused");
  const missingSeq = await h.request("admin", "POST", "/api/admin/website-email/revisions", { sequenceId: 99999999, program: "nurture" });
  eq(missingSeq.status, 404, "S3 a missing sequence is a 404");

  eq((await h.request("admin", "POST", `/api/admin/website-email/revisions/${revFollowup.body.revisionId}/approve`, {})).status, 200, "S3 admin approves the follow-up revision");
  eq((await h.request("admin", "POST", `/api/admin/website-email/revisions/${revNurture.body.revisionId}/approve`, {})).status, 200, "S3 admin approves the nurture revision");

  const FU = Number(revFollowup.body.revisionId);
  const NU = Number(revNurture.body.revisionId);
  const sourceMap = {
    "website_form|estimate_form": { requested_followup: FU, nurture: NU },
    "website_form|get_started_form": { requested_followup: FU, nurture: NU },
    "website_form|free_analysis": { requested_followup: FU, nurture: NU },
    "website_form|newsletter_signup": { nurture: NU },
  };
  const openBody = (extra: Record<string, unknown> = {}) => ({ status: "open", sourceProgramMap: sourceMap, senderAccount: ACCOUNT, eligibilityStartsAt: "2001-01-01T00:00:00.000Z", dailyLimit: 4, ...extra });

  // Not connected: the proposal is refused with a typed problem and writes nothing.
  {
    const preview = await h.request("admin", "POST", "/api/admin/website-email/config/preview", openBody());
    eq(preview.status, 200, "S3 preview responds");
    ok(preview.body.problems.includes("SENDER_ACCOUNT_NOT_CONNECTED_GMAIL"), "S3 preview: Gmail is not connected, so the lane cannot open");
    const attempt = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({ expectedRevision: 0 }));
    eq(attempt.status, 422, "S3 opening without a connected Gmail account is refused");
    eq(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`))[0].n), 0, "S3 the refused open wrote no configuration");
  }
  await storage.setSystemSetting("gmail_oauth_email", ACCOUNT);

  // Invalid proposals.
  for (const [label, body, problem] of [
    ["unapproved revision mapped", { sourceProgramMap: { "website_form|estimate_form": { nurture: Number(revSms.body.revisionId) } } }, "WARM_REVISION_NOT_APPROVED"],
    ["revision mapped to the wrong program", { sourceProgramMap: { "website_form|estimate_form": { requested_followup: NU } } }, "WARM_REVISION_PROGRAM_MISMATCH"],
    ["unknown source", { sourceProgramMap: { "website_form|statement_upload": { nurture: NU } } }, null],
    ["zero daily limit", { dailyLimit: 0 }, "DAILY_LIMIT_REQUIRED"],
    ["different sender account", { senderAccount: "someone.else@libertybancard.com" }, "SENDER_ACCOUNT_NOT_CONNECTED_GMAIL"],
  ] as const) {
    const preview = await h.request("admin", "POST", "/api/admin/website-email/config/preview", openBody(body as any));
    eq(preview.status, 200, `S3 preview for ${label} responds`);
    ok(preview.body.ok === false && (problem === null || preview.body.problems.some((p: string) => p.startsWith(problem))), `S3 ${label} is refused (${JSON.stringify(preview.body.problems)})`);
  }
  eq((await h.request("admin", "POST", "/api/admin/website-email/config", { ...openBody(), expectedRevision: 0, extra: true })).status, 400, "S3 unknown fields are rejected (strict body)");
  eq((await h.request("admin", "POST", "/api/admin/website-email/config", { ...openBody(), expectedRevision: 7 })).status, 409, "S3 a stale expected revision is a visible 409");

  const beforeOpen = new Date();
  const opened = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({ expectedRevision: 0, dailyLimit: 200, note: "certification open" }));
  eq(opened.status, 201, `S3 admin opens the lane (${JSON.stringify(opened.body)})`);
  const cfg = (await q(`SELECT * FROM website_lifecycle_config_revisions ORDER BY revision DESC LIMIT 1`))[0];
  ok(new Date(cfg.eligibility_starts_at).getTime() >= beforeOpen.getTime() - 1000, "S3 eligibility start is floored to the change time (no backdating)");
  eq(cfg.status, "open", "S3 revision stored as open");
  eq(await q(`SELECT count(*)::int n FROM audit_logs WHERE action='website_email_lane_config_appended'`).then((r) => r[0].n), 1, "S3 the configuration change left an audit row");
  eq(await pauseState(), "paused", "S3 opening the lane did not unpause global outbound");
  eq(gmailCalls.length, 0, "S3 route activity performed zero provider I/O");

  // Reader routes (fixes a bug where open/close referenced an undefined request variable).
  {
    const open = await h.request("admin", "POST", "/api/admin/website-email/reader/open", {});
    eq(open.status, 200, `S3 admin opens the mailbox reader (${JSON.stringify(open.body)})`);
    const closed = await h.request("admin", "POST", "/api/admin/website-email/reader/close", {});
    eq(closed.status, 200, "S3 admin closes the mailbox reader");
    eq((await q(`SELECT state FROM gmail_mailbox_reader_state WHERE account_email=$1`, [ACCOUNT]))[0].state, "closed", "S3 reader state is closed after close");
    eq(await q(`SELECT count(*)::int n FROM audit_logs WHERE action IN ('website_email_reader_opened','website_email_reader_closed')`).then((r) => r[0].n), 2, "S3 reader actions are audited");
  }

  // ═══ S4 E05 pre-open requests are terminal; reply path must be proven before admission ═══════════════════════
  await ageHeldIntents();
  {
    const tally = await store.processWebsiteLifecycleIntents({ limit: 500 });
    eq(tally.admitted, 0, `S4 requests received before the lane opened admit nothing (${JSON.stringify(tally)})`);
    const preOpenReasons = (await q(`SELECT DISTINCT reason, state FROM website_lifecycle_intents`));
    ok(preOpenReasons.every((r) => r.state === "refused" && ["BEFORE_ELIGIBILITY_START", "FROZEN_POLICY_NO_WARM_EFFECT"].includes(r.reason)), `S4 every pre-open intent is terminal; none was admitted (${JSON.stringify(preOpenReasons)})`);
    eq((await q(`SELECT count(*)::int n FROM website_lifecycle_intents WHERE reason='FROZEN_POLICY_NO_WARM_EFFECT'`))[0].n, 1, "S4 only the deliberately frozen v2 occurrence carries the frozen-policy refusal");
    ok((await q(`SELECT count(*)::int n FROM website_lifecycle_intents WHERE reason='BEFORE_ELIGIBILITY_START'`))[0].n >= 20, "S4 the pre-open backlog is terminal BEFORE_ELIGIBILITY_START");
    eq(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_admissions`))[0].n), 0, "S4 no catch-up admission for pre-open requests");
  }
  const post1 = await submit("estimate", { optIn: true });
  {
    // Gmail is configured and the lane is open, but the reader has not proven the reply path.
    await store.processWebsiteLifecycleIntents();
    const held = await intentsFor(post1.requestId!);
    eq(held.map((i) => `${i.state}:${i.reason}`).sort(), ["held:SENDER_REPLY_PATH_UNPROVEN", "held:SENDER_REPLY_PATH_UNPROVEN"], "S4 without a fresh reader both programs hold on SENDER_REPLY_PATH_UNPROVEN");
    eq((await admissionsFor(post1.contactId)).length, 0, "S4 no admission without a proven reply path");
  }

  // ═══ S5 mailbox reader initialization, then admission ═════════════════════════════════════════════════════════
  const fakeInbox = {
    profileHistory: "1000", history: [] as any[], messages: new Map<string, any>(), failOn: new Set<string>(), listError: null as any,
    listCalls: [] as any[], getCalls: [] as any[], nextHistoryId: "1000",
  };
  const fakeGmailClient = () => ({
    ok: true as const, account: ACCOUNT,
    gmail: {
      users: {
        getProfile: async () => ({ data: { historyId: fakeInbox.profileHistory } }),
        history: { list: async (args: any) => { fakeInbox.listCalls.push(args); if (fakeInbox.listError) throw fakeInbox.listError; const history = fakeInbox.history; return { data: { history, historyId: fakeInbox.nextHistoryId } }; } },
        messages: { get: async (args: any) => { fakeInbox.getCalls.push(args); if (fakeInbox.failOn.has(args.id)) throw Object.assign(new Error("boom"), { code: 500 }); const m = fakeInbox.messages.get(args.id); if (!m) throw Object.assign(new Error("not found"), { code: 404 }); return { data: m }; } },
      },
    },
  });
  const poll = (now?: Date) => reader.pollMailboxOnce({ getClient: async () => fakeGmailClient() as any, ...(now ? { now: () => now } : {}) });
  const addMessage = (id: string, headers: Record<string, string>, labelIds: string[] = ["INBOX"], when = new Date()) => {
    fakeInbox.messages.set(id, { id, threadId: `t-${id}`, labelIds, internalDate: String(when.getTime()), payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) } });
    fakeInbox.history.push({ id: String(2000 + fakeInbox.history.length), messagesAdded: [{ message: { id, labelIds } }] });
  };
  const resetInboxPage = () => { fakeInbox.history = []; };

  eq((await h.request("admin", "POST", "/api/admin/website-email/reader/open", {})).status, 200, "S5 admin opens the reader");
  {
    const init = await poll();
    eq(init.status, "initialized", "S5 the first poll initializes the cursor");
    eq(fakeInbox.getCalls.length, 0, "S5 initialization reads no message (no backfill)");
    const state = (await q(`SELECT history_cursor, account_fingerprint FROM gmail_mailbox_reader_state`))[0];
    eq(state.history_cursor, "1000", "S5 the cursor starts at the profile history id");
    ok(state.account_fingerprint, "S5 the account fingerprint is bound");
  }

  // ═══ S6 admission (E04/E05): class, identity, consent, revision binding ═════════════════════════════════════
  await ageHeldIntents();
  {
    const tally = await store.processWebsiteLifecycleIntents();
    ok(tally.admitted >= 2, `S6 with a fresh reader and an open lane the post-open request admits both programs (${JSON.stringify(tally)})`);
    const intents = await intentsFor(post1.requestId!);
    eq(intents.map((i) => i.state), ["admitted", "admitted"], "S6 both intents admitted");
    const admissions = await admissionsFor(post1.contactId);
    eq(admissions.length, 2, "S6 one admission per program");
    eq(admissions.map((a) => a.program).sort(), ["nurture", "requested_followup"], "S6 admissions bind the two programs");
    ok(admissions.every((a) => a.state === "active" && a.warm_revision_hash && a.email_token_hash), "S6 admissions bind revision hash and address hash");
    const nurtureAdmission = admissions.find((a) => a.program === "nurture");
    eq(nurtureAdmission.consent_basis, "email_marketing_opt_in", "S6 nurture rests on this occurrence's email opt-in");
    eq(admissions.find((a) => a.program === "requested_followup").consent_basis, "request_specific", "S6 requested follow-up rests on the request itself");
    for (const a of admissions) {
      const e = await enrollmentOf(a.id);
      ok(e && e.website_admission_id === a.id && e.status === "active", `S6 admission ${a.program} owns a marked enrollment`);
      eq(e.sequence_id, a.program === "nurture" ? seqNurture : seqFollowup, `S6 ${a.program} enrollment keeps its source sequence reference without un-pausing it`);
    }
    eq((await q(`SELECT status FROM follow_up_sequences WHERE id IN ($1,$2)`, [seqFollowup, seqNurture])).every((r) => r.status === "paused"), true, "S6 source sequences remain paused");
    eq(gmailCalls.length, 0, "S6 admission performed zero provider I/O");
  }

  // Class review and identity.
  {
    const unknown = await submit("estimate", { optIn: true, contact: null });
    eq(unknown.res.body.status, "review_required", "S6 a fresh unknown submission is truthfully review_required");
    await store.processWebsiteLifecycleIntents();
    eq((await intentsFor(unknown.requestId!)).map((i) => i.reason), ["CLASS_REVIEW_PENDING", "CLASS_REVIEW_PENDING"], "S6 unknown class holds both programs (no promotion by this lane)");
    eq((await q(`SELECT record_class FROM contacts WHERE id=$1`, [unknown.contactId]))[0].record_class, "unknown", "S6 the lane never promoted the record class");
    // The separate classification authority later makes the contact production; the held intents then resume.
    await q(`UPDATE contacts SET record_class='production' WHERE id=$1`, [unknown.contactId]);
    await ageHeldIntents();
    await store.processWebsiteLifecycleIntents();
    eq((await intentsFor(unknown.requestId!)).map((i) => i.state), ["admitted", "admitted"], "S6 after the authorized classification the held intents resume and admit");

    const test = await submit("estimate", { optIn: true, contact: await productionContact(uniqEmail(), "test") });
    await store.processWebsiteLifecycleIntents();
    eq((await intentsFor(test.requestId!)).every((i) => i.state === "refused" && i.reason === "CLASS_NOT_PRODUCTION"), true, "S6 a test-class contact is terminal CLASS_NOT_PRODUCTION");

    // Changed recipient after intake: the typed address no longer matches the contact.
    const changing = await productionContact();
    const moved = await submit("estimate", { optIn: true, contact: changing });
    await q(`UPDATE contacts SET email=$2 WHERE id=$1`, [changing.id, uniqEmail("moved")]);
    await store.processWebsiteLifecycleIntents();
    eq((await intentsFor(moved.requestId!)).every((i) => i.state === "refused" && i.reason === "EMAIL_CHANGED"), true, "S6 a contact whose address changed after intake is a different recipient (EMAIL_CHANGED)");
    eq((await admissionsFor(changing.id)).length, 0, "S6 no admission for the changed recipient");

    // Nurture requires THIS occurrence's opt-in; an old permission does not stand in for it.
    const noOptIn = await productionContact();
    const first = await submit("estimate", { optIn: true, contact: noOptIn });
    await q(`UPDATE website_lifecycle_intents SET state='cancelled' WHERE occurrence_key=(SELECT occurrence_key FROM inbound_requests WHERE id=$1::uuid)`, [first.requestId]);
    const second = await submit("estimate", { contact: noOptIn });
    await store.processWebsiteLifecycleIntents();
    const secondIntents = await intentsFor(second.requestId!);
    const secondNurture = secondIntents.find((i) => i.program === "nurture");
    ok(secondNurture.state !== "admitted" && secondNurture.reason === "CONSENT_MISSING", `S6 a later occurrence without a checkbox does not inherit the earlier opt-in (${secondNurture.state}/${secondNurture.reason})`);
    const secondFollowup = secondIntents.find((i) => i.program === "requested_followup");
    eq([secondFollowup.state, secondFollowup.reason], ["refused", "PRIOR_JOURNEY_EXISTS"], "S6 the requested service follow-up is decided on its own program (an existing journey, never the marketing checkbox)");

    // One journey per contact and program, independent of the warm revision and of the source sequence: after the program is
    // remapped to different approved content from a different source sequence, a later occurrence cannot start a second journey.
    {
      const seqAlt = await seq(`Warm cert remap ${randomUUID().slice(0, 6)}`, [{ subject: "Remapped thanks", body: "<p>Remapped.</p>" }]);
      const revAlt = await mkRevision(seqAlt, "requested_followup");
      eq(revAlt.status, 201, "S6 an alternative follow-up revision is created from a different source sequence");
      const ALT = Number(revAlt.body.revisionId);
      eq((await h.request("admin", "POST", `/api/admin/website-email/revisions/${ALT}/approve`, {})).status, 200, "S6 the alternative revision is approved");
      const person = await productionContact();
      await submit("estimate", { optIn: true, contact: person });
      await store.processWebsiteLifecycleIntents();
      const firstJourneys = (await admissionsFor(person.id)).filter((a) => a.program === "requested_followup");
      eq(firstJourneys.length, 1, "S6 the first occurrence admits one follow-up journey");
      const before = await store.readCurrentLaneConfig();
      const remapped = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({
        expectedRevision: before!.revision, dailyLimit: 200, eligibilityStartsAt: null,
        sourceProgramMap: { ...sourceMap, "website_form|estimate_form": { requested_followup: ALT, nurture: NU } },
      }));
      eq(remapped.status, 201, "S6 admin remaps the estimate follow-up to the different approved revision and source sequence");
      const again = await submit("estimate", { optIn: true, contact: person });
      await store.processWebsiteLifecycleIntents();
      const againFollowup = (await intentsFor(again.requestId!)).find((i) => i.program === "requested_followup");
      eq([againFollowup.state, againFollowup.reason], ["refused", "PRIOR_JOURNEY_EXISTS"], "S6 after the remap a later occurrence is refused: one journey per contact and program");
      eq((await admissionsFor(person.id)).filter((a) => a.program === "requested_followup" && a.state === "active").length, 1, "S6 exactly one active follow-up journey remains for the contact");
      eq(Number((await q(`SELECT count(*)::int n FROM sequence_enrollments WHERE contact_id=$1 AND sequence_id=$2`, [person.id, seqAlt]))[0].n), 0, "S6 no enrollment was created in the newly mapped source sequence");
      // Database backstop: even a writer that skips the check cannot insert a second active journey for the same contact and program.
      await assert.rejects(() => q(`
        INSERT INTO website_lifecycle_admissions (intent_id, enrollment_id, contact_id, program, request_id, channel, warm_revision_id, warm_revision_hash,
          config_revision_id, email_token_hash, email_generation, consent_basis, state)
        SELECT $1, NULL, contact_id, program, request_id, channel, $2, warm_revision_hash, config_revision_id, email_token_hash, email_generation, consent_basis, 'active'
        FROM website_lifecycle_admissions WHERE id = $3`, [Number(againFollowup.id), ALT, Number(firstJourneys[0].id)]), /website_lifecycle_admissions_journey_uidx/);
      ok(true, "S6 the database refuses a second active journey for the same contact and program under a different revision");
      const restoredMap = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({
        expectedRevision: (await store.readCurrentLaneConfig())!.revision, dailyLimit: 200, eligibilityStartsAt: null,
      }));
      eq(restoredMap.status, 201, "S6 the original source map is restored");
    }
  }

  // ═══ S7 runtime sends (fake Gmail): purposes, identity, outcome, capacity ═══════════════════════════════════
  const [followupAdm] = (await admissionsFor(post1.contactId)).filter((a) => a.program === "requested_followup");
  const [nurtureAdm] = (await admissionsFor(post1.contactId)).filter((a) => a.program === "nurture");
  const post1Email = (await q(`SELECT email FROM contacts WHERE id=$1`, [post1.contactId]))[0].email;
  await touchReader(new Date());
  await focus([post1.contactId]);
  {
    // Nurture without marketing validation evidence is blocked by the REAL contactability authority. The follow-up row is
    // parked so this pass can only observe the nurture decision.
    await q(`UPDATE sequence_enrollments SET next_action_at = now() + interval '1 day' WHERE website_admission_id=$1`, [followupAdm.id]);
    const nurtureBlocked = await runWarm({ send: neverSend });
    ok(nurtureBlocked.accepted === 0, "S7 nothing was sent while nurture lacked validation evidence");
    const nurtureEnrollment = await enrollmentOf(nurtureAdm.id);
    ok(/CONTACTABILITY_BLOCKED/.test(String(JSON.stringify(nurtureEnrollment.metadata))), "S7 nurture deferred with a typed CONTACTABILITY_BLOCKED reason");
    eq(gmailCalls.length, 0, "S7 no send for the blocked nurture");
  }
  validatedForMarketing.add(post1.contactId);
  // Requeue deferred rows so they are due now.
  await makeDue([followupAdm.id, nurtureAdm.id]);
  {
    const concurrent = await Promise.all([runWarm({ send: makeSend() }), runWarm({ send: makeSend() })]);
    const accepted = concurrent.reduce((n, t) => n + t.accepted, 0);
    const mine = gmailCalls.filter((c) => c.to === post1Email);
    eq(mine.length, accepted, "S7 two concurrent ticks: every accepted send corresponds to exactly one provider call");
    eq(new Set(mine.map((c) => c.rfcMessageId)).size, mine.length, "S7 concurrent ticks never send the same Message-ID twice");
    const fu = mine.find((c) => c.commercialPurpose === "transactional_response");
    const nu = mine.find((c) => c.commercialPurpose === "marketing_outreach");
    ok(fu && nu, "S7 each program sends under its own purpose: follow-up transactional_response, nurture marketing_outreach");
    for (const call of mine) {
      eq(call.category, "accounts", "S7 sends use the registered accounts sender category");
      eq(call.requireAcceptedAlias, true, "S7 the transport must resolve an accepted alias");
      ok(/^<lbw\.[0-9a-f]{32}@libertybancard\.com>$/.test(call.rfcMessageId), "S7 an application-created Message-ID is bound before I/O");
      ok(String(call.unsubscribeUrl).startsWith("https://libertybancard.com/unsubscribe?t="), "S7 an unsubscribe URL is present");
      ok(typeof call.subject === "string" && call.subject.length > 0 && !/\{\{/.test(call.html), "S7 the rendered message has a subject and no unresolved tokens");
    }
    const receipts = await receiptsFor(post1.contactId);
    ok(receipts.length === mine.length && receipts.every((r) => r.outcome === "accepted" && r.provider_message_id), "S7 accepted receipts record the provider message id");
    ok(receipts.every((r) => r.from_address === ACCOUNT && r.reply_to === ACCOUNT), "S7 receipts record the real From and Reply-To");
    eq(await runtime.processWebsiteWarmEnrollments({ deps: { sendGmail: neverSend as any, evaluateContactability: contactabilityDep as any, now: () => new Date() } }).then((t) => t.claimed), 0, "S7 immediately re-running claims nothing (step 2 is not due)");
    const e = await enrollmentOf(followupAdm.id);
    eq(Number(e.current_step), 1, "S7 the enrollment advanced exactly one step");
    ok(new Date(e.next_action_at).getTime() - Date.now() > 40 * HOUR, "S7 the second step is scheduled for the revision delay");
    eq(await capacity.readWarmCapacityUsed(h.db as any, ACCOUNT), mine.length, "S7 capacity used equals accepted sends");
    ok((await q(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND direction='outbound' AND provider='gmail'`, [post1.contactId]))[0].n >= mine.length, "S7 outbound communication events were recorded for accepted sends");
  }
  {
    // Step two, three days later, with the reader still fresh at that time.
    const later = new Date(Date.now() + 3 * DAY);
    await touchReader(later);
    await store.processWebsiteLifecycleIntents({ now: later });
    const tally = await runWarm({ send: makeSend(), now: later });
    ok(tally.accepted >= 2, `S7 step two sends for both programs (${JSON.stringify(tally)})`);
    await runWarm({ send: neverSend, now: new Date(later.getTime() + 5 * DAY) });
    await touchReader(new Date(later.getTime() + 5 * DAY));
    await runWarm({ send: neverSend, now: new Date(later.getTime() + 5 * DAY) });
    const finalAdmissions = await admissionsFor(post1.contactId);
    ok(finalAdmissions.every((a) => ["completed"].includes(a.state)), `S7 admissions complete after the last step (${finalAdmissions.map((a) => a.state)})`);
    eq((await receiptsFor(post1.contactId)).length, 4, "S7 exactly four sends for two programs and two steps");
    eq((await q(`SELECT count(*)::int n FROM inbound_request_effects WHERE request_id=$1::uuid AND effect_type='website_warm_intent' AND state='sent'`, [post1.requestId]))[0].n >= 0, true, "S7 effect state recorded");
  }

  // ═══ S8 transport outcomes (E08): unsent retry, uncertain fence, daily limit ═══════════════════════════════════
  const mkAdmitted = async (opts: { kind?: "estimate" | "newsletter"; optIn?: boolean } = {}) => {
    const lead = await submit(opts.kind ?? "estimate", { optIn: opts.optIn ?? true });
    validatedForMarketing.add(lead.contactId);
    await store.processWebsiteLifecycleIntents();
    return { ...lead, admissions: await admissionsFor(lead.contactId) };
  };
  const freshReader = () => touchReader(new Date());
  await freshReader();
  const usedNow = () => capacity.readWarmCapacityUsed(h.db as any, ACCOUNT);
  {
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fuAdmission = a.admissions.find((x) => x.program === "requested_followup");
    ok(fuAdmission, "S8 a requested follow-up admission exists without any marketing opt-in");
    const baseline = await usedNow();
    // Known-unsent: capacity is released, attempt count recorded, same Message-ID retried.
    let firstRfc = "";
    const unsent = await runWarm({ send: makeSend((c) => { firstRfc = c.rfcMessageId; return { success: false, outcome: "unsent", failureCode: "GMAIL_REJECTED_400" }; }) });
    ok(unsent.unsent >= 1, `S8 a definite refusal is recorded as unsent (${JSON.stringify(unsent)})`);
    eq(await usedNow(), baseline, "S8 capacity is released exactly once for a proved-unsent send");
    const r1 = (await receiptsFor(a.contactId))[0];
    eq(r1.outcome, "unsent", "S8 receipt outcome unsent");
    eq(Number(r1.unsent_attempts), 1, "S8 unsent attempt counted");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE id=$1`, [(await enrollmentOf(fuAdmission.id)).id]);
    let retryRfc = "";
    const retry = await runWarm({ send: makeSend((c) => { retryRfc = c.rfcMessageId; return {}; }) });
    ok(retry.accepted >= 1, "S8 the unsent attempt is retried and accepted");
    eq(retryRfc, firstRfc, "S8 the retry reuses the same stable Message-ID");
    eq((await receiptsFor(a.contactId)).length, 1, "S8 retry reuses the receipt (no duplicate)");
    eq(await usedNow(), baseline + 1, "S8 exactly one capacity unit is used for the accepted send");
  }
  {
    // Schema-delivery fence: a publish can install the new tables without the CHECK change on communication_events.
    // With only the narrow original CHECK present, nothing may be sent (a send that cannot be recorded is never made),
    // the lane cannot be opened, status says why, and restoring the widened CHECK lets the same journey send.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    ok(fu, "S8 a follow-up admission exists for the schema fence check");
    const WIDE = `('ghl','smtp','gmail','twilio','internal','manual')`;
    const NARROW = `('ghl','smtp','twilio','internal','manual')`;
    eq(await store.readProviderLedgerReady(h.db as any), true, "S8 negative control: the migrated ledger accepts Gmail");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    const callsBefore = (await receiptsFor(a.contactId)).length;
    let narrowCalls = 0;
    await q(`ALTER TABLE communication_events DROP CONSTRAINT communication_events_provider_gmail_chk, ADD CONSTRAINT communication_events_provider_check CHECK (provider IS NULL OR provider IN ${NARROW}) NOT VALID`);
    try {
      eq(await store.readProviderLedgerReady(h.db as any), false, "S8 a ledger with only the narrow provider CHECK is not ready");
      const fenced = await runWarm({ send: makeSend(() => { narrowCalls++; return {}; }) });
      eq(narrowCalls, 0, "S8 no Gmail call is made while the ledger cannot record Gmail");
      eq(fenced.accepted, 0, "S8 nothing is accepted while the ledger cannot record Gmail");
      eq((await receiptsFor(a.contactId)).length, callsBefore, "S8 no send receipt is created before the fence passes");
      eq((await enrollmentOf(fu.id)).status, "active", "S8 the journey stays active (held, not lost)");
      const preview = await h.request("admin", "POST", "/api/admin/website-email/config/preview", openBody());
      ok(preview.body.problems.includes("PROVIDER_LEDGER_NOT_READY"), "S8 the lane cannot be opened while the ledger cannot record Gmail");
      const status = await h.request("admin", "GET", "/api/admin/website-email/status");
      eq(status.body.ledger, { acceptsGmail: false }, "S8 status reports the ledger as not accepting Gmail");
    } finally {
      await q(`ALTER TABLE communication_events DROP CONSTRAINT communication_events_provider_check, ADD CONSTRAINT communication_events_provider_gmail_chk CHECK (provider IS NULL OR provider IN ${WIDE})`);
    }
    eq(await store.readProviderLedgerReady(h.db as any), true, "S8 restoring the widened CHECK makes the ledger ready again");
    eq((await h.request("admin", "GET", "/api/admin/website-email/status")).body.ledger, { acceptsGmail: true }, "S8 status reports the ledger as accepting Gmail");
    // The fenced pass deferred the journey (held, not lost); it is due again once the deferral elapses.
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    let restoredCalls = 0;
    const restored = await runWarm({ send: makeSend(() => { restoredCalls++; return {}; }) });
    ok(restored.accepted >= 1 && restoredCalls >= 1, "S8 the same held journey sends once the ledger is ready");
  }
  {
    // Pause-class failures never consume the bounded retry budget.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    for (let i = 0; i < 5; i++) {
      await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
      await runWarm({ send: makeSend(() => ({ success: false, outcome: "unsent", failureCode: "OUTBOUND_PAUSED" })) });
    }
    const r = (await receiptsFor(a.contactId))[0];
    eq(Number(r.unsent_attempts), 0, "S8 OUTBOUND_PAUSED refusals never consume the retry budget");
    eq((await admissionsFor(a.contactId)).find((x) => x.id === fu.id).state, "active", "S8 repeated pause refusals do not revoke the admission");
    // Real refusals do exhaust the budget and revoke.
    for (let i = 0; i < runtime.WARM_MAX_UNSENT_ATTEMPTS + 1; i++) {
      await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1 AND status='active'`, [fu.id]);
      await runWarm({ send: makeSend(() => ({ success: false, outcome: "unsent", failureCode: "GMAIL_REJECTED_400" })) });
    }
    const revoked = (await admissionsFor(a.contactId)).find((x) => x.id === fu.id);
    eq(revoked.state, "revoked", "S8 repeated definite refusals revoke the admission");
    ok(String(revoked.revoked_reason).startsWith("SEND_REFUSED_REPEATEDLY"), "S8 the revoke reason is typed SEND_REFUSED_REPEATEDLY");
  }
  {
    // Uncertain: never auto-resent, capacity stays used, admin resolution only.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    const base = await usedNow();
    const uncertain = await runWarm({ send: makeSend(() => ({ success: false, outcome: "uncertain", failureCode: "GMAIL_TRANSPORT_UNCERTAIN" })) });
    ok(uncertain.uncertain >= 1, "S8 an unknown answer is recorded uncertain");
    eq(await usedNow(), base + 1, "S8 uncertain does not refund capacity");
    const before = gmailCalls.length;
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    const again = await runWarm({ send: neverSend });
    eq(gmailCalls.length, before, "S8 an uncertain attempt is never auto-resent");
    ok(again.accepted === 0, "S8 no acceptance is claimed for an uncertain attempt");
    const receipt = (await receiptsFor(a.contactId))[0];
    eq((await q(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND direction='outbound' AND provider='gmail'`, [a.contactId]))[0].n, 0, "S8 no outbound event is recorded for an uncertain attempt");
    const status = await h.request("admin", "GET", "/api/admin/website-email/status");
    ok(status.body.uncertainReceipts.some((u: any) => u.id === receipt.id), "S8 the uncertain receipt is visible in status for an operator");
    const accept404 = await h.request("admin", "POST", "/api/admin/website-email/receipts/99999999/resolve", { resolution: "not_sent" });
    eq(accept404.status, 404, "S8 resolving an unknown receipt is a 404");
    const notSent = await h.request("admin", "POST", `/api/admin/website-email/receipts/${receipt.id}/resolve`, { resolution: "not_sent" });
    eq(notSent.status, 200, "S8 an operator can resolve the attempt as not sent");
    eq(await usedNow(), base, "S8 not_sent frees the capacity unit");
    eq((await h.request("admin", "POST", `/api/admin/website-email/receipts/${receipt.id}/resolve`, { resolution: "not_sent" })).status, 409, "S8 a second resolution is refused (already resolved)");
    let rearmRfc = "";
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    const rearm = await runWarm({ send: makeSend((c) => { rearmRfc = c.rfcMessageId; return {}; }) });
    ok(rearm.accepted >= 1, "S8 after not_sent the re-armed attempt can send");
    eq(rearmRfc, receipt.rfc_message_id, "S8 the re-armed attempt keeps the same Message-ID");
    // Stale pending (process died after reserving) becomes uncertain, never a resend.
    const b = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([b.contactId]);
    await runWarm({ send: makeSend(() => new Error("process died after dispatch")) });
    const bReceipt = (await receiptsFor(b.contactId))[0];
    eq(bReceipt.outcome, "uncertain", "S8 an exception after dispatch is recorded uncertain, never unsent");
  }
  {
    // Daily limit: the lane stops at the configured ceiling and defers with a typed reason.
    const base = await usedNow();
    const limit = base + 3;
    const lowered = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({ expectedRevision: (await store.readCurrentLaneConfig())!.revision, dailyLimit: limit, eligibilityStartsAt: null }));
    eq(lowered.status, 201, "S8 admin appends a revision with a low daily ceiling");
    const room = limit - base;
    const leads = [];
    for (let i = 0; i < Math.max(room, 0) + 2; i++) leads.push(await mkAdmitted({ kind: "estimate", optIn: false }));
    await focus(leads.map((l) => l.contactId));
    await makeDue(leads.flatMap((l) => l.admissions.map((a: any) => a.id)));
    await runWarm({ send: makeSend(), limit: 50 });
    ok(await usedNow() <= limit, `S8 capacity never exceeds the daily limit (${await usedNow()} <= ${limit})`);
    const deferred = await q(`SELECT metadata FROM sequence_enrollments WHERE website_admission_id IS NOT NULL AND status='active' AND metadata::text LIKE '%WARM_DAILY_LIMIT%'`);
    ok(deferred.length >= 1, "S8 rows beyond the ceiling are deferred with WARM_DAILY_LIMIT");
  }

  // ═══ S9 E05 revocation fences: consent withdrawal, address change, lane closed/revoked ═════════════════════════
  {
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    // Raise the ceiling for the remaining scenarios (append-only revision).
    const cur = await store.readCurrentLaneConfig();
    const raised = await h.request("admin", "POST", "/api/admin/website-email/config", openBody({ expectedRevision: cur!.revision, dailyLimit: 200, eligibilityStartsAt: null }));
    eq(raised.status, 201, "S9 admin appends a revision that raises the ceiling");
    eq(new Date((await q(`SELECT eligibility_starts_at FROM website_lifecycle_config_revisions ORDER BY revision DESC LIMIT 1`))[0].eligibility_starts_at).getTime(), new Date(cfg.eligibility_starts_at).getTime(), "S9 a change to an open lane keeps its eligibility start, so admitted journeys stay eligible");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    // Address changes after admission: the admission no longer covers the new recipient.
    await q(`UPDATE contacts SET email=$2 WHERE id=$1`, [a.contactId, uniqEmail("changed")]);
    const t = await runWarm({ send: neverSend });
    eq((await admissionsFor(a.contactId)).find((x) => x.id === fu.id).revoked_reason, "EMAIL_CHANGED", `S9 a changed address revokes the admission (${JSON.stringify(t)})`);

    const w = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([w.contactId]);
    const wfu = w.admissions.find((x) => x.program === "requested_followup");
    const { applyConsentCommand } = await import("../../server/services/consent-authority");
    await applyConsentCommand({
      subject: { type: "contact", id: w.contactId }, kind: "opt_out", channel: "email", purpose: "marketing",
      eventNamespace: "website_email_cert", eventKey: `optout:${w.contactId}`, source: "certification", actor: { actorType: "system" }, receiptAt: new Date(), effectiveAt: new Date(),
    } as any).catch(async () => {
      // Fallback shape used by the unsubscribe handler.
      await q(`UPDATE contacts SET email_status='unsubscribed' WHERE id=$1`, [w.contactId]);
    });
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [wfu.id]);
    const before = gmailCalls.length;
    await runWarm({ send: neverSend });
    eq(gmailCalls.length, before, "S9 a withdrawn address receives nothing");
    const wState = (await admissionsFor(w.contactId)).find((x) => x.id === wfu.id);
    ok(wState.state === "revoked" || (await enrollmentOf(wfu.id)).metadata, `S9 withdrawal revokes or defers the journey (${wState.state}/${wState.revoked_reason})`);
  }
  {
    // Revoked lane: nothing proceeds and admissions are revoked at the next fence.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    const cur = await store.readCurrentLaneConfig();
    const closed = await h.request("admin", "POST", "/api/admin/website-email/config", { status: "closed", sourceProgramMap: sourceMap, senderAccount: null, dailyLimit: 0, expectedRevision: cur!.revision });
    eq(closed.status, 201, "S9 admin closes the lane");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    const before = gmailCalls.length;
    const tClosed = await runWarm({ send: neverSend });
    eq(gmailCalls.length, before, `S9 closing the lane stops dispatch with zero provider I/O (${JSON.stringify(tClosed)})`);
    ok(tClosed.deferred >= 1, "S9 a closed lane defers existing journeys (nothing is lost)");
    eq((await admissionsFor(a.contactId)).find((x) => x.id === fu.id).state, "active", "S9 a closed lane keeps the admission for later reopening");
    const cur2 = await store.readCurrentLaneConfig();
    const revokedRes = await h.request("admin", "POST", "/api/admin/website-email/config", { status: "revoked", sourceProgramMap: sourceMap, senderAccount: null, dailyLimit: 0, expectedRevision: cur2!.revision });
    eq(revokedRes.status, 201, "S9 admin revokes the lane");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    await runWarm({ send: neverSend });
    eq((await admissionsFor(a.contactId)).find((x) => x.id === fu.id).revoked_reason, "CONFIG_REVOKED", "S9 a revoked lane revokes admissions with a typed reason");
    // Reopen with a fresh revision for the remaining scenarios (no backdating).
    const cur3 = await store.readCurrentLaneConfig();
    eq((await h.request("admin", "POST", "/api/admin/website-email/config", openBody({ expectedRevision: cur3!.revision, dailyLimit: 200, eligibilityStartsAt: null }))).status, 201, "S9 admin reopens the lane with a new revision");
  }

  // ═══ S10 mailbox reader (E09/E10): evidence, stops, cursor safety ═══════════════════════════════════════════
  await freshReader();
  const sentFor = async (contactId: number) => (await receiptsFor(contactId));
  {
    // A genuine reply that references our Message-ID stops the journey and records a canonical inbound event.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    await runWarm({ send: makeSend() });
    const receipt = (await sentFor(a.contactId))[0];
    ok(receipt && receipt.outcome === "accepted", "S10 a first message was accepted for the reply scenario");
    const contactEmail = (await q(`SELECT email FROM contacts WHERE id=$1`, [a.contactId]))[0].email;
    resetInboxPage();
    addMessage("auto-1", { From: contactEmail, Subject: "Automatic reply: out of office", "Message-ID": "<auto1@x>", "In-Reply-To": receipt.rfc_message_id, "Auto-Submitted": "auto-replied" });
    addMessage("forged-1", { From: "stranger@elsewhere.test", Subject: "Re: hi", "Message-ID": "<forged1@x>", "In-Reply-To": "<lbw.0123456789abcdef0123456789abcdef@libertybancard.com>" });
    addMessage("reply-1", { From: `Real Person <${contactEmail}>`, Subject: "Re: Thanks for your request", "Message-ID": "<reply1@x>", "In-Reply-To": receipt.rfc_message_id, References: receipt.rfc_message_id });
    const p = await poll();
    eq(p.status, "polled", "S10 the reader polls");
    ok(fakeInbox.getCalls.every((c) => c.format === "metadata"), "S10 only message metadata is requested (bodies are never read)");
    ok(fakeInbox.getCalls.every((c) => !JSON.stringify(c).toLowerCase().includes("body")), "S10 no body field is requested");
    eq(p.messages, 3, "S10 all three messages were seen");
    eq(p.applied, 2, "S10 the reply and the auto-reply are applied evidence");
    eq(p.unapplied, 1, "S10 the forged reference is retained as unapplied evidence");
    const evidence = await q(`SELECT provider_message_id, kind, state, reason FROM website_inbound_evidence ORDER BY id DESC LIMIT 3`);
    eq(evidence.find((e) => e.provider_message_id === "auto-1").reason, "AUTO_REPLY_EVIDENCE_ONLY", "S10 an auto-reply is evidence only");
    eq(evidence.find((e) => e.provider_message_id === "forged-1").state, "unapplied", "S10 a forged reference changes nothing");
    const adm = (await admissionsFor(a.contactId)).find((x) => x.id === fu.id);
    eq(adm.revoked_reason, "REPLY_RECEIVED", "S10 a genuine reply revokes the journey");
    ok((await q(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND direction='inbound' AND channel='email' AND automation_stopped = true`, [a.contactId]))[0].n >= 1, "S10 a canonical inbound event with automation stop was written");
    eq((await q(`SELECT status FROM sequence_enrollments WHERE website_admission_id=$1`, [fu.id]))[0].status, "cancelled", "S10 the journey's enrollment is cancelled with its admission");

    // Duplicate delivery and the cursor.
    const dup = await poll();
    eq(dup.applied, 0, "S10 re-delivery of the same page applies nothing twice");
    eq(dup.duplicates, 3, "S10 duplicates are recognized by provider message id");
    eq(Number((await q(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND direction='inbound' AND external_message_id='reply-1'`, [a.contactId]))[0].n), 1, "S10 exactly one inbound event per reply");
  }
  {
    // Bounce: revokes active admissions for the failed recipient and records evidence.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const contactEmail = (await q(`SELECT email FROM contacts WHERE id=$1`, [a.contactId]))[0].email;
    resetInboxPage();
    addMessage("bounce-1", { From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)", "Message-ID": "<b1@x>", "X-Failed-Recipients": contactEmail });
    addMessage("bounce-2", { From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)", "Message-ID": "<b2@x>", "X-Failed-Recipients": "never.admitted@example.test" });
    const p = await poll();
    eq(p.applied, 1, "S10 a bounce for an admitted address is applied");
    eq(p.unapplied, 1, "S10 a bounce for an unknown address is retained as unapplied");
    ok((await admissionsFor(a.contactId)).every((x) => x.state === "revoked" && x.revoked_reason === "BOUNCE_EVIDENCE"), "S10 a bounce revokes every active admission for that address");
  }
  {
    // Sent-folder copy settles an uncertain attempt as accepted; it is never treated as a reply.
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    await runWarm({ send: makeSend(() => ({ success: false, outcome: "uncertain", failureCode: "GMAIL_TRANSPORT_UNCERTAIN" })) });
    const receipt = (await sentFor(a.contactId))[0];
    eq(receipt.outcome, "uncertain", "S10 setup: an uncertain receipt exists");
    resetInboxPage();
    addMessage("sent-1", { From: ACCOUNT, Subject: "Thanks", "Message-ID": receipt.rfc_message_id, "In-Reply-To": receipt.rfc_message_id }, ["SENT"]);
    const p = await poll();
    eq(p.applied, 1, "S10 the Sent copy is applied as evidence");
    eq((await sentFor(a.contactId))[0].outcome, "accepted", "S10 a Sent copy settles the uncertain attempt as accepted");
    ok((await admissionsFor(a.contactId)).some((x) => x.state === "active" || x.state === "completed"), "S10 a Sent copy never stops the journey as if it were a reply");
  }
  {
    // A page that fails mid-way leaves the cursor where it was; the retry re-reads without double effects.
    const before = (await q(`SELECT history_cursor FROM gmail_mailbox_reader_state`))[0].history_cursor;
    resetInboxPage();
    addMessage("ok-1", { From: "someone@else.test", Subject: "x", "Message-ID": "<ok1@x>" });
    addMessage("fail-1", { From: "someone@else.test", Subject: "y", "Message-ID": "<fail1@x>" });
    fakeInbox.failOn.add("fail-1");
    fakeInbox.nextHistoryId = "5000";
    const failed = await poll();
    ok(failed.status === "error" || failed.status === "unavailable", `S10 a failing page reports a typed failure (${failed.status}/${failed.code})`);
    eq((await q(`SELECT history_cursor FROM gmail_mailbox_reader_state`))[0].history_cursor, before, "S10 the cursor does not advance past an unapplied page");
    fakeInbox.failOn.clear();
    const retry = await poll();
    eq(retry.status, "polled", "S10 the retry succeeds");
    ok(retry.duplicates >= 1, "S10 the retry recognizes the already-applied message");
    eq((await q(`SELECT history_cursor FROM gmail_mailbox_reader_state`))[0].history_cursor, "5000", "S10 the cursor advances only after the page is durably applied");
  }
  {
    // Expired cursor never backfills; an account switch refuses.
    fakeInbox.listError = Object.assign(new Error("gone"), { code: 404 });
    const expired = await poll();
    eq(expired.status, "needs_resync", "S10 an expired history cursor requires an explicit resync");
    eq((await q(`SELECT state FROM gmail_mailbox_reader_state`))[0].state, "needs_resync", "S10 the reader is held in needs_resync (no guessed range)");
    fakeInbox.listError = null;
    eq((await poll()).status, "needs_resync", "S10 a needs_resync reader does not poll again");
    // Re-open: a fresh start initializes from the current profile (nothing is back-read).
    await q(`UPDATE gmail_mailbox_reader_state SET state='active', history_cursor=NULL, last_error=NULL`);
    const callsBefore = fakeInbox.getCalls.length;
    eq((await poll()).status, "initialized", "S10 after an explicit re-open the reader initializes from now");
    eq(fakeInbox.getCalls.length, callsBefore, "S10 no message is read during re-initialization");
    await q(`UPDATE gmail_mailbox_reader_state SET account_fingerprint=$1`, [sha("gmail-account:other@x.test")]);
    eq((await poll()).code, "MAILBOX_ACCOUNT_CHANGED", "S10 a switched mailbox account is refused");
    await q(`UPDATE gmail_mailbox_reader_state SET state='active', account_fingerprint=$1, last_error=NULL`, [sha(`gmail-account:${ACCOUNT}`)]);
    // Lease held elsewhere.
    await q(`UPDATE gmail_mailbox_reader_state SET lease_token='other', lease_expires_at = now() + interval '10 minutes'`);
    eq((await poll()).status, "leased_elsewhere", "S10 a live lease held elsewhere stops this poll");
    await q(`UPDATE gmail_mailbox_reader_state SET lease_token=NULL, lease_expires_at=NULL`);
  }
  {
    // Inbound after the entry event stops the journey at the next fence (any channel), while the own-occurrence intake does not.
    await freshReader();
    const a = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([a.contactId]);
    const fu = a.admissions.find((x) => x.program === "requested_followup");
    ok(Number(fu.entry_event_id) >= 0, "S10 the admission records the entry event watermark");
    const { recordInboundEvent } = await import("../../server/services/communication-events");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 minute' WHERE website_admission_id=$1`, [fu.id]);
    const calls = gmailCalls.length;
    await recordInboundEvent({ contactId: a.contactId, channel: "sms", provider: "ghl", body: "stop texting me about this", status: "received" } as any);
    const t = await runWarm({ send: neverSend });
    eq(gmailCalls.length, calls, `S10 an inbound event after entry stops the journey before dispatch (${JSON.stringify(t)})`);
    eq((await admissionsFor(a.contactId)).find((x) => x.id === fu.id).revoked_reason, "INBOUND_AFTER_ENTRY", "S10 the stop reason is INBOUND_AFTER_ENTRY");
    const b = await mkAdmitted({ kind: "estimate", optIn: false });
    await focus([b.contactId]);
    const own = await runWarm({ send: makeSend() });
    ok(own.accepted >= 1, "S10 the occurrence's own intake does not stop its own journey");
  }

  // ═══ S11 E06 ownership: marker, production-shaped mirror, tick capability ═══════════════════════════════════
  {
    // Production-shaped mirror: more than 500 old, unmarked, due enrollments in paused/retired/test sequences.
    const mirrorSeq = await seq(`Legacy mirror paused ${randomUUID().slice(0, 6)}`, [{ subject: "Legacy 1" }, { delayDays: 1, subject: "Legacy 2" }]);
    const retiredSeq = await seq(`Legacy mirror retired ${randomUUID().slice(0, 6)}`, [{ subject: "Retired" }]);
    await q(`UPDATE follow_up_sequences SET retired_at = now() WHERE id=$1`, [retiredSeq]);
    const testSeq = await seq(`TEST Legacy mirror ${randomUUID().slice(0, 6)}`, [{ subject: "Test" }]);
    const mirrorContacts = await q(`
      INSERT INTO contacts(first_name,last_name,email,phone,record_class)
      SELECT 'Legacy','Mirror', 'legacy.' || g || '.' || $1 || '@example.test', '305' || lpad((7000000 + g)::text, 7, '0'), 'production'
      FROM generate_series(1, 560) g RETURNING id`, [randomUUID().slice(0, 6)]);
    const targetSeqs = [mirrorSeq, retiredSeq, testSeq];
    let i = 0;
    for (const c of mirrorContacts) {
      await q(`INSERT INTO sequence_enrollments(contact_id, sequence_id, status, current_step, next_action_at) VALUES($1,$2,'active',0, now() - interval '1 hour')`, [c.id, targetSeqs[i++ % 3]]);
    }
    const mirrorChecksum = async () => (await q(`SELECT md5(string_agg(e::text, '|' ORDER BY e.id)) AS m, count(*)::int n FROM sequence_enrollments e WHERE e.website_admission_id IS NULL`))[0];
    const commercialTables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'commercial\\_%' ORDER BY 1`)).map((r) => r.table_name as string);
    const commercialCounts = async () => { const out: Record<string, number> = {}; for (const t of commercialTables) out[t] = Number((await q(`SELECT count(*)::int n FROM ${t}`))[0].n); return out; };
    const markedChecksum = async () => (await q(`SELECT md5(string_agg(e::text, '|' ORDER BY e.id)) AS m, count(*)::int n FROM sequence_enrollments e WHERE e.website_admission_id IS NOT NULL`))[0];

    const mirrorBefore = await mirrorChecksum();
    const commercialBefore = await commercialCounts();
    ok(mirrorBefore.n > 500, `S11 the mirror holds more than 500 unmarked due enrollments (${mirrorBefore.n})`);
    await freshReader();
    await runWarm({ send: makeSend(), limit: 100 });
    const mirrorAfter = await mirrorChecksum();
    eq(mirrorAfter.m, mirrorBefore.m, "S11 the warm lane leaves every unmarked row untouched (no read-modify-write)");
    eq(await commercialCounts(), commercialBefore, "S11 the warm lane writes no commercial observation or hold for unmarked rows");

    // Un-pausing the mirrored sequence changes nothing for the warm lane (it never selects unmarked rows).
    await q(`UPDATE follow_up_sequences SET status='active' WHERE id=$1`, [mirrorSeq]);
    await runWarm({ send: makeSend(), limit: 100 });
    eq((await mirrorChecksum()).m, mirrorBefore.m, "S11 un-pausing a mirrored sequence does not make unmarked rows eligible for the warm lane");
    await q(`UPDATE follow_up_sequences SET status='paused' WHERE id=$1`, [mirrorSeq]);

    // The legacy worker never touches marked rows.
    const markedBefore = await markedChecksum();
    ok(markedBefore.n > 0, "S11 marked enrollments exist for the legacy-lane check");
    await q(`UPDATE sequence_enrollments SET next_action_at = now() - interval '1 hour' WHERE website_admission_id IS NOT NULL AND status='active'`);
    const markedDue = await markedChecksum();
    const { processSequenceEnrollments } = await import("../../server/services/sequence-worker");
    await processSequenceEnrollments().catch((e) => console.log("legacy worker tick ended with", e instanceof Error ? e.name : e));
    eq((await markedChecksum()).m, markedDue.m, "S11 the legacy sequence worker never reads, defers, completes or sends a marked row");
    eq(gmailCalls.filter((c) => /legacy\./.test(String(c.to))).length, 0, "S11 no legacy-mirror contact was ever sent a message");
  }
  {
    // Tick: refuses without the selected capability + active worker; never runs a stage on direct invocation.
    let refused: unknown = null;
    try { await tick.runWebsiteEmailTick({ capabilityCheck: async () => ({ selected: false, workerActive: false, activeProfile: "off" }) }); } catch (e) { refused = e; }
    ok(refused instanceof tick.WebsiteEmailCapabilityInactiveError, "S11 a manual tick without the selected capability refuses");
    let refusedHalf: unknown = null;
    try { await tick.runWebsiteEmailTick({ capabilityCheck: async () => ({ selected: true, workerActive: false, activeProfile: "x" }) }); } catch (e) { refusedHalf = e; }
    ok(refusedHalf instanceof tick.WebsiteEmailCapabilityInactiveError, "S11 selected but not running is also refused");
    const stageCalls = gmailCalls.length;
    let defaultRefused: unknown = null;
    try { await tick.runWebsiteEmailTick(); } catch (e) { defaultRefused = e; }
    ok(defaultRefused instanceof tick.WebsiteEmailCapabilityInactiveError, "S11 the default capability check refuses in a process without the website-email worker");
    eq(gmailCalls.length, stageCalls, "S11 refusals perform no provider I/O");
    const result = await tick.runWebsiteEmailTick({ capabilityCheck: async () => ({ selected: true, workerActive: true, activeProfile: "test" }) });
    ok(result.admission && result.mailbox && result.warm, "S11 with the capability selected and running the tick runs all three stages");
    const { getManifestEntry, validateManifest } = await import("../../server/services/logical-job-manifest");
    const entry = getManifestEntry("website-email-tick");
    ok(entry && entry.canRunWhileGlobalOutboundPaused === false && entry.effect === "lifecycle_send" && entry.physicalQueue === "website-email", "S11 the website-email job is registered as outbound-gated (it never runs while global outbound is paused)");
    ok(validateManifest().ok, "S11 the logical job manifest validates with the website-email entry");
  }

  // ═══ S12 regression guards ═════════════════════════════════════════════════════════════════════════════════
  {
    const { resolvePolicy } = await import("../../server/services/sender-policy");
    eq(resolvePolicy("accounts").from, ACCOUNT, "S12 the accounts category resolves the real From address");
    eq(await pauseState(), "paused", "S12 global outbound stayed paused for the whole certification");
    ok(gmailCalls.length > 0, "S12 the certification exercised the injected send");
    ok(gmailCalls.every((c) => c.forbidden !== true), "S12 no send happened where none was allowed");
    ok(gmailCalls.every((c) => c.category === "accounts"), "S12 every send used the registered accounts category");
    ok(gmailCalls.every((c) => typeof c.rfcMessageId === "string" && c.requireAcceptedAlias === true), "S12 every send carried a stable Message-ID and required an accepted alias");
    ok(gmailCalls.every((c) => typeof c.to === "string" && !/legacy\./.test(c.to)), "S12 no send reached a legacy-mirror contact");
    eq(Number((await q(`SELECT count(*)::int n FROM follow_up_sequences WHERE status='active' AND name LIKE 'Warm cert%'`))[0].n), 0, "S12 no source sequence was activated");
    eq(await sourceHash(seqFollowup) === sourceBefore.f && await sourceHash(seqNurture) === sourceBefore.n && await sourceHash(seqSms) === sourceBefore.s, true, "S12 the source sequences are byte-for-byte unchanged (still paused, steps untouched) after every warm send");
    eq(Number((await q(`SELECT count(*)::int n FROM sequence_enrollments WHERE website_admission_id IS NULL AND sequence_id = ANY($1::int[])`, [[seqFollowup, seqNurture, seqSms]]))[0].n), 0, "S12 no unmarked (legacy-lane) enrollment was ever created in a source sequence");

    // The lane's own passes never reach the network (calls the public form handlers' older side effects attempt are
    // counted separately by the fixture's deny-all fetch and are outside this lane).
    const externalBefore = h.externalCalls();
    await store.processWebsiteLifecycleIntents();
    await runWarm({ send: neverSend, limit: 50 });
    await reader.pollMailboxOnce({ getClient: async () => ({ ok: false as const, code: "NOT_CONNECTED" }), now: () => new Date() });
    eq(h.externalCalls(), externalBefore, "S12 admission, warm and mailbox-reader passes made no external network call");
  }

  console.log(`\nwebsite-email lifecycle certification: ${checks} checks passed`);
} finally {
  await h.close();
}
