/**
 * Contact name quality utilities.
 *
 * These are shared across every send path (sequence worker, campaign engine,
 * daily outreach) and the CSV import pipeline. Centralising here ensures that
 * any improvement to detection logic applies everywhere simultaneously.
 */

/**
 * Patterns that indicate a value is NOT a real person's first name.
 * Evaluated in order; first match wins.
 */
const BAD_NAME_PATTERNS: RegExp[] = [
  /^https?:\/\//i,                        // http:// or https:// URL
  /^www\./i,                               // www.something.com
  /@/,                                     // email address
  /^[\d\s\-\(\)\+\.]{6,}$/,              // phone number (digits, spaces, dashes, parens, dots — 6+ chars)
  /^(n\/a|n\.a\.|na|unknown|none|null|test|placeholder|firstname|first_name|name)$/i,
  /\.(com|net|org|gov|edu|io|co|biz|us|info|uk|au|ca|de|fr|nl|fi)$/i, // domain TLD suffix
];

/**
 * Returns true if the value looks like garbage / not a real person's first name.
 */
export function isBadContactName(raw: string | null | undefined): boolean {
  if (!raw || raw.trim() === "") return true;
  const v = raw.trim();
  if (v.length <= 1) return true;
  return BAD_NAME_PATTERNS.some(re => re.test(v));
}

/**
 * Sanitizes a raw first_name value for use in email send paths.
 *
 * - Returns the trimmed value when it looks like a real name.
 * - Returns "" (empty string) when the value is URL-like, email-like,
 *   a phone number, a placeholder, or otherwise unsendable.
 *
 * Callers should fall back to "there" for email greetings:
 *   const firstName = sanitizeFirstName(raw) || "there";
 */
export function sanitizeFirstName(raw: string | null | undefined): string {
  if (isBadContactName(raw)) return "";
  return (raw as string).trim();
}

/**
 * Returns a display-safe first name for email greetings.
 * Falls back to "there" so the email reads "Hi there," instead of a URL.
 */
export function safeGreetingName(raw: string | null | undefined): string {
  return sanitizeFirstName(raw) || "there";
}
