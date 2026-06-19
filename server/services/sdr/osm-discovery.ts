import { db } from "../../db";
import { sdrLeadEvents } from "@shared/schema";
import { storage } from "../../storage";
import { isChainBusiness } from "./chain-blocklist";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const DELAY_BETWEEN_REQUESTS_MS = 2000;

export interface OsmBusiness {
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  vertical: string;
  source: "osm";
  rawData: Record<string, any>;
}

const VERTICAL_OSM_TAGS: Array<{ vertical: string; tags: string[] }> = [
  {
    vertical: "auto repair",
    tags: [
      '["amenity"="car_repair"]',
      '["amenity"="car_wash"]',
      '["shop"="tyres"]',
      '["shop"="car_parts"]',
    ],
  },
  {
    vertical: "dental",
    tags: ['["amenity"="dentist"]'],
  },
  {
    vertical: "chiropractic",
    tags: [
      '["healthcare"="alternative"]',
      '["healthcare:speciality"="chiropractic"]',
    ],
  },
  {
    vertical: "med spa",
    tags: [
      '["leisure"="spa"]',
      '["shop"="beauty"]',
      '["amenity"="beauty_salon"]',
    ],
  },
  {
    vertical: "restaurant",
    tags: [
      '["amenity"="restaurant"]',
      '["amenity"="fast_food"]["name"]',
    ],
  },
  {
    vertical: "medical practice",
    tags: [
      '["amenity"="clinic"]',
      '["amenity"="doctors"]',
      '["healthcare"="clinic"]',
    ],
  },
  {
    vertical: "construction",
    tags: [
      '["craft"="electrician"]',
      '["craft"="plumber"]',
      '["craft"="hvac"]',
      '["craft"="roofer"]',
      '["craft"="builder"]',
    ],
  },
  {
    vertical: "retail",
    tags: ['["shop"="jewellery"]', '["shop"="jewelry"]'],
  },
];

const US_STATE_BBOXES: Array<{ state: string; code: string; bbox: [number, number, number, number] }> = [
  { state: "Alabama", code: "AL", bbox: [30.14, -88.47, 35.01, -84.89] },
  { state: "Alaska", code: "AK", bbox: [54.68, -180, 71.54, -129.99] },
  { state: "Arizona", code: "AZ", bbox: [31.33, -114.82, 37.0, -109.04] },
  { state: "Arkansas", code: "AR", bbox: [33.00, -94.62, 36.50, -89.64] },
  { state: "California", code: "CA", bbox: [32.53, -124.41, 42.01, -114.13] },
  { state: "Colorado", code: "CO", bbox: [36.99, -109.05, 41.00, -102.04] },
  { state: "Connecticut", code: "CT", bbox: [40.99, -73.73, 42.05, -71.79] },
  { state: "Delaware", code: "DE", bbox: [38.45, -75.79, 39.84, -75.05] },
  { state: "Florida", code: "FL", bbox: [24.52, -87.63, 31.00, -80.04] },
  { state: "Georgia", code: "GA", bbox: [30.36, -85.61, 35.00, -80.84] },
  { state: "Hawaii", code: "HI", bbox: [18.91, -160.25, 22.24, -154.81] },
  { state: "Idaho", code: "ID", bbox: [41.99, -117.24, 49.00, -111.04] },
  { state: "Illinois", code: "IL", bbox: [36.97, -91.51, 42.51, -87.02] },
  { state: "Indiana", code: "IN", bbox: [37.77, -88.10, 41.77, -84.78] },
  { state: "Iowa", code: "IA", bbox: [40.38, -96.64, 43.50, -90.14] },
  { state: "Kansas", code: "KS", bbox: [36.99, -102.05, 40.00, -94.59] },
  { state: "Kentucky", code: "KY", bbox: [36.50, -89.57, 39.15, -81.96] },
  { state: "Louisiana", code: "LA", bbox: [28.93, -94.04, 33.02, -88.82] },
  { state: "Maine", code: "ME", bbox: [43.06, -71.08, 47.46, -66.95] },
  { state: "Maryland", code: "MD", bbox: [37.89, -79.49, 39.72, -75.05] },
  { state: "Massachusetts", code: "MA", bbox: [41.48, -73.51, 42.89, -69.93] },
  { state: "Michigan", code: "MI", bbox: [41.70, -90.42, 48.31, -82.41] },
  { state: "Minnesota", code: "MN", bbox: [43.50, -97.24, 49.38, -89.49] },
  { state: "Mississippi", code: "MS", bbox: [30.17, -91.65, 35.01, -88.10] },
  { state: "Missouri", code: "MO", bbox: [35.99, -95.77, 40.61, -89.10] },
  { state: "Montana", code: "MT", bbox: [44.36, -116.05, 49.00, -104.04] },
  { state: "Nebraska", code: "NE", bbox: [39.99, -104.05, 43.00, -95.31] },
  { state: "Nevada", code: "NV", bbox: [35.00, -120.01, 42.00, -114.04] },
  { state: "New Hampshire", code: "NH", bbox: [42.70, -72.56, 45.31, -70.62] },
  { state: "New Jersey", code: "NJ", bbox: [38.93, -75.56, 41.36, -73.89] },
  { state: "New Mexico", code: "NM", bbox: [31.33, -109.05, 37.00, -103.00] },
  { state: "New York", code: "NY", bbox: [40.50, -79.76, 45.01, -71.85] },
  { state: "North Carolina", code: "NC", bbox: [33.84, -84.32, 36.59, -75.46] },
  { state: "North Dakota", code: "ND", bbox: [45.94, -104.05, 49.00, -96.55] },
  { state: "Ohio", code: "OH", bbox: [38.40, -84.82, 42.32, -80.52] },
  { state: "Oklahoma", code: "OK", bbox: [33.62, -103.00, 37.00, -94.43] },
  { state: "Oregon", code: "OR", bbox: [41.99, -124.56, 46.26, -116.46] },
  { state: "Pennsylvania", code: "PA", bbox: [39.72, -80.52, 42.27, -74.69] },
  { state: "Rhode Island", code: "RI", bbox: [41.15, -71.91, 42.02, -71.12] },
  { state: "South Carolina", code: "SC", bbox: [32.05, -83.35, 35.22, -78.55] },
  { state: "South Dakota", code: "SD", bbox: [42.48, -104.06, 45.94, -96.44] },
  { state: "Tennessee", code: "TN", bbox: [34.98, -90.31, 36.68, -81.65] },
  { state: "Texas", code: "TX", bbox: [25.84, -106.65, 36.50, -93.51] },
  { state: "Utah", code: "UT", bbox: [36.99, -114.05, 42.00, -109.04] },
  { state: "Vermont", code: "VT", bbox: [42.73, -73.44, 45.02, -71.50] },
  { state: "Virginia", code: "VA", bbox: [36.54, -83.68, 39.47, -75.24] },
  { state: "Washington", code: "WA", bbox: [45.54, -124.73, 49.00, -116.92] },
  { state: "West Virginia", code: "WV", bbox: [37.20, -82.64, 40.64, -77.72] },
  { state: "Wisconsin", code: "WI", bbox: [42.49, -92.89, 47.31, -86.25] },
  { state: "Wyoming", code: "WY", bbox: [40.99, -111.06, 45.01, -104.05] },
];

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

function parseOsmElement(el: any, verticalLabel: string, stateCode: string): OsmBusiness | null {
  const tags = el.tags || {};
  const name = tags.name || tags["name:en"];
  if (!name || name.length < 2) return null;
  if (isChainBusiness(name)) return null;

  const phone = normalizePhone(tags.phone || tags["contact:phone"]);
  const email = tags.email || tags["contact:email"] || null;
  const website = tags.website || tags["contact:website"] || null;

  const houseNumber = tags["addr:housenumber"] || "";
  const street = tags["addr:street"] || "";
  const address = houseNumber && street ? `${houseNumber} ${street}`.trim() : street || null;
  const city = tags["addr:city"] || null;
  const zip = tags["addr:postcode"] || null;

  return {
    businessName: name,
    phone,
    email,
    website,
    address,
    city,
    state: stateCode,
    zip,
    vertical: verticalLabel,
    source: "osm",
    rawData: { osmId: el.id, osmType: el.type, tags },
  };
}

async function queryOverpassForTag(
  tagFilter: string,
  bbox: [number, number, number, number],
  stateCode: string,
  verticalLabel: string
): Promise<OsmBusiness[]> {
  const [south, west, north, east] = bbox;
  const bboxStr = `${south},${west},${north},${east}`;

  const qlQuery = `[out:json][timeout:60];(node${tagFilter}(${bboxStr});way${tagFilter}(${bboxStr}););out center tags;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(qlQuery)}`,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[OSM] Overpass HTTP ${response.status} for ${verticalLabel}/${stateCode}`);
      return [];
    }

    const data = await response.json() as { elements?: any[] };
    const elements = data.elements || [];
    const results: OsmBusiness[] = [];

    for (const el of elements) {
      const biz = parseOsmElement(el, verticalLabel, stateCode);
      if (biz) results.push(biz);
    }

    return results;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.warn(`[OSM] Request timed out for ${verticalLabel}/${stateCode}`);
    } else {
      console.warn(`[OSM] Error querying ${verticalLabel}/${stateCode}:`, err.message);
    }
    return [];
  }
}

export async function runOsmDiscovery(options?: {
  stateCodes?: string[];
  verticals?: string[];
  jobId?: number;
}): Promise<{ found: number; newInserted: number; duplicatesSkipped: number; states: string[] }> {
  const targetStateCodes = options?.stateCodes || US_STATE_BBOXES.map(s => s.code);
  const targetVerticals = options?.verticals;
  const jobId = options?.jobId;

  const targetStates = US_STATE_BBOXES.filter(s => targetStateCodes.includes(s.code));
  const targetVerticalConfigs = targetVerticals
    ? VERTICAL_OSM_TAGS.filter(v => targetVerticals.includes(v.vertical))
    : VERTICAL_OSM_TAGS;

  let totalFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;
  const processedStates: string[] = [];

  console.log(`[OSM] Starting discovery: ${targetStates.length} states × ${targetVerticalConfigs.length} verticals`);

  for (const stateEntry of targetStates) {
    let stateFound = 0;

    for (const vertConfig of targetVerticalConfigs) {
      for (const tag of vertConfig.tags) {
        try {
          const businesses = await queryOverpassForTag(
            tag,
            stateEntry.bbox,
            stateEntry.code,
            vertConfig.vertical
          );
          stateFound += businesses.length;
          totalFound += businesses.length;

          if (businesses.length > 0) {
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
              metro: b.city || stateEntry.state,
              source: "osm",
              rawData: b.rawData,
              rating: null,
              reviewCount: null,
              placeId: null,
            })), jobId);
            totalNewInserted += counts.newInserted;
            totalDuplicatesSkipped += counts.duplicatesSkipped;
          }

          await sleep(DELAY_BETWEEN_REQUESTS_MS);
        } catch (err) {
          console.error(`[OSM] Failed tag ${tag} for ${stateEntry.code}:`, err);
        }
      }
    }

    if (stateFound > 0) {
      processedStates.push(stateEntry.code);
    }

    console.log(`[OSM] ${stateEntry.code}: ${stateFound} businesses found`);
  }

  console.log(`[OSM] Discovery complete: ${totalFound} total, ${totalNewInserted} new, ${totalDuplicatesSkipped} dupes`);
  return { found: totalFound, newInserted: totalNewInserted, duplicatesSkipped: totalDuplicatesSkipped, states: processedStates };
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

export async function runOsmDiscoveryJob(jobId?: number): Promise<{ found: number; newInserted: number; duplicatesSkipped: number }> {
  await logEvent("osm_discovery_start", { jobId, startedAt: new Date().toISOString() });

  try {
    const savedMatrix = await storage.getSystemSetting("lead_discovery_matrix") as any;
    const stateCodes: string[] | undefined = savedMatrix?.osmStateCodes;

    const result = await runOsmDiscovery({ stateCodes, jobId });

    await logEvent("osm_discovery_complete", {
      jobId,
      found: result.found,
      newInserted: result.newInserted,
      duplicatesSkipped: result.duplicatesSkipped,
      states: result.states.length,
      completedAt: new Date().toISOString(),
    });

    console.log(`[OSM] Job complete — ${result.found} found, ${result.newInserted} new, ${result.duplicatesSkipped} dupes across ${result.states.length} states`);
    return { found: result.found, newInserted: result.newInserted, duplicatesSkipped: result.duplicatesSkipped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("osm_discovery_error", { jobId, error: msg });
    throw err;
  }
}
