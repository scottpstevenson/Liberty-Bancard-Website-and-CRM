import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import {
  candidateHash, maskCandidate, normalizeCandidateValue,
  type Cro03CandidateField,
} from "./contracts";

const KEY_VERSION = 1;
const AAD_PREFIX = "cro03-candidate-envelope-v1";

function derivedKey(): Buffer {
  const master = process.env.MERCHANT_DATA_ENCRYPTION_KEY;
  if (!master) throw new Error("CRO03_CANDIDATE_KEY_UNAVAILABLE");
  return createHash("sha256").update(`${AAD_PREFIX}\0${master}`).digest();
}

export interface CandidateEnvelope {
  normalizedValueHash: string;
  maskedValue: string;
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
}

export function sealCandidate(input: {
  field: Cro03CandidateField;
  value: string;
  subjectId: number;
  subjectGeneration?: number | null;
}): CandidateEnvelope {
  const normalized = normalizeCandidateValue(input.field, input.value);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), nonce);
  const aad = `${AAD_PREFIX}:${input.subjectId}:${input.field}:${input.subjectGeneration ?? "none"}`;
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return {
    normalizedValueHash: candidateHash(input.field, normalized),
    maskedValue: maskCandidate(input.field, normalized),
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function openCandidate(input: {
  field: Cro03CandidateField;
  subjectId: number;
  subjectGeneration?: number | null;
  envelope: CandidateEnvelope;
}): string {
  if (input.envelope.keyVersion !== KEY_VERSION) throw new Error("CRO03_CANDIDATE_KEY_VERSION_UNSUPPORTED");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(input.envelope.nonce, "base64"));
  const aad = `${AAD_PREFIX}:${input.subjectId}:${input.field}:${input.subjectGeneration ?? "none"}`;
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(input.envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
