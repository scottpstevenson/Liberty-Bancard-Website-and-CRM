/**
 * Phase 6 R09: one shared route/workspace title and breadcrumb mapping across the eleven sidebar destinations, with a safe
 * origin for the Contact Back control. Static and pure: it parses the page sources the registry copies from, so a renamed
 * heading or tab fails here instead of drifting. Mounted, browser and served-identity evidence are separate artifacts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

// record-origin reads window.sessionStorage; give it an in-memory one before the module is used.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
};

const { employeeSidebarEntries, employeeSidebarFor } = await import("../client/src/lib/employee-sidebar");
const { PAGE_RULES, resolveWorkspaceIdentity, isRecordPath } = await import("../client/src/lib/workspace-identity");
const origin = await import("../client/src/lib/record-origin");

const read = (file: string) => fs.readFileSync(file, "utf8");
const page = (name: string) => read(`client/src/pages/dashboard/${name}.tsx`);
let checks = 0;
const ok = (condition: unknown, message: string) => { checks++; assert.ok(condition, message); };
const eq = (actual: unknown, expected: unknown, message: string) => { checks++; assert.deepEqual(actual, expected, message); };

// 1. All eleven destinations, for every role that has them: area label equals the sidebar label, crumbs start at the area,
//    and the last crumb is the current page with no link.
const roles = ["admin", "manager", "agent"] as const;
let landed = 0;
for (const role of roles) {
  for (const { entry, href } of employeeSidebarFor(role)) {
    if (href.startsWith("/assets")) continue;
    const identity = resolveWorkspaceIdentity(role, href);
    ok(identity, `${role} ${entry.label}: landing ${href} resolves`);
    if (!identity) continue;
    landed++;
    eq(identity.areaId, entry.id, `${role} ${entry.label}: area id`);
    eq(identity.areaLabel, entry.label, `${role} ${entry.label}: area label is the sidebar label`);
    eq(identity.crumbs[0].label, entry.label, `${role} ${entry.label}: first crumb is the area`);
    const last = identity.crumbs[identity.crumbs.length - 1];
    eq(last.href, null, `${role} ${entry.label}: the current crumb has no link`);
    ok(identity.crumbs.slice(0, -1).every(c => c.href && c.href.startsWith("/dashboard")), `${role} ${entry.label}: earlier crumbs link to local dashboard routes`);
    ok(identity.crumbs.every((c, i) => i === 0 || c.label !== identity.crumbs[i - 1].label), `${role} ${entry.label}: no repeated neighbouring crumb`);
  }
}
ok(landed >= 11 * 2 + 9 - 2, "every role's destinations were exercised");
eq(employeeSidebarEntries.length, 11, "the sidebar still has eleven entries");

// 2. An area a role does not have is never named for it, and non-area routes keep the shell's existing label.
eq(resolveWorkspaceIdentity("agent", "/dashboard/outbound-center?tab=campaigns"), null, "agent has no Campaigns area");
eq(resolveWorkspaceIdentity("agent", "/dashboard/admin-hub?tab=users"), null, "agent has no Administration area");
eq(resolveWorkspaceIdentity("merchant", "/dashboard/pipeline"), null, "portal roles have no employee identity");
eq(resolveWorkspaceIdentity("admin", "/dashboard/notifications"), null, "a route in no sidebar area is left to the shell");
eq(resolveWorkspaceIdentity("admin", "/dashboard/security"), null, "security stays outside the eleven areas");

// 3. Specific trails.
const trail = (role: string, url: string) => resolveWorkspaceIdentity(role, url)?.crumbs.map(c => c.label);
eq(trail("admin", "/dashboard"), ["Today"], "Today");
eq(trail("agent", "/dashboard/my-day"), ["Today", "My Day"], "agent Today");
eq(trail("admin", "/dashboard/contacts-leads?tab=leads"), ["Records", "Leads"], "Records, Leads tab");
eq(trail("admin", "/dashboard/contacts-leads?tab=people"), ["Records", "People"], "Records, People tab");
eq(trail("agent", "/dashboard/contacts"), ["Records", "People"], "agent People");
eq(trail("admin", "/dashboard/pipeline"), ["Pipeline", "Sales Pipeline"], "Pipeline");
eq(trail("admin", "/dashboard/pipeline?id=2589"), ["Pipeline", "Sales Pipeline", "Deal"], "Pipeline deal");
eq(trail("admin", "/dashboard/comms-hub"), ["Inbox"], "Inbox");
eq(trail("agent", "/dashboard/tasks-appointments?tab=calendar"), ["Work", "Appointments"], "Work, Appointments tab");
eq(trail("agent", "/dashboard/tasks-appointments?tab=tasks&taskId=77"), ["Work", "Tasks", "Task"], "Work, selected task");
eq(trail("admin", "/dashboard/portfolio"), ["Merchant Operations", "My Portfolio"], "Merchant Operations");
eq(trail("admin", "/dashboard/lead-ops?tab=pipeline"), ["Prospecting", "Lead Operations Center", "Inbound Operations"], "Prospecting, inbound operations");
eq(trail("admin", "/dashboard/lead-ops?tab=pipeline&ref=a1b2c3d4"), ["Prospecting", "Lead Operations Center", "Inbound Operations", "Request"], "Prospecting, one request");
eq(trail("agent", "/dashboard/outreach-queue"), ["Prospecting", "Ready for Outreach"], "agent Prospecting");
eq(trail("manager", "/dashboard/outbound-center?tab=sequences"), ["Campaigns", "Sequences"], "Campaigns, Sequences tab");
eq(trail("admin", "/dashboard/reporting?tab=win-loss"), ["Reports", "Win/Loss"], "Reports, Win/Loss tab");
eq(trail("agent", "/dashboard/my-earnings"), ["Reports", "My Earnings"], "agent Reports");
eq(trail("admin", "/dashboard/admin-hub?area=users-access&tab=users"), ["Administration", "User Management"], "Administration tab");
eq(trail("manager", "/dashboard/admin-hub?tab=agents"), ["Administration", "Agent Management"], "manager Administration");
eq(trail("agent", "/dashboard/knowledge-base"), ["Resources", "Knowledge Base"], "Resources");

// 4. Record paths: the area is the one that owns the record; the page keeps its own heading and Back control.
eq(trail("admin", "/dashboard/contacts/123"), ["Records", "Contact"], "contact record");
eq(trail("agent", "/dashboard/companies/55"), ["Records", "Company"], "company record");
ok(isRecordPath("/dashboard/contacts/123") && isRecordPath("/dashboard/companies/55"), "record paths are recognised");
ok(!isRecordPath("/dashboard/contacts") && !isRecordPath("/dashboard/contacts/123/edit") && !isRecordPath("/dashboard/contacts/%2e%2e"), "lists and look-alikes are not records");

// 5. Unregistered or unsafe selectors add nothing: no invented tab, record or task names.
eq(trail("admin", "/dashboard/tasks-appointments?tab=nonsense"), ["Work"], "unknown tab adds no crumb");
eq(trail("admin", "/dashboard/tasks-appointments?tab=tasks&tab=calendar"), ["Work"], "repeated tab selects nothing");
eq(trail("admin", "/dashboard/tasks-appointments?taskId=abc"), ["Work"], "non-numeric task id adds no crumb");
eq(trail("admin", "/dashboard/tasks-appointments?taskId=0"), ["Work"], "zero task id adds no crumb");
eq(trail("admin", "/dashboard/pipeline?id=-1"), ["Pipeline", "Sales Pipeline"], "negative deal id adds no crumb");
eq(trail("admin", "/dashboard/lead-ops?tab=pipeline&ref=zz"), ["Prospecting", "Lead Operations Center", "Inbound Operations"], "malformed request ref adds no crumb");
eq(trail("admin", "/dashboard/lead-ops?tab=__proto__"), ["Prospecting", "Lead Operations Center"], "prototype-looking tab adds no crumb");
eq(trail("admin", "/dashboard/reporting?tab=constructor"), ["Reports"], "inherited property names are not tabs");
eq(trail("admin", "/dashboard/reporting#top"), ["Reports"], "a fragment does not change the trail");
eq(trail("admin", "/dashboard/knowledge-base/"), ["Resources", "Knowledge Base"], "a trailing slash is the same page");
eq(trail("admin", "/dashboard/training"), ["Resources"], "a registered area with no registered page shows only the area");

// 6. Page headings and tab labels equal the text the pages render.
const headingSources: Record<string, { file: string; text: string }> = {
  "/dashboard": { file: "Overview", text: "Today" },
  "/dashboard/my-day": { file: "SalesRepHome", text: "My Day" },
  "/dashboard/nba": { file: "NbaPriorityPage", text: "Next best action" },
  "/dashboard/contacts": { file: "Contacts", text: "People" },
  "/dashboard/pipeline": { file: "Pipeline", text: "Sales Pipeline" },
  "/dashboard/comms-hub": { file: "CommsHub", text: "Inbox" },
  "/dashboard/tasks-appointments": { file: "TasksAppointments", text: "Work" },
  "/dashboard/portfolio": { file: "MerchantPortfolio", text: "My Portfolio" },
  "/dashboard/lead-ops": { file: "LeadOpsCenter", text: "Lead Operations Center" },
  "/dashboard/outreach-queue": { file: "OutreachQueue", text: "Ready for Outreach" },
  "/dashboard/outbound-center": { file: "OutboundCenter", text: "Campaigns" },
  "/dashboard/reporting": { file: "ReportingHub", text: "Reports" },
  "/dashboard/my-earnings": { file: "MyEarnings", text: "My Earnings" },
  "/dashboard/admin-hub": { file: "AdminHub", text: "Administration" },
  "/dashboard/knowledge-base": { file: "KnowledgeBase", text: "Knowledge Base" },
};
const pagesWithHeadings = Object.entries(PAGE_RULES).filter(([, rule]) => rule.page).map(([path]) => path).sort();
eq(Object.keys(headingSources).sort(), pagesWithHeadings, "every registered page heading has a source to compare with");
for (const [path, source] of Object.entries(headingSources)) {
  const rule = PAGE_RULES[path];
  eq(rule.page, source.text, `${path}: registry heading matches the expected text`);
  const text = page(source.file);
  const escaped = source.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rendered = new RegExp(`(?:title=["'{]+${escaped}["'}]|<(?:PageTitle|h1)[^>]*>\\s*${escaped}\\b|PageHeader[^>]*title=["']${escaped}["'])`).test(text);
  ok(rendered, `${path}: ${source.file} renders the heading "${source.text}"`);
}

// 7. Tab labels equal the TabsTrigger text; every tab value the page can select is registered.
function triggers(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of read(file).matchAll(/<TabsTrigger value="([a-z-]+)"[^>]*>([\s\S]*?)<\/TabsTrigger>/g)) {
    const label = m[2].replace(/<[^>]+\/>/g, "").replace(/\{[^}]*\}/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (label) out[m[1]] = label;
  }
  return out;
}
const hubs: Array<{ path: string; file: string; exclude?: string[]; extra?: Record<string, string> }> = [
  { path: "/dashboard/tasks-appointments", file: "TasksAppointments" },
  { path: "/dashboard/contacts-leads", file: "ContactsAndLeads" },
  { path: "/dashboard/outbound-center", file: "OutboundCenter" },
  // master-leads and promotion-review are nested tabs inside the Staging tab, not top-level lead-ops tabs.
  { path: "/dashboard/lead-ops", file: "LeadOpsCenter", exclude: ["master-leads", "promotion-review"] },
  // The remaining report tabs are selected through the area buttons (Operations, Outreach, Financial), not TabsTrigger.
  { path: "/dashboard/reporting", file: "ReportingHub", extra: { "outreach-analytics": "Outreach", operations: "Operations", financial: "Financial" } },
];
for (const hub of hubs) {
  const found = triggers(`client/src/pages/dashboard/${hub.file}.tsx`);
  for (const skip of hub.exclude ?? []) delete found[skip];
  Object.assign(found, hub.extra ?? {});
  eq(PAGE_RULES[hub.path].tabs, found, `${hub.path}: registry tabs equal the ${hub.file} tabs and labels`);
}
{
  const admin = page("AdminHub");
  const block = admin.match(/const TAB_LABEL[^=]*=\s*\{([\s\S]*?)\};/);
  ok(block, "AdminHub declares TAB_LABEL");
  const labels: Record<string, string> = {};
  for (const m of (block?.[1] ?? "").matchAll(/"([a-z-]+)":\s*"([^"]+)"/g)) labels[m[1]] = m[2];
  eq(PAGE_RULES["/dashboard/admin-hub"].tabs, labels, "Administration registry tabs equal AdminHub TAB_LABEL");
}
// The reporting area buttons really carry those labels.
{
  const reporting = page("ReportingHub");
  for (const label of ["Operations", "Outreach", "Financial"]) ok(new RegExp(`\\n\\s+${label}\\n\\s+</button>`).test(reporting), `ReportingHub area button "${label}"`);
}

// 8. The shell and Contact use the shared mapping; no route/role wrapper is edited by this change.
const layout = read("client/src/pages/DashboardLayout.tsx");
ok(layout.includes("<WorkspaceTitle") && !layout.includes("<ShellPageTitle"), "the shell title slot is rendered by the shared component");
ok(layout.includes("noteRouteChange("), "the shell records route changes for the record origin");
ok(!/"Dashboard"/.test(read("client/src/components/crm/WorkspaceTitle.tsx")), "the shared title does not invent a Dashboard label");
const detail = page("ContactDetail");
ok(detail.includes("readRecordOrigin(user?.id ?? undefined, user?.role ?? undefined, recordPath)"), "Contact Back reads the validated origin for this actor and role");
ok(/registryReturn \?\? workReturn \?\? recordOrigin\?\.href \?\? readReturnUrl\("people", user\?\.id\) \?\? "\/dashboard\/contacts"/.test(detail),
  "Back precedence: explicit registry/work return, then the opening area, then the People list, then People");
ok(detail.includes('"Back to Contacts"'), "direct entry keeps the People Back label");
const route = read("client/src/App.tsx");
ok(!/WorkspaceTitle|workspace-identity|record-origin/.test(route), "route and role wrappers in App.tsx are untouched by this mapping");

// 9. Origin: safe, per actor, per record, re-validated for the role.
store.clear();
origin.resetRouteHistoryForTests();
const contact = "/dashboard/contacts/123";
origin.rememberRecordOrigin("u1", "admin", contact, "/dashboard/pipeline?group=stage");
eq(origin.readRecordOrigin("u1", "admin", contact), { href: "/dashboard/pipeline?group=stage", areaLabel: "Pipeline" }, "origin returns to the opening area");
eq(origin.readRecordOrigin("u2", "admin", contact), null, "another actor never reads it");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/124"), null, "another record never reads it");
eq(origin.readRecordOrigin("u1", "agent", contact)?.areaLabel, "Pipeline", "an agent may return to Pipeline");
origin.rememberRecordOrigin("u1", "manager", contact, "/dashboard/reporting?tab=growth");
eq(origin.readRecordOrigin("u1", "manager", contact)?.areaLabel, "Reports", "manager origin from Reports");
eq(origin.readRecordOrigin("u1", "agent", contact), null, "after the actor loses Reports access the origin is no longer offered");
origin.rememberRecordOrigin("u1", "admin", contact, "/dashboard/tasks-appointments?tab=tasks&taskId=7");
eq(origin.readRecordOrigin("u1", "admin", contact)?.areaLabel, "Work", "the newest origin replaces the previous one");
for (const bad of [
  "https://example.com/dashboard/pipeline", "//evil.example/dashboard/pipeline", "javascript:alert(1)", "/dashboard/pipeline?x=<script>",
  "/dashboard/pipeline#frag", "/admin", "/dashboard/contacts/9", "/dashboard/companies/9", "/dashboard/contacts?tab=people",
  "/dashboard/contacts-leads?tab=people", "/dashboard/unregistered-page", "/dashboard/notifications", "", "/dashboard/pipeline?" + "a".repeat(1600),
]) {
  store.clear();
  origin.rememberRecordOrigin("u1", "admin", contact, bad);
  eq(origin.readRecordOrigin("u1", "admin", contact), null, `unsafe or non-area origin is refused: ${bad.slice(0, 40)}`);
}
store.clear();
origin.rememberRecordOrigin("u1", "admin", "/dashboard/lead-ops", "/dashboard/pipeline");
origin.rememberRecordOrigin("u1", "admin", "/dashboard/contacts/abc/../x", "/dashboard/pipeline");
eq(store.size, 0, "only record paths store an origin");
// A tampered stored value is re-validated on read.
store.set("crm:origin:u1", JSON.stringify([{ record: contact, origin: "https://evil.example/dashboard/pipeline" }]));
eq(origin.readRecordOrigin("u1", "admin", contact), null, "a tampered stored origin is ignored");
store.set("crm:origin:u1", "not json");
eq(origin.readRecordOrigin("u1", "admin", contact), null, "corrupt storage is ignored");
// Capacity is bounded.
store.clear();
for (let i = 1; i <= 30; i++) origin.rememberRecordOrigin("u1", "admin", `/dashboard/contacts/${i}`, "/dashboard/pipeline");
eq(JSON.parse(store.get("crm:origin:u1")!).length, 20, "at most twenty origins are kept per actor");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/1"), null, "the oldest origin was evicted");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/30")?.areaLabel, "Pipeline", "the newest origin is kept");

// 10. Route-change recorder: only a path change records; record-to-record and first loads record nothing; actors are separate.
store.clear();
origin.resetRouteHistoryForTests();
origin.noteRouteChange("u1", "admin", "/dashboard/pipeline", "/dashboard/pipeline");
origin.noteRouteChange("u1", "admin", "/dashboard/contacts/5", "/dashboard/contacts/5");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/5")?.areaLabel, "Pipeline", "opening a contact from Pipeline records Pipeline");
origin.noteRouteChange("u1", "admin", "/dashboard/contacts/5", "/dashboard/contacts/5?section=notes");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/5")?.areaLabel, "Pipeline", "moving between sections keeps the origin");
origin.noteRouteChange("u1", "admin", "/dashboard/contacts/6", "/dashboard/contacts/6");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/6"), null, "record to record never records a record as origin");
origin.noteRouteChange("u1", "admin", "/dashboard/comms-hub", "/dashboard/comms-hub?thread=1");
origin.noteRouteChange("u1", "admin", "/dashboard/contacts/5", "/dashboard/contacts/5");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/5")?.href, "/dashboard/comms-hub?thread=1", "reopening from Inbox replaces the origin");
origin.resetRouteHistoryForTests();
origin.noteRouteChange("u1", "admin", "/dashboard/contacts/9", "/dashboard/contacts/9");
eq(origin.readRecordOrigin("u1", "admin", "/dashboard/contacts/9"), null, "a first load (direct link, reload in a new tab) has no origin");
origin.noteRouteChange("u1", "admin", "/dashboard/pipeline", "/dashboard/pipeline");
origin.noteRouteChange("u2", "admin", "/dashboard/contacts/11", "/dashboard/contacts/11");
eq(origin.readRecordOrigin("u2", "admin", "/dashboard/contacts/11"), null, "a different actor does not inherit the previous actor's route");
origin.noteRouteChange(undefined, "admin", "/dashboard/pipeline", "/dashboard/pipeline");
origin.noteRouteChange("u3", "admin", "/dashboard/contacts/12", "/dashboard/contacts/12");
eq(origin.readRecordOrigin("u3", "admin", "/dashboard/contacts/12"), null, "signing out forgets the held route");

console.log(`Phase 6 workspace identity: ${checks} checks passed`);
console.log("WORKSPACE_IDENTITY_PASS");
