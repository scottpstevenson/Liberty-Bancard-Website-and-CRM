/**
 * Credential Encryption — AES-256-GCM authenticated encryption for sensitive
 * credentials stored in system_settings (e.g. Gmail OAuth refresh token).
 *
 * Required secret:
 *   CREDENTIAL_ENCRYPTION_KEY — 64 hex chars (32 bytes) OR 44 base64 chars (32 bytes).
 *   Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Storage format:  enc_v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 * - iv: 12 bytes (96-bit) — GCM best practice
 * - authTag: 16 bytes (128-bit) — GCM default
 * - ciphertext: variable
 *
 * The version prefix (enc_v1) allows safe algorithm migration in future.
 * Plain strings (no enc_v1 prefix) are treated as legacy unencrypted tokens
 * during a migration window; a warning is logged and the plain value returned
 * so the next write will encrypt it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION_PREFIX = "enc_v1:";
const ALGO           = "aes-256-gcm";
const KEY_GATE_NAME  = "CREDENTIAL_ENCRYPTION_KEY";

// ── Key resolution ─────────────────────────────────────────────────────────────

function resolveKeyBuffer(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const fromB64 = Buffer.from(trimmed, "base64");
  if (fromB64.length === 32) return fromB64;
  console.error(
    `[CredentialEncryption] ${KEY_GATE_NAME} is set but is not a valid 32-byte key ` +
    `(64-char hex or 44-char base64).  Token storage is BLOCKED until this is corrected.`,
  );
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** True only when a valid encryption key is present. */
export function isEncryptionAvailable(): boolean {
  return resolveKeyBuffer() !== null;
}

/**
 * Encrypt plaintext into `enc_v1:<iv_b64>:<tag_b64>:<ct_b64>`.
 * Throws if CREDENTIAL_ENCRYPTION_KEY is missing or malformed.
 */
export function encryptCredential(plaintext: string): string {
  const key = resolveKeyBuffer();
  if (!key) {
    throw new Error(
      `${KEY_GATE_NAME} is not set or invalid — cannot store sensitive credential. ` +
      `Add a 64-hex-char key to Replit Secrets and restart the server.`,
    );
  }
  const iv     = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${VERSION_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a value encrypted by encryptCredential().
 * Returns null if the key is missing.
 * Returns the raw value unchanged (with a warning) if it has no enc_v1 prefix
 * (legacy plaintext migration window — caller should re-encrypt on next write).
 * Throws only on decryption authentication failures (tampered ciphertext).
 */
export function decryptCredential(stored: string): string | null {
  if (!stored) return null;

  if (!stored.startsWith(VERSION_PREFIX)) {
    console.warn(
      "[CredentialEncryption] Found unencrypted legacy token in system_settings. " +
      "It will be used this time; the next write will encrypt it. " +
      "Ensure CREDENTIAL_ENCRYPTION_KEY is set.",
    );
    return stored;
  }

  const key = resolveKeyBuffer();
  if (!key) {
    console.error(
      `[CredentialEncryption] ${KEY_GATE_NAME} is missing — cannot decrypt credential. ` +
      `Returning null (channel will appear disconnected until key is restored).`,
    );
    return null;
  }

  const parts = stored.slice(VERSION_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("[CredentialEncryption] Malformed stored credential (expected 3 colon-separated parts after version prefix)");
  }

  try {
    const iv      = Buffer.from(parts[0], "base64");
    const tag     = Buffer.from(parts[1], "base64");
    const ct      = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString("utf8") + decipher.final("utf8");
  } catch (err: any) {
    throw new Error(`[CredentialEncryption] Decryption failed (possible key mismatch or tampered ciphertext): ${err.message}`);
  }
}

/**
 * Describe the encryption key status for readiness dashboards.
 * Never returns the key value.
 */
export function getEncryptionStatus(): {
  available: boolean;
  gate: string;
  detail: string;
} {
  const key = resolveKeyBuffer();
  if (!key) {
    const isSet = !!process.env.CREDENTIAL_ENCRYPTION_KEY;
    return {
      available: false,
      gate: KEY_GATE_NAME,
      detail: isSet
        ? `${KEY_GATE_NAME} is set but is not a valid 32-byte key (must be 64 hex chars or 44 base64 chars).`
        : `${KEY_GATE_NAME} is not set. Sensitive credentials (Gmail refresh token) cannot be stored or decrypted.`,
    };
  }
  return {
    available: true,
    gate: KEY_GATE_NAME,
    detail: "Encryption key is present and valid (32 bytes).",
  };
}
