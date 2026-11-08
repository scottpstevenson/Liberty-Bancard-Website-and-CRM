import { ssrHtmlShell } from "../ssrShared";
import {
  COMPARE_ENTRIES,
  COMPARE_HERO_DISCLAIMER,
  COMPARE_NEEDS,
  COMPARE_TABLE_FOOTNOTE,
  getCompareEntry,
  type CompareEntry,
} from "../../shared/compare-content";
import { describePriceRecord, formatCheckedDate } from "../../shared/competitor-pricing";

/** Single dataset shared with the React comparison page; consumers such as the SEO audit read it from here. */
export const COMPETITOR_DATA: Readonly<Record<string, CompareEntry>> = COMPARE_ENTRIES;

function renderCompareHtml(data: CompareEntry): string {
  const canonical = `/compare/${data.slug}`;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: "Compare Rates", item: "https://libertybancard.com/compare-rates" },
      { "@type": "ListItem", position: 3, name: `vs ${data.name}`, item: `https://libertybancard.com${canonical}` },
    ],
  };

  const tableRows = data.rows
    .map(
      (row) => `<tr>
        <td><strong>${row.feature}</strong></td>
        <td>${row.provider}</td>
        <td style="color:#1e3a5f;font-weight:500;">${row.liberty}</td>
      </tr>`,
    )
    .join("");

  const recordsHtml = data.records.length
    ? `<ul class="ssr-check-list">${data.records
        .map(
          (record) =>
            `<li><span class="check-icon">✓</span><span><strong>${describePriceRecord(record)}</strong><br/>Source: <a href="${record.sourceUrl}" rel="noopener noreferrer">${record.sourceUrl}</a>. Checked ${formatCheckedDate(record.checkedOn)}.</span></li>`,
        )
        .join("")}</ul>`
    : `<p class="ssr-card-text">${data.unpublishedNote ?? ""}</p>`;

  const needsHtml = COMPARE_NEEDS.items.map((item) => `<li><span class="check-icon">✓</span>${item}</li>`).join("");

  const faqsHtml = data.faqs
    .map(
      (f) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${f.question}</div>
      <div class="ssr-faq-a">${f.answer}</div>
    </div>`,
    )
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner" style="text-align:center;">
        <div class="ssr-breadcrumb" style="justify-content:center;display:flex;gap:0.25rem;">
          <a href="/">Home</a><span>/</span>
          <a href="/compare-rates">Compare</a><span>/</span>
          <span>vs ${data.name}</span>
        </div>
        <div class="ssr-hero-badge" style="margin:0 auto 1.25rem;">📊 Head-to-Head Comparison</div>
        <h1>Liberty Bancard vs ${data.name}</h1>
        <p class="ssr-hero-subtitle">${data.tagline}<br/><span style="font-size:0.9375rem;">${data.heroDescription}</span></p>
        <div class="ssr-hero-buttons" style="justify-content:center;">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Get My Free Statement Analysis</a>
          <a href="/savings-calculator" class="ssr-btn-outline">🧮 Try the Calculator</a>
        </div>
        <p class="ssr-hero-subtitle" style="font-size:0.8125rem;margin-top:1rem;">${COMPARE_HERO_DISCLAIMER}</p>
      </div>
    </div>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Side-by-Side Comparison</h2>
        <p class="ssr-section-subheading">${data.tableIntro}</p>
        <div class="ssr-table-wrapper">
          <table class="ssr-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>${data.name}</th>
                <th>Liberty Bancard</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <p style="font-size:0.75rem;color:#6b7280;text-align:center;margin-top:1rem;">${COMPARE_TABLE_FOOTNOTE}</p>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${data.ratesHeading}</h2>
        <div class="ssr-card">${recordsHtml}</div>
        <div class="ssr-card" style="margin-top:1.5rem;">
          <h3 class="ssr-card-title">${COMPARE_NEEDS.heading}</h3>
          <p class="ssr-card-text">${COMPARE_NEEDS.intro}</p>
          <ul class="ssr-check-list">${needsHtml}</ul>
        </div>
        <p style="font-size:0.75rem;color:#6b7280;text-align:center;margin-top:1rem;">${data.methodNote} ${COMPARE_NEEDS.footnote}</p>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Who May Prefer Which</h2>
        <div class="ssr-grid-2">
          <div class="ssr-card">
            <h3 class="ssr-card-title">${data.name} May Suit You If...</h3>
            <p class="ssr-card-text">${data.providerFit}</p>
          </div>
          <div class="ssr-card" style="border-color: #1e3a5f; border-width: 2px;">
            <h3 class="ssr-card-title" style="color:#1e3a5f;">Liberty Bancard May Suit You If...</h3>
            <p class="ssr-card-text">${data.libertyFit}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Frequently Asked Questions</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>Ready to Compare Your Costs With ${data.name}?</h2>
          <p>Upload your ${data.name} statement and we'll show you a line-by-line comparison with the inputs used. Free, no obligation.</p>
          <div class="ssr-cta-buttons">
            <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — Free Review</a>
            <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: data.metaTitle,
    description: data.metaDescription,
    canonical,
    keywords: data.metaKeywords,
    schemaJsons: [faqSchema, breadcrumbSchema],
    body,
  });
}

export function getCompareHtml(slug: string): string | null {
  const data = getCompareEntry(slug);
  if (!data) return null;
  return renderCompareHtml(data);
}
