import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { localCalendarDateAtTime, moveCalendarEventToDate } from "../client/src/lib/calendar-date-repair";
import { isPendingTask } from "../client/src/lib/task-source";

let assertions = 0;
function check(condition: unknown, message: string) {
  assert.ok(condition, message);
  assertions++;
}
const original = { startTime: new Date(2026, 0, 28, 9, 17, 23, 456).toISOString(),
  endTime: new Date(2026, 0, 28, 10, 47, 23, 456).toISOString() };
for (const day of ["2026-01-31", "2026-02-28", "2028-02-29", "2026-03-08", "2026-11-01"]) {
  const result = moveCalendarEventToDate(original, day);
  const start = new Date(result.startTime);
  check(start.getHours() === 9 && start.getMinutes() === 17 && start.getSeconds() === 23
    && start.getMilliseconds() === 456, `preserve original local time: ${day}`);
  check(new Date(result.endTime).getTime() - start.getTime() === 90 * 60000, `preserve duration: ${day}`);
  check(result.startTime === moveCalendarEventToDate(original, day).startTime, "reload replay is stable");
}
for (const day of ["", "2026-02-30", "2026-13-01", "2026-00-20", "2026-01-00", "2026-01-32"]) {
  assert.throws(() => moveCalendarEventToDate(original, day));
  assertions++;
}
assert.throws(() => moveCalendarEventToDate({ startTime: "invalid", endTime: "invalid" }, "2026-10-10"));
assertions++;
const replaced = moveCalendarEventToDate({ startTime: "invalid", endTime: "invalid" }, "2026-10-10",
  { startTime: "14:30", durationMinutes: 45 });
check(new Date(replaced.startTime).getHours() === 14, "explicit invalid-date replacement start");
check(new Date(replaced.endTime).getTime() - new Date(replaced.startTime).getTime() === 45 * 60000,
  "explicit positive invalid-date replacement duration");
for (const durationMinutes of [0, -1, NaN, 1.5, 10081]) {
  assert.throws(() => moveCalendarEventToDate({ startTime: original.startTime, endTime: original.startTime },
    "2026-10-10", { startTime: "09:00", durationMinutes }));
  assertions++;
}
if (process.env.TZ === "America/New_York") {
  assert.throws(() => localCalendarDateAtTime("2026-03-08", "02:30"), /does not exist/);
  assertions++;
  const crossing = moveCalendarEventToDate({
    startTime: new Date(2026, 2, 7, 1, 30).toISOString(),
    endTime: new Date(2026, 2, 7, 3, 30).toISOString(),
  }, "2026-03-08");
  check(new Date(crossing.endTime).getTime() - new Date(crossing.startTime).getTime() === 120 * 60000,
    "DST crossing retains elapsed positive duration");
}

// Exercise the actual mutation callbacks, without mounting/authenticating a real app.
const calendar = readFileSync("client/src/pages/dashboard/Calendar.tsx", "utf8");
const ast = ts.createSourceFile("Calendar.tsx", calendar, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration: ts.VariableDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "fixEventDateMutation") declaration = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(declaration);
const code = ts.transpileModule(`const ${declaration.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const requests: Array<{ method: string; url: string; body: any }> = [];
const records = new Map<string, any>();
const toasts: any[] = [];
let failure = false;
const mutation = new Function("useMutation", "apiRequest", "moveCalendarEventToDate",
  "localCalendarDateAtTime", "queryClient", "setFixingItemId", "setFixDate", "toast",
  `${code}; return fixEventDateMutation;`)(
  (callbacks: any) => callbacks,
  async (method: string, url: string, body: unknown) => {
    if (failure) throw new Error("Isolated persistence failure");
    requests.push({ method, url, body });
    records.set(url, structuredClone(body));
    return {};
  }, moveCalendarEventToDate, localCalendarDateAtTime, { invalidateQueries() {} },
  () => {}, () => {}, (toast: unknown) => toasts.push(toast));
const event = { ...original, source: "event", rawId: 73 };
const variables = { item: event, newDate: "2026-10-10" };
await mutation.mutationFn(variables);
mutation.onSuccess({}, variables);
check(requests[0].url === "/api/calendar-events/73", "event namespace preserved");
check(records.get("/api/calendar-events/73").endTime !== records.get("/api/calendar-events/73").startTime,
  "persisted/reloaded endpoints are distinct");
check(toasts[0].title === "Event date fixed", "successful persistence acknowledgement");
for (const item of [{ ...event, readOnly: true }, { ...event, source: "appointment" }]) {
  await assert.rejects(mutation.mutationFn({ item, newDate: "2026-10-10" }), /read-only/);
  assertions++;
}
check(requests.length === 1, "read-only provider items never dispatch writes");
await mutation.mutationFn({ item: { ...event, source: "deal" }, newDate: "2026-10-10" });
check(requests[1].url === "/api/deals/73" && "nextFollowUp" in requests[1].body
  && !("startTime" in requests[1].body), "deal namespace retained");
failure = true;
const before = structuredClone(records.get("/api/calendar-events/73"));
try {
  await mutation.mutationFn(variables);
  assert.fail("expected persistence failure");
} catch (error) {
  mutation.onError(error);
}
check(JSON.stringify(before) === JSON.stringify(records.get("/api/calendar-events/73")), "failed write retains prior record");
check(toasts.length === 2 && toasts[1].variant === "destructive", "failed write has no success toast");

const tasks = ["open", "in_progress", "completed", "cancelled"].map((effectiveState, id) => ({
  id, effectiveState, status: "pending", contactId: 77,
}));
check(tasks.filter(isPendingTask).length === 2, "open and in-progress counted consistently");
check(!isPendingTask({ effectiveState: "completed", status: "pending" }), "authority beats legacy status");
assert.throws(() => isPendingTask({ effectiveState: "unavailable" }));
assertions++;
const contact = readFileSync("client/src/pages/dashboard/ContactDetail.tsx", "utf8");
check(/const pendingTasks = tasksLoaded\s*\? tasks\.filter\(isPendingTask\)\s*:\s*undefined/.test(contact),
  "Contact consumes canonical predicate and retains unavailable state");
console.log(JSON.stringify({ status: "pass", assertions, timezone: process.env.TZ,
  effects: "no database, provider, authentication or outbound effects",
  limits: "mutation persistence is an injected store, not live SQL/browser acceptance" }));
