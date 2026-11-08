// SERVER-ONLY register of the evidence behind public claims.
//
// Never import this module from client/ or shared/ code. It holds review
// records, retired wording, case figures and image rights notes that must not
// enter the public bundle. scripts/test-public-claims-contract.ts asserts that
// no client or shared file imports it and that none of the private markers
// below appear in the built client bundle.
//
// Registered claim records (shared/public-claims.ts) reference this register
// only by opaque evidence key.

export type EvidenceKind =
  | "owner-authorized-wording"
  | "code-trace"
  | "official-source"
  | "public-policy-text";

export interface EvidenceEntry {
  key: string;
  kind: EvidenceKind;
  summary: string;
  /** Repository path or official URL. */
  source: string;
  recordedOn: string;
}

export const CLAIM_EVIDENCE: readonly EvidenceEntry[] = [
  {
    key: "EV-WA-CONTRACT-SAFE-WORDING",
    kind: "owner-authorized-wording",
    summary:
      "The W-A Truth and Terms contract supplies the safe default wording for equipment, processing agreement, timing, funding, program and compatibility statements. It authorizes qualified-inquiry wording where a fact is unknown; it is not evidence that any withheld fact is true.",
    source: "attached_assets/Liberty-W-A-Truth-and-Terms_1794148597077.md",
    recordedOn: "2026-11-08",
  },
  {
    key: "EV-WA-CONTRACT-FEE-TAXONOMY",
    kind: "owner-authorized-wording",
    summary:
      "The contract defines the statement-review taxonomy (at least interchange, network assessments/fees, processor/service charges; equipment, gateway and other charges separate) and effective cost as included fees divided by matching card volume for a stated period.",
    source: "attached_assets/Liberty-W-A-Truth-and-Terms_1794148597077.md",
    recordedOn: "2026-11-08",
  },
  {
    key: "EV-WA-CODE-STATEMENT-HANDLING-TRACE",
    kind: "code-trace",
    summary:
      "Traced source behavior: multipart admission with PDF/JPG/PNG content sniffing and a 10 MB cap, retained as an AES-256-GCM protected object (production fails closed without a key), durable command enqueue, website auto-analysis held by a default-off setting. The public Privacy Policy states information may be shared with service providers and is not sold. No retention period or deletion process is established, so none may be promised. Configuration in production is not verified by this record.",
    source: "server/services/protected-object.ts; server/services/statement-upload-chain.ts; client/src/pages/PrivacyPolicy.tsx",
    recordedOn: "2026-11-08",
  },
  {
    key: "EV-WA-CARD-NETWORK-DEBIT-PREPAID",
    kind: "official-source",
    summary:
      "Visa's merchant surcharging Q&A (read 2026-11-08) states that surcharging is limited to credit cards, that U.S. merchants cannot surcharge Visa debit or prepaid cards, and that a Visa debit card remains a debit card when the cardholder selects 'credit' at the terminal (the choice is signature versus PIN). Supports only the credit-only statement. Mastercard and acquirer wording was not independently read for this record, and no state-law or legality statement is supported.",
    source: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf",
    recordedOn: "2026-11-08",
  },
];

export const CLAIM_EVIDENCE_KEYS: ReadonlySet<string> = new Set(CLAIM_EVIDENCE.map((e) => e.key));

// ── Retired wording (kept privately so reviewers can see what was removed) ───

export interface RetiredWording {
  claimId: string;
  originalWording: string;
  appearedOn: string;
  reason: string;
}

export const RETIRED_WORDING: readonly RetiredWording[] = [
  {
    claimId: "offer.free-processing",
    originalWording: "See If You Qualify for Free Processing",
    appearedOn: "/shop and /free-analysis promotion banner, list, inline and card variants (the FREE30 promotion)",
    reason: "No written program record supports a free-processing benefit; the promotion code is attribution only and is not evidence of an approved benefit.",
  },
  {
    claimId: "offer.eliminate-processing-fees",
    originalWording: "Eligible businesses can eliminate card processing fees entirely.",
    appearedOn: "/shop and /free-analysis promotion banner, list, inline and card variants",
    reason: "No source; contradicts the remaining-costs disclosure (equipment, software, gateway, PCI and other fees).",
  },
  {
    claimId: "equipment.contract.no-lease",
    originalWording: "No Leases. Ever. We never lease equipment. Buy outright or qualify for free placement with your processing agreement.",
    appearedOn: "/shop trust strip",
    reason: "The footer and Terms page describe lease-to-own and Liberty-owned equipment depending on the program; no written program record supports an absolute no-lease statement.",
  },
  {
    claimId: "equipment.placement.free-with-processing",
    originalWording: "qualify for free placement with your processing agreement",
    appearedOn: "/shop trust strip",
    reason: "Same evidence gap as the no-upfront placement claim; the equipment program record is still an open owner item.",
  },
  {
    claimId: "equipment.monthly-fee.zero",
    originalWording: "$0/mo with processing; $0/mo",
    appearedOn: "/shop terminal cards and detail view (Dejavoo QD4, PAX A920, SwipeSimple B250)",
    reason: "No product-specific written evidence for a zero monthly equipment fee.",
  },
  {
    claimId: "compat.single-billing-relationship",
    originalWording: "Single provider for processing and gateway — one billing relationship",
    appearedOn: "/alternatives/authorize-net server page",
    reason: "No evidence of a confirmed Liberty gateway path or billing arrangement.",
  },
  {
    claimId: "compat.no-gateway-layer",
    originalWording: "Transparent interchange-plus pricing with no separate gateway layer",
    appearedOn: "/alternatives/authorize-net server page",
    reason: "No evidence of a confirmed Liberty gateway path; an online setup may involve a gateway.",
  },
  {
    claimId: "equipment.contract.month-to-month",
    originalWording: "Liberty Bancard does not require long-term processing contracts. Your month-to-month agreement means you're staying because it works.",
    appearedOn: "/free-smart-terminal FAQ, page trust strip, server HTML",
    reason: "Contradicts the public Terms page and footer, which describe minimum processing, a contract term and a possible early termination fee.",
  },
  {
    claimId: "equipment.contract.no-etf",
    originalWording: "Early Termination Fee: None",
    appearedOn: "Comparison tables",
    reason: "No source; contradicts the footer and Terms page.",
  },
  {
    claimId: "equipment.contract.you-own-equipment",
    originalWording: "You own your equipment and your data",
    appearedOn: "Comparison tables",
    reason: "Footer and Terms describe Liberty-owned or lease-to-own equipment depending on the program.",
  },
  {
    claimId: "equipment.contract.no-lock-in",
    originalWording: "0 Lock-In Contracts",
    appearedOn: "/integrations stat tile",
    reason: "No source; contradicts the equipment and term disclosures.",
  },
  {
    claimId: "equipment.volume-threshold",
    originalWording: "Monthly card volume of $5,000 or more",
    appearedOn: "/free-smart-terminal eligibility list and server HTML",
    reason: "No source for a numeric threshold.",
  },
  {
    claimId: "equipment.commonly-placed",
    originalWording: "Commonly placed terminals include the Clover Flex 3 and PAX A920",
    appearedOn: "/free-smart-terminal FAQ",
    reason: "No inventory or placement-frequency source.",
  },
  {
    claimId: "timing.window.48-hours",
    originalWording: "Setup in as little as 48 hours; Live in as little as 48 hours; Ready to Go in 48 Hours",
    appearedOn: "/free-smart-terminal, /0-percent-processing, quiz, comparison pages",
    reason: "No source for an unconditional window; approval, equipment availability and shipping are separate stages.",
  },
  {
    claimId: "timing.window.same-day",
    originalWording: "same business day",
    appearedOn: "/free-smart-terminal, Home",
    reason: "Unconditional review window with no staffing or service-level source.",
  },
  {
    claimId: "timing.window.one-business-day",
    originalWording: "Our team analyzes every line item within 1 business day; Usually within 1 business day",
    appearedOn: "/upload-statement React, shared content, server HTML",
    reason: "No service-level source; website auto-analysis is held by default.",
  },
  {
    claimId: "timing.window.shipping-days",
    originalWording: "most terminals are configured and shipped within 2–3 business days",
    appearedOn: "/free-smart-terminal FAQ",
    reason: "No fulfillment source.",
  },
  {
    claimId: "timing.window.approval-days",
    originalWording: "most applications are approved within 1–2 business days",
    appearedOn: "Statement review shared content",
    reason: "Underwriting timing is set by the acquirer; no source.",
  },
  {
    claimId: "funding.next-day",
    originalWording: "Qualified merchants receive next-day funding",
    appearedOn: "Statement review shared content, Home, comparison tables",
    reason: "Universal funding promise; timing depends on product, cutoff, bank and risk conditions.",
  },
  {
    claimId: "review.savings.benchmark",
    originalWording: "Most merchants we review save $600–$3,200/year; Most businesses processing $20,000+/month save $2,000–$6,000/year",
    appearedOn: "/upload-statement React and server HTML",
    reason: "No realized-savings record. The figure in the site content module was labelled as verified without a record.",
  },
  {
    claimId: "review.industry-rate-ranges",
    originalWording: "Where merchants overpay (by industry avg.): Restaurants 2.8–3.5%; Medical/Dental 2.5–3.2%; Retail/Salon 2.2–3.0%; Auto/Services 2.8–4.0%",
    appearedOn: "/upload-statement React",
    reason: "No source for industry averages; an illustrative label does not substantiate numbers.",
  },
  {
    claimId: "review.handling.never-shared",
    originalWording: "Your statement is never sold or shared; we do not share your statement outside the review",
    appearedOn: "/upload-statement React and shared content",
    reason: "Contradicts the Privacy Policy, which allows sharing with service providers.",
  },
  {
    claimId: "review.handling.confidential-badge",
    originalWording: "Secure & Confidential",
    appearedOn: "/upload-statement server HTML",
    reason: "Absolute confidentiality is not supported.",
  },
  {
    claimId: "review.handling.team-only-access",
    originalWording: "Access is limited to the team performing the review",
    appearedOn: "Statement review shared content",
    reason: "Access paths include service providers and the held analysis path; not verified as team-only.",
  },
  {
    claimId: "review.analysis.automatic-ai",
    originalWording: "We confirm receipt right away and queue AI analysis on your file",
    appearedOn: "/upload-statement React",
    reason: "Website auto-analysis is held by a default-off setting; the public promise was inaccurate.",
  },
  {
    claimId: "program.zero-cost",
    originalWording: "Pay $0 to Accept Credit Cards; Annual cost to you $0; eliminates credit card processing costs",
    appearedOn: "/0-percent-processing, Home, metadata",
    reason: "Merchants can still carry equipment, software, gateway, PCI and other costs, and eligibility is program-specific.",
  },
  {
    claimId: "program.legal-path",
    originalWording: "We'll find your legal path to zero fees",
    appearedOn: "/0-percent-processing hero",
    reason: "A legal conclusion for an unknown merchant cannot be promised in advance.",
  },
  {
    claimId: "program.every-requirement",
    originalWording: "handle every regulatory requirement",
    appearedOn: "/0-percent-processing hero and compliance section",
    reason: "Blanket compliance promise.",
  },
  {
    claimId: "program.all-states",
    originalWording: "Cash discount programs are legal in all 50 states; Legal in all 50 states",
    appearedOn: "/0-percent-processing, Home",
    reason: "A fifty-state legal opinion is not supported.",
  },
  {
    claimId: "program.savings-math",
    originalWording: "$270 → $0, $3,240/year saved, ~$1,350/yr, ~$8,100/yr, ~$16,200/yr at an assumed 2.7% effective rate",
    appearedOn: "/0-percent-processing",
    reason: "Assumed rate and omitted costs; invented Liberty-side figures.",
  },
  {
    claimId: "program.uniform-surcharge-rate",
    originalWording: "The service fee (typically 3-4%) is added to eligible card transactions",
    appearedOn: "/0-percent-processing FAQ",
    reason: "Surcharge caps and rules vary by card type, brand and state.",
  },
  {
    claimId: "compat.universal",
    originalWording: "Works With Your Existing Software",
    appearedOn: "/integrations title and hero",
    reason: "No per-product compatibility evidence.",
  },
  {
    claimId: "compat.platform-count",
    originalWording: "20+ platforms",
    appearedOn: "/integrations stat tile",
    reason: "Count of unverified product records.",
  },
  {
    claimId: "compat.fee-bypass",
    originalWording: "bypass Shopify Payments fees … save $3,000–$6,000/year",
    appearedOn: "/integrations Shopify record",
    reason: "Unsupported savings figure and platform-fee claim.",
  },
  {
    claimId: "price.liberty.assumed-rates",
    originalWording: "avg interchange ~1.60% + 0.20% markup … + $0.07 per transaction → ~$630/mo*",
    appearedOn: "Comparison pages' math notes",
    reason: "Invented Liberty-side rates for a merchant who has not been reviewed.",
  },
  {
    claimId: "price.savings-estimates",
    originalWording: "Typical savings of $N/month versus provider",
    appearedOn: "Comparison pages",
    reason: "Derived from invented Liberty-side rates.",
  },
];

// ── Private case review records ─────────────────────────────────────────────

export interface CaseVersion {
  label: "draft" | "current";
  surfaces: string;
  volumePerMonth: string;
  annualSavings: string;
  notes: string;
}

export interface PrivateCaseReview {
  id: "LB-CS-01" | "LB-CS-02";
  vertical: string;
  publicationState: "unreviewed";
  verified: false;
  versions: readonly CaseVersion[];
  missing: readonly string[];
  handoff: string;
}

export const PRIVATE_CASE_REVIEWS: readonly PrivateCaseReview[] = [
  {
    id: "LB-CS-01",
    vertical: "restaurant",
    publicationState: "unreviewed",
    verified: false,
    versions: [
      {
        label: "current",
        surfaces: "React case studies page, Home proof block",
        volumePerMonth: "$45,000",
        annualSavings: "$4,200",
        notes: "Square flat-rate comparison.",
      },
      {
        label: "draft",
        surfaces: "Server-rendered case page snapshot card",
        volumePerMonth: "$35,000",
        annualSavings: "$4,800",
        notes: "Miami restaurant; also mentions compliant surcharging. Different volume and savings than the current version.",
      },
    ],
    missing: [
      "Signed merchant release or documented permission",
      "Statement-based before/after calculation including excluded costs",
      "Identity and location confirmation",
      "Owner approval for publication",
    ],
    handoff: "W-D decides case publication behavior. W-A only preserves both versions and stops calling either verified.",
  },
  {
    id: "LB-CS-02",
    vertical: "medical",
    publicationState: "unreviewed",
    verified: false,
    versions: [
      {
        label: "current",
        surfaces: "React case studies page, Home proof block",
        volumePerMonth: "$128,000",
        annualSavings: "$6,100",
        notes: "Healthcare practice.",
      },
      {
        label: "draft",
        surfaces: "Server-rendered case page snapshot card",
        volumePerMonth: "$28,000",
        annualSavings: "$3,200",
        notes: "Fort Lauderdale practice moving from Stripe. Different volume and savings than the current version.",
      },
    ],
    missing: [
      "Signed merchant release or documented permission",
      "Statement-based before/after calculation including excluded costs",
      "Identity and location confirmation",
      "Owner approval for publication",
    ],
    handoff: "W-D decides case publication behavior. W-A only preserves both versions and stops calling either verified.",
  },
];

// ── Image, logo and device source-and-rights register ───────────────────────

export type AssetRightsDisposition =
  | "unverified-illustrative-only"
  | "owner-brand-asset-unconfirmed"
  | "third-party-device-image-rights-unconfirmed"
  | "excluded";

export interface AssetRightsEntry {
  asset: string;
  kind: "photo" | "logo" | "device";
  disposition: AssetRightsDisposition;
  note: string;
}

export const ASSET_RIGHTS_REGISTER: readonly AssetRightsEntry[] = [
  { asset: "hero-terminal-tap", kind: "photo", disposition: "unverified-illustrative-only", note: "Rendered payment moment; no licence record." },
  { asset: "industry-restaurant", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "industry-healthcare", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "industry-automotive", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "industry-retail", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "industry-home-services", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "how-statement-review", kind: "photo", disposition: "unverified-illustrative-only", note: "No licence record." },
  { asset: "terminal-clover-flex-3.png", kind: "device", disposition: "third-party-device-image-rights-unconfirmed", note: "Manufacturer or reseller marketing image; permission not evidenced." },
  { asset: "terminal-pax-a920.png", kind: "device", disposition: "third-party-device-image-rights-unconfirmed", note: "Manufacturer or reseller marketing image; permission not evidenced." },
  { asset: "Dejavoo QD4 image (terminal shop page)", kind: "device", disposition: "third-party-device-image-rights-unconfirmed", note: "File name and artwork are not rights evidence." },
  { asset: "liberty-terminal-tap.png", kind: "device", disposition: "unverified-illustrative-only", note: "Branded rendering; source of the render unrecorded." },
  { asset: "logo-blue, logo-white", kind: "logo", disposition: "owner-brand-asset-unconfirmed", note: "Company mark; ownership assumed but not recorded." },
  { asset: "hero-merchant.jpg, merchant-owner.jpg, vertical-auto.jpg, vertical-retail.jpg, vertical-home-services.jpg, case-medical.jpg", kind: "photo", disposition: "excluded", note: "Excluded from the registered imagery set by the mobile audit; remain on disk for older pages." },
];

// ── Owner evidence still needed ─────────────────────────────────────────────

export interface OwnerEvidenceItem {
  id: string;
  needed: string;
  unlocks: string;
  safeFallbackNow: string;
}

export const OWNER_EVIDENCE_REGISTER: readonly OwnerEvidenceItem[] = [
  {
    id: "OE-01",
    needed: "Written equipment program record: qualification, ownership, return, term, fees and minimum processing",
    unlocks: "equipment.placement.no-upfront (and any free or no-upfront wording next to the equipment disclosure)",
    safeFallbackNow: "equipment.options.summary and equipment.agreement.summary",
  },
  {
    id: "OE-02",
    needed: "Equipment inventory and models actually placed",
    unlocks: "Naming specific terminal models as available",
    safeFallbackNow: "equipment.models.options (options only, availability confirmed during review)",
  },
  {
    id: "OE-03",
    needed: "Service levels for review, approval, shipping and activation",
    unlocks: "Any numeric timing window",
    safeFallbackNow: "timing.staged-process (no windows)",
  },
  {
    id: "OE-04",
    needed: "Approved human, processor and AI handling disclosure plus retention and deletion policy",
    unlocks: "Retention, deletion, access-limit and AI-use statements",
    safeFallbackNow: "review.handling.summary",
  },
  {
    id: "OE-05",
    needed: "Compliance-reviewed surcharge and cash-discount program terms by state and card type",
    unlocks: "Legality, registration and fee statements on the program page",
    safeFallbackNow: "program.overview, program.card-types, program.requirements, program.remaining-costs",
  },
  {
    id: "OE-06",
    needed: "Per-product integration test evidence with versions and limitations",
    unlocks: "Moving a product from inquiry required to confirmed",
    safeFallbackNow: "compat.inquiry",
  },
  {
    id: "OE-07",
    needed: "Liberty's actual published pricing schedule and a statement-based comparison method",
    unlocks: "Any Liberty-side rate, fee or savings figure",
    safeFallbackNow: "price.comparison.method",
  },
  {
    id: "OE-08",
    needed: "Case releases, statement calculations and publication approval for LB-CS-01 and LB-CS-02",
    unlocks: "Publishing a named or anonymized case with figures",
    safeFallbackNow: "Private records only",
  },
  {
    id: "OE-09",
    needed: "Image, logo and device-image rights",
    unlocks: "Replacing the unverified illustrative imagery",
    safeFallbackNow: "Unverified imagery stays illustrative-only",
  },
  {
    id: "OE-10",
    needed: "Source records for years in business, merchants served and annual processing volume",
    unlocks: "Showing company statistics",
    safeFallbackNow: "Statistics export marked unverified; no consumer",
  },
];

// ── Bundle-leak sentinels ───────────────────────────────────────────────────
// Strings that exist only in this server-only module. The static suite scans
// client/, shared/ and the built client bundle for them; any hit means this
// register was pulled into browser code.

export const PRIVATE_BUNDLE_MARKERS: readonly string[] = [
  "wa-private-evidence-marker-7f3c91",
  "Contradicts the public Terms page and footer",
  "LB-CS-01",
  "Manufacturer or reseller marketing image; permission not evidenced.",
];

export const PRIVATE_BUNDLE_SENTINEL = PRIVATE_BUNDLE_MARKERS[0];
