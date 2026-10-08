import type { Express } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { isDashboardUser } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { parseInboxSourceIdentity } from "../storage/inbox";
import { canAccessOwner } from "../services/crm-object-access";

const contextSchema = z.object({
  contextType: z.enum(["global", "contact", "prospect", "inbox"]),
  contextId: z.string().min(1).max(240),
  channel: z.enum(["email", "sms", "ghl_chat", "voicemail", "site"]).default("email"),
}).strict().superRefine((v, ctx) => {
  if (v.contextType === "global" && v.contextId !== "unaddressed"
    || ["contact", "prospect"].includes(v.contextType) && !/^[1-9]\d*$/.test(v.contextId)
    || v.contextType === "inbox" && (
      !v.contextId.includes("::") ||
      !/^[a-zA-Z0-9_.:%-]+$/.test(parseInboxSourceIdentity(v.contextId).sourceNamespace) ||
      !parseInboxSourceIdentity(v.contextId).sourceItemId
    )) {
    ctx.addIssue({ code: "custom", message: "Explicit, namespaced draft context required" });
  }
  if (["contact", "prospect"].includes(v.contextType) && !Number.isSafeInteger(Number(v.contextId))) {
    ctx.addIssue({ code: "custom", message: "Invalid context id" });
  }
});
const saveSchema = z.object({
  context: contextSchema,
  subject: z.string().max(500),
  body: z.string().max(50000),
  expectedVersion: z.number().int().min(0),
  commandId: z.string().uuid(),
}).strict();
type Context = z.infer<typeof contextSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class DraftDenied extends Error {}
class DraftConflict extends Error {}

/** Authorization is rechecked under the same row locks as the read/write.
 * No recipient, provider or display-name mapping is accepted from the browser. */
async function authorizeContext(tx: Tx, user: any, context: Context) {
  const actor = (await tx.execute(sql`SELECT id,role,email FROM users WHERE id=${String(user.id)} FOR SHARE`)).rows[0] as any;
  if (!actor || !["admin", "manager", "agent"].includes(actor.role)) throw new DraftDenied();
  if (context.contextType === "global") return;
  if (context.contextType === "prospect") {
    if (!["admin", "manager"].includes(actor.role)) throw new DraftDenied();
    if (!(await tx.execute(sql`SELECT id FROM prospects WHERE id=${Number(context.contextId)} FOR SHARE`)).rows.length) throw new DraftDenied();
    return;
  }
  let contactId: number;
  if (context.contextType === "inbox") {
    const identity = parseInboxSourceIdentity(context.contextId);
    const item = (await tx.execute(sql`SELECT contact_id, source_item_type FROM inbox_items
      WHERE source_namespace=${identity.sourceNamespace} AND source_item_id=${identity.sourceItemId}
      FOR SHARE`)).rows[0] as any;
    if (!item?.contact_id || item.source_item_type !== context.channel) throw new DraftDenied();
    contactId = Number(item.contact_id);
  } else contactId = Number(context.contextId);
  const contact = (await tx.execute(sql`SELECT id,assigned_to,archived_at FROM contacts WHERE id=${contactId} FOR SHARE`)).rows[0] as any;
  if (!contact || contact.archived_at || !canAccessOwner(actor, contact.assigned_to, true)) throw new DraftDenied();
}
function view(row: any) {
  return { id: row.id, contextType: row.context_type, contextId: row.context_id,
    channel: row.channel, subject: row.subject, body: row.body, version: row.version,
    savedAt: row.saved_at, delivered: false };
}
export function registerMessageDraftRoutes(app: Express) {
  app.get("/api/message-drafts", isDashboardUser, async (req, res) => {
    try {
      const context = contextSchema.parse(req.query);
      const draft = await db.transaction(async tx => {
        await authorizeContext(tx, req.user, context);
        const row = (await tx.execute(sql`SELECT * FROM rep_message_drafts
          WHERE actor_id=${String((req.user as any).id)} AND context_type=${context.contextType}
          AND context_id=${context.contextId} AND channel=${context.channel}`)).rows[0];
        return row ? view(row) : null;
      });
      res.json({ draft });
    } catch (err) { respond(err, res); }
  });
  app.put("/api/message-drafts", isDashboardUser, async (req, res) => {
    try {
      const input = saveSchema.parse(req.body);
      const actorId = String((req.user as any).id);
      const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const draft = await db.transaction(async tx => {
        await authorizeContext(tx, req.user, input.context);
        // Actor-local lock serializes first creation and command replays.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`rep-draft:${actorId}`}))`);
        const replay = (await tx.execute(sql`SELECT payload_hash,result FROM rep_message_draft_commands
          WHERE actor_id=${actorId} AND command_id=${input.commandId}::uuid`)).rows[0] as any;
        if (replay) {
          if (replay.payload_hash !== hash) throw new DraftConflict("Draft retry payload changed; use a new command");
          return replay.result;
        }
        const c = input.context;
        const current = (await tx.execute(sql`SELECT * FROM rep_message_drafts
          WHERE actor_id=${actorId} AND context_type=${c.contextType} AND context_id=${c.contextId}
          AND channel=${c.channel} FOR UPDATE`)).rows[0] as any;
        if ((current?.version ?? 0) !== input.expectedVersion) throw new DraftConflict("Draft changed in another editor. Copy your text, reopen the saved draft and retry.");
        const row = current
          ? (await tx.execute(sql`UPDATE rep_message_drafts SET subject=${input.subject},body=${input.body},
              version=version+1,saved_at=NOW() WHERE id=${current.id}::uuid RETURNING *`)).rows[0]
          : (await tx.execute(sql`INSERT INTO rep_message_drafts(actor_id,context_type,context_id,channel,subject,body)
              VALUES(${actorId},${c.contextType},${c.contextId},${c.channel},${input.subject},${input.body}) RETURNING *`)).rows[0];
        const result = view(row);
        await tx.execute(sql`INSERT INTO rep_message_draft_commands(actor_id,command_id,payload_hash,result)
          VALUES(${actorId},${input.commandId}::uuid,${hash},${JSON.stringify(result)}::jsonb)`);
        return result;
      });
      res.json({ draft });
    } catch (err) { respond(err, res); }
  });
}
function respond(err: unknown, res: any) {
  if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
  if (err instanceof DraftDenied) return res.status(404).json({ message: "Draft context unavailable" });
  if (err instanceof DraftConflict) return res.status(409).json({ message: err.message });
  serverError(res, err);
}
