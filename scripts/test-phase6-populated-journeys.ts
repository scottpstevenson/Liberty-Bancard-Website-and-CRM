import assert from "node:assert/strict";
import path from "node:path";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

/**
 * Phase 6 populated journeys: real Chromium against the compiled client, real persisted sessions and the real handlers for
 * Inbox items, contact validation history and co-branded proposal events on a disposable database.
 *
 * Stated limits (not hidden): the Ready-for-Outreach queue is populated by a contract-shaped stand-in for the CR04 ready
 * projection (that projection needs provider-validated recipients and launch gates that a disposable database cannot honestly
 * hold); the real projection answers only the empty-scope and refusal checks. The stand-in honors the real skip flag. The Start
 * action is never pressed because it enrolls a contact in a sequence. Fixture scale only; WebKit and real phones cannot run here.
 */
await verifyCandidateIdentity();
const dir = "docs/certification/phase6-closure/populated-journeys";
const clientRoot = path.resolve("dist/public");
const queueStandIn = { enabled: true, rows: [] as number[] };
const h = await stage3BHttpFixture(async (app) => {
  for (const [file, fn] of [
    ["contacts", "registerContactsRoutes"], ["crm-operations", "registerCrmOperationsRoutes"],
    ["activity", "registerActivityRoutes"], ["tickets-tasks", "registerTicketsTasksRoutes"],
    ["notifications", "registerNotificationsRoutes"], ["deals", "registerDealsRoutes"],
    ["message-drafts", "registerMessageDraftRoutes"], ["daily-briefing", "registerDailyBriefingRoutes"],
    ["my-day", "registerMyDayRoutes"], ["toolkit", "registerToolkitRoutes"],
    ["inbox", "registerInboxRoutes"], ["live-chat", "registerLiveChatRoutes"],
    ["analytics", "registerAnalyticsRoutes"], ["conversation-ai-config", "registerConversationAiConfigRoutes"],
    ["nba", "registerNbaRoutes"], ["partner-orgs", "registerPartnerOrgsRoutes"],
  ]) { const module = await import(`../server/routes/${file}.ts`); module[fn](app); }
  const { isDashboardUser } = await import("../server/replit_integrations/auth");
  const { pool } = await import("../server/db");
  // Stand-in for the CR04 ready projection, behind the real dashboard-user guard and ahead of the real owner.
  app.get("/api/outreach-queue", isDashboardUser, async (req, res, next) => {
    if (!queueStandIn.enabled) return next();
    const live = await pool.query(
      `SELECT id,first_name,last_name,company_name,email,phone FROM contacts WHERE id = ANY($1::int[]) AND outreach_queue_skipped_at IS NULL ORDER BY id`,
      [queueStandIn.rows]);
    res.json({
      data: live.rows.map((row: any) => ({
        id: row.id, firstName: row.first_name, lastName: row.last_name, companyName: row.company_name, email: row.email, phone: row.phone,
        vertical: "Automotive", city: "Miami", state: "FL", leadScore: 72, scoreTier: "hot", assignedTo: (req.user as any)?.email ?? null,
        createdAt: new Date().toISOString(), lastScoredAt: new Date().toISOString(), emailStatus: "valid", primaryOfferPath: null,
        dataReadinessScore: 80,
        decision: { qualified: true, channel: "email", sequenceId: 7, policyVersion: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reasonCodes: [] },
      })),
      total: null, exactTotal: false, cursor: 0, nextCursor: null, hasMore: false, limit: 50, channel: "email", policyVersion: 1,
      asOf: new Date().toISOString(), reasonBuckets: {},
    });
  });
  const queue = await import("../server/routes/outreach-queue.ts");
  queue.registerOutreachQueueRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated Phase 6 fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

type Browser = Awaited<ReturnType<typeof privateStage3Browser>>;
const results: Array<Record<string, unknown>> = [];
const checks: string[] = [];
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (ok) { checks.push(label); console.log(`✓ ${label}`); } else { failures.push(label); console.log(`✗ ${label}`); }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const browsers: Browser[] = [];
const watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
await watcher.connect();
async function settleDatabase() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const busy = await watcher.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle' AND backend_type='client backend'`);
    if (busy.rows[0].n === 0) return;
    await sleep(250);
  }
}
async function section(name: string, run: () => Promise<void>) {
  await settleDatabase().catch(() => undefined);
  try { await run(); } catch (error) {
    failures.push(`${name}: ${String((error as Error)?.message ?? error).slice(0, 700)}`);
    console.log(`✗ ${name}: ${String((error as Error)?.message ?? error).slice(0, 400)}`);
  }
}
async function open(cookie: string, zoom?: number): Promise<Browser> {
  const b = await privateStage3Browser(h.base, cookie, h.originalFetch, dir, { realInput: true, zoom, startupTimeoutMs: 40000 });
  browsers.push(b);
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  await b.navigate("/login");
  await b.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')");
  return b;
}
async function until(b: Browser, expression: string, label: string, tries = 160) {
  for (let n = 0; n < tries; n++) { if (await b.evaluate(expression)) return; await sleep(100); }
  const text = String(await b.evaluate("document.body?.innerText ?? ''")).replace(/\s+/g, " ").slice(0, 400);
  const failedReads = b.requests.filter((r) => (r.status ?? 0) >= 400 || r.failed).slice(-8).map((r) => `${r.method} ${r.url.split("?")[0]} ${r.status ?? r.failed}`);
  await b.screenshot(`unmet-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`).catch(() => undefined);
  throw new Error(`Condition not reached: ${label}; URL=${await b.evaluate("location.pathname+location.search")}; page text: "${text}"; failed reads: ${JSON.stringify(failedReads)}`);
}
const setWidth = (b: Browser, width: number, height = 900) =>
  b.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const text = async (b: Browser, selector: string) =>
  String(await b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)).replace(/\s+/g, " ").trim();
const exists = async (b: Browser, selector: string) => !!(await b.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`));
const pageText = async (b: Browser) => String(await b.evaluate("document.body.innerText")).replace(/\s+/g, " ");

async function audit(b: Browser, label: string) {
  const facts = await b.evaluate(`(()=>{
    const named = el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
      if (el.tagName === 'INPUT' && (el.type === 'hidden')) return true;
      if (el.id && document.querySelector('label[for="'+CSS.escape(el.id)+'"]')) return true;
      if (el.closest('label')) return true;
      if ((el.textContent||'').trim().length) return true;
      if (el.querySelector('img[alt]:not([alt=""]),svg[aria-label],[aria-label]')) return true;
      return false;
    };
    const visible = el => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden' && !el.closest('details:not([open]):not(summary)');
    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"]')].filter(visible);
    return { width: innerWidth, dpr: devicePixelRatio, documentWidth: document.documentElement.scrollWidth,
      h1: [...document.querySelectorAll('h1')].map(e => e.textContent.trim().slice(0,60)), controls: controls.length,
      unnamed: controls.filter(el => !named(el)).slice(0,5).map(el => el.tagName + ':' + (el.getAttribute('data-testid')||el.className||'').toString().slice(0,60)) };
  })()`) as any;
  results.push({ label, ...facts });
  const problems: string[] = [];
  if (facts.documentWidth > facts.width + 1) problems.push(`horizontal overflow (${facts.documentWidth} > ${facts.width})`);
  if (facts.h1.length !== 1) problems.push(`expected exactly one h1, found ${JSON.stringify(facts.h1)}`);
  if (facts.unnamed.length) problems.push(`controls without an accessible name ${JSON.stringify(facts.unnamed)}`);
  if (b.exceptions.length) problems.push(`uncaught page exception ${JSON.stringify(b.exceptions.slice(0, 2))}`);
  return problems.map((problem) => `${label}: ${problem}`);
}
async function auditWidths(b: Browser, label: string, url: string, ready: string) {
  const found: string[] = [];
  for (const width of [1280, 768, 454, 390, 320]) {
    await setWidth(b, width);
    await b.navigate(url);
    await until(b, ready, `${label} @${width}`, 300);
    await sleep(500);
    found.push(...await audit(b, `${label} @${width}px`));
  }
  await setWidth(b, 1280);
  return found;
}
const staffLogin = async (b: Browser, role: string) => {
  await b.call("Network.clearBrowserCookies");
  for (const entry of h.sessions.get(role)!.cookie.split("; ")) {
    const i = entry.indexOf("="); await b.call("Network.setCookie", { name: entry.slice(0, i), value: entry.slice(i + 1), url: h.base });
  }
};

try {
  await mkdir(dir, { recursive: true });
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  const phone = (n: number) => "+1908" + String((Date.now() + n) % 10000000).padStart(7, "0");
  const contactRow = async (first: string, last: string, owner: string, n: number, extra: { emailStatus?: string; email?: string } = {}) =>
    Number((await h.pool.query(`INSERT INTO contacts(first_name,last_name,company_name,email,phone,record_class,assigned_to,email_status)
      VALUES($1,$2,'Populated Journey Co',$3,$4,'production',$5,$6) RETURNING id`,
    [first, last, extra.email ?? `${h.prefix}-pj-${n}@example.test`, phone(n), owner, extra.emailStatus ?? "valid"])).rows[0].id);
  const agent = h.email("agent"), other = h.email("other");
  const audit_ = (action: string, contactId: number | null, details: Record<string, unknown>, daysAgo: number, minutesAgo = 0) =>
    h.pool.query(`INSERT INTO audit_logs(action,entity_type,entity_id,details,created_at) VALUES($1,$2,$3,$4::jsonb,NOW()-($5::int*INTERVAL '1 day')-($6::int*INTERVAL '1 minute')) RETURNING id`,
      [action, contactId === null ? "system" : "contact", contactId, JSON.stringify(details), daysAgo, minutesAgo]).then((r) => Number(r.rows[0].id));

  // ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const zbValid = await contactRow("Zbvalid", "Journey", agent, 1);
  const zbStale = await contactRow("Zbstale", "Journey", agent, 2);
  const zbMoved = await contactRow("Zbmoved", "Journey", agent, 3);
  const zbNone = await contactRow("Zbnone", "Journey", agent, 4, { emailStatus: "active" });
  const zbForeign = await contactRow("Zbforeign", "Journey", other, 5);
  const zb = (email: string, status: string, subStatus: string | null) => ({ zbStatus: status, zbSubStatus: subStatus, email, source: "sfp" });
  const emailOf = async (id: number) => String((await h.pool.query("SELECT email FROM contacts WHERE id=$1", [id])).rows[0].email);
  await audit_("zerobounce_email_validated", zbValid, zb(await emailOf(zbValid), "valid", null), 20);
  await audit_("zerobounce_email_validated", zbValid, zb(await emailOf(zbValid), "invalid", "mailbox_not_found"), 60);
  await audit_("zerobounce_email_validated", zbValid, zb(await emailOf(zbValid), "valid", null), 120);
  await audit_("zerobounce_email_validated", zbStale, zb(await emailOf(zbStale), "valid", null), 400);
  await audit_("zerobounce_email_validated", zbMoved, zb("earlier-address@example.test", "valid", null), 10);
  await audit_("zerobounce_email_validated", zbForeign, zb(await emailOf(zbForeign), "valid", null), 5);

  const dealRow = async (name: string, contactId: number, owner: string) =>
    Number((await h.pool.query(`INSERT INTO deals(contact_id,name,pipeline,stage,owner,record_class) VALUES($1,$2,'sales','New Lead',$3,'production') RETURNING id`, [contactId, name, owner])).rows[0].id);
  const proposalRow = (dealId: number, contactId: number, token: string, status: string, merchant: string, viewCount: number, viewedHoursAgo: number | null, accepted = false) =>
    h.pool.query(`INSERT INTO co_branded_proposals(deal_id,contact_id,token,status,merchant_name,view_count,viewed_at,accepted_at)
      VALUES($1,$2,$3,$4,$5,$6,${viewedHoursAgo === null ? "NULL" : "NOW()-($7::int*INTERVAL '1 hour')"},${accepted ? "NOW()" : "NULL"})`,
    viewedHoursAgo === null ? [dealId, contactId, token, status, merchant, viewCount] : [dealId, contactId, token, status, merchant, viewCount, viewedHoursAgo]);
  const pc = await contactRow("Proposal", "Journey", agent, 6);
  const foreignPc = await contactRow("Proposalforeign", "Journey", other, 7);
  const dealAlert = await dealRow("Proposal opened two hours ago", pc, agent);
  const dealViewed = await dealRow("Proposal opened three days ago", pc, agent);
  const dealAccepted = await dealRow("Proposal accepted", pc, agent);
  const dealOld = await dealRow("Proposal opened long ago", pc, agent);
  const dealNone = await dealRow("No proposal at all", pc, agent);
  const dealFailing = await dealRow("Proposal read fails", pc, agent);
  const dealForeign = await dealRow("Foreign owner deal", foreignPc, other);
  // A partner-linked deal shows the drawer's proposal list; the link has no foreign key on deals.
  const partnerOrg = Number((await h.pool.query(`INSERT INTO partner_organizations(name,slug) VALUES('Phase 6 Journey Partner',$1) RETURNING id`, [`${h.prefix}-pj-partner`])).rows[0].id);
  await h.pool.query("UPDATE deals SET partner_org_id=$1 WHERE id=$2", [partnerOrg, dealAlert]);
  await proposalRow(dealAlert, pc, `${h.prefix}-ta`, "viewed", "Proposal Merchant A", 3, 2);
  await proposalRow(dealViewed, pc, `${h.prefix}-tb`, "viewed", "Proposal Merchant B", 1, 72);
  await proposalRow(dealAccepted, pc, `${h.prefix}-tc`, "accepted", "Proposal Merchant C", 4, 30, true);
  await proposalRow(dealOld, pc, `${h.prefix}-td`, "viewed", "Proposal Merchant D", 2, 24 * 20);
  await proposalRow(dealForeign, foreignPc, `${h.prefix}-tf`, "viewed", "Foreign Merchant", 5, 1);
  await proposalRow(dealFailing, pc, `${h.prefix}-te`, "viewed", "Proposal Merchant E", 1, 5);

  const qa = await contactRow("Queue", "Alpha", agent, 8);
  const qb = await contactRow("Queue", "Bravo", agent, 9);
  const qc = await contactRow("Queue", "Charlie", agent, 10);
  const qForeign = await contactRow("Queue", "Foreign", other, 11);
  queueStandIn.rows = [qa, qb, qc];

  const inboxMapped = await contactRow("Inboxmapped", "Journey", agent, 12);
  const inboxForeign = await contactRow("Inboxforeign", "Journey", other, 13);
  const msg = (body: string, isRead = false) => ({ body, intent: "question", isRead, channel: "email" });
  const rUnread = await audit_("inbound_email_received", inboxMapped, msg("Mapped inbound question about estimate timing"), 0, 30);
  const rUnmapped = await audit_("inbound_email_received", null, msg("Inbound message with no linked contact"), 0, 40);
  const rForeign = await audit_("inbound_email_received", inboxForeign, msg("Foreign owner inbound message"), 0, 50);
  const rRead = await audit_("inbound_email_received", inboxMapped, msg("Earlier read message from mapped contact", true), 1);
  const inboxId = (id: number) => `audit:local::email:${id}`;
  const rowSel = (id: number) => `[data-testid="inbox-item-${inboxId(id)}"]`;
  const recordUrl = (id: number) => `/dashboard/contacts/${id}?area=overview&section=overview`;

  const asAgent = await open(h.sessions.get("agent")!.cookie);
  await setWidth(asAgent, 1280);

  // ── A. Contact validation history: success, earlier receipts, stale, moved address, none, failed, denied ──────────────
  await section("validation-history", async () => {
    const openRecord = async (id: number) => {
      await asAgent.navigate(recordUrl(id));
      // The history sits inside the record's closed "Validation, readiness & record diagnostics" disclosure.
      await until(asAgent, "!!document.querySelector('[data-testid=\"contact-context-details-toggle\"]')", `diagnostics disclosure for contact ${id}`, 300);
      await asAgent.click('[data-testid="contact-context-details-toggle"]');
      await until(asAgent, "!!document.querySelector('[data-testid=\"section-zerobounce-history\"]')", `validation history for contact ${id}`, 300);
      await until(asAgent, "!document.querySelector('[data-testid=\"section-zerobounce-history\"]')?.textContent?.includes('Loading')", `validation history settled for ${id}`, 200);
    };
    await openRecord(zbValid);
    check(/Valid/.test(await text(asAgent, '[data-testid="badge-zb-latest-status"]')), "a contact with receipts shows its latest validation outcome (Valid)");
    check(!(await exists(asAgent, '[data-testid="zb-receipt-not-current"]')), "a current receipt for the current address carries no staleness warning");
    check(/2 earlier/.test(await text(asAgent, '[data-testid="button-zb-history-toggle"]')), "earlier receipts are counted (2 earlier)");
    await asAgent.click('[data-testid="button-zb-history-toggle"]');
    await until(asAgent, "!!document.querySelector('[data-testid=\"section-zb-history-older\"]')", "earlier receipts expanded");
    const older = await text(asAgent, '[data-testid="section-zb-history-older"]');
    check(/Invalid/.test(older) && /mailbox_not_found/.test(older), `the earlier invalid receipt and its reason are shown ("${older}")`);
    await asAgent.screenshot("validation-history-populated");

    await openRecord(zbStale);
    check(/days old, past the 180-day window/.test(await text(asAgent, '[data-testid="zb-receipt-not-current"]')), "a receipt older than 180 days is labeled past the window, not presented as current");
    await openRecord(zbMoved);
    check(/earlier email address/.test(await text(asAgent, '[data-testid="zb-receipt-not-current"]')), "a receipt for an earlier address is labeled as not the current address");
    await openRecord(zbNone);
    const none = await text(asAgent, '[data-testid="badge-zb-not-validated"]');
    check(/No validation receipt on record/.test(none) && /legacy value, not a receipt/.test(none), `no receipt: stated plainly and the legacy stored status is not treated as one ("${none}")`);

    asAgent.failRead(`/api/contacts/${zbValid}/zerobounce-history`, { exact: true });
    await asAgent.navigate(recordUrl(zbValid));
    await until(asAgent, "!!document.querySelector('[data-testid=\"contact-context-details-toggle\"]')", "diagnostics disclosure (failed read)", 300);
    await asAgent.click('[data-testid="contact-context-details-toggle"]');
    await until(asAgent, "!!document.querySelector('[data-testid=\"zb-history-unavailable\"]')", "validation history unavailable state", 300);
    check(/not the same as/.test(await text(asAgent, '[data-testid="zb-history-unavailable"]')) && !(await exists(asAgent, '[data-testid="badge-zb-not-validated"]')),
      "a failed history read says unavailable (not the same as 'not validated') and never shows an all-clear or an empty receipt");
    asAgent.failRead(null);
    await asAgent.click('[data-testid="zb-history-unavailable"] button');
    await until(asAgent, "!!document.querySelector('[data-testid=\"badge-zb-latest-status\"]')", "validation history after retry");
    check(true, "Retry recovers the validation history once the read works again");

    const denied = await h.request("agent", "GET", `/api/contacts/${zbForeign}/zerobounce-history`);
    check(denied.status === 404 && !/zbStatus|validatedAt|@example/.test(JSON.stringify(denied.body ?? {})), `an agent reading another owner's validation history is refused with nothing leaked (${denied.status})`);
    const owner = await h.request("other", "GET", `/api/contacts/${zbForeign}/zerobounce-history`);
    check(owner.status === 200 && Array.isArray(owner.body) && owner.body.length === 1, "the owning agent reads the same history");
    const adminRead = await h.request("admin", "GET", `/api/contacts/${zbForeign}/zerobounce-history`);
    check(adminRead.status === 200 && Array.isArray(adminRead.body) && adminRead.body.length === 1, "an administrator reads any contact's history");
    for (const role of ["merchant", "affiliate", "partner"]) {
      const refused = await h.request(role, "GET", `/api/contacts/${zbForeign}/zerobounce-history`);
      check(refused.status === 401 || refused.status === 403 || refused.status === 404, `${role} cannot read validation history (${refused.status})`);
    }
    await asAgent.navigate(recordUrl(zbForeign));
    await sleep(2500);
    check(!(await pageText(asAgent)).includes("Zbforeign") && !(await exists(asAgent, '[data-testid="badge-zb-latest-status"]')), "opening another owner's record in the browser shows neither the record nor its validation receipt");
  });

  // ── B. Proposal engagement on the Pipeline: open attribution, timestamps, deal mapping, failure and retry ────────────
  // The board loads a deal's co-branded proposals when that deal is opened (existing behavior), so each journey opens the deal.
  await section("proposal-events", async () => {
    const proposalId = async (token: string) => Number((await h.pool.query("SELECT id FROM co_branded_proposals WHERE token=$1", [token])).rows[0].id);
    const idA = await proposalId(`${h.prefix}-ta`);
    const cardSel = (id: number) => `[data-testid="card-deal-${id}"]`;
    const escape = async () => {
      await asAgent.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await asAgent.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(500);
    };
    const proposalReadDone = async (id: number) => {
      for (let n = 0; n < 150; n++) {
        if (asAgent.requests.some((r) => r.url.includes(`/api/deals/${id}/co-branded-proposals`) && (r.status !== undefined || r.failed))) return;
        await sleep(100);
      }
      throw new Error(`No proposal read observed for deal ${id}`);
    };
    const openDeal = async (id: number) => { await asAgent.click(cardSel(id)); await proposalReadDone(id); await sleep(400); };

    await asAgent.navigate("/dashboard/pipeline");
    await until(asAgent, `!!document.querySelector('${cardSel(dealAlert)}')`, "Pipeline with proposal deals", 300);
    const beforeOpen = Number(await asAgent.evaluate(`document.querySelectorAll('[data-testid^="badge-proposal-alert-"],[data-testid^="badge-proposal-viewed-"],[data-testid^="badge-proposal-accepted-"]').length`));
    results.push({ label: "Pipeline board before any deal is opened", coBrandedProposalBadges: beforeOpen, note: "existing behavior: proposal events load per deal when the deal is opened" });
    check(!(await exists(asAgent, `[data-testid="card-deal-${dealForeign}"]`)), "another owner's deal is not on this agent's Pipeline");

    await openDeal(dealAlert);
    await until(asAgent, `!!document.querySelector('[data-testid="row-deal-proposal-${idA}"]')`, "deal drawer proposal row", 200);
    const row = await text(asAgent, `[data-testid="row-deal-proposal-${idA}"]`);
    check(/Proposal Merchant A/.test(row) && /Viewed 3×/.test(row), `the deal drawer lists that deal's proposal with its open count ("${row}")`);
    await asAgent.screenshot("pipeline-deal-drawer-proposal");
    await escape();
    const alertText = await text(asAgent, `[data-testid="badge-proposal-alert-${dealAlert}"]`);
    check(/Viewed .*ago!/.test(alertText) && /2 hours/.test(alertText), `a proposal opened within a day shows an alert with its age ("${alertText}")`);
    const alertTitle = String(await asAgent.evaluate(`document.querySelector('[data-testid="badge-proposal-alert-${dealAlert}"]')?.getAttribute('title')`));
    check(/viewed 3 times/.test(alertTitle), `the open count is attached to that deal's badge ("${alertTitle}")`);

    await openDeal(dealViewed); await escape();
    const viewedText = await text(asAgent, `[data-testid="badge-proposal-viewed-${dealViewed}"]`);
    check(/Viewed .*3 days ago/.test(viewedText) && !/!/.test(viewedText), `a proposal opened three days ago shows a plain viewed badge, not an alert ("${viewedText}")`);
    await openDeal(dealAccepted); await escape();
    check(await exists(asAgent, `[data-testid="badge-proposal-accepted-${dealAccepted}"]`), "an accepted proposal shows Proposal Accepted");
    await openDeal(dealOld); await escape();
    check(!(await exists(asAgent, `[data-testid="badge-proposal-alert-${dealOld}"]`)) && !(await exists(asAgent, `[data-testid="badge-proposal-viewed-${dealOld}"]`)),
      "an open older than seven days is not presented as live engagement");
    await openDeal(dealNone); await escape();
    check(!(await exists(asAgent, `[data-testid="badge-proposal-alert-${dealNone}"]`)) && !(await exists(asAgent, `[data-testid="badge-proposal-viewed-${dealNone}"]`)),
      "a deal without a proposal shows no engagement badge");

    asAgent.failRead(`/api/deals/${dealFailing}/co-branded-proposals`, { exact: true });
    await openDeal(dealFailing); await escape();
    check(await exists(asAgent, `[data-testid="badge-proposal-unavailable-${dealFailing}"]`) && !(await exists(asAgent, `[data-testid="badge-proposal-alert-${dealFailing}"]`)),
      "a failed proposal read says details unavailable for that deal only and shows no engagement");
    check(await exists(asAgent, `[data-testid="badge-proposal-alert-${dealAlert}"]`), "the failure did not remove the other deal's engagement alert");
    asAgent.failRead(null);
    await asAgent.click(`[data-testid="button-retry-proposals-${dealFailing}"]`);
    await until(asAgent, `!document.querySelector('[data-testid="badge-proposal-unavailable-${dealFailing}"]')`, "retry clears unavailable badge", 200);
    await until(asAgent, `!!document.querySelector('[data-testid="badge-proposal-alert-${dealFailing}"]')`, "retry shows engagement for the recovered deal", 200);
    check(true, "Retry recovers that deal's proposal engagement and shows its alert");
    await asAgent.screenshot("pipeline-proposal-events");

    const own = await h.request("admin", "GET", `/api/deals/${dealAlert}/co-branded-proposals`);
    check(own.status === 200 && Array.isArray(own.body) && own.body.length === 1 && own.body[0].merchantName === "Proposal Merchant A" && own.body[0].viewCount === 3,
      "a deal's proposal read returns exactly that deal's proposal with its open count");
    const denied = await h.request("agent", "GET", `/api/deals/${dealForeign}/co-branded-proposals`);
    check(denied.status === 404 && !/Foreign Merchant|viewerUrl|co-branded-proposal\//.test(JSON.stringify(denied.body ?? {})), `an agent reading another owner's deal proposals is refused with no merchant data or viewer link (${denied.status})`);
    const owned = await h.request("other", "GET", `/api/deals/${dealForeign}/co-branded-proposals`);
    check(owned.status === 200 && Array.isArray(owned.body) && owned.body.length === 1, "the owning agent reads the same deal's proposals");
    for (const role of ["merchant", "affiliate", "partner"]) {
      const refused = await h.request(role, "GET", `/api/deals/${dealAlert}/co-branded-proposals`);
      check(refused.status === 401 || refused.status === 403 || refused.status === 404, `${role} cannot read proposal engagement (${refused.status})`);
    }
    for (const width of [1280, 768, 454, 390, 320]) {
      await setWidth(asAgent, width);
      await asAgent.navigate("/dashboard/pipeline");
      await until(asAgent, `!!document.querySelector('${cardSel(dealAlert)}')`, `Pipeline @${width}`, 300);
      await sleep(600);
      if (width <= 454) await asAgent.screenshot(`pipeline-board-${width}`);
      await openDeal(dealAlert);
      await until(asAgent, `!!document.querySelector('[data-testid="row-deal-proposal-${idA}"]')`, `deal drawer @${width}`, 200);
      for (const failure of await audit(asAgent, `Pipeline deal drawer with proposal events @${width}px`)) failures.push(failure);
    }
    await setWidth(asAgent, 1280);
  });

  // ── C. Ready-for-Outreach queue: populated rows (stand-in projection), skip, role refusal, real empty scope ───────────
  await section("outreach-queue", async () => {
    queueStandIn.enabled = true;
    await asAgent.navigate("/dashboard/outreach-queue");
    await until(asAgent, `[...document.querySelectorAll('a[href^="/dashboard/contacts/"]')].length>=3`, "outreach queue populated rows", 300);
    const facts = await asAgent.evaluate(`(()=>({
      rows: [...document.querySelectorAll('a[href^="/dashboard/contacts/"]')].length,
      calls: document.querySelectorAll('a[href^="tel:"]').length, emails: document.querySelectorAll('a[href^="mailto:"]').length,
      skips: [...document.querySelectorAll('button')].filter(b=>/Skip/.test(b.textContent||'')).length,
      starts: [...document.querySelectorAll('button')].filter(b=>/^\\s*Start/.test(b.textContent||'')).length,
    }))()`) as any;
    check(facts.rows >= 3 && facts.calls >= 3 && facts.emails >= 3, `each queue row offers its contact link, call link and email link (${JSON.stringify(facts)})`);
    check(facts.skips >= 3 && facts.starts >= 3, "each queue row offers named Start and Skip actions (Start is never pressed in this suite)");
    await asAgent.screenshot("outreach-queue-populated");
    const alphaHref = `/dashboard/contacts/${qa}`;
    await asAgent.evaluate(`(()=>{const row=document.querySelector('a[href="${alphaHref}"]').closest('tr');[...row.querySelectorAll('button')].find(b=>/Skip/.test(b.textContent||'')).click();return true})()`);
    await until(asAgent, `!document.querySelector('a[href="${alphaHref}"]')`, "skipped row leaves the queue", 200);
    const skipped = (await h.pool.query("SELECT outreach_queue_skipped_at FROM contacts WHERE id=$1", [qa])).rows[0].outreach_queue_skipped_at;
    const skipAudit = Number((await h.pool.query("SELECT count(*) n FROM audit_logs WHERE action='outreach_queue_skip' AND entity_id=$1", [qa])).rows[0].n);
    check(skipped !== null && skipAudit === 1, "Skip recorded the flag and one audit event, and the lead left the visible queue");
    check(Number((await h.pool.query("SELECT count(*) n FROM contacts WHERE id=ANY($1::int[]) AND outreach_queue_skipped_at IS NOT NULL", [[qb, qc]])).rows[0].n) === 0, "the other rows were not skipped");
    const foreignSkip = await h.request("agent", "POST", `/api/outreach-queue/${qForeign}/skip`, {});
    check(foreignSkip.status === 404 && (await h.pool.query("SELECT outreach_queue_skipped_at FROM contacts WHERE id=$1", [qForeign])).rows[0].outreach_queue_skipped_at === null,
      `an agent cannot skip another owner's lead (${foreignSkip.status}) and the lead is unchanged`);
    for (const role of ["merchant", "affiliate", "partner"]) {
      const refusedRead = await h.request(role, "GET", "/api/outreach-queue?channel=email");
      const refusedSkip = await h.request(role, "POST", `/api/outreach-queue/${qb}/skip`, {});
      check([401, 403].includes(refusedRead.status) && [401, 403].includes(refusedSkip.status), `${role} is refused the queue (${refusedRead.status}) and Skip (${refusedSkip.status})`);
    }
    for (const failure of await auditWidths(asAgent, "Outreach queue", "/dashboard/outreach-queue", `[...document.querySelectorAll('a[href^="/dashboard/contacts/"]')].length>=2`)) failures.push(failure);

    queueStandIn.enabled = false;
    await asAgent.navigate("/dashboard/outreach-queue");
    await until(asAgent, "!!document.querySelector('[data-testid=\"text-queue-empty-scope\"]')", "real empty-scope state", 300);
    check(/./.test(await text(asAgent, '[data-testid="text-queue-empty-scope"]')) && await exists(asAgent, '[data-testid="link-queue-empty-readiness"]'),
      "with the real projection and no qualified recipients the queue explains the empty scope and links to readiness, not a blank table");
    queueStandIn.enabled = true;
  });

  // ── D. Inbox: populated rows, unmapped and foreign states, selection, reload, failure, new reply, draft preservation ──
  await section("inbox", async () => {
    const admin = await open(h.sessions.get("admin")!.cookie);
    await setWidth(admin, 1280);
    await admin.navigate("/dashboard/comms-hub");
    await until(admin, `!!document.querySelector('${rowSel(rUnread)}')`, "Inbox populated for administrator", 300);
    for (const [label, id] of [["mapped unread", rUnread], ["unmapped", rUnmapped], ["foreign-owner", rForeign], ["mapped read", rRead]] as const)
      check(await exists(admin, rowSel(id)), `the administrator's Inbox lists the ${label} message`);
    check(String(await admin.evaluate(`document.querySelector('${rowSel(rUnmapped)}')?.getAttribute('data-open-state')`)) === "unmapped"
      && /Not linked to a contact/.test(await text(admin, `[data-testid="inbox-unmapped-${inboxId(rUnmapped)}"]`)), "an unmapped message states it is not linked to a contact and cannot be opened");
    check(String(await admin.evaluate(`document.querySelector('${rowSel(rUnread)}')?.getAttribute('data-open-state')`)) === "openable", "a mapped message is openable");
    check(await exists(admin, '[data-testid="inbox-partial-state"]') && !(await exists(admin, '[data-testid="inbox-failed-sources"]')),
      "unconfigured provider sources are labeled as a partial window, not as an all-clear and not as a failure");
    check(/\d+ on page/.test(await text(admin, '[data-testid="badge-unread-count"]')), "the unread badge says how many are on the loaded page, not a total");
    await admin.evaluate(`document.querySelector('${rowSel(rUnmapped)}').click()`);
    await sleep(500);
    check(!/thread=/.test(String(await admin.evaluate("location.search"))), "pressing an unmapped message does not select it");

    // Keyboard: focus the first openable row and open it with Enter.
    await admin.evaluate(`document.querySelector('${rowSel(rUnread)}').focus()`);
    await admin.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await admin.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until(admin, `decodeURIComponent(location.search).includes(${JSON.stringify(inboxId(rUnread))})`, "Enter opens the focused message", 100);
    await until(admin, "!!document.querySelector('[data-testid=\"thread-reply-input\"]')", "thread panel for the selected message", 200);
    await until(admin, `/estimate timing/.test(document.querySelector('[data-testid="card-thread-panel"]')?.textContent ?? '')`, "selected message body in thread panel", 200);
    check(/estimate timing/.test(await text(admin, '[data-testid="card-thread-panel"]')), "the selected message's own body is shown in the thread panel");
    check(await admin.evaluate("document.querySelector('[data-testid=\"thread-reply-send\"]')?.disabled === true"), "Send stays disabled while outbound is paused");
    await admin.screenshot("inbox-selected");

    await admin.navigate(`/dashboard/comms-hub?thread=${encodeURIComponent(inboxId(rUnread))}`);
    await until(admin, "!!document.querySelector('[data-testid=\"thread-reply-input\"]')", "selection after reload", 300);
    await until(admin, `/estimate timing/.test(document.querySelector('[data-testid="card-thread-panel"]')?.textContent ?? '')`, "selected message body after reload", 200);
    check(/estimate timing/.test(await text(admin, '[data-testid="card-thread-panel"]')), "after a full reload the same message is still selected");
    await admin.evaluate("history.back()");
    await sleep(800);
    results.push({ label: "inbox after history.back", location: String(await admin.evaluate("location.pathname+location.search")) });

    admin.failRead("/api/inbox/items/audit");
    await admin.navigate(`/dashboard/comms-hub?thread=${encodeURIComponent(inboxId(rUnread))}`);
    await until(admin, "/missing, unmapped or outside current access/.test(document.body.innerText)", "unavailable selected message", 300);
    check(!/estimate timing/.test(await text(admin, '[data-testid="card-thread-panel"]')), "a failed selected-message read shows unavailable and substitutes no other message");
    admin.failRead(null);

    // New reply arrives while a message is open and a draft is half-typed.
    await admin.navigate(`/dashboard/comms-hub?thread=${encodeURIComponent(inboxId(rUnread))}`);
    await until(admin, "!!document.querySelector('[data-testid=\"thread-reply-input\"]')", "thread for refresh proof", 300);
    await admin.click('[data-testid="thread-reply-input"]');
    await admin.call("Input.insertText", { text: "Draft that must survive the refresh" });
    check(String(await admin.evaluate("document.querySelector('[data-testid=\"thread-reply-input\"]').value")).includes("Draft that must"), "a half-typed draft is in the reply box before the refresh");
    const rNew = await audit_("inbound_email_received", inboxMapped, msg("Second inbound message that arrives while the thread is open"), 0, 0);
    await until(admin, `!!document.querySelector('${rowSel(rNew)}')`, "new inbound message appears without user action (45 s foreground refresh)", 700);
    check(true, "a new inbound message appears through the bounded foreground refresh without any user action");
    check(decodeURIComponent(String(await admin.evaluate("location.search"))).includes(inboxId(rUnread)), "the open message selection is unchanged by the refresh");
    check(String(await admin.evaluate("document.querySelector('[data-testid=\"thread-reply-input\"]')?.value ?? ''")).includes("Draft that must survive"), "the half-typed draft survived the refresh");

    const agentRead = await h.request("agent", "GET", "/api/inbox/items?channel=all&filter=all&limit=60");
    const agentIds = new Set((agentRead.body?.items ?? []).map((item: any) => item.id));
    check(agentRead.status === 200 && agentIds.has(inboxId(rUnread)) && !agentIds.has(inboxId(rForeign)) && !agentIds.has(inboxId(rUnmapped)),
      "an agent's Inbox read contains their own mapped messages and neither the foreign-owner nor the unmapped message");
    const agentForeignDetail = await h.request("agent", "GET", `/api/inbox/items/${encodeURIComponent(inboxId(rForeign))}`);
    check(agentForeignDetail.status === 404 && !/Foreign owner inbound/.test(JSON.stringify(agentForeignDetail.body ?? {})), `an agent opening the foreign-owner message directly is refused with no body (${agentForeignDetail.status})`);
    for (const role of ["merchant", "affiliate", "partner"]) {
      const refused = await h.request(role, "GET", "/api/inbox/items?channel=all&filter=all&limit=60");
      check([401, 403].includes(refused.status) || !/inbound|Inbox/i.test(JSON.stringify(refused.body ?? {})), `${role} is refused the Inbox (${refused.status})`);
    }
    await staffLogin(asAgent, "agent");
    await asAgent.navigate(`/dashboard/comms-hub?thread=${encodeURIComponent(inboxId(rForeign))}`);
    await until(asAgent, "/missing, unmapped or outside current access/.test(document.body.innerText)", "agent foreign selection unavailable", 300);
    check(!(await pageText(asAgent)).includes("Foreign owner inbound"), "an agent who types the foreign message's URL sees the unavailable state, not its content");

    for (const failure of await auditWidths(admin, "Inbox (populated, selected thread)", `/dashboard/comms-hub?thread=${encodeURIComponent(inboxId(rUnread))}`, `!!document.querySelector('[data-testid="comms-hub"]') && !!document.querySelector('[data-testid="card-thread-panel"]')`)) failures.push(failure);
    const zoomed = await open(h.sessions.get("admin")!.cookie, 2);
    for (const [label, url, ready] of [
      ["Inbox", `/dashboard/comms-hub`, `!!document.querySelector('${rowSel(rUnread)}')`],
      ["Outreach queue", "/dashboard/outreach-queue", `[...document.querySelectorAll('a[href^="/dashboard/contacts/"]')].length>=2`],
    ] as const) {
      await zoomed.navigate(url);
      await until(zoomed, ready, `${label} @200%`, 300);
      await sleep(500);
      const problems = await audit(zoomed, `${label} @200% zoom`);
      const facts = results.at(-1) as any;
      if (!(facts.dpr >= 1.9 && facts.width <= 800)) problems.push(`${label}: native 200% zoom not observed (dpr ${facts.dpr}, width ${facts.width})`);
      for (const failure of problems) failures.push(failure);
    }
    await zoomed.screenshot("inbox-200-percent");
    await zoomed.close();
  });

  check(failures.length === 0, "populated journeys passed at 1280, 768, 454, 390 and 320 px and at native 200% zoom with no overflow, one h1, named controls or page exception");
  assert.deepEqual(failures, [], `Phase 6 populated-journey failures:\n${failures.join("\n")}`);
  await writeFile(`${dir}/phase6-populated-results.json`, JSON.stringify({ checks, results }, null, 2) + "\n");
  console.log(`PHASE6_POPULATED_PASS (${checks.length} named checks)`);
} catch (error) {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/phase6-populated-failure.json`, JSON.stringify({ error: String((error as Error)?.stack ?? error).slice(0, 4000), failures, checks, results }, null, 2) + "\n");
  throw error;
} finally {
  await watcher.end().catch(() => undefined);
  for (const b of browsers) { try { await b.close(); } catch { /* already closed */ } }
  await h.close();
}
process.exit(0);
