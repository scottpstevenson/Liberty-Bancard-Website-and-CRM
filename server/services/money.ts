/** Exact base-10 money helpers for authority paths. Never parseFloat/Number. */
export function parseCurrencyToMinor(value: string | number | null | undefined, scale = 2): bigint {
  if (value === null || value === undefined) throw new Error("MONEY_REQUIRED");
  let raw = String(value).trim();
  if (!raw) throw new Error("MONEY_REQUIRED");
  if (/^\([^()]+\)$/.test(raw)) raw = `-${raw.slice(1, -1)}`;
  raw = raw.replace(/[$,\s]/g, "");
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("MONEY_INVALID_FORMAT");
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > scale) throw new Error("MONEY_SCALE_EXCEEDED");
  const divisor = 10n ** BigInt(scale);
  const minor = BigInt(whole) * divisor + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  return sign === "-" ? -minor : minor;
}

export function minorToCurrency(minor: bigint, scale = 2): string {
  const negative = minor < 0n;
  const value = negative ? -minor : minor;
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Percentage application with one explicit rounding point: half away from zero
 * to currency minor units. Percent accepts up to four decimal places. */
export function applyPercentToMinor(minor: bigint, percent: string | number | null | undefined): bigint {
  const percentScaled = parseCurrencyToMinor(percent, 4);
  const divisor = 1_000_000n; // 100 percent × 10,000 percentage scale
  const product = minor * percentScaled;
  const abs = product < 0n ? -product : product;
  const rounded = (abs + divisor / 2n) / divisor;
  return product < 0n ? -rounded : rounded;
}