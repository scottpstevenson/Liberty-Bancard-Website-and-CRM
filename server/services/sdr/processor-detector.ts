import { db } from "../../db";
import { processorSignals, businesses } from "@shared/schema";
import type { InsertProcessorSignal } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { isSerperConfigured, searchBusiness } from "../serper";

interface ProcessorFingerprint {
  vendor: string;
  signalType: "processor" | "pos" | "booking_platform" | "ecommerce_platform";
  patterns: {
    scripts: RegExp[];
    htmlText: RegExp[];
    metaTags: RegExp[];
  };
  confidence: number;
}

const PROCESSOR_FINGERPRINTS: ProcessorFingerprint[] = [
  {
    vendor: "Square",
    signalType: "processor",
    patterns: {
      scripts: [/squareup\.com/i, /square\.site/i, /squarecdn\.com/i],
      htmlText: [/sq-payment-form/i, /square\s+checkout/i, /powered\s+by\s+square/i, /squareup/i],
      metaTags: [/squareup/i, /square\.site/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Stripe",
    signalType: "processor",
    patterns: {
      scripts: [/js\.stripe\.com/i, /stripe-js/i, /stripe\.js/i],
      htmlText: [/stripe[_-]?elements/i, /stripe[_-]?checkout/i, /powered\s+by\s+stripe/i],
      metaTags: [/stripe/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Toast",
    signalType: "pos",
    patterns: {
      scripts: [/toasttab\.com/i, /toast\.restaurants/i],
      htmlText: [/toast\s+online\s+ordering/i, /order\s+on\s+toast/i, /toasttab/i, /powered\s+by\s+toast/i],
      metaTags: [/toasttab/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Clover",
    signalType: "pos",
    patterns: {
      scripts: [/clover\.com/i, /clover-sdk/i],
      htmlText: [/clover\s+checkout/i, /powered\s+by\s+clover/i, /clover\s+online\s+ordering/i],
      metaTags: [/clover\.com/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Shopify",
    signalType: "ecommerce_platform",
    patterns: {
      scripts: [/cdn\.shopify\.com/i, /shopify\.com\/s/i],
      htmlText: [/shopify[_-]?checkout/i, /powered\s+by\s+shopify/i, /shopify-section/i, /Shopify\.theme/i],
      metaTags: [/shopify/i],
    },
    confidence: 0.90,
  },
  {
    vendor: "PayPal",
    signalType: "processor",
    patterns: {
      scripts: [/paypal\.com\/sdk/i, /paypalobjects\.com/i],
      htmlText: [/paypal[_-]?button/i, /pay\s+with\s+paypal/i, /paypal[_-]?checkout/i],
      metaTags: [/paypal/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "Mindbody",
    signalType: "booking_platform",
    patterns: {
      scripts: [/mindbodyonline\.com/i, /healcode\.com/i],
      htmlText: [/mindbody/i, /healcode/i, /book\s+via\s+mindbody/i, /powered\s+by\s+mindbody/i],
      metaTags: [/mindbody/i, /healcode/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Vagaro",
    signalType: "booking_platform",
    patterns: {
      scripts: [/vagaro\.com/i],
      htmlText: [/vagaro/i, /book\s+on\s+vagaro/i, /powered\s+by\s+vagaro/i],
      metaTags: [/vagaro/i],
    },
    confidence: 0.85,
  },
  {
    vendor: "Boulevard",
    signalType: "booking_platform",
    patterns: {
      scripts: [/joinblvd\.com/i, /boulevard\.io/i],
      htmlText: [/boulevard/i, /joinblvd/i, /book\s+with\s+boulevard/i],
      metaTags: [/joinblvd/i, /boulevard/i],
    },
    confidence: 0.80,
  },
  {
    vendor: "NCR",
    signalType: "pos",
    patterns: {
      scripts: [/ncr\.com/i, /aloha/i],
      htmlText: [/ncr\s+silver/i, /ncr\s+aloha/i, /powered\s+by\s+ncr/i],
      metaTags: [/ncr/i],
    },
    confidence: 0.75,
  },
];

interface DetectionResult {
  vendor: string;
  signalType: string;
  detectionMethod: string;
  confidence: number;
  evidence: string;
}

async function fetchWebsiteHtml(url: string): Promise<string | null> {
  try {
    const cleanUrl = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://${cleanUrl}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const html = await response.text();
    return html.slice(0, 100000);
  } catch {
    return null;
  }
}

function detectFromHtml(html: string): DetectionResult[] {
  const results: DetectionResult[] = [];

  const scriptTags = html.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi) || [];
  const scriptSrcs = scriptTags.map(tag => {
    const match = tag.match(/src=["']([^"']+)["']/i);
    return match ? match[1] : "";
  }).filter(Boolean);

  const metaTags = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*>/gi) || [];
  const metaContents = metaTags.map(tag => {
    const match = tag.match(/content=["']([^"']+)["']/i);
    return match ? match[1] : "";
  }).filter(Boolean);

  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 20000);

  for (const fingerprint of PROCESSOR_FINGERPRINTS) {
    let detected = false;
    let method = "html_text";
    let evidence = "";

    for (const src of scriptSrcs) {
      for (const pattern of fingerprint.patterns.scripts) {
        if (pattern.test(src)) {
          detected = true;
          method = "script";
          evidence = `Script source: ${src.slice(0, 200)}`;
          break;
        }
      }
      if (detected) break;
    }

    if (!detected) {
      for (const pattern of fingerprint.patterns.htmlText) {
        const match = html.match(pattern);
        if (match) {
          detected = true;
          method = "html_text";
          const idx = html.indexOf(match[0]);
          evidence = `HTML match: ...${html.slice(Math.max(0, idx - 30), idx + match[0].length + 30).replace(/<[^>]+>/g, "").trim()}...`;
          break;
        }
      }
    }

    if (!detected) {
      for (const content of metaContents) {
        for (const pattern of fingerprint.patterns.metaTags) {
          if (pattern.test(content)) {
            detected = true;
            method = "html_text";
            evidence = `Meta tag content: ${content.slice(0, 200)}`;
            break;
          }
        }
        if (detected) break;
      }
    }

    if (detected) {
      results.push({
        vendor: fingerprint.vendor,
        signalType: fingerprint.signalType,
        detectionMethod: method,
        confidence: fingerprint.confidence,
        evidence,
      });
    }
  }

  return results;
}

async function detectFromSerper(businessName: string, city?: string, state?: string): Promise<DetectionResult[]> {
  if (!isSerperConfigured()) return [];

  const results: DetectionResult[] = [];

  try {
    const searchResult = await searchBusiness(`${businessName} payment processing`, city, state || undefined);

    const allText = [
      searchResult.website || "",
      ...searchResult.organicUrls,
      ...searchResult.sources,
    ].join(" ").toLowerCase();

    const vendorChecks: Array<{ vendor: string; signalType: string; patterns: RegExp[] }> = [
      { vendor: "Square", signalType: "processor", patterns: [/square\s+point\s+of\s+sale/i, /squareup/i, /uses?\s+square/i] },
      { vendor: "Stripe", signalType: "processor", patterns: [/stripe\s+payments/i, /uses?\s+stripe/i] },
      { vendor: "Toast", signalType: "pos", patterns: [/toast\s+pos/i, /toasttab/i, /uses?\s+toast/i, /order\s+on\s+toast/i] },
      { vendor: "Clover", signalType: "pos", patterns: [/clover\s+pos/i, /uses?\s+clover/i] },
      { vendor: "Shopify", signalType: "ecommerce_platform", patterns: [/shopify\s+store/i, /powered\s+by\s+shopify/i] },
      { vendor: "PayPal", signalType: "processor", patterns: [/paypal\s+checkout/i, /accepts?\s+paypal/i] },
      { vendor: "Mindbody", signalType: "booking_platform", patterns: [/mindbody/i, /book\s+on\s+mindbody/i] },
      { vendor: "Vagaro", signalType: "booking_platform", patterns: [/vagaro/i, /book\s+on\s+vagaro/i] },
      { vendor: "Boulevard", signalType: "booking_platform", patterns: [/boulevard/i, /joinblvd/i] },
      { vendor: "NCR", signalType: "pos", patterns: [/ncr\s+aloha/i, /ncr\s+silver/i] },
    ];

    for (const check of vendorChecks) {
      for (const pattern of check.patterns) {
        if (pattern.test(allText)) {
          results.push({
            vendor: check.vendor,
            signalType: check.signalType,
            detectionMethod: "serper",
            confidence: 0.60,
            evidence: `Search result mention: ${allText.slice(0, 200)}`,
          });
          break;
        }
      }
    }
  } catch (err) {
    console.error("[ProcessorDetector] Serper detection failed:", err);
  }

  return results;
}

export async function detectProcessors(businessId: number): Promise<DetectionResult[]> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) {
    console.log(`[ProcessorDetector] Business ${businessId} not found`);
    return [];
  }

  let allResults: DetectionResult[] = [];

  if (business.websiteDomain) {
    const html = await fetchWebsiteHtml(business.websiteDomain);
    if (html) {
      const htmlResults = detectFromHtml(html);
      allResults.push(...htmlResults);
    }
  }

  if (allResults.length === 0) {
    const serperResults = await detectFromSerper(
      business.canonicalName,
      business.city || undefined,
      business.state || undefined,
    );
    allResults.push(...serperResults);
  }

  const uniqueResults = new Map<string, DetectionResult>();
  for (const result of allResults) {
    const existing = uniqueResults.get(result.vendor);
    if (!existing || result.confidence > existing.confidence) {
      uniqueResults.set(result.vendor, result);
    }
  }

  const finalResults = Array.from(uniqueResults.values());

  for (const result of finalResults) {
    try {
      const existing = await db.select()
        .from(processorSignals)
        .where(and(
          eq(processorSignals.businessId, businessId),
          eq(processorSignals.vendorName, result.vendor),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(processorSignals)
          .set({
            confidenceScore: result.confidence,
            detectionMethod: result.detectionMethod,
            evidence: result.evidence,
            detectedAt: new Date(),
          })
          .where(eq(processorSignals.id, existing[0].id));
      } else {
        const signal: InsertProcessorSignal = {
          businessId,
          signalType: result.signalType,
          vendorName: result.vendor,
          detectionMethod: result.detectionMethod,
          confidenceScore: result.confidence,
          evidence: result.evidence,
          detectedAt: new Date(),
        };
        await db.insert(processorSignals).values(signal);
      }
    } catch (err) {
      console.error(`[ProcessorDetector] Failed to store signal for ${result.vendor}:`, err);
    }
  }

  console.log(`[ProcessorDetector] Detected ${finalResults.length} processors for business ${businessId}: ${finalResults.map(r => r.vendor).join(", ")}`);
  return finalResults;
}

export async function getProcessorSignals(businessId: number) {
  return db.select()
    .from(processorSignals)
    .where(eq(processorSignals.businessId, businessId));
}

export async function getProcessorDistribution() {
  const signals = await db.select({
    vendorName: processorSignals.vendorName,
    signalType: processorSignals.signalType,
  }).from(processorSignals);

  const distribution: Record<string, number> = {};
  for (const signal of signals) {
    distribution[signal.vendorName] = (distribution[signal.vendorName] || 0) + 1;
  }

  return Object.entries(distribution)
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getConversionByProcessor() {
  const { sdrLeadState } = await import("@shared/schema");

  const signals = await db.select({
    vendorName: processorSignals.vendorName,
    businessId: processorSignals.businessId,
  }).from(processorSignals);

  const vendorBusinessIds = new Map<string, Set<number>>();
  for (const s of signals) {
    if (!vendorBusinessIds.has(s.vendorName)) vendorBusinessIds.set(s.vendorName, new Set());
    vendorBusinessIds.get(s.vendorName)!.add(s.businessId);
  }

  const allBizIds = new Set<number>();
  for (const ids of vendorBusinessIds.values()) {
    for (const id of ids) allBizIds.add(id);
  }

  if (allBizIds.size === 0) return [];

  const allBizIdArray = Array.from(allBizIds);
  const leads = await db.select({
    businessId: sdrLeadState.businessId,
    stage: sdrLeadState.stage,
  }).from(sdrLeadState).where(
    sql`${sdrLeadState.businessId} IN (${sql.join(allBizIdArray.map(id => sql`${id}`), sql`, `)})`
  );

  const leadsByBizId = new Map<number, string[]>();
  for (const l of leads) {
    if (l.businessId == null) continue;
    if (!leadsByBizId.has(l.businessId)) leadsByBizId.set(l.businessId, []);
    leadsByBizId.get(l.businessId)!.push(l.stage || "DISCOVERED");
  }

  const convertedStages = new Set(["CLOSED_WON", "MEETING_SET", "PROPOSAL_SENT", "STATEMENT_RECEIVED"]);
  const results: Array<{ vendor: string; total: number; converted: number; conversionRate: number }> = [];

  for (const [vendor, bizIdSet] of vendorBusinessIds) {
    let total = 0;
    let converted = 0;

    for (const bizId of bizIdSet) {
      const stages = leadsByBizId.get(bizId) || [];
      total += stages.length;
      converted += stages.filter(s => convertedStages.has(s)).length;
    }

    results.push({
      vendor,
      total,
      converted,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
    });
  }

  return results.sort((a, b) => b.conversionRate - a.conversionRate);
}

export async function getProcessorCoverage() {
  const totalBusinesses = await db.select({ count: businesses.id }).from(businesses);
  const businessesWithSignals = await db.selectDistinct({ businessId: processorSignals.businessId }).from(processorSignals);
  const total = totalBusinesses.length;
  const detected = businessesWithSignals.length;

  return {
    total,
    detected,
    coverageRate: total > 0 ? Math.round((detected / total) * 100) : 0,
  };
}

export const PROCESSOR_TEMPLATES: Record<string, { subject: string; body: string }> = {
  Square: {
    subject: "A custom setup can often beat Square's flat-rate pricing for {{company_name}}",
    body: "Hi {{first_name}},\n\nI noticed {{company_name}} is using Square for payment processing. While Square is great for getting started, many {{vertical}} businesses in {{city}} find that a custom processing setup significantly reduces their costs once they're doing consistent volume.\n\nSquare's flat 2.6% + 10¢ adds up fast. We typically help businesses like yours get rates well below that, especially for {{service_type}} transactions.\n\nWould you be open to a quick, no-obligation comparison?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
  Stripe: {
    subject: "Are you getting the best Stripe rates at {{company_name}}?",
    body: "Hi {{first_name}},\n\nI see {{company_name}} uses Stripe for processing. Stripe's standard 2.9% + 30¢ works well for online businesses, but many {{vertical}} businesses find they can do better with a customized solution — especially for in-person or high-ticket {{service_type}} transactions.\n\nWe've helped businesses switch from Stripe and save significantly each month. Want to see what your numbers look like?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
  Toast: {
    subject: "Quick question about your Toast setup at {{company_name}}",
    body: "Hi {{first_name}},\n\nI noticed {{company_name}} is on Toast for POS and payment processing. While Toast has great restaurant features, many owners don't realize they may be overpaying on the processing side.\n\nWe work with restaurants like yours to optimize payment costs while keeping the technology you love. A quick statement review can show you exactly where you stand.\n\nInterested in seeing the numbers?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
  Clover: {
    subject: "Getting the most from your Clover at {{company_name}}?",
    body: "Hi {{first_name}},\n\nI see {{company_name}} uses Clover. Great POS system! But many business owners don't realize that the processing rates bundled with Clover aren't always the most competitive.\n\nWe can often set you up with better rates while keeping your Clover hardware. Want to see a comparison?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
  PayPal: {
    subject: "An alternative to PayPal fees for {{company_name}}",
    body: "Hi {{first_name}},\n\nI noticed {{company_name}} accepts PayPal for payments. PayPal's fees can be steep — especially for {{service_type}} businesses doing consistent volume.\n\nA dedicated merchant account typically offers lower rates and faster funding. We'd love to show you how much you could save.\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
  Shopify: {
    subject: "Reducing Shopify Payments fees for {{company_name}}",
    body: "Hi {{first_name}},\n\nI see {{company_name}} is on Shopify. Shopify Payments charges 2.4-2.9% depending on your plan — and that doesn't even count the additional fees for third-party payment providers.\n\nMany Shopify merchants we work with have found significant savings by switching their payment processing while keeping their Shopify store. Want to explore the options?\n\nBest,\nLiberty Bancard Team\n\nEligibility, underwriting, card brand rules, and applicable laws apply.",
  },
};

export function getProcessorTemplate(vendorName: string): { subject: string; body: string } | null {
  return PROCESSOR_TEMPLATES[vendorName] || null;
}
