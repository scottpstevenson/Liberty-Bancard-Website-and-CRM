import * as cheerio from "cheerio";

const SUNBIZ_BASE = "https://search.sunbiz.org";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "nor",
  "of", "on", "or", "so", "the", "to", "up", "yet", "is", "it",
]);

const BUSINESS_ABBREVIATIONS: Record<string, string> = {
  "llc": "LLC", "llp": "LLP", "inc": "Inc.", "corp": "Corp.",
  "co": "Co.", "ltd": "Ltd.", "dba": "DBA", "pllc": "PLLC",
  "pa": "P.A.", "pc": "P.C.", "lp": "LP", "na": "N.A.",
  "ii": "II", "iii": "III", "iv": "IV", "usa": "USA", "us": "US",
  "fl": "FL", "ny": "NY", "ca": "CA", "tx": "TX", "nj": "NJ",
  "ga": "GA", "nc": "NC", "va": "VA", "oh": "OH", "pa.": "PA",
  "il": "IL", "mi": "MI", "ma": "MA", "md": "MD", "wa": "WA",
};

export function toProperCase(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) {
    return trimmed;
  }
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      const clean = word.replace(/[.,]/g, "");
      const abbr = BUSINESS_ABBREVIATIONS[clean];
      if (abbr) {
        const suffix = word.slice(clean.length);
        return abbr + suffix;
      }
      if (i > 0 && SMALL_WORDS.has(clean) && word.length < 4) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function properCaseAddress(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (/^\d/.test(word)) return word;
      const upper = word.toUpperCase();
      if (/^(ne|nw|se|sw|n|s|e|w|apt|ste|fl|bldg|po|st|rd|dr|ln|ct|ave|blvd|hwy|pkwy|cir)\.?$/i.test(word)) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export interface SunbizSearchResult {
  entityName: string;
  filingNumber: string;
  entityType: string;
  entityStatus: string;
  filingDate: string;
  detailUrl: string;
}

export interface SunbizOfficer {
  title: string;
  name: string;
  address: string;
}

export interface SunbizDetail {
  entityName: string;
  filingNumber: string;
  feiEinNumber: string;
  entityType: string;
  entityStatus: string;
  filingDate: string;
  lastEvent: string;
  lastEventDate: string;
  principalAddress: string;
  principalCity: string;
  principalState: string;
  principalZip: string;
  mailingAddress: string;
  registeredAgentName: string;
  registeredAgentAddress: string;
  officers: SunbizOfficer[];
  detailUrl: string;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function searchSunbiz(
  query: string,
  entityType: string = "All"
): Promise<SunbizSearchResult[]> {
  const searchName = query.toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
  const url = `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchByName?searchNameOrder=${encodeURIComponent(searchName)}&searchTerm=${encodeURIComponent(searchName)}&listNameOrder=${encodeURIComponent(searchName)}`;

  const html = await fetchPage(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: SunbizSearchResult[] = [];

  $("table.search-results tbody tr, #search-results table tbody tr, .searchResultTable tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length >= 4) {
      const link = $(cells[0]).find("a");
      const entityName = link.text().trim() || $(cells[0]).text().trim();
      const detailHref = link.attr("href") || "";
      const filingNumber = $(cells[1]).text().trim();
      const status = $(cells[2]).text().trim();
      const filingDate = $(cells[3]).text().trim();

      if (entityName && filingNumber) {
        results.push({
          entityName,
          filingNumber,
          entityType: "",
          entityStatus: status,
          filingDate,
          detailUrl: detailHref.startsWith("http") ? detailHref : `${SUNBIZ_BASE}${detailHref}`,
        });
      }
    }
  });

  if (results.length === 0) {
    $("a[href*='/Inquiry/CorporationSearch/SearchResultDetail']").each((_, el) => {
      const entityName = $(el).text().trim();
      const detailUrl = $(el).attr("href") || "";
      if (entityName) {
        results.push({
          entityName,
          filingNumber: "",
          entityType: "",
          entityStatus: "Active",
          filingDate: "",
          detailUrl: detailUrl.startsWith("http") ? detailUrl : `${SUNBIZ_BASE}${detailUrl}`,
        });
      }
    });
  }

  return results;
}

function parseAddress(text: string): { address: string; city: string; state: string; zip: string } {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const full = lines.join(", ");
  const cityStateZip = lines[lines.length - 1] || "";
  const match = cityStateZip.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  if (match) {
    return { address: full, city: match[1].trim(), state: match[2], zip: match[3] };
  }
  return { address: full, city: "", state: "FL", zip: "" };
}

export async function getEntityDetail(detailUrl: string): Promise<SunbizDetail | null> {
  const html = await fetchPage(detailUrl);
  if (!html) return null;

  const $ = cheerio.load(html);
  const detail: SunbizDetail = {
    entityName: "",
    filingNumber: "",
    feiEinNumber: "",
    entityType: "",
    entityStatus: "",
    filingDate: "",
    lastEvent: "",
    lastEventDate: "",
    principalAddress: "",
    principalCity: "",
    principalState: "",
    principalZip: "",
    mailingAddress: "",
    registeredAgentName: "",
    registeredAgentAddress: "",
    officers: [],
    detailUrl,
  };

  const getText = (label: string): string => {
    let result = "";
    $("label, span.detailLabel, .detailSection span").each((_, el) => {
      const elText = $(el).text().trim().toLowerCase();
      if (elText.includes(label.toLowerCase())) {
        const nextEl = $(el).next();
        result = nextEl.text().trim() || $(el).parent().text().replace($(el).text(), "").trim();
      }
    });
    return result;
  };

  const pageText = $("body").text();

  const nameMatch = pageText.match(/(?:Entity Name|Corporation Name|LLC Name)[:\s]*([^\n]+)/i);
  if (nameMatch) detail.entityName = nameMatch[1].trim();
  if (!detail.entityName) {
    detail.entityName = $(".detailSection .corporationName, h1.corporationName, #Detail_EntityName").first().text().trim();
  }
  if (!detail.entityName) {
    detail.entityName = $("div.detailSection span:first-child, .searchResultDetail h1").first().text().trim();
  }

  const filingMatch = pageText.match(/(?:Document Number|Filing Number)[:\s]*([A-Z0-9]+)/i);
  if (filingMatch) detail.filingNumber = filingMatch[1].trim();

  const feiMatch = pageText.match(/(?:FEI\/EIN Number|FEI Number|EIN Number)[:\s]*([0-9\-]+)/i);
  if (feiMatch) detail.feiEinNumber = feiMatch[1].trim();

  const statusMatch = pageText.match(/Status[:\s]*(Active|Inactive|Dissolved|Revoked|Withdrawn|Voluntarily Dissolved|Admin Dissolved|Merged)/i);
  if (statusMatch) detail.entityStatus = statusMatch[1].trim();

  const dateMatch = pageText.match(/(?:Filing Date|Date Filed)[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (dateMatch) detail.filingDate = dateMatch[1].trim();

  const lastEventMatch = pageText.match(/(?:Last Event)[:\s]*([^\n]+)/i);
  if (lastEventMatch) detail.lastEvent = lastEventMatch[1].trim();

  const lastEventDateMatch = pageText.match(/(?:Event Date Filed)[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (lastEventDateMatch) detail.lastEventDate = lastEventDateMatch[1].trim();

  const principalMatch = pageText.match(/(?:Principal Address)[:\s]*\n?([\s\S]*?)(?=Mailing Address|Registered Agent|Changed|$)/i);
  if (principalMatch) {
    const parsed = parseAddress(principalMatch[1]);
    detail.principalAddress = parsed.address;
    detail.principalCity = parsed.city;
    detail.principalState = parsed.state;
    detail.principalZip = parsed.zip;
  }

  const mailingMatch = pageText.match(/(?:Mailing Address)[:\s]*\n?([\s\S]*?)(?=Registered Agent|Changed|I certify|$)/i);
  if (mailingMatch) detail.mailingAddress = mailingMatch[1].trim().split("\n").map(l => l.trim()).filter(Boolean).join(", ");

  const agentMatch = pageText.match(/(?:Registered Agent Name & Address)[:\s]*\n?([\s\S]*?)(?=Officer\/Director|Authorized Person|Annual Report|$)/i);
  if (agentMatch) {
    const lines = agentMatch[1].trim().split("\n").map(l => l.trim()).filter(Boolean);
    detail.registeredAgentName = lines[0] || "";
    detail.registeredAgentAddress = lines.slice(1).join(", ");
  }

  const officerSection = pageText.match(/(?:Officer\/Director Detail|Authorized Person\(s\) Detail)[:\s]*\n?([\s\S]*?)(?=Annual Report|$)/i);
  if (officerSection) {
    const officerText = officerSection[1];
    const officerBlocks = officerText.split(/(?=Title\s)/i).filter(b => b.trim());
    for (const block of officerBlocks) {
      const titleMatch = block.match(/Title\s+([^\n]+)/i);
      const nameMatch = block.match(/(?:Name\s+)?([A-Z][A-Z\s,.']+)/);
      const addrLines = block.split("\n").filter(l => l.trim() && !l.match(/^(Title|Name)\s/i));
      if (titleMatch || nameMatch) {
        detail.officers.push({
          title: titleMatch?.[1]?.trim() || "Member",
          name: nameMatch?.[1]?.trim() || "",
          address: addrLines.map(l => l.trim()).filter(Boolean).join(", "),
        });
      }
    }
  }

  return detail;
}

export interface ParsedSunbizRow {
  entityName: string;
  filingNumber: string;
  feiEinNumber: string;
  entityType: string;
  entityStatus: string;
  filingDate: string;
  principalAddress: string;
  principalCity: string;
  principalState: string;
  principalZip: string;
  mailingAddress: string;
  registeredAgentName: string;
  registeredAgentAddress: string;
  officers?: SunbizOfficer[];
  dba: string;
  website: string;
  email: string;
  phone: string;
  detailUrl: string;
}

// Event codes that carry entity names and addresses in corevt fixed-width format
const COREVT_NAME_EVENTS = new Set([
  "CORAPNC", "CORLCNC", "CORAPAMDNC", "CORLCAMDNC",
  "CORAPCONS", "CORAPCONV", "CORAPREIN", "CORAPRSTAR",
  "CORLCAMND", "CORLCRACHG", "CORAPAMND", "CORAPAMNRS",
  "CORAPENREI", "CORAPFNRRE", "CORLCNC",
]);

export interface CorevtRecord {
  filingNumber: string;
  seqNumber: string;
  eventCode: string;
  eventDesc1: string;
  eventDesc2: string;
  eventDate: string;
  entityName: string;
  principalAddress: string;
  principalAddress2: string;
  principalCity: string;
  principalState: string;
  principalZip: string;
  mailingAddress: string;
  mailingAddress2: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
}

function parseCityStateZip(raw: string): { city: string; state: string; zip: string } {
  const s = raw.trim();
  if (!s) return { city: "", state: "", zip: "" };

  const m1 = s.match(/^(.+?)\s{2,}([A-Z]{2})(\d{5}(?:-?\d{4})?)$/);
  if (m1) return { city: m1[1].trim(), state: m1[2], zip: m1[3] };

  const m2 = s.match(/^(.+?)([A-Z]{2})(\d{5}(?:-?\d{4})?)$/);
  if (m2) return { city: m2[1].trim(), state: m2[2], zip: m2[3] };

  const m3 = s.match(/^(.+?)\s+(FLA|FLORIDA)\s+(\d{5}(?:-?\d{4})?)$/i);
  if (m3) return { city: m3[1].trim(), state: "FL", zip: m3[3] };

  const m4 = s.match(/^(.+?)(FLA|FLORIDA)\s*(\d{5}(?:-?\d{4})?)$/i);
  if (m4) return { city: m4[1].trim(), state: "FL", zip: m4[3] };

  const m5 = s.match(/^(.+?)\s+(\d{5}(?:-?\d{4})?)$/);
  if (m5) return { city: m5[1].trim(), state: "FL", zip: m5[2] };

  return { city: s, state: "FL", zip: "" };
}

function parseCorevtLine(line: string): CorevtRecord | null {
  if (line.length < 100) return null;

  const filingNumber = line.substring(0, 12).trim();
  const seqNumber = line.substring(12, 17).trim();
  const eventCode = line.substring(17, 29).trim();
  const eventDesc1 = line.substring(29, 49).trim();
  const eventDesc2 = line.substring(49, 69).trim();

  const dateStr = line.substring(85, 93).trim();
  let eventDate = "";
  if (dateStr.length === 8) {
    eventDate = `${dateStr.substring(0, 2)}/${dateStr.substring(2, 4)}/${dateStr.substring(4, 8)}`;
  }

  let entityName = "";
  let principalAddress = "";
  let principalAddress2 = "";
  let principalCity = "";
  let principalState = "";
  let principalZip = "";
  let mailingAddress = "";
  let mailingAddress2 = "";
  let mailingCity = "";
  let mailingState = "";
  let mailingZip = "";

  if (line.length >= 370) {
    entityName = line.substring(210, 370).trim();
  }

  if (line.length >= 537) {
    principalAddress = line.substring(411, 453).trim();
    principalAddress2 = line.substring(453, 495).trim();
    const cityStateZip = line.substring(495, 537).trim();
    const parsed = parseCityStateZip(cityStateZip);
    principalCity = parsed.city;
    principalState = parsed.state;
    principalZip = parsed.zip;
  }

  if (line.length >= 621) {
    mailingAddress = line.substring(537, 579).trim();
    mailingAddress2 = line.substring(579, 621).trim();
    if (line.length >= 662) {
      const mailCsz = line.substring(621, 662).trim();
      const mParsed = parseCityStateZip(mailCsz);
      mailingCity = mParsed.city;
      mailingState = mParsed.state;
      mailingZip = mParsed.zip;
    }
  }

  return {
    filingNumber,
    seqNumber,
    eventCode,
    eventDesc1,
    eventDesc2,
    eventDate,
    entityName: toProperCase(entityName),
    principalAddress: properCaseAddress([principalAddress, principalAddress2].filter(Boolean).join(", ")),
    principalAddress2: "",
    principalCity: toProperCase(principalCity),
    principalState,
    principalZip,
    mailingAddress: properCaseAddress([mailingAddress, mailingAddress2].filter(Boolean).join(", ")),
    mailingAddress2: "",
    mailingCity: toProperCase(mailingCity),
    mailingState,
    mailingZip,
  };
}

export function parseCorevtToEntities(lines: string[]): ParsedSunbizRow[] {
  const entityMap = new Map<string, ParsedSunbizRow>();

  for (const line of lines) {
    const rec = parseCorevtLine(line);
    if (!rec || !rec.filingNumber) continue;

    if (!rec.entityName && !COREVT_NAME_EVENTS.has(rec.eventCode)) continue;

    const existing = entityMap.get(rec.filingNumber);

    if (!existing) {
      if (rec.entityName) {
        entityMap.set(rec.filingNumber, {
          entityName: rec.entityName,
          filingNumber: rec.filingNumber,
          feiEinNumber: "",
          entityType: rec.eventCode.startsWith("CORLC") ? "LLC" : "Corporation",
          entityStatus: "Active",
          filingDate: rec.eventDate,
          principalAddress: rec.principalAddress,
          principalCity: rec.principalCity,
          principalState: rec.principalState || "FL",
          principalZip: rec.principalZip,
          mailingAddress: rec.mailingAddress,
          registeredAgentName: "",
          registeredAgentAddress: "",
          officers: [],
          dba: "",
          website: "",
          email: "",
          phone: "",
          detailUrl: `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchByName?searchNameOrder=${encodeURIComponent(rec.entityName)}`,
        });
      }
    } else {
      if (rec.entityName && parseInt(rec.seqNumber) > 1) {
        existing.entityName = rec.entityName;
      }
      if (rec.principalAddress && !existing.principalAddress) {
        existing.principalAddress = rec.principalAddress;
        existing.principalCity = rec.principalCity;
        existing.principalState = rec.principalState || existing.principalState;
        existing.principalZip = rec.principalZip;
      }
      if (rec.mailingAddress && !existing.mailingAddress) {
        existing.mailingAddress = rec.mailingAddress;
      }
      if (rec.eventDate) {
        existing.filingDate = rec.eventDate;
      }
      if (rec.eventCode.includes("INVOL") || rec.eventCode.includes("VOLDS") || rec.eventCode.includes("DSPRC") || rec.eventCode.includes("CANNP") || rec.eventCode.includes("VLDSI")) {
        existing.entityStatus = "Inactive";
      }
    }
  }

  return Array.from(entityMap.values()).filter(e => e.entityName && e.entityName.length > 1);
}

export async function* streamCorevtFromZip(filePath: string, options?: { onlyActive?: boolean; maxRecords?: number }): AsyncGenerator<ParsedSunbizRow[], void, unknown> {
  const { spawn } = await import("child_process");
  const { createInterface } = await import("readline");

  const BATCH_SIZE = 500;
  let lineBuffer: string[] = [];
  let totalYielded = 0;
  const maxRecords = options?.maxRecords || Infinity;

  const proc = spawn("unzip", ["-p", filePath], { stdio: ["ignore", "pipe", "ignore"] });

  const rl = createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (totalYielded >= maxRecords) {
      proc.kill();
      break;
    }
    if (line.trim().length < 30) continue;
    lineBuffer.push(line);
    if (lineBuffer.length >= BATCH_SIZE) {
      const entities = parseCorevtToEntities(lineBuffer);
      lineBuffer = [];
      if (entities.length > 0) {
        if (options?.onlyActive) {
          const active = entities.filter(e => e.entityStatus !== "Inactive");
          if (active.length > 0) {
            totalYielded += active.length;
            yield active;
          }
        } else {
          totalYielded += entities.length;
          yield entities;
        }
      }
    }
  }

  if (lineBuffer.length > 0 && totalYielded < maxRecords) {
    const entities = parseCorevtToEntities(lineBuffer);
    if (entities.length > 0) {
      if (options?.onlyActive) {
        const active = entities.filter(e => e.entityStatus !== "Inactive");
        if (active.length > 0) yield active;
      } else {
        yield entities;
      }
    }
  }
}

export function parseSunbizCsv(rows: Record<string, string>[]): ParsedSunbizRow[] {
  const COLUMN_MAP: Record<string, string> = {
    "entity_name": "entityName",
    "entityname": "entityName",
    "entity name": "entityName",
    "company_name": "entityName",
    "companyname": "entityName",
    "company name": "entityName",
    "business_name": "entityName",
    "businessname": "entityName",
    "business name": "entityName",
    "name": "entityName",
    "legal_name": "entityName",
    "legalname": "entityName",
    "legal name": "entityName",
    "corp_name": "entityName",
    "corpname": "entityName",
    "llc_name": "entityName",
    "filing_number": "filingNumber",
    "filingnumber": "filingNumber",
    "filing number": "filingNumber",
    "document_number": "filingNumber",
    "documentnumber": "filingNumber",
    "document number": "filingNumber",
    "doc_number": "filingNumber",
    "doc number": "filingNumber",
    "fei_ein": "feiEinNumber",
    "fei/ein": "feiEinNumber",
    "fei/ein number": "feiEinNumber",
    "fei_ein_number": "feiEinNumber",
    "ein": "feiEinNumber",
    "ein_number": "feiEinNumber",
    "ein number": "feiEinNumber",
    "entity_type": "entityType",
    "entitytype": "entityType",
    "entity type": "entityType",
    "type": "entityType",
    "corp_type": "entityType",
    "status": "entityStatus",
    "entity_status": "entityStatus",
    "entitystatus": "entityStatus",
    "entity status": "entityStatus",
    "filing_date": "filingDate",
    "filingdate": "filingDate",
    "filing date": "filingDate",
    "date_filed": "filingDate",
    "date filed": "filingDate",
    "principal_address": "principalAddress",
    "principaladdress": "principalAddress",
    "principal address": "principalAddress",
    "address": "principalAddress",
    "street_address": "principalAddress",
    "street address": "principalAddress",
    "city": "principalCity",
    "principal_city": "principalCity",
    "state": "principalState",
    "principal_state": "principalState",
    "zip": "principalZip",
    "zipcode": "principalZip",
    "zip_code": "principalZip",
    "zip code": "principalZip",
    "postal_code": "principalZip",
    "postal code": "principalZip",
    "mailing_address": "mailingAddress",
    "mailingaddress": "mailingAddress",
    "mailing address": "mailingAddress",
    "registered_agent": "registeredAgentName",
    "registeredagent": "registeredAgentName",
    "registered agent": "registeredAgentName",
    "registered_agent_name": "registeredAgentName",
    "agent_name": "registeredAgentName",
    "agent name": "registeredAgentName",
    "registered_agent_address": "registeredAgentAddress",
    "agent_address": "registeredAgentAddress",
    "agent address": "registeredAgentAddress",
    "officer": "officerName",
    "officer_name": "officerName",
    "officer name": "officerName",
    "director": "officerName",
    "manager": "officerName",
    "member": "officerName",
    "owner": "officerName",
    "owner_name": "officerName",
    "owner name": "officerName",
    "officer_title": "officerTitle",
    "officer title": "officerTitle",
    "title": "officerTitle",
    "officer_address": "officerAddress",
    "officer address": "officerAddress",
    "dba": "dba",
    "doing_business_as": "dba",
    "doing business as": "dba",
    "fictitious_name": "dba",
    "fictitious name": "dba",
    "website": "website",
    "web": "website",
    "url": "website",
    "email": "email",
    "email_address": "email",
    "email address": "email",
    "phone": "phone",
    "phone_number": "phone",
    "phone number": "phone",
    "telephone": "phone",
  };

  return rows.map(row => {
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = key.toLowerCase().trim().replace(/["\s]+/g, " ").trim();
      const field = COLUMN_MAP[normalizedKey];
      if (field && value?.trim()) {
        mapped[field] = value.trim();
      }
    }

    const officers: SunbizOfficer[] = [];
    if (mapped.officerName) {
      officers.push({
        title: mapped.officerTitle || "Officer",
        name: mapped.officerName,
        address: mapped.officerAddress || "",
      });
    }

    return {
      entityName: toProperCase(mapped.entityName) || "",
      filingNumber: mapped.filingNumber || "",
      feiEinNumber: mapped.feiEinNumber || "",
      entityType: mapped.entityType || "",
      entityStatus: mapped.entityStatus || "Active",
      filingDate: mapped.filingDate || "",
      principalAddress: properCaseAddress(mapped.principalAddress) || "",
      principalCity: toProperCase(mapped.principalCity) || "",
      principalState: mapped.principalState || "FL",
      principalZip: mapped.principalZip || "",
      mailingAddress: properCaseAddress(mapped.mailingAddress) || "",
      registeredAgentName: toProperCase(mapped.registeredAgentName) || "",
      registeredAgentAddress: properCaseAddress(mapped.registeredAgentAddress) || "",
      officers: officers.length > 0 ? officers.map(o => ({
        ...o,
        name: toProperCase(o.name),
        address: properCaseAddress(o.address),
      })) : undefined,
      dba: toProperCase(mapped.dba) || "",
      website: mapped.website || "",
      email: mapped.email || "",
      phone: mapped.phone || "",
      detailUrl: "",
    };
  }).filter(r => r.entityName);
}

export interface CordataRecord {
  corporationNumber: string;
  corporationName: string;
  status: string;
  filingType: string;
  principalAddress1: string;
  principalAddress2: string;
  principalCity: string;
  principalState: string;
  principalZip: string;
  principalCountry: string;
  mailAddress1: string;
  mailAddress2: string;
  mailCity: string;
  mailState: string;
  mailZip: string;
  mailCountry: string;
  fileDate: string;
  feiNumber: string;
  moreThanSixOfficers: boolean;
  lastTransactionDate: string;
  stateCountry: string;
  annualReports: Array<{ year: string; date: string }>;
  registeredAgentName: string;
  registeredAgentType: string;
  registeredAgentAddress: string;
  registeredAgentCity: string;
  registeredAgentState: string;
  registeredAgentZip: string;
  officers: Array<{
    title: string;
    type: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  }>;
}

export function parseCordataLine(line: string): CordataRecord | null {
  if (line.length < 669) return null;

  const corporationNumber = line.substring(0, 12).trim();
  if (!corporationNumber) return null;

  const corporationName = line.substring(12, 204).trim();
  const status = line.substring(204, 205).trim();
  const filingType = line.substring(205, 220).trim();

  const principalAddress1 = line.substring(220, 262).trim();
  const principalAddress2 = line.substring(262, 304).trim();
  const principalCity = line.substring(304, 332).trim();
  const principalState = line.substring(332, 334).trim();
  const principalZip = line.substring(334, 344).trim();
  const principalCountry = line.substring(344, 346).trim();

  const mailAddress1 = line.substring(346, 388).trim();
  const mailAddress2 = line.substring(388, 430).trim();
  const mailCity = line.substring(430, 458).trim();
  const mailState = line.substring(458, 460).trim();
  const mailZip = line.substring(460, 470).trim();
  const mailCountry = line.substring(470, 472).trim();

  const fileDate = line.substring(472, 480).trim();
  const feiNumber = line.substring(480, 494).trim();
  const moreThanSixOfficers = line.substring(494, 495).trim() === "Y";
  const lastTransactionDate = line.substring(495, 503).trim();
  const stateCountry = line.substring(503, 505).trim();

  const annualReports: Array<{ year: string; date: string }> = [];
  const reportPositions = [
    { yearStart: 505, yearLen: 4, dateStart: 510, dateLen: 8 },
    { yearStart: 518, yearLen: 4, dateStart: 523, dateLen: 8 },
    { yearStart: 531, yearLen: 4, dateStart: 536, dateLen: 8 },
  ];
  for (const pos of reportPositions) {
    const year = line.substring(pos.yearStart, pos.yearStart + pos.yearLen).trim();
    const date = line.substring(pos.dateStart, pos.dateStart + pos.dateLen).trim();
    if (year && year !== "0000") {
      annualReports.push({ year, date });
    }
  }

  const registeredAgentName = line.substring(544, 586).trim();
  const registeredAgentType = line.substring(586, 587).trim();
  const registeredAgentAddress = line.substring(587, 629).trim();
  const registeredAgentCity = line.substring(629, 657).trim();
  const registeredAgentState = line.substring(657, 659).trim();
  const registeredAgentZip = line.substring(659, 668).trim();

  const officers: CordataRecord["officers"] = [];
  const OFFICER_BLOCK_SIZE = 128;
  const OFFICER_START = 668;

  for (let i = 0; i < 6; i++) {
    const base = OFFICER_START + i * OFFICER_BLOCK_SIZE;
    if (line.length < base + 4) break;

    const title = line.substring(base, base + 4).trim();
    if (!title) continue;

    const type = line.length > base + 4 ? line.substring(base + 4, base + 5).trim() : "";
    const name = line.length > base + 5 ? line.substring(base + 5, base + 47).trim() : "";
    const address = line.length > base + 47 ? line.substring(base + 47, base + 89).trim() : "";
    const city = line.length > base + 89 ? line.substring(base + 89, base + 117).trim() : "";
    const state = line.length > base + 117 ? line.substring(base + 117, base + 119).trim() : "";
    const zip = line.length > base + 119 ? line.substring(base + 119, base + 128).trim() : "";

    if (name) {
      officers.push({ title, type, name, address, city, state, zip });
    }
  }

  return {
    corporationNumber,
    corporationName,
    status: status === "A" ? "Active" : "Inactive",
    filingType,
    principalAddress1,
    principalAddress2,
    principalCity,
    principalState,
    principalZip,
    principalCountry,
    mailAddress1,
    mailAddress2,
    mailCity,
    mailState,
    mailZip,
    mailCountry,
    fileDate,
    feiNumber,
    moreThanSixOfficers,
    lastTransactionDate,
    stateCountry,
    annualReports,
    registeredAgentName,
    registeredAgentType,
    registeredAgentAddress,
    registeredAgentCity,
    registeredAgentState,
    registeredAgentZip,
    officers,
  };
}

export async function downloadCordataFromSunbiz(destPath: string): Promise<boolean> {
  const { spawn } = await import("child_process");

  return new Promise((resolve) => {
    console.log("[Cordata] Starting download from FL Sunbiz SFTP...");

    const proc = spawn("sshpass", [
      "-p", "PubAccess1845!",
      "sftp", "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=30",
      "Public@sftp.floridados.gov"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.stdout.on("data", (d: Buffer) => {
      const msg = d.toString();
      if (msg.includes("Fetching")) {
        console.log("[Cordata] Download in progress...");
      }
    });

    proc.stdin.write(`get doc/quarterly/cor/cordata.zip ${destPath}\nbye\n`);

    const timeout = setTimeout(() => {
      console.log("[Cordata] Download timed out after 30 minutes");
      proc.kill();
      resolve(false);
    }, 30 * 60 * 1000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log("[Cordata] Download completed successfully");
        resolve(true);
      } else {
        console.error("[Cordata] Download failed:", stderr);
        resolve(false);
      }
    });
  });
}

export async function* streamCordataFromZip(filePath: string, options?: {
  onlyActive?: boolean;
  maxRecords?: number;
}): AsyncGenerator<CordataRecord[], void, unknown> {
  const { spawn } = await import("child_process");
  const { createInterface } = await import("readline");

  const BATCH_SIZE = 500;
  let lineBuffer: CordataRecord[] = [];
  let totalYielded = 0;
  const maxRecords = options?.maxRecords || Infinity;
  const onlyActive = options?.onlyActive !== false;

  const proc = spawn("unzip", ["-p", filePath], { stdio: ["ignore", "pipe", "ignore"] });
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    if (totalYielded >= maxRecords) {
      proc.kill();
      break;
    }
    if (line.length < 669) continue;

    const record = parseCordataLine(line);
    if (!record) continue;
    if (onlyActive && record.status !== "Active") continue;

    lineBuffer.push(record);

    if (lineBuffer.length >= BATCH_SIZE) {
      totalYielded += lineBuffer.length;
      yield lineBuffer;
      lineBuffer = [];
    }
  }

  if (lineBuffer.length > 0 && totalYielded < maxRecords) {
    yield lineBuffer;
  }
}
