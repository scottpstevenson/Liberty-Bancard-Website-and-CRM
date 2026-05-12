import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("[document-tokens] SESSION_SECRET is not set. Cannot sign or verify document tokens.");
  }
  return secret;
}

function base64urlEncode(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export interface DocumentTokenPayload {
  documentId: number;
  userId: string;
  exp: number;
}

export function generateDocumentToken(documentId: number, userId: string): string {
  const payload: DocumentTokenPayload = {
    documentId,
    userId,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${sig}`;
}

export function verifyDocumentToken(token: string): DocumentTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid token format");

  const [encodedPayload, sig] = parts;
  const expectedSig = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");

  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("Invalid token signature");
  }

  let payload: DocumentTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload));
  } catch {
    throw new Error("Invalid token payload");
  }

  if (Date.now() > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}
