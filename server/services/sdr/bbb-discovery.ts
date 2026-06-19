import * as cheerio from "cheerio";
import { db } from "../../db";
import { sdrLeadEvents, sdrMerchants } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isChainBusiness } from "./chain-blocklist";

const DELAY_BETWEEN_PAGES_MS = 2000;
const DELAY_BETWEEN_CITIES_MS = 10000;

const VERTICAL_SEARCH_TERMS: Record<string, string> = {
  "auto repair": "auto repair",
  "med spa": "medical spa",
  "dental": "dentist",
  "chiropractic": "chiropractor",
  "restaurant": "restaurant",
  "medical practice": "medical clinic",
  "construction": "general contractor",
  "retail": "jewelry store",
};

const DEFAULT_CITIES_BY_STATE: Record<string, string[]> = {
  AL: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"],
  AK: ["Anchorage", "Fairbanks", "Juneau", "Sitka", "Ketchikan"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Glendale", "Gilbert"],
  AR: ["Little Rock", "Fort Smith", "Fayetteville", "Springdale", "Jonesboro"],
  CA: ["Los Angeles", "San Diego", "San Francisco", "San Jose", "Fresno", "Sacramento", "Oakland", "Long Beach"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Thornton"],
  CT: ["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury"],
  DE: ["Wilmington", "Dover", "Newark", "Middletown", "Smyrna"],
  FL: ["Miami", "Orlando", "Tampa", "Jacksonville", "Fort Lauderdale", "Gainesville", "Tallahassee", "Pensacola"],
  GA: ["Atlanta", "Augusta", "Columbus", "Macon", "Savannah", "Athens", "Sandy Springs"],
  HI: ["Honolulu", "Pearl City", "Hilo", "Kailua", "Waipahu"],
  ID: ["Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello"],
  IL: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Peoria"],
  IN: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel"],
  IA: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City"],
  KS: ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka"],
  KY: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"],
  LA: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"],
  ME: ["Portland", "Lewiston", "Bangor", "South Portland", "Auburn"],
  MD: ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Waldorf"],
  MA: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "New Bedford"],
  MI: ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing"],
  MN: ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington"],
  MS: ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"],
  MO: ["Kansas City", "Saint Louis", "Springfield", "Columbia", "Independence"],
  MT: ["Billings", "Missoula", "Great Falls", "Bozeman", "Butte"],
  NE: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney"],
  NV: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"],
  NH: ["Manchester", "Nashua", "Concord", "Derry", "Dover"],
  NJ: ["Newark", "Jersey City", "Paterson", "Elizabeth", "Trenton", "Camden"],
  NM: ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe", "Roswell"],
  NY: ["New York", "Buffalo", "Rochester", "Syracuse", "Albany", "Yonkers", "Brooklyn"],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville"],
  ND: ["Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"],
  OK: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Lawton"],
  OR: ["Portland", "Salem", "Eugene", "Gresham", "Hillsboro"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton"],
  RI: ["Providence", "Cranston", "Warwick", "Pawtucket", "East Providence"],
  SC: ["Columbia", "Charleston", "North Charleston", "Mount Pleasant", "Greenville"],
  SD: ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"],
  TX: ["Houston", "Dallas", "San Antonio", "Austin", "Fort Worth", "El Paso", "Arlington", "Plano", "Laredo"],
  UT: ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem"],
  VT: ["Burlington", "South Burlington", "Rutland", "Barre", "Montpelier"],
  VA: ["Virginia Beach", "Norfolk", "Chesapeake", "Richmond", "Newport News", "Alexandria"],
  WA: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Everett"],
  WV: ["Charleston", "Huntington", "Parkersburg", "Morgantown", "Wheeling"],
  WI: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine"],
  WY: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs"],
};

export interface BBBBusiness {
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  bbbAccredited: boolean;
  vertical: string;
  source: "bbb";
  rawData: Record<string, any>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

async function scrapeBBBPage(searchTerm: string, city: string, state: string, page: number): Promise<{
  businesses: BBBBusiness[];
  hasNextPage: boolean;
}> {
  const location = `${city}+${state}`;
  const url = `https://www.bbb.org/search?find_text=${encodeURIComponent(searchTerm)}&find_loc=${encodeURIComponent(location)}&page=${page}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BusinessDataCollector/1.0)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[BBB] HTTP ${response.status} for "${searchTerm}" in ${city}, ${state} page ${page}`);
      return { businesses: [], hasNextPage: false };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const businesses: BBBBusiness[] = [];

    $("[data-testid='search-results-item'], .SearchResult, .result-item").each((_: number, el: any) => {
      const nameEl = $(el).find("[data-testid='business-name'], .business-name, h3 a").first();
      const name = nameEl.text().trim();
      if (!name || name.length < 2 || isChainBusiness(name)) return;

      const isAccredited = $(el).find("[data-testid='accreditation-badge'], .accredited-badge, .AB_accredited").length > 0;

      const phoneRaw = $(el).find("[data-testid='phone'], .phone, .dtm-phone").first().text().trim();
      const phone = normalizePhone(phoneRaw);

      const addressEl = $(el).find("[data-testid='address'], .address, .biz-info address").first();
      const addressText = addressEl.text().replace(/\s+/g, " ").trim();

      const zipMatch = addressText.match(/\b(\d{5})(?:-\d{4})?\b/);
      const zip = zipMatch ? zipMatch[1] : null;

      const websiteEl = $(el).find("a[href*='www']").first();
      const website = websiteEl.attr("href") || null;

      businesses.push({
        businessName: name,
        phone,
        email: null,
        website,
        address: addressText || null,
        city,
        state,
        zip,
        bbbAccredited: isAccredited,
        vertical: searchTerm,
        source: "bbb",
        rawData: { searchTerm, city, state, page, isAccredited },
      });
    });

    const hasNextPage = $("a[aria-label='Next page'], .next-page, [data-testid='pagination-next']").length > 0;
    return { businesses, hasNextPage };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name !== "AbortError") {
      console.warn(`[BBB] Error scraping "${searchTerm}" in ${city}, ${state} p${page}:`, err.message);
    }
    return { businesses: [], hasNextPage: false };
  }
}

async function markBbbAccredited(businessName: string, city: string | null): Promise<void> {
  try {
    const condition = city
      ? and(eq(sdrMerchants.businessName, businessName), eq(sdrMerchants.city, city))
      : eq(sdrMerchants.businessName, businessName);

    await db.update(sdrMerchants)
      .set({ bbbAccredited: true } as any)
      .where(condition);
  } catch (_) {}
}

export async function runBBBDiscovery(options?: {
  verticals?: string[];
  states?: string[];
  citiesPerState?: number;
  jobId?: number;
}): Promise<{ found: number; newInserted: number; duplicatesSkipped: number; accreditedFound: number }> {
  const targetVerticals = options?.verticals || Object.keys(VERTICAL_SEARCH_TERMS);
  const targetStates = options?.states || Object.keys(DEFAULT_CITIES_BY_STATE);
  const citiesPerState = options?.citiesPerState || 5;
  const jobId = options?.jobId;

  let totalFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;
  let accreditedFound = 0;

  console.log(`[BBB] Starting discovery: ${targetVerticals.length} verticals × ${targetStates.length} states`);

  for (const state of targetStates) {
    const cities = (DEFAULT_CITIES_BY_STATE[state] || []).slice(0, citiesPerState);

    for (const city of cities) {
      for (const vertical of targetVerticals) {
        const searchTerm = VERTICAL_SEARCH_TERMS[vertical] || vertical;

        try {
          const allBusinesses: BBBBusiness[] = [];
          let page = 1;
          let hasMore = true;

          while (hasMore && page <= 5) {
            const { businesses, hasNextPage } = await scrapeBBBPage(searchTerm, city, state, page);
            allBusinesses.push(...businesses.map(b => ({ ...b, vertical })));
            hasMore = hasNextPage;
            page++;
            if (hasMore) await sleep(DELAY_BETWEEN_PAGES_MS);
          }

          totalFound += allBusinesses.length;
          const accredCount = allBusinesses.filter(b => b.bbbAccredited).length;
          accreditedFound += accredCount;

          if (allBusinesses.length > 0) {
            const { dedupeAndInsertFree } = await import("./lead-finder");
            const counts = await dedupeAndInsertFree(allBusinesses.map(b => ({
              businessName: b.businessName,
              phone: b.phone,
              email: b.email,
              website: b.website,
              address: b.address,
              city: b.city,
              state: b.state,
              zip: b.zip,
              vertical: b.vertical,
              metro: city,
              source: "bbb",
              rawData: b.rawData,
              rating: null,
              reviewCount: null,
              placeId: null,
            })), jobId);
            totalNewInserted += counts.newInserted;
            totalDuplicatesSkipped += counts.duplicatesSkipped;

            for (const biz of allBusinesses.filter(b => b.bbbAccredited)) {
              await markBbbAccredited(biz.businessName, biz.city);
            }

            console.log(`[BBB] ${vertical}/${city}/${state}: ${allBusinesses.length} found (${accredCount} accredited), ${counts.newInserted} new`);
          }
        } catch (err) {
          console.error(`[BBB] Error for ${vertical}/${city}/${state}:`, err);
        }

        await sleep(DELAY_BETWEEN_CITIES_MS);
      }
    }
  }

  console.log(`[BBB] Discovery complete: ${totalFound} found (${accreditedFound} accredited), ${totalNewInserted} new, ${totalDuplicatesSkipped} dupes`);
  return { found: totalFound, newInserted: totalNewInserted, duplicatesSkipped: totalDuplicatesSkipped, accreditedFound };
}

async function logEvent(eventType: string, payload: Record<string, any>): Promise<void> {
  try {
    await db.insert(sdrLeadEvents).values({
      eventType,
      actionType: "discovery",
      actorType: "system",
      payloadJson: payload,
    });
  } catch (_) {}
}

export async function runBBBDiscoveryJob(jobId?: number): Promise<{ found: number; newInserted: number; duplicatesSkipped: number }> {
  await logEvent("bbb_discovery_start", { jobId, startedAt: new Date().toISOString() });

  try {
    const result = await runBBBDiscovery({ jobId });

    await logEvent("bbb_discovery_complete", {
      jobId,
      found: result.found,
      newInserted: result.newInserted,
      duplicatesSkipped: result.duplicatesSkipped,
      accredited: result.accreditedFound,
      completedAt: new Date().toISOString(),
    });

    console.log(`[BBB] Job complete — ${result.found} found, ${result.newInserted} new, ${result.duplicatesSkipped} dupes, ${result.accreditedFound} accredited`);
    return { found: result.found, newInserted: result.newInserted, duplicatesSkipped: result.duplicatesSkipped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("bbb_discovery_error", { jobId, error: msg });
    throw err;
  }
}
