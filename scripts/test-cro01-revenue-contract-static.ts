#!/usr/bin/env tsx
/**
 * CRO-01 revenue-read contract.  This is deliberately source-only: it never
 * imports application modules or constructs a provider transport.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const assertions: string[] = [];
function check(condition: unknown, message: string) {
  assertions.push(message);
  assert.ok(condition, message);
}
function includes(file: string, text: string) {
  const body = read(file);
  check(body.includes(text), `${file} must contain ${JSON.stringify(text)}`);
  return body;
}

const schema = read("shared/schema.ts");
const expectedStages = [
  "New Lead", "Enriched", "Statement Received", "Review In Progress",
  "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Promise to Submit",
];
const declaration = schema.match(/OPEN_SALES_LEAD_STAGES\s*=\s*\[([\s\S]*?)\]\s*as const/);
check(Boolean(declaration), "OPEN_SALES_LEAD_STAGES declaration exists");
const actualStages = [...(declaration?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check(actualStages.length === 9, "OPEN_SALES_LEAD_STAGES has exactly nine fixtures");
check(JSON.stringify(actualStages) === JSON.stringify(expectedStages), "OPEN_SALES_LEAD_STAGES is the exact canonical ordered list");
const excluded = ["Closed Won", "Closed Lost", "Disqualified", "Onboarding", "Go-Live"];
for (const stage of excluded) check(!actualStages.includes(stage), `closed/non-lead stage ${stage} is explicitly excluded`);

const routes = read("server/routes/routes-revenue.ts");
check((routes.match(/app\.get\("\/api\/revenue\/leads"/g) ?? []).length === 1, "there is one canonical /api/revenue/leads route");
includes("client/src/pages/dashboard/Leads.tsx", "fetch(`/api/revenue/leads?");
check(!read("client/src/pages/dashboard/Leads.tsx").includes('import ProspectsPage'), "Leads tab is not the legacy Prospects view");
includes("server/routes/routes-revenue.ts", "isDashboardUser");
includes("server/routes/routes-revenue.ts", "parseStrictPagination");

const revenue = read("server/services/revenue-read-authority.ts");
includes("server/services/revenue-read-authority.ts", "export async function readRevenueDeals");
includes("server/services/revenue-read-authority.ts", "c.archived_at IS NULL");
includes("server/services/revenue-read-authority.ts", "c.record_class = 'production'");
includes("server/services/revenue-read-authority.ts", "qualifying_deal.archived_at IS NULL");
includes("server/services/revenue-read-authority.ts", "qualifying_deal.record_class = 'production'");
includes("server/services/revenue-read-authority.ts", "qualifying_deal.pipeline = 'sales'");
includes("server/services/revenue-read-authority.ts", "(SELECT COUNT(*)::int FROM base) AS total");
check(!/SELECT\s+c\.\*\s+FROM contacts c[\s\S]*?(?:LEFT\s+JOIN|JOIN)\s+deals(?![\s\S]*LATERAL)/i.test(revenue), "lead cardinality cannot use an unbounded deal join");
includes("server/services/revenue-read-authority.ts", "ORDER BY primary_updated_at DESC NULLS LAST, primary_id DESC, contact_id DESC");
includes("server/services/revenue-read-authority.ts", 'bucketSemantics: "overlapping"');
includes("server/services/revenue-read-authority.ts", "canonical_lead_contacts");
includes("server/services/revenue-read-authority.ts", "activated_mid_contacts");
includes("server/services/revenue-read-authority.ts", "mm.status='active' AND mm.activated_at IS NOT NULL");

const portfolio = read("server/routes/portfolio.ts");
includes("server/routes/portfolio.ts", "eligible_mid.status = 'active'");
includes("server/routes/portfolio.ts", "eligible_mid.activated_at IS NOT NULL");
includes("server/routes/portfolio.ts", "active_mid_count");
const dealRoute = read("server/routes/deals.ts");
includes("server/routes/deals.ts", 'app.post("/api/prospects/:id/recalculate-volume", isDashboardUser, requireRole("admin", "manager")');
check(dealRoute.includes("const old = await authorizeDealAccess") && dealRoute.includes("if (!old) return;"), "PUT staging is guarded before any mutation");
check(dealRoute.includes("advanceDealStage(dealId, newStage!"), "PUT stage changes use the strict stage authority");
check(!dealRoute.includes("updateDeal(dealId, req.body"), "PUT staging has no raw update passthrough");

const conversion = read("server/services/prospect-conversion.ts");
includes("server/services/prospect-conversion.ts", "return await db.transaction(async (tx)");
includes("server/services/prospect-conversion.ts", "getOrCreateConversionSalesDeal(tx");
check(!conversion.includes("getOrCreateConversionSalesDeal(db"), "conversion authority has no global classifier/DB call");
check(!conversion.includes("Scott Stevenson"), "Scott Stevenson is never a conversion owner");
const storageDeals = read("server/storage/deals.ts");
includes("server/storage/deals.ts", "FOR UPDATE");
includes("server/storage/deals.ts", "deriveLinkedDealClassInTransaction");
check(!storageDeals.includes("assignedTo ||") && !storageDeals.includes("deals[0]"), "conversion has no legacy assignment or any-deal fallback");

includes("scripts/check-cro02-authority.ts", "0166_cro02_shadow_graph.sql");
includes("scripts/check-migration-integrity.ts", "_journal.json");
const docs = existsSync(path.join(root, "docs")) ? readdirSync(path.join(root, "docs"), { recursive: true }).map(String) : [];
const docsText = docs.filter((f) => /\.(md|txt)$/i.test(f)).map((f) => readFileSync(path.join(root, "docs", f), "utf8")).join("\n");
check(docsText.includes("/api/revenue/leads") && docsText.includes("overlapping"), "documentation states the canonical route and overlapping reporting disposition");
check(revenue.includes('bucketSemantics: "overlapping"') && revenue.includes("invalid_unknown_sales_stage"), "reporting disposition declares aggregate-only overlapping buckets");

check(assertions.length > 0, "CRO-01 static suite has non-zero assertions");
console.log(`CRO-01 static revenue contract passed (${assertions.length} assertions; provider-free).`);