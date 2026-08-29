import { mergeInboxPage, type InboxItem } from "../server/routes/inbox";

function item(source: string, id: string, timestamp: string): InboxItem {
  return {
    id: `${source}::${id}`,
    contactId: 1,
    contactName: id,
    companyName: "",
    channel: "email",
    direction: "inbound",
    body: id,
    receivedAt: timestamp,
    intentLabel: null,
    confidence: null,
    isRead: false,
  };
}

const sourceA = [
  item("a", "1", "2026-01-01T10:00:00.000Z"),
  item("a", "2", "2026-01-01T08:00:00.000Z"),
  item("a", "3", "2026-01-01T06:00:00.000Z"),
];
const sourceB = [
  item("b", "1", "2026-01-01T09:00:00.000Z"),
  item("b", "2", "2026-01-01T07:00:00.000Z"),
  item("b", "3", "2026-01-01T05:00:00.000Z"),
];

const first = mergeInboxPage([], [...sourceA, ...sourceB], 3);
const second = mergeInboxPage(first.remainder, [], 3);
const ids = [...first.page, ...second.page].map(row => row.id);
const expected = ["a::1", "b::1", "a::2", "b::2", "a::3", "b::3"];
if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Error(`mixed-source gap/order regression: ${ids.join(",")}`);
if (new Set(ids).size !== ids.length) throw new Error("mixed-source duplicate regression");
if (second.remainder.length !== 0) throw new Error("mixed-source remainder was not drained");

const tied = mergeInboxPage([], [
  item("b", "2", "2026-01-01T10:00:00.000Z"),
  item("a", "2", "2026-01-01T10:00:00.000Z"),
  item("a", "1", "2026-01-01T10:00:00.000Z"),
], 3);
if (tied.page.map(row => row.id).join(",") !== "a::1,a::2,b::2") throw new Error("deterministic tie-break regression");

console.log("Task 1721 mixed-source pagination regression passed");