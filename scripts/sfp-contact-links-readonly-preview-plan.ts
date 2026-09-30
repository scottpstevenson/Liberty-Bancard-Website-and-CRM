/**
 * Compile/replay the real read-only preview against platform-provided SELECT
 * results. This never connects to production, applies DDL, or writes links.
 * A caller executes each pending SELECT through the production read-only tool,
 * supplies its rows, and repeats until the actual service returns its preview.
 */
import fs from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { previewContactBusinessSystemLinks } from "../server/services/contact-business-system-links";
import { pool } from "../server/db";

type QueryReply = { key: string; rows: Record<string, unknown>[] };
const file = process.argv[2];
if (!file || !file.startsWith("/tmp/")) {
  throw new Error("A /tmp/ read-only query transcript is required");
}
const input = JSON.parse(fs.readFileSync(file, "utf8")) as {
  afterContactId: number; limit: number; replies: QueryReply[];
};
if (!Number.isSafeInteger(input.afterContactId) || input.afterContactId < 0
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25) {
  throw new Error("Invalid bounded preview parameters");
}
const dialect = new PgDialect();
let pending: { sql: string; params: unknown[]; key: string } | undefined;
const executor = {
  async execute(query: Parameters<PgDialect["sqlToQuery"]>[0]) {
    const compiled = dialect.sqlToQuery(query);
    if (!/^\s*SELECT\b/i.test(compiled.sql) || compiled.sql.includes(";")) {
      throw new Error("Only a single read-only SELECT can be compiled");
    }
    const key = JSON.stringify([compiled.sql, compiled.params]);
    const answer = input.replies.find(reply => reply.key === key);
    if (answer) return { rows: answer.rows };
    pending = { sql: compiled.sql, params: compiled.params, key };
    throw new Error("READONLY_PREVIEW_QUERY_PENDING");
  },
};
try {
  const preview = await previewContactBusinessSystemLinks(input, executor as any);
  console.log("SFP_READONLY_PLAN=" + JSON.stringify({ preview }));
} catch (error) {
  if (!pending || (error as Error).message !== "READONLY_PREVIEW_QUERY_PENDING") throw error;
  console.log("SFP_READONLY_PLAN=" + JSON.stringify({ pending }));
} finally {
  await pool.end();
}