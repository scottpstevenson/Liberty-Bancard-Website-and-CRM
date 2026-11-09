import { ssrHtmlShell } from "../ssrShared";
import { claimText } from "@shared/public-claims";
import { TIMING_NOTE } from "@shared/public-disclosures";
import {
  BEAT_SQUARE_STRIPE,
  COMPARE_ENTRIES,
  COMPARE_METHOD_NOTE,
  COMPARE_NEEDS,
  COMPARE_SLUGS,
  COMPARE_TABLE_FOOTNOTE,
  RATES_PAGE,
  beatSquareStripeRecords,
  ratesPageRows,
} from "@shared/compare-content";
import { CHANNEL_LABELS, formatCheckedDate, formatMonthly, formatQualifier, formatRateLabel } from "@shared/competitor-pricing";
import {
  COMPAT_STATE_LABEL,
  INTEGRATIONS_CALLOUT,
  INTEGRATIONS_CTA,
  INTEGRATIONS_DIRECTORY,
  INTEGRATIONS_HERO,
  INTEGRATIONS_META,
  INTEGRATIONS_PATH,
  INTEGRATIONS_PROCESS,
  INTEGRATION_CATEGORIES,
  INTEGRATION_RECORDS,
  integrationStats,
  showsActiveCheck,
} from "@shared/integrations-content";
import {
  ZP_CASH_DISCOUNT,
  ZP_COSTS,
  ZP_FAQ,
  ZP_FAQ_HEADING,
  ZP_FIT,
  ZP_HERO,
  ZP_META,
  ZP_PATH,
  ZP_PROGRAMS_HEADING,
  ZP_PROGRAMS_INTRO,
  ZP_REQUIREMENTS,
  ZP_SSR,
  ZP_SURCHARGE,
  ZP_UNSURE,
} from "@shared/zero-percent-content";
import {
  FST_TITLE_FULL,
  FST_DESCRIPTION,
  FST_KEYWORDS,
  FST_PATH,
  FST_SERVICE_NAME,
  FST_SERVICE_DESCRIPTION,
  FST_HERO,
  FST_OFFER,
  FST_INQUIRY_PATH,
  FST_STATEMENT_REVIEW_PATH,
  FST_PLACEMENT_CLAIM,
  FST_EQUIPMENT_TERMS_DISCLOSURE,
  FST_FEATURES_HEADING,
  FST_FEATURES_INTRO,
  FST_FEATURES,
  FST_ELIGIBILITY,
  FST_STEPS_HEADING,
  FST_STEPS_INTRO,
  FST_STEPS,
  FST_TIMING_NOTE,
  FST_FINAL,
  fstFaqItems,
} from "@shared/free-smart-terminal-content";
import {
  FSR_ANCHOR_ID,
  FSR_COST,
  FSR_DISCLOSURE,
  FSR_FUNDING_NOTE,
  FSR_HANDLING,
  FSR_HEADING,
  FSR_WHAT_IT_IS,
  FSR_WHAT_TO_SUBMIT,
  FSR_WHAT_YOU_RECEIVE,
  FSR_WHO_QUALIFIES,
  FSR_META,
  FSR_HERO,
  FSR_DELIVERABLE,
  FSR_PROCESS,
  FSR_FAQ,
  FSR_FORM,
  FSR_NEXT_NOTE,
  FSR_SSR_CARDS,
  FSR_SSR_CTA,
} from "@shared/free-statement-review-content";

const BASE_URL = "https://libertybancard.com";

function ctaSection(headline: string, sub: string): string {
  return `
  <section class="ssr-section ssr-section-dark">
    <div class="ssr-section-inner ssr-cta-section">
      <h2>${headline}</h2>
      <p>${sub}</p>
      <div class="ssr-cta-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — It's Free</a>
        <a href="/free-analysis" class="ssr-btn-outline">📞 Talk to an Expert</a>
      </div>
    </div>
  </section>`;
}

function getFreeStatementReviewExplainerHtml(): string {
  return `
  <section class="ssr-section" id="${FSR_ANCHOR_ID}">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FSR_HEADING}</h2>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_WHAT_IT_IS.heading}</div>
        <div class="ssr-card-text">${FSR_WHAT_IT_IS.intro}</div>
        <ul>
          ${FSR_WHAT_IT_IS.parts.map((part) => `<li><strong>${part.term}</strong> — ${part.text}</li>`).join("\n          ")}
        </ul>
        <div class="ssr-card-text">${FSR_WHAT_IT_IS.outro}</div>
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_WHAT_YOU_RECEIVE.heading}</div>
        <div class="ssr-card-text">${FSR_WHAT_YOU_RECEIVE.text}</div>
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_COST.heading}</div>
        <div class="ssr-card-text">${FSR_COST.text}</div>
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_WHAT_TO_SUBMIT.heading}</div>
        ${FSR_WHAT_TO_SUBMIT.paragraphs.map((paragraph) => `<div class="ssr-card-text">${paragraph}</div>`).join("\n        ")}
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_HANDLING.heading}</div>
        <div class="ssr-card-text">${FSR_HANDLING.text}</div>
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_WHO_QUALIFIES.heading}</div>
        <div class="ssr-card-text">${FSR_WHO_QUALIFIES.text}</div>
      </div>
      <div class="ssr-card">
        <div class="ssr-card-title">${FSR_FUNDING_NOTE.heading}</div>
        <div class="ssr-card-text">${FSR_FUNDING_NOTE.text}</div>
      </div>
      <p class="ssr-card-text">${FSR_DISCLOSURE}</p>
    </div>
  </section>`;
}

export function getUploadStatementHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: FSR_META.title,
    description: FSR_META.description,
    url: `${BASE_URL}/upload-statement`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Upload Statement</span></div>
      <div class="ssr-hero-badge">${FSR_HERO.badge}</div>
      <h1>${FSR_HERO.heading}</h1>
      <p class="ssr-hero-subtitle">${FSR_HERO.sub}</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement#statement-review-form" class="ssr-btn-primary">${FSR_HERO.button}</a>
      </div>
      <p class="ssr-hero-subtitle" style="font-size:0.9rem;">${FSR_HERO.support}</p>
    </div>
  </div>

  <section class="ssr-section" id="statement-review-form">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FSR_FORM.heading}</h2>
      <p class="ssr-section-subheading">${FSR_FORM.intro}</p>
      <p class="ssr-card-text">${FSR_FORM.helper} <a href="${FSR_FORM.helperHref}">${FSR_FORM.helperLink}</a></p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FSR_DELIVERABLE.heading}</h2>
      <ol>
        ${FSR_DELIVERABLE.rows.map((row) => `<li>${row}</li>`).join("\n        ")}
      </ol>
      <p class="ssr-card-text">${FSR_DELIVERABLE.sampleLabel}</p>
    </div>
  </section>

  ${getFreeStatementReviewExplainerHtml()}

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What You Get With a Free Statement Review</h2>
      <p class="ssr-section-subheading">A line-item explanation of your current processing costs.</p>
      <div class="ssr-grid-3">
        ${FSR_SSR_CARDS.map((card) => `<div class="ssr-card">
          <div class="ssr-card-title">${card.title}</div>
          <div class="ssr-card-text">${card.text}</div>
        </div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FSR_PROCESS.heading}</h2>
      <ol>
        ${FSR_PROCESS.steps.map((step) => `<li>${step}</li>`).join("\n        ")}
      </ol>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${FSR_PROCESS.support} ${FSR_NEXT_NOTE}</p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FSR_FAQ.heading}</h2>
      ${FSR_FAQ.items.map((item) => `<div class="ssr-card">
        <div class="ssr-card-title">${item.question}</div>
        <div class="ssr-card-text">${item.answer}${"link" in item && item.link ? ` <a href="${item.link.href}">${item.link.label}</a>.` : ""}</div>
      </div>`).join("\n      ")}
    </div>
  </section>
  ${ctaSection(FSR_SSR_CTA.heading, FSR_SSR_CTA.body)}`;

  return ssrHtmlShell({
    title: FSR_META.title,
    description: FSR_META.description,
    canonical: "/upload-statement",
    keywords: FSR_META.keywords,
    schemaJsons: [schema],
    body,
  });
}

export function getFreeAnalysisHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Free Payment Processing Analysis",
    description: "Free merchant services analysis to identify savings opportunities in your current payment processing setup.",
    provider: { "@type": "Organization", name: "Liberty Bancard", url: BASE_URL },
    url: `${BASE_URL}/free-analysis`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free consultation and statement review" },
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Free Analysis</span></div>
      <div class="ssr-hero-badge">💼 Free Consultation</div>
      <h1>Free Payment Processing Analysis for Your Business</h1>
      <p class="ssr-hero-subtitle">Discover hidden fees, compare pricing models, and see how much your business could save. No cost, no pressure, no obligation.</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Start Free Analysis</a>
        <a href="/savings-calculator" class="ssr-btn-outline">🧮 Quick Estimate First</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What's Included in Your Free Analysis</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card">
          <div class="ssr-card-title">📋 Current Rate Audit</div>
          <div class="ssr-card-text">We identify your effective rate, markups above interchange, and any junk fees that inflate your costs without adding value.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">🔄 Program Comparison</div>
          <div class="ssr-card-text">Side-by-side comparison of interchange-plus, flat-rate, and 0% processing programs for your business type and volume.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">📈 Savings Forecast</div>
          <div class="ssr-card-text">12-month savings projection based on your actual transaction mix — not a generic estimate.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">💳 Equipment Review</div>
          <div class="ssr-card-text">Check whether your current terminals support the most cost-effective transaction types for your business.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">🛡️ Risk &amp; Compliance Check</div>
          <div class="ssr-card-text">Quick review of your current setup's PCI compliance posture and any avoidable risk exposures.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">🗓️ Implementation Timeline</div>
          <div class="ssr-card-text">If you decide to switch, we outline what happens next. Account approval, equipment availability, shipping and activation are separate steps.</div>
        </div>
      </div>
    </div>
  </section>
  ${ctaSection("Get Your Free Analysis Today", "Takes a few minutes to submit. Our team will review your request and follow up about next steps.")}`;

  return ssrHtmlShell({
    title: "Free Payment Processing Analysis | See Your Savings | Liberty Bancard",
    description: "Get a free payment processing analysis from Liberty Bancard. Identify hidden fees, compare programs, and get a personalized savings forecast. No obligation.",
    canonical: "/free-analysis",
    keywords: "free payment processing analysis, merchant services analysis, processing fee audit, payment processing review, merchant account review",
    schemaJsons: [schema],
    body,
  });
}

export function getWhyLibertyHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "Why Liberty Bancard | Transparent Merchant Services",
    description: "Learn why 5,000+ businesses trust Liberty Bancard for payment processing. PCI certified, dedicated reps, and interchange-plus pricing with no surprises.",
    url: `${BASE_URL}/why-liberty-bancard`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Why Liberty Bancard</span></div>
      <div class="ssr-hero-badge">🏆 Trusted by 5,000+ Businesses</div>
      <h1>Why Businesses Choose Liberty Bancard</h1>
      <p class="ssr-hero-subtitle">Transparency, dedicated support, and pricing that actually favors your business. No surprises — ever.</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Get Free Statement Review</a>
        <a href="/case-studies" class="ssr-btn-outline">📖 Read Case Studies</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">The Liberty Bancard Difference</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card">
          <div class="ssr-card-title">🔍 Transparent Pricing</div>
          <div class="ssr-card-text">Interchange-plus pricing shows you the exact cost of every transaction. We don't bundle fees or hide markups.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">👤 Dedicated Account Rep</div>
          <div class="ssr-card-text">You get a real person who knows your account. Call, text, or email your rep directly — not a support queue.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">💳 0% Processing Option</div>
          <div class="ssr-card-text">${claimText("program.overview")} ${claimText("program.remaining-costs")}</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">🏅 PCI DSS Level 1 Certified</div>
          <div class="ssr-card-text">We maintain the highest level of payment security compliance, protecting every transaction you process.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">⚡ Next-Day Funding</div>
          <div class="ssr-card-text">Qualified merchants receive deposits the next business day. Your cash flow stays healthy and predictable.*</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">📊 Free Statement Review</div>
          <div class="ssr-card-text">We analyze your current statement before you make any decisions. See your exact savings potential with no obligation.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1.5rem;max-width:48rem;margin:0 auto 3rem;" class="ssr-grid-2">
        <div class="ssr-card" style="text-align:center;">
          <div class="ssr-stat-value">10+</div>
          <div class="ssr-stat-label">Years in Payments</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div class="ssr-stat-value">5,000+</div>
          <div class="ssr-stat-label">Merchants Served</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div class="ssr-stat-value">$2B+</div>
          <div class="ssr-stat-label">Annual Volume Processed</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div class="ssr-stat-value">99.9%</div>
          <div class="ssr-stat-label">Platform Uptime</div>
        </div>
      </div>
      <h2 class="ssr-section-heading">Certifications &amp; Compliance</h2>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        <div class="ssr-card"><div class="ssr-card-title">🛡️ PCI DSS Level 1 Certified</div><div class="ssr-card-text">The highest level of payment card industry data security compliance for every merchant we serve.</div></div>
        <div class="ssr-card"><div class="ssr-card-title">🏦 Registered ISO/MSP</div><div class="ssr-card-text">Registered Independent Sales Organization with acquiring bank partnerships for institutional-grade processing.</div></div>
        <div class="ssr-card"><div class="ssr-card-title">📱 EMV &amp; Contactless Ready</div><div class="ssr-card-text">All terminals support chip, tap, and mobile wallets including Apple Pay, Google Pay, and Samsung Pay.</div></div>
        <div class="ssr-card"><div class="ssr-card-title">🔒 PCI P2PE Validated</div><div class="ssr-card-text">Point-to-point encryption on supported terminals reduces your PCI scope and protects cardholder data.</div></div>
      </div>
    </div>
  </section>
  ${ctaSection("Ready to Experience the Difference?", "See how Liberty Bancard compares to your current processor. Free statement review, no obligation.")}`;

  return ssrHtmlShell({
    title: "Why Liberty Bancard | Transparent Processing & Support",
    description: "Learn why 5,000+ businesses trust Liberty Bancard. PCI certified, dedicated account reps, interchange-plus pricing, and 0% processing options. Free statement review.",
    canonical: "/why-liberty-bancard",
    keywords: "why liberty bancard, merchant services provider, transparent payment processing, interchange plus pricing, dedicated merchant support",
    schemaJsons: [schema],
    body,
  });
}

export function getZeroPercentHtml(): string {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ZP_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: ZP_META.serviceName,
    description: ZP_META.serviceDescription,
    url: `${BASE_URL}${ZP_PATH}`,
    provider: { "@type": "Organization", name: "Liberty Bancard", url: BASE_URL },
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Liberty Zero</span></div>
      <div class="ssr-hero-badge">💳 ${ZP_SSR.badge}</div>
      <h1>${ZP_SSR.h1}</h1>
      <p class="ssr-hero-subtitle">${ZP_HERO.sub}</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">${ZP_SSR.primaryCta}</a>
        <a href="/free-analysis" class="ssr-btn-outline">${ZP_SSR.secondaryCta}</a>
      </div>
      <p class="ssr-hero-subtitle" style="font-size:0.85rem;">${ZP_HERO.disclaimer}</p>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${ZP_PROGRAMS_HEADING}</h2>
      <p class="ssr-section-subheading">${ZP_PROGRAMS_INTRO}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        <div class="ssr-card">
          <div class="ssr-card-title">⚖️ ${ZP_CASH_DISCOUNT.title}</div>
          <div class="ssr-card-text">${ZP_CASH_DISCOUNT.body} ${ZP_CASH_DISCOUNT.fit}</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">🛡️ ${ZP_SURCHARGE.title}</div>
          <div class="ssr-card-text">${ZP_SURCHARGE.body} ${ZP_SURCHARGE.fit}</div>
        </div>
      </div>
      <p style="text-align:center;margin-top:1.5rem;">${ZP_UNSURE}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${ZP_FIT.heading}</h2>
      <p class="ssr-section-subheading">${ZP_FIT.intro}</p>
      <div class="ssr-faq-wrapper">
        <h3>${ZP_FIT.checklistHeading}</h3>
        <ul class="ssr-check-list">
          ${ZP_FIT.checklist.map((item) => `<li><span class="check-icon">✓</span>${item}</li>`).join("\n          ")}
        </ul>
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${ZP_REQUIREMENTS.heading}</h2>
      <p class="ssr-section-subheading">${ZP_REQUIREMENTS.intro}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        ${ZP_REQUIREMENTS.cards.map((card) => `<div class="ssr-card"><div class="ssr-card-title">${card.title}</div><div class="ssr-card-text">${card.desc}</div></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${ZP_COSTS.heading}</h2>
      <p class="ssr-section-subheading">${ZP_COSTS.intro}</p>
      <div class="ssr-grid-3">
        ${ZP_COSTS.cards.map((card) => `<div class="ssr-card"><div class="ssr-card-title">${card.title}</div><div class="ssr-card-text">${card.desc}</div></div>`).join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${ZP_COSTS.footnote}</p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${ZP_FAQ_HEADING}</h2>
      <div class="ssr-faq-wrapper">
        ${ZP_FAQ.map((item) => `<div class="ssr-faq-item"><div class="ssr-faq-q">${item.question}</div><div class="ssr-faq-a">${item.answer}</div></div>`).join("\n        ")}
      </div>
    </div>
  </section>
  ${ctaSection(ZP_SSR.finalHeading, ZP_SSR.finalBody)}`;

  return ssrHtmlShell({
    title: `${ZP_META.title} | Liberty Bancard`,
    description: ZP_META.description,
    canonical: ZP_PATH,
    keywords: ZP_META.keywords,
    schemaJsons: [faqSchema, serviceSchema],
    body,
  });
}

export function getCaseStudiesHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Merchant Case Studies | Liberty Bancard",
    description: "Real savings stories from Liberty Bancard merchants across restaurants, retail, healthcare, and more.",
    url: `${BASE_URL}/case-studies`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Case Studies</span></div>
      <div class="ssr-hero-badge">📖 Real Merchant Savings</div>
      <h1>How Liberty Bancard Saves Real Businesses Real Money</h1>
      <p class="ssr-hero-subtitle">These aren't estimates — they're actual results from merchants who compared their statements and made the switch.</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Get My Statement Review</a>
        <a href="/savings-calculator" class="ssr-btn-outline">🧮 Estimate My Savings</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Merchant Savings Snapshots</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#eff6ff;color:#1e3a5f;border-color:#bfdbfe;">🍽️ Restaurant — Miami, FL</div>
          <div class="ssr-stat-value">$4,800/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved switching from Square</div>
          <div class="ssr-card-text">High-volume lunch spot processing $35,000/month. Switched from Square 2.6% flat rate to interchange-plus. Also deployed compliant surcharging for dine-in credit transactions.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#f0fdf4;color:#065f46;border-color:#bbf7d0;">🏥 Medical Practice — Fort Lauderdale</div>
          <div class="ssr-stat-value">$3,200/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved switching from Stripe</div>
          <div class="ssr-card-text">Multi-physician practice processing $28,000/month in copays and self-pay. Stripe's 2.9% online rate was billing the practice on keyed transactions. Moved to interchange-plus with proper MCC coding.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#fef3c7;color:#92400e;border-color:#fde68a;">🏪 Retail Shop — Boca Raton</div>
          <div class="ssr-stat-value">$2,100/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved eliminating junk fees</div>
          <div class="ssr-card-text">Boutique retail processing $18,000/month on a tiered plan. After statement review, discovered $175/month in avoidable fees. Moved to interchange-plus and deployed cash discount program.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#fdf4ff;color:#6b21a8;border-color:#e9d5ff;">💅 Salon &amp; Spa — Aventura</div>
          <div class="ssr-stat-value">$1,900/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved with 0% processing</div>
          <div class="ssr-card-text">Full-service salon processing $15,000/month. Implemented compliant cash discount program — most service clients opted for card but appreciated transparency. Net processing cost dropped to near zero.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#fff7ed;color:#9a3412;border-color:#fed7aa;">🔧 Auto Repair — Pompano Beach</div>
          <div class="ssr-stat-value">$2,600/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved switching from Clover</div>
          <div class="ssr-card-text">Auto shop processing $22,000/month. Clover's bundled plan was billing 2.49%+. Moved to interchange-plus and deployed surcharging on credit transactions — large average tickets made this highly effective.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-hero-badge" style="margin-bottom:0.75rem;background:#f0f9ff;color:#0c4a6e;border-color:#bae6fd;">🏗️ Construction — West Palm Beach</div>
          <div class="ssr-stat-value">$5,400/yr</div>
          <div class="ssr-stat-label" style="margin-bottom:0.75rem;">Saved with proper B2B coding</div>
          <div class="ssr-card-text">General contractor processing $45,000/month in progress payments via card. Previous processor wasn't qualifying B2B transactions for Level 2/3 interchange. Proper coding reduced rates significantly.</div>
        </div>
      </div>
    </div>
  </section>
  ${ctaSection("What Could You Save?", "Upload your statement and we'll build a personalized savings analysis — just like these merchants received before switching.")}`;

  return ssrHtmlShell({
    title: "Merchant Case Studies | Real Savings Stories | Liberty Bancard",
    description: "See how real businesses saved $1,900–$5,400/year by switching to Liberty Bancard. Case studies from restaurants, retail, healthcare, auto repair, and more.",
    canonical: "/case-studies",
    keywords: "payment processing savings, merchant savings case studies, credit card processing savings, interchange plus savings, switch payment processor",
    schemaJsons: [schema],
    body,
  });
}

export function getEstimateHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Payment Processing Cost Estimator | Liberty Bancard",
    description: "Estimate your credit card processing costs under different pricing models. See your current fees vs interchange-plus pricing.",
    url: `${BASE_URL}/estimate`,
    applicationCategory: "FinanceApplication",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Get an Estimate</span></div>
      <div class="ssr-hero-badge">🧮 Quick Cost Estimate</div>
      <h1>Estimate Your Payment Processing Costs</h1>
      <p class="ssr-hero-subtitle">Answer a few quick questions and get an instant cost comparison between your current plan and Liberty Bancard's interchange-plus pricing.</p>
      <div class="ssr-hero-buttons">
        <a href="/estimate#tool" class="ssr-btn-primary">🧮 Start Estimate Tool</a>
        <a href="/upload-statement" class="ssr-btn-outline">📤 Get Exact Analysis</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What You'll Learn</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card">
          <div class="ssr-card-title">💰 Current Processing Cost</div>
          <div class="ssr-card-text">Estimate what you're paying today based on your pricing model and monthly volume. Most merchants are surprised how much they're spending.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">📉 Interchange-Plus Estimate</div>
          <div class="ssr-card-text">See what your costs would look like under Liberty Bancard's interchange-plus pricing — the most transparent model available.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">💵 Annual Savings Potential</div>
          <div class="ssr-card-text">Get an estimated annual savings figure. For exact numbers, upload your actual statement for a precise analysis.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner" style="text-align:center;">
      <h2 class="ssr-section-heading">Typical Savings by Business Type</h2>
      <p class="ssr-section-subheading">Based on businesses that submitted statements and switched to Liberty Bancard*</p>
      <div class="ssr-grid-3" style="max-width:56rem;margin:0 auto;">
        <div class="ssr-card"><div class="ssr-stat-value">$3,000–$6,000</div><div class="ssr-stat-label">Restaurants ($30K–$50K/mo)</div></div>
        <div class="ssr-card"><div class="ssr-stat-value">$1,500–$3,000</div><div class="ssr-stat-label">Retail ($15K–$25K/mo)</div></div>
        <div class="ssr-card"><div class="ssr-stat-value">$2,000–$4,500</div><div class="ssr-stat-label">Healthcare ($20K–$40K/mo)</div></div>
        <div class="ssr-card"><div class="ssr-stat-value">$1,200–$2,500</div><div class="ssr-stat-label">Salons &amp; Spas ($12K–$20K/mo)</div></div>
        <div class="ssr-card"><div class="ssr-stat-value">$2,500–$5,000</div><div class="ssr-stat-label">Auto Repair ($25K–$45K/mo)</div></div>
        <div class="ssr-card"><div class="ssr-stat-value">$3,500–$7,000</div><div class="ssr-stat-label">Construction ($40K+/mo)</div></div>
      </div>
      <p style="font-size:0.75rem;color:#94a3b8;margin-top:1rem;">*Estimates only. Actual savings depend on transaction mix, card types, and current pricing. Upload your statement for exact figures.</p>
    </div>
  </section>
  ${ctaSection("Get Your Exact Savings Number", "The estimate tool gives you a range. Your statement gives us the exact numbers. Upload it free — no obligation.")}`;

  return ssrHtmlShell({
    title: "Payment Processing Cost Estimator | Liberty Bancard",
    description: "Estimate your credit card processing costs and potential savings. Compare current fees vs interchange-plus pricing. Get exact numbers with a free statement review.",
    canonical: "/estimate",
    keywords: "payment processing estimate, credit card processing cost calculator, processing fee estimator, merchant services estimate, interchange plus estimate",
    schemaJsons: [schema],
    body,
  });
}

export function getSavingsCalculatorHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Savings Calculator | Liberty Bancard",
    description: "Calculate how much you could save by switching to interchange-plus payment processing with Liberty Bancard.",
    url: `${BASE_URL}/savings-calculator`,
    applicationCategory: "FinanceApplication",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Savings Calculator</span></div>
      <div class="ssr-hero-badge">💰 Free Savings Calculator</div>
      <h1>Calculate Your Payment Processing Savings</h1>
      <p class="ssr-hero-subtitle">Enter your monthly processing volume and current rate to see how much you could save by switching to Liberty Bancard's interchange-plus pricing.</p>
      <div class="ssr-hero-buttons">
        <a href="/savings-calculator#calc" class="ssr-btn-primary">💰 Open Calculator</a>
        <a href="/upload-statement" class="ssr-btn-outline">📤 Get Exact Savings Analysis</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">How the Calculator Works</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">1️⃣</div>
          <div class="ssr-card-title">Enter Your Volume</div>
          <div class="ssr-card-text">Input your monthly credit card processing volume. You can find this on your merchant statement.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">2️⃣</div>
          <div class="ssr-card-title">Select Your Pricing Model</div>
          <div class="ssr-card-text">Choose flat-rate, tiered, or interchange-plus. If you're not sure, use flat-rate for a conservative estimate.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">3️⃣</div>
          <div class="ssr-card-title">See Your Savings</div>
          <div class="ssr-card-text">Get an estimated monthly and annual savings projection based on Liberty Bancard's typical interchange-plus markup.</div>
        </div>
      </div>
    </div>
  </section>
  ${ctaSection("Ready for Your Exact Number?", "The calculator gives you a strong estimate. A free statement review gives you the precise amount — down to the dollar.")}`;

  return ssrHtmlShell({
    title: "Payment Processing Savings Calculator | Free Tool | Liberty Bancard",
    description: "Calculate how much you could save on credit card processing fees. Enter your monthly volume and current rate to get an instant savings estimate. Free tool.",
    canonical: "/savings-calculator",
    keywords: "payment processing savings calculator, credit card processing savings, merchant savings calculator, processing fee calculator, how much can I save processing",
    schemaJsons: [schema],
    body,
  });
}

export function getCompareRatesHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: RATES_PAGE.schemaName,
    description: RATES_PAGE.description,
    url: `${BASE_URL}/compare-rates`,
  };
  const rows = ratesPageRows();
  const rowsHtml = rows
    .map(
      (row) => `<tr>
          <td><a href="/compare/${row.slug}"><strong>${row.provider}</strong></a></td>
          <td>${row.detail}</td>
          <td>${row.rate}</td>
          <td>${row.monthly}</td>
          <td>${row.sourceUrl && row.checkedOn ? `<a href="${row.sourceUrl}" rel="noopener noreferrer">Official page</a> checked ${formatCheckedDate(row.checkedOn)}` : "No published rate to cite"}</td>
        </tr>`,
    )
    .join("");
  const linksHtml = COMPARE_SLUGS.map(
    (slug) => `<a href="/compare/${slug}" class="ssr-card" style="display:block;text-decoration:none;">
          <div class="ssr-card-title">Liberty Bancard vs ${COMPARE_ENTRIES[slug].name}</div>
          <div class="ssr-card-text">${COMPARE_ENTRIES[slug].providerFit}</div>
          <div style="color:#0ea5e9;font-size:0.875rem;font-weight:600;margin-top:0.75rem;">View Comparison →</div>
        </a>`,
  ).join("");
  const needsHtml = COMPARE_NEEDS.items.map((item) => `<li><span class="check-icon">✓</span>${item}</li>`).join("");
  const faqHtml = RATES_PAGE.faq
    .map((f) => `<div class="ssr-faq-item"><div class="ssr-faq-q">${f.question}</div><div class="ssr-faq-a">${f.answer}</div></div>`)
    .join("");
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Compare Rates</span></div>
      <div class="ssr-hero-badge">📊 Published Rates, Dated and Sourced</div>
      <h1>${RATES_PAGE.heading}</h1>
      <p class="ssr-hero-subtitle">${RATES_PAGE.subheading}</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Compare With My Statement</a>
        <a href="/savings-calculator" class="ssr-btn-outline">🧮 Quick Calculator</a>
      </div>
      <p class="ssr-hero-subtitle" style="font-size:0.8125rem;margin-top:1rem;">${RATES_PAGE.disclaimer}</p>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Published Provider Rates</h2>
      <p class="ssr-section-subheading">Each row is copied from the provider's official page and dated. ${RATES_PAGE.libertyRowNote}</p>
      <div class="ssr-table-wrapper">
        <table class="ssr-table">
          <thead><tr><th>Provider</th><th>Product and plan</th><th>Published rate</th><th>Monthly fee</th><th>Source and date</th></tr></thead>
          <tbody>
            ${rowsHtml}
            <tr><td><strong>Liberty Bancard</strong></td><td>Interchange-plus; programs reviewed where they fit</td><td>Quoted after statement review</td><td>Stated in your written quote</td><td>Written quote and agreement</td></tr>
          </tbody>
        </table>
      </div>
      <p style="font-size:0.75rem;color:#6b7280;text-align:center;margin-top:1rem;">${COMPARE_METHOD_NOTE} ${COMPARE_TABLE_FOOTNOTE}</p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${COMPARE_NEEDS.heading}</h2>
      <p class="ssr-section-subheading">${COMPARE_NEEDS.intro}</p>
      <ul class="ssr-check-list" style="max-width:40rem;margin:0 auto;">${needsHtml}</ul>
      <p style="font-size:0.75rem;color:#6b7280;text-align:center;margin-top:1rem;">${COMPARE_NEEDS.footnote}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Provider Comparisons</h2>
      <div class="ssr-grid-3">${linksHtml}</div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
      <div class="ssr-faq-wrapper">${faqHtml}</div>
    </div>
  </section>
  ${ctaSection("Ready to Compare Your Own Costs?", "Upload your current statement and we'll show you a line-by-line comparison with the inputs used. Free, no obligation.")}`;

  return ssrHtmlShell({
    title: `${RATES_PAGE.title} | Liberty Bancard`,
    description: RATES_PAGE.description,
    canonical: RATES_PAGE.path,
    keywords: RATES_PAGE.keywords,
    schemaJsons: [schema],
    body,
  });
}

export function getGetStartedHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Get Started with Liberty Bancard | Merchant Services",
    description: "Start your merchant account application with Liberty Bancard. Our team reviews your request and contacts you about next steps.",
    url: `${BASE_URL}/get-started`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Get Started</span></div>
      <div class="ssr-hero-badge">🚀 Start Your Application</div>
      <h1>Start Accepting Payments with Liberty Bancard</h1>
      <p class="ssr-hero-subtitle">Simple onboarding, dedicated support, and transparent pricing. ${TIMING_NOTE}</p>
      <div class="ssr-hero-buttons">
        <a href="/get-started#form" class="ssr-btn-primary">🚀 Start Application</a>
        <a href="/upload-statement" class="ssr-btn-outline">📤 Review My Statement First</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">How to Get Started</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">1️⃣</div>
          <div class="ssr-card-title">Submit Your Application</div>
          <div class="ssr-card-text">Fill out our short online application. Basic business info, ownership details, and processing history. Takes about 10 minutes.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">2️⃣</div>
          <div class="ssr-card-title">Underwriting &amp; Approval</div>
          <div class="ssr-card-text">Our team reviews your application and contacts you about next steps. Account approval is a separate step from equipment and activation.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">3️⃣</div>
          <div class="ssr-card-title">Equipment &amp; Go Live</div>
          <div class="ssr-card-text">Where equipment is part of your account, availability, shipping and activation are separate steps. Your rep walks you through each one.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What You'll Need to Apply</h2>
      <ul class="ssr-check-list" style="max-width:36rem;margin:0 auto;">
        <li><span class="check-icon">✓</span>Business name, address, and EIN/SSN</li>
        <li><span class="check-icon">✓</span>Business bank account (for deposits)</li>
        <li><span class="check-icon">✓</span>Valid government-issued ID for all owners 25%+</li>
        <li><span class="check-icon">✓</span>3 months of processing statements (if available)</li>
        <li><span class="check-icon">✓</span>Basic business information (type, time in business)</li>
      </ul>
    </div>
  </section>
  ${ctaSection("Ready to Get Started?", "Start your application today. Our team will review your request and contact you about next steps.")}`;

  return ssrHtmlShell({
    title: "Get Started with Liberty Bancard | Merchant Account Application",
    description: "Apply for a merchant account with Liberty Bancard. Transparent interchange-plus pricing, dedicated support, and a review of your request before next steps.",
    canonical: "/get-started",
    keywords: "merchant account application, get started payment processing, merchant services application, apply merchant account, payment processor application",
    schemaJsons: [schema],
    body,
  });
}

export function getBeatSquareStripeHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${BEAT_SQUARE_STRIPE.title} | Liberty Bancard`,
    description: BEAT_SQUARE_STRIPE.description,
    url: `${BASE_URL}${BEAT_SQUARE_STRIPE.path}`,
  };
  const recordsHtml = beatSquareStripeRecords()
    .map(
      (record) => `<div class="ssr-card">
          <div class="ssr-card-title">${record.product}</div>
          <div class="ssr-card-text">${record.plan} (${CHANNEL_LABELS[record.channel]})</div>
          <div class="ssr-stat-value">${formatRateLabel(record)}</div>
          <div class="ssr-card-text">${record.monthlyFeeCents !== null ? `${formatMonthly(record.monthlyFeeCents)}. ` : ""}${formatQualifier(record)}</div>
          <div class="ssr-card-text"><a href="${record.sourceUrl}" rel="noopener noreferrer">Official pricing page</a>, checked ${formatCheckedDate(record.checkedOn)}</div>
        </div>`,
    )
    .join("");
  const needsHtml = COMPARE_NEEDS.items.map((item) => `<li><span class="check-icon">✓</span>${item}</li>`).join("");
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-hero-badge">💡 Compare Before You Switch</div>
      <h1>${BEAT_SQUARE_STRIPE.heading}</h1>
      <p class="ssr-hero-subtitle">${BEAT_SQUARE_STRIPE.sub}</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Get My Statement Analysis</a>
        <a href="/compare/square" class="ssr-btn-outline">📊 See Square Comparison</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What Square and Stripe Publish</h2>
      <p class="ssr-section-subheading">Rates copied from each provider's official pricing page, with the date checked. They are list rates, not a quote for your business.</p>
      <div class="ssr-grid-2" style="max-width:56rem;margin:0 auto;">${recordsHtml}</div>
      <p style="font-size:0.75rem;color:#94a3b8;margin-top:1rem;text-align:center;">${COMPARE_METHOD_NOTE} ${COMPARE_TABLE_FOOTNOTE}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${COMPARE_NEEDS.heading}</h2>
      <p class="ssr-section-subheading">${COMPARE_NEEDS.intro}</p>
      <ul class="ssr-check-list" style="max-width:40rem;margin:0 auto;">${needsHtml}</ul>
      <p style="font-size:0.75rem;color:#94a3b8;margin-top:1rem;text-align:center;">${COMPARE_NEEDS.footnote}</p>
    </div>
  </section>
  ${ctaSection("Compare Before You Switch", "Upload your Square or Stripe statement and we'll show you your real cost and your options, with the inputs used. Free, no obligation.")}`;

  return ssrHtmlShell({
    title: `${BEAT_SQUARE_STRIPE.title} | Liberty Bancard`,
    description: BEAT_SQUARE_STRIPE.description,
    canonical: BEAT_SQUARE_STRIPE.path,
    keywords: BEAT_SQUARE_STRIPE.keywords,
    schemaJsons: [schema],
    body,
  });
}

export function getAffiliateProgramHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Affiliate Program | Earn Residual Income | Liberty Bancard",
    description: "Refer merchants to Liberty Bancard and earn ongoing residual income. Competitive commissions, real-time tracking, and dedicated affiliate support.",
    url: `${BASE_URL}/affiliate`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Affiliate Program</span></div>
      <div class="ssr-hero-badge">💼 Residual Income Opportunity</div>
      <h1>Earn Residual Income Referring Merchants</h1>
      <p class="ssr-hero-subtitle">Refer businesses to Liberty Bancard and earn ongoing commissions as long as they process. Real-time tracking, competitive payouts, and dedicated support.</p>
      <div class="ssr-hero-buttons">
        <a href="/affiliate#signup" class="ssr-btn-primary">💼 Join the Affiliate Program</a>
        <a href="/free-analysis" class="ssr-btn-outline">📞 Talk to Our Team</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">How the Affiliate Program Works</h2>
      <div class="ssr-grid-3">
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">1️⃣</div>
          <div class="ssr-card-title">Sign Up Free</div>
          <div class="ssr-card-text">Create your affiliate account and get a unique referral code and tracking link. No cost to join.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">2️⃣</div>
          <div class="ssr-card-title">Refer Merchants</div>
          <div class="ssr-card-text">Share your link with businesses that accept credit cards. Restaurants, retail, healthcare, service businesses — any merchant qualifies.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:0.75rem;">3️⃣</div>
          <div class="ssr-card-title">Earn Ongoing Residuals</div>
          <div class="ssr-card-text">Earn a commission on every merchant's monthly processing volume — for as long as they're a Liberty Bancard customer.</div>
        </div>
      </div>
    </div>
  </section>
  ${ctaSection("Start Earning Today", "Join the Liberty Bancard affiliate program. Free to join, competitive commissions, real-time reporting.")}`;

  return ssrHtmlShell({
    title: "Affiliate Program | Earn Residuals | Liberty Bancard",
    description: "Join the Liberty Bancard affiliate program. Earn ongoing residual income for every merchant you refer. Free to join, competitive commissions, real-time tracking.",
    canonical: "/affiliate",
    keywords: "payment processing affiliate program, merchant services affiliate, residual income payments, refer merchant services, ISO agent program",
    schemaJsons: [schema],
    body,
  });
}

export function getTestimonialsHtml(): string {
  const videoObjectSchema = (name: string, desc: string, savings: string) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${name} — Merchant Testimonial | Liberty Bancard`,
    description: desc,
    thumbnailUrl: `${BASE_URL}/favicon.png`,
    uploadDate: "2025-01-15",
    duration: "PT2M30S",
    publisher: { "@type": "Organization", name: "Liberty Bancard", logo: { "@type": "ImageObject", url: `${BASE_URL}/favicon.png` } },
  });
  const reviewSchema = (name: string, business: string, desc: string) => ({
    "@context": "https://schema.org",
    "@type": "Review",
    reviewBody: desc,
    author: { "@type": "Person", name, jobTitle: business },
    itemReviewed: { "@type": "Organization", name: "Liberty Bancard", url: BASE_URL },
    reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
  });
  const schemas = [
    videoObjectSchema("Maria R.", "Our processing cost dropped to nearly zero after switching.", "$4,200"),
    videoObjectSchema("Tony M.", "They found $127 a month in fees I never agreed to.", "$2,900"),
    videoObjectSchema("David K.", "The savings were immediate once we saw the real interchange cost.", "$3,800"),
    reviewSchema("Maria R.", "Full-Service Restaurant", "Our processing cost dropped to nearly zero after switching to Liberty Bancard's cash discount program."),
    reviewSchema("Tony M.", "Auto Repair Shop Owner", "They found $127 a month in fees I never agreed to. Liberty Bancard cleaned everything up."),
    reviewSchema("David K.", "Retail Store Owner", "The savings were immediate once we saw the real interchange cost. Switching from Stripe was seamless."),
  ];
  const testimonialCards = [
    { name: "Maria R.", business: "Full-Service Restaurant", city: "South Miami, FL", quote: "Our processing cost dropped to nearly zero after switching to Liberty Bancard's cash discount program. That freed up cash we put right back into our kitchen.", savings: "$4,200/year saved", industry: "Restaurant" },
    { name: "Tony M.", business: "Auto Repair Shop", city: "Broward County, FL", quote: "I was on tiered pricing and didn't realize half my transactions were at non-qualified rates. Liberty Bancard cleaned everything up and I'm saving almost $250 a month.", savings: "$2,900/year saved", industry: "Auto Repair" },
    { name: "David K.", business: "Multi-Location Retail", city: "Boca Raton, FL", quote: "Stripe was easy to set up, but we had no idea how much we were overpaying. Liberty Bancard showed us our actual interchange costs and the markup we were paying on top.", savings: "$3,800/year saved", industry: "Retail" },
    { name: "Dr. Sarah L.", business: "Medical Practice", city: "Tampa, FL", quote: "Our bank had us on tiered pricing for years. The Level 2 processing alone saved us a significant amount on commercial insurance card payments.", savings: "$6,100/year saved", industry: "Healthcare" },
    { name: "James W.", business: "HVAC Contractor", city: "Palm Beach County, FL", quote: "Liberty Bancard set me up with a mobile reader and cash discount program. Now I process everything through one system and my processing cost is basically zero.", savings: "$1,800/year saved", industry: "Home Services" },
    { name: "Rachel T.", business: "Online Specialty Retailer", city: "Remote / Online", quote: "We thought Shopify Payments was our only option. Liberty Bancard integrated a gateway and our costs dropped by over $5,000 a year. The integration was seamless.", savings: "$5,400/year saved", industry: "E-Commerce" },
  ].map(t => `
    <div class="ssr-card" style="display:flex;flex-direction:column;">
      <div style="background:linear-gradient(135deg,#1e3a5f 0%,#1a5276 100%);border-radius:8px;padding:2.5rem 1.5rem;text-align:center;margin-bottom:1rem;">
        <div style="font-size:2.5rem;font-weight:700;color:#38bdf8;">${t.savings}</div>
        <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);margin-top:0.25rem;text-transform:uppercase;letter-spacing:0.05em;">Video coming soon</div>
      </div>
      <div style="display:flex;gap:0.25rem;margin-bottom:0.75rem;">★★★★★</div>
      <p style="font-style:italic;font-size:0.9rem;color:#374151;flex-grow:1;line-height:1.6;">"${t.quote}"</p>
      <div style="border-top:1px solid #e5e7eb;padding-top:0.75rem;margin-top:1rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:0.875rem;font-weight:600;">${t.name}</div>
          <div style="font-size:0.75rem;color:#6b7280;">${t.business} · ${t.city}</div>
        </div>
        <span style="font-size:0.7rem;background:#f1f5f9;color:#64748b;padding:0.2rem 0.6rem;border-radius:20px;">${t.industry}</span>
      </div>
    </div>`).join("");

  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Testimonials</span></div>
      <div class="ssr-hero-badge">🎬 Merchant Stories</div>
      <h1>Real Merchants. Real Numbers.</h1>
      <p class="ssr-hero-subtitle">Watch real business owners share their payment processing transformation — specific savings, before-and-after numbers, and what switching to Liberty Bancard actually meant for their bottom line.</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Get Your Free Analysis</a>
        <a href="/testimonials/submit" class="ssr-btn-outline">🎥 Share Your Story</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Merchant Video Testimonials</h2>
      <p class="ssr-section-subheading">Filter by industry or browse all. Every merchant below started with a free statement review.</p>
      <div class="ssr-grid-3" style="gap:1.5rem;">
        ${testimonialCards}
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner" style="text-align:center;max-width:700px;margin:0 auto;">
      <h2>Want to Share Your Story?</h2>
      <p>If you're a Liberty Bancard merchant with a success story to tell, we'd love to feature you. Submit your video or write a few lines — we handle the rest.</p>
      <div class="ssr-cta-buttons" style="margin-top:1.5rem;">
        <a href="/testimonials/submit" class="ssr-btn-primary">🎥 Submit Your Story</a>
        <a href="/case-studies" class="ssr-btn-outline">📖 Read Full Case Studies</a>
      </div>
    </div>
  </section>

  ${ctaSection("Your Statement Tells the Truth. Let's Read It Together.", "Every merchant on this page started with a free statement review. Upload yours and see your real numbers.")}`;

  return ssrHtmlShell({
    title: "Merchant Video Testimonials — Real Results | Liberty Bancard",
    description: "Watch merchant testimonials from restaurant owners, retailers, and healthcare practices who saved thousands switching to Liberty Bancard. Filter by industry.",
    canonical: "/testimonials",
    keywords: "merchant testimonials, payment processing reviews, Liberty Bancard reviews, merchant video testimonials, credit card processing success stories",
    schemaJsons: schemas,
    body,
  });
}

export function getTestimonialsSubmitHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Submit Your Merchant Story | Liberty Bancard",
    description: "Share your payment processing success story with Liberty Bancard. Submit a video link or written testimonial and we'll feature your business on our merchant testimonials page.",
    url: `${BASE_URL}/testimonials/submit`,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
        { "@type": "ListItem", position: 2, name: "Testimonials", item: `${BASE_URL}/testimonials` },
        { "@type": "ListItem", position: 3, name: "Submit Your Story", item: `${BASE_URL}/testimonials/submit` },
      ],
    },
  };

  const body = `
  <div class="ssr-hero" style="background:linear-gradient(135deg,#1e3a5f 0%,#1a5276 100%);padding:5rem 1.5rem 3rem;">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb" style="color:rgba(255,255,255,0.7);">
        <a href="/" style="color:rgba(255,255,255,0.7);">Home</a><span>/</span>
        <a href="/testimonials" style="color:rgba(255,255,255,0.7);">Testimonials</a><span>/</span>
        <span style="color:#fff;">Submit Your Story</span>
      </div>
      <div class="ssr-hero-badge">🎬 Merchant Stories</div>
      <h1 style="color:#fff;">Submit Your Story</h1>
      <p class="ssr-hero-subtitle" style="color:rgba(255,255,255,0.85);">We'd love to feature you on our testimonials page. Share what you were paying, what changed, and what the savings meant for your business.</p>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner" style="max-width:720px;margin:0 auto;">
      <div class="ssr-card" style="padding:2.5rem;">
        <h2 style="font-size:1.25rem;font-weight:700;margin-bottom:1.5rem;color:#1e293b;">Your Information</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Your Name *</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">First and Last</div>
          </div>
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Business Name *</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">Your Business</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Email *</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">you@example.com</div>
          </div>
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Phone (optional)</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">(555) 000-0000</div>
          </div>
        </div>

        <h2 style="font-size:1.25rem;font-weight:700;margin-bottom:1.5rem;margin-top:2rem;color:#1e293b;border-top:1px solid #f1f5f9;padding-top:1.5rem;">Your Story</h2>
        <div style="margin-bottom:1rem;">
          <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Industry *</label>
          <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">Select your industry...</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Approximate Annual Savings (optional)</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">$0</div>
          </div>
          <div>
            <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Video Link (optional)</label>
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.625rem 0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;">https://youtube.com/...</div>
          </div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <label style="font-size:0.875rem;font-weight:600;display:block;margin-bottom:0.4rem;">Your Story *</label>
          <div style="border:1px solid #e2e8f0;border-radius:6px;padding:0.875rem;background:#f8fafc;color:#94a3b8;font-size:0.875rem;height:120px;">Tell us what you were paying before, what changed after switching, and what the savings meant for your business...</div>
        </div>
        <p style="font-size:0.75rem;color:#64748b;margin-bottom:1rem;">By submitting, you agree that Liberty Bancard may feature your story (with your permission) on our website and marketing materials.</p>
        <a href="/testimonials/submit" class="ssr-btn-primary" style="display:inline-block;width:100%;text-align:center;">Submit My Story →</a>
      </div>
      <div style="text-align:center;margin-top:1.5rem;">
        <a href="/testimonials" style="font-size:0.875rem;color:#64748b;">← Back to all testimonials</a>
      </div>
    </div>
  </section>`;

  return ssrHtmlShell({
    title: "Submit Your Merchant Story | Liberty Bancard",
    description: "Share your payment processing success story with Liberty Bancard. Submit a testimonial and we will feature your business on our merchant testimonials page.",
    canonical: "/testimonials/submit",
    keywords: "merchant testimonial submission, share payment processing story, Liberty Bancard merchant review",
    schemaJsons: [schema],
    body,
  });
}

export function getIntegrationsHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: INTEGRATIONS_META.title,
    description: INTEGRATIONS_META.schemaDescription,
    url: `${BASE_URL}${INTEGRATIONS_PATH}`,
    about: {
      "@type": "Service",
      name: "Payment Processing Compatibility Review",
      provider: { "@type": "Organization", name: "Liberty Bancard" },
      description: INTEGRATIONS_META.schemaAbout,
    },
  };

  const categoryHtml = INTEGRATION_CATEGORIES.map((cat) => {
    const items = INTEGRATION_RECORDS.filter((record) => record.category === cat.name);
    return `
    <div style="margin-bottom:3rem;">
      <h2 style="font-size:1.5rem;font-weight:700;margin-bottom:1.25rem;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:0.5rem;">${cat.name}</h2>
      <div class="ssr-grid-3" style="gap:1.25rem;">
        ${items
          .map((item) => {
            const active = showsActiveCheck(item);
            return `
          <div class="ssr-card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.75rem;">
              <div class="ssr-card-title" style="margin:0;">${item.name}</div>
              <span style="font-size:0.65rem;background:#eff6ff;color:#3b82f6;padding:0.15rem 0.5rem;border-radius:20px;font-weight:600;white-space:nowrap;">${COMPAT_STATE_LABEL[item.state]}</span>
            </div>
            <div class="ssr-card-text" style="margin-bottom:0.75rem;">${item.summary}</div>
            <div style="font-size:0.75rem;color:${active ? "#059669" : "#6b7280"};display:flex;align-items:flex-start;gap:0.4rem;">
              <span>${active ? "✓" : "?"}</span><span><strong>${active ? "Path:" : "We'll ask about:"}</strong> ${active ? item.path : item.askAbout}</span>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    </div>`;
  }).join("");

  const stats = integrationStats();

  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Integrations</span></div>
      <div class="ssr-hero-badge">🔌 ${INTEGRATIONS_HERO.badge}</div>
      <h1>${INTEGRATIONS_HERO.headingLead} ${INTEGRATIONS_HERO.headingAccent}</h1>
      <p class="ssr-hero-subtitle">${INTEGRATIONS_HERO.sub}</p>
      <p class="ssr-hero-subtitle" style="font-size:0.9rem;"><strong>${INTEGRATIONS_CALLOUT.title}.</strong> ${INTEGRATIONS_CALLOUT.text}</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 ${INTEGRATIONS_HERO.primaryCta}</a>
        <a href="#integrations-list" class="ssr-btn-outline">${INTEGRATIONS_HERO.browseCta} →</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <div class="ssr-grid-3" style="margin-bottom:2rem;">
        ${stats
          .map(
            (item) => `<div class="ssr-card" style="text-align:center;">
          <div style="font-size:2rem;font-weight:700;color:#1d4ed8;">${item.stat}</div>
          <div style="font-size:0.875rem;font-weight:600;">${item.label}</div>
        </div>`,
          )
          .join("\n        ")}
      </div>
    </div>
  </section>

  <section class="ssr-section" id="integrations-list">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${INTEGRATIONS_DIRECTORY.heading}</h2>
      <p class="ssr-section-subheading">${INTEGRATIONS_DIRECTORY.subheading}</p>
      ${categoryHtml}
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${INTEGRATIONS_PROCESS.heading}</h2>
      <div class="ssr-grid-3">
        ${INTEGRATIONS_PROCESS.steps
          .map((step, i) => `<div class="ssr-card"><div class="ssr-card-title">Step ${i + 1}: ${step.title}</div><div class="ssr-card-text">${step.text}</div></div>`)
          .join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.85rem;color:#6b7280;">${INTEGRATIONS_PROCESS.footnote}</p>
    </div>
  </section>

  ${ctaSection(INTEGRATIONS_CTA.heading, INTEGRATIONS_CTA.body)}`;

  return ssrHtmlShell({
    title: INTEGRATIONS_META.title,
    description: INTEGRATIONS_META.description,
    canonical: INTEGRATIONS_PATH,
    keywords: INTEGRATIONS_META.keywords,
    schemaJsons: [schema],
    body,
  });
}

export function getFaqHtml(): string {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "What is interchange-plus pricing?", acceptedAnswer: { "@type": "Answer", text: "Interchange-plus pricing passes the actual network cost (interchange) directly to you, plus a fixed markup that Liberty Bancard discloses on every statement. Whether it costs less than a flat rate depends on your card mix, volume and ticket size, and a statement review shows the comparison for your business." } },
      { "@type": "Question", name: "How long does merchant account approval take?", acceptedAnswer: { "@type": "Answer", text: TIMING_NOTE } },
      { "@type": "Question", name: "Is there a contract or early termination fee?", acceptedAnswer: { "@type": "Answer", text: "Contract terms and any applicable early termination fees are clearly outlined before you sign anything. We believe in transparency — you see all terms before committing." } },
      { "@type": "Question", name: "What is 0% processing?", acceptedAnswer: { "@type": "Answer", text: claimText("program.overview") } },
      { "@type": "Question", name: "How does a free statement review work?", acceptedAnswer: { "@type": "Answer", text: `Upload your current processing statement. ${claimText("review.process.summary")} ${claimText("review.cost.free")}` } },
      { "@type": "Question", name: "What payment types does Liberty Bancard support?", acceptedAnswer: { "@type": "Answer", text: "All major credit and debit cards (Visa, Mastercard, Discover, American Express), contactless payments (NFC/tap), mobile wallets (Apple Pay, Google Pay, Samsung Pay), and EMV chip transactions. ACH/bank transfer available for select programs." } },
    ],
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>FAQ</span></div>
      <div class="ssr-hero-badge">❓ Common Questions</div>
      <h1>Frequently Asked Questions</h1>
      <p class="ssr-hero-subtitle">Everything you need to know about merchant services, pricing, and working with Liberty Bancard.</p>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <div class="ssr-faq-wrapper">
        <div class="ssr-faq-item"><div class="ssr-faq-q">What is interchange-plus pricing?</div><div class="ssr-faq-a">Interchange-plus pricing passes the actual network cost (interchange) directly to you, plus a fixed markup disclosed on every statement. Whether it costs less than a flat rate depends on your card mix, volume and ticket size, and a statement review shows the comparison for your business.</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">How long does merchant account approval take?</div><div class="ssr-faq-a">${TIMING_NOTE}</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">Is there a contract or early termination fee?</div><div class="ssr-faq-a">Contract terms and any applicable early termination fees are clearly outlined before you sign anything. We believe in transparency — you see all terms before committing.</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">What is 0% processing?</div><div class="ssr-faq-a">${claimText("program.overview")}</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">How does a free statement review work?</div><div class="ssr-faq-a">Upload your current processing statement. ${claimText("review.process.summary")} ${claimText("review.cost.free")}</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">What payment types does Liberty Bancard support?</div><div class="ssr-faq-a">All major credit and debit cards, contactless (NFC/tap), mobile wallets (Apple Pay, Google Pay, Samsung Pay), and EMV chip transactions. ACH available for select programs.</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">How fast will I receive my deposits?</div><div class="ssr-faq-a">${claimText("funding.availability")}</div></div>
        <div class="ssr-faq-item"><div class="ssr-faq-q">Do I need to buy new equipment?</div><div class="ssr-faq-a">That depends on your current setup. ${claimText("compat.inquiry")} ${claimText("equipment.options.summary")}</div></div>
      </div>
    </div>
  </section>
  ${ctaSection("Still Have Questions?", "Your dedicated rep can answer any question about pricing, programs, or the switch process. No obligation.")}`;

  return ssrHtmlShell({
    title: "FAQ | Payment Processing Questions Answered | Liberty Bancard",
    description: "Answers to common questions about merchant services, interchange-plus pricing, 0% processing, statement reviews, and working with Liberty Bancard.",
    canonical: "/faq",
    keywords: "merchant services FAQ, payment processing questions, interchange plus explained, merchant account FAQ, credit card processing FAQ",
    schemaJsons: [faqSchema],
    body,
  });
}

export function getFreeAnalysisGuaranteedHtml(): string {
  const faqItems = [
    { q: "What exactly is the $50 guarantee?", a: "If we review your statement and cannot identify at least one verifiable savings opportunity, we'll send you a $50 Amazon gift card — no questions asked. We've reviewed 3,200+ statements and have only paid out a handful of gift cards. Most merchants save significantly more." },
    { q: "Is there any obligation to switch processors?", a: "None. You get the full written analysis and benchmark report regardless of what you decide. We show you the numbers — you decide what to do with them. We earn your business by proving value, not by locking you in." },
    { q: "Do I need to schedule a sales call?", a: "No sales call required. Upload your statement, we analyze it, and we send you the written report. If you want to talk through the numbers, we're available — but it's never a requirement." },
    { q: "What information do you need from my statement?", a: "We only need the fee and volume totals — not your merchant account number or banking info. You can redact any sensitive numbers before uploading. A PDF or photo of your statement works perfectly." },
    { q: "How long does the analysis take?", a: "We deliver your written savings summary within 24 business hours. Most analyses are completed the same day during business hours (Monday–Friday, 9am–6pm ET)." },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Free Merchant Statement Analysis — Guaranteed Savings",
    description: "Upload your merchant processing statement and we'll find your hidden fees, benchmark you against 3,200+ statements, and show you exactly what you should be paying. If we can't find you savings, we send you a $50 gift card.",
    provider: { "@type": "Organization", name: "Liberty Bancard", url: BASE_URL },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free statement analysis — $50 gift card guarantee if no savings found" },
  };

  const faqHtml = faqItems
    .map(
      (item) => `
    <div class="ssr-faq-item">
      <div class="ssr-faq-q">✅ ${item.q}</div>
      <div class="ssr-faq-a">${item.a}</div>
    </div>`
    )
    .join("");

  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Guarantee Analysis</span></div>
      <div class="ssr-hero-badge">🎁 100% Risk-Free Guarantee</div>
      <h1>If We Can't Save You Money, We'll Pay You $50</h1>
      <p class="ssr-hero-subtitle">Upload your processing statement and we'll find your hidden fees, benchmark you against 3,200+ real merchant statements, and deliver a written savings report within 24 hours. No sales call required. No obligation.</p>
      <div class="ssr-hero-buttons">
        <a href="/upload-statement" class="ssr-btn-primary">📤 Get My Free Analysis</a>
        <a href="tel:9542668214" class="ssr-btn-outline">📞 Call 954-266-8214</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <div style="max-width:48rem;margin:0 auto;border:2px solid #10b981;border-radius:0.75rem;background:#f0fdf4;padding:2rem;">
        <div style="display:flex;align-items:flex-start;gap:1.25rem;">
          <div style="width:3.5rem;height:3.5rem;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.5rem;">🎁</div>
          <div>
            <h2 style="font-family:'Source Serif 4',Georgia,'Times New Roman',serif;font-size:1.25rem;font-weight:700;color:#0f172a;margin-bottom:0.5rem;">Our Savings Guarantee</h2>
            <p style="font-size:0.875rem;color:#475569;line-height:1.7;margin-bottom:1rem;">We've reviewed over 3,200 merchant statements. Every single one had at least one identifiable savings opportunity. But if we review yours and genuinely cannot find a way to save you money, we'll send you a <strong>$50 Amazon gift card</strong> — just for your time.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#0f172a;">✅ Find savings in 24 hours or $50 gift card</div>
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#0f172a;">✅ No sales call required</div>
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#0f172a;">✅ No obligation to switch</div>
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#0f172a;">✅ No credit card needed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-dark">
    <div class="ssr-section-inner" style="text-align:center;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;max-width:36rem;margin:0 auto;">
        <div><div class="ssr-stat-value" style="color:#34d399;font-size:2.5rem;">3,200+</div><div class="ssr-stat-label" style="color:rgba(255,255,255,0.65);">Statements Reviewed</div></div>
        <div><div class="ssr-stat-value" style="color:#34d399;font-size:2.5rem;">$2,847</div><div class="ssr-stat-label" style="color:rgba(255,255,255,0.65);">Avg. Monthly Savings</div></div>
        <div><div class="ssr-stat-value" style="color:#34d399;font-size:2.5rem;">4.9/5</div><div class="ssr-stat-label" style="color:rgba(255,255,255,0.65);">Merchant Rating</div></div>
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What You Get</h2>
      <p class="ssr-section-subheading">Not a vague consultation — a real deliverable you keep, regardless of what you decide.</p>
      <div class="ssr-grid-3">
        <div class="ssr-card">
          <div class="ssr-card-title">📋 Full Statement Breakdown in Plain English</div>
          <div class="ssr-card-text">We decode every line: interchange costs, processor markup, assessment fees, and any junk fees you're being charged. Written so your accountant can read it.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">📊 Benchmark Against 3,200+ Statements</div>
          <div class="ssr-card-text">We compare your effective rate and fee structure against businesses in your industry and volume tier. See exactly where you stand versus the best-in-class merchants in your category.</div>
        </div>
        <div class="ssr-card">
          <div class="ssr-card-title">📈 Written Savings Summary You Can Share</div>
          <div class="ssr-card-text">A clear, one-page savings summary with your current rate, your target rate, and estimated annual savings — formatted so you can share with your accountant, business partner, or board.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">How It Works</h2>
      <p class="ssr-section-subheading">Three steps. Under 5 minutes on your end.</p>
      <div class="ssr-grid-3">
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">1️⃣</div>
          <div class="ssr-card-title">Upload Your Statement</div>
          <div class="ssr-card-text">Securely upload your most recent processing statement — PDF or photo. Redact account numbers if you prefer. We only need the fee and volume totals.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">2️⃣</div>
          <div class="ssr-card-title">We Analyze in 24 Hours</div>
          <div class="ssr-card-text">Our team reviews every line item, benchmarks your costs against industry peers, and builds your personalized written savings report.</div>
        </div>
        <div class="ssr-card" style="text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">3️⃣</div>
          <div class="ssr-card-title">Receive Your Report</div>
          <div class="ssr-card-text">You receive a written savings summary via email — with your current rate, your target rate, and estimated annual savings. No strings attached.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Industry Standards We Uphold</h2>
      <div class="ssr-grid-2" style="max-width:40rem;margin:0 auto;">
        <div class="ssr-card" style="text-align:center;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">🛡️</div><div class="ssr-card-title">PCI DSS Compliant</div><div class="ssr-card-text">Level 1 certified</div></div>
        <div class="ssr-card" style="text-align:center;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div><div class="ssr-card-title">SSL Encrypted</div><div class="ssr-card-text">256-bit encryption</div></div>
        <div class="ssr-card" style="text-align:center;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">🏅</div><div class="ssr-card-title">BBB Accredited</div><div class="ssr-card-text">A+ rating</div></div>
        <div class="ssr-card" style="text-align:center;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">⚡</div><div class="ssr-card-title">No Contract Required</div><div class="ssr-card-text">Month-to-month</div></div>
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
      <div class="ssr-faq-wrapper">
        ${faqHtml}
      </div>
    </div>
  </section>

  ${ctaSection("Not Signing Up Feels Irrational", "Either we find you savings — or we pay you $50. There is no scenario where you lose.")}`;

  return ssrHtmlShell({
    title: "Free Statement Analysis — Guaranteed Savings | Liberty Bancard",
    description: "Upload your statement and we'll find hidden fees, benchmark against 3,200+ statements, and show what you should pay. No savings? We'll send you a $50 gift card.",
    canonical: "/free-analysis-guaranteed",
    keywords: "free merchant statement analysis, guaranteed savings, payment processing review, hidden fees, merchant services benchmark",
    schemaJsons: [faqSchema, serviceSchema],
    body,
  });
}

export function getFreeSmartTerminalHtml(): string {
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: FST_SERVICE_NAME,
    description: FST_SERVICE_DESCRIPTION,
    url: `${BASE_URL}${FST_PATH}`,
    provider: { "@type": "Organization", name: "Liberty Bancard", url: BASE_URL },
    areaServed: { "@type": "Country", name: "United States" },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Free Smart Terminal", item: `${BASE_URL}${FST_PATH}` },
    ],
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: fstFaqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Free Smart Terminal</span></div>
      <div class="ssr-hero-badge">📱 ${FST_HERO.badge}</div>
      <h1>${FST_HERO.heading}</h1>
      <p class="ssr-hero-subtitle">${FST_HERO.sub}</p>
      ${FST_PLACEMENT_CLAIM ? `<p class="ssr-hero-subtitle">${FST_PLACEMENT_CLAIM} ${FST_EQUIPMENT_TERMS_DISCLOSURE}</p>` : ""}
      <div class="ssr-hero-buttons">
        <a href="${FST_INQUIRY_PATH}" class="ssr-btn-primary">📋 ${FST_HERO.primaryCta}</a>
      </div>
      <p class="ssr-hero-subtitle" style="font-size:0.95rem;">${FST_HERO.offerNote}</p>
      <p class="ssr-hero-subtitle" style="font-size:0.85rem;">${FST_HERO.disclaimer}</p>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FST_OFFER.heading}</h2>
      <p style="text-align:center;max-width:48rem;margin:0 auto 1.5rem;">${FST_OFFER.body}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        ${FST_OFFER.checklist.map((item) => `<div class="ssr-card"><div class="ssr-card-text">${item}</div></div>`).join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${FST_EQUIPMENT_TERMS_DISCLOSURE}</p>
      <p style="text-align:center;margin-top:1rem;">${FST_OFFER.secondaryLead} <a href="${FST_STATEMENT_REVIEW_PATH}" style="color:#3b82f6;">${FST_OFFER.secondaryCta}</a></p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FST_ELIGIBILITY.heading}</h2>
      <p style="text-align:center;max-width:48rem;margin:0 auto 1.5rem;">${FST_ELIGIBILITY.intro}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        ${FST_ELIGIBILITY.items.map((item) => `<div class="ssr-card"><div class="ssr-card-text">${item}</div></div>`).join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${FST_ELIGIBILITY.notGuaranteed}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FST_FEATURES_HEADING}</h2>
      <p style="text-align:center;max-width:48rem;margin:0 auto 1.5rem;">${FST_FEATURES_INTRO}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        ${FST_FEATURES.map((feature) => `<div class="ssr-card"><div class="ssr-card-title">${feature.label}</div><div class="ssr-card-text">${feature.desc}</div></div>`).join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${claimText("equipment.models.options", "page")}</p>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${FST_STEPS_HEADING}</h2>
      <p style="text-align:center;max-width:48rem;margin:0 auto 1.5rem;">${FST_STEPS_INTRO}</p>
      <div class="ssr-grid-2" style="max-width:48rem;margin:0 auto;">
        ${FST_STEPS.map((item) => `<div class="ssr-card"><div class="ssr-card-title">${item.step}. ${item.title}</div><div class="ssr-card-text">${item.desc}</div></div>`).join("\n        ")}
      </div>
      <p style="text-align:center;margin-top:1.5rem;font-size:0.9rem;color:#6b7280;">${FST_TIMING_NOTE}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
      <div class="ssr-faq-wrapper">
        ${fstFaqItems.map((item) => `<div class="ssr-faq-item"><div class="ssr-faq-q">${item.question}</div><div class="ssr-faq-a">${item.answer}</div></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h3 style="text-align:center;font-size:0.95rem;font-weight:600;color:#6b7280;margin-bottom:1rem;">Also useful:</h3>
      <div style="display:flex;flex-wrap:wrap;gap:1.5rem;justify-content:center;font-size:0.9rem;">
        <a href="/upload-statement" style="color:#3b82f6;">Upload Your Statement for a Free Review</a>
        <a href="/free-analysis" style="color:#3b82f6;">Get a Free Processing Analysis</a>
        <a href="/industries/restaurant-payment-processing" style="color:#3b82f6;">Restaurant Payment Processing</a>
        <a href="/industries/retail-payment-processing" style="color:#3b82f6;">Retail Payment Processing</a>
      </div>
    </div>
  </section>

  <section class="ssr-section ssr-section-dark">
    <div class="ssr-section-inner ssr-cta-section">
      <h2>${FST_FINAL.heading}</h2>
      <p>${FST_FINAL.body}</p>
      <div class="ssr-cta-buttons">
        <a href="${FST_INQUIRY_PATH}" class="ssr-btn-primary">📋 ${FST_HERO.primaryCta}</a>
        <a href="${FST_STATEMENT_REVIEW_PATH}" class="ssr-btn-outline">📤 Get a statement review</a>
      </div>
    </div>
  </section>`;

  return ssrHtmlShell({
    title: FST_TITLE_FULL,
    description: FST_DESCRIPTION,
    canonical: FST_PATH,
    keywords: FST_KEYWORDS,
    schemaJsons: [serviceSchema, breadcrumbSchema, faqSchema],
    body,
  });
}
