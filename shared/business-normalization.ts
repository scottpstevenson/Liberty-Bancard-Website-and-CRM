/** Pure provider identity normalization; shared with the database-backed dedupe owner. */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    let domain = url.toLowerCase().trim();
    domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0];
    if (!domain || domain.length < 3) return null;
    return domain;
  } catch {
    return null;
  }
}

export function normalizePhoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

