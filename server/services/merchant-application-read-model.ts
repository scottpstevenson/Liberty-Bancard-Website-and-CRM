/**
 * S5-03 — bounded, SQL-filtered operator read model for merchant applications.
 * The list and the pending count are computed in the database; nothing loads the whole table to filter in JS.
 */
import { and, desc, eq, inArray, or, ilike, sql, count, notInArray } from "drizzle-orm";
import { db } from "../db";
import { contacts, merchantApplications } from "@shared/schema";

export const APPLICATION_PAGE_MAX = 100;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Authoritative non-production classes. `unknown` is unreviewed, not test: it stays visible and is labelled. */
export const NON_PRODUCTION_CLASSES = ["test", "demo", "synthetic"] as const;
export type ApplicationRecordScope = "production" | "all";

/** Production scope hides only applications whose linked contact is authoritatively test/demo/synthetic. */
const productionScope = () => or(sql`${merchantApplications.contactId} IS NULL`, sql`${contacts.recordClass} IS NULL`,
  notInArray(contacts.recordClass, [...NON_PRODUCTION_CLASSES]));

export async function listMerchantApplicationsPage(opts: {
  statuses?: string[]; search?: string; limit?: number; offset?: number; recordScope?: ApplicationRecordScope;
}) {
  const limit = Math.min(Math.max(Number.isFinite(opts.limit) ? Math.trunc(opts.limit as number) : 50, 1), APPLICATION_PAGE_MAX);
  const offset = Math.max(Number.isFinite(opts.offset) ? Math.trunc(opts.offset as number) : 0, 0);
  const recordScope: ApplicationRecordScope = opts.recordScope === "all" ? "all" : "production";
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
  const unscoped = conds.length ? and(...conds) : undefined;
  const where = recordScope === "production" ? and(...conds, productionScope()) : unscoped;
  const base = () => db.select({ n: count() }).from(merchantApplications)
    .leftJoin(contacts, eq(contacts.id, merchantApplications.contactId));
  const [{ n }] = await base().where(where);
  // The hidden count uses the same filters, so the operator can see exactly how many rows the class rule removed.
  const [{ n: all }] = recordScope === "production" ? await base().where(unscoped) : [{ n }];
  const found = await db.select({ app: merchantApplications, contactRecordClass: contacts.recordClass })
    .from(merchantApplications).leftJoin(contacts, eq(contacts.id, merchantApplications.contactId)).where(where)
    .orderBy(desc(merchantApplications.createdAt), desc(merchantApplications.id)).limit(limit).offset(offset);
  const rows = found.map(r => ({ ...r.app, contactRecordClass: r.contactRecordClass ?? null }));
  return { rows, total: Number(n), hiddenByRecordClass: Math.max(Number(all) - Number(n), 0), recordScope, limit, offset };
}

export async function countPendingMerchantApplications(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(merchantApplications)
    .leftJoin(contacts, eq(contacts.id, merchantApplications.contactId))
    .where(and(inArray(merchantApplications.status, ["submitted", "under_review"]), productionScope()));
  return Number(n);
}
