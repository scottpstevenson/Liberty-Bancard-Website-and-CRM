/**
 * Classify production-replica exports without connecting to any database.
 * Inputs are ephemeral keyset shards, fetched through production-scoped SELECTs.
 * Only aggregates and record IDs are retained in the report/checkpoint.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  classifyContactLinkCoverage,
  normalizeCoverageName,
  normalizeCoverageAddress,
  emptyContactLinkCoverageCounts,
  type ContactLinkCoverageBusiness,
  type ContactLinkCoverageContact,
} from "../server/services/contact-link-coverage";

const root = process.argv[2];
if (!root || !root.startsWith("/tmp/")) throw new Error("Ephemeral input directory required");
const reportPath = process.argv[3];
if (!reportPath) throw new Error("Aggregate report path required");
// Discovery keys intentionally mirror the SQL query, not URL parser repairs.
const domain = (v: unknown) => String(v ?? "").trim()
  .replace(/^[a-zA-Z]+:\/\//i, "").split("/")[0]
  .replace(/[?#].*$/, "").replace(/^www\./i, "")
  .replace(/:[0-9]+$/, "").replace(/\.$/, "").toLowerCase();
const guardDomain = (value: unknown) => String(value ?? "").trim().replace(/^www\./i, "").toLowerCase();
const canonicalDiscoveryDomain = (value: unknown) => guardDomain(value).replace(/:[0-9]+$/, "").replace(/\.$/, "");
const phone = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const address = normalizeCoverageAddress;
const filingFields = ["filing_number", "filingNumber", "sunbiz_filing_number", "sunbizFilingNumber"];
function decodeBusiness(row: any): ContactLinkCoverageBusiness {
  if (!Array.isArray(row)) return row;
  return {
    businessId: row[0], canonicalName: row[1], normalizedName: row[2],
    websiteDomain: row[3], mainPhone: row[4], streetAddress: row[5],
    city: row[6], state: row[7], postalCode: row[8], recordClass: row[9],
    doNotVisit: row[10], domainBusinessCount: 0,
    sourceLinks: (row[11] ?? []).map((s: any) => !Array.isArray(s) ? s : ({
      sourceLinkId: s[0], businessId: s[1], sourceSystem: s[2], sourceType: s[3],
      stableKey: s[4], rawEvidence: s[17] ?? null, sourceEntityId: s[5], sunbizName: s[6],
      sunbizDba: s[7], sunbizWebsite: s[8], sunbizFilingNumber: s[9],
      sunbizAddress: s[10], sunbizCity: s[11], sunbizState: s[12], sunbizZip: s[13],
      sunbizPhone: s[14], sunbizOwnerPhone: s[15], sunbizEntitySource: s[16],
    })),
  };
}
function decodeContact(row: any): ContactLinkCoverageContact {
  if (!Array.isArray(row)) return {
    ...row,
    emailHasExactlyOneAt: typeof row.emailHasExactlyOneAt === "boolean"
      ? row.emailHasExactlyOneAt
      : typeof row.rawEmail === "string" || typeof row.email === "string"
        ? String(row.rawEmail ?? row.email).split("@").length === 2
        : false,
  };
  return {
    contactId: row[0], companyName: row[1], emailDomain: row[2], website: row[3],
    address: row[4], city: row[5], state: row[6], phone: row[7], rowProvenance: row[8],
    recordClass: row[9], emailStatus: row[10], archived: row[11],
    existingMerchantCustomer: row[12], doNotContact: row[13], doNotAutoContact: row[14],
    optedOutEmail: row[15], optOutStatus: row[16], unsubscribeStatus: row[17],
    bounceStatus: row[18], complaintStatus: row[19], suppressionReason: row[20],
    projectedBusinessId: row[21], currentDecisionId: row[22], currentDecision: row[23],
    currentDecisionBusinessId: row[24], currentRevision: row[25],
    currentDecisionConsistent: row[26], primarySourceEventId: row[27],
    sourceEvents: row[28] ?? [], businesses: [],
    emailHasExactlyOneAt: typeof row[29] === "boolean"
      ? row[29]
      : typeof row[29] === "string" && row[29].split("@").length === 2,
  };
}
const sharedEmailDomains = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com",
  "hotmail.com", "live.com", "aol.com", "icloud.com", "me.com", "msn.com",
  "proton.me", "protonmail.com", "mail.com", "comcast.net", "att.net",
]);
const indexes = {
  name: new Map<string, Set<number>>(),
  domain: new Map<string, Set<number>>(),
  phone: new Map<string, Set<number>>(),
  address: new Map<string, Set<number>>(),
  filing: new Map<string, Set<number>>(),
};
const businesses = new Map<number, ContactLinkCoverageBusiness>();
const insert = (map: Map<string, Set<number>>, key: string, id: number) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(id);
};
const digest = (content: string) => crypto.createHash("sha256").update(content).digest("hex");
const shards = (prefix: string) => fs.readdirSync(root)
  .filter(name => name.startsWith(prefix) && name.endsWith(".json"))
  .sort((a, b) => {
    const cursor = (name: string) => {
      const match = name.match(/-(\d+)\.json$/);
      if (!match) throw new Error(`Invalid keyset shard name: ${name}`);
      return Number(match[1]);
    };
    return cursor(a) - cursor(b);
  });
const businessShardDigests: Record<string, string> = {};
for (const shard of shards("business-")) {
  const content = fs.readFileSync(path.join(root, shard), "utf8");
  businessShardDigests[shard] = digest(content);
  const rows: unknown[] = JSON.parse(content);
  for (const raw of rows) {
    const b = decodeBusiness(raw);
    if (businesses.has(b.businessId)) throw new Error(`Duplicate business ${b.businessId}`);
    businesses.set(b.businessId, b);
    insert(indexes.name, normalizeCoverageName(b.canonicalName), b.businessId);
    insert(indexes.name, normalizeCoverageName(b.normalizedName), b.businessId);
    insert(indexes.domain, canonicalDiscoveryDomain(b.websiteDomain), b.businessId);
    insert(indexes.phone, phone(b.mainPhone), b.businessId);
    insert(indexes.address, address(b.streetAddress), b.businessId);
    insert(indexes.address, address([b.streetAddress, b.city, b.state].filter(Boolean).join(" ")), b.businessId);
    for (const s of b.sourceLinks) {
      insert(indexes.name, normalizeCoverageName(s.sunbizName), b.businessId);
      insert(indexes.name, normalizeCoverageName(s.sunbizDba), b.businessId);
      insert(indexes.domain, domain(s.sunbizWebsite), b.businessId);
      insert(indexes.phone, phone(s.sunbizPhone), b.businessId);
      insert(indexes.phone, phone(s.sunbizOwnerPhone), b.businessId);
      insert(indexes.address, address(s.sunbizAddress), b.businessId);
      insert(indexes.address, address([s.sunbizAddress, s.sunbizCity, s.sunbizState].filter(Boolean).join(" ")), b.businessId);
      insert(indexes.filing, String(s.stableKey ?? "").toLowerCase(), b.businessId);
      insert(indexes.filing, String(s.sunbizFilingNumber ?? "").toLowerCase(), b.businessId);
    }
  }
}
// Match the existing database authority guard, including its deliberately raw
// canonical-domain semantics (not URL parsing or source-site aliases).
const domainCounts = new Map<string, number>();
for (const b of businesses.values()) {
  if (b.recordClass !== "canonical") continue;
  const key = guardDomain(b.websiteDomain);
  if (key) domainCounts.set(key, (domainCounts.get(key) ?? 0) + 1);
}
for (const b of businesses.values()) b.domainBusinessCount = domainCounts.get(guardDomain(b.websiteDomain)) ?? 0;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const snapshotIdentity = digest(JSON.stringify({
  watermark: manifest.watermark, total: manifest.total,
  startedAt: manifest.startedAt, source: manifest.source,
}));
const businessSnapshot = digest(JSON.stringify(businessShardDigests));
const classifierIdentity = digest([
  fs.readFileSync(new URL(import.meta.url), "utf8"),
  fs.readFileSync(new URL("../server/services/contact-link-coverage.ts", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../server/services/contact-business-system-link-policy.ts", import.meta.url), "utf8"),
].join("\n"));
let report: any = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : {
  workflow: "contact_link_coverage_replica_v1",
  watermark: manifest.watermark,
  total: manifest.total,
  processed: 0,
  cursor: 0,
  complete: false,
  counts: emptyContactLinkCoverageCounts(),
  reasonCounts: {},
  representativeIds: {},
  strictCandidates: [],
  snapshotIdentity,
  businessSnapshot,
  classifierIdentity,
  contactShardDigests: {},
  startedAt: new Date().toISOString(),
};
if (report.watermark !== manifest.watermark || report.total !== manifest.total) throw new Error("Snapshot mismatch");
if (report.snapshotIdentity !== snapshotIdentity || report.businessSnapshot !== businessSnapshot) {
  throw new Error("Resume input snapshot changed");
}
if (report.classifierIdentity !== classifierIdentity) throw new Error("Resume classifier changed; use a new aggregate report");
for (const [shard, expected] of Object.entries(report.contactShardDigests)) {
  const file = path.join(root, shard);
  if (!fs.existsSync(file) || digest(fs.readFileSync(file, "utf8")) !== expected) {
    throw new Error(`Resume contact shard changed or disappeared: ${shard}`);
  }
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const save = () => {
  report.updatedAt = new Date().toISOString();
  const temporary = `${reportPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, reportPath);
};
const seenContactIds = new Set<number>();
let previousInputId = 0;
for (const shard of shards("contacts-")) {
  const content = fs.readFileSync(path.join(root, shard), "utf8");
  const contacts: unknown[] = JSON.parse(content);
  for (const raw of contacts) {
    const c = decodeContact(raw);
    if (!Number.isSafeInteger(c.contactId) || c.contactId <= previousInputId || seenContactIds.has(c.contactId)) {
      throw new Error(`Duplicate or non-monotonic contact export: ${c.contactId}`);
    }
    previousInputId = c.contactId;
    seenContactIds.add(c.contactId);
    if (c.contactId <= report.cursor) continue;
    if (c.contactId > manifest.watermark) throw new Error("Contact exceeds frozen watermark");
    const candidateIds = new Set<number>();
    const lookup = (map: Map<string, Set<number>>, key: string) => {
      if (key) for (const id of map.get(key) ?? []) candidateIds.add(id);
    };
    lookup(indexes.name, normalizeCoverageName(c.companyName));
    lookup(indexes.domain, domain(c.website));
    const emailDomain = String(c.emailDomain ?? "").trim().toLowerCase();
    if (c.emailHasExactlyOneAt && !sharedEmailDomains.has(emailDomain)) lookup(indexes.domain, emailDomain);
    lookup(indexes.phone, phone(c.phone));
    lookup(indexes.address, address(c.address));
    if (c.address) lookup(indexes.address, address([c.address, c.city, c.state].filter(Boolean).join(" ")));
    if (c.projectedBusinessId != null && businesses.has(c.projectedBusinessId)) candidateIds.add(c.projectedBusinessId);
    if (c.currentDecisionBusinessId != null && businesses.has(c.currentDecisionBusinessId)) candidateIds.add(c.currentDecisionBusinessId);
    const provenance: any = c.rowProvenance;
    if (provenance && typeof provenance === "object") {
      for (const key of filingFields) lookup(indexes.filing, String(provenance[key] ?? "").toLowerCase());
    }
    for (const event of c.sourceEvents) {
      if (event.metadata && typeof event.metadata === "object") {
        for (const key of filingFields) lookup(indexes.filing, String((event.metadata as any)[key] ?? "").toLowerCase());
      }
      if (/filing|sunbiz/i.test(`${event.sourceCategory} ${event.sourceType}`)) {
        lookup(indexes.filing, String(event.sourceExternalId ?? "").toLowerCase());
      }
    }
    c.businesses = [...candidateIds].sort((a, b) => a - b).map(id => businesses.get(id)!);
    const classification = classifyContactLinkCoverage(c);
    report.counts[classification.bucket]++;
    for (const reason of new Set(classification.reasons)) {
      report.reasonCounts[reason] = (report.reasonCounts[reason] ?? 0) + 1;
    }
    report.representativeIds[classification.bucket] ??= [];
    if (report.representativeIds[classification.bucket].length < 25) {
      report.representativeIds[classification.bucket].push({
        contactId: c.contactId,
        businessIds: classification.candidates.map(candidate => candidate.businessId),
        reasons: classification.reasons,
      });
    }
    if (classification.bucket === "STRICT_AUTO_ELIGIBLE" && report.strictCandidates.length < 25) {
      report.strictCandidates.push({ contactId: c.contactId, businessIds: classification.candidates.map(candidate => candidate.businessId) });
    }
    report.processed++;
    report.cursor = c.contactId;
  }
  report.contactShardDigests[shard] = digest(content);
  save();
  console.log(JSON.stringify({ processed: report.processed, cursor: report.cursor, counts: report.counts }));
}
report.complete = report.processed === report.total;
if (report.processed > report.total) throw new Error("Denominator exceeded");
report.businessesIndexed = businesses.size;
report.reasonCountsAreOverlapping = true;
save();
console.log(JSON.stringify({ complete: report.complete, processed: report.processed, total: report.total, counts: report.counts, reportPath }));