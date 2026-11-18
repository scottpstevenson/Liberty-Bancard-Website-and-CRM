import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

// Real sessions, CSRF and object authorization; private PostgreSQL/Redis and denied provider I/O.
const h = await stage3BHttpFixture(async app => {
  const { registerStatementReviewRoutes } = await import("../../server/routes/statement-review");
  const { registerLiveChatRoutes } = await import("../../server/routes/live-chat");
  const { registerAdminRoutes } = await import("../../server/routes/admin");
  registerStatementReviewRoutes(app);
  registerLiveChatRoutes(app);
  registerAdminRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
async function check(role: string, method: string, path: string, body: unknown, status: number) {
  const response = await h.request(role, method, path, body);
  assert.equal(response.status, status, `${role} ${method} ${path}: ${JSON.stringify(response.body)}`);
  checks++;
  return response.body;
}
try {
  const contact = (await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Private','Typecheck',$1,'',$2,'production') RETURNING id`,
  [`${randomUUID()}@example.test`, h.email("agent")])).rows[0];
  const document = (await h.pool.query(`INSERT INTO documents(contact_id,type,file_name,category,status)
    VALUES($1,'statement','private-typecheck.txt','Other','pending') RETURNING id`, [contact.id])).rows[0];
  const review = (await h.pool.query(`INSERT INTO statement_reviews(contact_id,document_id,status,version)
    VALUES($1,$2,'received',0) RETURNING id`, [contact.id, document.id])).rows[0];

  for (const [method, suffix, body] of [
    ["GET", "", undefined], ["GET", "/request", undefined],
    ["PATCH", "", { version: 0, analystNotes: "Private missing-review check" }],
    ["POST", "/follow-up-draft", {}],
  ] as const) {
    await check("admin", method, `/api/statement-reviews/2147483647${suffix}`, body, 404);
    await check("other", method, `/api/statement-reviews/${review.id}${suffix}`, body, method === "GET" && suffix === "/request" ? 403 : 404);
  }
  const read = await check("agent", "GET", `/api/statement-reviews/${review.id}`, undefined, 200);
  assert.equal(read.documentId, document.id);
  await check("manager", "GET", `/api/statement-reviews/${review.id}/request`, undefined, 200);
  const saved = await check("admin", "PATCH", `/api/statement-reviews/${review.id}`,
    { version: 0, analystNotes: "Private authorized review" }, 200);
  assert.equal(saved.version, 1);
  await check("admin", "PATCH", `/api/statement-reviews/${review.id}`, { version: 0, analystNotes: "Stale" }, 409);
  const draft = await check("admin", "POST", `/api/statement-reviews/${review.id}/follow-up-draft`, {}, 200);
  assert.equal(draft.review.version, 2);
  assert.equal(typeof draft.draft, "string");
  for (const id of ["bad", "0", "1.2"]) {
    await check("admin", "GET", `/api/statement-reviews/${id}/request`, undefined, 400);
    await check("admin", "GET", `/api/statement-documents/${id}/request`, undefined, 400);
  }
  await check("admin", "GET", `/api/statement-documents/${document.id}/request`, undefined, 200);

  const sessionId = randomUUID();
  await h.pool.query("INSERT INTO live_chats(session_id,visitor_name) VALUES($1,'Private visitor')", [sessionId]);
  const message = await check("anonymous", "POST", `/api/public/chat/session/${sessionId}/message`, { content: "Private local test" }, 200);
  assert.equal(message.content, "Private local test");
  const identified = await check("anonymous", "POST", `/api/public/chat/session/${sessionId}/identify`,
    { name: "Private Visitor", email: `${randomUUID()}@example.test` }, 200);
  assert.ok(identified);
  await check("anonymous", "POST", `/api/public/chat/session/${randomUUID()}/message`, { content: "Missing" }, 404);
  await check("anonymous", "POST", `/api/public/chat/session/${randomUUID()}/identify`,
    { name: "Private Visitor", email: "private@example.test" }, 404);

  await check("admin", "GET", "/api/admin/data-health/reconcile/operations/bad", undefined, 400);
  await check("admin", "GET", `/api/admin/data-health/reconcile/operations/${randomUUID()}`, undefined, 404);
  for (const role of ["manager", "agent", "merchant", "anonymous"]) {
    await check(role, "GET", `/api/admin/data-health/reconcile/operations/${randomUUID()}`, undefined, role === "anonymous" ? 401 : 403);
  }
  assert.equal(h.externalCalls(), 0, "Review drafts, chat intake and receipt reads must have no provider effects");
  console.log(`TYPESCRIPT_ROUTE_BOUNDARIES_PASS (${checks} real HTTP checks; provider effects=0)`);
} finally {
  await h.close();
}
