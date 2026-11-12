import assert from "node:assert/strict";
import fs from "node:fs";
import { blockedContactsHref, mobileDestinationFor } from "../client/src/lib/mobile-destination";
import {
  decodeLiveHealth, healthFreshness, healthSummary, inboxSummary, taskSummary,
} from "../client/src/lib/mobile-more-summary";
import {
  INBOX_FEED_REFRESH_MS, INBOX_MAX_AUTO_REFRESH_PAGES, inboxFeedRefreshInterval, inboxForegroundRefresh, selectedFeedStamp,
} from "../client/src/lib/inbox-refresh";
import { peopleState } from "../client/src/lib/crm-destination-state";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };

// ── CRM-05: desktop -> mobile destination mapping never swaps a record for the home page ────────────────────────────
eq(mobileDestinationFor("/dashboard", "", ""), { kind: "redirect", href: "/mobile" }, "plain overview maps to mobile home");
eq(mobileDestinationFor("/dashboard/contacts/42", "?area=activity&section=history", "#notes"), { kind: "redirect", href: "/mobile/contacts/42#notes" },
  "an open contact record reaches the same contact on mobile");
for (const bad of ["abc", "0", "-3", "4.5", "99999999999999999999"]) {
  const result = mobileDestinationFor(`/dashboard/contacts/${bad}`, "", "");
  ok(result.kind === "choose", `invalid contact id ${bad} is not redirected anywhere`);
}
eq(mobileDestinationFor("/dashboard/contacts", "", ""), { kind: "redirect", href: "/mobile/contacts" }, "plain People list maps to the mobile list");
ok(mobileDestinationFor("/dashboard/contacts", "?blocked=true", "").kind === "choose", "a filtered People list is never replaced by the unfiltered mobile list");
eq(mobileDestinationFor("/dashboard/pipeline", "", ""), { kind: "redirect", href: "/mobile/pipeline" }, "plain pipeline maps");
ok(mobileDestinationFor("/dashboard/pipeline", "?id=7", "").kind === "choose", "a selected deal is not dropped");
const inbox = mobileDestinationFor("/dashboard/comms-hub", "?channel=email&filter=unread&thread=email_audit%3A55&junk=1", "");
ok(inbox.kind === "redirect" && inbox.href.startsWith("/mobile/inbox?"), "inbox maps to the mobile inbox");
if (inbox.kind === "redirect") {
  const url = new URL(inbox.href, "https://x.invalid");
  eq([url.searchParams.get("channel"), url.searchParams.get("filter"), url.searchParams.get("thread")], ["email", "unread", "email_audit:55"],
    "channel, filter and the selected thread cross the breakpoint");
}
ok(mobileDestinationFor("/dashboard/comms-hub", "?tab=unknown", "").kind === "choose", "an unrecognized inbox selection is not guessed");
eq(mobileDestinationFor("/dashboard/tasks-appointments", "?tab=tasks", ""), { kind: "redirect", href: "/mobile/tasks" }, "plain task list maps");
for (const search of ["?tab=tasks&taskId=15", "?tab=tasks&due=overdue", "?tab=calendar", "?tab=tasks&taskState=pending"]) {
  ok(mobileDestinationFor("/dashboard/tasks-appointments", search, "").kind === "choose", `${search} keeps the selected task/filter/calendar`);
}
const request = mobileDestinationFor("/dashboard/lead-ops", "?tab=pipeline&ref=ABCD1234", "");
ok(request.kind === "choose" && request.desktopHref === "/dashboard/lead-ops?tab=pipeline&ref=ABCD1234" && request.mobileHref === "/mobile",
  "a website-request link is offered unchanged in the desktop layout, with the mobile home as the explicit alternative");
const statement = mobileDestinationFor("/dashboard/statement-review", "?documentId=9", "#a");
ok(statement.kind === "choose" && statement.desktopHref === "/dashboard/statement-review?documentId=9#a", "statement review keeps its document selection");

// Blocked Contacts uses the People contract (`blocked=true`), and People accepts it as a registered filter.
eq(blockedContactsHref(), "/dashboard/contacts?blocked=true", "blocked contacts href");
const people = peopleState(blockedContactsHref().split("?")[1], true);
eq(people.params.get("blocked"), "true", "People keeps the blocked filter");
eq(people.issues, [], "People raises no issue for the blocked href");

// ── CRM-06: truthful More summaries ───────────────────────────────────────────────────────────────────────────────
const liveShape = (checks: Array<{ name: string; status: string; detail?: string; critical?: boolean }>, ok: boolean) => ({
  ok, fetchedAt: "2026-11-11T15:00:00.000Z", checks,
  summary: { total: checks.length, ok: checks.filter((c) => c.status === "ok").length, critical: checks.filter((c) => c.critical).length, criticalOk: checks.filter((c) => c.critical && c.status === "ok").length },
  releaseSha: null, cached: true, cacheAgeMs: 1000,
});
const healthy = decodeLiveHealth(liveShape([
  { name: "db", status: "ok", detail: "3ms", critical: true }, { name: "redis", status: "ok", detail: "2ms", critical: true },
  { name: "ai", status: "ok", detail: "configured", critical: false },
], true));
const settled = healthSummary({ isLoading: false, isError: false, data: healthy });
eq([settled.tone, settled.ok, settled.badge], ["healthy", true, null], "only a decoded, fully passing read is healthy");
eq(healthSummary({ isLoading: false, isError: false, data: healthy }).label, "3 of 3 checks passing", "counts come from the decoded checks, never undefined/undefined");

const mixed = decodeLiveHealth(liveShape([
  { name: "db", status: "ok", critical: true }, { name: "slaWorker", status: "stale", detail: "stale >15m", critical: false },
  { name: "ghlSync", status: "warn", critical: false }, { name: "dbBackup", status: "error", critical: false },
], true));
const attention = healthSummary({ isLoading: false, isError: false, data: mixed });
eq([attention.tone, attention.ok], ["attention", false], "stale, warn and error checks are never 'all systems go'");
ok(attention.tone === "attention" && attention.passing === 1 && attention.notPassing === 3 && attention.total === 4, "attention counts");
const critical = decodeLiveHealth(liveShape([{ name: "db", status: "error", critical: true }, { name: "ai", status: "ok", critical: false }], false));
eq(healthSummary({ isLoading: false, isError: false, data: critical }).tone, "unhealthy", "a failing critical check is unhealthy");
// Server says not ok even though every listed check passes: still not healthy.
const serverNotOk = decodeLiveHealth(liveShape([{ name: "db", status: "ok", critical: true }], false));
eq(healthSummary({ isLoading: false, isError: false, data: serverNotOk }).tone, "unhealthy", "server ok=false is never overridden");

for (const malformed of [
  null, {}, { overallOk: true }, { ok: true, checks: [], summary: { total: 0, ok: 0, critical: 0, criticalOk: 0 } },
  { ok: true, checks: [{ name: "db", status: "fine" }], summary: { total: 1, ok: 1, critical: 0, criticalOk: 0 } },
  { ok: true, checks: { db: { status: "ok" } }, okCount: 1, totalCount: 1 },
  liveShape([{ name: "db", status: "ok" }], true) && { ...liveShape([{ name: "db", status: "ok" }], true), summary: { total: 9, ok: 1, critical: 0, criticalOk: 0 } },
]) {
  assert.throws(() => decodeLiveHealth(malformed), `malformed health answer is rejected: ${JSON.stringify(malformed)?.slice(0, 60)}`);
  checks++;
}
eq(healthSummary({ isLoading: true, isError: false, data: undefined }).tone, "loading", "loading is its own state");
eq(healthSummary({ isLoading: false, isError: true, data: undefined }).tone, "unavailable", "a failed read is unavailable");
eq(healthSummary({ isLoading: false, isError: false, data: undefined }).tone, "unavailable", "no data and no error is unavailable, never healthy");
ok(!/all systems go|passing/i.test(healthSummary({ isLoading: false, isError: true, data: undefined }).label), "unavailable never claims passing");
eq(healthFreshness(healthy, Date.parse("2026-11-11T15:04:30.000Z")), "Checked 4 min ago", "freshness label");
eq(healthFreshness(healthy, Date.parse("2026-11-11T14:00:00.000Z")), null, "a future timestamp says nothing");

const page = (over: Record<string, unknown> = {}) => ({
  items: [], complete: true, totalIsExact: true, knownFilteredCount: 0, hasMoreKnown: false, nextCursor: null,
  sourceStatus: [{ source: "email_audit", status: "ok", fetched: 0, truncated: false }], ...over,
}) as any;
const row = { id: "email_audit:1", contactId: 3, contactName: "A", channel: "email", isRead: false } as any;
eq(inboxSummary({ isLoading: true, isError: false, data: undefined }).tone, "loading", "inbox loading state");
ok(!/no unread|no new/i.test(inboxSummary({ isLoading: true, isError: false, data: undefined }).label), "loading never says no messages");
eq(inboxSummary({ isLoading: false, isError: true, data: undefined }).tone, "unavailable", "inbox failure is unavailable");
const one = inboxSummary({ isLoading: false, isError: false, data: page({ items: [row], knownFilteredCount: 1 }) });
eq([one.label, one.badge, one.complete], ["1 unread", "1", true], "one unread loaded email is reflected, with completeness");
const partial = inboxSummary({ isLoading: false, isError: false, data: page({ items: [row], complete: false, hasMoreKnown: true }) });
eq([partial.badge, partial.complete], ["1+", false], "an incomplete page is a lower bound");
ok(/incomplete/.test(partial.label), "incomplete count states it");
eq(inboxSummary({ isLoading: false, isError: false, data: page() }).label, "No unread messages", "empty complete page may say none");
const failedSource = inboxSummary({ isLoading: false, isError: false, data: page({ sourceStatus: [{ source: "ghl_sms", status: "failed", fetched: 0, truncated: false }] }) });
eq(failedSource.tone, "none_incomplete", "a failed source is never 'no messages'");
ok(/did not respond/.test(failedSource.label), "failed source named");
eq(inboxSummary({ isLoading: false, isError: false, data: page({ sourceStatus: [{ source: "ghl_sms", status: "not_configured", fetched: 0, truncated: false }] }) }).tone, "none",
  "an unconfigured source is not a failure");

const task = (id: number, status: string) => ({ id, title: "t", status, authorityFence: 1 });
eq(taskSummary({ isLoading: true, isError: false, data: undefined }).label, "Loading tasks…", "tasks loading never says caught up");
eq(taskSummary({ isLoading: false, isError: true, data: undefined }).tone, "unavailable", "tasks failure is unavailable");
const five = taskSummary({ isLoading: false, isError: false, data: [1, 2, 3, 4, 5].map((n) => task(n, "pending")).concat([task(6, "completed"), task(7, "cancelled")] as any) as any });
eq([five.label, five.badge], ["5 open tasks", "5"], "open tasks exclude completed and cancelled");
eq(taskSummary({ isLoading: false, isError: false, data: [task(1, "in_progress")] as any }).label, "1 open task", "in-progress counts as open");
eq(taskSummary({ isLoading: false, isError: false, data: [] }).label, "No open tasks", "settled empty list");

// ── CRM-08: bounded foreground refresh ───────────────────────────────────────────────────────────────────────────
eq(inboxFeedRefreshInterval(1), INBOX_FEED_REFRESH_MS, "refreshes a short list");
eq(inboxFeedRefreshInterval(INBOX_MAX_AUTO_REFRESH_PAGES), INBOX_FEED_REFRESH_MS, "refreshes up to the page bound");
eq(inboxFeedRefreshInterval(INBOX_MAX_AUTO_REFRESH_PAGES + 1), false, "a deeply paged list is not re-read every cycle");
ok(INBOX_FEED_REFRESH_MS >= 30_000, "cadence is not a storm");
eq(inboxForegroundRefresh.refetchIntervalInBackground, false, "never refreshes in a hidden tab");
const rows = [
  { id: "a", contactId: 3, isRead: false, receivedAt: "2026-11-11T10:00:00Z" },
  { id: "b", contactId: 4, isRead: true, receivedAt: "2026-11-11T09:00:00Z" },
];
const base = selectedFeedStamp(rows, 3);
eq(selectedFeedStamp([...rows], 3), base, "an unchanged feed leaves the stamp unchanged (no refetch)");
eq(selectedFeedStamp([...rows, { id: "c", contactId: 4, isRead: false, receivedAt: "2026-11-11T11:00:00Z" }], 3), base, "another contact's reply does not refetch this conversation");
ok(selectedFeedStamp([{ id: "n", contactId: 3, isRead: false, receivedAt: "2026-11-11T12:00:00Z" }, ...rows], 3) !== base, "a new reply for this contact changes the stamp");
ok(selectedFeedStamp([{ ...rows[0], isRead: true }, rows[1]], 3) !== base, "a read-state change changes the stamp");
eq(selectedFeedStamp(rows, null), "", "no contact, no stamp");

// ── Source guards: the unsafe shapes cannot return ───────────────────────────────────────────────────────────────
const more = fs.readFileSync("client/src/pages/mobile/MobileMore.tsx", "utf8");
for (const forbidden of ["overallOk", "?? true", "/api/notifications", "tab=blocked", "okCount", "totalCount", "All systems go", "All caught up", "No new messages"])
  ok(!more.includes(forbidden), `MobileMore no longer contains ${forbidden}`);
const layout = fs.readFileSync("client/src/pages/DashboardLayout.tsx", "utf8");
ok(!/setLocation\("\/mobile"\)/.test(layout), "the responsive redirect never sends every entrance to the mobile home");
ok(/mobileDestinationFor\(/.test(layout) && /replace: true/.test(layout), "the breakpoint uses the destination mapping and replaces history");
const sw = fs.readFileSync("client/public/sw.js", "utf8");
ok(!/cache\.put|\.put\(/.test(sw), "the service worker never stores a response");
ok(!/caches\.match\(event\.request/.test(sw), "the service worker never replays a URL-keyed response");
const feed = fs.readFileSync("client/src/pages/mobile/MobileInbox.tsx", "utf8");
ok(/inboxFeedRefreshInterval/.test(feed) && /selectedFeedStamp/.test(feed), "mobile Inbox refreshes in the foreground");
const hub = fs.readFileSync("client/src/pages/dashboard/CommsHub.tsx", "utf8");
ok(/selectedFeedStamp/.test(hub) && /INBOX_FEED_REFRESH_MS/.test(hub), "desktop Inbox refreshes the selected conversation when its feed changes");
const queryClientSource = fs.readFileSync("client/src/lib/queryClient.ts", "utf8");
ok(/PURGE_PRIVATE_CACHES/.test(queryClientSource), "actor transitions ask the worker to purge legacy private caches");

console.log(`phase6 mobile continuity: ok (${checks} checks)`);
