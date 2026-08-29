/**
 * CR-06 recipient renderer.
 *
 * This module is deliberately pure: it receives already-resolved, reviewed
 * inputs and returns deterministic mail parts. It does not resolve sender
 * policy, create unsubscribe tokens, read configuration, or contact a provider.
 */
import { createHash } from "node:crypto";

export type Cr06Purpose = "commercial_outreach" | "transactional_response";

/** A fallback may only be used after a human has explicitly reviewed it. */
export type Cr06Text = string | Readonly<{ fallback: string; reviewed: true }>;

export interface Cr06EvidenceInput {
  readonly label: Cr06Text;
  readonly detail: Cr06Text;
  /** Optional supporting link; only HTTP(S) links are accepted. */
  readonly sourceUrl?: string;
}

export interface Cr06ContentInput {
  readonly subject: Cr06Text;
  readonly greeting: Cr06Text;
  /** Plain-text paragraphs, rendered as text rather than trusted HTML. */
  readonly paragraphs: readonly Cr06Text[];
  readonly evidence?: readonly Cr06EvidenceInput[];
  readonly callToAction?: Readonly<{ label: Cr06Text; url: string }>;
}

export interface Cr06SenderInput {
  readonly displayName: Cr06Text;
  readonly email: string;
  /** Rendered exactly once after the recipient content. */
  readonly signature: Cr06Text;
}

export interface Cr06ComplianceInput {
  /** Required for commercial outreach. */
  readonly mailingAddress?: Cr06Text;
  /**
   * A pre-resolved opt-out URL or reviewed reply instruction. Token generation
   * belongs outside this renderer.
   */
  readonly unsubscribe?: Readonly<
    | { url: string; instruction?: never }
    | { url?: never; instruction: Cr06Text }
  >;
}

export interface Cr06RenderInput {
  readonly rendererVersion: string;
  readonly purpose: Cr06Purpose;
  readonly content: Cr06ContentInput;
  readonly sender: Cr06SenderInput;
  readonly compliance?: Cr06ComplianceInput;
}

export interface Cr06RenderedRecipient {
  readonly rendererVersion: string;
  readonly purpose: Cr06Purpose;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly textSha256: string;
  readonly htmlSha256: string;
  /** Stable digest of the subject plus MIME-equivalent text and HTML parts. */
  readonly mimeSha256: string;
  /** Stable digest of the complete renderer result, suitable for audit records. */
  readonly renderSha256: string;
}

const SIGNATURE_MARKER = "[CR-06-SIGNATURE]";
const FOOTER_MARKER = "[CR-06-COMPLIANCE]";
const UNRESOLVED_TOKEN = /{{[\s\S]*?}}|{%[\s\S]*?%}|<%=[\s\S]*?%>|\$\{[\s\S]*?\}|\[\[[\s\S]*?\]\]/;
const PROHIBITED_CLAIM = /\b(?:guarantee(?:d)?|lowest rates?|save\s+\d|savings of|reduce (?:your )?fees? by|risk[- ]free)\b/i;

function assertSafeContent(value: string, field: string): void {
  if (UNRESOLVED_TOKEN.test(value)) throw new Error(`CR06_UNRESOLVED_TOKEN:${field}`);
  if (PROHIBITED_CLAIM.test(value)) throw new Error(`CR06_PROHIBITED_CLAIM:${field}`);
}

/** Resolve a direct value or an explicitly reviewed fallback; fail closed otherwise. */
function resolveText(value: Cr06Text | undefined, field: string): string {
  const resolved = typeof value === "string"
    ? value
    : value && value.reviewed === true
      ? value.fallback
      : "";
  const normalized = resolved.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error(`CR06_REQUIRED_FIELD_UNRESOLVED:${field}`);
  if (normalized.includes(SIGNATURE_MARKER) || normalized.includes(FOOTER_MARKER)) {
    throw new Error(`CR06_RESERVED_MARKER_IN_CONTENT:${field}`);
  }
  assertSafeContent(normalized, field);
  return normalized;
}

function resolveSubject(value: Cr06Text): string {
  const subject = resolveText(value, "content.subject").replace(/\n/g, " ").trim();
  if (!subject) throw new Error("CR06_REQUIRED_FIELD_UNRESOLVED:content.subject");
  return subject;
}

function safeHttpUrl(value: string, field: string): string {
  if (/[\u0000-\u001f\u007f\s]/.test(value)) throw new Error(`CR06_INVALID_URL:${field}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`CR06_INVALID_URL:${field}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`CR06_INVALID_URL:${field}`);
  }
  if (url.username || url.password) throw new Error(`CR06_INVALID_URL:${field}`);
  return url.href;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * This is deliberately not a wire MIME document: it uses fixed part labels and
 * line endings so its digest does not depend on a generated MIME boundary.
 */
function mimeEquivalent(subject: string, text: string, html: string): string {
  return [
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=cr06-deterministic",
    "",
    "--cr06-deterministic",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "--cr06-deterministic",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    "--cr06-deterministic--",
    "",
  ].join("\r\n");
}

function renderEvidence(evidence: readonly Cr06EvidenceInput[]): { text: string[]; html: string[] } {
  if (!evidence.length) return { text: [], html: [] };
  const text = ["Evidence:"];
  const html = ['<section aria-label="Evidence"><p><strong>Evidence</strong></p><ul>'];
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const label = resolveText(item.label, `content.evidence[${index}].label`);
    const detail = resolveText(item.detail, `content.evidence[${index}].detail`);
    const url = item.sourceUrl
      ? safeHttpUrl(item.sourceUrl, `content.evidence[${index}].sourceUrl`)
      : undefined;
    text.push(`- ${label}: ${detail}${url ? ` (${url})` : ""}`);
    html.push(`<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(detail)}${url ? ` <a href="${escapeHtml(url)}">Source</a>` : ""}</li>`);
  }
  html.push("</ul></section>");
  return { text, html };
}

/**
 * Render one recipient message. Commercial outreach requires a physical
 * address and exactly one pre-resolved opt-out treatment; transactional
 * responses intentionally receive neither commercial footer nor opt-out copy.
 */
export function renderCr06Recipient(input: Cr06RenderInput): Cr06RenderedRecipient {
  const rendererVersion = resolveText(input.rendererVersion, "rendererVersion");
  const subject = resolveSubject(input.content.subject);
  const greeting = resolveText(input.content.greeting, "content.greeting");
  const paragraphs = input.content.paragraphs.map((paragraph, index) =>
    resolveText(paragraph, `content.paragraphs[${index}]`),
  );
  if (!paragraphs.length) throw new Error("CR06_REQUIRED_FIELD_UNRESOLVED:content.paragraphs");

  const senderName = resolveText(input.sender.displayName, "sender.displayName");
  const senderEmail = input.sender.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error("CR06_REQUIRED_FIELD_UNRESOLVED:sender.email");
  }
  const signature = resolveText(input.sender.signature, "sender.signature");
  const evidence = renderEvidence(input.content.evidence ?? []);
  const textLines = [greeting, "", ...paragraphs];
  const htmlParts = [`<p>${escapeHtml(greeting)}</p>`, ...paragraphs.map(value => `<p>${escapeHtml(value)}</p>`)];

  if (input.content.callToAction) {
    const label = resolveText(input.content.callToAction.label, "content.callToAction.label");
    const url = safeHttpUrl(input.content.callToAction.url, "content.callToAction.url");
    textLines.push("", `${label}: ${url}`);
    htmlParts.push(`<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`);
  }
  if (evidence.text.length) {
    textLines.push("", ...evidence.text);
    htmlParts.push(...evidence.html);
  }

  textLines.push("", SIGNATURE_MARKER, `${senderName} <${senderEmail}>`, signature);
  htmlParts.push(
    `<!-- cr06-signature --><section data-cr06-signature="1"><p>${escapeHtml(senderName)} &lt;${escapeHtml(senderEmail)}&gt;<br>${escapeHtml(signature).replace(/\n/g, "<br>")}</p></section>`,
  );

  if (input.purpose === "commercial_outreach") {
    const compliance = input.compliance;
    const address = resolveText(compliance?.mailingAddress, "compliance.mailingAddress");
    if (!compliance?.unsubscribe) throw new Error("CR06_REQUIRED_FIELD_UNRESOLVED:compliance.unsubscribe");
    const unsubscribe = typeof compliance.unsubscribe.url === "string"
      ? `Unsubscribe: ${safeHttpUrl(compliance.unsubscribe.url, "compliance.unsubscribe.url")}`
      : `Unsubscribe: ${resolveText(compliance.unsubscribe.instruction, "compliance.unsubscribe.instruction")}`;
    textLines.push("", FOOTER_MARKER, address, unsubscribe);
    htmlParts.push(
      `<!-- cr06-compliance --><footer data-cr06-compliance="1"><p>${escapeHtml(address).replace(/\n/g, "<br>")}<br>${escapeHtml(unsubscribe)}</p></footer>`,
    );
  }

  const text = textLines.join("\n");
  const html = `<div data-cr06-renderer="${escapeHtml(rendererVersion)}">${htmlParts.join("")}</div>`;
  const textSha256 = hash(text);
  const htmlSha256 = hash(html);
  const mimeSha256 = hash(mimeEquivalent(subject, text, html));
  const renderSha256 = hash(JSON.stringify({
    rendererVersion,
    purpose: input.purpose,
    subject,
    textSha256,
    htmlSha256,
    mimeSha256,
  }));
  return freeze({
    rendererVersion,
    purpose: input.purpose,
    subject,
    text,
    html,
    textSha256,
    htmlSha256,
    mimeSha256,
    renderSha256,
  });
}

/** Compatibility-friendly explicit name for callers that prefer "email". */
export const renderCr06RecipientEmail = renderCr06Recipient;