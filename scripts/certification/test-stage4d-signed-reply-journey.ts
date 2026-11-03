/**
 * Stage 4D signed reply / STOP / bounce journey through BOTH real webhook entrances over real HTTP.
 *
 * The generic entrance (POST /api/webhooks/ghl, server/routes/integrations.ts) and the specialized entrances
 * (POST /api/webhooks/ghl/message-received and /email-bounce, server/routes/sdr.ts) are mounted exactly as production
 * registers them, with Ed25519 verification enabled by a fixture key pair. Nothing leaves the process and nothing is sent.
 *
 *   specialized-only reply, generic-only reply, replay of identical signed bytes, stale-timestamp replay, bad signature,
 *   a reply that arrives through both entrances in either order and concurrently, STOP through each entrance, a bounce,
 *   and a REAL failed commit (database trigger raises inside the effect transaction) followed by a retry of the same
 *   signed bytes. Each journey ends in exactly one canonical event.
 */
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY = publicKey;
delete process.env.GHL_WEBHOOK_PUBLIC_KEY;

const h = await stage3BHttpFixture(async app => {
  const { registerIntegrationsRoutes } = await import("../../server/routes/integrations");
  const { registerSdrRoutes } = await import("../../server/routes/sdr");
  registerIntegrationsRoutes(app);
  registerSdrRoutes(app);
}, undefined, { backgroundProfile: "off" });

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [SR-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = randomUUID().replaceAll("-", "").slice(0, 8);
let n = 0;

async function contact(label: string) {
  n++;
  const ghl = `sr-${label}-${tag}`;
  const id = Number((await h.pool.query(
    `INSERT INTO contacts(first_name,last_name,email,phone,ghl_contact_id,record_class,lead_source,status,email_status)
     VALUES('Sr',$1,$2,$3,$4,'production','inbound','Active','valid') RETURNING id`,
    [label, `sr.${label}.${tag}@example.test`, `+1305${String(8100000 + n * 7).padStart(7, "0")}`, ghl])).rows[0].id);
  return { id, ghl };
}
const sign = (raw: string) => crypto.sign(null, Buffer.from(raw, "utf8"), privateKey).toString("base64");
async function post(path: string, body: Record<string, unknown>, opts: { raw?: string; signature?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const response = await fetch(h.base + path, { method: "POST", headers: { "Content-Type": "application/json", "x-ghl-signature": opts.signature ?? sign(raw) }, body: raw });
  let json: any = null; try { json = await response.json(); } catch { json = null; }
  return { status: response.status, body: json, raw };
}
const SPECIAL = "/api/webhooks/ghl/message-received";
const GENERIC = "/api/webhooks/ghl";
const inboundEvents = async (id: number, messageId?: string) => Number((await h.pool.query(
  `SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND direction='inbound'${messageId ? " AND ghl_message_id=$2" : ""}`, messageId ? [id, messageId] : [id])).rows[0].n);
const receipts = async (id: number, channel = "communication_event") => Number((await h.pool.query(
  `SELECT count(*)::int n FROM followup_effect_receipts WHERE owner_kind='ghl_inbound_message' AND owner_id LIKE $1 AND channel=$2`, [`${id}:%`, channel])).rows[0].n);
const reply = (c: { ghl: string }, messageId: string, extra: Record<string, unknown> = {}) =>
  ({ type: "SMS", direction: "inbound", contactId: c.ghl, messageId, body: "Yes, call me tomorrow", ...extra });
const optOutState = async (id: number, channel: string) => (await h.pool.query(
  `SELECT s.permission_state FROM consent_subject_channel_states s JOIN consent_subjects j ON j.id=s.subject_id
    WHERE j.subject_type='contact' AND j.subject_record_id=$1 AND s.channel=$2 AND s.purpose='outreach'`, [id, channel])).rows.map((r: any) => r.permission_state as string);

try {
  // 1. Signature gate on both entrances: nothing is written for a bad or missing signature.
  {
    const c = await contact("badsig");
    const body = reply(c, `m-badsig-${tag}`);
    for (const path of [SPECIAL, GENERIC]) {
      const wrong = await post(path, body, { signature: sign("different bytes") });
      check(wrong.status === 401, `${path}: a wrong signature is refused with 401`);
    }
    // The specialized entrance always requires a signature. The generic entrance refuses a missing one only when
    // NODE_ENV=production (source-defined, integrations.ts); this non-production fixture does not exercise that branch.
    const missing = await fetch(h.base + SPECIAL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    check(missing.status === 401, `${SPECIAL}: a missing signature is refused with 401`);
    check(await inboundEvents(c.id) === 0, "negative control: refused deliveries wrote no canonical event");
    const stale = await post(SPECIAL, { ...body, dateAdded: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    check(stale.status === 401 && await inboundEvents(c.id) === 0, "a correctly signed but 10-minute-old specialized delivery is refused as a replay and writes nothing");
  }

  // 2. Specialized-only reply, then identical signed bytes again.
  const a = await contact("spec");
  const aMsg = `m-spec-${tag}`;
  {
    const first = await post(SPECIAL, reply(a, aMsg));
    check(first.status === 200 && await inboundEvents(a.id, aMsg) === 1 && await receipts(a.id) === 1, "specialized-only reply: one 200, exactly one canonical inbound event and one receipt");
    const again = await post(SPECIAL, reply(a, aMsg), { raw: first.raw });
    check(again.status === 200 && await inboundEvents(a.id, aMsg) === 1 && await receipts(a.id) === 1, "replaying the identical signed specialized bytes adds no event and no receipt");
    // Same message through the OTHER entrance afterwards.
    const alias = await post(GENERIC, reply(a, aMsg));
    check(alias.status === 200 && await inboundEvents(a.id, aMsg) === 1 && await receipts(a.id) === 1, "the same message arriving later through the generic entrance still leaves exactly one event and one receipt");
  }

  // 3. Generic-only reply, then the specialized alias.
  const g = await contact("gen");
  const gMsg = `m-gen-${tag}`;
  {
    const first = await post(GENERIC, reply(g, gMsg, { type: "InboundMessage", messageType: "SMS" }));
    check(first.status === 200 && await inboundEvents(g.id, gMsg) === 1 && await receipts(g.id) === 1, "generic-only reply: one 200, exactly one canonical inbound event and one receipt");
    const again = await post(GENERIC, reply(g, gMsg, { type: "InboundMessage", messageType: "SMS" }), { raw: first.raw });
    check(again.status === 200 && await inboundEvents(g.id, gMsg) === 1, "replaying the identical signed generic bytes adds no event");
    const alias = await post(SPECIAL, reply(g, gMsg));
    check(alias.status === 200 && await inboundEvents(g.id, gMsg) === 1 && await receipts(g.id) === 1, "the same message arriving later through the specialized entrance still leaves exactly one event and one receipt");
  }

  // 4. Both entrances concurrently, several message ids.
  {
    const c = await contact("race");
    const ids = [1, 2, 3, 4].map(i => `m-race-${i}-${tag}`);
    const results = await Promise.all(ids.flatMap(id => [post(SPECIAL, reply(c, id)), post(GENERIC, reply(c, id, { type: "InboundMessage", messageType: "SMS" }))]));
    check(results.every(r => r.status === 200), "eight concurrent deliveries (four messages through both entrances) are all acknowledged");
    const perMessage = await Promise.all(ids.map(id => inboundEvents(c.id, id)));
    check(perMessage.every(x => x === 1) && await inboundEvents(c.id) === 4, `each message produced exactly one event (${perMessage.join(",")}); four events in total, not eight`);
    check(await receipts(c.id) === 4, "and exactly four receipts");
  }

  // 5. STOP through each entrance: consent withdrawn once, a single canonical event, and replay is inert.
  for (const [label, path, extra] of [["stopspec", SPECIAL, {}], ["stopgen", GENERIC, { type: "InboundMessage", messageType: "SMS" }]] as const) {
    const c = await contact(label);
    const msg = `m-${label}-${tag}`;
    const first = await post(path, reply(c, msg, { ...extra, body: "STOP" }));
    const states = await optOutState(c.id, "sms");
    check(first.status === 200 && states.length === 1 && /opt|withdraw|revoked|denied|suppress/i.test(states[0]), `${label}: STOP is acknowledged and SMS consent is withdrawn (${states.join(",") || "none"})`);
    const events = await inboundEvents(c.id, msg);
    const again = await post(path, reply(c, msg, { ...extra, body: "STOP" }), { raw: first.raw });
    check(again.status === 200 && await inboundEvents(c.id, msg) === events && events === 1 && (await optOutState(c.id, "sms")).length === 1, `${label}: replaying the STOP changes nothing (one event, one consent state)`);
    const other = await post(path === SPECIAL ? GENERIC : SPECIAL, reply(c, msg, { ...(path === SPECIAL ? { type: "InboundMessage", messageType: "SMS" } : {}), body: "STOP" }));
    check(other.status === 200 && await inboundEvents(c.id, msg) === 1, `${label}: the same STOP through the other entrance still leaves one canonical event`);
  }
  {
    const c = await contact("ordinary");
    await post(SPECIAL, reply(c, `m-ordinary-${tag}`));
    check((await optOutState(c.id, "sms")).length === 0, "negative control: an ordinary reply creates no opt-out state");
  }

  // 6. Bounce through the specialized entrance.
  {
    const c = await contact("bounce");
    const msg = `m-bounce-${tag}`;
    const body = { contactId: c.ghl, email: `sr.bounce.${tag}@example.test`, messageId: msg, status: "bounced" };
    const first = await post("/api/webhooks/ghl/email-bounce", body);
    const emailStatus = () => h.pool.query(`SELECT email_status FROM contacts WHERE id=$1`, [c.id]).then(r => r.rows[0].email_status as string);
    const bounceEvents = () => h.pool.query(`SELECT count(*)::int n FROM communication_events WHERE contact_id=$1 AND status='bounced' AND ghl_message_id=$2`, [c.id, msg]).then(r => Number(r.rows[0].n));
    check(first.status === 200 && await emailStatus() === "bounced" && await bounceEvents() === 1, "a signed bounce marks the email bounced and records exactly one canonical bounce event");
    const again = await post("/api/webhooks/ghl/email-bounce", body, { raw: first.raw });
    check(again.status === 200 && await bounceEvents() === 1 && await emailStatus() === "bounced", "replaying the identical signed bounce adds no second bounce event");
    const fresh = await post("/api/webhooks/ghl/email-bounce", { ...body, dateAdded: new Date().toISOString() });
    check(fresh.status === 200 && await bounceEvents() === 1, "a freshly signed redelivery of the same provider message still leaves one bounce event");
  }

  // 7. A real failed commit, then a retry of the same signed bytes.
  for (const [label, path, extra] of [["failspec", SPECIAL, {}], ["failgen", GENERIC, { type: "InboundMessage", messageType: "SMS" }]] as const) {
    const c = await contact(label);
    const msg = `m-${label}-${tag}`;
    const fn = `fx_fail_${label}_${tag}`;
    await h.pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.contact_id = ${c.id} THEN RAISE EXCEPTION 'fixture commit failure'; END IF; RETURN NEW; END $$`);
    await h.pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON communication_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    let failed: { status: number; raw: string };
    try { failed = await post(path, reply(c, msg, extra)); }
    finally {
      await h.pool.query(`DROP TRIGGER IF EXISTS ${fn} ON communication_events`);
      await h.pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    check(failed.status >= 500 && await inboundEvents(c.id, msg) === 0 && await receipts(c.id) === 0, `${label}: a failed commit is answered ${failed.status} (the sender retries) and left neither event nor receipt`);
    const retry = await post(path, reply(c, msg, extra), { raw: failed.raw });
    check(retry.status === 200 && await inboundEvents(c.id, msg) === 1 && await receipts(c.id) === 1, `${label}: the retry of the same signed bytes succeeds with exactly one event and one receipt`);
    const third = await post(path, reply(c, msg, extra), { raw: failed.raw });
    check(third.status === 200 && await inboundEvents(c.id, msg) === 1, `${label}: a further redelivery after recovery is inert`);
  }

  check(h.externalCalls() === 0, "no provider egress occurred during the journey");
  console.log(`\nStage 4D signed reply journey: ${checks} checks passed.`);
} finally {
  await h.close();
}
