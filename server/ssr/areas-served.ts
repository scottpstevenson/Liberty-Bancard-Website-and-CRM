import { ssrHtmlShell } from "../ssrShared";
import { buildAreasServed } from "../../shared/public-locations";

// First HTML for /areas-served. The content is the same shared contract the React page renders, so a
// crawler sees the title, the single H1 and the South Florida-first hierarchy before JavaScript runs.

const BASE_URL = "https://libertybancard.com";

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getAreasServedHtml(): string {
  const content = buildAreasServed();

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Areas Served", item: `${BASE_URL}${content.path}` },
    ],
  };

  const groupsHtml = content.groups
    .map((group) => {
      const cities = group.cities
        .map((city) => {
          const verticals = city.verticals.length
            ? `<ul style="list-style:none;margin:8px 0 0;padding:0;">${city.verticals
                .map((v) => `<li><a href="${esc(v.href)}" style="font-size:14px;">${esc(v.label)}</a></li>`)
                .join("")}</ul>`
            : "";
          return `<div class="ssr-card"><div class="ssr-item-title"><a href="${esc(city.hubHref)}">${esc(city.label)}</a></div>${verticals}</div>`;
        })
        .join("");
      return `<h3 class="ssr-section-heading" style="font-size:1.25rem;text-align:left;">${esc(group.heading)}</h3>
        <p class="ssr-item-text" style="margin-bottom:1rem;">${esc(group.intro)}</p>
        <div class="ssr-grid-2" style="margin-bottom:2rem;">${cities}</div>`;
    })
    .join("");

  const industriesHtml = content.industries
    .map((industry) => `<a href="${esc(industry.href)}" class="ssr-crosslink-btn">${esc(industry.label)}</a>`)
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">${esc(content.badge)}</div>
        <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Areas Served</span></div>
        <h1>${esc(content.h1)}</h1>
        <p class="ssr-hero-subtitle">${esc(content.lead)}</p>
        <div class="ssr-hero-buttons">
          <a href="${esc(content.primaryAction.href)}" class="ssr-btn-primary">${esc(content.primaryAction.label)}</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(content.groupsHeading)}</h2>
        <p class="ssr-section-subheading">${esc(content.coverageNote)}</p>
        ${groupsHtml}
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(content.industriesHeading)}</h2>
        <p class="ssr-section-subheading">${esc(content.industriesIntro)}</p>
        <div class="ssr-crosslinks">${industriesHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(content.ctaHeading)}</h2>
          <p>${esc(content.ctaBody)}</p>
          <div class="ssr-cta-buttons">
            <a href="${esc(content.primaryAction.href)}" class="ssr-btn-primary">${esc(content.primaryAction.label)}</a>
            <a href="${esc(content.secondaryAction.href)}" class="ssr-btn-outline">${esc(content.secondaryAction.label)}</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: `${content.title} | Liberty Bancard`,
    description: content.metaDescription,
    canonical: content.path,
    schemaJsons: [breadcrumbSchema],
    body,
  });
}
