import {
  HOME_FAQ,
  HOME_FINAL,
  HOME_FOUNDER,
  HOME_HERO,
  HOME_INDUSTRIES_SECTION,
  HOME_LOCAL_BUSINESS_SCHEMA,
  HOME_META,
  HOME_ORGANIZATION_SCHEMA,
  HOME_PROCESS,
  HOME_SAMPLE_REVIEW,
  HOME_SECTION_ORDER,
  HOME_SOLUTIONS,
  HOME_SOLUTIONS_ANCHOR,
  HOME_STARTING_POINTS,
  type HomeSectionId,
} from "@shared/public-home-content";
import { industryHref } from "@shared/public-industries";
import { ssrHtmlShell } from "../ssrShared";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Liberty Bancard",
  url: "https://libertybancard.com",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://libertybancard.com/blog?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

/**
 * Server-rendered Home. Each section is emitted in HOME_SECTION_ORDER and tagged with the same
 * data-home-section value as the hydrated page, so the document a crawler or a slow connection receives
 * lists the same sections, in the same order, as the page that replaces it. All copy comes from
 * shared/public-home-content.ts (which reads the public claim records); nothing commercial is written here.
 */
const sections: Record<HomeSectionId, () => string> = {
  hero: () => `
    <section class="ssr-hero ssr-hero--light" data-home-section="hero">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">${esc(HOME_HERO.eyebrow)}</div>
        <h1>${esc(HOME_HERO.heading)}</h1>
        <p class="ssr-hero-subtitle">
          ${esc(HOME_HERO.body)}
        </p>
        <div class="ssr-hero-buttons">
          <a href="${HOME_HERO.primary.href}" class="ssr-btn-dark">${esc(HOME_HERO.primary.label)}</a>
          <a href="${HOME_HERO.secondary.href}" class="ssr-btn-outline">${esc(HOME_HERO.secondary.label)}</a>
        </div>
        <p class="ssr-hero-note">${esc(HOME_HERO.compliance)}</p>
      </div>
    </section>`,

  solutions: () => `
    <section class="ssr-section ssr-section-muted" id="${HOME_SOLUTIONS_ANCHOR}" data-home-section="solutions">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_SOLUTIONS.heading)}</h2>
        <div class="ssr-grid-3">
${HOME_SOLUTIONS.cards.map((card) => `          <a href="${card.href}" class="ssr-card ssr-card-link">
            <div class="ssr-card-title">${esc(card.title)}</div>
            <div class="ssr-card-text">${esc(card.body)}</div>
            <div class="ssr-card-cta">${esc(card.linkLabel)}</div>
          </a>`).join("\n")}
        </div>
      </div>
    </section>`,

  industries: () => `
    <section class="ssr-section" data-home-section="industries">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_INDUSTRIES_SECTION.heading)}</h2>
        <p class="ssr-section-subheading">${esc(HOME_INDUSTRIES_SECTION.description)}</p>
        <div class="ssr-grid-3">
${HOME_INDUSTRIES_SECTION.entries.map((entry) => `          <a href="${industryHref(entry.slug)}" class="ssr-card ssr-card-link">
            <div class="ssr-card-title">${esc(entry.title)}</div>
            <div class="ssr-card-text">Best for: ${esc(entry.bestFor)}</div>
          </a>`).join("\n")}
        </div>
        <p class="ssr-center-link"><a href="${HOME_INDUSTRIES_SECTION.allHref}">${esc(HOME_INDUSTRIES_SECTION.allLabel)}</a></p>
      </div>
    </section>`,

  "starting-points": () => `
    <section class="ssr-section ssr-section-muted" data-home-section="starting-points">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_STARTING_POINTS.heading)}</h2>
        <div class="ssr-grid-2">
${HOME_STARTING_POINTS.cards.map((card) => `          <div class="ssr-card ssr-card-accent">
            <h3 class="ssr-card-title">${esc(card.title)}</h3>
            <div class="ssr-card-text">${esc(card.body)}</div>
            <p class="ssr-card-action"><a href="${card.href}" class="ssr-btn-dark">${esc(card.ctaLabel)}</a></p>
            <div class="ssr-card-text">${esc(card.note)}</div>
          </div>`).join("\n")}
        </div>
      </div>
    </section>`,

  founder: () => `
    <section class="ssr-section" data-home-section="founder">
      <div class="ssr-section-inner">
        <div class="ssr-founder">
          <h2 class="ssr-section-heading ssr-left">${esc(HOME_FOUNDER.heading)}</h2>
          <p class="ssr-section-subheading ssr-left">${esc(HOME_FOUNDER.body)}</p>
          <a href="${HOME_FOUNDER.cta.href}" class="ssr-btn-dark">${esc(HOME_FOUNDER.cta.label)}</a>
        </div>
      </div>
    </section>`,

  process: () => `
    <section class="ssr-section ssr-section-muted" data-home-section="process">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_PROCESS.heading)}</h2>
        <div class="ssr-grid-2">
          <ol class="ssr-steps">
${HOME_PROCESS.steps.map((step, i) => `            <li class="ssr-card">
              <span class="ssr-step-num" aria-hidden="true">${i + 1}</span>
              <div>
                <h3 class="ssr-card-title">${esc(step.title)}</h3>
                <div class="ssr-card-text">${esc(step.body)}</div>
              </div>
            </li>`).join("\n")}
          </ol>
          <figure class="ssr-card ssr-worksheet" aria-label="Statement review layout (illustrative, no results shown)">
            <dl>
${HOME_SAMPLE_REVIEW.rows.map((row) => `              <div class="ssr-worksheet-row"><div><dt>${esc(row.label)}</dt><dd>${esc(row.note)}</dd></div><span aria-hidden="true">&mdash;</span></div>`).join("\n")}
            </dl>
            <figcaption>${esc(HOME_SAMPLE_REVIEW.label)}</figcaption>
          </figure>
        </div>
        <p class="ssr-center-link">${HOME_PROCESS.links.map((link) => `<a href="${link.href}">${esc(link.label)}</a>`).join(" &nbsp;&middot;&nbsp; ")}</p>
      </div>
    </section>`,

  faq: () => `
    <section class="ssr-section" data-home-section="faq">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_FAQ.heading)}</h2>
        <div class="ssr-faq-wrapper">
${HOME_FAQ.items.map((item) => `          <div class="ssr-faq-item">
            <h3 class="ssr-faq-q">${esc(item.question)}</h3>
            <p class="ssr-faq-a">${esc(item.answer)}${item.link ? ` <a href="${item.link.href}" style="text-decoration:underline;">${esc(item.link.label)}</a>` : ""}</p>
          </div>`).join("\n")}
        </div>
      </div>
    </section>`,

  final: () => `
    <section class="ssr-section ssr-section-dark" data-home-section="final">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <p class="ssr-final-eyebrow">${esc(HOME_FINAL.eyebrow)}</p>
          <h2>${esc(HOME_FINAL.heading)}</h2>
          <p>${esc(HOME_FINAL.body)}</p>
          <div class="ssr-cta-buttons">
${HOME_FINAL.actions.map((action, i) => `            <a href="${action.href}" class="${i === 0 ? "ssr-btn-primary" : "ssr-btn-outline"}">${esc(action.label)}</a>`).join("\n")}
          </div>
          <ul class="ssr-final-channels">
${HOME_FINAL.channels.map((channel) => `            <li><a href="${esc(channel.href)}">${esc(channel.label)}</a></li>`).join("\n")}
          </ul>
          <p class="ssr-final-note">${esc(HOME_FINAL.disclosure)}</p>
          <p class="ssr-final-note"><a href="${HOME_FINAL.callback.fallbackHref}" style="text-decoration:underline;">${esc(HOME_FINAL.callback.fallbackLabel)}</a></p>
        </div>
      </div>
    </section>`,
};

export function getHomeHtml(): string {
  const body = HOME_SECTION_ORDER.map((id) => sections[id]()).join("\n");
  return ssrHtmlShell({
    title: HOME_META.title,
    description: HOME_META.description,
    canonical: "/",
    // Logo card sized for iOS/social square crops; the generated card is the fallback for other pages.
    ogImage: HOME_META.ogImage,
    keywords: HOME_META.keywords,
    schemaJsons: [HOME_ORGANIZATION_SCHEMA, HOME_LOCAL_BUSINESS_SCHEMA, webSiteSchema],
    body,
  });
}
