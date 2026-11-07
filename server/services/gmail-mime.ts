/**
 * Raw MIME construction for Gmail sends. Pure: no network, database or clock reads except the explicit `date`.
 *
 * Guarantees (each covered by tests):
 *  - an application-stable RFC 5322 Message-ID header chosen by the caller before provider I/O;
 *  - UTF-8 text and HTML parts with a transfer encoding that is actually applied (quoted-printable for text, base64
 *    for HTML), so equals signs, non-ASCII text and long lines survive;
 *  - header values encoded as RFC 2047 words split on character boundaries, folded within line limits, and refused
 *    when they contain CR or LF so a value can never inject a header;
 *  - a plain-text alternative that keeps link destinations instead of dropping them with the markup;
 *  - List-Unsubscribe and one-click headers only when an https URL (or mailto) is supplied.
 */
import { createHash } from "node:crypto";

export class MimeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MimeError";
  }
}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function assertSafeAddress(value: string, code: string): string {
  const v = value.trim();
  if (!v || /[\r\n\0<>,;"\s]/.test(v) || !ADDRESS.test(v)) throw new MimeError(code);
  return v;
}

function assertNoLineBreaks(value: string, code: string): string {
  if (/[\r\n\0]/.test(value)) throw new MimeError(code);
  return value;
}

/** Accepts `addr@host` or `Display Name <addr@host>`. Returns null when the value is not a safe mailbox. */
export function parseMailbox(value: string): { name?: string; address: string } | null {
  const v = value.trim();
  const angle = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  try {
    if (angle) {
      const name = angle[1].replace(/^"|"$/g, "").trim();
      return { name: name || undefined, address: assertSafeAddress(angle[2], "INVALID_ADDRESS") };
    }
    return { address: assertSafeAddress(v, "INVALID_ADDRESS") };
  } catch {
    return null;
  }
}

// ── Header encoding ──────────────────────────────────────────────────────────

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** RFC 2047 B-encoding, split on UTF-8 character boundaries so every encoded word is at most 75 characters. */
export function encodeHeaderValue(value: string): string {
  assertNoLineBreaks(value, "HEADER_INJECTION");
  if (isPrintableAscii(value) && value.length <= 60) return value;
  const maxBytes = 42; // 42 raw bytes -> 56 base64 chars + 12 chars of =?UTF-8?B?...?= framing = 68 (< 75)
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
    chunk = [];
  };
  for (const char of Array.from(value)) {
    const bytes = Array.from(Buffer.from(char, "utf8"));
    if (chunk.length + bytes.length > maxBytes) flush();
    chunk.push(...bytes);
  }
  flush();
  return words.join("\r\n ");
}

export function formatMailbox(displayName: string | undefined | null, address: string): string {
  const email = assertSafeAddress(address, "INVALID_ADDRESS");
  const name = (displayName ?? "").trim();
  if (!name) return email;
  if (isPrintableAscii(name)) {
    // Specials force an RFC 5322 quoted-string so a display name can never introduce a second address.
    if (!/[()<>[\]:;@\\,."]/.test(name)) return `${name} <${email}>`;
    return `"${name.replace(/[\\"]/g, "\\$&")}" <${email}>`;
  }
  return `${encodeHeaderValue(name)} <${email}>`;
}

// ── Body encoding ────────────────────────────────────────────────────────────

/** RFC 2045 quoted-printable over UTF-8 bytes with CRLF line endings and soft breaks at 75 characters. */
export function encodeQuotedPrintable(text: string): string {
  const normalized = text.replace(/\r\n|\r|\n/g, "\n");
  const lines = normalized.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const bytes = Buffer.from(line, "utf8");
    const tokens: string[] = [];
    bytes.forEach((byte, index) => {
      const isLast = index === bytes.length - 1;
      const isWhitespace = byte === 0x20 || byte === 0x09;
      if ((byte >= 33 && byte <= 126 && byte !== 61) || (isWhitespace && !isLast)) tokens.push(String.fromCharCode(byte));
      else tokens.push(`=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
    });
    let current = "";
    for (const token of tokens) {
      if (current.length + token.length > 75) {
        out.push(`${current}=`);
        current = "";
      }
      current += token;
    }
    out.push(current);
  }
  return out.join("\r\n");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    });
}

/** Plain-text alternative that preserves link destinations as `text (url)`. */
export function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, dq: string | undefined, sq: string | undefined, inner: string) => {
      const href = decodeEntities((dq ?? sq ?? "").trim());
      const label = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (!href || /^(javascript|data):/i.test(href)) return label;
      if (!label || label === href) return href;
      return `${label} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  text = decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

function foldBase64(value: Buffer): string {
  return value.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

// ── Message assembly ─────────────────────────────────────────────────────────

export interface GmailMimeInput {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  /** Optional separately rendered plain text; derived from the HTML (with links) when absent. */
  text?: string;
  replyTo?: string | null;
  /** RFC 5322 Message-ID including angle brackets, created by the application before provider I/O. */
  messageId: string;
  unsubscribeUrl?: string | null;
  unsubscribeMailto?: string | null;
  date?: Date;
}

const MESSAGE_ID = /^<[A-Za-z0-9._~!$&'()*+,;=:@-]+@[A-Za-z0-9.-]+>$/;

export function buildGmailMime(input: GmailMimeInput): { mime: string; raw: string; messageId: string } {
  if (!MESSAGE_ID.test(input.messageId)) throw new MimeError("INVALID_MESSAGE_ID");
  const from = formatMailbox(input.fromName, input.from);
  const to = assertSafeAddress(input.to, "INVALID_RECIPIENT");
  const subject = assertNoLineBreaks(input.subject, "HEADER_INJECTION").trim();
  if (!subject) throw new MimeError("SUBJECT_MISSING");
  if (!input.html.trim()) throw new MimeError("BODY_MISSING");
  const boundary = `lb_${createHash("sha256").update(input.messageId).digest("hex").slice(0, 24)}`;
  const date = (input.date ?? new Date()).toUTCString();

  const headers: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date}`,
    `Message-ID: ${input.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "X-Mailer: Liberty-Bancard-OS/1.0",
  ];
  if (input.replyTo) headers.push(`Reply-To: ${assertSafeAddress(input.replyTo, "INVALID_REPLY_TO")}`);
  const unsub: string[] = [];
  if (input.unsubscribeMailto) unsub.push(`<mailto:${assertSafeAddress(input.unsubscribeMailto, "INVALID_UNSUBSCRIBE_MAILTO")}>`);
  if (input.unsubscribeUrl) {
    assertNoLineBreaks(input.unsubscribeUrl, "HEADER_INJECTION");
    if (!/^https:\/\/[^\s<>]+$/.test(input.unsubscribeUrl)) throw new MimeError("INVALID_UNSUBSCRIBE_URL");
    unsub.push(`<${input.unsubscribeUrl}>`);
  }
  if (unsub.length) {
    headers.push(`List-Unsubscribe: ${unsub.join(", ")}`);
    if (input.unsubscribeUrl) headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }

  const text = (input.text ?? htmlToPlainText(input.html)) || "";
  const body = [
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(input.html, "utf8")),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const mime = `${headers.join("\r\n")}\r\n${body}`;
  return { mime, raw: Buffer.from(mime, "utf8").toString("base64url"), messageId: input.messageId };
}
