import { ssrHtmlShell } from "../ssrShared";
import { getOverviewPageHtml } from "./overview-pages";
import { publicProofFor } from "../data/public-proof-register";
import { proofOverviewPage, TESTIMONIAL_SUBMIT_COPY } from "@shared/public-proof";
import { WHY_LIBERTY_PAGE } from "@shared/public-why-liberty";
import { FREE_ANALYSIS_PAGE, FREE_ANALYSIS_QUIZ_PAGE } from "@shared/public-free-analysis";
import { claimText } from "@shared/public-claims";
import { CALC_COPY, CALC_PATH, CALC_STRUCTURED_DATA } from "@shared/public-cost-calculator";
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

import { TERMINAL_INQUIRY_PAGE, TERMINAL_INQUIRY_PATH, readTerminalIntent } from "@shared/public-terminal-inquiry";

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
    <span id="upload-form"></span>
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading" id="statement-form-heading" tabindex="-1">${FSR_FORM.heading}</h2>
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
  return getOverviewPageHtml(FREE_ANALYSIS_QUIZ_PAGE);
}

export function getWhyLibertyHtml(): string {
  return getOverviewPageHtml(WHY_LIBERTY_PAGE);
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
  return getOverviewPageHtml(proofOverviewPage("case-studies", publicProofFor("case-studies")));
}

export function getEstimateHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Free Effective Rate Estimate | Liberty Bancard",
    description: "Share monthly volume and total fees for a preliminary effective rate estimate and next steps.",
    url: `${BASE_URL}/estimate`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Get an Estimate</span></div>
      <div class="ssr-hero-badge">Effective rate estimate</div>
      <h1>Get a Fast Effective Rate Estimate</h1>
      <p class="ssr-hero-subtitle">Share monthly volume and total fees. We'll estimate your effective rate and recommend next steps. For a definitive comparison, upload a statement anytime.</p>
      <div class="ssr-hero-buttons">
        <a href="/estimate#tool" class="ssr-btn-primary">Request my estimate</a>
        <a href="/upload-statement" class="ssr-btn-outline">Upload a statement instead</a>
      </div>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What is an effective rate?</h2>
      <div class="ssr-card">
        <div class="ssr-card-title">Effective rate = total fees &divide; total volume</div>
        <div class="ssr-card-text">Example: $450 in fees on $18,000 of card volume is a 2.5% effective rate. The arithmetic is only an example; your own statement shows your figures.</div>
      </div>
      <p class="ssr-section-subheading">${claimText("review.effective-cost.definition")}</p>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">What happens after you send it</h2>
      <p class="ssr-section-subheading">${claimText("review.process.summary")}</p>
      <p class="ssr-section-subheading">${claimText("review.cost.free")}</p>
    </div>
  </section>
  ${ctaSection("Want exact figures?", "An estimate works from two numbers. A statement review works from the fees on your statement.")}`;

  return ssrHtmlShell({
    title: "Free Effective Rate Estimate | Liberty Bancard",
    description: "Get a quick processing cost estimate. Provide your monthly volume and current fees for a preliminary analysis and next steps.",
    canonical: "/estimate",
    keywords: "effective rate estimate, payment processing cost estimate, merchant services estimate, processing fee estimate",
    schemaJsons: [schema],
    body,
  });
}

export function getSavingsCalculatorHtml(): string {
  const schema = { ...CALC_STRUCTURED_DATA, url: `${BASE_URL}${CALC_PATH}` };
  const stepsHtml = CALC_COPY.steps
    .map(
      (step, i) => `<div class="ssr-card">
          <div class="ssr-card-title">${i + 1}. ${step.title}</div>
          <div class="ssr-card-text">${step.text}</div>
        </div>`,
    )
    .join("");
  const whyHtml = CALC_COPY.why
    .map((item) => `<div class="ssr-card"><div class="ssr-card-title">${item.title}</div><div class="ssr-card-text">${item.text}</div></div>`)
    .join("");
  const helpHtml = CALC_COPY.help
    .map((item) => `<div class="ssr-card"><div class="ssr-card-title">${item.title}</div><div class="ssr-card-text">${item.text}</div></div>`)
    .join("");
  const faqHtml = CALC_COPY.faq
    .map((f) => `<div class="ssr-faq-item"><div class="ssr-faq-q">${f.question}</div><div class="ssr-faq-a">${f.answer}</div></div>`)
    .join("");
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>${CALC_COPY.breadcrumbLabel}</span></div>
      <div class="ssr-hero-badge">${CALC_COPY.badge}</div>
      <h1>${CALC_COPY.h1}</h1>
      <p class="ssr-hero-subtitle">${CALC_COPY.subtitle}</p>
      <div class="ssr-hero-buttons">
        <a href="${CALC_PATH}#calc" class="ssr-btn-primary">Open the calculator</a>
        <a href="/upload-statement" class="ssr-btn-outline">Get a free statement review</a>
      </div>
      <p class="ssr-hero-subtitle" style="font-size:0.8125rem;margin-top:1rem;">${CALC_COPY.disclaimer}</p>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">How it works</h2>
      <div class="ssr-grid-3">${stepsHtml}</div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${CALC_COPY.whyHeading}</h2>
      <p class="ssr-section-subheading">${CALC_COPY.whyIntro}</p>
      <div class="ssr-grid-3">${whyHtml}</div>
    </div>
  </section>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${CALC_COPY.helpHeading}</h2>
      <div class="ssr-grid-2">${helpHtml}</div>
    </div>
  </section>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${CALC_COPY.faqHeading}</h2>
      ${faqHtml}
    </div>
  </section>
  ${ctaSection(CALC_COPY.finalHeading, CALC_COPY.finalText)}`;

  return ssrHtmlShell({
    title: `${CALC_COPY.title} | Liberty Bancard`,
    description: CALC_COPY.description,
    canonical: CALC_PATH,
    keywords: CALC_COPY.keywords,
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

/**
 * The terminal entrance of /get-started, rendered from the same shared intent contract and copy as the hydrated page. It is
 * an inquiry, never the merchant-application prerequisite list, and nothing from the request is reflected into the markup.
 */
function getTerminalInquiryHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${TERMINAL_INQUIRY_PAGE.title} | Liberty Bancard`,
    description: TERMINAL_INQUIRY_PAGE.description,
    url: `${BASE_URL}${TERMINAL_INQUIRY_PATH}`,
  };
  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Get Started</span></div>
      <h1>${TERMINAL_INQUIRY_PAGE.heading}</h1>
      <p class="ssr-hero-subtitle">${TERMINAL_INQUIRY_PAGE.body}</p>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner">
      <h2 class="ssr-section-heading">${TERMINAL_INQUIRY_PAGE.asksHeading}</h2>
      <ul class="ssr-check-list" style="max-width:36rem;margin:0 auto;">
        ${TERMINAL_INQUIRY_PAGE.asks.map((item) => `<li><span class="check-icon">✓</span>${item}</li>`).join("\n        ")}
      </ul>
      <p class="ssr-card-text" style="text-align:center;margin-top:1.5rem;">${TERMINAL_INQUIRY_PAGE.asksNote}</p>
      <p class="ssr-card-text" style="text-align:center;">${TERMINAL_INQUIRY_PAGE.phoneLead} <a href="tel:9542668214">954-266-8214</a></p>
    </div>
  </section>`;

  return ssrHtmlShell({
    title: `${TERMINAL_INQUIRY_PAGE.title} | Liberty Bancard`,
    description: TERMINAL_INQUIRY_PAGE.description,
    canonical: TERMINAL_INQUIRY_PATH,
    keywords: "terminal eligibility inquiry, equipment program review, merchant terminal options",
    schemaJsons: [schema],
    body,
  });
}

/** `search` is the raw query string. It selects one of two allowlisted renderings and is never echoed. */
export function getGetStartedHtml(search = ""): string {
  if (readTerminalIntent(search).terminal) return getTerminalInquiryHtml();
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
  return getOverviewPageHtml(proofOverviewPage("testimonials", publicProofFor("testimonials")));
}

export function getTestimonialsSubmitHtml(): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${TESTIMONIAL_SUBMIT_COPY.title} | Liberty Bancard`,
    description: TESTIMONIAL_SUBMIT_COPY.description,
    url: `${BASE_URL}/testimonials/submit`,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
        { "@type": "ListItem", position: 2, name: "Testimonials", item: `${BASE_URL}/testimonials` },
        { "@type": "ListItem", position: 3, name: TESTIMONIAL_SUBMIT_COPY.title, item: `${BASE_URL}/testimonials/submit` },
      ],
    },
  };

  const body = `
  <div class="ssr-hero" style="background:linear-gradient(135deg,#1e3a5f 0%,#1a5276 100%);padding:5rem 1.5rem 3rem;">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb" style="color:rgba(255,255,255,0.7);">
        <a href="/" style="color:rgba(255,255,255,0.7);">Home</a><span>/</span>
        <a href="/testimonials" style="color:rgba(255,255,255,0.7);">Testimonials</a><span>/</span>
        <span style="color:#fff;">${TESTIMONIAL_SUBMIT_COPY.title}</span>
      </div>
      <div class="ssr-hero-badge">Your experience</div>
      <h1 style="color:#fff;">${TESTIMONIAL_SUBMIT_COPY.title}</h1>
      <p class="ssr-hero-subtitle" style="color:rgba(255,255,255,0.85);">${TESTIMONIAL_SUBMIT_COPY.intro}</p>
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
        <p style="font-size:0.75rem;color:#64748b;margin-bottom:1rem;">${TESTIMONIAL_SUBMIT_COPY.usage}</p>
        <a href="/testimonials/submit" class="ssr-btn-primary" style="display:inline-block;width:100%;text-align:center;">Send my experience →</a>
      </div>
      <div style="text-align:center;margin-top:1.5rem;">
        <a href="/testimonials" style="font-size:0.875rem;color:#64748b;">← Back to testimonials</a>
      </div>
    </div>
  </section>`;

  return ssrHtmlShell({
    title: `${TESTIMONIAL_SUBMIT_COPY.title} | Liberty Bancard`,
    description: TESTIMONIAL_SUBMIT_COPY.description,
    canonical: "/testimonials/submit",
    keywords: "share your experience, Liberty Bancard merchant feedback",
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
  return getOverviewPageHtml(FREE_ANALYSIS_PAGE);
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
