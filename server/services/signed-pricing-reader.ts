/**
 * Live reader for signed-pricing.json (task #1956, Step 4).
 *
 * MI-09's provider-selector UI and its server-side gate must never hardcode
 * or restate a provider's price — they read it live from this file, every
 * time, so an updated signed-pricing.json takes effect without a code
 * change or restart. This module does no caching on purpose.
 *
 * signed-pricing.json holds one CRO-03C multi-dimension approval ceremony
 * (operator/data/finance/legal), each dimension carrying its own signed copy
 * of the same `priceSchedules` map. We treat the file as internally
 * consistent only if all four dimensions agree — if they disagree, that is
 * a real integrity problem (a partially re-signed ceremony) and callers
 * must fail closed rather than pick one dimension arbitrarily.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface SignedPriceSchedule {
  version: number;
  unitType: string;
  currency: string;
  amountMicros: number;
  billingSemantics: string;
}

export type SignedPricingSchedules = Record<string, SignedPriceSchedule>;

const SIGNED_PRICING_PATH = join(process.cwd(), "signed-pricing.json");
const DIMENSIONS = ["operator", "data", "finance", "legal"] as const;

export class SignedPricingUnavailableError extends Error {}

/**
 * Reads and returns the current live price schedule map from
 * signed-pricing.json. Throws SignedPricingUnavailableError (never returns a
 * partial/fallback map) if the file is missing, malformed, or the four
 * signed dimensions disagree on price schedules.
 */
export function readSignedProviderPricing(): SignedPricingSchedules {
  if (!existsSync(SIGNED_PRICING_PATH)) {
    throw new SignedPricingUnavailableError("signed-pricing.json not found");
  }
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(SIGNED_PRICING_PATH, "utf-8"));
  } catch (err) {
    throw new SignedPricingUnavailableError(`signed-pricing.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const schedules: SignedPricingSchedules[] = [];
  for (const dim of DIMENSIONS) {
    const ps = parsed?.[dim]?.payload?.scope?.priceSchedules;
    if (!ps || typeof ps !== "object") {
      throw new SignedPricingUnavailableError(`signed-pricing.json missing priceSchedules for dimension "${dim}"`);
    }
    schedules.push(ps);
  }

  const canonical = JSON.stringify(schedules[0]);
  for (let i = 1; i < schedules.length; i++) {
    if (JSON.stringify(schedules[i]) !== canonical) {
      throw new SignedPricingUnavailableError(
        `signed-pricing.json dimensions disagree on price schedules (${DIMENSIONS[0]} vs ${DIMENSIONS[i]}) — partially re-signed ceremony must be resolved before pricing can be trusted`,
      );
    }
  }

  return schedules[0];
}

/** Convenience: live price for one provider, or undefined if not priced. */
export function readSignedProviderPrice(providerKey: string): SignedPriceSchedule | undefined {
  return readSignedProviderPricing()[providerKey];
}
