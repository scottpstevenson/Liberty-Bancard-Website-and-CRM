import { ssrNavbar, ssrFooter, SSR_CHROME_CSS } from "../ssrShared";
import { serializeJsonLd } from "../../shared/json-ld";
import { TIMING_NOTE } from "../../shared/public-disclosures";
import { COMPARE_ENTRIES } from "../../shared/compare-content";
import { claimText } from "../../shared/public-claims";

// Three pages answer three different questions about a provider, so they do not repeat one another:
//   /compare/<slug>      dated, sourced list prices and a side-by-side table (server/ssr/compare.ts)
//   /alternatives/<slug> what to weigh when choosing another provider (this file)
//   /switch-from/<slug>  which questions to answer from your own agreement before changing (this file)
//
// Nothing here states what a named provider charges, how long its contracts run, what it holds, or how its
// support performs; none of that has a source in this repository. Provider-specific lines are questions to
// check against the visitor's own agreement and statements, or facts already carried by the dated price
// records and the approved claim registry.

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
  /** Extra comparison questions that only make sense for this kind of provider. */
  fitExtras: string[];
  /** Extra agreement questions that only make sense for this kind of provider. */
  agreementExtras: string[];
  relatedIndustries: { name: string; slug: string }[];
  relatedGlossary: { name: string; slug: string }[];
}

/** What to weigh whichever provider is being replaced. */
const COMMON_FIT_CRITERIA: string[] = [
  "Total monthly cost on your own statement, not only the headline rate: add every percentage, per-transaction and monthly line.",
  "Your card mix (debit, credit, rewards, keyed or online) and your average ticket, because both change what each pricing model costs you.",
  "How the provider is paid: one flat rate, interchange plus a markup, tiered categories, or a cash discount or surcharging program.",
  "How quickly funds reach your bank, and what the agreement says about reserves and account review.",
  "Which equipment you need, and whether it is leased, financed, rented or purchased.",
  "Which software or point-of-sale system you must keep, and whether it works with a different processor.",
  "How you would reach someone about a deposit or a chargeback.",
];

/** Pricing-model note by provider category. These describe the model, not the named provider's conduct. */
const CATEGORY_NOTES: Record<string, string> = {
  "Flat-Rate Processor":
    "A flat-rate plan quotes one percentage, often with a per-transaction amount, that covers interchange, network assessments and the processor's charge together. To compare it, set it beside the three groups of charges on an interchange-plus statement.",
  "Developer Payment Platform":
    "A developer platform is built around its software interface. Decide which in-person acceptance, terminals and reporting you need, and confirm with each provider what it supports.",
  "Bundled POS and Processing":
    "When point-of-sale software and processing are sold together, the agreement may tie the two. Check what it says about using a different processor.",
  "Restaurant POS and Processing":
    "When restaurant software and processing are sold together, the agreement may tie the two. Check what it says about using a different processor, and list the software features your kitchen and front of house rely on.",
  "Consumer Payment Platform":
    "A consumer payment platform may also be used as a checkout option alongside processing. Decide whether you want to keep it for customers who prefer it while you review how everything else is processed.",
  "Interchange-Plus Processor":
    "Interchange-plus pricing separates the card networks' charges from the processor's markup. Compare the markup, per-transaction fees and monthly fees in each written quote on the same monthly volume.",
  "Payment Gateway":
    "A gateway connects your checkout to a processor. Depending on the plan, processing may be priced under a separate merchant account agreement, so compare the gateway fee and the processing fees together.",
  "Platform-Bundled Processing":
    "When processing comes with an e-commerce platform plan, check what the plan says about using a third-party processor, including any additional platform fee.",
  "Large Merchant Processor":
    "Compare the term, renewal and notice provisions with any early termination fee, and compare tiered or bundled pricing with a line-by-line breakdown of your statement.",
  "Enterprise Payment Processor":
    "Compare the term, renewal and notice provisions with any early termination fee, and ask for pricing in a form you can compare line by line.",
  "Large Payment Processor":
    "Compare the processing agreement and any separate equipment agreement, and ask for pricing in a form you can compare line by line.",
  "Flat-Rate or Custom-Priced Processor":
    "Some providers offer a flat-rate plan or customized pricing, and which one applies depends on the plan you signed. Ask which model your agreement uses, then compare its written fee lines with the three groups of charges on an interchange-plus statement.",
};

const competitorInfo: Record<string, CompetitorInfo> = {
  square: {
    name: "Square",
    fullName: "Square (Block, Inc.)",
    slug: "square",
    category: "Flat-Rate Processor",
    fitExtras: ["If you use Square hardware or software, list which of it would keep working with a different processor and which would be replaced."],
    agreementExtras: ["Which Square products, such as hardware, invoices or online checkout, are attached to the account you would change?"],
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
    fitExtras: ["If your website, invoices or subscriptions connect to Stripe, list each connection; each would need to move or stay."],
    agreementExtras: ["Which subscriptions, payment links or stored customer payment details sit in the account, and where would they go?"],
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
    fitExtras: ["If your Clover equipment came with a lease or financing, find that agreement and read what it says about ending it."],
    agreementExtras: ["Which agreement covers the Clover hardware and software, and is it separate from the processing agreement?"],
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
    fitExtras: ["Ask whether your Toast agreement ties the software to its processing, and what changing either one would involve."],
    agreementExtras: ["Does the agreement cover software, hardware and processing together, and what does it say about each if one changes?"],
    relatedIndustries: [{ name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" }],
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
    fitExtras: ["If customers pay through PayPal buttons, invoices or payment links, decide which of those you want to keep."],
    agreementExtras: ["What balance, open disputes or recurring payments are in the account today?"],
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
    fitExtras: ["Ask each provider for the markup, per-transaction fee, monthly fees and equipment charges in writing so the quotes line up."],
    agreementExtras: ["Which terminals or software came from the provider, and who is billing you for them?"],
    relatedIndustries: [{ name: "Retail Payment Processing", slug: "retail-payment-processing" }],
    relatedGlossary: [{ name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" }],
  },
  "authorize-net": {
    name: "Authorize.net",
    fullName: "Authorize.net (a Visa solution)",
    slug: "authorize-net",
    category: "Payment Gateway",
    fitExtras: [
      claimText("compat.inquiry"),
      "On the Gateway Only plan the merchant account is separate, so processing is priced under a second agreement.",
    ],
    agreementExtras: [
      "Authorize.net's All-in-One plan includes the merchant account and gateway. On the Gateway Only plan the merchant account is separate, so check each agreement that bills you.",
      "Which websites, shopping carts or point-of-sale systems connect to the gateway today?",
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
    fitExtras: ["Check your Shopify plan for what it says about using a third-party processor, including any additional platform fee."],
    agreementExtras: ["Which Shopify plan are you on, and what does it say about payments from another processor?"],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
      { name: "E-Commerce Payment Processing", slug: "ecommerce-payment-processing" },
    ],
    relatedGlossary: [{ name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" }],
  },
  heartland: {
    name: "Heartland",
    fullName: "Heartland Payment Systems",
    slug: "heartland",
    category: "Large Merchant Processor",
    fitExtras: ["If your statement groups transactions into categories, ask which category each of your typical sales falls into."],
    agreementExtras: ["Does the agreement allow rate changes during the term, and how must you be told?"],
    relatedIndustries: [
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [{ name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" }],
  },
  worldpay: {
    name: "Worldpay",
    fullName: "Worldpay (a Global Payments company)",
    slug: "worldpay",
    category: "Enterprise Payment Processor",
    fitExtras: ["Ask for the full list of fee lines on your statement and what each one pays for."],
    agreementExtras: ["Does the agreement renew automatically, and by what date must notice be given?"],
    relatedIndustries: [
      { name: "Professional Services Payment Processing", slug: "professional-services-payment-processing" },
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
    ],
    relatedGlossary: [{ name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" }],
  },
  fiserv: {
    name: "Fiserv",
    fullName: "Fiserv (First Data)",
    slug: "fiserv",
    category: "Large Payment Processor",
    fitExtras: ["If a separate equipment agreement exists, read it next to the processing agreement and total both."],
    agreementExtras: ["Is there a processing agreement and a separate equipment agreement, and does each state its own term and notice?"],
    relatedIndustries: [
      { name: "Retail Payment Processing", slug: "retail-payment-processing" },
      { name: "Restaurant Payment Processing", slug: "restaurant-payment-processing" },
    ],
    relatedGlossary: [{ name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" }],
  },
  "gravity-payments": {
    name: "Gravity Payments",
    fullName: "Gravity Payments",
    slug: "gravity-payments",
    category: "Flat-Rate or Custom-Priced Processor",
    fitExtras: ["Ask which pricing plan your agreement uses and which fee lines it lists, then total them at your own monthly volume before comparing."],
    agreementExtras: ["What does the agreement say about ending service, and are any fees owed on closing?"],
    relatedIndustries: [{ name: "Retail Payment Processing", slug: "retail-payment-processing" }],
    relatedGlossary: [
      { name: "Interchange-Plus Pricing", slug: "interchange-plus-pricing" },
      { name: "Cash Discount Program", slug: "cash-discount-program" },
    ],
  },
};

/** What to answer from your own agreement before changing, whichever provider you have. */
const COMMON_AGREEMENT_QUESTIONS: string[] = [
  "What is the term, and does the agreement renew automatically?",
  "How is notice given, to whom, and how far ahead of the renewal date?",
  "Is there an early termination fee, and how is it calculated?",
  "Is any equipment leased, financed or rented, and which agreement covers it?",
  "Are recurring charges, subscriptions or stored customer payment details attached to the account?",
  "Can you export your sales and customer records, and in what format?",
  "What happens to pending settlements, chargebacks and disputes after the account closes?",
];

function listHtml(items: string[], className = "reason-list"): string {
  return `<ul class="${className}">${items.map((item) => `<li>${escHtml(item)}</li>`).join("\n")}</ul>`;
}

function pageHead(opts: { title: string; description: string; path: string; schemas: unknown[]; extraStyle?: string }): string {
  const url = `https://libertybancard.com${opts.path}`;
  // Same programmatic social card the other server-rendered pages use (see ssrShared.ts): /og/default/<path-with-dashes>.png.
  const ogImage = `https://libertybancard.com/og/default/${encodeURIComponent(opts.path.replace(/^\//, "").replace(/\//g, "-") || "home")}.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(opts.title)}</title>
<meta name="description" content="${escHtml(opts.description)}">
<meta property="og:title" content="${escHtml(opts.title)}">
<meta property="og:description" content="${escHtml(opts.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(opts.title)}">
<meta name="twitter:description" content="${escHtml(opts.description)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="canonical" href="${url}">
${opts.schemas.map((schema) => `<script type="application/ld+json">${serializeJsonLd(schema)}</script>`).join("\n")}
${sharedStyles()}
${opts.extraStyle ?? ""}
</head>`;
}

export function renderAlternativesHtml(competitorSlug: string): string {
  const info = competitorInfo[competitorSlug];
  if (!info) return "";

  const name = info.name;
  const hasPublishedRates = (COMPARE_ENTRIES[info.slug]?.records.length ?? 0) > 0;
  const criteria = [...COMMON_FIT_CRITERIA, ...info.fitExtras];
  const categoryNote = CATEGORY_NOTES[info.category] ?? "";

  const faq = [
    {
      question: `What should I compare before choosing an alternative to ${name}?`,
      answer: `Compare total monthly cost on your own statement, your card mix and average ticket, how each provider is paid, funding timing, equipment, the software you must keep and how you would reach support. ${claimText("review.process.summary")}`,
    },
    {
      question: "Does a statement review cost anything?",
      answer: claimText("review.cost.free"),
    },
  ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com" },
      { "@type": "ListItem", position: 2, name: `${name} alternatives`, item: `https://libertybancard.com/alternatives/${info.slug}` },
    ],
  };
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };

  const industryLinksHtml = info.relatedIndustries.map((i) => `<a href="/industries/${escHtml(i.slug)}" class="internal-link">${escHtml(i.name)}</a>`).join(" | ");
  const glossaryLinksHtml = info.relatedGlossary.map((g) => `<a href="/learn/${escHtml(g.slug)}" class="internal-link">${escHtml(g.name)}</a>`).join(" | ");
  const faqHtml = faq.map((f) => `<h3>${escHtml(f.question)}</h3>\n<p>${escHtml(f.answer)}</p>`).join("\n");

  return `${pageHead({
    title: `Alternatives to ${name}: What to Compare | Liberty Bancard`,
    description: `A checklist for choosing an alternative to ${name}: total cost, pricing model, equipment, funding and support. A statement review shows what you pay today.`,
    path: `/alternatives/${info.slug}`,
    schemas: [breadcrumbSchema, faqSchema],
  })}
<body>
${ssrNavbar()}
<nav class="breadcrumb"><a href="/">Home</a><span>›</span>${escHtml(name)} alternatives</nav>
<header class="page-header">
<div class="page-header-inner">
<div class="page-badge">Choosing a processor</div>
<h1>Choosing an Alternative to ${escHtml(name)}: What to Compare</h1>
<p class="page-subhead">A checklist for weighing another provider against ${escHtml(name)}. It does not rank providers. Your own statement and agreement show what fits your business.</p>
</div>
</header>
<main class="page-body">
<section class="content-section">
<h2>What to Compare</h2>
<p>${escHtml(info.fullName.startsWith(name) ? info.fullName : `${name} (${info.fullName})`)}: ${escHtml(info.category)}. Whatever you are comparing it with, these are the points that decide the cost and the fit:</p>
${listHtml(criteria)}
${categoryNote ? `<p>${escHtml(categoryNote)}</p>` : ""}
</section>

<section class="content-section">
<h2>How Liberty Bancard Fits Into the Comparison</h2>
<p>${escHtml(claimText("review.process.summary"))}</p>
<p>${escHtml(claimText("review.cost.free"))}</p>
<p>${escHtml(claimText("equipment.options.summary"))}</p>
</section>

<section class="content-section compare-cta-section">
<h2>See Dated Prices and a Side-by-Side Table</h2>
<p>${hasPublishedRates ? `The comparison page lists the ${escHtml(name)} prices it publishes, each with its source and the date it was checked, next to Liberty Bancard.` : `${escHtml(name)} does not publish a single processing rate, so the comparison page lays the two out feature by feature.`}</p>
<a href="/compare/${escHtml(info.slug)}" class="btn-primary">Liberty Bancard vs ${escHtml(name)}</a>
</section>

<section class="content-section cta-section">
<h2>Start With Your Current Cost</h2>
<p>Before comparing providers, find your effective rate: all the fees on your statement divided by your card volume. Upload a statement and we will review it with you.</p>
<a href="/upload-statement" class="btn-primary">Upload a Statement</a>
</section>

<section class="content-section">
<h2>Questions Merchants Ask</h2>
${faqHtml}
</section>

<section class="content-section">
<h2>If You Decide to Change</h2>
<p>Read your agreement first. The list of questions to answer from it is on the switching page.</p>
<a href="/switch-from/${escHtml(info.slug)}" class="internal-link">→ Before you switch from ${escHtml(name)}</a>
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
  if (!info) return "";

  const name = info.name;
  const questions = [...COMMON_AGREEMENT_QUESTIONS, ...info.agreementExtras];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com" },
      { "@type": "ListItem", position: 2, name: `Before you switch from ${name}`, item: `https://libertybancard.com/switch-from/${info.slug}` },
    ],
  };

  const questionsHtml = questions
    .map((q, i) => `<div class="step-item"><div class="step-number">${i + 1}</div><div class="step-content"><p>${escHtml(q)}</p></div></div>`)
    .join("\n");

  return `${pageHead({
    title: `Switching From ${name}: Agreement Questions | Liberty Bancard`,
    description: `Questions to answer from your ${name} agreement before changing processors: term, notice, early termination, equipment and your records.`,
    path: `/switch-from/${info.slug}`,
    schemas: [breadcrumbSchema],
    extraStyle: `<style>
.step-item { display: flex; gap: 1rem; margin-bottom: 1.25rem; align-items: flex-start; }
.step-number { background: #071D57; color: #fff; width: 2rem; height: 2rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 0.875rem; }
.step-content p { color: #334155; font-size: 1rem; margin: 0.15rem 0 0; }
.info-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; }
.info-box h3 { color: #0369a1; font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
.info-box p { color: #0c4a6e; margin: 0; font-size: 0.95rem; }
</style>`,
  })}
<body>
${ssrNavbar()}
<nav class="breadcrumb"><a href="/">Home</a><span>›</span>Before you switch from ${escHtml(name)}</nav>
<header class="page-header">
<div class="page-header-inner">
<div class="page-badge">Agreement review</div>
<h1>Before You Switch From ${escHtml(name)}: Questions to Answer From Your Agreement</h1>
<p class="page-subhead">Your agreement and statements state your terms. This page lists what to find in them before you change processors. It does not say what any agreement contains.</p>
</div>
</header>
<main class="page-body">

<section class="content-section">
<h2>Questions to Answer From Your ${escHtml(name)} Agreement</h2>
${questionsHtml}
</section>

<section class="content-section">
<h2>Where to Find the Answers</h2>
<p>The answers are in your merchant agreement, in any separate equipment or software agreement, and on your recent statements. The provider can confirm what a clause means. ${escHtml(claimText("equipment.agreement.summary"))}</p>
</section>

<div class="info-box">
<h3>Timing</h3>
<p>${escHtml(TIMING_NOTE)}</p>
</div>

<section class="content-section">
<h2>What a Statement Review Covers</h2>
<p>${escHtml(claimText("review.process.summary"))}</p>
<p>${escHtml(claimText("review.cost.free"))}</p>
<p>${escHtml(claimText("equipment.options.summary"))}</p>
</section>

<section class="content-section cta-section">
<h2>Start With Your Statement</h2>
<p>Upload your ${escHtml(name)} statement and we will review it with you. ${escHtml(TIMING_NOTE)}</p>
<a href="/upload-statement" class="btn-primary">Upload a Statement</a>
<a href="/compare/${escHtml(info.slug)}" class="btn-secondary">Liberty Bancard vs ${escHtml(name)}</a>
</section>

<section class="content-section">
<h2>Still Choosing?</h2>
<p>If you have not picked a provider yet, the comparison checklist covers cost, pricing model, equipment, funding and support.</p>
<a href="/alternatives/${escHtml(info.slug)}" class="internal-link">→ What to compare when choosing an alternative to ${escHtml(name)}</a>
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
img { max-width: 100%; height: auto; }
:where(.ssr-navbar, .ssr-footer) a { color: inherit; text-decoration: none; }
${SSR_CHROME_CSS}
.site-header { background: #0f172a; padding: 1rem 2rem; }
.site-header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 1.25rem; }
nav.breadcrumb { padding: 1rem 2rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem; color: #64748b; }
nav.breadcrumb a { color: #1d4ed8; text-decoration: none; }
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
.btn-primary { display: inline-block; background: #C8102E; color: #fff; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; margin-top: 1rem; margin-right: 1rem; }
.btn-primary:hover { background: #A30D25; }
.btn-secondary { display: inline-block; background: rgba(255,255,255,0.15); color: #fff; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; margin-top: 1rem; border: 1px solid rgba(255,255,255,0.3); }
.btn-secondary:hover { background: rgba(255,255,255,0.25); }
.compare-cta-section .btn-primary { margin-top: 0.75rem; }
.internal-link { color: #1d4ed8; text-decoration: none; font-weight: 500; }
.internal-link:hover { text-decoration: underline; }
.link-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem; }
.link-grid div { padding: 1rem; background: #f8fafc; border-radius: 8px; }
.link-grid strong { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
.site-footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 2rem; margin-top: 4rem; font-size: 0.875rem; }
.site-footer a { color: #60a5fa; text-decoration: none; }
@media (max-width: 640px) { .page-header, .page-body, nav.breadcrumb { padding-left: 1rem; padding-right: 1rem; } .link-grid { grid-template-columns: 1fr; } }
</style>`;
}
