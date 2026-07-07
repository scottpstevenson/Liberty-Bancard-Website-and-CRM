import crypto from "crypto";

const HMAC_HEX_RE = /^[a-f0-9]{64}$/;

export function getUnsubscribeTokenSecret(): string {
  const testMode = process.env.TEST_MODE === "true";

  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (secret) return secret;

  if (testMode) {
    return "test-only-unsubscribe-secret-do-not-use-in-production";
  }

  throw new Error(
    "Cold email send blocked: UNSUBSCRIBE_TOKEN_SECRET (or SESSION_SECRET) must be set in production. " +
    "Set UNSUBSCRIBE_TOKEN_SECRET to a strong random string."
  );
}

export function generateUnsubscribeToken(contactId: number): string {
  const secret = getUnsubscribeTokenSecret();
  const hmac = crypto.createHmac("sha256", secret)
    .update(`email_unsubscribe:${contactId}`)
    .digest("hex");
  return `${contactId}.${hmac}`;
}

export function verifyUnsubscribeToken(token: string): { valid: true; contactId: number } | { valid: false } {
  try {
    if (!token || typeof token !== "string") return { valid: false };

    const segments = token.split(".");

    if (segments.length !== 2) return { valid: false };

    const [idPart, suppliedHmac] = segments;

    if (!idPart || !suppliedHmac) return { valid: false };

    if (!HMAC_HEX_RE.test(suppliedHmac)) return { valid: false };

    const contactId = parseInt(idPart, 10);
    if (isNaN(contactId) || contactId <= 0 || String(contactId) !== idPart) {
      return { valid: false };
    }

    let secret: string;
    try {
      secret = getUnsubscribeTokenSecret();
    } catch {
      return { valid: false };
    }

    const expectedHmac = crypto.createHmac("sha256", secret)
      .update(`email_unsubscribe:${contactId}`)
      .digest("hex");

    const suppliedBuf = Buffer.from(suppliedHmac, "hex");
    const expectedBuf = Buffer.from(expectedHmac, "hex");

    if (suppliedBuf.length !== expectedBuf.length) return { valid: false };

    if (!crypto.timingSafeEqual(suppliedBuf, expectedBuf)) return { valid: false };

    return { valid: true, contactId };
  } catch {
    return { valid: false };
  }
}
