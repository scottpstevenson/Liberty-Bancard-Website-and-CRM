// Shared public disclosures and the staged-timing vocabulary. Composed only from
// approved claim records so the React footer, the server-rendered footer, the
// quiz and the program pages cannot drift apart.

import { claimText } from "./public-claims";

/** One sentence that names the stages without giving any window. */
export const TIMING_NOTE = claimText("timing.staged-process");

/** Ordered stage labels. Each stage is separate; none carries a duration. */
export const TIMING_STAGES: readonly string[] = [
  "Request received",
  "Review",
  "Account approval",
  "Equipment availability",
  "Shipping",
  "Setup and activation",
];

export const EQUIPMENT_OPTIONS_NOTE = claimText("equipment.options.summary");
export const EQUIPMENT_AGREEMENT_NOTE = claimText("equipment.agreement.summary");
export const FUNDING_NOTE = claimText("funding.availability");

/** Footer disclaimer paragraph (both footers). */
export const FOOTER_DISCLAIMER = [
  "Disclosures: Pricing, program eligibility, funding speed, and equipment offers vary by merchant profile and are subject to underwriting approval.",
  claimText("funding.availability", "footer"),
  claimText("program.overview", "footer"),
  claimText("equipment.footer.disclosure", "footer"),
  "PCI compliance is the merchant's responsibility; we provide guidance and support. We do not provide legal, tax, or financial advice.",
].join(" ");

/** Footer compliance paragraph (both footers). */
export const FOOTER_COMPLIANCE = [
  "Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.",
  claimText("equipment.agreement.summary", "footer"),
].join(" ");
