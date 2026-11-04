/**
 * S5-03 — bounded, SQL-filtered operator read model for merchant applications.
 * The list and the pending count are computed in the database; nothing loads the whole table to filter in JS.
 */
import { and, desc, inArray, or, ilike, sql, count } from "drizzle-orm";
import { db } from "../db";
import { merchantApplications } from "@shared/schema";

export const APPLICATION_PAGE_MAX = 100;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listMerchantApplicationsPage(opts: {
  statuses?: string[]; search?: string; limit?: number; offset?: number;
}) {
  const limit = Math.min(Math.max(Number.isFinite(opts.limit) ? Math.trunc(opts.limit as number) : 50, 1), APPLICATION_PAGE_MAX);
  const offset = Math.max(Number.isFinite(opts.offset) ? Math.trunc(opts.offset as number) : 0, 0);
  const conds: any[] = [];
  if (opts.statuses && opts.statuses.length) conds.push(inArray(merchantApplications.status, opts.statuses));
  const term = (opts.search ?? "").trim().slice(0, 200);
  if (term) {
    const pat = `%${escapeLike(term)}%`;
    conds.push(or(
      ilike(merchantApplications.legalBusinessName, pat), ilike(merchantApplications.dba, pat),
      ilike(merchantApplications.businessEmail, pat), ilike(merchantApplications.ownerEmail, pat),
      ilike(merchantApplications.ownerFirstName, pat), ilike(merchantApplications.ownerLastName, pat),
    ));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = await db.select({ n: count() }).from(merchantApplications).where(where);
  const rows = await db.select().from(merchantApplications).where(where)
    .orderBy(desc(merchantApplications.createdAt), desc(merchantApplications.id)).limit(limit).offset(offset);
  return { rows, total: Number(n), limit, offset };
}

export async function countPendingMerchantApplications(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(merchantApplications)
    .where(inArray(merchantApplications.status, ["submitted", "under_review"]));
  return Number(n);
}
