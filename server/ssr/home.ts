import {
  HOME_FAQ,
  HOME_FINAL,
  HOME_FOUNDER,
  HOME_HERO,
  HOME_HERO_IMAGE,
  HOME_INDUSTRIES_SECTION,
  HOME_LOCAL_BUSINESS_SCHEMA,
  HOME_META,
  HOME_ORGANIZATION_SCHEMA,
  HOME_PAYMENT_CONTEXTS,
  HOME_PROCESS,
  HOME_SAMPLE_REVIEW,
  HOME_SECTION_ORDER,
  HOME_SOLUTIONS,
  HOME_SOLUTIONS_ANCHOR,
  HOME_STARTING_POINTS,
  type HomeSectionId,
} from "@shared/public-home-content";
import { industryHref } from "@shared/public-industries";
import { HOME_VISUAL_BROWSER_SVG, HOME_VISUAL_PHONE_SVG } from "@shared/public-home-visuals";
import type { PublicImageId } from "../../client/src/lib/public-imagery";
import { ssrHtmlShell } from "../ssrShared";
import { pictureHtml } from "./picture";

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

function paymentContextsHtml(): string {
  const { terminalImage } = HOME_PAYMENT_CONTEXTS;
  const visual = (kind: (typeof HOME_PAYMENT_CONTEXTS.contexts)[number]["visual"]): string =>
    kind === "terminal"
      ? `<div class="ssr-ctx-term">${pictureHtml({ id: terminalImage.id, variant: terminalImage.variant, sizes: terminalImage.sizes })}</div>`
      : `<span aria-hidden="true">${kind === "phone" ? HOME_VISUAL_PHONE_SVG : HOME_VISUAL_BROWSER_SVG}</span>`;
  return `        <div class="ssr-contexts" role="group" aria-labelledby="home-payment-contexts-heading" aria-describedby="home-payment-contexts-description">
          <p class="ssr-eyebrow">${esc(HOME_PAYMENT_CONTEXTS.eyebrow)}</p>
          <h3 id="home-payment-contexts-heading">${esc(HOME_PAYMENT_CONTEXTS.heading)}</h3>
          <p class="ssr-section-subheading ssr-left">${esc(HOME_PAYMENT_CONTEXTS.intro)}</p>
          <span id="home-payment-contexts-description" class="ssr-sr-only">${esc(HOME_PAYMENT_CONTEXTS.description)}</span>
          <ul class="ssr-ctx-grid">
${HOME_PAYMENT_CONTEXTS.contexts
  .map(
    (context) => `            <li class="ssr-ctx-card">
              <div class="ssr-ctx-visual">${visual(context.visual)}</div>
              <div class="ssr-ctx-body">
                <h4 class="ssr-card-title">${esc(context.title)}</h4>
                <div class="ssr-card-text">${esc(context.body)}</div>
              </div>
            </li>`,
  )
  .join("\n")}
          </ul>
          <p class="ssr-note">${esc(HOME_PAYMENT_CONTEXTS.caption)}</p>
        </div>`;
}

/**
 * Server-rendered Home. Each section is emitted in HOME_SECTION_ORDER and tagged with the same
 * data-home-section value as the hydrated page, so the document a crawler or a slow connection receives
 * lists the same sections, in the same order, as the page that replaces it. All copy comes from
 * shared/public-home-content.ts (which reads the public claim records); nothing commercial is written here.
 */
const sections: Record<HomeSectionId, () => string> = {
  hero: () => `
    <section class="ssr-hero ssr-hero--light ssr-hero--home" data-home-section="hero">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-copy">
          <div class="ssr-hero-badge">${esc(HOME_HERO.eyebrow)}</div>
          <h1><span class="ssr-h1-first">${esc(HOME_HERO.headingFirst)}</span> <span class="ssr-h1-second">${esc(HOME_HERO.headingSecond)}</span></h1>
          <p class="ssr-hero-subtitle">
            ${esc(HOME_HERO.body)}
          </p>
          <div class="ssr-hero-buttons">
            <a href="${HOME_HERO.primary.href}" class="ssr-btn-dark">${esc(HOME_HERO.primary.label)}</a>
            <a href="${HOME_HERO.secondary.href}" class="ssr-btn-outline">${esc(HOME_HERO.secondary.label)}</a>
          </div>
          <p class="ssr-hero-helper ssr-md-only">${esc(HOME_HERO.desktopHelper)}</p>
          <p class="ssr-hero-qual ssr-md-only">${esc(HOME_HERO.desktopQualification)}</p>
        </div>
        <div class="ssr-hero-media">
          <div class="ssr-frame">${pictureHtml({
            id: HOME_HERO_IMAGE.id,
            variant: HOME_HERO_IMAGE.mobile.variant,
            sizes: HOME_HERO_IMAGE.mobile.sizes,
            artDirection: [HOME_HERO_IMAGE.desktop],
            priority: true,
          })}</div>
        </div>
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
${paymentContextsHtml()}
      </div>
    </section>`,

  industries: () => `
    <section class="ssr-section" data-home-section="industries">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_INDUSTRIES_SECTION.heading)}</h2>
        <p class="ssr-section-subheading">${esc(HOME_INDUSTRIES_SECTION.description)}</p>
        <ul class="ssr-ind-grid">
${HOME_INDUSTRIES_SECTION.entries.map((entry) => `          <li><a href="${industryHref(entry.slug)}" class="ssr-ind-card">
            <div class="ssr-frame">${pictureHtml({ id: entry.image as PublicImageId, variant: HOME_INDUSTRIES_SECTION.cardImage.variant, sizes: HOME_INDUSTRIES_SECTION.cardImage.sizes })}</div>
            <div class="ssr-ind-card-body">
              <h3 class="ssr-card-title">${esc(entry.title)}</h3>
              <div class="ssr-card-text">Best for: ${esc(entry.bestFor)}</div>
            </div>
          </a></li>`).join("\n")}
        </ul>
        <p class="ssr-center-link"><a href="${HOME_INDUSTRIES_SECTION.allHref}">${esc(HOME_INDUSTRIES_SECTION.allLabel)}</a></p>
        <p class="ssr-note">${esc(HOME_INDUSTRIES_SECTION.illustrativeNote)}</p>
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
            <div class="ssr-ws-head">
              <p class="ssr-ws-eyebrow">${esc(HOME_SAMPLE_REVIEW.eyebrow)}</p>
              <h3>${esc(HOME_SAMPLE_REVIEW.heading)}</h3>
              <p>${esc(HOME_SAMPLE_REVIEW.intro)}</p>
            </div>
            <div class="ssr-ws-doc">
              <div><strong>${esc(HOME_SAMPLE_REVIEW.documentLabel)}</strong><small>${esc(HOME_SAMPLE_REVIEW.documentNote)}</small></div>
              <span class="ssr-ws-stamp">${esc(HOME_SAMPLE_REVIEW.stamp)}</span>
            </div>
            <dl>
${HOME_SAMPLE_REVIEW.rows.map((row, i) => `              <div class="ssr-worksheet-row"><span class="ssr-ws-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div class="ssr-ws-body"><dt>${esc(row.label)}</dt><dd><strong>${esc(row.heading)}</strong> ${esc(row.note)}</dd></div><span aria-hidden="true">&mdash;</span></div>`).join("\n")}
            </dl>
            <p class="ssr-ws-foot">${esc(HOME_SAMPLE_REVIEW.footnote)}</p>
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
