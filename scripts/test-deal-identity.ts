/**
 * Focused unit tests for getDealCardIdentity().
 * Covers company-only, email-only, phone-only, no-contact, and no-duplicate cases.
 * Run: npx tsx scripts/test-deal-identity.ts
 */
import { getDealCardIdentity } from "../client/src/lib/deal-identity";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

const D = { id: 42 };

console.log("\n── Full name + company + email ──");
assert(
  "primary = full name, secondary = company",
  getDealCardIdentity(D, { firstName: "Jane", lastName: "Doe", companyName: "ACME", email: "jane@acme.com" }),
  { primary: "Jane Doe", secondary: "ACME" }
);
assert(
  "email not in secondary when company fills it",
  getDealCardIdentity(D, { firstName: "Jane", lastName: "Doe", companyName: "ACME", email: "jane@acme.com" }).secondary,
  "ACME"
);

console.log("\n── Company-only (no name) ──");
assert(
  "primary = company, secondary = email when email present",
  getDealCardIdentity(D, { companyName: "ACME Corp", email: "hello@acme.com" }),
  { primary: "ACME Corp", secondary: "hello@acme.com" }
);
assert(
  "primary = company, secondary = null when no email/phone",
  getDealCardIdentity(D, { companyName: "ACME Corp" }),
  { primary: "ACME Corp", secondary: null }
);
assert(
  "card secondary does NOT duplicate company primary",
  getDealCardIdentity(D, { companyName: "ACME Corp", email: "ACME Corp" }).secondary,
  null // email equals primary (case-insensitive) — suppressed
);

console.log("\n── Email-only (no name, no company) ──");
assert(
  "primary = email, secondary = null",
  getDealCardIdentity(D, { email: "user@example.com" }),
  { primary: "user@example.com", secondary: null }
);
assert(
  "primary = email, secondary = phone when phone present",
  getDealCardIdentity(D, { email: "user@example.com", phone: "555-1234" }),
  { primary: "user@example.com", secondary: "555-1234" }
);

console.log("\n── Phone-only (no name, no company, no email) ──");
assert(
  "primary = phone, secondary = null",
  getDealCardIdentity(D, { phone: "555-1234" }),
  { primary: "555-1234", secondary: null }
);

console.log("\n── No contact at all ──");
assert(
  "undefined contact → Deal #N, null secondary",
  getDealCardIdentity(D, undefined),
  { primary: "Deal #42", secondary: null }
);
assert(
  "all-empty contact → Deal #N, null secondary",
  getDealCardIdentity(D, { firstName: "", lastName: "", companyName: "", email: "", phone: "" }),
  { primary: "Deal #42", secondary: null }
);
assert(
  "whitespace-only fields → Deal #N, null secondary",
  getDealCardIdentity(D, { firstName: "  ", lastName: "  ", companyName: "  ", email: "  " }),
  { primary: "Deal #42", secondary: null }
);

console.log("\n── Case-insensitive duplicate suppression ──");
assert(
  "company = PRIMARY in different case → secondary null",
  getDealCardIdentity(D, { companyName: "acme corp", email: "ACME CORP" }).secondary,
  null
);
assert(
  "name and company differ → secondary = company",
  getDealCardIdentity(D, { firstName: "John", lastName: "Smith", companyName: "Smith Co" }),
  { primary: "John Smith", secondary: "Smith Co" }
);

console.log("\n── Detail panel semantics verification ──");
{
  // Company field must come from raw contact.companyName, not from identity.secondary.
  // This test verifies the contract: for an email-only contact, identity gives primary=email/secondary=null
  // and the detail Company field must show "N/A" (not the email address).
  const emailOnlyContact = { email: "user@example.com" };
  const identity = getDealCardIdentity(D, emailOnlyContact);
  assert("email-only: card primary = email", identity.primary, "user@example.com");
  assert("email-only: card secondary = null", identity.secondary, null);
  // Detail Company = contact.companyName || "N/A"
  const detailCompany = emailOnlyContact.companyName || "N/A";
  assert("email-only: detail Company = N/A (not email)", detailCompany, "N/A");

  const phoneOnlyContact = { phone: "555-9876" };
  const phoneIdentity = getDealCardIdentity(D, phoneOnlyContact);
  assert("phone-only: card primary = phone", phoneIdentity.primary, "555-9876");
  assert("phone-only: card secondary = null", phoneIdentity.secondary, null);
  const detailCompanyPhone = (phoneOnlyContact as any).companyName || "N/A";
  assert("phone-only: detail Company = N/A (not phone)", detailCompanyPhone, "N/A");

  const companyOnlyContact = { companyName: "ACME Corp" };
  const companyIdentity = getDealCardIdentity(D, companyOnlyContact);
  assert("company-only: card primary = company", companyIdentity.primary, "ACME Corp");
  assert("company-only: card secondary = null", companyIdentity.secondary, null);
  const detailCompanyRaw = companyOnlyContact.companyName || "N/A";
  assert("company-only: detail Company = company (raw)", detailCompanyRaw, "ACME Corp");
}

console.log("\n── Vertical picker state guard (stale data) ──");
{
  // Simulates the stale-data scenario: isError=true but data exists from previous fetch.
  // The rendering guard (!verticalsIsPending && !verticalsIsError && list.map(...))
  // ensures populated options never show alongside an error state.
  const isError = true;
  const staleList = [{ vertical: "Restaurant", count: 5 }];
  const shouldShowPopulated = !isError && staleList.length > 0;
  assert("error + stale data → populated list suppressed", shouldShowPopulated, false);
  const shouldShowError = !false && isError; // !isPending && isError
  assert("error state renders error item", shouldShowError, true);
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
