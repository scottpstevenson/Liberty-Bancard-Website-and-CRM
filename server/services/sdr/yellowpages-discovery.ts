import * as cheerio from "cheerio";
import { db } from "../../db";
import { sdrLeadEvents } from "@shared/schema";
import { isChainBusiness } from "./chain-blocklist";

const DELAY_BETWEEN_PAGES_MS = 2000;
const DELAY_BETWEEN_CITIES_MS = 10000;

const VERTICAL_SEARCH_TERMS: Record<string, string[]> = {
  "auto repair": ["auto repair shop", "car repair"],
  "med spa": ["med spa", "medical spa", "aesthetic clinic"],
  "dental": ["dentist", "dental office"],
  "chiropractic": ["chiropractor", "chiropractic clinic"],
  "restaurant": ["restaurant"],
  "medical practice": ["medical clinic", "urgent care"],
  "construction": ["general contractor", "electrician", "plumber"],
  "retail": ["jewelry store"],
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

export interface YPBusiness {
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  category: string | null;
  vertical: string;
  source: "yellowpages";
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

async function scrapeYPPage(searchTerm: string, city: string, state: string, page: number): Promise<{
  businesses: YPBusiness[];
  hasNextPage: boolean;
}> {
  const geoQuery = `${city} ${state}`;
  const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(searchTerm)}&geo_location_terms=${encodeURIComponent(geoQuery)}&page=${page}`;

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
      console.warn(`[YP] HTTP ${response.status} for "${searchTerm}" in ${city}, ${state} page ${page}`);
      return { businesses: [], hasNextPage: false };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const businesses: YPBusiness[] = [];

    $(".result").each((_: number, el: any) => {
      const nameEl = $(el).find(".business-name span");
      const name = nameEl.text().trim();
      if (!name || isChainBusiness(name)) return;

      const phoneRaw = $(el).find(".phones.phone.primary").text().trim();
      const phone = normalizePhone(phoneRaw);

      const street = $(el).find(".street-address").text().trim();
      const locality = $(el).find(".locality").text().trim();
      const zipMatch = locality.match(/,\s*\w{2}\s+(\d{5})/);
      const zip = zipMatch ? zipMatch[1] : null;

      const websiteEl = $(el).find("a.track-visit-website");
      const website = websiteEl.attr("href") || null;

      const category = $(el).find(".categories a").first().text().trim() || null;

      businesses.push({
        businessName: name,
        phone,
        email: null,
        website,
        address: street || null,
        city,
        state,
        zip,
        category,
        vertical: searchTerm,
        source: "yellowpages",
        rawData: { searchTerm, city, state, page },
      });
    });

    const hasNextPage = $("a.next").length > 0;
    return { businesses, hasNextPage };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name !== "AbortError") {
      console.warn(`[YP] Error scraping "${searchTerm}" in ${city}, ${state} p${page}:`, err.message);
    }
    return { businesses: [], hasNextPage: false };
  }
}

async function scrapeVerticalCity(
  vertical: string,
  searchTerms: string[],
  city: string,
  state: string
): Promise<YPBusiness[]> {
  const results: YPBusiness[] = [];

  for (const term of searchTerms) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      const { businesses, hasNextPage } = await scrapeYPPage(term, city, state, page);
      results.push(...businesses.map(b => ({ ...b, vertical })));
      hasMore = hasNextPage;
      page++;

      if (hasMore) await sleep(DELAY_BETWEEN_PAGES_MS);
    }

    await sleep(DELAY_BETWEEN_PAGES_MS);
  }

  return results;
}

export async function runYellowPagesDiscovery(options?: {
  verticals?: string[];
  states?: string[];
  citiesPerState?: number;
  jobId?: number;
  maxInsert?: number;
  maxFetch?: number;
}): Promise<{ found: number; newInserted: number; duplicatesSkipped: number }> {
  const targetVerticals = options?.verticals || Object.keys(VERTICAL_SEARCH_TERMS);
  const targetStates = options?.states || Object.keys(DEFAULT_CITIES_BY_STATE);
  const citiesPerState = options?.citiesPerState || 5;
  const jobId = options?.jobId;
  const maxInsert = options?.maxInsert;
  const maxFetch = options?.maxFetch;

  let totalFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;

  console.log(`[YP] Starting discovery: ${targetVerticals.length} verticals × ${targetStates.length} states`);

  for (const state of targetStates) {
    const cities = (DEFAULT_CITIES_BY_STATE[state] || []).slice(0, citiesPerState);

    for (const city of cities) {
      for (const vertical of targetVerticals) {
        const terms = VERTICAL_SEARCH_TERMS[vertical] || [vertical];

        try {
          if (maxFetch !== undefined && totalFound >= maxFetch) break;
          const businesses = await scrapeVerticalCity(vertical, terms, city, state);
          totalFound += businesses.length;

          if (businesses.length > 0) {
            const remaining = maxInsert !== undefined ? maxInsert - totalNewInserted : undefined;
            if (remaining !== undefined && remaining <= 0) break;
            const { dedupeAndInsertFree } = await import("./lead-finder");
            const counts = await dedupeAndInsertFree(businesses.map(b => ({
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
              source: "yellowpages",
              rawData: b.rawData,
              rating: null,
              reviewCount: null,
              placeId: null,
            })), jobId, remaining);
            totalNewInserted += counts.newInserted;
            totalDuplicatesSkipped += counts.duplicatesSkipped;
            console.log(`[YP] ${vertical}/${city}/${state}: ${businesses.length} found, ${counts.newInserted} new`);
          }
        } catch (err) {
          console.error(`[YP] Error for ${vertical}/${city}/${state}:`, err);
        }

        await sleep(DELAY_BETWEEN_CITIES_MS);
      }
    }
  }

  console.log(`[YP] Discovery complete: ${totalFound} found, ${totalNewInserted} new, ${totalDuplicatesSkipped} dupes`);
  return { found: totalFound, newInserted: totalNewInserted, duplicatesSkipped: totalDuplicatesSkipped };
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

export async function runYellowPagesDiscoveryJob(jobId?: number): Promise<{ found: number; newInserted: number; duplicatesSkipped: number }> {
  await logEvent("yp_discovery_start", { jobId, startedAt: new Date().toISOString() });

  try {
    const result = await runYellowPagesDiscovery({ jobId });

    await logEvent("yp_discovery_complete", {
      jobId,
      found: result.found,
      newInserted: result.newInserted,
      duplicatesSkipped: result.duplicatesSkipped,
      completedAt: new Date().toISOString(),
    });

    console.log(`[YP] Job complete — ${result.found} found, ${result.newInserted} new, ${result.duplicatesSkipped} dupes`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("yp_discovery_error", { jobId, error: msg });
    throw err;
  }
}
