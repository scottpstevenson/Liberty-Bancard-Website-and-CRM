import { db } from "../../db";
import { sdrMerchants, sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { isSerperConfigured } from "../serper";

interface SerperEnrichmentResult {
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  socialProfiles?: Record<string, string>;
}

async function searchSerperForBusiness(
  businessName: string,
  city?: string | null,
  state?: string | null
): Promise<SerperEnrichmentResult | null> {
  if (!isSerperConfigured()) return null;

  const location = [city, state].filter(Boolean).join(", ");
  const query = location ? `${businessName} ${location}` : businessName;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        location: location || "Florida, US",
        gl: "us",
        hl: "en",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const places = data.places || [];

    if (places.length === 0) return null;

    const best = places[0];
    const result: SerperEnrichmentResult = {};

    if (best.website) {
      try {
        const url = new URL(
          best.website.startsWith("http") ? best.website : `https://${best.website}`
        );
        result.website = url.hostname.replace(/^www\./, "");
      } catch {}
    }

    if (best.phoneNumber) {
      const digits = best.phoneNumber.replace(/[^\d]/g, "");
      if (digits.length >= 10) {
        result.phone = digits.slice(-10);
      }
    }

    if (best.rating) result.rating = parseFloat(best.rating);
    if (best.reviewsCount) result.reviewCount = parseInt(best.reviewsCount);
    if (best.address) result.address = best.address;

    return result;
  } catch (err) {
    console.error(`[SerperEnrichment] Error enriching ${businessName}:`, err);
    return null;
  }
}

async function searchSerperForEmail(
  businessName: string,
  domain?: string | null
): Promise<string | null> {
  if (!isSerperConfigured() || !domain) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `"${domain}" email contact`,
        gl: "us",
        hl: "en",
        num: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const snippets = (data.organic || [])
      .map((r: any) => `${r.snippet || ""} ${r.title || ""}`)
      .join(" ");

    const emailMatch = snippets.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    );
    return emailMatch ? emailMatch[0] : null;
  } catch (err) {
    console.error(`[SerperEnrichment] Email search error for ${businessName}:`, err);
    return null;
  }
}

export interface EnrichmentStats {
  totalProcessed: number;
  websitesFound: number;
  phonesFound: number;
  emailsFound: number;
  errors: number;
}

export async function enrichMerchantWithSerper(merchantId: number): Promise<{
  enriched: boolean;
  fields: string[];
}> {
  if (!isSerperConfigured()) {
    return { enriched: false, fields: [] };
  }

  const [merchant] = await db
    .select()
    .from(sdrMerchants)
    .where(eq(sdrMerchants.id, merchantId));

  if (!merchant) {
    return { enriched: false, fields: [] };
  }

  const result = await searchSerperForBusiness(
    merchant.businessName,
    merchant.city,
    merchant.state
  );

  if (!result) {
    return { enriched: false, fields: [] };
  }

  const updates: Record<string, any> = {};
  const fieldsEnriched: string[] = [];

  if (result.website && !merchant.website) {
    updates.website = result.website;
    updates.domain = result.website;
    fieldsEnriched.push("website");
  }

  if (result.phone && !merchant.mainPhone) {
    updates.mainPhone = result.phone;
    fieldsEnriched.push("phone");
  }

  if (result.address && !merchant.address) {
    updates.address = result.address;
    fieldsEnriched.push("address");
  }

  if (!merchant.mainEmail) {
    const email = await searchSerperForEmail(
      merchant.businessName,
      result.website || merchant.domain
    );
    if (email) {
      updates.mainEmail = email;
      fieldsEnriched.push("email");
    }
  }

  if (fieldsEnriched.length > 0) {
    updates.updatedAt = new Date();
    await db.update(sdrMerchants).set(updates).where(eq(sdrMerchants.id, merchantId));

    const leadStates = await db
      .select()
      .from(sdrLeadState)
      .where(eq(sdrLeadState.merchantId, merchantId));

    for (const ls of leadStates) {
      const leadUpdates: Record<string, any> = { updatedAt: new Date() };
      if (updates.mainEmail && !ls.email) leadUpdates.email = updates.mainEmail;
      if (updates.mainPhone && !ls.phone) leadUpdates.phone = updates.mainPhone;
      if (updates.website && !ls.website) leadUpdates.website = updates.website;
      if (Object.keys(leadUpdates).length > 1) {
        await db.update(sdrLeadState).set(leadUpdates).where(eq(sdrLeadState.id, ls.id));
      }
    }

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "serper_enrichment",
      channel: "system",
      actorType: "system",
      payloadJson: { fieldsEnriched, source: "serper" },
      decisionReason: `Serper enrichment: found ${fieldsEnriched.join(", ")}`,
    });
  }

  return { enriched: fieldsEnriched.length > 0, fields: fieldsEnriched };
}

export async function runSerperEnrichmentBatch(
  limit: number = 50
): Promise<EnrichmentStats> {
  if (!isSerperConfigured()) {
    return { totalProcessed: 0, websitesFound: 0, phonesFound: 0, emailsFound: 0, errors: 0 };
  }

  const stats: EnrichmentStats = {
    totalProcessed: 0,
    websitesFound: 0,
    phonesFound: 0,
    emailsFound: 0,
    errors: 0,
  };

  const merchantsToEnrich = await db
    .select()
    .from(sdrMerchants)
    .where(
      and(
        sql`(${sdrMerchants.website} IS NULL OR ${sdrMerchants.mainPhone} IS NULL OR ${sdrMerchants.mainEmail} IS NULL)`,
        sql`${sdrMerchants.doNotContactFlag} IS NOT TRUE`
      )
    )
    .limit(limit);

  console.log(`[SerperEnrichment] Batch enriching ${merchantsToEnrich.length} merchants`);

  for (const merchant of merchantsToEnrich) {
    try {
      const result = await enrichMerchantWithSerper(merchant.id);
      stats.totalProcessed++;

      if (result.fields.includes("website")) stats.websitesFound++;
      if (result.fields.includes("phone")) stats.phonesFound++;
      if (result.fields.includes("email")) stats.emailsFound++;

      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      stats.errors++;
      console.error(`[SerperEnrichment] Error enriching merchant ${merchant.id}:`, err);
    }
  }

  console.log(
    `[SerperEnrichment] Batch complete: ${stats.totalProcessed} processed, ${stats.websitesFound} websites, ${stats.phonesFound} phones, ${stats.emailsFound} emails, ${stats.errors} errors`
  );

  return stats;
}

export async function getSerperEnrichmentMetrics(): Promise<{
  totalEnriched: number;
  last7Days: EnrichmentStats;
  serperConfigured: boolean;
}> {
  const serperConfigured = isSerperConfigured();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentEvents = await db
    .select({
      count: sql<number>`count(*)`,
      websiteCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%website%' then 1 end)`,
      phoneCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%phone%' then 1 end)`,
      emailCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%email%' then 1 end)`,
    })
    .from(sdrLeadEvents)
    .where(
      and(
        eq(sdrLeadEvents.eventType, "serper_enrichment"),
        sql`${sdrLeadEvents.createdAt} >= ${sevenDaysAgo}`
      )
    );

  const totalEvents = await db
    .select({ count: sql<number>`count(*)` })
    .from(sdrLeadEvents)
    .where(eq(sdrLeadEvents.eventType, "serper_enrichment"));

  const r = recentEvents[0] || { count: 0, websiteCount: 0, phoneCount: 0, emailCount: 0 };

  return {
    totalEnriched: Number(totalEvents[0]?.count || 0),
    last7Days: {
      totalProcessed: Number(r.count),
      websitesFound: Number(r.websiteCount),
      phonesFound: Number(r.phoneCount),
      emailsFound: Number(r.emailCount),
      errors: 0,
    },
    serperConfigured,
  };
}
