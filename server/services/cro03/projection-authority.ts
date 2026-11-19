import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db } from "../../db";

/** Server-only, execution-local ownership. A request body or copied hook policy
 * cannot grant an exemption to a legacy writer. All other active items fence it. */
const scope = new AsyncLocalStorage<Readonly<{ itemId: string; sourceType: string; sourceKey: string }>>();
export function currentCro03bProjectionOwner() { return scope.getStore(); }
export async function withCro03bProjectionOwner<T>(itemId: string, reviewerId: string, project: () => Promise<T>): Promise<T> {
  const item = (await db.execute(sql`
    SELECT i.id,h.source_type,h.source_key FROM cro03b_recipe_items i
      JOIN cro03a_handoffs h ON h.id=i.handoff_id
      JOIN users reviewer ON reviewer.id=${reviewerId} AND reviewer.role='admin'
    WHERE i.id=${itemId}::uuid AND i.state='review_required'
  `)).rows[0] as any;
  if (!item) throw new Error("CRO03B_PROJECTION_OWNER_UNAVAILABLE");
  return scope.run(Object.freeze({itemId:String(item.id),sourceType:String(item.source_type),sourceKey:String(item.source_key)}),project);
}
