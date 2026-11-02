import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 4C2 operator-UI acceptance (R07): the compiled production client, real admin/agent sessions and CSRF, real route
// handlers on a disposable database. The provider is a FIXTURE: the appointment reader's injected seam returns recorded
// events and no network call is possible (fixture egress is denied and counted). Proves, in a real browser at
// 1280/768/390 in light and dark:
//   - the Calendar source filter (all / sales / account / local) and what each one reads,
//   - the appointment detail drawer (current occurrence, last observation, pending/accepted/unknown command state),
//   - the contact picker uses the scoped paginated search (never the first 250 contacts),
//   - Run History is server-paged and searchable,
// each with negative controls (failed reads are unavailable, never empty; unconfigured is not empty; out-of-scope is 404).
// Not published-candidate or production acceptance, and no live provider appointment/command was exercised.
const identity = await verifyCandidateIdentity();
const dir = "generated-artifacts/stage4c2-browser";
const clientRoot = path.resolve("dist/public");
const SALES_ID = "AbCdEfGhIjKlMnOpQrSt";
const ACCT_ID = "ZyXwVuTsRqPoNmLkJiHg";
const envBefore = { sales: process.env.GHL_DEFAULT_CALENDAR_ID, account: process.env.AM_CALENDAR_URL,
  url: process.env.GHL_CALENDAR_BOOKING_URL, link: process.env.GHL_DEFAULT_BOOKING_LINK };
process.env.GHL_DEFAULT_CALENDAR_ID = SALES_ID;
delete process.env.GHL_CALENDAR_BOOKING_URL;
delete process.env.GHL_DEFAULT_BOOKING_LINK;
const ACCOUNT_URL = `https://api.leadconnectorhq.com/widget/booking/${ACCT_ID}`;
process.env.AM_CALENDAR_URL = ACCOUNT_URL;

const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const dayStart = new Date(); dayStart.setUTCHours(12, 0, 0, 0);
const hour = (n: number) => new Date(dayStart.getTime() + n * 3600_000).toISOString();
const ghlOwned = `ghl-owned-${tag}`, ghlOther = `ghl-other-${tag}`;
const providerReads: string[] = [];
const events = {
  [SALES_ID]: [
    { id: `appt-s1-${tag}`, title: "Sales intro", contactId: ghlOwned, contactName: "Provider Name", startTime: hour(0), endTime: hour(1), status: "confirmed" },
    { id: `appt-s2-${tag}`, title: "Sales follow-up", contactId: ghlOwned, contactName: "Provider Name", startTime: hour(3), endTime: hour(4), status: "confirmed" },
    { id: `appt-s3-${tag}`, title: "Other rep meeting", contactId: ghlOther, contactName: "Other Person", startTime: hour(5), endTime: hour(6), status: "confirmed" },
  ],
  [ACCT_ID]: [
    { id: `appt-a1-${tag}`, title: "Account review", contactId: ghlOwned, contactName: "Provider Name", startTime: hour(7), endTime: hour(8), status: "confirmed" },
  ],
} as Record<string, unknown[]>;

const h = await stage3BHttpFixture(async (app) => {
  (await import("../server/routes/contacts.ts")).registerContactsRoutes(app);
  (await import("../server/routes/activity.ts")).registerActivityRoutes(app);
  (await import("../server/routes/deals.ts")).registerDealsRoutes(app);
  (await import("../server/routes/workflows.ts")).registerWorkflowsRoutes(app);
  (await import("../server/routes/toolkit.ts")).registerToolkitRoutes(app, {
    appointments: {
      config: () => ({ locationId: `loc-${tag}` }) as any,
      read: async (providerPath: string) => {
        providerReads.push(providerPath);
        const calendarId = new URL(providerPath, "http://provider.invalid").searchParams.get("calendarId") ?? "";
        return { events: events[calendarId] ?? [] };
      },
    },
  });
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated 4C2 fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

const checks: string[] = [];
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks.push(label); console.log(`✓ ${label}`); };
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
type B = Awaited<ReturnType<typeof privateStage3Browser>>;
const until = async (fn: () => Promise<boolean>, label: string, tries = 80) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await settle(250); }
  throw new Error(`Timed out: ${label}`);
};
let b: B | undefined;
try {
  await mkdir(dir, { recursive: true });
  await h.pool.query(`UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1`, [`${h.prefix}-%`]);
  const agentEmail = h.email("agent");

  // ── Fixtures: >250 contacts so a first-250 list could not contain the target; two owners; recorded appointment state ──
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    SELECT 'Filler','Person '||g, $1||'-f'||g||'@example.test','+1996'||lpad((g+4100000)::text,7,'0'),'production','dashboard',NOW()-INTERVAL '1 day','valid'
      FROM generate_series(1,320) g`, [tag]);
  const owned = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,ghl_contact_id,assigned_to,created_at,email_status)
    VALUES('Ownedfirst','Ownedlast',$1,'+19950000001','production','dashboard',$2,$3,NOW()-INTERVAL '400 days','valid') RETURNING id`,
    [`${tag}-owned@example.test`, ghlOwned, agentEmail])).rows[0].id as number;
  const other = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,ghl_contact_id,assigned_to,created_at,email_status)
    VALUES('Otherfirst','Otherlast',$1,'+19950000002','production','dashboard',$2,'someone-else@example.test',NOW()-INTERVAL '400 days','valid') RETURNING id`,
    [`${tag}-other@example.test`, ghlOther])).rows[0].id as number;
  const target = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    VALUES('Quillfeather','Uniqueperson'||$1,$2,'+19950000003','production','dashboard',NOW()-INTERVAL '900 days','valid') RETURNING id`,
    [tag, `${tag}-target@example.test`])).rows[0].id as number;
  const total = Number((await h.pool.query(`SELECT count(*)::int n FROM contacts WHERE record_class='production'`)).rows[0].n);
  assert.ok(total > 250, "fixture must exceed 250 production contacts");
  const s1 = `appt-s1-${tag}`, s2 = `appt-s2-${tag}`, s3 = `appt-s3-${tag}`, a1 = `appt-a1-${tag}`;
  for (const [id, ghl, start, end] of [[s1, ghlOwned, hour(0), hour(1)], [s2, ghlOwned, hour(3), hour(4)], [s3, ghlOther, hour(5), hour(6)]]) {
    await h.pool.query(`INSERT INTO ghl_appointment_state(appointment_id,ghl_contact_id,calendar_id,location_id,status,start_time,end_time,last_event_at)
      VALUES($1,$2,$3,$4,'booked',$5,$6,NOW()-INTERVAL '2 hours')`, [id, ghl, SALES_ID, `loc-${tag}`, start, end]);
  }

  // ── Booking-command receipts written by the real command writer (fake provider, writer enabled in-process only) ──
  const { executeBookingCommand, previewBookingCommand } = await import("../server/services/ghl-booking-command.ts");
  const uuid = () => randomUUID();
  const run = (commandId: string, operation: "reschedule" | "cancel" | "create", appointmentId: string | undefined, provider: any) => {
    const request = { operation, purpose: "sales" as const, ghlContactId: ghlOwned, appointmentId,
      ...(operation === "cancel" ? {} : { startTimeIso: hour(30), endTimeIso: hour(31) }) };
    const preview = previewBookingCommand(request as any);
    assert.ok(preview.ok, "command preview must be valid for the fixture calendar");
    return executeBookingCommand({ actorId: h.userId("admin"), commandId, expectedVersion: null, reviewedPayloadHash: (preview as any).payloadHash,
      request: request as any, writerEnabled: true, provider });
  };
  // Reschedule of s1: write hangs in an ambiguous way -> receipt 'unknown' (never retried automatically).
  const unknownResult = await run(uuid(), "reschedule", s1, { write: async () => { throw new Error("socket hang up"); }, readAppointment: async () => null });
  check(unknownResult.state === "unknown", "a lost-response reschedule is recorded as an unknown outcome by the real command writer");
  // Cancel of s2 accepted and confirmed by readback.
  const acceptedResult = await run(uuid(), "cancel", s2, { write: async () => ({ id: s2 }), readAppointment: async () => ({ found: true, status: "cancelled" }) });
  check(acceptedResult.state === "confirmed", "a cancel accepted by the provider and read back is confirmed by the real command writer");
  // A started receipt that never settled (crash between claim and send) is the 'pending' state.
  await h.pool.query(`INSERT INTO followup_effect_receipts(effect_key,owner_kind,owner_id,channel,state)
    VALUES($1,'booking_command',$2,$3,'started')`, [`booking_command:fixture:${tag}`, uuid(), `calendar_reschedule:${s3}`]);

  // ── Workflow runs: more than one page, distinct entities, one with an undelivered step ──
  const wf = (await h.pool.query(`INSERT INTO workflows(name,trigger_type,actions,enabled) VALUES($1,'manual','[]'::jsonb,true) RETURNING id`, [`4c2-wf-${tag}`])).rows[0].id as number;
  const wfOther = (await h.pool.query(`INSERT INTO workflows(name,trigger_type,actions,enabled) VALUES($1,'manual','[]'::jsonb,true) RETURNING id`, [`4c2-zebra-${tag}`])).rows[0].id as number;
  await h.pool.query(`INSERT INTO workflow_runs(workflow_id,entity_type,entity_id,status,created_at,completed_at)
    SELECT $1,'contact',700000+g,'completed',NOW()-(g||' minutes')::interval,NOW() FROM generate_series(1,60) g`, [wf]);
  await h.pool.query(`INSERT INTO workflow_runs(workflow_id,entity_type,entity_id,status,created_at,log)
    VALUES($1,'deal',880001,'completed',NOW()-INTERVAL '2 days','[{"step":1,"action":"send_sms","status":"queued_no_ghl"}]'::jsonb)`, [wfOther]);
  await h.pool.query(`INSERT INTO workflow_runs(workflow_id,entity_type,entity_id,status,created_at) VALUES($1,'contact',990001,'failed',NOW()-INTERVAL '3 days')`, [wfOther]);
  const runTotal = Number((await h.pool.query(`SELECT count(*)::int n FROM workflow_runs`)).rows[0].n);
  const sideEffects = async () => (await h.pool.query(`SELECT (SELECT count(*)::int FROM outbound_messages) o,(SELECT count(*)::int FROM workflow_runs) r,
    (SELECT count(*)::int FROM ghl_appointment_state) s,(SELECT count(*)::int FROM followup_effect_receipts) f`)).rows[0];
  const before = await sideEffects();

  // ── Direct server contracts (real sessions, CSRF, scope) ──
  const get = (role: string, p: string) => h.request(role, "GET", p);
  const asAdmin = await get("admin", `/api/appointments/${s1}/detail`);
  check(asAdmin.status === 200 && asAdmin.body.recorded === true && asAdmin.body.occurrence.current === true && asAdmin.body.occurrence.purpose === "sales",
    "admin reads the recorded detail: s1 is the current sales meeting for its contact");
  check(asAdmin.body.commands.some((c: any) => c.state === "unknown" && c.operation === "reschedule"),
    "the unknown reschedule is linked to its appointment by the real writer's channel and reads as unknown");
  const s2Detail = await get("admin", `/api/appointments/${s2}/detail`);
  check(s2Detail.body.occurrence.current === false && s2Detail.body.occurrence.currentAppointmentId === s1 && s2Detail.body.commands.some((c: any) => c.state === "accepted"),
    "the later appointment is not current (the earlier open one is) and its accepted cancel reads accepted");
  check((await get("admin", `/api/appointments/${s3}/detail`)).body.commands.some((c: any) => c.state === "pending"),
    "a started, never-settled command reads as pending");
  const noRecord = await get("admin", `/api/appointments/${a1}/detail`);
  check(noRecord.status === 200 && noRecord.body.recorded === false && noRecord.body.occurrence === null && noRecord.body.commands.length === 0,
    "an appointment with no recorded state is reported as not recorded, not as a guessed occurrence");
  check(!JSON.stringify(asAdmin.body).includes("socket hang up"), "provider error text is never returned in the detail");
  check((await get("agent", `/api/appointments/${s1}/detail`)).status === 200, "the owning agent can read detail for their own contact's appointment");
  check((await get("agent", `/api/appointments/${s3}/detail`)).status === 404, "negative control: an agent cannot read detail for another rep's contact (404)");
  check((await get("agent", `/api/appointments/${a1}/detail`)).status === 404, "negative control: an agent gets no detail for an unrecorded appointment (404, no leak)");
  check((await get("admin", `/api/appointments/bad%20id/detail`)).status === 400, "negative control: a malformed appointment id is refused (400)");
  for (const role of ["merchant", "affiliate", "partner"]) check((await get(role, `/api/appointments/${s1}/detail`)).status === 403, `${role} is refused the appointment detail (403)`);
  check((await get("admin", "/api/workflow-runs?limit=0")).status === 400 && (await get("admin", "/api/workflow-runs?limit=101")).status === 400 &&
    (await get("admin", "/api/workflow-runs?offset=-1")).status === 400, "negative control: run history refuses limit 0, limit 101 and a negative offset (400)");
  check((await get("agent", "/api/workflow-runs?limit=25")).status === 403, "negative control: an agent cannot read run history (403)");
  const page1 = await get("admin", "/api/workflow-runs?limit=25&offset=0");
  check(page1.status === 200 && page1.body.data.length === 25 && page1.body.total >= 62 && page1.body.limit === 25, "run history returns a bounded page with the SQL total");
  const page3 = await get("admin", "/api/workflow-runs?limit=25&offset=50");
  check(page3.body.data.length >= 10 && new Set([...page1.body.data, ...page3.body.data].map((r: any) => r.id)).size === 25 + page3.body.data.length, "later pages do not repeat earlier rows");
  const bySearch = await get("admin", `/api/workflow-runs?search=${encodeURIComponent("contact #990001")}`);
  check(bySearch.body.total === 1 && bySearch.body.data[0].entityId === 990001, "search matches an entity reference such as 'contact #990001'");
  const byName = await get("admin", `/api/workflow-runs?search=zebra-${tag}`);
  check(byName.body.total === 2, "search matches the workflow name");
  const wild = await get("admin", "/api/workflow-runs?search=%25");
  check(wild.status === 200 && wild.body.total === 0, "negative control: a LIKE wildcard in the search is matched literally, not as match-all");
  check(Array.isArray((await get("admin", "/api/workflow-runs")).body), "the unpaged request still returns the legacy array for existing consumers");

  b = await privateStage3Browser(h.base, h.sessions.get("admin")!.cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  const count = (selector: string) => b!.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`) as Promise<number>;
  const text = (selector: string) => b!.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent||""`) as Promise<string>;
  const bodyText = () => b!.evaluate("document.body.innerText") as Promise<string>;
  const overflow = () => b!.evaluate("document.documentElement.scrollWidth - window.innerWidth") as Promise<number>;
  const setView = async (width: number, theme: "light" | "dark") => {
    const phone = width < 600;
    await b!.call("Emulation.setDeviceMetricsOverride", { width, height: phone ? 844 : 900, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
    if (await b!.evaluate("location.protocol") === "about:") await b!.navigate("/favicon.png");
    await b!.evaluate(`localStorage.setItem('prefer_desktop','true');localStorage.setItem('liberty-theme',${JSON.stringify(theme)})`);
  };
  const dayKey = () => b!.evaluate(`(()=>{const d=new Date(${JSON.stringify(hour(0))});return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`) as Promise<string>;
  const openCalendar = async () => {
    await b!.navigate("/dashboard/tasks-appointments?tab=calendar");
    await until(async () => (await count('[data-testid="calendar-page"]')) === 1 && (await count('[data-testid="calendar-loading"]')) === 0, "calendar page");
    await b!.click(`[data-testid="calendar-day-${await dayKey()}"]`);
  };
  const luminance = (selector: string) => b!.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return -1;
    const m=getComputedStyle(e).backgroundColor.match(/[\\d.]+/g)||[];const [r,g,bl]=m.slice(0,3).map(Number);return (0.2126*r+0.7152*g+0.0722*bl)/255})()`) as Promise<number>;
  const fits = (selector: string) => b!.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();
    return {l:r.left,r:r.right,w:window.innerWidth}})()`) as Promise<{ l: number; r: number; w: number } | null>;

  await setView(1280, "light");
  await openCalendar();

  // ── 1. Source filter ──
  await until(async () => (await count(`[data-testid="event-item-appointment_${s1}"]`)) === 1, "sales appointment on the selected day");
  const shown = async () => (await b!.evaluate(`[...document.querySelectorAll('[data-testid^="event-item-"]')].map(e=>e.getAttribute('data-testid').replace('event-item-',''))`)) as string[];
  check((await count('[data-testid="calendar-source-filter"] [data-testid^="filter-source-"]')) === 4, "the source filter offers all, sales, account and local");
  check((await shown()).includes(`appointment_${s1}`) && !(await shown()).includes(`appointment_${a1}`), "All sources reads the sales calendar and does not include the account calendar");
  check(/GHL · sales calendar/.test(await text(`[data-testid="badge-event-source-appointment_${s1}"]`)), "a sales appointment is labelled as the GHL sales calendar");
  const readsBeforeAccount = providerReads.length;
  await b.click('[data-testid="filter-source-account"]');
  await until(async () => (await count(`[data-testid="event-item-appointment_${a1}"]`)) === 1, "account appointment after switching");
  check(!(await shown()).includes(`appointment_${s1}`) && providerReads.length === readsBeforeAccount + 1 && providerReads.at(-1)!.includes(`calendarId=${ACCT_ID}`),
    "Account shows only the account calendar and reads exactly that calendar (no fallback to sales)");
  check(/GHL · account calendar/.test(await text(`[data-testid="badge-event-source-appointment_${a1}"]`)), "an account appointment is labelled as the GHL account calendar");
  const readsBeforeLocal = providerReads.length;
  await b.click('[data-testid="filter-source-local"]');
  await until(async () => /saved in this CRM only/.test(await text('[data-testid="text-source-filter-hint"]')) && (await count('[data-testid="event-item-appointment_' + a1 + '"]')) === 0, "local filter");
  await settle(600);
  check(providerReads.length === readsBeforeLocal && (await count('[data-testid^="event-item-appointment_"]')) === 0,
    "negative control: Local makes no provider read and shows no provider appointment");
  await b.click('[data-testid="filter-source-sales"]');
  await until(async () => (await count(`[data-testid="event-item-appointment_${s1}"]`)) === 1, "sales filter");
  check(true, "Sales calendar shows the sales appointments again");

  // Unconfigured account calendar is an explicit unavailable state, not an empty month.
  delete process.env.AM_CALENDAR_URL;
  await openCalendar();
  await b.click('[data-testid="filter-source-account"]');
  await until(async () => (await count('[data-testid="text-calendar-not-configured"]')) === 1, "account not configured notice");
  check(!/No events scheduled/.test(await text('[data-testid="text-no-events"]')) && /not configured/.test(await text('[data-testid="text-no-events"]')),
    "negative control: an unconfigured account calendar says so; it does not read 'No events scheduled'");
  process.env.AM_CALENDAR_URL = ACCOUNT_URL;
  await openCalendar();
  await until(async () => (await count(`[data-testid="event-item-appointment_${s1}"]`)) === 1, "all filter restored");

  // ── 2. Detail drawer ──
  await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="drawer-current"]')) === 1, "drawer occurrence");
  check(/Yes/.test(await text('[data-testid="drawer-current"]')) && /booked/.test(await text('[data-testid="drawer-recorded-status"]')),
    "the drawer shows the recorded status and that s1 is the current meeting");
  check(await count('[data-testid="drawer-command-unknown"]') === 1 && /not retried automatically/.test(await text('[data-testid="drawer-command-unknown"]')),
    "the drawer shows the unknown command and that it is not retried");
  check(/Last recorded provider event/.test(await text('[data-testid="drawer-observation"]')) && !/No provider event recorded/.test(await text('[data-testid="drawer-observation"]')) &&
    /Provider calendar read/.test(await text('[data-testid="drawer-observation"]')) && !/Provider calendar read\s*Not recorded/.test(await text('[data-testid="drawer-observation"]')),
    "the drawer shows both the last provider read and the last recorded provider event");
  check(/Ownedfirst Ownedlast/.test(await text('[data-testid="drawer-contact"]')), "the drawer names the contact through the authorized single-contact read");
  await b.screenshot("drawer-1280-light");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, "drawer closes on Escape");
  await b.click(`[data-testid="button-event-details-appointment_${s2}"]`);
  await until(async () => (await count('[data-testid="drawer-current"]')) === 1, "drawer s2");
  check(/No — another open appointment is current/.test(await text('[data-testid="drawer-current"]')) && (await count('[data-testid="drawer-command-accepted"]')) === 1,
    "the later appointment is shown as not current and shows its accepted command");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, "drawer closes");
  await b.click(`[data-testid="button-event-details-appointment_${s3}"]`);
  await until(async () => (await count('[data-testid="drawer-command-pending"]')) === 1, "drawer pending command");
  check(/Pending/.test(await text('[data-testid="drawer-command-pending"]')), "the drawer shows a pending command as pending, not as sent or failed");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, "drawer closes again");
  await b.click('[data-testid="filter-source-account"]');
  await until(async () => (await count(`[data-testid="button-event-details-appointment_${a1}"]`)) === 1, "account details button");
  await b.click(`[data-testid="button-event-details-appointment_${a1}"]`);
  await until(async () => (await count('[data-testid="drawer-not-recorded"]')) === 1, "not recorded notice");
  check(/No recorded occurrence/.test(await text('[data-testid="drawer-not-recorded"]')) && (await count('[data-testid="drawer-no-commands"]')) === 1,
    "an appointment with no recorded state says so and lists no command (never a guessed state)");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, "drawer closes after account");
  await b.click('[data-testid="filter-source-all"]');
  await until(async () => (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, "all restored again");
  b.failRead(`/api/appointments/${s1}/detail`, { exact: true });
  await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="button-retry-detail"]')) === 1, "detail failure state");
  check((await count('[data-testid="drawer-not-recorded"]')) === 0 && /not “no record”/.test(await text('[data-testid="drawer-occurrence"]')),
    "negative control: a failed detail read is shown as unavailable with Retry, never as 'no recorded occurrence'");
  b.failRead(null);
  await b.click('[data-testid="button-retry-detail"]');
  await until(async () => (await count('[data-testid="drawer-current"]')) === 1, "detail recovers on retry");
  check(true, "Retry recovers the drawer once the read succeeds");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, "drawer closes after retry");

  // ── 3. Contact picker: scoped paginated search, never the first 250 ──
  check(!b.requests.some((r) => /^\/api\/contacts\?/.test(r.url) && /limit=250/.test(r.url)), "the Calendar never requests the first 250 contacts");
  await b.click('[data-testid="button-add-event"]');
  await until(async () => (await count('[data-testid="event-contact-picker-search"]')) === 1, "contact picker");
  await b.set('[data-testid="event-contact-picker-search"]', "Quillfeather");
  await until(async () => (await count(`[data-testid="event-contact-picker-option-${target}"]`)) === 1, "scoped search result");
  const searchReq = b.requests.filter((r) => /^\/api\/contacts\?/.test(r.url) && /search=Quillfeather/.test(r.url)).pop();
  check(!!searchReq && /limit=25(&|$)/.test(searchReq.url) && searchReq.status === 200,
    `the picker found a contact outside the first 250 (of ${total}) through the scoped, paged search (limit 25)`);
  check((await count('[data-testid^="event-contact-picker-option-"]')) === 1, "the search is scoped: only the matching contact is offered");
  await b.click(`[data-testid="event-contact-picker-option-${target}"]`);
  await b.set('[data-testid="input-event-title"]', `4c2 picked ${tag}`);
  await b.set('[data-testid="input-event-date"]', "2030-06-15");
  await b.click('[data-testid="button-submit-event"]');
  await until(async () => (await h.pool.query(`SELECT 1 FROM calendar_events WHERE title=$1 AND contact_id=$2`, [`4c2 picked ${tag}`, target])).rowCount === 1, "local event created with the picked contact");
  check(true, "a local event created from the picker is stored against the picked contact through the real POST with CSRF");
  b.failRead("/api/contacts", { exact: true });
  await openCalendar();
  await b.click('[data-testid="button-add-event"]');
  await until(async () => (await count('[data-testid="event-contact-picker-search"]')) === 1, "picker under failure");
  await b.set('[data-testid="event-contact-picker-search"]', "Quill");
  await until(async () => /Contact search unavailable/.test(await bodyText()), "picker failure copy");
  check(!/No authorized contacts match/.test(await bodyText()), "negative control: a failed contact search is unavailable, not 'no match'");
  b.failRead(null);

  // ── 4. Run history: server-paged and searchable ──
  await b.navigate("/dashboard/workflows");
  await until(async () => (await count('[data-testid="tab-runs"]')) === 1, "runs tab");
  await b.click('[data-testid="tab-runs"]');
  await until(async () => (await count('[data-testid^="row-run-"]')) > 0, "run rows");
  check((await count('[data-testid^="row-run-"]')) === 25, "the first page renders exactly 25 runs");
  check(new RegExp(`of ${runTotal}$`).test((await text('[data-testid="text-run-range"]')).trim()) && new RegExp(`Run History \\(${runTotal}\\)`).test(await text('[data-testid="tab-runs"]')),
    `the range and tab show the server total (${runTotal}), not the loaded row count`);
  const firstRun = requestsToRuns().at(0)!;
  check(/limit=25/.test(firstRun) && /offset=0/.test(firstRun) && !b.requests.some((r) => r.url === "/api/workflow-runs"),
    "the screen only requests bounded pages and never the whole table");
  await b.evaluate(`document.querySelector('[data-testid="button-runs-next"]').scrollIntoView({block:'center'})`);
  await b.click('[data-testid="button-runs-next"]');
  await until(async () => /Showing 26–50/.test(await text('[data-testid="text-run-range"]')), "page 2");
  check((await count('[data-testid^="row-run-"]')) === 25, "Next shows the following 25 runs from the server");
  await b.set('[data-testid="input-run-search"]', "contact #990001");
  await until(async () => (await count('[data-testid^="row-run-"]')) === 1, "search narrows to one run");
  check(/Showing 1–1 of 1/.test(await text('[data-testid="text-run-range"]')) && /contact #990001/.test(await text('[data-testid^="row-run-"]')),
    "searching resets to the first page and the server returns the matching run");
  await b.set('[data-testid="input-run-search"]', `zebra-${tag}`);
  await until(async () => (await count('[data-testid^="row-run-"]')) === 2, "search by workflow name");
  check(await b.evaluate(`[...document.querySelectorAll('[data-testid^="text-run-status-"]')].some(e=>e.textContent==='completed · 1 step not delivered')`), "a historical run with an undelivered step still reads 'completed · 1 step not delivered'");
  await b.set('[data-testid="input-run-search"]', `no-such-run-${tag}`);
  await until(async () => (await count('[data-testid="run-history-empty"]')) === 1, "empty search");
  check(/No workflow runs match this search/.test(await text('[data-testid="run-history-empty"]')), "a search with no match says so, and offers no stale rows");
  await b.set('[data-testid="input-run-search"]', "");
  await until(async () => (await count('[data-testid^="row-run-"]')) === 25, "search cleared");
  b.failRead("/api/workflow-runs", { exact: true });
  await b.navigate("/dashboard/workflows");
  await until(async () => (await count('[data-testid="tab-runs"]')) === 1, "runs tab");
  await b.click('[data-testid="tab-runs"]');
  await until(async () => (await count('[data-testid="run-history-unavailable"]')) === 1, "run history failure");
  check((await count('[data-testid="run-history-empty"]')) === 0 && /not an empty history/.test(await text('[data-testid="run-history-unavailable"]')),
    "negative control: a failed run-history read is unavailable with Retry, never an empty history");
  b.failRead(null);

  // ── 5. Width × theme matrix: 1280, 768 and 390, light and dark ──
  const matrix: Array<Record<string, unknown>> = [];
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 768, 390]) {
      await setView(width, theme);
      await openCalendar();
      await until(async () => (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, `calendar at ${width} ${theme}`);
      const dark = await b.evaluate(`document.documentElement.classList.contains('dark')`) as boolean;
      check(dark === (theme === "dark"), `${theme} theme is applied at ${width}px`);
      const calOverflow = await overflow();
      check(calOverflow <= 1, `the Calendar does not scroll sideways at ${width}px ${theme} (overflow ${calOverflow}px)`);
      const filterBox = await b.evaluate(`(()=>{const items=[...document.querySelectorAll('[data-testid^="filter-source-"]')];const w=window.innerWidth;
        return {all:items.every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=w+1}),tall:items.every(e=>e.getBoundingClientRect().height>=40)}})()`) as { all: boolean; tall: boolean };
      check(filterBox.all && filterBox.tall, `the source filter wraps inside the viewport with touch-sized buttons at ${width}px ${theme}`);
      await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
      await until(async () => (await count('[data-testid="drawer-current"]')) === 1, `drawer at ${width} ${theme}`);
      await settle(900); // let the slide-in animation finish before measuring
      const box = await fits('[data-testid="calendar-detail-drawer"]');
      check(!!box && box.l >= -1 && box.r <= box.w + 1, `the detail drawer fits the ${width}px viewport (${theme})`);
      const lum = await luminance('[data-testid="calendar-detail-drawer"]');
      check(theme === "dark" ? lum >= 0 && lum < 0.35 : lum > 0.65, `the drawer surface follows the ${theme} theme at ${width}px (luminance ${lum.toFixed(2)})`);
      check(await b.evaluate(`(()=>{const e=document.querySelector('[data-testid="drawer-commands"]');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.left>=-1&&r.right<=window.innerWidth+1})()`) as boolean,
        `the command-state section is readable inside the viewport at ${width}px ${theme}`);
      await b.screenshot(`calendar-drawer-${width}-${theme}`);
      await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await until(async () => (await count('[data-testid="calendar-detail-drawer"]')) === 0, `drawer closed at ${width} ${theme}`);
      await b.navigate("/dashboard/workflows");
      await until(async () => (await count('[data-testid="tab-runs"]')) === 1, "runs tab");
  await b.click('[data-testid="tab-runs"]');
      await until(async () => (await count('[data-testid^="row-run-"]')) === 25, `runs at ${width} ${theme}`);
      const runOverflow = await overflow();
      const scroller = await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Workflow run history"]');return !!e&&e.getAttribute('role')==='region'})()`) as boolean;
      const controls = await b.evaluate(`(()=>{const w=window.innerWidth;return ['[data-testid="input-run-search"]','[data-testid="select-run-status"]','[data-testid="button-runs-next"]'].every(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=w+1})})()`) as boolean;
      check(runOverflow <= 1 && scroller && controls, `Run History controls fit and any table scrolling sits in a labelled region at ${width}px ${theme} (overflow ${runOverflow}px)`);
      await b.screenshot(`run-history-${width}-${theme}`);
      matrix.push({ width, theme, calendarOverflow: calOverflow, runOverflow, drawerLuminance: lum });
    }
  }

  check((await sideEffects()).o === before.o && (await sideEffects()).r === before.r && (await sideEffects()).s === before.s,
    "browsing, filtering and previewing created no outbound message, workflow run or appointment state");
  check(b.exceptions.length === 0, "no uncaught browser exceptions");
  check(h.externalCalls() === 0, "no external provider egress (the provider read was the injected fixture)");
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ status: "passed", identity, fixture: h.prefix, checks, matrix,
    qualification: "Real-browser run on a disposable database with the compiled client and real sessions; the appointment provider read is an injected fixture and booking-command receipts come from the real command writer with a fake provider. 1280/768/390 in light and dark. Not published-candidate or production acceptance; no live provider appointment or booking command was exercised." }, null, 2));
  console.log(`STAGE4C2_BROWSER_PASS (${checks.length} checks)`);
  function requestsToRuns() { return b!.requests.filter((r) => r.url.startsWith("/api/workflow-runs")).map((r) => r.url); }
} catch (error) {
  await b?.screenshot("failure").catch(() => undefined);
  await writeFile(`${dir}/failed-receipt.json`, JSON.stringify({ status: "failed", identity, error: String(error), checks }, null, 2)).catch(() => undefined);
  console.error(`STAGE4C2_BROWSER_FAIL after ${checks.length} checks: ${String(error)}`);
  throw error;
} finally {
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  restore("GHL_DEFAULT_CALENDAR_ID", envBefore.sales); restore("AM_CALENDAR_URL", envBefore.account);
  restore("GHL_CALENDAR_BOOKING_URL", envBefore.url); restore("GHL_DEFAULT_BOOKING_LINK", envBefore.link);
  await b?.close();
  await h.close();
}
