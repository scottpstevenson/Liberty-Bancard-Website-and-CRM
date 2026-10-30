/**
 * Provider costs arrive as integer micro-dollars (1,000,000 micros = 1 USD).
 *
 * - null / undefined / empty  -> "Unpriced"   (no price was recorded; never $0.00)
 * - 0                          -> "$0.00"      (a recorded zero cost)
 * - non-finite or non-numeric  -> "Unavailable" (never a guessed number)
 */
export function usdFromMicros(micros: number | string | bigint | null | undefined): string {
  if (micros === null || micros === undefined || micros === "") return "Unpriced";
  const value = typeof micros === "bigint" ? Number(micros) : typeof micros === "number" ? micros : Number(micros);
  if (!Number.isFinite(value)) return "Unavailable";
  const dollars = value / 1_000_000;
  // Sub-cent per-lookup prices keep four decimals so they are not rounded to $0.00.
  const digits = dollars !== 0 && Math.abs(dollars) < 0.01 ? 4 : 2;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
