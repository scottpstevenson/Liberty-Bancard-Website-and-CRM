/** Explicit read-only provider diagnosis. Never imports DB-bound application
 * modules, prints credentials/content, or calls a write/provider-send method. */
import { writeFile } from "node:fs/promises";
const base = "https://services.leadconnectorhq.com";
const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
const location = process.env.GHL_LOCATION_ID;
const calendar = process.env.GHL_CALENDAR_ID;
if (!token || !location) throw new Error("Provider configuration unavailable");
async function read(path: string) {
  const response = await fetch(base + path, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
const inventory = await read(`/calendars/?locationId=${encodeURIComponent(location)}`);
const calendars = inventory.body?.calendars;
const configured = calendar ? await read(`/calendars/${encodeURIComponent(calendar)}`) : null;
const window = `locationId=${encodeURIComponent(location)}&startTime=${Date.now()-86400000}&endTime=${Date.now()+30*86400000}&limit=50`;
const events = await read(`/calendars/events?${window}${calendar ? `&calendarId=${encodeURIComponent(calendar)}` : ""}`);
const coverage = Array.isArray(calendars) ? await Promise.all(calendars.map(async (c: any) => {
  if (typeof c.id !== "string" || c.locationId !== location) return { locationMatches: false };
  const result = await read(`/calendars/events?${window}&calendarId=${encodeURIComponent(c.id)}`);
  const withoutLimit = await read(`/calendars/events?${window.replace("&limit=50", "")}&calendarId=${encodeURIComponent(c.id)}`);
  return { locationMatches: true, status: result.status,
    eventCount: Array.isArray(result.body?.events) ? result.body.events.length : null,
    rejectsLimitParameter: JSON.stringify(result.body?.message ?? "").includes("limit"),
    withoutLimitStatus: withoutLimit.status,
    withoutLimitEventCount: Array.isArray(withoutLimit.body?.events) ? withoutLimit.body.events.length : null };
})) : [];
const sample = await read("/conversations/messages/RCzbKnzWrHhJBag9AAhJ");
const message = sample.body?.message ?? sample.body;
const report = {
  methods: ["GET"], recordWrites: 0, outboundCalls: 0,
  locationMatchesSampleNamespace: location === "BbcWy2xmyg4izLjlFfLQ",
  inventoryStatus: inventory.status,
  calendarCount: Array.isArray(calendars) ? calendars.length : null,
  configuredCalendarInInventory: Array.isArray(calendars) ? calendars.some((c: any) => c.id === calendar) : null,
  configuredCalendarStatus: configured?.status,
  configuredCalendarLocationMatches: configured?.body?.calendar?.locationId === location,
  eventsStatus: events.status,
  eventCount: Array.isArray(events.body?.events) ? events.body.events.length : null,
  // Only recognized diagnostic labels, never an arbitrary provider body.
  calendarNotFound: JSON.stringify(events.body?.message) === JSON.stringify("The calendar is not found."),
  accessibleCalendarCoverage: coverage,
  whitespaceOnlyCalendarMismatch: Array.isArray(calendars) && typeof calendar === "string"
    ? calendars.some((c: any) => c.id === calendar.trim()) : false,
  messageStatus: sample.status,
  messageLocationMatches: message?.locationId ? message.locationId === location : null,
  messageHasContact: typeof message?.contactId === "string",
  messageHasConversation: typeof message?.conversationId === "string",
  messageDirection: ["inbound", "outbound"].includes(message?.direction) ? message.direction : null,
};
await writeFile("/tmp/c2-provider-diagnosis.json", JSON.stringify({ ...report,
  sourceContactId: typeof message?.contactId === "string" ? message.contactId : null,
  sourceConversationId: typeof message?.conversationId === "string" ? message.conversationId : null,
}), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
