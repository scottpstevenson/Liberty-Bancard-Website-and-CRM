/**
 * Central Sender Policy Registry — Liberty Bancard
 *
 * Single authoritative source of truth for all outbound email identities.
 * Every send site MUST resolve From/Reply-To through resolvePolicy() rather
 * than hard-coding addresses or falling back to env vars.
 *
 * Approved identities (all Google Workspace aliases on scott@libertybancard.com
 * except the dedicated cold-outreach mailbox):
 *   cold_outreach → Scott@mail.libertybancard.com  (dedicated cold mailbox)
 *   support       → support@libertybancard.com
 *   onboarding    → onboarding@libertybancard.com
 *   security      → security@libertybancard.com
 *   partners      → partners@libertybancard.com
 *   accounts      → accounts@libertybancard.com
 *   internal_ops  → accounts@libertybancard.com
 *
 * internal_ops decision: accounts@ owns all financial, rep, and operational
 * communications. No new address is required; consistent with digest/alert
 * workflow ownership.
 */

import { storage } from "../storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MessageCategory =
  /** SDR cold prospecting, cold sequences, cold campaigns */
  | "cold_outreach"
  /** Support intake acknowledgements, ticket replies, merchant-service messages */
  | "support"
  /** Merchant app confirm, onboarding, approval/welcome, boarding milestones, doc requests */
  | "onboarding"
  /** Email verification, password setup/reset, login notices, 2FA/account-security */
  | "security"
  /** Partner invitations, partner welcome, partner authentication, partner comms */
  | "partners"
  /** Statements, residuals, rate reviews, savings analyses, account/financial notices */
  | "accounts"
  /** Internal operator/rep alerts and scheduled internal digests */
  | "internal_ops";

export type SignatureType = "sales" | "support" | "onboarding" | "security" | "partners" | "accounts";

export interface SenderPolicy {
  category: MessageCategory;
  from: string;
  replyTo: string;
  displayName: string;
  signatureType: SignatureType;
}

// ── Approved identities ───────────────────────────────────────────────────────

export const COLD_OUTREACH_FROM = "Scott@mail.libertybancard.com";

const POLICY_REGISTRY: Record<MessageCategory, SenderPolicy> = {
  cold_outreach: {
    category: "cold_outreach",
    from: COLD_OUTREACH_FROM,
    replyTo: COLD_OUTREACH_FROM,
    displayName: "Scott Stevenson",
    signatureType: "sales",
  },
  support: {
    category: "support",
    from: "support@libertybancard.com",
    replyTo: "support@libertybancard.com",
    displayName: "Liberty Bancard Support",
    signatureType: "support",
  },
  onboarding: {
    category: "onboarding",
    from: "onboarding@libertybancard.com",
    replyTo: "onboarding@libertybancard.com",
    displayName: "Liberty Bancard Onboarding",
    signatureType: "onboarding",
  },
  security: {
    category: "security",
    from: "security@libertybancard.com",
    replyTo: "security@libertybancard.com",
    displayName: "Liberty Bancard Security",
    signatureType: "security",
  },
  partners: {
    category: "partners",
    from: "partners@libertybancard.com",
    replyTo: "partners@libertybancard.com",
    displayName: "Liberty Bancard Partner Program",
    signatureType: "partners",
  },
  accounts: {
    category: "accounts",
    from: "accounts@libertybancard.com",
    replyTo: "accounts@libertybancard.com",
    displayName: "Liberty Bancard Accounts",
    signatureType: "accounts",
  },
  internal_ops: {
    category: "internal_ops",
    from: "accounts@libertybancard.com",
    replyTo: "accounts@libertybancard.com",
    displayName: "Liberty Bancard",
    signatureType: "accounts",
  },
};

/** Set of all approved From addresses (lowercase) for O(1) lookup. */
export const APPROVED_SENDER_SET = new Set(
  Object.values(POLICY_REGISTRY).map((p) => p.from.toLowerCase())
);

// ── Prohibition guard ─────────────────────────────────────────────────────────

/** Domains where no-reply/noreply local-parts are prohibited as From or Reply-To. */
const LB_DOMAINS = new Set([
  "libertybancard.com",
  "mail.libertybancard.com",
]);

/** Patterns matching prohibited local-parts (case-insensitive). */
const PROHIBITED_LOCAL_PATTERNS = [
  /^no[-_.]?reply$/i,
  /^noreply$/i,
  /^donotreply$/i,
  /^do[-_.]?not[-_.]?reply$/i,
];

/**
 * Returns true when `addr` is a prohibited no-reply variant on a Liberty Bancard domain.
 */
export function isProhibitedAddress(addr: string): boolean {
  if (!addr) return false;
  const lower = addr.toLowerCase().trim();
  const atIdx = lower.lastIndexOf("@");
  if (atIdx === -1) return false;
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);
  if (!LB_DOMAINS.has(domain)) return false;
  return PROHIBITED_LOCAL_PATTERNS.some((p) => p.test(local));
}

/**
 * Async prohibition check — throws a descriptive admin-actionable error and
 * writes an audit event. Call at every send boundary before using an address.
 */
export async function assertNotProhibited(addr: string, context: string): Promise<void> {
  if (!isProhibitedAddress(addr)) return;
  const msg = buildProhibitedMessage(addr, context);
  try {
    await storage.createAuditLog({
      action: "PROHIBITED_SENDER_BLOCKED",
      entityType: "system",
      entityId: 0,
      details: { address: addr, context },
    });
  } catch {
    // audit write failure must never suppress the primary error
  }
  throw new Error(msg);
}

/**
 * Synchronous prohibition check — throws immediately without an audit write.
 * Use in validation/activation checks where async is not practical.
 */
export function assertNotProhibitedSync(addr: string, context: string): void {
  if (!isProhibitedAddress(addr)) return;
  throw new Error(buildProhibitedMessage(addr, context));
}

function buildProhibitedMessage(addr: string, context: string): string {
  return (
    `SENDER POLICY VIOLATION: address "${addr}" (no-reply/noreply on a Liberty Bancard domain) ` +
    `is prohibited as From or Reply-To. Context: ${context}. ` +
    `Use an approved department alias (support@, onboarding@, security@, partners@, accounts@) ` +
    `or the cold-outreach identity (Scott@mail.libertybancard.com).`
  );
}

// ── Policy resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the full sender policy for a message category.
 * Throws if the category is not registered (fail-closed by design).
 */
export function resolvePolicy(category: MessageCategory): SenderPolicy {
  const policy = POLICY_REGISTRY[category];
  if (!policy) {
    throw new Error(
      `SENDER POLICY: no policy registered for category "${String(category)}". ` +
      `Register it in POLICY_REGISTRY in sender-policy.ts.`
    );
  }
  return policy;
}

/**
 * Convenience helper — returns only the {from, replyTo} pair.
 */
export function resolveSender(category: MessageCategory): { from: string; replyTo: string } {
  const p = resolvePolicy(category);
  return { from: p.from, replyTo: p.replyTo };
}

/**
 * Returns a GHL-formatted "Display Name <email>" string for the From field.
 */
export function resolveGhlEmailFrom(category: MessageCategory): string {
  const p = resolvePolicy(category);
  return `${p.displayName} <${p.from}>`;
}

// ── Launch-readiness helpers ──────────────────────────────────────────────────

export interface SenderReadinessEntry {
  category: MessageCategory;
  from: string;
  replyTo: string;
  displayName: string;
  signatureType: SignatureType;
  isProhibited: boolean;
  isColdOutreach: boolean;
  approved: boolean;
}

/** Returns the readiness status for every registered category. */
export function getAllSenderReadiness(): SenderReadinessEntry[] {
  return Object.values(POLICY_REGISTRY).map((p) => ({
    ...p,
    isProhibited: isProhibitedAddress(p.from) || isProhibitedAddress(p.replyTo),
    isColdOutreach: p.category === "cold_outreach",
    approved: APPROVED_SENDER_SET.has(p.from.toLowerCase()),
  }));
}

/** Returns all categories as a formatted text matrix (for reports / audit logs). */
export function buildSenderMatrix(): string {
  const rows = getAllSenderReadiness();
  const lines = [
    "category         | from                              | replyTo                           | signature  | approved",
    "-----------------|-----------------------------------|-----------------------------------|------------|----------",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.category.padEnd(16),
        r.from.padEnd(34),
        r.replyTo.padEnd(34),
        r.signatureType.padEnd(10),
        r.approved ? "YES" : "NO",
      ].join(" | ")
    );
  }
  return lines.join("\n");
}
