import { OVERVIEW_PAGES, type OverviewItem, type OverviewMedia, type OverviewPage, type OverviewSection } from "@shared/public-overview-pages";
import type { PublicImageId } from "../../client/src/lib/public-imagery";
import { ssrHtmlShell } from "../ssrShared";
import { pictureHtml } from "./picture";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function itemHtml(item: OverviewItem): string {
  return `          <div class="ssr-card ssr-card-accent">
${item.badge ? `            <div class="ssr-badge">${esc(item.badge)}</div>\n` : ""}            <h3 class="ssr-card-title">${esc(item.title)}</h3>
            <div class="ssr-card-text">${esc(item.body)}</div>
${item.points && item.points.length > 0 ? `            <ul class="ssr-points">${item.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>\n` : ""}${item.link ? `            <p class="ssr-inline-link"><a href="${item.link.href}">${esc(item.link.label)}</a></p>\n` : ""}          </div>`;
}

function stepHtml(item: OverviewItem, index: number): string {
  return `          <li class="ssr-card">
            <span class="ssr-step-num" aria-hidden="true">${index + 1}</span>
            <div>
              <h3 class="ssr-card-title">${esc(item.title)}</h3>
              <div class="ssr-card-text">${esc(item.body)}</div>
            </div>
          </li>`;
}

function mediaHtml(media: OverviewMedia): string {
  return `        <figure class="ssr-overview-media">
          <div class="ssr-frame">${pictureHtml({ id: media.imageId as PublicImageId, variant: media.variant, sizes: media.sizes })}</div>
          <figcaption class="ssr-note">${esc(media.caption)}</figcaption>
        </figure>`;
}

function sectionHtml(section: OverviewSection, index: number): string {
  const tone = index % 2 === 0 ? "" : " ssr-section-muted";
  const list =
    section.layout === "steps"
      ? `        <ol class="ssr-steps">\n${section.items.map(stepHtml).join("\n")}\n        </ol>`
      : `        <div class="ssr-grid-${section.items.length === 2 ? "2" : "3"}">\n${section.items.map(itemHtml).join("\n")}\n        </div>`;
  return `
    <section class="ssr-section${tone}" id="${section.id}">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading ssr-left">${esc(section.heading)}</h2>
${section.intro ? `        <p class="ssr-section-subheading ssr-left">${esc(section.intro)}</p>\n` : ""}${section.media ? `        <div class="ssr-overview-split">\n${list}\n${mediaHtml(section.media)}\n        </div>` : list}
${section.footnote ? `        <p class="ssr-section-footnote">${esc(section.footnote)}</p>\n` : ""}      </div>
    </section>`;
}

/**
 * Server-rendered overview page (/payment-processing, /pricing-and-programs). Every word comes from the
 * shared OverviewPage record that the hydrated page also renders; this file only chooses markup.
 */
export function getOverviewPageHtml(page: OverviewPage): string {
  const body = `
    <section class="ssr-hero ssr-hero--light" data-overview-hero>
      <div class="ssr-hero-inner">
        <h1>${esc(page.h1)}</h1>
        <p class="ssr-hero-subtitle">${esc(page.intro)}</p>
      </div>
    </section>
${page.sections.map(sectionHtml).join("\n")}
    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(page.closing.heading)}</h2>
          <p>${esc(page.closing.body)}</p>
          <div class="ssr-cta-buttons">
            <a href="${page.closing.primary.href}" class="ssr-btn-primary">${esc(page.closing.primary.label)}</a>
            <a href="${page.closing.secondary.href}" class="ssr-btn-outline">${esc(page.closing.secondary.label)}</a>
          </div>
        </div>
      </div>
    </section>`;
  return ssrHtmlShell({
    title: page.title,
    description: page.description,
    canonical: page.path,
    keywords: page.keywords,
    schemaJsons: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
          { "@type": "ListItem", position: 2, name: page.breadcrumbLabel, item: `https://libertybancard.com${page.path}` },
        ],
      },
    ],
    body,
  });
}

export function getOverviewPageHtmlByPath(path: string): string | null {
  const page = OVERVIEW_PAGES.find((p) => p.path === path);
  return page ? getOverviewPageHtml(page) : null;
}
