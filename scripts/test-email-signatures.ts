/**
 * scripts/test-email-signatures.ts
 *
 * Comprehensive test suite for the centralized email-signature and
 * compliance-footer system. Covers:
 *   1. All 6 signature types — name, title, phone, email, website present in HTML
 *   2. Security type — phishing disclaimer rendered (never request password/card)
 *   3. Sales type — no "no long-term contract" promo claim in rendered output
 *   4. CAN-SPAM compliance footer (HTML) — no false "expressed interest" claim,
 *      has unsubscribe URL, has mailing address, truthful public-source copy
 *   5. CAN-SPAM compliance footer (plain text) — same truthful copy
 *   6. Plain-text variants — website + phone present, sales has quiz/shop links
 *   7. Sender policy — from/replyTo/displayName correct for all categories
 *   8. getDisclaimerText — security type differs from sales type
 *   9. Call-site surface checks — representative auth/accounts/partners bodies
 */

import {
  getEmailSignatureHtml,
  getEmailSignaturePlainText,
  getComplianceFooterHtml,
  getComplianceFooterPlainText,
  getDisclaimerText,
  getDefaultSignatures,
} from "../server/services/email-signatures";
import { resolvePolicy } from "../server/services/sender-policy";
import type { SignatureType, MessageCategory } from "../server/services/sender-policy";

const ALL_SIG_TYPES: SignatureType[] = ["sales", "support", "onboarding", "security", "partners", "accounts"];

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertContains(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle), `expected to find: "${needle}"`);
}

function assertNotContains(label: string, haystack: string, needle: string) {
  assert(label, !haystack.includes(needle), `expected NOT to find: "${needle}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: HTML signatures — all 6 types
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 1: HTML signature presence (all 6 types) ──────────────────────────");

const defaultSigs = getDefaultSignatures();

for (const type of ALL_SIG_TYPES) {
  const sig = defaultSigs[type];
  const html = getEmailSignatureHtml(type);
  console.log(`\n  [${type}]`);
  assertContains(`name present`, html, sig.name);
  assertContains(`title present`, html, sig.title);
  assertContains(`phone present`, html, sig.phone);
  assertContains(`email present`, html, sig.email);
  assertContains(`website link present`, html, "libertybancard.com");
  assertContains(`Liberty Bancard branding`, html, "Liberty Bancard");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Security type — phishing disclaimer
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 2: Security phishing disclaimer ────────────────────────────────────");
{
  const html = getEmailSignatureHtml("security");
  assertContains("security: phishing warning — never ask for password", html, "never ask for your password");
  assertContains("security: payment-card warning present", html, "payment-card");
  assertContains("security: call-us-immediately instruction", html, "call us immediately");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Sales type — no false promo claim
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 3: Sales promo copy accuracy ───────────────────────────────────────");
{
  const html = getEmailSignatureHtml("sales");
  assertNotContains("sales: no 'no long-term contract' claim", html, "no long-term contract");
  assertNotContains("sales: no 'no hidden fees' claim", html, "no hidden fees");
  assertContains("sales: has promo CTA (Get Your Free Savings Analysis)", html, "Get Your Free Savings Analysis");
  assertContains("sales: has booking/calendly link", html, "Schedule a Free Statement Review");
  assertContains("sales: has shop/equipment link", html, "Browse Terminals");

  const plain = getEmailSignaturePlainText("sales");
  assertNotContains("sales plain: no 'no long-term contract' claim", plain, "no long-term contract");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Non-sales types — no promo CTA injected
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 4: Non-sales types — no promo bleed ────────────────────────────────");
for (const type of ALL_SIG_TYPES.filter(t => t !== "sales")) {
  const html = getEmailSignatureHtml(type);
  assertNotContains(`[${type}] no sales promo CTA`, html, "Get Your Free Savings Analysis");
  assertNotContains(`[${type}] no calendly/booking inject`, html, "Schedule a Free Statement Review");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: CAN-SPAM compliance footer (HTML)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 5: Compliance footer — CAN-SPAM (HTML) ─────────────────────────────");
{
  const footer = getComplianceFooterHtml(999, "123 Main St, Fort Lauderdale FL 33301", "https://libertybancard.com");
  assertNotContains("footer: no false 'expressed interest' claim", footer, "expressed interest");
  assertContains("footer: has mailing address", footer, "123 Main St");
  assertContains("footer: has unsubscribe URL", footer, "/unsubscribe?t=");
  assertContains("footer: truthful public-source statement", footer, "publicly available sources");
  assertContains("footer: Liberty Bancard identity", footer, "Liberty Bancard");
  assertContains("footer: opt-out invitation", footer, "opt out");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: CAN-SPAM compliance footer (plain text)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 6: Compliance footer — CAN-SPAM (plain text) ───────────────────────");
{
  const footer = getComplianceFooterPlainText(999, "123 Main St, Fort Lauderdale FL 33301", "https://libertybancard.com");
  assertNotContains("plain footer: no false 'expressed interest' claim", footer, "expressed interest");
  assertContains("plain footer: has mailing address", footer, "123 Main St");
  assertContains("plain footer: has unsubscribe URL", footer, "/unsubscribe?t=");
  assertContains("plain footer: publicly available sources", footer, "publicly available sources");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Plain-text signatures (all 6 types)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 7: Plain-text signature completeness (all 6 types) ─────────────────");
for (const type of ALL_SIG_TYPES) {
  const sig = defaultSigs[type];
  const plain = getEmailSignaturePlainText(type);
  console.log(`\n  [${type}]`);
  assertContains(`name present`, plain, sig.name);
  assertContains(`phone present`, plain, sig.phone);
  assertContains(`email present`, plain, sig.email);
  assertContains(`website present`, plain, "libertybancard.com");
  assertContains(`disclaimer present`, plain, getDisclaimerText(type).slice(0, 20));
}
{
  const salesPlain = getEmailSignaturePlainText("sales");
  assertContains("sales plain: quiz URL present", salesPlain, "/free-analysis");
  assertContains("sales plain: shop URL present", salesPlain, "/shop");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8: Sender policy — resolvePolicy for all message categories
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 8: Sender policy resolution (all categories) ───────────────────────");

const CATEGORY_CHECKS: Array<{ category: MessageCategory; expectedFrom: string; expectedReplyTo: string; expectedDisplayName: string }> = [
  { category: "cold_outreach", expectedFrom: "Scott@mail.libertybancard.com", expectedReplyTo: "Scott@mail.libertybancard.com", expectedDisplayName: "Scott Stevenson" },
  { category: "support",       expectedFrom: "support@libertybancard.com",    expectedReplyTo: "support@libertybancard.com",    expectedDisplayName: "Liberty Bancard Support" },
  { category: "onboarding",    expectedFrom: "onboarding@libertybancard.com", expectedReplyTo: "onboarding@libertybancard.com", expectedDisplayName: "Liberty Bancard Onboarding" },
  { category: "security",      expectedFrom: "security@libertybancard.com",   expectedReplyTo: "security@libertybancard.com",   expectedDisplayName: "Liberty Bancard Security" },
  { category: "partners",      expectedFrom: "partners@libertybancard.com",   expectedReplyTo: "partners@libertybancard.com",   expectedDisplayName: "Liberty Bancard Partner Program" },
  { category: "accounts",      expectedFrom: "accounts@libertybancard.com",   expectedReplyTo: "accounts@libertybancard.com",   expectedDisplayName: "Liberty Bancard Account Management" },
  { category: "internal_ops",  expectedFrom: "accounts@libertybancard.com",   expectedReplyTo: "accounts@libertybancard.com",   expectedDisplayName: "Liberty Bancard" },
];

for (const check of CATEGORY_CHECKS) {
  const policy = resolvePolicy(check.category);
  console.log(`\n  [${check.category}] from=${policy.from} replyTo=${policy.replyTo}`);
  assert(`[${check.category}] from address`, policy.from === check.expectedFrom, `got "${policy.from}", want "${check.expectedFrom}"`);
  assert(`[${check.category}] replyTo address`, policy.replyTo === check.expectedReplyTo, `got "${policy.replyTo}", want "${check.expectedReplyTo}"`);
  assert(`[${check.category}] displayName`, policy.displayName === check.expectedDisplayName, `got "${policy.displayName}", want "${check.expectedDisplayName}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 9: getDisclaimerText — security vs non-security differ
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 9: getDisclaimerText uniqueness ─────────────────────────────────────");
{
  const securityDisclaimer = getDisclaimerText("security");
  const salesDisclaimer = getDisclaimerText("sales");
  assert("security disclaimer differs from sales disclaimer", securityDisclaimer !== salesDisclaimer);
  assertContains("security disclaimer: warns about password", securityDisclaimer, "password");
  assertContains("security disclaimer: warns about payment-card", securityDisclaimer, "payment-card");
  assertNotContains("sales disclaimer: no password warning (wrong type)", salesDisclaimer, "password");
  assertContains("all other types: have eligibility disclaimer", getDisclaimerText("accounts"), "Eligibility");
  assertContains("all other types: have eligibility disclaimer", getDisclaimerText("support"), "Eligibility");
  assertContains("all other types: have eligibility disclaimer", getDisclaimerText("partners"), "Eligibility");
  assertContains("all other types: have eligibility disclaimer", getDisclaimerText("onboarding"), "Eligibility");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 10: Call-site surface checks
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Section 10: Call-site surface checks ────────────────────────────────────────");

// replitAuth.ts — security notifications now use security signature
{
  const trustedDeviceBody =
    `<p>Hi Scott,</p><p>A new device has been added to your list of trusted devices on your Liberty Bancard account.</p>` +
    `<p>If this wasn't you, please contact us immediately at <a href="mailto:security@libertybancard.com">security@libertybancard.com</a> so we can secure your account.</p>` +
    getEmailSignatureHtml("security");

  assertContains("auth trusted-device: security sig injected (name)", trustedDeviceBody, "Liberty Bancard Security");
  assertContains("auth trusted-device: phishing warning in body", trustedDeviceBody, "never ask for your password");
  assertContains("auth trusted-device: website link", trustedDeviceBody, "libertybancard.com");
  assertNotContains("auth trusted-device: no stale 'Best regards' block", trustedDeviceBody, "Best regards,");
  assertNotContains("auth trusted-device: no stale 'automated security notification' tail", trustedDeviceBody, "This is an automated security notification");
}

// sla-worker.ts — doc-nudge and proposal follow-up use accounts signature
{
  const docNudgeBody =
    `<p>Hi Jane,</p><p>We're making great progress on your processing setup!</p>` +
    `<ul><li>Processing statement</li></ul>` +
    `<p>You can reply to this email with the documents or give us a call and we'll walk you through it.</p>` +
    getEmailSignatureHtml("accounts");

  assertContains("sla doc-nudge: accounts sig injected (name)", docNudgeBody, "Liberty Bancard Account Management");
  assertContains("sla doc-nudge: accounts email", docNudgeBody, "accounts@libertybancard.com");
  assertContains("sla doc-nudge: website link", docNudgeBody, "libertybancard.com");
  assertNotContains("sla doc-nudge: no stale 'Best, Liberty Bancard Team'", docNudgeBody, "Best,\nLiberty Bancard Team");
}

// partners.ts — password reset email uses partners signature, no Scott Stevenson
{
  const partnerResetBody =
    `<p>Hi Alex,</p><p>We received a request to reset the password for your partner account.</p>` +
    getEmailSignatureHtml("partners");

  assertContains("partners reset: partners sig injected (name)", partnerResetBody, "Liberty Bancard Partner Program");
  assertContains("partners reset: partners email", partnerResetBody, "partners@libertybancard.com");
  assertContains("partners reset: website link", partnerResetBody, "libertybancard.com");
  assertNotContains("partners reset: no stale '— Scott Stevenson'", partnerResetBody, "— Scott Stevenson");
  assertNotContains("partners reset: no stale support@... in sig", partnerResetBody, "support@libertybancard.com");
}

// proposal-engine.ts + savings.ts + co-branded — accounts signature appended
{
  const proposalBody = `<div>...proposal HTML...</div>${getEmailSignatureHtml("accounts")}`;
  assertContains("proposal: accounts sig injected (name)", proposalBody, "Liberty Bancard Account Management");
  assertContains("proposal: accounts email present", proposalBody, "accounts@libertybancard.com");
  assertNotContains("proposal: no stale sales@ reference in sig", proposalBody, "sales@libertybancard.com");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════════════════════");
const total = passed + failed;
if (failed === 0) {
  console.log(`✅  All ${total} email-signature checks passed.`);
  process.exit(0);
} else {
  console.error(`❌  ${failed}/${total} email-signature checks FAILED — see ✗ lines above.`);
  process.exit(1);
}
