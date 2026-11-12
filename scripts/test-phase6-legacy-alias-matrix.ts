import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LEGACY_ALIAS_CONTEXT_KEYS, STATIC_DASHBOARD_ALIASES, legacyAliasUrl, staticAliasFor,
} from "../client/src/lib/legacy-aliases";

// CRM-03: every static legacy dashboard alias keeps the registered selected-record / filter context and the safe fragment,
// replaces the retired path, and has a registered canonical destination. The matrix is generated from the alias table and
// from App.tsx, so a new alias cannot ship as a context-dropping `<Redirect to="…?tab=…">`.
const app = fs.readFileSync("client/src/App.tsx", "utf8");

// 1. Table integrity.
const froms = STATIC_DASHBOARD_ALIASES.map((entry) => entry.from);
assert.equal(new Set(froms).size, froms.length, "alias paths are unique");
for (const entry of STATIC_DASHBOARD_ALIASES) {
  assert.ok(entry.from.startsWith("/dashboard/"), `${entry.from} is a dashboard alias`);
  assert.notEqual(entry.from, entry.to, `${entry.from} must not redirect to itself`);
  assert.ok(entry.to === "/dashboard" || app.includes(`<Route path="${entry.to}">`), `${entry.to} is a registered destination for ${entry.from}`);
  assert.ok(!("tab" in entry.fixed) || /^[a-z0-9-]+$/.test(entry.fixed.tab), `${entry.from} fixes a well-formed tab`);
}

// 2. App.tsx mounts exactly the table (no hand-written static alias redirect left in a dashboard route).
const mounted = [...app.matchAll(/<Route path="(\/dashboard\/[^"]+)">\s*<LegacyAlias from="([^"]+)"\s*\/>\s*<\/Route>/g)];
assert.deepEqual(mounted.map((m) => m[1]).sort(), [...froms].sort(), "every table alias is mounted at its own path, and nothing else");
for (const m of mounted) assert.equal(m[1], m[2], "route path and alias key agree");
const staticDashboardRedirects = [...app.matchAll(/<Route path="(\/dashboard\/[^"]+)">\s*<Redirect to="[^"]+"\s*\/>\s*<\/Route>/g)];
assert.deepEqual(staticDashboardRedirects.map((m) => m[1]), [], "no context-dropping static dashboard redirect remains");

// 3. Every hand-written alias component replaces history (Back must not re-enter the retired path) and keeps the fragment
//    when it forwards arbitrary params.
for (const m of app.matchAll(/function (Legacy\w+Redirect|LegacyAlias)\b[\s\S]*?\n}\n/g)) {
  for (const redirect of m[0].matchAll(/<Redirect\b[^>]*>/g)) {
    assert.match(redirect[0], /\breplace\b/, `${m[1]} replaces history`);
  }
}
for (const m of app.matchAll(/<Redirect replace to=\{`\/dashboard\/lead-ops[^`]*`\}/g)) {
  assert.match(m[0], /aliasFragment\(window\.location\.hash\)/, "lead-ops alias keeps the safe fragment");
}

// 4. Generated behavior matrix: each alias x context case.
const cases: Array<{ name: string; search: string; hash: string; expect: (url: URL, fixed: Record<string, string>) => void }> = [
  { name: "no context", search: "", hash: "", expect: (url, fixed) => {
    for (const [k, v] of Object.entries(fixed)) assert.equal(url.searchParams.get(k), v);
    assert.equal(url.hash, "");
  } },
  { name: "selected record and fragment", search: "?id=42&contactId=7&dealId=9", hash: "#notes", expect: (url) => {
    assert.equal(url.searchParams.get("id"), "42");
    assert.equal(url.searchParams.get("contactId"), "7");
    assert.equal(url.searchParams.get("dealId"), "9");
    assert.equal(url.hash, "#notes");
  } },
  { name: "task and filter context", search: "?taskId=15&taskState=pending&due=overdue&thread=abc", hash: "", expect: (url) => {
    assert.equal(url.searchParams.get("taskId"), "15");
    assert.equal(url.searchParams.get("taskState"), "pending");
    assert.equal(url.searchParams.get("due"), "overdue");
    assert.equal(url.searchParams.get("thread"), "abc");
  } },
  { name: "retired tab never overrides the fixed tab", search: "?tab=something-else&id=3", hash: "", expect: (url, fixed) => {
    if ("tab" in fixed) assert.equal(url.searchParams.get("tab"), fixed.tab);
    else assert.equal(url.searchParams.has("tab"), false, "an alias with no fixed tab never forwards an unrelated tab");
    assert.equal(url.searchParams.get("id"), "3");
  } },
  { name: "unregistered and malformed state is dropped", search: "?utm=x&contactId=abc&id=1&id=2&taskId=0&from=https%3A%2F%2Fevil.example", hash: "#bad hash", expect: (url) => {
    assert.equal(url.searchParams.has("utm"), false);
    assert.equal(url.searchParams.has("contactId"), false, "non-integer entity id is dropped");
    assert.equal(url.searchParams.has("id"), false, "contradictory repeated selector is dropped, never first-wins");
    assert.equal(url.searchParams.has("taskId"), false);
    assert.equal(url.searchParams.has("from"), false, "external return target is dropped");
    assert.equal(url.hash, "");
  } },
];
let generated = 0;
for (const entry of STATIC_DASHBOARD_ALIASES) {
  for (const c of cases) {
    const url = new URL(legacyAliasUrl(entry.from, c.search, c.hash), "https://crm.invalid");
    assert.equal(url.pathname, entry.to, `${entry.from} (${c.name}) lands on ${entry.to}`);
    assert.equal(url.origin, "https://crm.invalid", "alias stays same-origin");
    c.expect(url, entry.fixed);
    generated += 1;
  }
}
assert.equal(generated, STATIC_DASHBOARD_ALIASES.length * cases.length);

// 5. Concrete bookmarks called out by the audit.
assert.equal(legacyAliasUrl("/dashboard/tickets", "?id=42", "#notes"), "/dashboard/support-hub?id=42&tab=tickets#notes");
assert.equal(legacyAliasUrl("/dashboard/tasks", "", ""), "/dashboard/tasks-appointments?tab=tasks");
assert.equal(legacyAliasUrl("/dashboard/tasks", "?taskId=15", ""), "/dashboard/tasks-appointments?taskId=15&tab=tasks");
assert.equal(legacyAliasUrl("/dashboard/sms-inbox", "?thread=t1", ""), "/dashboard/comms-hub?thread=t1&tab=messages");
assert.equal(legacyAliasUrl("/dashboard/virtual-terminal", "", ""), "/dashboard");
assert.throws(() => staticAliasFor("/dashboard/not-an-alias"), /Unregistered legacy alias/);
assert.ok(!LEGACY_ALIAS_CONTEXT_KEYS.includes("tab"), "the retired tab selector is never carried forward");

console.log(`phase6 legacy alias matrix: ok (${STATIC_DASHBOARD_ALIASES.length} aliases, ${generated} generated cases)`);
