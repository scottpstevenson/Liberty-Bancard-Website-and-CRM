/**
 * Gmail OAuth2 integration for staff and department email.
 *
 * Architecture:
 *   - Admin completes one-time OAuth2 flow at /dashboard/outbound-readiness
 *   - Refresh token stored in system_settings (never in env or logs)
 *   - Access tokens auto-refreshed on every send by the googleapis client
 *   - All From addresses are validated against sender-policy before sending
 *   - Google Workspace send-as aliases (onboarding@, security@, etc.) are
 *     resolved from the authenticated account's Gmail send-as settings
 *
 * Secret names required (Replit Secrets — values never logged):
 *   GOOGLE_CLIENT_ID        — OAuth2 client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET    — OAuth2 client secret
 *   GOOGLE_REDIRECT_URI     — (optional) Override; default is APP_URL + /api/admin/gmail-oauth/callback
 */

import crypto from "crypto";
import { google } from "googleapis";
import { storage } from "../storage";
import { resolvePolicy, assertNotProhibitedSync } from "./sender-policy";
import type { MessageCategory } from "./sender-policy";
import { renderEmailHtmlForPurpose } from "./can-spam-footer";
import { buildGmailMime, parseMailbox, MimeError } from "./gmail-mime";
import { classifyGmailFailure, type TransportOutcome } from "./website-email-contracts";
import { redactToken } from "./audit-sanitizer";
import {
  encryptCredential,
  decryptCredential,
  isEncryptionAvailable,
  getEncryptionStatus,
} from "./credential-encryption";

// ── Constants ────────────────────────────────────────────────────────────────

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

const SK_REFRESH_TOKEN  = "gmail_oauth_refresh_token";
const SK_EMAIL          = "gmail_oauth_email";
const SK_CONNECTED_AT   = "gmail_oauth_connected_at";
const SK_ALIASES        = "gmail_oauth_send_as_aliases";

// ── Client factory ────────────────────────────────────────────────────────────

function buildRedirectUri(explicitUri?: string): string {
  if (explicitUri) return explicitUri;
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const appUrl = process.env.APP_URL || "http://localhost:5000";
  return `${appUrl}/api/admin/gmail-oauth/callback`;
}

function getOAuth2Client(redirectUri?: string) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, buildRedirectUri(redirectUri));
}

// ── Status helpers ────────────────────────────────────────────────────────────

/** Returns true only if both OAuth secrets are present in the environment. */
export function isGmailOAuthSecretsPresent(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Returns true if a refresh token is stored AND OAuth secrets AND encryption key are present.
 * The token may be encrypted; we verify decryptability here.
 */
export async function isGmailOAuthConnected(): Promise<boolean> {
  if (!isGmailOAuthSecretsPresent()) return false;
  if (!isEncryptionAvailable()) return false;
  const stored = await storage.getSystemSetting(SK_REFRESH_TOKEN) as string | null | undefined;
  if (!stored) return false;
  try {
    const token = decryptCredential(stored as string);
    return !!token;
  } catch {
    return false;
  }
}

/**
 * Read and decrypt the stored refresh token.
 * Returns null if not set, encryption unavailable, or decryption fails.
 */
async function readRefreshToken(): Promise<string | null> {
  const stored = await storage.getSystemSetting(SK_REFRESH_TOKEN) as string | null | undefined;
  if (!stored) return null;
  try {
    return decryptCredential(stored as string);
  } catch (err: any) {
    console.error("[Gmail OAuth] Refresh token decryption failed:", err.message);
    return null;
  }
}

export async function getGmailOAuthStatus(): Promise<{
  secretsPresent: boolean;
  encryptionAvailable: boolean;
  encryptionDetail: string;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  aliases: string[];
  acceptedAliases: string[];
  scopes: string[];
}> {
  const secretsPresent    = isGmailOAuthSecretsPresent();
  const encStatus         = getEncryptionStatus();
  const [storedToken, email, connectedAt, aliasesRaw] = await Promise.all([
    storage.getSystemSetting(SK_REFRESH_TOKEN) as Promise<string | null | undefined>,
    storage.getSystemSetting(SK_EMAIL) as Promise<string | null | undefined>,
    storage.getSystemSetting(SK_CONNECTED_AT) as Promise<string | null | undefined>,
    storage.getSystemSetting(SK_ALIASES) as Promise<string[] | null | undefined>,
  ]);

  let tokenDecryptable = false;
  if (storedToken) {
    try {
      const plain = decryptCredential(storedToken as string);
      tokenDecryptable = !!plain;
    } catch { tokenDecryptable = false; }
  }

  const aliases: string[] = Array.isArray(aliasesRaw) ? aliasesRaw as unknown as string[] : [];
  const acceptedAliases   = aliases;

  return {
    secretsPresent,
    encryptionAvailable: encStatus.available,
    encryptionDetail:    encStatus.detail,
    connected: secretsPresent && encStatus.available && tokenDecryptable,
    email: (email as unknown as string) || null,
    connectedAt: (connectedAt as unknown as string) || null,
    aliases,
    acceptedAliases,
    scopes: GMAIL_SCOPES,
  };
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

export function getGmailAuthorizationUrl(redirectUri?: string): string | null {
  const client = getOAuth2Client(redirectUri);
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri?: string,
): Promise<{ success: boolean; email?: string; error?: string }> {
  const client = getOAuth2Client(redirectUri);
  if (!client) return { success: false, error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" };

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return {
        success: false,
        error: "No refresh token returned — ensure access_type=offline and prompt=consent on the auth URL",
      };
    }

    // Encryption gate: refuse to store plaintext refresh token
    if (!isEncryptionAvailable()) {
      return {
        success: false,
        error: "CREDENTIAL_ENCRYPTION_KEY is not set — cannot store OAuth refresh token securely. " +
               "Add CREDENTIAL_ENCRYPTION_KEY to Replit Secrets and restart the server before completing the OAuth flow.",
      };
    }

    client.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: "v2", auth: client });
    const userInfo  = await oauth2Api.userinfo.get();
    const email     = userInfo.data.email || null;

    let aliases: string[] = [];
    try {
      const gmail = google.gmail({ version: "v1", auth: client });
      const sendAsResp = await gmail.users.settings.sendAs.list({ userId: "me" });
      aliases = (sendAsResp.data.sendAs || [])
        .filter(a => a.isDefault || a.isPrimary || a.verificationStatus === "accepted")
        .map(a => a.sendAsEmail || "")
        .filter(Boolean);
    } catch (aliasErr: any) {
      console.warn("[Gmail OAuth] Could not fetch send-as aliases:", aliasErr.message);
    }

    // Encrypt refresh token before storing
    const encryptedToken = encryptCredential(tokens.refresh_token);
    await storage.setSystemSetting(SK_REFRESH_TOKEN, encryptedToken);
    await storage.setSystemSetting(SK_EMAIL, email);
    await storage.setSystemSetting(SK_CONNECTED_AT, new Date().toISOString());
    await storage.setSystemSetting(SK_ALIASES, aliases);

    console.log(`[Gmail OAuth] ✓ Connected: ${email}, aliases: ${aliases.join(", ")} (token encrypted at rest)`);
    return { success: true, email: email || undefined };
  } catch (err: any) {
    const msg = err?.response?.data?.error_description || err.message || String(err);
    console.error("[Gmail OAuth] Token exchange failed:", msg);
    return { success: false, error: msg };
  }
}

export async function revokeGmailAccess(): Promise<void> {
  try {
    const refreshToken = await readRefreshToken();
    if (refreshToken) {
      const client = getOAuth2Client();
      if (client) {
        client.setCredentials({ refresh_token: refreshToken });
        await client.revokeCredentials().catch(() => {});
      }
    }
  } finally {
    await Promise.all([
      storage.setSystemSetting(SK_REFRESH_TOKEN, null),
      storage.setSystemSetting(SK_EMAIL, null),
      storage.setSystemSetting(SK_CONNECTED_AT, null),
      storage.setSystemSetting(SK_ALIASES, null),
    ]);
    console.log("[Gmail OAuth] Access revoked and tokens cleared.");
  }
}

export async function refreshSendAsAliases(): Promise<string[]> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) return [];
  const client = getOAuth2Client();
  if (!client) return [];
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const resp  = await gmail.users.settings.sendAs.list({ userId: "me" });
    const aliases = (resp.data.sendAs || [])
      .filter(a => a.isDefault || a.isPrimary || a.verificationStatus === "accepted")
      .map(a => a.sendAsEmail || "")
      .filter(Boolean);
    await storage.setSystemSetting(SK_ALIASES, aliases);
    return aliases;
  } catch (err: any) {
    console.warn("[Gmail OAuth] refreshSendAsAliases failed:", err.message);
    return [];
  }
}

// ── Live connection probe ─────────────────────────────────────────────────────

export async function verifyGmailConnection(): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  if (!isGmailOAuthSecretsPresent()) {
    return { success: false, error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in Replit Secrets" };
  }
  if (!isEncryptionAvailable()) {
    return { success: false, error: "CREDENTIAL_ENCRYPTION_KEY not set — token cannot be decrypted" };
  }
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    return { success: false, error: "Not connected — complete the OAuth flow at /dashboard/outbound-readiness" };
  }
  const client = getOAuth2Client();
  if (!client) return { success: false, error: "OAuth client init failed" };
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const oauth2Api = google.oauth2({ version: "v2", auth: client });
    const userInfo  = await oauth2Api.userinfo.get();
    return { success: true, email: userInfo.data.email || undefined };
  } catch (err: any) {
    const msg = err?.response?.data?.error_description || err.message || String(err);
    return { success: false, error: msg };
  }
}

// ── Sender evidence (settings only; no network call) ───────────────────────────

/** Connected account and the send-as aliases Google already accepted, read from stored settings only. */
export async function readGmailSenderEvidence(): Promise<{ account: string | null; aliases: string[] }> {
  const [email, aliasesRaw] = await Promise.all([
    storage.getSystemSetting(SK_EMAIL) as Promise<string | null | undefined>,
    storage.getSystemSetting(SK_ALIASES) as Promise<string[] | null | undefined>,
  ]);
  const aliases = Array.isArray(aliasesRaw) ? (aliasesRaw as unknown as string[]).map((a) => String(a).toLowerCase()) : [];
  return { account: email ? String(email).toLowerCase() : null, aliases };
}

// ── Mailbox reader client (read-only) ─────────────────────────────────────────

export type GmailReaderClientResult =
  | { ok: true; gmail: ReturnType<typeof google.gmail>; account: string }
  | { ok: false; code: "GMAIL_OAUTH_NOT_CONFIGURED" | "ENCRYPTION_UNAVAILABLE" | "GMAIL_NOT_CONNECTED" | "OAUTH_CLIENT_INIT_FAILED" };

/**
 * Gmail API client for the mailbox reader only. It makes no network call by itself and sends nothing; the caller
 * decides which read-only endpoints to use. Returns a typed refusal instead of throwing when the connection is absent.
 */
export async function getGmailReaderClient(): Promise<GmailReaderClientResult> {
  if (!isGmailOAuthSecretsPresent()) return { ok: false, code: "GMAIL_OAUTH_NOT_CONFIGURED" };
  if (!isEncryptionAvailable()) return { ok: false, code: "ENCRYPTION_UNAVAILABLE" };
  const refreshToken = await readRefreshToken();
  const evidence = await readGmailSenderEvidence();
  if (!refreshToken || !evidence.account) return { ok: false, code: "GMAIL_NOT_CONNECTED" };
  const client = getOAuth2Client();
  if (!client) return { ok: false, code: "OAUTH_CLIENT_INIT_FAILED" };
  client.setCredentials({ refresh_token: refreshToken });
  return { ok: true, gmail: google.gmail({ version: "v1", auth: client }), account: evidence.account };
}

// ── Send function ─────────────────────────────────────────────────────────────

export type GmailSendFailureCode =
  | "COMPLIANCE_CONFIGURATION_UNAVAILABLE"
  | "GMAIL_OAUTH_NOT_CONFIGURED"
  | "ENCRYPTION_UNAVAILABLE"
  | "GMAIL_NOT_CONNECTED"
  | "OAUTH_CLIENT_INIT_FAILED"
  | "NO_FROM_ADDRESS"
  | "SENDER_POLICY_UNAVAILABLE"
  | "SENDER_ALIAS_NOT_ACCEPTED"
  | "PROHIBITED_SENDER"
  | "OUTBOUND_PAUSED"
  | "PAUSE_GATE_ERROR"
  | "MIME_INVALID"
  | "GMAIL_REJECTED"
  | "GMAIL_TRANSPORT_UNCERTAIN";

export interface GmailSendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  /**
   * accepted: Gmail accepted the message (delivery is NOT confirmed).
   * unsent: proved not accepted (refused before any request left this process, or a definite 4xx rejection).
   * uncertain: a request may have been dispatched (network error, timeout, 5xx, no status): never resend blindly.
   */
  outcome: TransportOutcome;
  failureCode?: GmailSendFailureCode;
  rfcMessageId?: string;
  fromAddress?: string;
  replyTo?: string;
  account?: string | null;
}

function refused(code: GmailSendFailureCode, error: string, extra: Partial<GmailSendResult> = {}): GmailSendResult {
  return { success: false, error, outcome: "unsent", failureCode: code, ...extra };
}

export async function sendGmailEmail(params: {
  to: string;
  subject: string;
  html: string;
  /** Preferred: supply message category; From/Reply-To resolved from sender policy. */
  category?: MessageCategory;
  /** Only used when category is absent. */
  from?: string;
  replyTo?: string;
  unsubscribeUrl?: string;
  unsubscribeMailto?: string;
  /**
   * DB contact ID used to generate a signed CAN-SPAM unsubscribe token.
   * When provided, the injected footer contains a functional /unsubscribe?t=… link.
   * When absent, a reply-to-unsubscribe instruction is used instead.
   */
  contactId?: number;
  /** Defaults to marketing for legacy Gmail outreach callers. */
  commercialPurpose?: "marketing_outreach" | "transactional_response";
  /** Application-created RFC 5322 Message-ID (with angle brackets), bound before provider I/O. A random one is made when absent. */
  rfcMessageId?: string;
  /** Require the resolved From to be the connected account or an alias Google already accepted. */
  requireAcceptedAlias?: boolean;
}): Promise<GmailSendResult> {
  const purpose = params.commercialPurpose ?? "marketing_outreach";
  let renderedHtml: string;
  try {
    renderedHtml = await renderEmailHtmlForPurpose({
      html: params.html,
      purpose,
      contactId: params.contactId,
    });
  } catch (error: any) {
    return refused("COMPLIANCE_CONFIGURATION_UNAVAILABLE", error.message ?? "COMPLIANCE_CONFIGURATION_UNAVAILABLE");
  }
  if (!isGmailOAuthSecretsPresent()) {
    return refused("GMAIL_OAUTH_NOT_CONFIGURED", "Gmail OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing)");
  }
  if (!isEncryptionAvailable()) {
    return refused("ENCRYPTION_UNAVAILABLE", "CREDENTIAL_ENCRYPTION_KEY not set — Gmail refresh token cannot be decrypted. Set the key in Replit Secrets and restart.");
  }
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    return refused("GMAIL_NOT_CONNECTED", "Gmail not connected — complete OAuth flow at /dashboard/outbound-readiness");
  }
  const client = getOAuth2Client();
  if (!client) return refused("OAUTH_CLIENT_INIT_FAILED", "OAuth client init failed");
  client.setCredentials({ refresh_token: refreshToken });

  const evidence = await readGmailSenderEvidence();
  let fromAddress:  string;
  let fromName:     string | undefined;
  let replyToAddr:  string | undefined = params.replyTo;

  if (params.category) {
    try {
      const policy = resolvePolicy(params.category);
      fromAddress  = policy.from;
      fromName     = policy.displayName;
      replyToAddr  = policy.replyTo ?? replyToAddr;
    } catch (policyErr: any) {
      return refused("SENDER_POLICY_UNAVAILABLE", policyErr?.message ?? "Sender policy unavailable", { account: evidence.account });
    }
  } else {
    fromAddress = params.from || evidence.account || "";
    if (!fromAddress) {
      return refused("NO_FROM_ADDRESS", "No from address — supply category or from param");
    }
  }
  const parsedFrom = parseMailbox(fromAddress);
  if (parsedFrom) {
    fromAddress = parsedFrom.address;
    fromName = parsedFrom.name ?? fromName;
  }

  if (params.requireAcceptedAlias) {
    const accepted = evidence.account !== null && (fromAddress.toLowerCase() === evidence.account || evidence.aliases.includes(fromAddress.toLowerCase()));
    if (!accepted) {
      return refused("SENDER_ALIAS_NOT_ACCEPTED", "From address is neither the connected Gmail account nor an accepted send-as alias", { fromAddress, account: evidence.account });
    }
  }

  try {
    assertNotProhibitedSync(fromAddress, `Gmail sendGmailEmail From (subject="${params.subject}")`);
    if (replyToAddr) assertNotProhibitedSync(replyToAddr, `Gmail sendGmailEmail Reply-To`);
  } catch (prohibitErr: any) {
    return refused("PROHIBITED_SENDER", prohibitErr.message, { fromAddress, account: evidence.account });
  }

  const rfcMessageId = params.rfcMessageId ?? `<lb.${crypto.randomUUID().replace(/-/g, "")}@libertybancard.com>`;
  const identity = { rfcMessageId, fromAddress, replyTo: replyToAddr, account: evidence.account };

  let raw: string;
  try {
    raw = buildGmailMime({
      from: fromAddress,
      fromName,
      to: params.to,
      subject: params.subject,
      html: renderedHtml,
      replyTo: replyToAddr,
      messageId: rfcMessageId,
      unsubscribeUrl: params.unsubscribeUrl,
      unsubscribeMailto: params.unsubscribeMailto,
    }).raw;
  } catch (mimeErr: any) {
    const code = mimeErr instanceof MimeError ? mimeErr.code : "MIME_INVALID";
    return refused("MIME_INVALID", `MIME rejected before send: ${code}`, identity);
  }

  // ── Unavoidable pause authority gate (transport boundary) ──────────────────
  // Required ordering: authorize → await registerInflight → recheckEpoch → I/O
  let _pauseInflightToken: string | undefined;
  let _pauseEpoch: bigint | undefined;
  try {
    const { authorize, recheckEpoch } = await import("./outbound-pause-authority");
    const { registerInflight, deregisterInflight } = await import("./outbound-control-service");
    const decision = await authorize({});
    if (!decision.allowed) {
      // C-16 (#1626): redact recipient in operational logs
      console.warn(`[Gmail OAuth] Blocked by pause authority: ${decision.reasonCode} (to=${redactToken(params.to)})`);
      return refused("OUTBOUND_PAUSED", `Outbound paused: ${decision.reasonCode}`, identity);
    }
    const tokenId = crypto.randomUUID();
    await registerInflight(tokenId, decision.epoch);
    _pauseInflightToken = tokenId;
    _pauseEpoch = decision.epoch;
    const epochOk = await recheckEpoch(decision.epoch);
    if (!epochOk) {
      deregisterInflight(tokenId);
      _pauseInflightToken = undefined;
      return refused("OUTBOUND_PAUSED", "Outbound paused: epoch changed before Gmail send", identity);
    }
    // Token held through the gmail.users.messages.send call below
  } catch (gateErr: any) {
    if (_pauseInflightToken) {
      const { deregisterInflight } = await import("./outbound-control-service");
      deregisterInflight(_pauseInflightToken);
    }
    console.error(`[Gmail OAuth] Pause authority gate error — fail closed: ${gateErr.message}`);
    return refused("PAUSE_GATE_ERROR", `Pause gate error: ${gateErr.message}`, identity);
  }

  try {
    const gmail = google.gmail({ version: "v1", auth: client });

    // Final epoch recheck immediately before network I/O (post-registration)
    const { recheckEpochFromDB } = await import("./outbound-pause-authority");
    const stillOk = await recheckEpochFromDB(_pauseEpoch!);
    if (!stillOk) {
      return refused("OUTBOUND_PAUSED", "Outbound paused: epoch invalidated immediately before Gmail send", identity);
    }

    const resp = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    const messageId = resp.data.id    || undefined;
    const threadId  = resp.data.threadId || undefined;
    console.log(`[Gmail OAuth] Email accepted for ${redactToken(params.to)} from ${fromAddress} — messageId: ${messageId}`);
    return { success: true, messageId, threadId, outcome: "accepted", ...identity };
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err.message || String(err);
    console.error(`[Gmail OAuth] Failed to send to ${redactToken(params.to)}:`, msg);
    const outcome = classifyGmailFailure(err);
    return {
      success: false,
      error: msg,
      outcome,
      failureCode: outcome === "unsent" ? "GMAIL_REJECTED" : "GMAIL_TRANSPORT_UNCERTAIN",
      ...identity,
    };
  } finally {
    if (_pauseInflightToken) {
      const { deregisterInflight } = await import("./outbound-control-service");
      deregisterInflight(_pauseInflightToken);
    }
  }
}
