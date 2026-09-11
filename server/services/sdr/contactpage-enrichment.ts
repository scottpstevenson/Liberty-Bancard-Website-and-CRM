import { db } from "../../db";
import { sdrMerchants, sdrMerchantContacts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { isSafeFetchTarget } from "./url-safety";

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const NON_OWNER_PREFIXES = ["noreply", "no-reply", "info", "support", "help", "admin", "contact",
  "hello", "hi", "sales", "team", "service", "donotreply", "notifications", "billing",
  "newsletter", "marketing", "webmaster", "postmaster"];

function isOwnerLikeEmail(email: string): boolean {
  const local = email.split("@")[0].toLowerCase();
  return !NON_OWNER_PREFIXES.some(p => local === p || local.startsWith(p + ".") || local.startsWith(p + "+"));
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const mailtoMatches = html.matchAll(/href=["']mailto:([^"'?\s]+)/gi);
  for (const m of mailtoMatches) {
    const email = m[1].trim().toLowerCase();
    if (email.includes("@") && isOwnerLikeEmail(email)) found.add(email);
  }
  const regexMatches = html.matchAll(EMAIL_REGEX);
  for (const m of regexMatches) {
    const email = m[0].toLowerCase();
    if (isOwnerLikeEmail(email)) found.add(email);
  }
  return Array.from(found);
}

async function fetchPageHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

const CONTACT_PATHS = ["/contact", "/about", "/team", "/staff", "/contact-us", "/about-us"];
const RATE_LIMIT_MS = 500;

async function findEmailOnSite(baseUrl: string): Promise<string | null> {
  let base = baseUrl;
  if (!base.startsWith("http")) base = `https://${base}`;
  base = base.replace(/\/$/, "");

  for (const path of CONTACT_PATHS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    const html = await fetchPageHtml(`${base}${path}`);
    if (!html) continue;
    const emails = extractEmailsFromHtml(html);
    if (emails.length > 0) return emails[0];
  }

  const homeHtml = await fetchPageHtml(base);
  if (homeHtml) {
    const emails = extractEmailsFromHtml(homeHtml);
    if (emails.length > 0) return emails[0];
  }

  return null;
}

export async function runContactPageEnrichment(merchantId: number): Promise<{ enriched: boolean; source: "contactpage" }> {
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.website && !merchant?.domain) return { enriched: false, source: "contactpage" };

  const siteUrl = merchant.website || merchant.domain!;
  const normalizedUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
  const safe = await isSafeFetchTarget(normalizedUrl);
  if (!safe) {
    console.warn(`[ContactPage] Blocked unsafe URL for merchant ${merchantId}: ${siteUrl}`);
    return { enriched: false, source: "contactpage" };
  }
  const email = await findEmailOnSite(siteUrl);
  if (!email) return { enriched: false, source: "contactpage" };

  await db.insert(sdrMerchantContacts).values({
    merchantId,
    contactName: null,
    email,
    roleGuess: "owner",
    emailConfidence: 70,
    primaryContactFlag: false,
  } as any);

  return { enriched: true, source: "contactpage" };
}

export async function runContactPageEnrichmentBatch(limit = 50): Promise<{ processed: number; enriched: number }> {
  const merchants = await db
    .select({ id: sdrMerchants.id })
    .from(sdrMerchants)
    .where(
      and(
        sql`(${sdrMerchants.domain} IS NOT NULL OR ${sdrMerchants.website} IS NOT NULL)`,
        sql`${sdrMerchants.ownerEnrichmentStatus} = 'pending'`,
        sql`${sdrMerchants.doNotContactFlag} IS NOT TRUE`,
        sql`NOT EXISTS (SELECT 1 FROM sdr_merchant_contacts mc WHERE mc.merchant_id = ${sdrMerchants.id} AND mc.email IS NOT NULL)`,
      )
    )
    .limit(limit);

  let processed = 0;
  let enriched = 0;
  for (const m of merchants) {
    try {
      const res = await runContactPageEnrichment(m.id);
      processed++;
      if (res.enriched) enriched++;
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[ContactPage] Error enriching merchant ${m.id}:`, err);
      processed++;
    }
  }
  console.log(`[ContactPage] Batch done: ${processed} processed, ${enriched} enriched`);
  return { processed, enriched };
}

export async function getOwnerEmailCoverage(): Promise<{
  totalMerchants: number;
  merchantsWithEmail: number;
  coveragePct: number;
}> {
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sdrMerchants);
  const [withEmail] = await db
    .select({ count: sql<number>`count(distinct merchant_id)` })
    .from(sdrMerchantContacts)
    .where(sql`email IS NOT NULL`);

  const totalMerchants = Number(total?.count || 0);
  const merchantsWithEmail = Number(withEmail?.count || 0);
  const coveragePct = totalMerchants > 0
    ? Math.round((merchantsWithEmail / totalMerchants) * 100)
    : 0;

  return { totalMerchants, merchantsWithEmail, coveragePct };
}

/**
 * Business-scoped contact-page enrichment — MI-04 free enrichment path.
 *
 * Accepts a businessId + domain. Returns email count evidence only.
 * Never writes sdr_merchant_contacts rows.
 */
export interface ContactPageBusinessResult {
  emailCount: number;
  enriched: boolean;
  /** true when at least one page fetch completed (even with no emails); false if root domain fetch failed */
  fetchCompleted: boolean;
}

export async function runContactPageBusinessEnrichment(
  businessId: number,
  domain: string
): Promise<ContactPageBusinessResult> {
  const { isSafeFetchTarget } = await import("./url-safety");
  const { safeFetch } = await import("./safe-fetch");

  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  const baseUrlObj = (() => {
    try { return new URL(baseUrl); } catch { return null; }
  })();
  if (!baseUrlObj) return { emailCount: 0, enriched: false, fetchCompleted: false };

  // SSRF check on the root domain before attempting any page
  const safe = await isSafeFetchTarget(baseUrl);
  if (!safe) {
    console.warn(`[ContactPage-Business] SSRF blocked domain for business ${businessId}: ${domain}`);
    // SSRF block is a valid skip — not a transient transport failure.
    return { emailCount: 0, enriched: false, fetchCompleted: true };
  }

  const emailSet = new Set<string>();
  const urlsToTry = [
    baseUrl,
    ...CONTACT_PATHS.map(p => baseUrlObj.origin + p),
  ];

  // Track whether the root-domain fetch completed. Sub-pages are best-effort.
  let rootFetchCompleted = false;

  for (const url of urlsToTry) {
    try {
      // Use safeFetch: enforces redirect validation + size cap + SSRF re-check per redirect
      const resp = await safeFetch(url, { timeoutMs: 10000 });
      if (url === baseUrl) {
        // null = transport failure (timeout/DNS/SSRF block); non-null = fetch completed
        rootFetchCompleted = resp !== null;
      }
      if (resp?.ok) {
        // body is eagerly read by safeFetch — no separate async read needed
        const html = resp.body ?? "";
        const emails = extractEmailsFromHtml(html);
        for (const e of emails) emailSet.add(e);
        if (emailSet.size > 0 && url !== baseUrl) break; // found on a contact page
      }
      if (url !== baseUrl) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }
    } catch {
      // non-fatal: proceed to next page
    }
  }

  const emailCount = emailSet.size;
  console.log(`[ContactPage-Business] Business ${businessId}: emailCount=${emailCount}, rootFetchCompleted=${rootFetchCompleted}`);
  return { emailCount, enriched: emailCount > 0, fetchCompleted: rootFetchCompleted };
}
