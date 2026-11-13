/**
 * Phase 6 / R02: the launch inventory aggregate reads its whole population in set queries instead of per-recipient
 * correlated reads and per-contact policy reads. This suite proves the set form is the same answer as the per-row form:
 *   1. recorded-facts read: every column of every row identical between "per_row" and "set" on real prepared recipients;
 *   2. relationship evidence: the two uniqueness substitutes give the same reasons as the default scans, and both a unique
 *      and a duplicated value occur (so equality is not trivially "always false");
 *   3. contact policy: decisions through the snapshot equal the per-contact decisions across every blocking dimension,
 *      the snapshot issues a fixed handful of set reads, and per-contact reads per recipient stay small;
 *   4. the whole aggregate with the snapshot equals the aggregate without it;
 *   5. a mutation boundary (no snapshot active) still reads per contact, and the snapshot is scoped to its own async flow.
 * Runs only against disposable infrastructure; provider egress is denied.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "phase 6 launch inventory set-read parity" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { db, pool } = await import("../server/db");
const { prepareCanonicalRecipient } = await import("../server/services/canonical-recipient-preparation");
const { hashEmailToken, evaluateMarketingEmailEligibility } = await import("../server/services/provider-readiness-control");
const { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } = await import("../server/services/contact-business-system-links");
const inventory = await import("../server/services/sfp-launch-inventory");
const snapshots = await import("../server/services/contact-policy-read-snapshot");
const { evaluateContactDecisions } = await import("../server/services/contactability");
const { relationshipReasonsSql } = await import("../shared/relationship-evidence-sql");

const prefix = `p6_setreads_${randomUUID().replaceAll("-", "")}`;
const actor = { role: "admin" as const, actorId: `system:${prefix}`, email: null };
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const same = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const dialect = new PgDialect();

/** A prepared-eligible fixture: real business, Maps source link, reviewed relationship writer, optional fresh validation. */
async function recipient(validated: boolean) {
  const label = randomUUID().replaceAll("-", "");
  const place = `${prefix}_${label}_place`;
  const business = (await pool.query(`INSERT INTO businesses
    (canonical_name,normalized_name,record_class,google_place_id,vertical,city,state,postal_code)
    VALUES($1,$2,'canonical',$3,'Automotive','Miami','FL','33130') RETURNING *`,
  [`${prefix} ${label}`, `${prefix}${label}`, place])).rows[0];
  await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key)
    VALUES($1,'google_maps','place',$2)`, [business.id, place]);
  const contact = (await pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name,record_class)
    VALUES('Canonical','Fixture',$1,'',$2,'production') RETURNING id`,
  [`${prefix.slice(0, 30)}.${label.slice(0, 24)}@gmail.com`, `${business.canonical_name} LLC`])).rows[0];
  await pool.query(`INSERT INTO contact_source_events
    (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
    VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4::jsonb)`,
  [contact.id, `${prefix}_${label}_event`, actor.actorId, JSON.stringify({ place_id: business.google_place_id })]);
  const preview = await previewContactBusinessSystemLinks({ afterContactId: Number(contact.id) - 1, limit: 1 });
  const candidate = preview.rows[0];
  check(candidate?.eligible, "stable Maps evidence supports the affiliation");
  const outcome = await applyContactBusinessSystemLink({
    contactId: Number(contact.id), businessId: Number(business.id),
    sourceLinkId: candidate.sourceLinkId!, sourceEntityId: candidate.sourceEntityId, snapshotHash: candidate.snapshotHash,
  });
  check(outcome.status === "applied", "the real reviewed writer applies the link");
  if (validated) {
    const email = (await pool.query("SELECT email FROM contacts WHERE id=$1", [contact.id])).rows[0].email as string;
    const opId = randomUUID(); const tokenHash = hashEmailToken(email);
    await pool.query(`INSERT INTO provider_operations (id,provider,operation_type,purpose,idempotency_key,actor_type,target_fingerprint,state)
      VALUES($1,'zerobounce','email_validation','certification',$2,'system',$3,'completed')`, [opId, `${prefix}-${opId}`, `business:${business.id}`]);
    await pool.query(`INSERT INTO provider_observations
      (provider,operation_id,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at,expires_at)
      VALUES('zerobounce',$1,'contact',$2,$3,0,'valid',false,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '29 days')`, [opId, contact.id, tokenHash]);
    await pool.query(`UPDATE contacts SET email_status='valid',email_token_hash=$2,email_validation_updated_at=NOW() WHERE id=$1`,
      [contact.id, tokenHash]);
  }
  return { contactId: Number(contact.id), businessId: Number(business.id) };
}

/** Counts every statement the application pool sends while `run` executes. */
async function countQueries<T>(run: () => Promise<T>): Promise<{ value: T; queries: number }> {
  const original = pool.query.bind(pool);
  let queries = 0;
  (pool as any).query = (...args: any[]) => { queries++; return (original as any)(...args); };
  try { return { value: await run(), queries }; } finally { (pool as any).query = original; }
}

try {
  // ───────────────────────────── Fixtures: real prepared recipients ─────────────────────────────
  const programId = randomUUID();
  await pool.query(`INSERT INTO sfp_programs (id,name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
    VALUES($1,$2,ARRAY['12086'],ARRAY['Automotive'],2,TRUE,$3)`, [programId, prefix, actor.actorId]);
  const sequenceId = Number((await pool.query(`INSERT INTO follow_up_sequences (name,status,trigger_type,trigger_config)
    VALUES($1,'paused','contact_created',$2::jsonb) RETURNING id`,
  [prefix, JSON.stringify({ canonicalProgramId: programId, canonicalVerticals: ["Automotive"] })])).rows[0].id);
  await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,delay_hours,subject,body)
    VALUES($1,1,'email',0,0,'Fixture subject','Hello, fixture body')`, [sequenceId]);
  await pool.query("UPDATE follow_up_sequences SET total_steps=1 WHERE id=$1", [sequenceId]);

  const made: Array<{ contactId: number; businessId: number; intentId: string; validated: boolean }> = [];
  for (const validated of [true, true, true, false, true, true, true, true, false, true]) {
    const f = await recipient(validated);
    const prepared = await prepareCanonicalRecipient({ contactId: f.contactId, sequenceId, programId, actor, source: prefix });
    check(prepared.intentId, "recipient prepared");
    made.push({ ...f, intentId: String(prepared.intentId), validated });
  }
  const states = (await pool.query("SELECT preparation_state, count(*)::int n FROM cr04_enrollment_intents WHERE program_id=$1 GROUP BY 1", [programId])).rows;
  check(states.some(r => r.preparation_state === "ready_held") && states.some(r => r.preparation_state === "pending_validation"),
    `both populations exist: ${JSON.stringify(states)}`);

  // ───────────────────────────── 1. Recorded-facts read parity ─────────────────────────────
  const recorded = async (mode: "per_row" | "set", ids?: string[]) =>
    ((await db.execute(inventory.buildRecordedLaunchQuery(180, ids, mode))) as any).rows as any[];
  const byId = (rows: any[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const perRow = byId(await recorded("per_row"));
  const setRead = byId(await recorded("set"));
  const mine = (rows: any[]) => rows.filter(r => made.some(m => m.intentId === r.id));
  check(mine(perRow).length === made.length, "every fixture recipient is read");
  same(setRead, perRow, "every column of every row is identical between the per-row and the set read");
  check(mine(perRow).some(r => r.facts_ok === true), "the comparison includes rows whose prepared facts are current");
  const subset = made.slice(0, 3).map(m => m.intentId);
  same(byId(await recorded("set", subset)), byId(await recorded("per_row", subset)), "a filtered set read equals the filtered per-row read");
  // A changed business fact flips facts_ok identically in both forms.
  await pool.query("UPDATE businesses SET street_address='1 Changed Way' WHERE id=$1", [made[0].businessId]);
  const perRowChanged = byId(await recorded("per_row"));
  same(byId(await recorded("set")), perRowChanged, "after a business fact changes, both forms still agree");
  check(perRowChanged.find(r => r.id === made[0].intentId)!.facts_ok === false && perRow.find(r => r.id === made[0].intentId)!.facts_ok === true,
    "the change is observed (facts current before, stale after)");

  // ───────────────────────────── 2. Relationship evidence: uniqueness substitutes ─────────────────────────────
  const cteText = dialect.sqlToQuery(inventory.launchSetReadCtes()).sql;
  async function registryFixture(label: string, opts: { phone?: string; domain?: string }) {
    const name = `${prefix}-${label}`;
    const b = (await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,state,vertical,main_phone,website_domain)
      VALUES($1,$1,'canonical','FL','Gym',$2,$3) RETURNING id`, [name, opts.phone ?? null, opts.domain ?? null])).rows[0];
    const e = (await pool.query(`INSERT INTO sunbiz_entities (filing_number,entity_name,source,principal_address,principal_city,principal_state,phone,website)
      VALUES($1,$2,'sunbiz','900 Registry Row','Hialeah','FL',$3,$4) RETURNING id`,
    [name, name, opts.phone ?? null, opts.domain ? `https://www.${opts.domain}/` : null])).rows[0];
    const sl = (await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key)
      VALUES($1,'sunbiz','sunbiz_entity',$2) RETURNING id`, [b.id, name])).rows[0];
    const c = (await pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,website,company_name,record_class,address,city,state)
      VALUES('Reg','Person',$1,$2,$3,$4,'production','1 Other Street','Doral','FL') RETURNING id`,
    [`${label}@gmail.com`, opts.phone ?? '', opts.domain ? `https://${opts.domain}` : null, name])).rows[0];
    return { contactId: Number(c.id), businessId: Number(b.id), sourceId: sl.id as string, entityId: Number(e.id) };
  }
  const unit = randomUUID().replaceAll("-", "").slice(0, 7);
  const phoneUnique = await registryFixture("phone-unique", { phone: `305-555-${String(Math.floor(Math.random() * 9000) + 1000)}` });
  const dupPhone = `786-555-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const phoneDup = await registryFixture("phone-dup", { phone: dupPhone });
  await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,state,vertical,main_phone)
    VALUES($1,$1,'canonical','FL','Gym',$2)`, [`${prefix}-phone-twin`, dupPhone.replace(/-/g, "")]); // formatted differently, same digits
  const domainUnique = await registryFixture("domain-unique", { domain: `uniq-${unit}.example.com` });
  const dupDomain = `dup-${unit}.example.com`;
  const domainDup = await registryFixture("domain-dup", { domain: dupDomain });
  await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,state,vertical,website_domain)
    VALUES($1,$1,'canonical','FL','Gym',$2)`, [`${prefix}-domain-twin`, `WWW.${dupDomain.toUpperCase()}`]); // same identity domain
  const nonCanonicalTwinPhone = `954-555-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const phoneNonCanonicalTwin = await registryFixture("phone-noncanonical-twin", { phone: nonCanonicalTwinPhone });
  await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,state,vertical,main_phone)
    VALUES($1,$1,'test','FL','Gym',$2)`, [`${prefix}-phone-test-twin`, nonCanonicalTwinPhone]); // not canonical: must not count

  const options = inventory.SET_READ_FACTS_OPTIONS.relationship!;
  const outcomes = new Map<string, string[]>();
  for (const [label, f] of Object.entries({ phoneUnique, phoneDup, domainUnique, domainDup, phoneNonCanonicalTwin })) {
    const row = (await pool.query(`WITH ${cteText} SELECT
      ${relationshipReasonsSql("$1", "$2", "$3", "$4")} AS plain,
      ${relationshipReasonsSql("$1", "$2", "$3", "$4", options)} AS substituted`,
    [f.contactId, f.businessId, f.sourceId, f.entityId])).rows[0];
    same([...row.substituted].sort(), [...row.plain].sort(), `${label}: substituted reasons equal the default scan`);
    outcomes.set(label, [...row.plain].sort());
  }
  const corroborated = (label: string) => !outcomes.get(label)!.includes("independent_corroboration_required");
  check(corroborated("phoneUnique") && !corroborated("phoneDup"), "a unique phone corroborates and a duplicated formatted phone does not");
  check(corroborated("domainUnique") && !corroborated("domainDup"), "a unique domain corroborates and a duplicated normalized domain does not");
  check(corroborated("phoneNonCanonicalTwin"), "a non-canonical twin does not make a phone ambiguous (same as the default scan)");

  // ───────────────────────────── 3. Contact policy through the snapshot ─────────────────────────────
  const [baseline, dnc, optedOut, dbprLead, customer, withdrawn, fenced, dbprLinked, unvalidated, pewc] = made;
  await pool.query("UPDATE businesses SET street_address=NULL WHERE id=$1", [made[0].businessId]); // restore irrelevant change
  await pool.query("UPDATE contacts SET do_not_contact=TRUE WHERE id=$1", [dnc.contactId]);
  await pool.query("UPDATE contacts SET opted_out_email=TRUE WHERE id=$1", [optedOut.contactId]);
  await pool.query("UPDATE contacts SET lead_source='dbpr_hr' WHERE id=$1", [dbprLead.contactId]);
  await pool.query("UPDATE businesses SET status='customer' WHERE id=$1", [customer.businessId]);
  const subjectId = Number((await pool.query(`INSERT INTO consent_subjects (subject_type,subject_record_id,canonical_key)
    VALUES('contact',$1,$2) RETURNING id`, [withdrawn.contactId, `${prefix}:contact:${withdrawn.contactId}`])).rows[0].id);
  await pool.query(`INSERT INTO consent_subject_channel_states (subject_id,channel,purpose,permission_state)
    VALUES($1,'email','outreach','withdrawn')`, [subjectId]);
  const spare = await recipient(false);
  await pool.query(`INSERT INTO contact_merge_operations
    (idempotency_key,survivor_contact_id,deprecated_contact_id,status,actor_id,actor_role,manifest_version,normalization_version,preview_hash)
    VALUES($1,$2,$3,'committed',$4,'admin',1,1,'hash')`, [randomUUID(), fenced.contactId, spare.contactId, actor.actorId]);
  await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key)
    VALUES($1,'dbpr_abt','license',$2)`, [dbprLinked.businessId, `${prefix}-dbpr`]);
  await pool.query(`INSERT INTO consent_audit_logs (contact_id,channel,action,consented,consent_type,disclosure_version)
    VALUES($1,'sms','consent_granted',TRUE,'express_written','v1')`, [pewc.contactId]);
  await pool.query("DELETE FROM provider_observations WHERE subject_id=$1", [String(unvalidated.contactId)]);
  await pool.query("UPDATE contacts SET email_status='unvalidated' WHERE id=$1", [unvalidated.contactId]);

  const scenarios = [...made.map(m => ({ contactId: m.contactId, businessId: m.businessId })),
    { contactId: 2_000_000_000, businessId: null }, // a contact that does not exist: the snapshot cannot answer, the database does
  ];
  const decide = (s: { contactId: number; businessId: number | null }) =>
    evaluateContactDecisions({ contactId: s.contactId, businessId: s.businessId, channel: "email", mode: "dryRun" });
  const plainResults = [];
  for (const s of scenarios) plainResults.push({ decisions: await decide(s), eligibility: await evaluateMarketingEmailEligibility(s.contactId) });

  const loaded = await countQueries(() => snapshots.loadContactPolicySnapshot(scenarios));
  check(loaded.queries <= 12, `the snapshot is a fixed handful of set reads, not per contact (${loaded.queries})`);
  const snapshot = loaded.value;
  const throughSnapshot = await countQueries(async () => snapshots.withContactPolicySnapshot(snapshot, async () => {
    const out = [];
    for (const s of scenarios) out.push({ decisions: await decide(s), eligibility: await evaluateMarketingEmailEligibility(s.contactId) });
    return out;
  }));
  scenarios.forEach((s, index) => {
    same(throughSnapshot.value[index].decisions, plainResults[index].decisions, `contact ${index}: decisions equal through the snapshot`);
    same(throughSnapshot.value[index].eligibility, plainResults[index].eligibility, `contact ${index}: marketing eligibility equal through the snapshot`);
  });
  const codes = new Set(plainResults.map(r => JSON.stringify([r.decisions.dataHygiene.status, r.decisions.promotion.status,
    r.decisions.send?.status, r.decisions.send && "reasonCodes" in r.decisions.send ? r.decisions.send.reasonCodes : null])));
  check(codes.size >= 5, `the scenarios produce several distinct outcomes (${codes.size}), not one repeated answer`);
  check(plainResults.some(r => r.decisions.send?.status === "eligible"), "at least one contact is send-eligible");
  check(plainResults.some(r => r.decisions.dataHygiene.status !== "eligible"), "at least one contact fails hygiene");
  check(plainResults.some(r => r.decisions.promotion.status !== "eligible"), "at least one contact fails promotion");
  check(plainResults.some(r => r.decisions.send && r.decisions.send.status !== "eligible"), "at least one contact fails send readiness");

  const plainCount = await countQueries(async () => { for (const s of scenarios.slice(0, 5)) await decide(s); });
  const perContactPlain = plainCount.queries / 5;
  const perContactSnapshot = throughSnapshot.queries / scenarios.length;
  check(perContactPlain >= 8, `without the snapshot each contact still costs many reads (${perContactPlain})`);
  console.log(`policy reads: snapshot load ${loaded.queries} statements; per contact ${perContactPlain.toFixed(1)} plain vs ${perContactSnapshot.toFixed(1)} through the snapshot`);
  check(perContactSnapshot <= 5, `through the snapshot each contact costs only the provider-observation reads (${perContactSnapshot})`);

  // ───────────────────────────── 5. Scope: no snapshot outside the aggregate flow ─────────────────────────────
  check(snapshots.currentContactPolicySnapshot() === undefined, "no snapshot is active outside the aggregate read");
  const concurrent = await snapshots.withContactPolicySnapshot(snapshot, async () => {
    const inside = snapshots.currentContactPolicySnapshot();
    const detached = await new Promise<ReturnType<typeof snapshots.currentContactPolicySnapshot>>(resolve =>
      setImmediate(() => resolve(snapshots.currentContactPolicySnapshot())));
    return { inside, detached };
  });
  check(concurrent.inside === snapshot && concurrent.detached === snapshot, "work started inside the flow sees its snapshot");
  check(snapshots.currentContactPolicySnapshot() === undefined, "the snapshot ends with the flow");
  // A stale snapshot never serves an enforcement-mode check: an opt-out written after loading is seen at once.
  await pool.query("UPDATE contacts SET do_not_contact=TRUE WHERE id=$1", [baseline.contactId]);
  const enforcement = await snapshots.withContactPolicySnapshot(snapshot, () =>
    evaluateContactDecisions({ contactId: baseline.contactId, businessId: baseline.businessId, channel: "email", mode: "enforcement" }));
  check(enforcement.dataHygiene.status !== "eligible" || (enforcement.send && enforcement.send.status !== "eligible"),
    "an enforcement-mode check ignores the snapshot and sees the later opt-out");
  await pool.query("UPDATE contacts SET do_not_contact=FALSE WHERE id=$1", [baseline.contactId]);

  // ───────────────────────────── 4. The whole aggregate, with and without the snapshot ─────────────────────────────
  const newContext = () => ({
    isExpired: () => false, onBackend: () => undefined, memo: new Map(),
    phases: { current: "policy_read", recordedMs: null, recordedRows: null, policyMs: null, policyTotal: 0, policyEvaluated: 0, policyReused: 0, senderMs: null },
  }) as any;
  const strip = (value: any) => { const { observedAt, ...rest } = value; void observedAt; return rest; };
  const withoutSnapshot = strip(await inventory.computeSfpLaunchInventory());
  const ctx = newContext();
  const withSnapshot = await countQueries(() => inventory.computeSfpLaunchInventory(ctx));
  same(strip(withSnapshot.value), withoutSnapshot, "the aggregate with the snapshot equals the aggregate without it");
  check(ctx.phases.policyEvaluated > 0 && ctx.phases.recordedRows >= made.length, "the aggregate evaluated the fixture population");
  const again = newContext(); again.memo = ctx.memo;
  same(strip(await inventory.computeSfpLaunchInventory(again)), withoutSnapshot, "a repeat that reuses the memo still equals the plain answer");
  check(again.phases.policyReused > 0 && again.phases.policyEvaluated === 0, "memoized answers are reused, not recomputed");

  check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt was made");
  console.log(`phase6 inventory set reads: ok (${checks} checks)`);
} finally {
  await pool.end().catch(() => undefined);
}
process.exit(0);
