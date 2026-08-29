/**
 * Fast structural regression checks for Task 1721 authority boundaries.
 * This is deliberately database-free and does not invoke any send transport.
 */
import { readFileSync } from "node:fs";
import { assertNoRawAutomaticTaskCreates } from "../server/services/task-authority";

const inboxResolution = readFileSync("server/services/inbox-item-resolution.ts", "utf8");
const inboxRoutes = readFileSync("server/routes/inbox.ts", "utf8");
const commsHub = readFileSync("client/src/pages/dashboard/CommsHub.tsx", "utf8");
const statementRoutes = readFileSync("server/routes/statement-review.ts", "utf8");
const storage = readFileSync("server/storage/inbox.ts", "utf8");
const taskMigration = readFileSync("migrations/0181_cr05_task_ticket_authority.sql", "utf8");
const adminRoutes = readFileSync("server/routes/admin.ts", "utf8");
const ticketTaskRoutes = readFileSync("server/routes/tickets-tasks.ts", "utf8");
const taskStorage = readFileSync("server/storage/tasks.ts", "utf8");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Task 1721 structural check failed: ${message}`);
}

assert(!/\bnew Map\s*\(/.test(inboxResolution), "Inbox resolution must not use process-local Map authority");
assert(!/getInboxItemResolution|rememberInboxItemResolutions/.test(inboxRoutes), "Inbox routes must not use process-local resolutions");
assert(/classifyIntent\(resolved\.body/.test(inboxRoutes), "Classification must use server-resolved immutable body");
assert(!/const \{\s*body:\s*messageBody,\s*contactId,\s*channel/.test(inboxRoutes), "Classification must not destructure client content authority");
assert(/sourceNamespace.*sourceItemId/.test(storage), "Inbox storage must use namespace plus provider item identity");
assert(/isNull\(inboxItems\.sourceNamespace\)/.test(storage), "Legacy null namespaces must resolve without a backfill");
const rememberSource = storage.slice(
  storage.indexOf("export async function rememberInboxSourceItem"),
  storage.indexOf("export async function getInboxItem"),
);
assert(/onConflictDoNothing\(\)/.test(rememberSource), "Source observation insert must be conflict-safe");
assert(/getInboxItem\(/.test(rememberSource), "Source observation conflict must return a canonical read");
const updateSource = storage.slice(
  storage.indexOf("export async function updateInboxItem"),
  storage.indexOf("export async function getInboxItemsWithSlaBreaches"),
);
assert(/const allowed =/.test(updateSource), "Inbox updates must use an operational field allowlist");
for (const forbidden of ["sourceItemType", "sourceNamespace", "sourceItemId", "providerConversationId", "sourceBody", "sourceReceivedAt"]) {
  const allowlist = updateSource.match(/const allowed = \[([\s\S]*?)\] as const/)?.[1] || "";
  assert(!allowlist.includes(`"${forbidden}"`), `Inbox updates must forbid ${forbidden}`);
}
assert(!/status:\s*"follow_up_sent"|followUpSentAt/.test(statementRoutes), "Statement workflow must not expose status-only follow-up delivery");
assert(!/significant savings|industry benchmark|fee categories show room/i.test(statementRoutes), "Draft must not add unsupported generic claims");
assert(/savingsEvidence/.test(statementRoutes) && /documentId.*currency.*period/s.test(statementRoutes), "Savings claim must be evidence-bound");
assert(/createCommandKey/.test(statementRoutes) && /onConflictDoNothing/.test(storage), "Statement creates must carry an idempotency command fence");
assert(/sources:\s*Record<string,\s*SourceCursor>/.test(inboxRoutes), "Cursor must carry per-source continuation state");
assert(/queryFingerprint/.test(inboxRoutes) && /actorFingerprint/.test(inboxRoutes), "Cursor must bind normalized query and actor scope");
assert(/createHmac/.test(inboxRoutes) && /timingSafeEqual/.test(inboxRoutes), "Cursor must be opaque and integrity protected");
assert(/merge\?:\s*\{\s*timestamp:\s*string;\s*source:\s*string;\s*id:\s*string/.test(inboxRoutes), "Cursor must carry deterministic merge tie-break");
assert(/remainder\?:\s*InboxItem\[\]/.test(inboxRoutes), "Cursor must carry merged losers instead of dropping them");
assert(/MAX_INBOX_CURSOR_BYTES/.test(inboxRoutes) && /MAX_INBOX_CURSOR_REMAINDER/.test(inboxRoutes), "Cursor remainder must be bounded");
assert(!/const page = filtered\.slice\(0, limit\)/.test(inboxRoutes), "Kill line: post-merge slicing without a remainder is forbidden");
assert(!/knownFilteredTotal/.test(inboxRoutes + commsHub), "Fetched-window count must not be represented as an exact total");
assert(!/await response\.text\(\)[\s\S]{0,160}throw new Error\(`GHL/.test(inboxRoutes), "Provider response bodies must not enter errors");
assert(!/source_failed[^\\n]*\\.message/.test(inboxRoutes), "Source failure logs must use stable codes only");
assertNoRawAutomaticTaskCreates();
assert(/task_authority_events/.test(taskMigration), "Task authority events must be durable");
assert(/tasks_active_authority_issue_uidx/.test(taskMigration), "Automatic tasks must have one active producer/issue/subject identity");
const activeTaskIndex = taskMigration.match(/CREATE UNIQUE INDEX tasks_active_authority_issue_uidx([\s\S]*?)WHERE/)?.[1] ?? "";
assert(!activeTaskIndex.includes("generation"), "Active task identity must be independent of generation");
assert(/pg_advisory_xact_lock/.test(taskStorage) && /coalesce\(max\(/.test(taskStorage), "Generation allocation must be serialized and monotonic");
const ticketCreate = ticketTaskRoutes.match(/app\.post\("\/api\/tickets"[\s\S]*?\n  \}\);/)?.[0] ?? "";
for (const forbidden of ["triggerWorkflowsByEvent", "enrollInGhlWorkflow", "createPreferenceAwareNotification"]) {
  assert(!ticketCreate.includes(forbidden), `Ticket create must not invoke ${forbidden}`);
}
assert(
  adminRoutes.includes("/api/admin/purge-test-contacts") &&
    /purge-test-contacts[\s\S]{0,800}status\(410\)/.test(adminRoutes),
  "Disabled cleanup endpoint guard must remain enforced",
);

console.log("Task 1721 structural checks passed");