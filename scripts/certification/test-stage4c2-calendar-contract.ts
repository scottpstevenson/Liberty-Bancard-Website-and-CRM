/**
 * Stage 4C2 calendar contract certification — disposable database; provider network denied; no booking, no send.
 *
 *  A. Calendar purpose: account only from AM_CALENDAR_URL; sales from the validated sales source; no first-calendar
 *     fallback; a missing purpose calendar is explicit unavailable.
 *  B. Selected-range request: exclusive end, bounded span, purpose calendar; events by start in [start, end).
 *  C. Capability templates: documented /calendars/events/appointments routes are exact write templates; the old
 *     /appointments template and unknown paths stay denied.
 *  D. Booking command: preview is read-only with explicit toNotify and no bypass keys; execute is default-denied,
 *     bound to the reviewed payload, replays from the receipt, never re-sends over an unknown outcome, and confirms only
 *     by provider readback.
 *  E. Static: routes are role-gated; the month calendar uses the range reader and labels local events.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C2 calendar contract certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const purpose = await import("../../server/services/ghl-calendar-purpose");
const range = await import("../../server/services/appointment-range");
const { classifyGhlOperation } = await import("../../server/services/ghl-capability-policy");
const booking = await import("../../server/services/ghl-booking-command");

let checks = 0;
const evidence: Array<{ id: string; claim: string; negativeControl: boolean }> = [];
const check = (v: unknown, message: string, negativeControl = false) => {
  assert(v, message); checks++; evidence.push({ id: `CC-${String(checks).padStart(2, "0")}`, claim: message, negativeControl });
  console.log(`✓ [CC-${String(checks).padStart(2, "0")}] ${message}`);
};
const rejects = (fn: () => unknown, message: string) => { let threw = false; try { fn(); } catch { threw = true; } check(threw, `negative control: ${message}`, true); };

const SALES_ID = "AbCdEfGhIjKlMnOpQrSt";
const ACCT_ID = "ZyXwVuTsRqPoNmLkJiHg";
const env = {
  GHL_DEFAULT_CALENDAR_ID: SALES_ID,
  GHL_LOCATION_ID: "locFixture1",
  AM_CALENDAR_URL: `https://api.leadconnectorhq.com/widget/booking/${ACCT_ID}`,
};

// ── A ────────────────────────────────────────────────────────────────────────────────────
check(purpose.bookingForPurpose("sales", env).available && (purpose.bookingForPurpose("sales", env) as any).calendarId === SALES_ID, "sales booking resolves to the validated sales calendar");
check((purpose.bookingForPurpose("account", env) as any).calendarId === ACCT_ID, "account booking resolves only from the account calendar configuration");
check(purpose.calendarPurposeOf(ACCT_ID, env) === "account" && purpose.calendarPurposeOf(SALES_ID, env) === "sales" && purpose.calendarPurposeOf(null, env) === "sales", "provider calendar ids map to exactly one purpose");
const noAcct = purpose.bookingForPurpose("account", { GHL_DEFAULT_CALENDAR_ID: SALES_ID });
check(!noAcct.available && (noAcct as any).reason === "not_configured", "account purpose without configuration is unavailable, not the sales calendar");
const badAcct = purpose.bookingForPurpose("account", { AM_CALENDAR_URL: "https://evil.example/widget/booking/ZyXwVuTsRqPoNmLkJiHg" });
check(!badAcct.available && (badAcct as any).reason === "invalid_configuration", "an account URL on another host is invalid configuration");
rejects(() => assert((purpose.bookingForPurpose("account", { GHL_DEFAULT_CALENDAR_ID: SALES_ID }) as any).calendarId === SALES_ID), "'fall back to the sales calendar for account' is rejected");

// ── B ────────────────────────────────────────────────────────────────────────────────────
const S = "2026-11-01T05:00:00.000Z", E = "2026-12-01T05:00:00.000Z";
const req = range.buildRangeRequest({ start: S, end: E }, env);
check(req.ok && req.calendarId === SALES_ID && req.purpose === "sales", "range request defaults to the sales calendar and carries the exact window");
check(range.buildRangeRequest({ start: S, end: E, purpose: "account" }, env).ok, "range request for the account purpose uses the account calendar");
check(!range.buildRangeRequest({ start: E, end: S }, env).ok && !range.buildRangeRequest({ start: S, end: S }, env).ok, "an empty or inverted interval is refused");
check(!range.buildRangeRequest({ start: S, end: "2027-03-01T00:00:00Z" }, env).ok, "a range longer than the maximum is refused");
const unconf = range.buildRangeRequest({ start: S, end: E, purpose: "account" }, {});
check(!unconf.ok && unconf.status === 409, "an unconfigured purpose calendar is a 409 unavailable, not an empty calendar");
check(!range.buildRangeRequest({ start: S, end: E, purpose: "other" }, env).ok, "an unknown purpose is refused");
const path = req.ok ? range.providerRangePath("LOC", req) : "";
check(path.includes(`calendarId=${SALES_ID}`) && path.includes(`startTime=${Date.parse(S)}`) && path.includes(`endTime=${Date.parse(E)}`), "provider path asks for the exact window and purpose calendar");
const events = [
  { id: "edge-start", startTime: S, status: "booked" }, { id: "edge-end", startTime: E, status: "booked" },
  { id: "mid", startTime: "2026-11-10T20:00:00Z", status: "confirmed" }, { id: "gone", startTime: "2026-11-11T20:00:00Z", status: "cancelled" },
  { id: "overnight", startTime: "2026-11-30T23:30:00-05:00", status: "booked" }, { id: "bad", startTime: "not-a-date", status: "booked" },
];
const inRange = range.eventsInRange(events, Date.parse(S), Date.parse(E)).map(e => e.id);
check(inRange.includes("edge-start") && !inRange.includes("edge-end"), "the start is inclusive and the end is exclusive");
check(inRange.includes("mid") && inRange.includes("overnight") && !inRange.includes("gone") && !inRange.includes("bad"), "cancelled and invalid events stay out; an overnight event is placed by its instant");
rejects(() => assert(range.eventsInRange(events, Date.parse(S), Date.parse(E)).some(e => e.id === "edge-end")), "an inclusive upper bound is rejected");
// DST: November 1 2026 is the America/New_York fall-back day; local month bounds are 4h then 5h from UTC midnight.
const nyOffsetHours = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(iso));
  return parts.find(p => p.type === "timeZoneName")?.value;
};
check(nyOffsetHours("2026-10-31T12:00:00Z") === "GMT-4" && nyOffsetHours("2026-11-02T12:00:00Z") === "GMT-5", "instants persist in UTC while display crosses the New York DST change");

// ── C ────────────────────────────────────────────────────────────────────────────────────
check(classifyGhlOperation("POST", "/calendars/events/appointments") === "crm_write", "the documented appointment create route is an exact crm_write template");
check(classifyGhlOperation("PUT", "/calendars/events/appointments/abc123") === "crm_write", "the documented appointment update route is an exact crm_write template");
check(classifyGhlOperation("POST", "/appointments") === "unknown", "the undocumented /appointments route is no longer a write template");
check(classifyGhlOperation("POST", "/calendars/events/appointments/abc/extra/deep") === "unknown", "an unlisted nested calendar path stays denied");
check(classifyGhlOperation("DELETE", "/calendars/events/abc123") === "crm_write", "provider event deletion has an exact template (never used for local history)");
rejects(() => assert.equal(classifyGhlOperation("POST", "/calendars/unknown-thing"), "crm_write"), "an unknown calendar operation is not writable");

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
// ── D ────────────────────────────────────────────────────────────────────────────────────
const base = { operation: "create" as const, purpose: "sales" as const, ghlContactId: "contactAbc", startTimeIso: "2026-11-10T15:00:00Z", endTimeIso: "2026-11-10T15:30:00Z", title: "Intro" };
const pv = booking.previewBookingCommand(base, env);
check(pv.ok && pv.method === "POST" && pv.path === "/calendars/events/appointments", "preview names the exact provider route");
check(pv.ok && pv.payload.toNotify === false && !("ignoreFreeSlotValidation" in pv.payload) && !("ignoreDateRange" in pv.payload), "notification is explicit false and no slot-validation bypass is present");
check(pv.ok && (booking.previewBookingCommand({ ...base, notifyContact: true }, env) as any).payload.toNotify === true, "notification follows the explicit owner contract value, not a default");
check(!booking.previewBookingCommand({ ...base, endTimeIso: base.startTimeIso }, env).ok && !booking.previewBookingCommand({ ...base, ghlContactId: "../x" }, env).ok, "invalid interval and contact id are refused");
check(!booking.previewBookingCommand({ ...base, operation: "reschedule" }, env).ok, "reschedule without an appointment id is refused");
check(!booking.previewBookingCommand({ ...base, purpose: "account" }, { GHL_DEFAULT_CALENDAR_ID: SALES_ID }).ok, "account booking without an account calendar is refused");
const cancel = booking.previewBookingCommand({ operation: "cancel", purpose: "sales", ghlContactId: "contactAbc", appointmentId: "appt1" }, env);
check(cancel.ok && cancel.method === "PUT" && (cancel.payload as any).appointmentStatus === "cancelled", "cancel is a status change on the provider appointment, never a delete");

const hash = pv.ok ? pv.payloadHash : "";
let writes = 0; let readbacks = 0;
type ProviderState = { found?: boolean; status?: string; calendarId?: string; contactId?: string; locationId?: string; startTime?: string; endTime?: string; version?: number | null };
const mkProvider = (opts: { id?: string; found?: boolean; throws?: boolean; before?: ProviderState; after?: ProviderState }) => {
  let wrote = false;
  const initial: ProviderState = { found: opts.found ?? true, status: "booked", calendarId: SALES_ID, contactId: "contactAbc", locationId: "locFixture1", startTime: base.startTimeIso, endTime: base.endTimeIso, version: 100 };
  return {
    write: async () => { writes++; wrote = true; if (opts.throws) throw new Error("fetch failed: ETIMEDOUT"); return { id: opts.id ?? "appt-new" }; },
    readAppointment: async () => { readbacks++; const st = wrote ? { ...initial, ...(opts.after ?? {}) } : { ...initial, ...(opts.before ?? {}) }; return { ...st, found: st.found ?? true }; },
  };
};
const cmd = () => crypto.randomUUID();
const ex = (over: Partial<Parameters<typeof booking.executeBookingCommand>[0]>) => booking.executeBookingCommand({
  actorId: "actor-1", commandId: cmd(), expectedVersion: null, reviewedPayloadHash: hash, request: base, writerEnabled: true, provider: mkProvider({}), ...over,
}, env);
const denied = await ex({ writerEnabled: false });
check(denied.state === "denied" && (denied as any).reason === "booking_writer_not_enabled" && writes === 0, "execute is denied by default and sends nothing");
check((await ex({ commandId: "not-a-uuid" })).state === "denied" && writes === 0, "a command id that is not a UUIDv4 is denied");
check((await ex({ reviewedPayloadHash: "0".repeat(64) })).state === "denied" && writes === 0, "a payload that differs from the reviewed hash is denied");
const id1 = cmd();
const done = await ex({ commandId: id1 });
const replay = await ex({ commandId: id1 });
check(done.state === "confirmed" && replay.state === "confirmed" && (replay as any).replay === true && writes === 1, "a repeated command replays its receipt and writes once");
check((await ex({ commandId: cmd(), provider: mkProvider({ id: "appt-x", found: false }) })).state === "unconfirmed", "a write the provider cannot read back is unconfirmed, not booked");
const id2 = cmd();
writes = 0;
const lost = await ex({ commandId: id2, provider: mkProvider({ throws: true }) });
const retry = await ex({ commandId: id2, provider: mkProvider({}) });
check(lost.state === "unknown" && retry.state === "unknown" && writes === 1, "a lost response is unknown and a retry does not write again");
rejects(() => assert.equal(retry.state, "confirmed"), "a lost response cannot be reported as booked");
check(readbacks >= 2, "readback was performed to confirm provider state");

// ── D2: reviewed version precondition and operation-specific readback ────────────────────
const NEW_START = "2026-11-11T16:00:00.000Z", NEW_END = "2026-11-11T16:30:00.000Z";
const reqResched = { ...base, operation: "reschedule" as const, appointmentId: "appt1", startTimeIso: NEW_START, endTimeIso: NEW_END };
const pvR = booking.previewBookingCommand(reqResched, env); const hashR = pvR.ok ? pvR.payloadHash : "";
const exR = (over: Partial<Parameters<typeof booking.executeBookingCommand>[0]>) => booking.executeBookingCommand({
  actorId: "actor-1", commandId: cmd(), expectedVersion: 100, reviewedPayloadHash: hashR, request: reqResched, writerEnabled: true, provider: mkProvider({}), ...over }, env);
writes = 0;
check((await exR({ expectedVersion: null })) .state === "denied" && writes === 0, "a reschedule without the reviewed resource version is denied");
const stale = await exR({ expectedVersion: 99 });
check(stale.state === "refused" && (stale as any).reason === "stale_expected_version" && writes === 0, "a stale expected version is refused and nothing is written");
rejects(() => assert.notEqual(writes, 0, "a stale version must not write"), "a stale version that still writes is rejected");
const wrongCal = await exR({ provider: mkProvider({ before: { calendarId: "OtherCal0123456789abc" } }) });
check(wrongCal.state === "refused" && writes === 0, "an appointment on another calendar is refused before any write");
const missing = await exR({ provider: mkProvider({ before: { found: false } }) });
check(missing.state === "refused" && writes === 0, "an appointment the provider cannot find is refused before any write");
const okR = await exR({ provider: mkProvider({ after: { startTime: NEW_START, endTime: NEW_END, version: 101 } }) });
check(okR.state === "confirmed" && writes === 1, "a reschedule is confirmed only when the readback carries the requested times");
const unchanged = await exR({ provider: mkProvider({}) });
check(unchanged.state === "unconfirmed" && (unchanged as any).reason === "readback_did_not_confirm", "a refused or ignored reschedule (times unchanged on readback) is unconfirmed, not confirmed");
rejects(() => assert.equal(unchanged.state, "confirmed"), "reporting an unchanged appointment as rescheduled is rejected");
const reqCancel = { operation: "cancel" as const, purpose: "sales" as const, ghlContactId: "contactAbc", appointmentId: "appt1" };
const pvC = booking.previewBookingCommand(reqCancel, env); const hashC = pvC.ok ? pvC.payloadHash : "";
const exC = (provider: any) => booking.executeBookingCommand({ actorId: "actor-1", commandId: cmd(), expectedVersion: 100, reviewedPayloadHash: hashC, request: reqCancel, writerEnabled: true, provider }, env);
check((await exC(mkProvider({}))).state === "unconfirmed", "a cancel whose readback is still booked is unconfirmed");
check((await exC(mkProvider({ after: { status: "cancelled" } }))).state === "confirmed", "a cancel is confirmed when the readback shows cancelled");
check((await booking.executeBookingCommand({ actorId: "actor-1", commandId: cmd(), expectedVersion: 100, reviewedPayloadHash: hashC, request: reqCancel, writerEnabled: true, provider: mkProvider({ before: { version: 7 } }) }, env)).state === "refused", "a cancel against a changed appointment version is refused");
check((await ex({ commandId: cmd(), provider: mkProvider({ after: { startTime: "2026-11-10T09:00:00Z" } }) })).state === "unconfirmed", "a create whose readback times differ from the request is unconfirmed");
check(/currentVersion/.test(read("server/routes/toolkit.ts")) && /readAppointment: readProviderAppointment/.test(read("server/routes/toolkit.ts")), "preview exposes the provider's current version and execute reads back through the same reader");

// ── D3: identity, location and command-binding refusals (correction pass) ────────────────
writes = 0;
const otherContact = await exR({ provider: mkProvider({ before: { contactId: "someoneElse" } }) });
check(otherContact.state === "refused" && (otherContact as any).reason === "appointment_belongs_to_other_contact" && writes === 0, "an appointment that belongs to another provider contact is refused before any write");
const otherLocation = await exR({ provider: mkProvider({ before: { locationId: "otherLoc" } }) });
check(otherLocation.state === "refused" && (otherLocation as any).reason === "appointment_in_other_location" && writes === 0, "an appointment in another location is refused before any write");
const noIdentity = await exR({ provider: mkProvider({ before: { contactId: undefined as any, locationId: undefined as any } }) });
check(noIdentity.state === "refused" && writes === 0, "a provider record with no contact/location identity is refused, never assumed to match");
const bindId = cmd();
const bound = await exR({ commandId: bindId, provider: mkProvider({ after: { startTime: NEW_START, endTime: NEW_END, version: 101 } }) });
const otherReq = { ...reqResched, startTimeIso: "2026-11-12T16:00:00.000Z", endTimeIso: "2026-11-12T16:30:00.000Z" };
const pvOther = booking.previewBookingCommand(otherReq, env);
const rebind = await booking.executeBookingCommand({ actorId: "actor-1", commandId: bindId, expectedVersion: 100, reviewedPayloadHash: pvOther.ok ? pvOther.payloadHash : "", request: otherReq, writerEnabled: true, provider: mkProvider({}) }, env);
check(bound.state === "confirmed" && rebind.state === "denied" && (rebind as any).reason === "command_id_bound_to_different_request", "reusing a command id for a different reviewed request is denied as a binding conflict");
const rebindVersion = await exR({ commandId: bindId, expectedVersion: 55 });
check(rebindVersion.state === "denied" && (rebindVersion as any).reason === "command_id_bound_to_different_request", "reusing a command id with a different expected version is also a binding conflict");
check(!booking.previewBookingCommand(base, { ...env, GHL_LOCATION_ID: "" }).ok, "preview refuses when the location is not configured");
const toolkitSrc = read("server/routes/toolkit.ts");
check(/booking\/command\/:commandId/.test(toolkitSrc) && /sent: false/.test(toolkitSrc), "a read-only command status route exists and never sends");
check(/withResolvedProviderContact/.test(toolkitSrc), "the provider contact is resolved on the server from the local contact");
const panel = read("client/src/components/BookingCommandPanel.tsx");
check(/booking_writer_not_enabled/.test(panel) && /canExecute/.test(panel) && !/toNotify|ignoreFreeSlot/.test(panel), "the drawer panel surfaces the default-denied writer and never chooses notification or slot-validation behavior");

// ── E ────────────────────────────────────────────────────────────────────────────────────
const toolkit = read("server/routes/toolkit.ts");
check(/\/api\/appointments\/booking\/execute", isDashboardUser, requireRole\("admin"\)/.test(toolkit) && /\/api\/appointments\/booking\/preview", isDashboardUser, requireRole\("admin", "manager"\)/.test(toolkit), "booking routes are role-gated (execute admin only)");
check(/ghl_booking_writer_enabled/.test(toolkit), "execute is bound to the owner-controlled writer switch");
const cal = read("client/src/pages/dashboard/Calendar.tsx");
check(/\/api\/appointments\/range/.test(cal) && !/"\/api\/appointments"\)/.test(cal), "the month calendar reads the selected-range endpoint");
check(/Add local event/.test(cal) && /does not book a GoHighLevel appointment/.test(cal), "local events are labelled as local and not as bookings");
check(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(cal), "the calendar names its display timezone");
check(!/only the inbound confirmation slot|reference only — outbound/i.test(read("client/src/pages/dashboard/GhlWorkflowManager.tsx")), "workflow guidance no longer contradicts the supported handoffs");
check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt occurred during the certification");

mkdirSync(new URL("../../docs/certification/stage4-c2/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/certification/stage4-c2/calendar-contract-evidence.json", import.meta.url),
  JSON.stringify({ suite: "stage4c2-calendar-contract", checks, negativeControls: evidence.filter(e => e.negativeControl).length, results: evidence }, null, 2) + "\n");
console.log(`\nStage 4C2 calendar contract: ${checks} checks passed`);
await pool.end();
