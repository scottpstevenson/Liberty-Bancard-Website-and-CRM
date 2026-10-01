/**
 * Provider billing contract for routine SFP operations.
 *
 * `quantity` is an exact base-10 string in the declared `unit`; it is never
 * coerced into integer request/result counters. Missing or conflicting usage
 * stays explicit and zero is represented only by the exact string "0".
 */
export type SfpProviderUsageStatus = "known" | "unknown" | "conflict" | "not_applicable";

/** Stable completion payload accepted by finishSfpProviderOperation. */
export interface SfpExactDecimalUsage {
  workCompleted: number;
  billedCredits: string | null;
  billingStatus: "known" | "unknown" | "conflicting";
  providerReference: string | null;
}

export interface SfpProviderUsageInput {
  status: SfpProviderUsageStatus;
  quantity: string | null;
  unit: string | null;
  providerRequestId?: string | null;
  source?: string | null;
}

export interface SfpProviderUsageSettlement {
  status: SfpProviderUsageStatus;
  quantity: string | null;
  unit: string | null;
  providerRequestId: string | null;
  source: string | null;
}

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function normalizeSfpExactDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  // A JS fractional number may already have lost the provider's exact decimal
  // digits. Exact fractional usage must be supplied as its original string.
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const raw = String(value).trim();
  if (!DECIMAL_PATTERN.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

export function normalizeSfpProviderUsage(value: unknown): SfpProviderUsageSettlement {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SfpProviderUsageInput>
    : {};
  const status = raw.status;
  const requestId = typeof raw.providerRequestId === "string" && raw.providerRequestId.trim()
    ? raw.providerRequestId.trim()
    : null;
  const source = typeof raw.source === "string" && raw.source.trim()
    ? raw.source.trim().slice(0, 120)
    : null;
  if (status !== "known" && status !== "unknown" && status !== "conflict" && status !== "not_applicable") {
    return { status: "unknown", quantity: null, unit: null, providerRequestId: requestId, source };
  }
  if (status !== "known") {
    return { status, quantity: null, unit: null, providerRequestId: requestId, source };
  }
  const quantity = normalizeSfpExactDecimal(raw.quantity);
  const unit = typeof raw.unit === "string" ? raw.unit.trim().toLowerCase() : "";
  if (quantity === null || !/^[a-z][a-z0-9_:-]{0,31}$/.test(unit)) {
    return { status: "conflict", quantity: null, unit: null, providerRequestId: requestId, source };
  }
  return { status: "known", quantity, unit, providerRequestId: requestId, source };
}

/**
 * Converts exact usage to micro-USD only when the reviewed price's declared
 * unit matches. Multiplication is integer-only; fractional micro-USD rounds
 * HALF_UP, the explicit ledger rounding rule.
 */
export function calculateSfpUsageCostMicros(input: {
  usage: SfpProviderUsageSettlement;
  reviewedUnitPriceMicros: number | null;
  reviewedUnitType: string | null;
}): number | null {
  if (input.usage.status !== "known" || input.usage.quantity === null || input.usage.unit === null ||
      input.reviewedUnitPriceMicros === null ||
      !Number.isSafeInteger(input.reviewedUnitPriceMicros) || input.reviewedUnitPriceMicros < 0 ||
      input.reviewedUnitType?.trim().toLowerCase() !== input.usage.unit) {
    return null;
  }
  if (input.usage.quantity === "0" || input.reviewedUnitPriceMicros === 0) return 0;
  const [whole, fraction = ""] = input.usage.quantity.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const quantityScaled = BigInt(whole) * scale + BigInt(fraction || "0");
  const microsProduct = quantityScaled * BigInt(input.reviewedUnitPriceMicros);
  const rounded = (microsProduct + scale / 2n) / scale;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

export function calculateSfpSettlementAccounting(input: {
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  reservedUnits: number;
  settledUnits?: number;
  reviewedUnitPriceMicros: number | null;
  reviewedUnitType?: string | null;
  noResultBillable: boolean | null;
  notDispatched: boolean;
  billingAmbiguous: boolean;
  providerUsage?: SfpProviderUsageSettlement;
}): {
  settledUnits: number;
  settledMicros: number | null;
  settledCostMicros: number | null;
  providerUsage: SfpProviderUsageSettlement;
} {
  // `reservedUnits` and `settledUnits` are provider-specific work units
  // (for example results, contacts, or tokens). Decimal provider credits are
  // deliberately accounted independently and may legitimately exceed this
  // reservation; only work-unit overflow is rejected here.
  if (!Number.isSafeInteger(input.reservedUnits) || input.reservedUnits < 0) {
    throw new Error("SFP_RESERVED_WORK_UNITS_MUST_BE_NONNEGATIVE_INTEGER");
  }
  const workUnits = input.settledUnits ?? input.reservedUnits;
  if (!Number.isSafeInteger(workUnits) || workUnits < 0) {
    throw new Error("SFP_SETTLED_WORK_UNITS_MUST_BE_NONNEGATIVE_INTEGER");
  }
  if (workUnits > input.reservedUnits) {
    throw new Error("SFP_SETTLED_WORK_UNITS_EXCEED_RESERVATION");
  }
  const providerUsage = input.notDispatched
    ? normalizeSfpProviderUsage({ status: "not_applicable" })
    : input.providerUsage ?? normalizeSfpProviderUsage({ status: "unknown" });
  const settledUnits = !input.notDispatched &&
      (input.outcome === "completed" || input.outcome === "no_result" || providerUsage.status === "known")
    ? workUnits
    : 0;
  let settledCostMicros = input.notDispatched
    ? 0
    : calculateSfpUsageCostMicros({
      usage: providerUsage,
      reviewedUnitPriceMicros: input.reviewedUnitPriceMicros,
      reviewedUnitType: input.reviewedUnitType ?? null,
    });
  if (input.outcome === "no_result" && input.noResultBillable === false && providerUsage.status !== "known") {
    settledCostMicros = 0;
  }
  return {
    settledUnits,
    settledMicros: settledCostMicros,
    settledCostMicros,
    providerUsage,
  };
}

export function decimalUsageMatches(
  left: Pick<SfpProviderUsageSettlement, "status" | "quantity" | "unit">,
  right: Pick<SfpProviderUsageSettlement, "status" | "quantity" | "unit">,
): boolean {
  return left.status === "known" && right.status === "known" &&
    left.quantity === right.quantity && left.unit === right.unit;
}