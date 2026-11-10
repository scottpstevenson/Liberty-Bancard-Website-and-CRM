import type { PublicImageId } from "../../client/src/lib/public-imagery";
import { ssrHtmlShell } from "../ssrShared";
import { pictureHtml } from "./picture";
import {
  INDUSTRY_CONTENT,
  INDUSTRY_HERO_IMAGES,
  INDUSTRY_HERO_PICTURE,
  INDUSTRY_PRIMARY_ACTION,
  INDUSTRY_SECONDARY_ACTION,
  getIndustryContent,
  industrySections,
  type IndustryContent,
} from "../../shared/public-industry-content";

// Server documents for all 14 /industries/:slug routes. The words come from the shared industry
// contract that the React page also renders, so a route has the same title, H1 and sections in the
// first HTML and after hydration, and no entry can carry a rate, savings figure or promise the other
// renderer lacks.

const BASE_URL = "https://libertybancard.com";
const BRAND = "Liberty Bancard";

/** Slug-keyed view of the shared content; scripts/seo-audit.ts reads the keys as the route list. */
export const INDUSTRY_DATA: Record<string, IndustryContent> = Object.fromEntries(
  INDUSTRY_CONTENT.map((entry) => [entry.slug, entry]),
);

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itemCard(icon: string, iconClass: string, item: { title: string; description: string }): string {
  return `<div class="ssr-card ssr-pain-item">
      <div class="${iconClass}">${icon}</div>
      <div>
        <div class="ssr-item-title">${esc(item.title)}</div>
        <div class="ssr-item-text">${esc(item.description)}</div>
      </div>
    </div>`;
}

function renderIndustryHtml(data: IndustryContent): string {
  const canonical = `/industries/${data.slug}`;
  const sections = industrySections(data);

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
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Industries", item: `${BASE_URL}/industries` },
      { "@type": "ListItem", position: 3, name: data.name, item: `${BASE_URL}${canonical}` },
    ],
  };
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${data.name} Payment Processing`,
    description: data.metaDescription,
    url: `${BASE_URL}${canonical}`,
    serviceType: "Payment processing",
    provider: { "@type": "Organization", name: BRAND, url: BASE_URL },
  };

  const considerationsHtml = data.considerations.map((item) => itemCard("?", "ssr-pain-icon", item)).join("");
  const reviewHtml = sections.review.map((item) => itemCard("✓", "ssr-solution-icon", item)).join("");
  const faqsHtml = data.faqs
    .map(
      (faq) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${esc(faq.question)}</div>
      <div class="ssr-faq-a">${esc(faq.answer)}</div>
    </div>`,
    )
    .join("");
  const crosslinksHtml = INDUSTRY_CONTENT.filter((entry) => entry.slug !== data.slug)
    .map((entry) => `<a href="/industries/${esc(entry.slug)}" class="ssr-crosslink-btn">${esc(entry.name)}</a>`)
    .join("");

  const actions = `<a href="${esc(INDUSTRY_PRIMARY_ACTION.href)}" class="ssr-btn-primary">${esc(INDUSTRY_PRIMARY_ACTION.label)}</a>
          <a href="${esc(INDUSTRY_SECONDARY_ACTION.href)}" class="ssr-btn-outline">${esc(INDUSTRY_SECONDARY_ACTION.label)}</a>
          <a href="tel:9542668214" class="ssr-btn-outline" aria-label="Call Liberty Bancard at 954-266-8214">954-266-8214</a>`;

  const heroImage = INDUSTRY_HERO_IMAGES[data.slug] as PublicImageId | undefined;
  const heroVisual = heroImage
    ? `
        <div class="ssr-industry-visual">
          <div class="ssr-frame">${pictureHtml({ id: heroImage, variant: INDUSTRY_HERO_PICTURE.variant, sizes: INDUSTRY_HERO_PICTURE.sizes, priority: true })}</div>
          <p class="ssr-industry-visual-caption">${esc(INDUSTRY_HERO_PICTURE.caption)}</p>
        </div>`
    : "";

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <a href="/industries">Industries</a><span>/</span>
          <span>${esc(data.name)}</span>
        </div>
        <h1>${esc(data.heroTitle)}</h1>
        <p class="ssr-hero-subtitle">${esc(data.heroSubtitle)}</p>
        <div class="ssr-hero-buttons">
          ${actions}
        </div>${heroVisual}
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(sections.considerationsHeading)}</h2>
        <p class="ssr-section-subheading">${esc(sections.considerationsIntro)}</p>
        <div class="ssr-grid-2">${considerationsHtml}</div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(sections.reviewHeading)}</h2>
        <p class="ssr-section-subheading">${esc(sections.reviewIntro)}</p>
        <div class="ssr-grid-2">${reviewHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(sections.faqHeading)}</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(sections.ctaHeading)}</h2>
          <p>${esc(sections.ctaBody)}</p>
          <div class="ssr-cta-buttons">
            ${actions}
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h3 style="font-weight:700;text-align:center;margin-bottom:1rem;font-size:1.125rem;">${esc(sections.crosslinksHeading)}</h3>
        <div class="ssr-crosslinks">${crosslinksHtml}</div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: `${data.metaTitle} | ${BRAND}`,
    description: data.metaDescription,
    canonical,
    keywords: data.keywords,
    schemaJsons: [faqSchema, breadcrumbSchema, serviceSchema],
    body,
  });
}

export function getIndustryHtml(slug: string): string | null {
  const data = getIndustryContent(slug);
  if (!data) return null;
  return renderIndustryHtml(data);
}
