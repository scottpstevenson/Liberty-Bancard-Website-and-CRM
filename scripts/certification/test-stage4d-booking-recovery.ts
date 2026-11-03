/**
 * Stage 4D booking recovery certification — disposable database; provider network denied; fake provider; no real booking.
 *
 * R1: an unresolved provider create is released ONLY by a refusal, an exact provider readback of the reviewed intent, or
 * an explicit recorded resolution. A 404/"not observed", an unreadable or mismatching provider record, an unknown outcome,
 * storage loss and time passing never release it, and a delayed original request can never produce a second create.
 * R2: zoned wall-time conversion rejects nonexistent local times and requires a choice for repeated ones.
 *
 * The real command writer, receipts, audit rows, reconcile and resolve code run against the disposable database. The
 * provider is a counting fake; every scenario asserts how many provider writes happened.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4D booking recovery certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const booking = await import("../../server/services/ghl-booking-command");
const { resolveZonedWallTime, zonedWallTimeToUtcMs } = await import("../../client/src/lib/zoned-time");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [BR-${String(checks).padStart(2, "0")}] ${message}`); };
const uuid = () => crypto.randomUUID();
const tag = crypto.randomBytes(4).toString("hex");

const SALES_ID = "AbCdEfGhIjKlMnOpQrSt";
const LOC = "locFixture1";
const env = { GHL_DEFAULT_CALENDAR_ID: SALES_ID, GHL_LOCATION_ID: LOC };
const START = "2026-12-01T15:00:00.000Z", END = "2026-12-01T15:30:00.000Z";
const request = (contact = "ghlContactA") => ({ operation: "create" as const, purpose: "sales" as const, ghlContactId: contact, startTimeIso: START, endTimeIso: END, title: "Recovery cert" });
const reviewed = (contact?: string) => { const p = booking.previewBookingCommand(request(contact), env); assert(p.ok); return (p as any).payloadHash as string; };

type Read = (id: string) => Promise<any>;
const matching = (id: string, over: Record<string, unknown> = {}) => ({ found: true, id, status: "booked", calendarId: SALES_ID, contactId: "ghlContactA", locationId: LOC, startTime: START, endTime: END, version: 1, ...over });
function fakeProvider(opts: { id: string; write?: "ok" | "ambiguous" | "refuse"; read?: Read }) {
  const state = { writes: 0, read: opts.read ?? (async (id: string) => matching(id)) };
  return {
    state,
    provider: {
      write: async () => {
        state.writes++;
        if (opts.write === "ambiguous") throw new Error("socket hang up");
        if (opts.write === "refuse") throw new Error("calendar slot is not available");
        return { id: opts.id };
      },
      readAppointment: (id: string) => state.read(id),
    },
  };
}
const exec = (actor: string, commandId: string, provider: any, extra: { contact?: string; hooks?: any } = {}) =>
  booking.executeBookingCommand({
    actorId: actor, commandId, expectedVersion: null, reviewedPayloadHash: reviewed(extra.contact), request: request(extra.contact) as any,
    writerEnabled: true, provider, hooks: extra.hooks,
  }, env);
const status = (commandId: string, actor: string, role = "admin", read: Read = async (id) => matching(id)) =>
  booking.reconcileBookingCommand(commandId, { id: actor, role }, read);
const receiptCount = async (commandId: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM followup_effect_receipts WHERE owner_kind='booking_command' AND owner_id=$1`, [commandId])).rows[0].n);

const cleanup: string[] = [];
const actor = (name: string) => { const id = `br-${tag}-${name}`; cleanup.push(id); return id; };

try {
  // ── A. Delayed original request + reload/status 404 cannot cause a second create ─────────
  {
    const a = actor("delayed"), c1 = uuid(), c2 = uuid();
    const fake = fakeProvider({ id: "apt-delayed" });
    let reached!: () => void; const atBarrier = new Promise<void>(r => { reached = r; });
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const original = exec(a, c1, fake.provider, { hooks: { afterIntentRecorded: async () => { reached(); await gate; } } });
    await atBarrier;
    check(fake.state.writes === 0 && await receiptCount(c1) === 0, "the original request is held after its durable intent record and before its receipt claim");
    check(await status(c1, a) === null, "reload + status read: the command is 'not observed' (404), which proves nothing about the delayed request");
    const replacement = await exec(a, c2, fake.provider);
    check(replacement.state === "denied" && (replacement as any).reason === "unresolved_prior_create" && (replacement as any).blockingCommandId === c1 && fake.state.writes === 0,
      "a replacement create with a new command id is denied and names the unresolved original; zero provider writes");
    release();
    const done = await original;
    check(done.state === "confirmed" && fake.state.writes === 1, "the delayed original then completes: exactly one provider create in total");
    const after = await exec(a, c2, fake.provider);
    check(after.state === "confirmed" && fake.state.writes === 2, "after the original is exactly confirmed the block lifts (an explicit new create is a separate, reviewed intent)");
  }

  // ── B. Operator resolution fences a delayed original (no claim after a recorded 'not created') ─
  {
    const a = actor("fence"), c1 = uuid();
    const fake = fakeProvider({ id: "apt-fence" });
    let reached!: () => void; const atBarrier = new Promise<void>(r => { reached = r; });
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const original = exec(a, c1, fake.provider, { hooks: { afterIntentRecorded: async () => { reached(); await gate; } } });
    await atBarrier;
    const resolved = await booking.resolveBookingCommand(c1, a, "not_created", "checked the provider calendar; nothing there");
    check(resolved.ok === true, "an administrator records 'not created' for a command with no receipt");
    release();
    const late = await original;
    check(late.state === "denied" && (late as any).reason === "command_id_bound_to_different_request" && fake.state.writes === 0,
      "the delayed original is then refused before any provider I/O: the recorded resolution fenced the command id");
    const fresh = await exec(a, uuid(), fake.provider);
    check(fresh.state === "confirmed" && fake.state.writes === 1, "a replacement create is allowed only after that recorded resolution");
  }

  // ── C. Accepted but unreadable / mismatched provider record never releases the command ───
  for (const [label, read] of [
    ["unreadable provider record", async () => null],
    ["wrong contact", async (id: string) => matching(id, { contactId: "someoneElse" })],
    ["wrong calendar", async (id: string) => matching(id, { calendarId: "OtherCalendar123456789" })],
    ["wrong location", async (id: string) => matching(id, { locationId: "otherLoc" })],
    ["wrong time", async (id: string) => matching(id, { startTime: "2026-12-01T16:00:00.000Z" })],
    ["cancelled status", async (id: string) => matching(id, { status: "cancelled" })],
  ] as Array<[string, Read]>) {
    const a = actor(`mm-${label.replace(/\W/g, "")}`), c1 = uuid();
    const fake = fakeProvider({ id: "apt-mm", read });
    const first = await exec(a, c1, fake.provider);
    const rec = await status(c1, a, "admin", read);
    const blocked = await exec(a, uuid(), fake.provider);
    check(first.state === "unconfirmed" && rec?.state === "accepted" && rec.confirmation !== "confirmed" && rec.resolved === false
      && blocked.state === "denied" && (blocked as any).reason === "unresolved_prior_create" && fake.state.writes === 1,
      `accepted + ${label}: unconfirmed, reconcile does not confirm, replacement create denied, one provider write`);
  }

  // ── D. Accepted and exactly matching on later reconcile releases it ─────────────────────
  {
    const a = actor("later-match"), c1 = uuid();
    const fake = fakeProvider({ id: "apt-later", read: async () => null });
    const first = await exec(a, c1, fake.provider);
    check(first.state === "unconfirmed", "the provider accepted but could not be read back at execute time");
    const unreadable = await status(c1, a, "admin", async () => null);
    check(unreadable?.confirmation === "unreadable" && !unreadable.resolved, "reconcile with an unreadable provider stays unconfirmed (raw readability is not confirmation)");
    const matched = await status(c1, a, "admin", async (id) => matching(id));
    check(matched?.confirmation === "confirmed" && matched.resolved, "reconcile with an exact match of the recorded reviewed intent confirms and records it");
    const next = await exec(a, uuid(), fake.provider);
    check(next.state === "unconfirmed" && fake.state.writes === 2, "only now may another create start (it is a new reviewed intent; here its own readback is still unreadable)");
  }

  // ── E. Unknown provider outcome: replay never re-sends; only a recorded resolution releases ─
  {
    const a = actor("unknown"), c1 = uuid();
    const fake = fakeProvider({ id: "apt-unk", write: "ambiguous" });
    const first = await exec(a, c1, fake.provider);
    const rec = await status(c1, a);
    check(first.state === "unknown" && rec?.state === "unknown", "an ambiguous provider failure is unknown");
    const replay = await exec(a, c1, fake.provider);
    check(replay.state === "unknown" && fake.state.writes === 1, "replaying the same command id never re-sends over an unknown outcome");
    const blocked = await exec(a, uuid(), fake.provider);
    check(blocked.state === "denied" && (blocked as any).reason === "unresolved_prior_create" && fake.state.writes === 1, "a replacement create is denied while the outcome is unknown");
    check((await booking.resolveBookingCommand(c1, a, "not_created", "x")).ok === true, "a recorded resolution is accepted for the unknown command");
    const next = await exec(a, uuid(), fake.provider);
    check(next.state === "unknown" && fake.state.writes === 2, "after the recorded resolution a replacement create may start");
  }

  // ── F. Definitive refusal needs no block ───────────────────────────────────────────────
  {
    const a = actor("refused");
    const fake = fakeProvider({ id: "apt-ref", write: "refuse" });
    const first = await exec(a, uuid(), fake.provider);
    const second = await exec(a, uuid(), fake.provider);
    check(first.state === "refused" && second.state === "refused" && fake.state.writes === 2, "a definite refusal does not block a corrected retry with a new command id");
  }

  // ── G. Resolution guards ───────────────────────────────────────────────────────────────
  {
    const a = actor("guards");
    // accepted receipt cannot be declared 'not created'
    const fake = fakeProvider({ id: "apt-g", read: async () => null });
    const accepted = uuid(); await exec(a, accepted, fake.provider);
    const denyNot = await booking.resolveBookingCommand(accepted, a, "not_created", "provider calendar looks empty");
    check(!denyNot.ok && denyNot.reason === "receipt_says_accepted", "'not created' is refused while the receipt says the provider accepted it");
    // a fresh 'started' receipt is still in flight
    const started = uuid();
    await pool.query(`INSERT INTO followup_effect_receipts(effect_key,owner_kind,owner_id,channel,state) VALUES($1,'booking_command',$2,'calendar_create','started')`, [`booking_command:${a}:${started}`, started]);
    const inflight = await booking.resolveBookingCommand(started, a, "not_created", "checked quickly");
    check(!inflight.ok && inflight.reason === "still_in_flight", "a command started moments ago is still in flight and cannot be resolved yet");
    await pool.query(`UPDATE followup_effect_receipts SET created_at = now() - interval '10 minutes' WHERE owner_id=$1`, [started]);
    check((await booking.resolveBookingCommand(started, a, "not_created", "checked after ten minutes")).ok === true, "after the in-flight grace period the same command can be resolved");
    const noReceipt = await booking.resolveBookingCommand(uuid(), a, "created_verified", "it exists, honest");
    check(!noReceipt.ok && noReceipt.reason === "no_receipt_to_verify", "'created and verified' needs a receipt to verify");
    // another actor cannot see or confirm this actor's command
    check(await status(accepted, "someone-else", "manager") === null, "another actor's manager session cannot read this command (not observed)");
    const foreign = await booking.resolveBookingCommand(accepted, "someone-else", "created_verified", "not mine at all");
    check(!foreign.ok, "another actor cannot resolve this actor's command");
  }

  // ── H. A reviewed intent that cannot be recorded is a denial with no provider call ─────
  {
    const a = actor("intentfail"), c1 = uuid();
    await pool.query(`CREATE OR REPLACE FUNCTION br_block_intent() RETURNS trigger AS $$ BEGIN IF NEW.entity_key = '${c1}' AND NEW.action = 'booking_command_intent' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER br_block_intent_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION br_block_intent()`);
    try {
      const fake = fakeProvider({ id: "apt-h" });
      const r = await exec(a, c1, fake.provider);
      check(r.state === "denied" && (r as any).reason === "intent_record_unavailable" && fake.state.writes === 0 && await receiptCount(c1) === 0,
        "when the reviewed intent cannot be recorded the command is denied: no receipt, no provider write");
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS br_block_intent_trg ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS br_block_intent()`);
    }
  }

  // ── I. Concurrent creates by one actor: exactly one proceeds ─────────────────────────────
  {
    const a = actor("race");
    const fake = fakeProvider({ id: "apt-race", read: async () => null });
    const results = await Promise.all([exec(a, uuid(), fake.provider), exec(a, uuid(), fake.provider), exec(a, uuid(), fake.provider)]);
    check(fake.state.writes === 1 && results.filter(r => r.state === "denied" && (r as any).reason === "unresolved_prior_create").length === 2,
      "three simultaneous creates from one actor: exactly one provider write, two denied as unresolved-prior-create");
  }

  // ── J. 24h passage and actor change cannot release it (server side) ───────────────────────
  {
    const a = actor("aged"), c1 = uuid();
    const fake = fakeProvider({ id: "apt-aged", read: async () => null });
    await exec(a, c1, fake.provider);
    await pool.query(`UPDATE audit_logs SET created_at = now() - interval '26 hours' WHERE entity_key=$1`, [c1]);
    await pool.query(`UPDATE followup_effect_receipts SET created_at = now() - interval '26 hours' WHERE owner_id=$1`, [c1]);
    const blocked = await exec(a, uuid(), fake.provider);
    check(blocked.state === "denied" && (blocked as any).reason === "unresolved_prior_create", "26 hours later the unresolved create still blocks a replacement");
    const other = await exec(actor("other-actor"), uuid(), fakeProvider({ id: "apt-other" }).provider);
    check(other.state === "confirmed", "negative control: a different actor's create is not blocked by this actor's unresolved command");
  }
} finally {
  await pool.query(`DELETE FROM audit_logs WHERE entity_type='booking_command' AND user_id = ANY($1)`, [cleanup]).catch(() => undefined);
  await pool.query(`DELETE FROM followup_effect_receipts WHERE owner_kind='booking_command' AND effect_key LIKE ANY($1)`, [cleanup.map(c => `booking_command:${c}:%`)]).catch(() => undefined);
}

// ── K. Client contract (static): the saved command is only released by trusted outcomes ───
const panel = readFileSync("client/src/components/BookingCommandPanel.tsx", "utf8");
const create = readFileSync("client/src/components/BookingCreatePanel.tsx", "utf8");
const routes = readFileSync("server/routes/toolkit.ts", "utf8");
check(!/PENDING_TTL_MS|Date\.now\(\) - value\.savedAt/.test(panel), "the saved command has no 24-hour expiry");
check(/const writePending = \(key: string, value: PendingCommand\): boolean/.test(panel) && /cannot save the recovery record/.test(panel) && /cannot save the recovery record/.test(create),
  "if the browser cannot save the recovery record, nothing is sent (both create and change)");
check(/PendingRecovery/.test(create) && /PendingRecovery/.test(panel) && !/clearPending\(storageKey\); setPending\(null\);\s*\n\s*setNotice\(\{ tone: "info", text: "No record of that command exists/.test(panel + create),
  "create and change share one recovery component; the old 404-clears-and-claims-nothing-was-sent handler is gone");
check(/Not observed: no receipt for this command is visible yet\. That does not prove it was not sent/.test(panel) && !/nothing was sent\. You can preview again/.test(panel + create),
  "a 404 is described as 'not observed', never as 'nothing was sent'");
const recoveryFn = panel.split("export function PendingRecovery")[1] ?? "";
check(/state === "refused"[\s\S]{0,80}release/.test(recoveryFn) && /confirmation === "confirmed" \|\| body\.resolved/.test(recoveryFn) && !/body\.state === "accepted"[^\n]*release\(\{ state: "unconfirmed"/.test(recoveryFn),
  "only a refusal, an exact confirmation or a recorded resolution releases; accepted-but-unmatched is kept");
check(/unresolved_prior_create/.test(create) && /blockingCommandId/.test(create), "the create panel adopts a server-reported unresolved command so a lost local record is recovered");
check(/requireRole\("admin"\)/.test(routes.split('"/api/appointments/booking/command/:commandId/resolve"')[1]?.slice(0, 160) ?? ""), "the resolve route is administrator-only");
const scopeLine = panel.split("\n").find(l => /const scope = useMemo/.test(l)) ?? "";
check(!/accountVersion|canExecute/.test(scopeLine), "the saved-command scope is the actor, so a permission or account-version change does not discard unresolved work (other actors are still purged)");

// ── L. R2: zoned wall time ────────────────────────────────────────────────────────────────
const NY = "America/New_York";
const gap = resolveZonedWallTime("2027-03-14T02:30", NY);
check(!gap.ok && gap.reason === "nonexistent_local_time" && Number.isNaN(zonedWallTimeToUtcMs("2027-03-14T02:30", NY)), "New York 2027-03-14 02:30 (spring-forward gap) is rejected, not moved to 01:30");
const before = resolveZonedWallTime("2027-03-14T01:59", NY), after = resolveZonedWallTime("2027-03-14T03:00", NY);
check(before.ok && after.ok && new Date((before as any).ms).toISOString() === "2027-03-14T06:59:00.000Z" && new Date((after as any).ms).toISOString() === "2027-03-14T07:00:00.000Z", "times either side of the gap convert correctly");
const rep = resolveZonedWallTime("2026-11-01T01:30", NY);
check(!rep.ok && rep.reason === "ambiguous_local_time", "a repeated local time (fall-back) is rejected until the occurrence is chosen");
const first = resolveZonedWallTime("2026-11-01T01:30", NY, "first"), second = resolveZonedWallTime("2026-11-01T01:30", NY, "second");
check(first.ok && second.ok && new Date((first as any).ms).toISOString() === "2026-11-01T05:30:00.000Z" && (first as any).offsetMinutes === -240
  && new Date((second as any).ms).toISOString() === "2026-11-01T06:30:00.000Z" && (second as any).offsetMinutes === -300, "choosing first/second yields the two distinct instants with their offsets");
const round = (local: string, zone: string, occ?: "first" | "second") => {
  const r = resolveZonedWallTime(local, zone, occ); if (!r.ok) return "x";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(r.ms));
  const g = (t: string) => p.find(x => x.type === t)!.value; return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
};
check(["2026-11-10T09:00", "2026-07-10T09:00", "2027-03-14T03:30", "2027-01-05T23:59"].every(l => round(l, NY) === l), "every accepted New York time round-trips to exactly the requested wall time");
check(round("2026-11-10T09:00", "Asia/Kolkata") === "2026-11-10T09:00" && (resolveZonedWallTime("2026-11-10T09:00", "Asia/Kolkata") as any).offsetMinutes === 330, "a half-hour-offset zone converts exactly");
check(round("2026-11-10T09:00", "UTC") === "2026-11-10T09:00" && round("2026-11-10T09:00", "America/Los_Angeles") === "2026-11-10T09:00", "UTC and Los Angeles winter times convert exactly");
const bad = [resolveZonedWallTime("2026-02-30T09:00", "UTC"), resolveZonedWallTime("2026-13-01T09:00", "UTC"), resolveZonedWallTime("2026-11-10T24:00", "UTC"), resolveZonedWallTime("2026-11-10 09:00", "UTC"), resolveZonedWallTime("2026-11-10T09:00", "Mars/Base")];
check(bad.every(b => !b.ok) && (bad[0] as any).reason === "invalid_date" && (bad[3] as any).reason === "invalid_format" && (bad[4] as any).reason === "invalid_zone", "invalid dates, formats and zones are rejected with a specific reason");
check(/booking-create-time-error/.test(create) && /ZONED_REASON_COPY/.test(create) && /!timeResolution\.ok/.test(create) && /booking-create-occurrence-select/.test(create), "the create form shows the field error, disables preview, and asks which repeated occurrence");
// The previous two-pass implementation, kept only as a negative control: it silently turns the gap time into 01:30.
const legacyTwoPass = (local: string, zone: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)!;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find(x => x.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
};
const legacyMs = legacyTwoPass("2027-03-14T02:30", NY);
const legacyWall = new Intl.DateTimeFormat("en-CA", { timeZone: NY, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(legacyMs));
check(legacyWall === "01:30", "negative control: the previous implementation returned an instant that reads back as 01:30 in New York, which the new code rejects instead");

console.log(`\nStage 4D booking recovery certification: ${checks} checks passed`);
await pool.end();
