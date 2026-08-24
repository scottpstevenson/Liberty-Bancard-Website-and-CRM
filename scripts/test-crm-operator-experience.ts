#!/usr/bin/env tsx
/**
 * CRM operator regression gate.
 *
 * This source-level suite is intentionally provider-free. It verifies the
 * ownership, query-parity, queue readiness, and truthful-response boundaries
 * that must remain present even when no external provider is configured.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { contacts, deals, liveChats } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");
const requireText = (file: string, text: string) =>
  assert.ok(source(file).includes(text), `${file} must contain ${text}`);

const access = source("server/services/crm-object-access.ts");
assert.match(access, /assignedTo.*user\.email|owner.*user\.email/s, "agent policy must use email ownership");
assert.match(access, /CRM_OBJECT_NOT_FOUND/, "denials must be non-enumerating");
assert.match(access, /exactAssignment/, "exact assignment must be available for provider actions");

requireText("server/routes.ts", "app.use(crmObjectAccessGuard)");
requireText("server/storage/contacts.ts", "ownerEmail");
requireText("server/storage/deals.ts", "ownerEmail");
requireText("server/routes/contacts.ts", "parseStrictPagination");
requireText("server/routes/deals.ts", "parseStrictPagination");
requireText("server/routes/crm-operations.ts", "db.select().from(tickets).where(eq(tickets.contactId, contactId))");
requireText("server/routes/crm-operations.ts", "db.select().from(tasks).where(eq(tasks.contactId, contactId))");
requireText("server/routes/inbox.ts", "authorizeInboxItemAccess");
requireText("server/routes/inbox.ts", 'resultScope: "fetched_window"');
requireText("server/routes/inbox-ownership.ts", "authorizeInboxItemAccess");
requireText("server/routes/notifications.ts", "authorizeContactAccess(req, res, Number(resolvedId))");
requireText("server/routes/notifications.ts", "authorizeDealAccess(req, res, Number(resolvedId))");
requireText("server/routes/activity.ts", "authorizeContactAccess(req, res, contactId)");
requireText("server/routes/activity.ts", "authorizeContactAccess(req, res, Number(contactId), { exactAssignment: true })");
requireText("server/routes/activity.ts", "const comment = await storage.getComment(Number(req.params.id))");
requireText("server/routes/relationships.ts", 'entityType === "contact" && !await authorizeContactAccess');
requireText("server/routes/chargebacks.ts", "authorizeContactAccess(req, res, contactId)");
requireText("server/routes/chargebacks.ts", "authorizeChargebackTarget(req, res, cb)");
requireText("server/routes/live-chat.ts", "authorizeLiveChatAccess(req, res, chat, { exactAssignment: true })");
requireText("server/routes/live-chat.ts", "const pattern = `%${q}%`");
requireText("server/routes/live-chat.ts", "or(eq(contacts.assignedTo, agentEmail), isNull(contacts.assignedTo))");
requireText("server/routes/outreach-queue.ts", "readyForOutreachPredicate");
requireText("server/routes/daily-briefing.ts", "readyForOutreachPredicate");
requireText("server/routes/queue-metrics.ts", "requireQueueManagerReady");
requireText("server/routes/queue-metrics.ts", 'resultScope: "sampled_per_queue"');
requireText("client/src/pages/dashboard/SystemHealthHub.tsx", "const isAdmin");
requireText("client/src/pages/dashboard/CommsHub.tsx", "data-testid=\"live-chat-link-contact\"");
requireText("client/src/pages/dashboard/CommsHub.tsx", "const chatId = item.id.startsWith(\"chat-\")");
requireText("client/src/pages/dashboard/OperatorDashboard.tsx", "dlqTruthUnknown ? \"Unknown\"");
requireText("client/src/pages/dashboard/OperatorDashboard.tsx", "isError: dlqError");
requireText("client/src/pages/dashboard/OperatorDashboard.tsx", "const dlqUnavailable = dlqError");
requireText("client/src/App.tsx", "LegacyOperatorRedirect");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login must succeed for ${email}`);
  const raw = response.headers as unknown as { getSetCookie?: () => string[] };
  const cookies = (raw.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""])
    .map((header) => header.split(";")[0])
    .filter(Boolean);
  assert.ok(cookies.length, "login must return a session cookie");
  return cookies.join("; ");
}

async function upsertDashboardUser(email: string, password: string, role: "agent" | "manager" = "agent") {
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    await db.update(users).set({ passwordHash, role, authProvider: "local", emailVerified: new Date() }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, passwordHash, role, authProvider: "local", emailVerified: new Date(), firstName: "CRM", lastName: "Fixture" });
  }
}

async function runtimeOwnershipProof() {
  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  assert.ok(health?.ok, `CRM runtime suite requires a running server at ${BASE_URL}`);
  const runId = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const agentAEmail = `crm-owner-a-${runId}@libertybancard.test`;
  const agentBEmail = `crm-owner-b-${runId}@libertybancard.test`;
  const managerEmail = `crm-manager-${runId}@libertybancard.test`;
  const password = "CrmFixture-Aa1!";
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const liveChatIds: number[] = [];
  try {
    await upsertDashboardUser(agentAEmail, password);
    await upsertDashboardUser(agentBEmail, password);
    await upsertDashboardUser(managerEmail, password, "manager");
    const created = await db.insert(contacts).values([
      { firstName: "Owner", lastName: "A", email: `crm-contact-a-${runId}@example.test`, phone: "+1202555" + runId.slice(-4), assignedTo: agentAEmail, status: "active", leadSource: "test", sourceCategory: "test" },
      { firstName: "Owner", lastName: "B", email: `crm-contact-b-${runId}@example.test`, phone: "+1202556" + runId.slice(-4), assignedTo: agentBEmail, status: "active", leadSource: "test", sourceCategory: "test" },
      { firstName: "Unassigned", lastName: "Contact", email: `crm-contact-u-${runId}@example.test`, phone: "+1202557" + runId.slice(-4), assignedTo: null, status: "active", leadSource: "test", sourceCategory: "test" },
    ] as any).returning({ id: contacts.id });
    contactIds.push(...created.map((row) => row.id));
    const [aId, bId, unassignedId] = contactIds;
    const createdDeals = await db.insert(deals).values([
      { contactId: aId, owner: agentAEmail, name: "CRM fixture A", pipeline: "sales", stage: "New Lead" },
      { contactId: bId, owner: agentBEmail, name: "CRM fixture B", pipeline: "sales", stage: "New Lead" },
      { contactId: unassignedId, owner: null, name: "CRM fixture unassigned", pipeline: "sales", stage: "New Lead" },
    ]).returning({ id: deals.id });
    dealIds.push(...createdDeals.map((row) => row.id));
    const [aDealId, bDealId, unassignedDealId] = dealIds;
    const createdChats = await db.insert(liveChats).values([
      { sessionId: `crm-chat-a-${runId}`, contactId: aId, status: "active" },
      { sessionId: `crm-chat-b-${runId}`, contactId: bId, status: "active" },
      { sessionId: `crm-chat-u-${runId}`, contactId: unassignedId, status: "active" },
      { sessionId: `crm-chat-anon-${runId}`, contactId: null, status: "active" },
    ]).returning({ id: liveChats.id });
    liveChatIds.push(...createdChats.map((row) => row.id));
    const [aChatId, bChatId, unassignedChatId, anonymousChatId] = liveChatIds;
    const agentACookie = await login(agentAEmail, password);
    const agentBCookie = await login(agentBEmail, password);
    const managerCookie = await login(managerEmail, password);
    const get = (url: string, cookie: string) => fetch(`${BASE_URL}${url}`, { headers: { cookie } });
    const csrf = async (cookie: string) => {
      const response = await get("/api/csrf-token", cookie);
      assert.equal(response.status, 200, "CSRF token must be available");
      return (await response.json() as { token: string }).token;
    };
    const patch = async (url: string, cookie: string, body: unknown) => fetch(`${BASE_URL}${url}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": await csrf(cookie) },
      body: JSON.stringify(body),
    });
    const post = async (url: string, cookie: string, body: unknown) => fetch(`${BASE_URL}${url}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": await csrf(cookie) },
      body: JSON.stringify(body),
    });

    const list = await get("/api/contacts?limit=100&offset=0", agentACookie);
    assert.equal(list.status, 200, "agent A contact list must load");
    const listed = await list.json() as { data: Array<{ id: number }>; total: number };
    assert.ok(listed.data.some((row) => row.id === aId), "agent A must see own contact");
    assert.ok(listed.data.some((row) => row.id === unassignedId), "agent A must see unassigned contact");
    assert.ok(!listed.data.some((row) => row.id === bId), "agent A must not enumerate agent B contact");
    assert.ok(listed.total >= listed.data.length, "scoped list total must describe the scoped data window");

    assert.equal((await get(`/api/contacts/${bId}`, agentACookie)).status, 404, "agent A must receive non-leaking denial for agent B contact");
    assert.equal((await get(`/api/contacts/${aId}`, agentACookie)).status, 200, "agent A must read own contact");
    assert.equal((await get(`/api/contacts/${unassignedId}`, agentACookie)).status, 200, "agent A must read unassigned contact");
    assert.equal((await get(`/api/contacts/${aId}`, agentBCookie)).status, 404, "agent B must not read agent A contact");
    const dealList = await get("/api/deals?limit=100&offset=0", agentACookie);
    assert.equal(dealList.status, 200, "agent A deal list must load");
    const listedDeals = await dealList.json() as { data: Array<{ id: number }>; total: number };
    assert.ok(listedDeals.data.some((row) => row.id === aDealId), "agent A must see own deal");
    assert.ok(listedDeals.data.some((row) => row.id === unassignedDealId), "agent A must see unassigned deal");
    assert.ok(!listedDeals.data.some((row) => row.id === bDealId), "agent A must not enumerate agent B deal");
    assert.ok(listedDeals.total >= listedDeals.data.length, "scoped deal total must describe the scoped data window");
    assert.equal((await get(`/api/deal-competitors/deal/${bDealId}`, agentACookie)).status, 404, "agent A must not read agent B deal subresources");
    assert.equal((await get(`/api/review-requests/deal/${bDealId}`, agentACookie)).status, 404, "agent A must not read agent B deal review requests");
    assert.equal((await get(`/api/audit-logs/entity/contact/${bId}`, agentACookie)).status, 404, "agent A must not read agent B contact audit history");
    assert.equal((await get(`/api/audit-logs/entity/deal/${bDealId}`, agentACookie)).status, 404, "agent A must not read agent B deal audit history");
    assert.equal((await get(`/api/call-logs/contact/${bId}`, agentACookie)).status, 404, "agent A must not read agent B call logs");
    assert.equal((await get(`/api/call-logs?contactId=${bId}`, agentACookie)).status, 404, "agent A must not use a query ID to read agent B call logs");
    assert.equal((await get(`/api/relationships/graph/contact/${bId}`, agentACookie)).status, 404, "agent A must not read agent B relationship graph");
    assert.equal((await get(`/api/chargebacks/contact/${bId}`, agentACookie)).status, 404, "agent A must not read agent B chargebacks");
    assert.equal((await post("/api/call-follow-ups/send", agentACookie, { contactId: bId, dealId: bDealId, outcome: "Interested", sendEmail: false, sendSms: false })).status, 404, "agent A must not trigger call-follow-up side effects for agent B");
    assert.equal((await get(`/api/live-chat/sessions/${aChatId}/messages`, agentACookie)).status, 200, "agent A must read own mapped live chat");
    assert.equal((await get(`/api/live-chat/sessions/${unassignedChatId}/messages`, agentACookie)).status, 200, "agent A must read unassigned mapped live chat");
    assert.equal((await get(`/api/live-chat/sessions/${bChatId}/messages`, agentACookie)).status, 404, "agent A must not read agent B live chat by substituted ID");
    assert.equal((await get(`/api/live-chat/sessions/${anonymousChatId}/messages`, agentACookie)).status, 404, "agents must not read unlinked live chats");
    assert.equal((await get(`/api/live-chat/sessions/${anonymousChatId}/messages`, managerCookie)).status, 200, "managers must inspect unlinked live chats for triage");
    const ownSearch = await get(`/api/live-chat/contacts/search?q=${encodeURIComponent(`crm-contact-a-${runId}`)}`, agentACookie);
    assert.ok((await ownSearch.json() as Array<{ id: number }>).some((row) => row.id === aId), "agent contact search must find eligible contacts with a database query");
    const otherSearch = await get(`/api/live-chat/contacts/search?q=${encodeURIComponent(`crm-contact-b-${runId}`)}`, agentACookie);
    assert.ok(!(await otherSearch.json() as Array<{ id: number }>).some((row) => row.id === bId), "agent contact search must omit another agent's contact");
    assert.equal((await patch(`/api/live-chat/sessions/${anonymousChatId}`, managerCookie, { contactId: bId })).status, 200, "manager must link an anonymous chat through the server-authorized path");
    const invalidPage = await get("/api/contacts?limit=0", agentACookie);
    assert.equal(invalidPage.status, 400, "malformed pagination must be rejected");
    assert.equal((await invalidPage.json() as { code?: string }).code, "INVALID_PAGINATION", "pagination rejection must be stable");
  } finally {
    if (liveChatIds.length) await db.delete(liveChats).where(inArray(liveChats.id, liveChatIds)).catch(() => {});
    if (dealIds.length) await db.delete(deals).where(inArray(deals.id, dealIds)).catch(() => {});
    if (contactIds.length) await db.delete(contacts).where(inArray(contacts.id, contactIds)).catch(() => {});
    await db.delete(users).where(inArray(users.email, [agentAEmail, agentBEmail, managerEmail])).catch(() => {});
  }
}

await runtimeOwnershipProof();
console.log("CRM operator regression boundary and two-agent ownership checks passed.");