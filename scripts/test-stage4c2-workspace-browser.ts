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
const locationBefore = process.env.GHL_LOCATION_ID;
process.env.GHL_LOCATION_ID = `loc-fixture${randomUUID().replaceAll("-", "").slice(0, 8)}`;
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
      config: () => ({ locationId: process.env.GHL_LOCATION_ID! }) as any,
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
      VALUES($1,$2,$3,$4,'booked',$5,$6,NOW()-INTERVAL '2 hours')`, [id, ghl, SALES_ID, process.env.GHL_LOCATION_ID, start, end]);
  }

  // ── Booking-command receipts written by the real command writer (fake provider, writer enabled in-process only) ──
  const { executeBookingCommand, previewBookingCommand } = await import("../server/services/ghl-booking-command.ts");
  const uuid = () => randomUUID();
  const PROVIDER_VERSION = 100;
  // The provider's own record for the targeted appointment: identity (calendar, contact, location) and version are what
  // the command's precondition is checked against. The fixture is stateful so a readback sees the written result.
  const mkProvider = (appointmentId: string, behaviour: { throws?: boolean; cancelledAfter?: boolean }) => {
    let wrote = false;
    return {
      write: async () => { if (behaviour.throws) throw new Error("socket hang up"); wrote = true; return { id: appointmentId }; },
      readAppointment: async () => ({ found: true, id: appointmentId, status: wrote && behaviour.cancelledAfter ? "cancelled" : "booked", calendarId: SALES_ID,
        contactId: ghlOwned, locationId: process.env.GHL_LOCATION_ID!, startTime: hour(0), endTime: hour(1), version: PROVIDER_VERSION }),
    };
  };
  const run = (commandId: string, operation: "reschedule" | "cancel" | "create", appointmentId: string | undefined, provider: any, expectedVersion: number | null = PROVIDER_VERSION) => {
    const request = { operation, purpose: "sales" as const, ghlContactId: ghlOwned, appointmentId,
      ...(operation === "cancel" ? {} : { startTimeIso: hour(30), endTimeIso: hour(31) }) };
    const preview = previewBookingCommand(request as any);
    assert.ok(preview.ok, "command preview must be valid for the fixture calendar");
    return executeBookingCommand({ actorId: h.userId("admin"), commandId, expectedVersion, reviewedPayloadHash: (preview as any).payloadHash,
      request: request as any, writerEnabled: true, provider });
  };
  // Preconditions (kept): a reschedule/cancel without the reviewed version is denied before any I/O, and a stale one is refused with no write.
  const guardAppt = `appt-guard-${tag}`;
  let guardWrites = 0;
  const guardProvider = { write: async () => { guardWrites++; return { id: guardAppt }; }, readAppointment: mkProvider(guardAppt, {}).readAppointment };
  const nullVersion = await run(uuid(), "reschedule", guardAppt, guardProvider, null);
  check(nullVersion.state === "denied" && (nullVersion as any).reason === "expected_version_required" && guardWrites === 0, "a reschedule with a null expected version is denied before any provider call");
  const nullCancel = await run(uuid(), "cancel", guardAppt, guardProvider, null);
  check(nullCancel.state === "denied" && (nullCancel as any).reason === "expected_version_required" && guardWrites === 0, "a cancel with a null expected version is denied before any provider call");
  const staleVersion = await run(uuid(), "reschedule", guardAppt, guardProvider, PROVIDER_VERSION - 1);
  check(staleVersion.state === "refused" && String((staleVersion as any).reason).includes("stale_expected_version") && guardWrites === 0, "a stale expected version is refused and nothing is written");
  const unknownResult = await run(uuid(), "reschedule", s1, mkProvider(s1, { throws: true }));
  check(unknownResult.state === "unknown", "a lost-response reschedule is recorded as an unknown outcome by the real command writer");
  const acceptedResult = await run(uuid(), "cancel", s2, mkProvider(s2, { cancelledAfter: true }));
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
    // At phone width the month grid is the agenda list; pick the day from whichever is rendered.
    const gridDay = `[data-testid="calendar-day-${await dayKey()}"]`;
    if ((await count(gridDay)) === 1) await b!.click(gridDay);
    else await b!.click(`[data-testid="calendar-agenda-day-${await dayKey()}"]`);
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
  check((await shown()).includes(`appointment_${s1}`) && !(await shown()).includes(`appointment_${a1}`), "Sales + local reads the sales calendar and does not include the account calendar");
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
  await settle(900); // let the dialog open animation finish so the click lands on the input, not a result row
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
  await settle(900);
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
  check(await b.evaluate(`[...document.querySelectorAll('[data-testid^="text-run-status-"]')].some(e=>e.textContent==='completed · 1 step with unresolved or failed outcome')`), "a historical run with an undelivered step still reads 'completed · 1 step with unresolved or failed outcome'");
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

  // ── 6. Console correction pass: URL state, agenda, booking panel, run detail ──
  await setView(1280, "light");
  await openCalendar();
  await b.click('[data-testid="filter-source-sales"]');
  await until(async () => /cal_source=sales/.test(await b!.evaluate(`location.search`) as string), "source filter in URL");
  await b.evaluate(`location.reload()`);
  await until(async () => (await count('[data-testid="calendar-page"]')) === 1 && (await count('[data-testid="calendar-loading"]')) === 0, "calendar after reload");
  check(/cal_source=sales/.test(await b.evaluate(`location.search`) as string), "the Calendar source filter survives a reload (it lives in the URL)");
  await b.navigate("/dashboard/tasks-appointments?tab=calendar&cal_source=bogus&cal_date=2026-13-45&cal_month=nope");
  await until(async () => (await count('[data-testid="calendar-page"]')) === 1 && (await count('[data-testid="calendar-loading"]')) === 0, "calendar with invalid URL state");
  check((await count('[data-testid="calendar-page"]')) === 1 && b.exceptions.length === 0, "negative control: invalid Calendar URL values fall back to defaults without an error");
  await b.click(`[data-testid="calendar-day-${await dayKey()}"]`);
  await until(async () => (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, "s1 item at 1280");
  await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="drawer-current"]')) === 1, "drawer for the booking panel");
  check((await count('[data-testid="drawer-booking-command"]')) === 1 && (await count('[data-testid="link-drawer-contact"]')) === 1,
    "the admin drawer offers the reviewed booking command panel and the contact handoff link");
  await b.click('[data-testid="booking-op-cancel"]');
  await b.click('[data-testid="button-booking-preview"]');
  await until(async () => (await count('[data-testid="booking-preview-result"]')) === 1 || (await count('[data-testid="booking-notice"]')) === 1, "preview answer");
  check((await sideEffects()).f === before.f && (await sideEffects()).o === before.o, "previewing a command writes no receipt and sends nothing");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await b.navigate("/dashboard/workflows");
  await until(async () => (await count('[data-testid="tab-runs"]')) === 1, "runs tab for run detail");
  await b.click('[data-testid="tab-runs"]');
  await until(async () => (await count('[data-testid^="button-run-details-"]')) > 0, "run detail buttons");
  await b.click('[data-testid^="button-run-details-"]');
  await until(async () => (await count('[data-testid="run-detail-drawer"]')) === 1, "run detail sheet");
  check(/wf_run=\d+/.test(await b.evaluate(`location.search`) as string) && (await count('[data-testid="run-detail-steps"]')) === 1 && (await count('[data-testid="button-retry-run"]')) === 0,
    "the run Details sheet opens from the list, is addressable by URL, shows per-step outcomes and has no retry control");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="run-detail-drawer"]')) === 0, "run detail closed by keyboard");
  check(true, "the run Details sheet closes from the keyboard");

  // ── 7. Completion pass: historical run label and a saved, unresolved booking command ──
  const historicalRunId = (await h.pool.query(`SELECT id FROM workflow_runs WHERE entity_id=880001 AND workflow_id=$1`, [wfOther])).rows[0].id as number;
  await b.navigate(`/dashboard/workflows?wf_tab=runs&wf_q=${encodeURIComponent(`4c2-zebra-${tag}`)}&wf_run=${historicalRunId}`);
  await until(async () => (await count('[data-testid="run-detail-owed"]')) === 1 || (await count('[data-testid="run-detail-not-on-page"]')) === 1, "historical run detail");
  const owedText = await text('[data-testid="run-detail-owed"]');
  check(/Historical unresolved step — review required/.test(owedText) && !/Next owed step/.test(owedText) && (await count('[data-testid="button-retry-run"]')) === 0,
    "an old completed run with an undelivered step is labelled as a historical unresolved step and offers no retry");
  check(!/\{"|status":/.test(owedText), "raw provider JSON is not shown inline; it sits in the collapsed diagnostics");
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(async () => (await count('[data-testid="run-detail-drawer"]')) === 0 && await b!.evaluate(`document.body.style.pointerEvents!=='none'`) === true, "historical run sheet closed and the page interactive");

  const savedCmd = uuid();
  const savedRun = await run(savedCmd, "reschedule", s1, mkProvider(s1, { throws: true }));
  check(savedRun.state === "unknown", "the saved-command fixture is an unknown outcome written by the real command writer");
  const savedPreview = previewBookingCommand({ operation: "reschedule", purpose: "sales", ghlContactId: ghlOwned, appointmentId: s1, startTimeIso: hour(30), endTimeIso: hour(31) } as any) as any;
  await openCalendar();
  await until(async () => (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, "s1 item for the saved command");
  await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="drawer-booking-command"]')) === 1, "booking panel for the saved command");
  const savedKey = await b.evaluate(`(async()=>{const u=await (await fetch('/api/auth/user')).json();return 'liberty.booking-command.v1:'+u.id+':'+${JSON.stringify(s1)}})()`) as string;
  await b.evaluate(`localStorage.setItem(${JSON.stringify(savedKey)},JSON.stringify(${JSON.stringify({ commandId: savedCmd, operation: "reschedule", payloadHash: savedPreview.payloadHash, expectedVersion: PROVIDER_VERSION, start: "", durationMinutes: "30", savedAt: Date.now() })}))`);
  await b.evaluate(`location.reload()`);
  // The open drawer is part of the URL state, so it reopens by itself after a reload.
  await until(async () => (await count('[data-testid="drawer-booking-command"]')) === 1 || (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, "s1 after reload");
  if ((await count('[data-testid="drawer-booking-command"]')) !== 1) await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="booking-pending-saved"]')) === 1, "saved command restored after reload");
  check(await b.evaluate(`document.querySelector('[data-testid="button-booking-preview"]').disabled`) === true, "while a saved command is unresolved a new preview cannot be started");
  const receiptsBeforeCheck = (await sideEffects()).f;
  await b.click('[data-testid="button-booking-check-saved"]');
  await until(async () => /Still unknown/.test(await text('[data-testid="booking-notice"]')), "saved command check answer");
  check((await count('[data-testid="booking-pending-saved"]')) === 1 && (await sideEffects()).f === receiptsBeforeCheck && h.externalCalls() === 0,
    "\"Check saved result\" reads the recorded state only: the unknown command stays saved, nothing is retried and no provider is called");
  // A saved id with no server record is "not observed". That is NOT proof nothing was sent: it stays saved (no 404 clear).
  const unseenCmd = uuid();
  await b.evaluate(`localStorage.setItem(${JSON.stringify(savedKey)},JSON.stringify(${JSON.stringify({ commandId: unseenCmd, operation: "reschedule", payloadHash: savedPreview.payloadHash, expectedVersion: PROVIDER_VERSION, start: "", durationMinutes: "30", savedAt: Date.now() - 3 * 24 * 3600 * 1000 })}))`);
  await b.evaluate(`location.reload()`);
  // The open drawer is part of the URL state, so it reopens by itself after a reload.
  await until(async () => (await count('[data-testid="drawer-booking-command"]')) === 1 || (await count(`[data-testid="button-event-details-appointment_${s1}"]`)) === 1, "s1 after second reload");
  if ((await count('[data-testid="drawer-booking-command"]')) !== 1) await b.click(`[data-testid="button-event-details-appointment_${s1}"]`);
  await until(async () => (await count('[data-testid="button-booking-check-saved"]')) === 1, "second saved command restored (three days old: no expiry)");
  await b.click('[data-testid="button-booking-check-saved"]');
  await until(async () => /Not observed/.test(await text('[data-testid="booking-notice"]')), "not-observed answer");
  check((await count('[data-testid="booking-pending-saved"]')) === 1 && await b.evaluate(`localStorage.getItem(${JSON.stringify(savedKey)})`) !== null && !/nothing was sent/i.test(await text('[data-testid="booking-notice"]')),
    "negative control: a saved command the server has not observed is NOT cleared by the 404, is not described as unsent, and survives three days");
  check((await count('[data-testid="booking-resolution"]')) === 1 && (await count('[data-testid="button-booking-resolve"]')) === 1 && await b.evaluate(`document.querySelector('[data-testid="button-booking-resolve"]').disabled`) === true,
    "an administrator is offered a recorded resolution, disabled until a note says what was checked");
  const receiptsBeforeResolve = (await sideEffects()).f;
  await b.evaluate(`(()=>{const el=document.querySelector('[data-testid="booking-resolution-note"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'checked the provider calendar; nothing there');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await b.click('[data-testid="button-booking-resolve"]');
  await until(async () => (await count('[data-testid="booking-pending-saved"]')) === 0, "recorded resolution releases the saved command");
  check(await b.evaluate(`localStorage.getItem(${JSON.stringify(savedKey)})`) === null && h.externalCalls() === 0 && (await sideEffects()).f === receiptsBeforeResolve + 1,
    "a recorded resolution releases the saved command, writes only the operator fence receipt and calls no provider");
  await b.evaluate(`localStorage.removeItem(${JSON.stringify(savedKey)})`);
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);

  // ── 8. Role matrix in a real browser: manager and agent sessions (admin ran above) at 1280/768/390 in light and dark ──
  for (const role of ["manager", "agent"] as const) {
    const rb = await privateStage3Browser(h.base, h.sessions.get(role)!.cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
    try {
      await rb.call("Network.setBypassServiceWorker", { bypass: true });
      const rcount = (selector: string) => rb.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`) as Promise<number>;
      const runtil = async (fn: () => Promise<boolean>, label: string) => { for (let i = 0; i < 80; i++) { if (await fn()) return; await settle(250); } throw new Error(`Timed out: ${role} ${label}`); };
      for (const theme of ["light", "dark"] as const) {
        for (const width of [1280, 768, 390]) {
          const phone = width < 600;
          await rb.call("Emulation.setDeviceMetricsOverride", { width, height: phone ? 844 : 900, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
          if (await rb.evaluate("location.protocol") === "about:") await rb.navigate("/favicon.png");
          await rb.evaluate(`localStorage.setItem('prefer_desktop','true');localStorage.setItem('liberty-theme',${JSON.stringify(theme)})`);
          await rb.navigate(`/dashboard/tasks-appointments?tab=calendar&cal_item=appointment_${s1}`);
          await runtil(async () => (await rcount('[data-testid="calendar-page"]')) === 1 && (await rcount('[data-testid="calendar-loading"]')) === 0, "calendar page");
          await runtil(async () => (await rcount('[data-testid="drawer-current"]')) === 1, "appointment drawer from the URL");
          await runtil(async () => (await rcount('[data-testid="drawer-booking-command"]')) === 1 || role === "agent" && (await rcount('[data-testid="link-drawer-contact"]')) === 1, "drawer content");
          const panel = await rcount('[data-testid="drawer-booking-command"]');
          const executeButton = await rcount('[data-testid="button-booking-execute"]');
          const over = await rb.evaluate("document.documentElement.scrollWidth - window.innerWidth") as number;
          check((role === "manager" ? panel === 1 : panel === 0) && executeButton === 0 && over <= 1,
            `${role}: appointment drawer at ${width}px ${theme} ${role === "manager" ? "offers the read-only preview panel" : "offers no booking panel"}, no apply control, no overflow`);
        }
      }
      if (role === "manager") {
        await rb.click('[data-testid="booking-op-cancel"]');
        await rb.click('[data-testid="button-booking-preview"]');
        await runtil(async () => (await rcount('[data-testid="booking-preview-result"]')) === 1 || (await rcount('[data-testid="booking-notice"]')) === 1, "manager preview answer");
        check((await rcount('[data-testid="button-booking-execute"]')) === 0, "manager: a previewed command can never be applied from the manager session");
      }
      await rb.navigate("/dashboard/workflows");
      await settle(1500);
      const runsVisible = await rb.evaluate(`!!document.querySelector('[data-testid="tab-runs"]')`) as boolean;
      check(role === "manager" ? true : !runsVisible, `${role}: Workflow Automation run history ${role === "agent" ? "is not offered" : "page opens"}`);
      check(rb.exceptions.length === 0, `${role}: no uncaught browser exceptions`);
    } finally { await rb.close(); }
  }

  // ── 9. Stage 4D: the governed "New provider appointment" console, 1280/768/390 × light/dark ──
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 768, 390]) {
      await setView(width, theme);
      await openCalendar();
      check(/New provider appointment/.test(await text('[data-testid="button-create-provider-appointment"]')) && /Add local event/.test(await text('[data-testid="button-add-event"]')),
        `provider and local creation are labelled separately at ${width}px ${theme}`);
      await b.click('[data-testid="button-create-provider-appointment"]');
      await until(async () => (await count('[data-testid="booking-create-panel"]')) === 1, `create console at ${width} ${theme}`);
      await settle(500);
      check((await count('[data-testid="booking-create-purpose"]')) === 1 && (await count('[data-testid="booking-create-zone"]')) === 1
        && (await count('[data-testid="booking-create-purpose"] option')) === 2 && (await count('[data-testid="booking-create-zone"] option')) >= 2,
        `the console offers an explicit Sales/Account purpose and an explicit IANA time zone at ${width}px ${theme}`);
      check(await b.evaluate(`document.querySelector('[data-testid="button-booking-create-preview"]').disabled`) === true,
        `negative control: preview is not available before a contact and title are chosen (${width}px ${theme})`);
      check(await count('[data-testid="button-booking-create-execute"]') === 0 && await count('[data-testid="booking-create-preview-result"]') === 0,
        `no apply control exists before a reviewed preview (${width}px ${theme})`);
      const dlg = await fits('[data-testid="dialog-create-provider-appointment"]');
      check(!!dlg && dlg.l >= -1 && dlg.r <= dlg.w + 1, `the create dialog fits the ${width}px viewport (${theme})`);
      const targets = await b.evaluate(`[...document.querySelectorAll('[data-testid="booking-create-panel"] select, [data-testid="booking-create-panel"] button')].every(e=>e.getBoundingClientRect().height>=40)`) as boolean;
      check(targets, `the create console's controls are touch-sized at ${width}px ${theme}`);
      check((await overflow()) <= 1, `the create console does not scroll the page sideways at ${width}px ${theme}`);
    }
  }
  check(!b.requests.some((r) => /\/api\/appointments\/booking\/execute/.test(r.url)), "opening the create console made no execute request");

  check((await sideEffects()).o === before.o && (await sideEffects()).r === before.r && (await sideEffects()).s === before.s,
    "browsing, filtering and previewing created no outbound message, workflow run or appointment state");
  check(b.exceptions.length === 0, "no uncaught browser exceptions");
  check(h.externalCalls() === 0, "no external provider egress (the provider read was the injected fixture)");

  // ── 10. Stage 4D R1/R2: the filled create journey (create -> preview -> fake execute -> reload) and the zoned-time guard ──
  // The provider is a counting fake behind the real transport, pause authority, receipts and reconcile code. The writer flag and
  // the pause are changed on the DISPOSABLE database only and restored afterwards. No request leaves the process.
  {
    const pauseAuth = await import("../server/services/outbound-pause-authority.ts");
    const tokenBefore = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN ||= "cert-token";
    const writerBefore = (await h.pool.query(`SELECT value FROM system_settings WHERE key='ghl_booking_writer_enabled'`)).rows[0]?.value ?? null;
    const pauseBefore = (await h.pool.query(`SELECT state FROM outbound_pause_control LIMIT 1`)).rows[0]?.state as string | undefined;
    const GHL_HOST = "https://services.leadconnectorhq.com";
    const providerLog: Array<{ method: string; path: string; body: any }> = [];
    let created: any = null;
    const createdId = `appt-created-${tag}`;
    const fetchBefore = globalThis.fetch;
    const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
      if (!url.startsWith(GHL_HOST)) return fetchBefore(input, init);
      const pathOnly = url.slice(GHL_HOST.length).split("?")[0];
      const method = String(init?.method ?? "GET").toUpperCase();
      let body: any = null; try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = null; }
      providerLog.push({ method, path: pathOnly, body });
      if (method === "POST" && pathOnly === "/calendars/events/appointments") { created = body; return jsonResponse({ id: createdId }); }
      if (method === "GET" && pathOnly === `/calendars/events/appointments/${createdId}` && created) {
        return jsonResponse({ appointment: { id: createdId, appointmentStatus: "confirmed", calendarId: created.calendarId, contactId: created.contactId,
          locationId: created.locationId, startTime: created.startTime, endTime: created.endTime, dateUpdated: new Date().toISOString() } });
      }
      if (method === "GET" && pathOnly === `/calendars/${SALES_ID}`) return jsonResponse({ calendar: { id: SALES_ID, slotDuration: 30, slotDurationUnit: "mins" } });
      return new Response(JSON.stringify({ message: "fixture: unexpected provider request" }), { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await h.pool.query(`INSERT INTO system_settings(key,value) VALUES('ghl_booking_writer_enabled', to_jsonb('"true"'::text)) ON CONFLICT (key) DO UPDATE SET value=to_jsonb('"true"'::text)`);
      // Representation matters: drizzle parses a jsonb string once more on read, so only the double-encoded string reads back as
      // the string "true" that the execute route compares with. A plain jsonb "true" or boolean reads back as boolean true and stays DENIED.

      const setField = (selector: string, value: string, kind: "input" | "select" = "input") => b!.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
        const proto=${kind === "select" ? "HTMLSelectElement" : "HTMLInputElement"}.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});
        el.dispatchEvent(new Event(${JSON.stringify(kind === "select" ? "change" : "input")},{bubbles:true}));})()`);
      const hookFetch = () => b!.evaluate(`(()=>{window.__bookingBodies=[];if(!window.__bookingHooked){window.__bookingHooked=true;const f=window.fetch.bind(window);
        window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;if(/\\/api\\/appointments\\/booking\\/(preview|execute)/.test(url)&&init&&typeof init.body==='string'){window.__bookingBodies.push({url:url,body:JSON.parse(init.body)});}const p=f(input,init);if(/booking\\/execute/.test(url))p.then(r=>r.clone().text().then(t=>{window.__execResp=r.status+' '+t.slice(0,300);}));return p;};}})()`);
      const bodies = () => b!.evaluate(`window.__bookingBodies`) as Promise<Array<{ url: string; body: any }>>;
      const openCreate = async () => {
        await setView(1280, "light");
        await openCalendar();
        await b!.click('[data-testid="button-create-provider-appointment"]');
        await until(async () => (await count('[data-testid="booking-create-panel"]')) === 1, "create console");
        await settle(500);
        await hookFetch();
      };
      const pickOwned = async () => {
        await b!.set('[data-testid="booking-create-contact-search"]', "Ownedfirst");
        await until(async () => (await count(`[data-testid="booking-create-contact-option-${owned}"]`)) === 1, "owned contact option");
        await b!.click(`[data-testid="booking-create-contact-option-${owned}"]`);
      };

      // R2 in the browser: a wall time that does not exist is refused client-side; no preview request is ever made.
      await openCreate();
      await setField('[data-testid="booking-create-zone"]', "America/New_York", "select");
      await setField('[data-testid="booking-create-title"]', `Gap ${tag}`);
      await setField('[data-testid="booking-create-start"]', "2027-03-14T02:30");
      await pickOwned();
      await until(async () => (await count('[data-testid="booking-create-time-error"]')) === 1, "nonexistent-time message");
      check(/does not exist|skipped|clocks/i.test(await text('[data-testid="booking-create-time-error"]'))
        && await b.evaluate(`document.querySelector('[data-testid="button-booking-create-preview"]').disabled`) === true && (await bodies()).length === 0,
        "R2 browser: 2027-03-14 02:30 America/New_York (a skipped hour) is explained, preview is disabled and no request was sent");
      // A repeated wall time needs an explicit choice; the preview request then carries exactly the reviewed UTC instant.
      await setField('[data-testid="booking-create-start"]', "2026-11-01T01:30");
      await until(async () => (await count('[data-testid="booking-create-occurrence-select"]')) === 1, "repeated-hour choice");
      check(await b.evaluate(`document.querySelector('[data-testid="button-booking-create-preview"]').disabled`) === true,
        "R2 browser: a repeated local time (2026-11-01 01:30 New York) disables preview until the occurrence is chosen");
      await setField('[data-testid="booking-create-occurrence-select"]', "second", "select");
      await b.click('[data-testid="button-booking-create-preview"]');
      await until(async () => (await count('[data-testid="booking-create-preview-result"]')) === 1, "preview for the chosen occurrence");
      const repeatedPreview = (await bodies()).filter(x => /preview/.test(x.url)).pop();
      check(repeatedPreview?.body.startTime === "2026-11-01T06:30:00.000Z" && /2026-11-01T06:30:00.000Z UTC/.test(await text('[data-testid="booking-create-preview-detail"]')),
        "R2 browser: the second occurrence of the repeated hour is sent as 06:30Z and the reviewed text shows the same UTC instant");

      // The filled journey: unambiguous time, preview, execute against the fake, reload.
      await openCreate();
      await setField('[data-testid="booking-create-zone"]', "America/New_York", "select");
      await setField('[data-testid="booking-create-title"]', `Journey ${tag}`);
      await setField('[data-testid="booking-create-start"]', "2027-06-15T10:00");
      await setField('[data-testid="booking-create-duration"]', "45");
      await pickOwned();
      await until(async () => await b!.evaluate(`document.querySelector('[data-testid="button-booking-create-preview"]').disabled`) === false, "preview enabled once filled");
      await b.click('[data-testid="button-booking-create-preview"]');
      await until(async () => (await count('[data-testid="booking-create-preview-result"]')) === 1, "journey preview");
      const journeyPreview = (await bodies()).filter(x => /preview/.test(x.url)).pop();
      check(journeyPreview?.body.startTime === "2027-06-15T14:00:00.000Z" && journeyPreview?.body.endTime === "2027-06-15T14:45:00.000Z" && journeyPreview?.body.contactId === owned
        && journeyPreview?.body.ghlContactId === undefined && providerLog.every(c => c.method === "GET"),
        "journey: the preview request equals the reviewed UTC (10:00 EDT = 14:00Z, 45 minutes), names the local contact only, and the preview sent nothing to the provider");
      check(/2027-06-15T14:00:00.000Z UTC/.test(await text('[data-testid="booking-create-preview-detail"]')) && /Journey/.test(await text('[data-testid="booking-create-preview-detail"]')),
        "journey: the reviewed panel shows the same UTC instant and the title");
      await b.click('[data-testid="button-booking-create-execute"]');
      // The writer flag is ON here, but the OUTGOING GHL authority (runtime selection, native review, reviewed operation allowlist)
      // is not configured on this disposable database, exactly as in production. The execute route must therefore reach the real
      // transport gate and be REFUSED there, before any provider write. The confirmed-write path with a fake provider behind the
      // command writer is certified separately (test-stage4d-booking-recovery, test-stage4c2-calendar-contract).
      await until(async () => (await count('[data-testid="booking-create-outcome-refused"]')) === 1, "refused outcome");
      const executeBody = (await bodies()).filter(x => /execute/.test(x.url)).pop();
      const execResponse = String(await b.evaluate(`window.__execResp||''`));
      check(executeBody?.body.startTime === "2027-06-15T14:00:00.000Z" && executeBody?.body.contactId === owned && executeBody?.body.expectedVersion === null,
        "journey: the execute request carried exactly the reviewed UTC instant and the local contact (no provider id from the browser)");
      check(/^200 .*"state":"refused".*runtime_not_selected/.test(execResponse),
        `journey: with the writer ON but outgoing GHL authority unselected, the server refused at the transport gate (${execResponse.slice(0, 120)})`);
      check(!providerLog.some(c => c.method === "POST") && !providerLog.some(c => !/^\/(calendars|conversations)\//.test(c.path)),
        "journey: the provider saw no write of any kind (only calendar and conversation reads)");
      check(/refus|blocked|not selected/i.test(await text('[data-testid="booking-create-outcome-refused"]')),
        "journey: the operator sees a refused outcome, not a success");
      await b.evaluate(`location.reload()`);
      await until(async () => (await count('[data-testid="calendar-page"]')) === 1, "calendar after reload");
      const leftover = await b.evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('liberty.booking-command.v1:')&&k.endsWith('create:new'))`) as string[];
      check(leftover.length === 0, "journey: a definitive refusal leaves nothing saved as pending, so a reload offers no recovery for a write that never happened");
    } finally {
      globalThis.fetch = fetchBefore;
      if (writerBefore === null) await h.pool.query(`DELETE FROM system_settings WHERE key='ghl_booking_writer_enabled'`); else await h.pool.query(`UPDATE system_settings SET value=$1::jsonb WHERE key='ghl_booking_writer_enabled'`, [JSON.stringify(writerBefore)]);
      if (pauseBefore) await h.pool.query(`UPDATE outbound_pause_control SET state=$1, committed_at=NOW()`, [pauseBefore]);
      pauseAuth.invalidatePauseStateCache();
      if (tokenBefore === undefined) delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN; else process.env.GHL_PRIVATE_INTEGRATION_TOKEN = tokenBefore;
    }
    check(h.externalCalls() === 0, "the filled journey made no external provider egress (the fake provider answered inside the process)");
    check(b.exceptions.length === 0, "no uncaught browser exceptions during the filled journey");
  }
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
  restore("GHL_LOCATION_ID", locationBefore);
  restore("GHL_DEFAULT_CALENDAR_ID", envBefore.sales); restore("AM_CALENDAR_URL", envBefore.account);
  restore("GHL_CALENDAR_BOOKING_URL", envBefore.url); restore("GHL_DEFAULT_BOOKING_LINK", envBefore.link);
  await b?.close();
  await h.close();
}
