/**
 * Canonical MI-09 pricing-artifact seed table (task #1940). This is the ONE
 * place the 9 provider pricing rows are defined; both the permanent operator
 * seed command (scripts/seed-mi09-pricing.ts) and the standalone preflight
 * (scripts/preflight-mi09-pricing.ts) import this module so they can never
 * drift on what "correctly seeded" means.
 *
 * Values below are frozen per the task spec's pricing table. Apollo is
 * "credit" (not "result") to match CRO03C_PROVIDER_CONTRACTS.apollo.unitType
 * and what the executor actually settles (response.billing.creditedUnits).
 */
import { CRO03C_PROVIDER_KEYS } from "./contracts";

export interface Mi09PricingSeedRow {
  readonly providerKey: string;
  readonly unitType: string;
  readonly amountMicros: number;
  readonly billingSemantics: string;
  readonly sourceUrl: string | null;
}

export const MI09_PRICING_CAPTURED_BY = "scott@libertybancard.com";
export const MI09_PRICING_ARTIFACT_VERSION = 1;
export const MI09_PRICING_CURRENCY = "USD";
export const MI09_PRICING_ACCOUNT_BALANCE_UNITS: number | null = null;

export const MI09_PRICING_SEED_TABLE: readonly Mi09PricingSeedRow[] = [
  { providerKey: "internal_source", unitType: "none", amountMicros: 0, billingSemantics: "not_billable", sourceUrl: null },
  { providerKey: "first_party_web", unitType: "page", amountMicros: 1, billingSemantics: "per_unit_no_result_free", sourceUrl: "https://www.rfc-editor.org/rfc/rfc9110" },
  { providerKey: "rdap", unitType: "request", amountMicros: 1, billingSemantics: "per_unit_no_result_free", sourceUrl: "https://about.rdap.org/" },
  { providerKey: "jsonld", unitType: "parse", amountMicros: 0, billingSemantics: "not_billable", sourceUrl: "https://www.w3.org/TR/json-ld11/" },
  { providerKey: "serper", unitType: "request", amountMicros: 1000, billingSemantics: "per_unit_no_result_billable", sourceUrl: "https://serper.dev/" },
  { providerKey: "outscraper", unitType: "result", amountMicros: 3000, billingSemantics: "per_unit_no_result_free", sourceUrl: "https://outscraper.com/pricing/" },
  { providerKey: "openai", unitType: "token", amountMicros: 10, billingSemantics: "per_unit_no_result_billable", sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5" },
  { providerKey: "apollo", unitType: "credit", amountMicros: 25000, billingSemantics: "per_unit_no_result_free", sourceUrl: "https://www.apollo.io/pricing" },
  { providerKey: "zerobounce", unitType: "request", amountMicros: 19500, billingSemantics: "per_unit_no_result_billable", sourceUrl: "https://www.zerobounce.net/pricing" },
] as const;

// Self-check: the seed table must cover exactly CRO03C_PROVIDER_KEYS, no more,
// no less — this is the same drift guard pattern used elsewhere in CRO-03C.
{
  const seeded = new Set(MI09_PRICING_SEED_TABLE.map((r) => r.providerKey));
  const canonical = new Set<string>(CRO03C_PROVIDER_KEYS as readonly string[]);
  const missing = [...canonical].filter((p) => !seeded.has(p));
  const extra = [...seeded].filter((p) => !canonical.has(p));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `MI09_PRICING_SEED_TABLE_DRIFT: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    );
  }
}
