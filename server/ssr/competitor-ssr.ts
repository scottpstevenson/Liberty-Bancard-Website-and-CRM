import { ssrNavbar, ssrFooter } from "../ssrShared";

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface CompetitorInfo {
  name: string;
  fullName: string;
  slug: string;
  category: string;
  whyMerchantsLeave: string[];
  whatLibertySolves: string[];
  relatedIndustries: { name: string; slug: string }[];
  relatedGlossary: { name: string; slug: string }[];
}

const competitorInfo: Record<string, CompetitorInfo> = {
  square: {
    name: "Square",
    fullName: "Square (Block, Inc.)",
    slug: "square",
    category: "Flat-Rate Processor",
    whyMerchantsLeave: [
      "2.6% + $0.10 flat rate overcharges on debit cards and standard credit cards",
      "No interchange-plus pricing — paying more on every transaction",
      "No dedicated account representative when issues arise",
      "Account holds and fund stability concerns at higher volumes",
      "No Liberty Zero™ or 0% processing programs available",
    ],
    whatLibertySolves: [
      "Interchange-plus pricing reduces costs by 0.5%–1.0% for most merchants",
      "Dedicated account rep available by phone — knows your business personally",
      "Stable merchant account underwritten specifically for your business",
      "Liberty Zero™ program available — most card fees passed to card users*",
      "Free terminal for qualifying merchants",
    ],
    relatedIndustries: [
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "Flat-Rate Pricing", slug: "flat-rate-pricing" },
    ],
  },
  stripe: {
    name: "Stripe",
    fullName: "Stripe, Inc.",
    slug: "stripe",
    category: "Developer Payment Platform",
    whyMerchantsLeave: [
      "2.9% + $0.30 is one of the most expensive flat rates for in-person transactions",
      "Built for developers and SaaS — not optimized for brick-and-mortar businesses",
      "No dedicated account representative, email support only",
      "Limited in-person payment hardware and support",
      "No cash discount or dual pricing programs",
    ],
    whatLibertySolves: [
      "Interchange-plus pricing is significantly lower for card-present transactions",
      "Purpose-built for in-person businesses with full terminal support",
      "Dedicated account rep available directly",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants",
    ],
    relatedIndustries: [
      { name: "Professional Services Payment Processing", slug: "professional-services-payment-processing" },
      { name: "E-Commerce Payment Processing", slug: "ecommerce-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "Payment Gateway", slug: "payment-gateway" },
    ],
  },
  clover: {
    name: "Clover",
    fullName: "Clover Network (Fiserv)",
    slug: "clover",
    category: "Bundled POS and Processing",
    whyMerchantsLeave: [
      "3-year contracts with early termination fees up to $500",
      "Processing rates of 2.3%–3.5% depending on plan and reseller",
      "Equipment is often leased, not owned — you pay for years for hardware you don't own",
      "PCI compliance fees added as a separate monthly charge",
      "Rate increases are common after the promotional period",
    ],
    whatLibertySolves: [
      "No long-term contracts or early termination fees",
      "Interchange-plus pricing transparent from day one",
      "Free terminal for qualifying merchants — equipment you own",
      "PCI compliance included at no extra charge",
      "Dedicated account rep for proactive support",
    ],
    relatedIndustries: [
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "PCI Compliance", slug: "pci-compliance" },
    ],
  },
  toast: {
    name: "Toast",
    fullName: "Toast, Inc.",
    slug: "toast",
    category: "Restaurant POS and Processing",
    whyMerchantsLeave: [
      "Processing rates of 2.49%–3.69% are significantly above interchange costs",
      "24–36 month contracts with early termination fees that can exceed $10,000",
      "Must use Toast processing — no flexibility to switch processors",
      "Equipment financing creates another long-term financial obligation",
      "Monthly software fees increase as you add features",
    ],
    whatLibertySolves: [
      "Interchange-plus pricing saves restaurants $3,000–$7,000 per year at typical volumes",
      "No long-term contracts or termination penalties",
      "Freedom to choose your own POS system",
      "Cash discount programs popular with restaurant owners",
      "Dedicated rep who understands restaurant operations",
    ],
    relatedIndustries: [
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "Cash Discount Program", slug: "cash-discount-program" },
    ],
  },
  paypal: {
    name: "PayPal",
    fullName: "PayPal Holdings, Inc.",
    slug: "paypal",
    category: "Consumer Payment Platform",
    whyMerchantsLeave: [
      "2.99% + $0.49 in-person rate is one of the highest in the industry",
      "Account holds and fund freezes cause cash flow disruption",
      "No dedicated merchant account representative",
      "No interchange passthrough pricing",
      "Not designed for high-volume brick-and-mortar businesses",
    ],
    whatLibertySolves: [
      "Interchange-plus pricing substantially lower than PayPal's flat rate",
      "Stable merchant account without surprise holds",
      "Dedicated account rep who knows your business",
      "Cash discount programs available to offset processing costs",
      "Next-day funding for healthy cash flow",
    ],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
      { name: "E-Commerce Payment Processing", slug: "ecommerce-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Merchant Account", slug: "merchant-account" },
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  helcim: {
    name: "Helcim",
    fullName: "Helcim Inc.",
    slug: "helcim",
    category: "Interchange-Plus Processor",
    whyMerchantsLeave: [
      "Fully self-service — no dedicated account representative",
      "Limited phone support and slow response times",
      "No cash discount or dual pricing programs",
      "No free terminal for new merchants",
      "Smaller processor with less coverage for complex account types",
    ],
    whatLibertySolves: [
      "Dedicated account rep who answers the phone and knows your account",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "Free terminal for qualifying merchants",
      "Guided onboarding with personal go-live support",
      "Competitive interchange-plus markup with better service",
    ],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  "authorize-net": {
    name: "Authorize.net",
    fullName: "Authorize.net (a Visa solution)",
    slug: "authorize-net",
    category: "Payment Gateway",
    whyMerchantsLeave: [
      "$25/month gateway fee plus $0.10 per transaction creates a double-fee structure",
      "Requires a separate payment processor — two vendors, two billing relationships",
      "Older platform — less modern UX and integration options than newer alternatives",
      "No dedicated account representative",
      "Not optimized for in-person payment processing",
    ],
    whatLibertySolves: [
      "Single provider for processing and gateway — one billing relationship",
      "Transparent interchange-plus pricing with no separate gateway layer",
      "Dedicated account rep for all payment questions",
      "Better in-person terminal support and optimization",
      "Free statement review to quantify the savings",
    ],
    relatedIndustries: [
      { name: "E-Commerce Payment Processing", slug: "ecommerce-payment-processing" },
      { name: "Professional Services Payment Processing", slug: "professional-services-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Payment Gateway", slug: "payment-gateway" },
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  "shopify-payments": {
    name: "Shopify Payments",
    fullName: "Shopify Payments (Shopify Inc.)",
    slug: "shopify-payments",
    category: "Platform-Bundled Processing",
    whyMerchantsLeave: [
      "Rates of 2.4%–2.9% + $0.30 are high compared to interchange-plus pricing",
      "Processing is tied to your Shopify subscription — lose Shopify, lose payments",
      "Third-party processors incur an additional fee (0.5%–2%)",
      "Not optimized for in-person high-volume processing",
      "No cash discount or dual pricing programs",
    ],
    whatLibertySolves: [
      "Interchange-plus pricing not tied to any platform subscription",
      "Fully optimized for in-person payment processing",
      "Cash discount and dual pricing programs available",
      "No additional fee for using your preferred platform",
      "Free terminal for qualifying merchants",
    ],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
      { name: "E-Commerce Payment Processing", slug: "ecommerce-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  heartland: {
    name: "Heartland",
    fullName: "Heartland Payment Systems",
    slug: "heartland",
    category: "Large Merchant Processor",
    whyMerchantsLeave: [
      "3-year contracts with termination fees are standard",
      "Monthly fees often $20–$75, above market rates",
      "Tiered pricing obscures true cost for many merchants",
      "Equipment is frequently leased rather than sold",
      "Rate increase clauses buried in contracts",
    ],
    whatLibertySolves: [
      "No long-term contracts or termination penalties",
      "Transparent interchange-plus pricing from the start",
      "Monthly fees significantly lower — often $0–$9.95",
      "Free terminal for qualifying merchants",
      "Individual dedicated rep for personalized service",
    ],
    relatedIndustries: [
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  worldpay: {
    name: "Worldpay",
    fullName: "Worldpay (FIS Global)",
    slug: "worldpay",
    category: "Enterprise Payment Processor",
    whyMerchantsLeave: [
      "2–3 year contracts with significant termination fees",
      "Complex, opaque pricing with many fee layers",
      "Enterprise focus — small businesses feel underserved",
      "Slow to resolve issues for individual accounts",
      "Pricing difficult to understand or compare",
    ],
    whatLibertySolves: [
      "No long-term contracts — stay because the service is good",
      "Transparent interchange-plus statements you can read and verify",
      "Focused on small and mid-sized merchants — you are not an afterthought",
      "Dedicated rep who knows your account and responds quickly",
      "Free statement review before any commitment",
    ],
    relatedIndustries: [
      { name: "Professional Services Payment Processing", slug: "professional-services-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  fiserv: {
    name: "Fiserv",
    fullName: "Fiserv (First Data)",
    slug: "fiserv",
    category: "Large Payment Processor",
    whyMerchantsLeave: [
      "Three-year contracts with early termination fees of $500+",
      "Complex statements with many hard-to-understand fee lines",
      "Equipment leases add another long-term financial obligation",
      "Rate increases are common after the initial contract term",
      "Difficult to reach knowledgeable support for individual accounts",
    ],
    whatLibertySolves: [
      "No long-term contracts or equipment leases",
      "Transparent interchange-plus statements that are straightforward to read",
      "Free terminal for qualifying merchants",
      "Dedicated rep for individual account attention",
      "No surprise rate increases — pricing stays transparent",
    ],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
    ],
  },
  "gravity-payments": {
    name: "Gravity Payments",
    fullName: "Gravity Payments",
    slug: "gravity-payments",
    category: "Flat-Fee Processor",
    whyMerchantsLeave: [
      "Flat monthly fee model may cost more than percentage markup at certain volumes",
      "No cash discount or dual pricing programs",
      "Primarily Pacific Northwest focused — limited national coverage",
      "Fewer program options than full-service national providers",
    ],
    whatLibertySolves: [
      "Pure interchange-plus markup with no flat-fee layer",
      "Liberty Zero™ — pay $0 to accept cards (where eligible)*",
      "National coverage with local-level dedicated support",
      "Free terminal for qualifying merchants",
      "Full range of merchant program options",
    ],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "Cash Discount Program", slug: "cash-discount-program" },
    ],
  },
};

interface SwitchFromStep {
  title: string;
  detail: string;
}

interface SwitchFromInfo {
  howToCancel: SwitchFromStep[];
  whatToExpect: string;
  libertyHandles: string;
  timeline: string;
  whatYouNeed: string[];
}

const switchFromInfo: Record<string, SwitchFromInfo> = {
  square: {
    howToCancel: [
      { title: "Log into your Square Dashboard", detail: "Go to Account & Settings > Account > Deactivate Account. Square does not require advance written notice." },
      { title: "Download your data", detail: "Export your sales history, customer data, and item catalog from Square before deactivating. Go to Reports > Sales Summary > Export." },
      { title: "Return or keep Square hardware", detail: "Square hardware (readers, terminals) is not returned. Square Reader (free) can be discarded. Purchased Square Terminal/Stand are yours to keep or sell." },
      { title: "Notify your staff", detail: "Let employees know about the transition date and any new POS or terminal workflow changes." },
      { title: "Process your last Square batch", detail: "Make sure all transactions have been settled before deactivating. Check pending payouts and wait for final deposits." },
    ],
    whatToExpect: "The transition from Square typically takes 2–5 business days from application approval to live processing. Most merchants run parallel briefly — keeping Square active for existing transactions while the new account is set up.",
    libertyHandles: "Liberty Bancard handles the application, underwriting, equipment shipping (for qualifying merchants), terminal programming, and go-live support. You do not need to contact Square about your new processor — simply stop using Square once your Liberty Bancard account is active.",
    timeline: "Day 1–2: Submit application and Square statement. Day 2–3: Underwriting and approval. Day 3–5: Equipment shipped (or activated). Day 5: Live processing on Liberty Bancard.",
    whatYouNeed: [
      "Last 3 months of Square processing statements",
      "Business bank account information (for deposits)",
      "Business license or legal formation documents",
      "Social Security Number or EIN for underwriting",
      "Voided check or bank letter for funding setup",
    ],
  },
  stripe: {
    howToCancel: [
      { title: "Ensure all payouts are complete", detail: "Check your Stripe Dashboard for any pending payouts, open disputes, or unsettled transactions. Allow all funds to settle before closing." },
      { title: "Cancel active subscriptions or payment links", detail: "If you have Stripe Billing subscriptions, payment links, or recurring charges set up, migrate these to your new processor or cancel them in Stripe before closing." },
      { title: "Export your data", detail: "Download customer data, payment history, and any invoice records from Stripe. Go to Dashboard > Balance > Download CSV." },
      { title: "Close your Stripe account", detail: "In the Stripe Dashboard, go to Settings > Account > Close Account. You'll need to confirm the closure." },
    ],
    whatToExpect: "Stripe closure requires ensuring no pending funds remain. Because Stripe is often used for online transactions, migration includes updating payment integrations on your website or POS. Liberty Bancard will advise on gateway alternatives for any online processing needs.",
    libertyHandles: "Liberty Bancard manages in-person terminal setup, merchant account underwriting, and funding configuration. For online transaction migration, we advise on gateway options and connection methods. Your dedicated rep coordinates the transition to minimize downtime.",
    timeline: "Day 1–2: Application and Stripe statement review. Day 3: Approval and account setup. Day 4–7: Equipment and integration setup. Day 7–10: Fully live on Liberty Bancard.",
    whatYouNeed: [
      "Last 3 months of Stripe processing statements (CSV export)",
      "Business bank account information",
      "Business documentation for underwriting",
      "Current website platform (if online processing needed)",
      "Social Security Number or EIN",
    ],
  },
  clover: {
    howToCancel: [
      { title: "Review your contract for notice requirements", detail: "Clover contracts typically require 30–90 days written notice of non-renewal, sent to your reseller or directly to Clover. Check Section 2 of your merchant agreement for the exact timeline." },
      { title: "Calculate your termination cost", detail: "If mid-contract, calculate the early termination fee (usually $250–$500) plus any remaining equipment lease obligations. Determine whether savings from switching exceed these costs." },
      { title: "Determine equipment ownership", detail: "If you purchased Clover hardware, it may be reprogrammable (Clover devices are locked to Clover's network). In most cases, you will need new terminal hardware. Liberty Bancard provides free terminals for qualifying merchants." },
      { title: "Send written cancellation notice", detail: "Send written notice to your Clover reseller via certified mail or email with read receipt. Keep documentation of when notice was sent." },
      { title: "Confirm cancellation acknowledgment", detail: "Follow up to confirm your notice was received and the contract end date. Get confirmation in writing." },
    ],
    whatToExpect: "Because Clover devices are network-locked, you will need new terminal hardware when switching. Liberty Bancard ships free terminals to qualifying merchants. Plan for a 5–10 day transition from application to live processing with new equipment.",
    libertyHandles: "Liberty Bancard reviews your contract to identify the right transition timing, provides free terminals for qualifying merchants, handles all underwriting and account setup, and provides go-live support. We help you calculate the breakeven on any termination costs versus ongoing savings.",
    timeline: "Day 1: Contract review and application. Day 2–3: Underwriting and approval. Day 3–7: Terminal shipping. Day 7–10: Live on Liberty Bancard with new equipment.",
    whatYouNeed: [
      "Last 3 months of Clover processing statements",
      "Your merchant agreement (to review termination terms)",
      "Business bank account information",
      "Business documentation for underwriting",
      "Physical address for terminal delivery",
    ],
  },
  toast: {
    howToCancel: [
      { title: "Review your Toast contract termination terms", detail: "Toast contracts typically run 24–36 months with early termination fees that can exceed $10,000. Review Section 8 (or your contract's termination section) carefully before proceeding." },
      { title: "Assess equipment financing obligations", detail: "If you financed Toast hardware, those payments continue independently of your processing contract. Calculate total financial obligations before your transition decision." },
      { title: "Plan your POS transition", detail: "Because Toast bundles POS and processing, switching processors means transitioning your POS system simultaneously. Liberty Bancard can advise on compatible restaurant POS alternatives." },
      { title: "Send written notice of non-renewal", detail: "If your contract is near renewal, send written notice (certified mail) at least 30–90 days before the renewal date to avoid auto-renewal." },
      { title: "Coordinate go-live timing", detail: "For restaurants, plan the transition for a slow business period — typically a Monday or Tuesday morning during an off-peak week." },
    ],
    whatToExpect: "The Toast transition is more complex than simpler processor switches because it involves both processing and POS. Expect a 10–21 day transition period, including POS selection, installation, and training. Minimize disruption by planning the live date on a low-volume day.",
    libertyHandles: "Liberty Bancard reviews your Toast contract, helps identify the most cost-effective exit strategy, advises on restaurant POS alternatives, provides terminal and integration setup, and supports your team through the go-live process. We schedule go-live for your lowest-volume period.",
    timeline: "Week 1: Contract review, POS selection, application. Week 2: Underwriting, equipment ordering, POS setup. Week 3: Staff training, go-live on Liberty Bancard.",
    whatYouNeed: [
      "Last 3 months of Toast processing statements",
      "Toast merchant agreement (for termination review)",
      "Equipment financing agreements (if applicable)",
      "Business bank account information",
      "Restaurant layout/station count for hardware planning",
    ],
  },
  paypal: {
    howToCancel: [
      { title: "Ensure all transactions are settled", detail: "Check your PayPal balance for any pending payments, disputes in progress, or open cases. Allow all funds to disburse before closing." },
      { title: "Transfer your balance", detail: "Withdraw any remaining balance from your PayPal Business account to your bank account before initiating closure." },
      { title: "Cancel recurring transactions", detail: "If you have recurring billing or subscription payments set up in PayPal, migrate these to your new processor first." },
      { title: "Close your PayPal Business account", detail: "In the PayPal app or web: Settings > Account > Account Type > Close Account. You must have a zero balance to close." },
    ],
    whatToExpect: "PayPal account closure is straightforward once your balance is zero and disputes are resolved. Because PayPal is often used as a checkout option (not just processing), some businesses keep PayPal as a customer-facing option while switching their primary card processing to Liberty Bancard.",
    libertyHandles: "Liberty Bancard sets up your primary card processing account — in-person terminals, and if needed, online gateway connections. You can continue to offer PayPal as a supplementary checkout option for customers who prefer it while using Liberty Bancard for all traditional card processing.",
    timeline: "Day 1–2: Application and PayPal statement review. Day 2–3: Approval. Day 3–5: Equipment and account setup. Day 5: Live on Liberty Bancard.",
    whatYouNeed: [
      "Last 3 months of PayPal transaction reports",
      "Business bank account information",
      "Business documentation for underwriting",
      "Physical address for terminal delivery (if in-person)",
      "Social Security Number or EIN",
    ],
  },
  helcim: {
    howToCancel: [
      { title: "Confirm no outstanding balance or disputes", detail: "Review your Helcim account for any unresolved chargebacks or pending transactions." },
      { title: "Contact Helcim support to close the account", detail: "Helcim does not have long-term contracts. Email or message support to initiate account closure. There are no termination fees." },
      { title: "Download your account data", detail: "Export transaction history and any customer records before closing." },
    ],
    whatToExpect: "Helcim has no long-term contracts, so switching is straightforward. The primary transition work is equipment — if you use Helcim-compatible hardware, Liberty Bancard will confirm compatibility or provide a free replacement terminal for qualifying merchants.",
    libertyHandles: "Liberty Bancard sets up your account, confirms or replaces your terminal hardware, and provides a dedicated account rep going forward. The migration is typically complete within 3–5 business days.",
    timeline: "Day 1–2: Application and account review. Day 2–3: Approval. Day 3–5: Equipment confirmation and go-live.",
    whatYouNeed: [
      "Last 3 months of Helcim processing statements",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
  "authorize-net": {
    howToCancel: [
      { title: "Notify your payment processor", detail: "Authorize.net is a gateway, so you also need to cancel the separate payment processor you paired with it. Contact both vendors." },
      { title: "Update your website or POS integration", detail: "If Authorize.net is connected to your website's shopping cart, you will need to update the payment gateway integration when switching. Coordinate this update with your web developer." },
      { title: "Cancel your Authorize.net account", detail: "Contact Authorize.net customer support to cancel. There is a monthly fee that will stop billing once the account is closed." },
      { title: "Export transaction data", detail: "Download your transaction history and customer profiles before closing the account." },
    ],
    whatToExpect: "Switching from Authorize.net involves a technical update to any website or POS that used it as a gateway. Liberty Bancard will advise on alternative gateway connections and coordinate the migration with minimal downtime.",
    libertyHandles: "Liberty Bancard handles the processing account setup and advises on gateway alternatives for online integrations. Your dedicated rep coordinates the technical migration support with your team.",
    timeline: "Day 1–3: Application, statement review, and gateway assessment. Day 3–7: Approval and integration planning. Day 7–14: Go-live (timeline depends on website integration complexity).",
    whatYouNeed: [
      "Last 3 months of processing statements (from your paired processor)",
      "Current website platform and shopping cart information",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
  "shopify-payments": {
    howToCancel: [
      { title: "Add a third-party processor before removing Shopify Payments", detail: "Set up your new Liberty Bancard account first. Once approved, you can add it to Shopify as a third-party processor (note the additional Shopify fee applies unless you change plans)." },
      { title: "Disable Shopify Payments in your dashboard", detail: "In Shopify Admin > Settings > Payments, select your third-party processor and remove Shopify Payments from active status." },
      { title: "Update any in-person POS", detail: "If using Shopify POS hardware, you may need to replace it with Liberty Bancard-compatible terminals." },
      { title: "Verify checkout is working on the new processor", detail: "Place a test transaction before going fully live to confirm the new payment connection is working." },
    ],
    whatToExpect: "Shopify's third-party processor fee (0.5%–2%) applies if you use Liberty Bancard through Shopify's checkout. Many merchants find that even with this fee, interchange-plus pricing still produces meaningful savings at volume. For in-person processing, the third-party fee does not apply.",
    libertyHandles: "Liberty Bancard handles in-person terminal setup and all processing account configuration. For online checkout, we advise on the most cost-effective integration approach given your Shopify plan and transaction volume.",
    timeline: "Day 1–3: Application and statement review. Day 3–5: Approval and account setup. Day 5–7: Terminal and integration setup. Day 7: Live on Liberty Bancard.",
    whatYouNeed: [
      "Last 3 months of Shopify Payments reports",
      "Shopify plan level (for third-party fee calculation)",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
  heartland: {
    howToCancel: [
      { title: "Review your contract for notice requirements", detail: "Heartland contracts typically run 3 years with written notice required 30–90 days before renewal. Check your merchant agreement for the exact notice period and send via certified mail." },
      { title: "Calculate termination costs", detail: "If mid-contract, early termination fees are typically $250–$500 plus any remaining equipment lease obligations. Calculate total cost versus ongoing savings." },
      { title: "Determine equipment status", detail: "Whether you own or lease your terminals. Owned equipment can be reprogrammed or replaced. Leased equipment obligations continue separately." },
      { title: "Send formal written notice", detail: "Send your cancellation notice to the address specified in your agreement via certified mail with return receipt. Keep all documentation." },
    ],
    whatToExpect: "Heartland transitions vary by contract terms. For merchants near renewal, the switch is clean and typically takes 5–10 days. Mid-contract switches require termination fee analysis to confirm the math favors switching despite the fee.",
    libertyHandles: "Liberty Bancard reviews your Heartland contract, calculates termination vs savings analysis, provides equipment for qualifying merchants, handles all underwriting and account setup, and provides go-live support.",
    timeline: "Day 1–2: Contract review and application. Day 2–4: Underwriting and approval. Day 4–10: Equipment setup and go-live.",
    whatYouNeed: [
      "Last 3 months of Heartland processing statements",
      "Heartland merchant agreement",
      "Business bank account information",
      "Business documentation for underwriting",
      "Physical address for terminal delivery if needed",
    ],
  },
  worldpay: {
    howToCancel: [
      { title: "Review contract notice requirements", detail: "Worldpay contracts require written notice (typically 30–90 days) before the renewal date. Review your agreement for the exact requirement and note the auto-renewal date." },
      { title: "Send written cancellation notice", detail: "Send your notice via certified mail to the address in your merchant agreement. Include your merchant ID and requested closure date." },
      { title: "Resolve any open disputes or chargebacks", detail: "Ensure all chargebacks and disputes are resolved before closing. Worldpay can hold funds post-closure for dispute resolution." },
      { title: "Confirm closure confirmation in writing", detail: "Follow up until you receive written confirmation of account closure and the final statement." },
    ],
    whatToExpect: "Worldpay transitions are clean once the notice period is satisfied. Equipment compatibility should be verified — some Worldpay terminals can be reprogrammed; others need replacement. Liberty Bancard provides free terminals for qualifying merchants.",
    libertyHandles: "Liberty Bancard manages the full transition: contract review, application, underwriting, equipment, and go-live support. Your dedicated rep is your single point of contact from day one.",
    timeline: "Day 1–2: Application and statement review. Day 3–5: Underwriting and approval. Day 5–10: Equipment setup and go-live.",
    whatYouNeed: [
      "Last 3 months of Worldpay processing statements",
      "Worldpay merchant agreement",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
  fiserv: {
    howToCancel: [
      { title: "Locate your merchant agreement and equipment lease", detail: "Fiserv often involves both a processing agreement AND a separate equipment lease — two distinct contracts. Review both for termination terms." },
      { title: "Send written notice of non-renewal or cancellation", detail: "Fiserv processing agreements require written notice typically 30–90 days before renewal. Equipment leases have separate notice requirements. Send both via certified mail." },
      { title: "Return or address leased equipment", detail: "If you have leased equipment, the lease continues even if you cancel processing. Review options: returning equipment, paying off the lease, or continuing lease payments while using new equipment." },
      { title: "Confirm final billing and closure", detail: "Request written confirmation of your account closure date and final statement to ensure no additional fees are charged." },
    ],
    whatToExpect: "Fiserv transitions can be complex due to the multi-contract structure (processing + equipment lease). Liberty Bancard helps you navigate both contracts and provides free terminals for qualifying merchants so you can start fresh without equipment hassle.",
    libertyHandles: "Liberty Bancard reviews both your processing contract and equipment lease, helps you calculate the full cost of switching (including any lease obligations), provides free terminals for qualifying merchants, and handles all account setup with dedicated onboarding support.",
    timeline: "Day 1–3: Contract review and application. Day 3–5: Underwriting and approval. Day 5–14: Equipment and go-live (timeline varies based on contract situation).",
    whatYouNeed: [
      "Last 3 months of Fiserv processing statements",
      "Fiserv merchant processing agreement",
      "Equipment lease agreement (if applicable)",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
  "gravity-payments": {
    howToCancel: [
      { title: "Confirm no outstanding obligations", detail: "Gravity Payments operates without long-term contracts, so cancellation is straightforward. Confirm no pending transactions or disputes." },
      { title: "Contact Gravity Payments to close account", detail: "Notify Gravity Payments support of your intention to close. There are no early termination fees." },
      { title: "Export your data", detail: "Download transaction history before closing." },
    ],
    whatToExpect: "Because Gravity Payments has no long-term contracts, the transition is simple. Switching typically takes 3–7 days from application to live processing with Liberty Bancard.",
    libertyHandles: "Liberty Bancard handles account setup, equipment (free for qualifying merchants), and provides a dedicated account rep — addressing the primary reason merchants leave Gravity for a more full-service provider.",
    timeline: "Day 1–2: Application and statement review. Day 2–4: Underwriting and approval. Day 4–7: Equipment and go-live.",
    whatYouNeed: [
      "Last 3 months of Gravity Payments statements",
      "Business bank account information",
      "Business documentation for underwriting",
    ],
  },
};

export function renderAlternativesHtml(competitorSlug: string): string {
  const info = competitorInfo[competitorSlug];
  if (!info) return "";

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": `${info.name} Alternatives`, "item": `https://libertybancard.com/alternatives/${info.slug}` }
    ]
  });

  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": `What is the best alternative to ${info.name} for businesses?`,
        "acceptedAnswer": { "@type": "Answer", "text": `Liberty Bancard is a leading alternative to ${info.name}, offering interchange-plus pricing, dedicated account representation, and cash discount programs that ${info.name} does not provide. Most merchants switching from ${info.name} to Liberty Bancard see meaningful cost reductions within the first month.` }
      },
      {
        "@type": "Question",
        "name": `Why do merchants leave ${info.name}?`,
        "acceptedAnswer": { "@type": "Answer", "text": info.whyMerchantsLeave.join(" ") }
      }
    ]
  });

  const whyLeaveHtml = info.whyMerchantsLeave.map(r => `<li>${escHtml(r)}</li>`).join("\n");
  const whatLibertySolvesHtml = info.whatLibertySolves.map(r => `<li>${escHtml(r)}</li>`).join("\n");
  const industryLinksHtml = info.relatedIndustries.map(i => `<a href="/industries/${escHtml(i.slug)}" class="internal-link">${escHtml(i.name)}</a>`).join(" | ");
  const glossaryLinksHtml = info.relatedGlossary.map(g => `<a href="/learn/${escHtml(g.slug)}" class="internal-link">${escHtml(g.name)}</a>`).join(" | ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(info.name)} Alternatives for Merchants | Liberty Bancard</title>
<meta name="description" content="Researching alternatives to ${escHtml(info.name)}? See why merchants switch to Liberty Bancard — transparent interchange-plus pricing, dedicated support, and cash discount programs.">
<meta property="og:title" content="${escHtml(info.name)} Alternatives for Merchants | Liberty Bancard">
<meta property="og:description" content="See why merchants choose Liberty Bancard as their ${escHtml(info.name)} alternative. Transparent pricing, dedicated support, and better costs.">
<meta property="og:url" content="https://libertybancard.com/alternatives/${info.slug}">
<link rel="canonical" href="https://libertybancard.com/alternatives/${info.slug}">
<script type="application/ld+json">${breadcrumbSchema}</script>
<script type="application/ld+json">${faqSchema}</script>
${sharedStyles()}
</head>
<body>
${ssrNavbar()}
<nav class="breadcrumb"><a href="/">Home</a><span>›</span>${escHtml(info.name)} Alternatives</nav>
<header class="page-header">
<div class="page-header-inner">
<div class="page-badge">Alternatives to ${escHtml(info.name)}</div>
<h1>If ${escHtml(info.name)} Isn't Right for Your Business, Here Are Your Options</h1>
<p class="page-subhead">Thousands of merchants research ${escHtml(info.name)} alternatives every month. This page explains why they look, what they find, and why so many choose Liberty Bancard.</p>
</div>
</header>
<main class="page-body">
<section class="content-section">
<h2>Why Merchants Research ${escHtml(info.name)} Alternatives</h2>
<p>${escHtml(info.name)} (${escHtml(info.fullName)}) is a well-known name in payment processing. But knowing a brand doesn't mean it's the best fit for your business. Here are the most common reasons merchants start looking for alternatives:</p>
<ul class="reason-list">${whyLeaveHtml}</ul>
</section>

<section class="content-section">
<h2>What Liberty Bancard Solves</h2>
<p>Liberty Bancard is built as a merchant-first alternative to processors like ${escHtml(info.name)}. Here's what changes when you switch:</p>
<ul class="solution-list">${whatLibertySolvesHtml}</ul>
</section>

<section class="content-section compare-cta-section">
<h2>See the Side-by-Side Comparison</h2>
<p>We've built a complete comparison page showing Liberty Bancard vs ${escHtml(info.name)} across pricing, contracts, support, and programs.</p>
<a href="/compare/${escHtml(info.slug)}" class="btn-primary">View Liberty Bancard vs ${escHtml(info.name)}</a>
</section>

<section class="content-section cta-section">
<h2>The Most Important Step: Know Your Current Cost</h2>
<p>Before comparing alternatives, you need to know what you actually pay — not just your quoted rate, but your effective rate including all fees. Upload your processing statement and get a free line-by-line analysis. We show you exactly what ${escHtml(info.name)} is charging and what you could be paying with Liberty Bancard.</p>
<a href="/upload-statement" class="btn-primary">Get Your Free Statement Analysis</a>
<a href="/compare/${escHtml(info.slug)}" class="btn-secondary">See Full ${escHtml(info.name)} Comparison</a>
</section>

<section class="content-section">
<h2>Switching From ${escHtml(info.name)}</h2>
<p>If you decide ${escHtml(info.name)} isn't right and you're ready to switch, we've put together a complete guide on how to make the transition smooth and risk-free.</p>
<a href="/switch-from/${escHtml(info.slug)}" class="internal-link">→ How to Switch From ${escHtml(info.name)}</a>
</section>

<section class="content-section">
<h2>Related Resources</h2>
<div class="link-grid">
<div><strong>Industry Pages</strong><br>${industryLinksHtml}</div>
<div><strong>Learn More</strong><br>${glossaryLinksHtml}</div>
</div>
</section>
</main>
${ssrFooter()}
</body>
</html>`;
}

export function renderSwitchFromHtml(competitorSlug: string): string {
  const info = competitorInfo[competitorSlug];
  const switchInfo = switchFromInfo[competitorSlug];
  if (!info || !switchInfo) return "";

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": `Switch From ${info.name}`, "item": `https://libertybancard.com/switch-from/${info.slug}` }
    ]
  });

  const howToCancelHtml = switchInfo.howToCancel.map((step, i) =>
    `<div class="step-item"><div class="step-number">${i + 1}</div><div class="step-content"><h3>${escHtml(step.title)}</h3><p>${escHtml(step.detail)}</p></div></div>`
  ).join("\n");

  const whatYouNeedHtml = switchInfo.whatYouNeed.map(item => `<li>${escHtml(item)}</li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>How to Switch From ${escHtml(info.name)} | Liberty Bancard</title>
<meta name="description" content="Complete guide to switching from ${escHtml(info.name)} to Liberty Bancard. Step-by-step instructions for canceling your ${escHtml(info.name)} account and transitioning smoothly.">
<meta property="og:title" content="How to Switch From ${escHtml(info.name)} | Liberty Bancard">
<meta property="og:description" content="Step-by-step guide to canceling ${escHtml(info.name)} and switching to Liberty Bancard. We handle the transition for you.">
<meta property="og:url" content="https://libertybancard.com/switch-from/${info.slug}">
<link rel="canonical" href="https://libertybancard.com/switch-from/${info.slug}">
<script type="application/ld+json">${breadcrumbSchema}</script>
${sharedStyles()}
<style>
.step-item { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: flex-start; }
.step-number { background: #3b82f6; color: #fff; width: 2rem; height: 2rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 0.875rem; }
.step-content h3 { font-size: 1.05rem; font-weight: 600; color: #0f172a; margin-bottom: 0.4rem; }
.step-content p { color: #475569; font-size: 0.95rem; margin: 0; }
.info-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; }
.info-box h3 { color: #0369a1; font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
.info-box p { color: #0c4a6e; margin: 0; font-size: 0.95rem; }
</style>
</head>
<body>
${ssrNavbar()}
<nav class="breadcrumb"><a href="/">Home</a><span>›</span>How to Switch From ${escHtml(info.name)}</nav>
<header class="page-header">
<div class="page-header-inner">
<div class="page-badge">Processor Migration Guide</div>
<h1>How to Switch From ${escHtml(info.name)} to Liberty Bancard</h1>
<p class="page-subhead">A practical, step-by-step guide for merchants who've already decided to leave ${escHtml(info.name)} — what to do, what to expect, and how Liberty Bancard handles the transition for you.</p>
</div>
</header>
<main class="page-body">

<section class="content-section">
<h2>How to Cancel Your ${escHtml(info.name)} Account</h2>
${howToCancelHtml}
</section>

<section class="content-section">
<h2>What to Expect During the Transition</h2>
<p>${escHtml(switchInfo.whatToExpect)}</p>
</section>

<div class="info-box">
<h3>Timeline</h3>
<p>${escHtml(switchInfo.timeline)}</p>
</div>

<section class="content-section">
<h2>How Liberty Bancard Handles the Switch for You</h2>
<p>${escHtml(switchInfo.libertyHandles)}</p>
</section>

<section class="content-section">
<h2>What You Need to Get Started</h2>
<ul class="reason-list">${whatYouNeedHtml}</ul>
</section>

<section class="content-section cta-section">
<h2>Ready to Start?</h2>
<p>Upload your ${escHtml(info.name)} statement and we'll handle the rest — statement review, application, underwriting, equipment, and go-live support. Most merchants are fully live within a week.</p>
<a href="/upload-statement" class="btn-primary">Upload Your Statement to Start</a>
<a href="/compare/${escHtml(info.slug)}" class="btn-secondary">See Liberty Bancard vs ${escHtml(info.name)}</a>
</section>

</main>
${ssrFooter()}
</body>
</html>`;
}

export function getAvailableCompetitorSlugs(): string[] {
  return Object.keys(competitorInfo);
}

function sharedStyles(): string {
  return `<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.7; }
.site-header { background: #0f172a; padding: 1rem 2rem; }
.site-header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 1.25rem; }
nav.breadcrumb { padding: 1rem 2rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem; color: #64748b; }
nav.breadcrumb a { color: #3b82f6; text-decoration: none; }
nav.breadcrumb span { margin: 0 0.5rem; }
.page-header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); color: #fff; padding: 4rem 2rem 3rem; }
.page-header-inner { max-width: 860px; margin: 0 auto; }
.page-badge { display: inline-block; background: rgba(59,130,246,0.3); color: #93c5fd; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem; }
.page-header h1 { font-size: clamp(1.75rem, 4vw, 2.75rem); font-weight: 800; line-height: 1.2; margin-bottom: 1.25rem; }
.page-subhead { font-size: 1.125rem; color: #cbd5e1; line-height: 1.6; }
.page-body { max-width: 860px; margin: 0 auto; padding: 3rem 2rem; }
.content-section { margin-bottom: 3rem; }
.content-section h2 { font-size: 1.625rem; font-weight: 700; margin-bottom: 1rem; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
.content-section p { color: #334155; font-size: 1.05rem; margin-bottom: 1rem; }
.reason-list, .solution-list { margin: 1rem 0 1rem 1.5rem; }
.reason-list li, .solution-list li { margin-bottom: 0.6rem; color: #334155; }
.solution-list li { color: #166534; }
.solution-list { background: #f0fdf4; border-radius: 8px; padding: 1rem 1rem 1rem 2.5rem; }
.cta-section { background: linear-gradient(135deg, #0f172a, #1e3a5f); border-radius: 12px; padding: 2rem; color: #fff; }
.cta-section h2 { color: #fff; border-bottom-color: rgba(255,255,255,0.2); }
.cta-section p { color: #e2e8f0; }
.compare-cta-section { background: #f8fafc; border-radius: 12px; padding: 2rem; }
.btn-primary { display: inline-block; background: #3b82f6; color: #fff; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; margin-top: 1rem; margin-right: 1rem; }
.btn-primary:hover { background: #2563eb; }
.btn-secondary { display: inline-block; background: rgba(255,255,255,0.15); color: #fff; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; margin-top: 1rem; border: 1px solid rgba(255,255,255,0.3); }
.btn-secondary:hover { background: rgba(255,255,255,0.25); }
.compare-cta-section .btn-primary { margin-top: 0.75rem; }
.internal-link { color: #3b82f6; text-decoration: none; font-weight: 500; }
.internal-link:hover { text-decoration: underline; }
.link-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem; }
.link-grid div { padding: 1rem; background: #f8fafc; border-radius: 8px; }
.link-grid strong { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
.site-footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 2rem; margin-top: 4rem; font-size: 0.875rem; }
.site-footer a { color: #60a5fa; text-decoration: none; }
@media (max-width: 640px) { .page-header, .page-body, nav.breadcrumb { padding-left: 1rem; padding-right: 1rem; } .link-grid { grid-template-columns: 1fr; } }
</style>`;
}
