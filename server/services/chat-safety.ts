/**
 * Liberty Bancard AI Assistant — Safety Service
 *
 * Handles:
 *   - Prompt injection detection
 *   - PII detection and redaction from user input
 *   - Rate limiting (per session, per IP hash)
 *   - Refusal classification (financial guarantees, legal, approvals)
 *   - Safe error messages (never expose internals)
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Rate Limits ──────────────────────────────────────────────────────────────

const RATE_LIMITS = {
  public: { messages: 20, windowMs: 60 * 60 * 1000 },    // 20/hour
  merchant: { messages: 60, windowMs: 60 * 60 * 1000 },  // 60/hour
  staff: { messages: 200, windowMs: 60 * 60 * 1000 },    // 200/hour
};

// In-memory window tracker (survives restarts poorly, but acceptable for chat)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  sessionId: string,
  audience: "public" | "merchant" | "staff"
): { allowed: boolean; remaining: number; resetIn: number } {
  const limit = RATE_LIMITS[audience];
  const now = Date.now();
  const key = `${audience}:${sessionId}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  const remaining = Math.max(0, limit.messages - bucket.count);
  const resetIn = Math.ceil((bucket.resetAt - now) / 1000);
  return { allowed: bucket.count <= limit.messages, remaining, resetIn };
}

// ── Prompt Injection Detection ───────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(your|the|all)\s+(instructions?|system|prompt)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|another|an?\s+unrestricted)/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(a\s+)?(different|unrestricted|evil|dan|jailbreak)/i,
  /jailbreak/i,
  /pretend\s+(you\s+have\s+no\s+restrictions|you\s+are)/i,
  /\bDAN\b/,
  /system\s+prompt\s*:/i,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?|training)/i,
  /print\s+(your\s+)?(system\s+)?(prompt|instructions?)/i,
  /what\s+(is|are)\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i,
  /show\s+(me\s+)?(your\s+)?(internal|hidden|secret)\s+(prompt|instructions?)/i,
  /repeat\s+(everything|all)\s+(above|before)/i,
  /translate\s+the\s+above/i,
  /\{\{.*\}\}/,  // template injection
  /<\|.*\|>/,   // special token injection
];

export function detectInjection(text: string): { flagged: boolean; reason?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: `Matched pattern: ${pattern.source.slice(0, 40)}` };
    }
  }
  return { flagged: false };
}

// ── PII Detection & Redaction ────────────────────────────────────────────────

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b(?=\s|$)/g,
    replacement: "[SSN REDACTED]",
  },
  {
    name: "Card PAN",
    // 13-19 digit sequences with optional spaces/dashes (Luhn-like groupings)
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: "[CARD NUMBER REDACTED]",
  },
  {
    name: "Bank Routing",
    pattern: /\b0[0-9]{8}\b|\b[1-9][0-9]{8}\b/g,
    replacement: "[ROUTING NUMBER REDACTED]",
  },
  {
    name: "CVV",
    pattern: /\b(?:cvv|cvc|cvv2|cid|security\s+code)[\s:]+\d{3,4}\b/gi,
    replacement: "[CVV REDACTED]",
  },
  {
    name: "Password-like",
    pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key)[\s:=]+\S+/gi,
    replacement: "[CREDENTIAL REDACTED]",
  },
];

export function redactPii(text: string): { redacted: string; foundPii: boolean } {
  let redacted = text;
  let foundPii = false;
  for (const { pattern, replacement } of PII_PATTERNS) {
    const before = redacted;
    redacted = redacted.replace(pattern, replacement);
    if (redacted !== before) foundPii = true;
  }
  return { redacted, foundPii };
}

export function detectPii(text: string): boolean {
  return PII_PATTERNS.some(({ pattern }) => {
    const r = new RegExp(pattern.source, pattern.flags);
    return r.test(text);
  });
}

// ── Refusal Classification ───────────────────────────────────────────────────

// Topics the AI must NOT make definitive claims about without verified evidence
const REFUSAL_TOPICS: Array<{ label: string; pattern: RegExp }> = [
  { label: "approval_guarantee",
    pattern: /\b(guarantee|guaranteed|will\s+be\s+approved|definitely\s+approved|sure\s+to\s+get|100%\s+approval)\b/i },
  { label: "rate_promise",
    pattern: /\b(exact\s+rate|exact\s+fee|guaranteed\s+rate|promise\s+(you|a\s+rate)|offer\s+you\s+\d+\s*%)\b/i },
  { label: "legal_advice",
    pattern: /\b(legal\s+advice|constitute\s+legal|my\s+attorney|your\s+attorney|as\s+a\s+lawyer|legally\s+required\s+to)\b/i },
  { label: "tax_advice",
    pattern: /\b(tax\s+advice|deductible|irs\s+rules|tax\s+liability|file\s+(your|my)\s+taxes)\b/i },
  { label: "underwriting_decision",
    pattern: /\b(underwriting\s+decision|we\s+will\s+approve|you\s+(are|will\s+be)\s+approved|instant\s+approval)\b/i },
];

export function classifyRefusalNeeded(text: string): string | null {
  for (const { label, pattern } of REFUSAL_TOPICS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

// ── IP hashing (no raw IP stored) ───────────────────────────────────────────

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip + (process.env.SESSION_SECRET || "lb-salt")).digest("hex").slice(0, 16);
}

// ── Safe user-facing error messages ─────────────────────────────────────────

export const SAFE_ERRORS = {
  rateLimited: "You've sent too many messages recently. Please wait a few minutes and try again.",
  injectionDetected: "I can't process that request. Please rephrase your question.",
  openaiUnavailable: "The AI assistant is temporarily unavailable. Please try again in a moment or contact Liberty Bancard directly.",
  timeout: "The request took too long. Please try a shorter question.",
  unauthorized: "You don't have access to that information.",
  generic: "Something went wrong. Please try again or contact support.",
};

// ── Content length guardrails ─────────────────────────────────────────────────

export const MAX_USER_MESSAGE_LENGTH = 2000;
export const MAX_CONTEXT_CHARS = 6000;  // knowledge context budget
export const MAX_HISTORY_TURNS = 6;     // past turns to include
