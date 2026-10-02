import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGhlInboundCursor } from "../server/services/ghl-inbound-pagination";

const location = "pagination-test-location";
const url = `https://services.leadconnectorhq.com/contacts/?locationId=${location}&limit=100&startAfter=1790970000000&startAfterId=cursor-2`;
const cursor = { startAfter: "1790970000000", startAfterId: "cursor-2" };
assert.deepEqual(parseGhlInboundCursor({ nextPageUrl: url, nextPage: 2 }, location, 100), cursor);
assert.deepEqual(parseGhlInboundCursor({ nextPage: url }, location, 100), cursor);
assert.deepEqual(parseGhlInboundCursor({
  nextPageUrl: null, nextPage: 2, startAfter: 1790970000000, startAfterId: "cursor-2",
}, location, 100), cursor);
assert.deepEqual(parseGhlInboundCursor({
  nextPage: 2, startAfter: cursor.startAfter, startAfterId: cursor.startAfterId,
}, location, 100), cursor);
// Terminal response: nextPage remains a numeric counter, but no URL/cursor.
assert.equal(parseGhlInboundCursor({ nextPageUrl: null, nextPage: 41, startAfter: null, startAfterId: null }, location, 100), null);
assert.equal(parseGhlInboundCursor({}, location, 100), null);
assert.throws(() => parseGhlInboundCursor({ nextPage: {} }, location, 100), /PAGINATION_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPage: 1.5 }, location, 100), /PAGINATION_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageUrl: 42 }, location, 100), /PAGINATION_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageUrl: url.replace("leadconnectorhq.com", "example.com") }, location, 100), /HOST_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageUrl: url.replace(location, "other-location") }, location, 100), /SCOPE_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageUrl: url.replace("limit=100", "limit=1000") }, location, 100), /SCOPE_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageUrl: url.replace("&startAfterId=cursor-2", "") }, location, 100), /CURSOR_MISSING/);
assert.throws(() => parseGhlInboundCursor({ startAfter: NaN, startAfterId: "cursor-2" }, location, 100), /CURSOR_INVALID/);
assert.throws(() => parseGhlInboundCursor({ startAfter: "timestamp", startAfterId: null }, location, 100), /CURSOR_INVALID/);
assert.throws(() => parseGhlInboundCursor({ nextPageToken: "unknown" }, location, 100), /CURSOR_UNSUPPORTED/);

const service = await readFile(new URL("../server/services/ghl-inbound-sync.ts", import.meta.url), "utf8");
assert.match(service, /const next = parseGhlInboundCursor\(meta, location, PAGE_SIZE\)/);
assert.match(service, /if \(hasMore && !page.next\) throw new Error\("GHL_INBOUND_PAGINATION_INCOMPLETE"\)/);
assert.match(service, /GHL_INBOUND_PAGINATION_LOOP/);
const commands = await readFile(new URL("../server/services/ghl-specialized-commands.ts", import.meta.url), "utf8");
const backfill = commands.slice(commands.indexOf("async function processBackfill("), commands.indexOf("export function permissionFields("));
assert.doesNotMatch(backfill, /getGhlSyncControl\(|GHL_CRM_CONTROL_DISABLED/);
assert.match(backfill, /await lookupExistingGhlContactByEmail\(email\)/);
assert.match(commands, /authorizeGhlCrmOperation\(\{ method: "GET", path, locationId \}\)/);
console.log("GHL pagination and read-only backfill regression checks passed.");