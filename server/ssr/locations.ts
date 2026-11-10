import { ssrHtmlShell } from "../ssrShared";
import {
  buildLocationDetail,
  buildLocationHub,
  locationDocumentTitle,
  type LocationDetailContent,
  type LocationHubContent,
} from "../../shared/public-locations";

// Server documents for /locations/:city and /locations/:city/:industry. Every word comes from the shared
// location contract (shared/public-locations.ts), which the client routes also render, so the first HTML
// and the hydrated page say the same thing and neither can carry a local count, rate, office or promise.

const BASE_URL = "https://libertybancard.com";
const BRAND = "Liberty Bancard";

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serviceSchema(content: { title: string; metaDescription: string; canonicalPath: string; cityName: string; stateName: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: content.title,
    description: content.metaDescription,
    url: `${BASE_URL}${content.canonicalPath}`,
    serviceType: "Payment processing",
    provider: { "@type": "Organization", name: BRAND, url: BASE_URL },
    areaServed: {
      "@type": "City",
      name: content.cityName,
      containedInPlace: { "@type": "State", name: content.stateName },
    },
  };
}

function actionsHtml(primary: { label: string; href: string }, secondary: { label: string; href: string }): string {
  return `<a href="${esc(primary.href)}" class="ssr-btn-primary">${esc(primary.label)}</a>
          <a href="${esc(secondary.href)}" class="ssr-btn-outline">${esc(secondary.label)}</a>
          <a href="tel:9542668214" class="ssr-btn-outline" aria-label="Call Liberty Bancard at 954-266-8214">954-266-8214</a>`;
}

function renderDetail(content: LocationDetailContent): string {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((faq) => ({
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
      { "@type": "ListItem", position: 2, name: `${content.verticalName} Processing`, item: `${BASE_URL}${content.industryHref}` },
      { "@type": "ListItem", position: 3, name: `${content.cityName}, ${content.state}`, item: `${BASE_URL}${content.canonicalPath}` },
    ],
  };

  const topicsHtml = content.topics
    .map(
      (topic) => `<div class="ssr-card ssr-pain-item">
      <div class="ssr-solution-icon">✓</div>
      <div>
        <div class="ssr-item-title">${esc(topic.title)}</div>
        <div class="ssr-item-text">${esc(topic.description)}</div>
      </div>
    </div>`,
    )
    .join("");

  const faqsHtml = content.faqs
    .map(
      (faq) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${esc(faq.question)}</div>
      <div class="ssr-faq-a">${esc(faq.answer)}</div>
    </div>`,
    )
    .join("");

  const cityLinks = content.relatedCities
    .map((link) => `<a href="${esc(link.href)}" class="ssr-crosslink-btn">${esc(link.label)}</a>`)
    .join("");
  const verticalLinks = content.relatedVerticals
    .map((link) => `<a href="${esc(link.href)}" class="ssr-crosslink-btn">${esc(link.label)}</a>`)
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">${esc(content.badge)}</div>
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <a href="${esc(content.industryHref)}">${esc(content.verticalName)} Processing</a><span>/</span>
          <a href="${esc(content.hubHref)}">${esc(content.cityName)}, ${esc(content.state)}</a><span>/</span>
          <span>${esc(content.verticalName)}</span>
        </div>
        <h1>${esc(content.h1)}</h1>
        <p class="ssr-hero-subtitle">${esc(content.lead)}</p>
        <div class="ssr-hero-buttons">
          ${actionsHtml(content.primaryAction, content.secondaryAction)}
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(content.workflowHeading)}</h2>
        <p class="ssr-section-subheading">${esc(content.workflow)}</p>
        <h3 class="ssr-section-heading" style="font-size:1.25rem;">${esc(content.topicsHeading)}</h3>
        <div class="ssr-grid-2">${topicsHtml}</div>
        <p class="ssr-section-subheading">${esc(content.coverageNote)}</p>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(content.faqHeading)}</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(content.ctaHeading)}</h2>
          <p>${esc(content.ctaBody)}</p>
          <div class="ssr-cta-buttons">
            ${actionsHtml(content.primaryAction, content.secondaryAction)}
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h3 style="font-weight:700;text-align:center;margin-bottom:1rem;font-size:1.125rem;">${esc(content.citiesHeading)}</h3>
        <div class="ssr-crosslinks">${cityLinks}</div>
        <h3 style="font-weight:700;text-align:center;margin:2rem 0 1rem;font-size:1.125rem;">${esc(content.verticalsHeading)}</h3>
        <div class="ssr-crosslinks">${verticalLinks}</div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: locationDocumentTitle(content.title),
    description: content.metaDescription,
    canonical: content.canonicalPath,
    keywords: content.keywords,
    schemaJsons: [faqSchema, breadcrumbSchema, serviceSchema(content)],
    body,
  });
}

function renderHub(content: LocationHubContent): string {
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: `${content.cityName}, ${content.state}`, item: `${BASE_URL}${content.canonicalPath}` },
    ],
  };

  const verticalCardsHtml = content.verticals
    .map(
      (v) => `
    <div class="ssr-card">
      <a href="${esc(v.href)}" style="text-decoration:none;color:inherit;display:block;">
        <div class="ssr-item-title" style="margin-bottom:4px;">${esc(v.name)} Payment Processing</div>
        <div class="ssr-item-text" style="margin-bottom:8px;">${esc(v.summary)}</div>
        <div style="color:#0369a1;font-size:13px;font-weight:500;">${esc(v.name)} in ${esc(content.cityName)}</div>
      </a>
    </div>`,
    )
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">${esc(content.badge)}</div>
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <span>${esc(content.cityName)}, ${esc(content.state)}</span>
        </div>
        <h1>${esc(content.h1)}</h1>
        <p class="ssr-hero-subtitle">${esc(content.lead)}</p>
        <div class="ssr-hero-buttons">
          ${actionsHtml(content.primaryAction, content.secondaryAction)}
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(content.verticalsHeading)}</h2>
        <p class="ssr-section-subheading">${esc(content.verticalsIntro)}</p>
        <div class="ssr-grid-2">${verticalCardsHtml}</div>
        <p class="ssr-section-subheading">${esc(content.coverageNote)}</p>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(content.ctaHeading)}</h2>
          <p>${esc(content.ctaBody)}</p>
          <div class="ssr-cta-buttons">
            ${actionsHtml(content.primaryAction, content.secondaryAction)}
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: locationDocumentTitle(content.title),
    description: content.metaDescription,
    canonical: content.canonicalPath,
    keywords: content.keywords,
    schemaJsons: [breadcrumbSchema, serviceSchema(content)],
    body,
  });
}

export function getLocationHtml(citySlug: string, industrySlug: string): string | null {
  const content = buildLocationDetail(citySlug, industrySlug);
  return content ? renderDetail(content) : null;
}

export function getCityHubHtml(citySlug: string): string | null {
  const content = buildLocationHub(citySlug);
  return content ? renderHub(content) : null;
}
