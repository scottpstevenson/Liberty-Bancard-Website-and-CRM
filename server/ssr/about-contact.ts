import {
  ABOUT_CONTACT_HERO,
  ABOUT_CONTACT_INQUIRY,
  ABOUT_CONTACT_INTENTS,
  ABOUT_CONTACT_META,
  ABOUT_CONTACT_PATH,
  ABOUT_CONTACT_PROCESS,
  PUBLIC_CONTACT_CHANNELS,
} from "@shared/public-contact-content";
import { ssrHtmlShell } from "../ssrShared";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Server-rendered About & Contact. Same wording as the hydrated page (shared/public-contact-content.ts),
 * a stable #inquiry section that lists the real channels, and no form: the persisted inquiry flow is a
 * separate piece of work that mounts at #inquiry. No hours, response time or address is stated.
 */
export function getAboutContactHtml(): string {
  const { phone, email, booking } = PUBLIC_CONTACT_CHANNELS;
  const body = `
    <section class="ssr-hero ssr-hero--light" data-testid="section-about-hero">
      <div class="ssr-hero-inner">
        <h1>${esc(ABOUT_CONTACT_HERO.heading)}</h1>
        <p class="ssr-hero-subtitle">${esc(ABOUT_CONTACT_HERO.body)}</p>
      </div>
    </section>
    <section class="ssr-section">
      <div class="ssr-section-inner">
        <div class="ssr-grid-3">
${ABOUT_CONTACT_INTENTS.map((intent) => `          <a href="${intent.href}" class="ssr-card ssr-card-link">
            <h2 class="ssr-card-title">${esc(intent.label)}</h2>
            <div class="ssr-card-text">${esc(intent.body)}</div>
          </a>`).join("\n")}
        </div>
      </div>
    </section>
    <section class="ssr-section ssr-section-muted" id="${ABOUT_CONTACT_INQUIRY.id}">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading ssr-left">${esc(ABOUT_CONTACT_INQUIRY.heading)}</h2>
        <p class="ssr-section-subheading ssr-left">${esc(ABOUT_CONTACT_INQUIRY.body)}</p>
        <ul class="ssr-contact-channels">
          <li><a href="${esc(phone.href)}">${esc(phone.label)}</a></li>
          <li><a href="${esc(email.href)}">${esc(email.label)}</a></li>
          <li><a href="${esc(booking.href)}" target="_blank" rel="noopener noreferrer">${esc(booking.label)}</a></li>
        </ul>
      </div>
    </section>
    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading ssr-left">${esc(ABOUT_CONTACT_PROCESS.heading)}</h2>
        <ol class="ssr-steps">
${ABOUT_CONTACT_PROCESS.steps.map((step, i) => `          <li class="ssr-card">
            <span class="ssr-step-num" aria-hidden="true">${i + 1}</span>
            <div>
              <h3 class="ssr-card-title">${esc(step.title)}</h3>
              <div class="ssr-card-text">${esc(step.body)}</div>
            </div>
          </li>`).join("\n")}
        </ol>
      </div>
    </section>`;
  return ssrHtmlShell({
    title: ABOUT_CONTACT_META.title,
    description: ABOUT_CONTACT_META.description,
    canonical: ABOUT_CONTACT_PATH,
    schemaJsons: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
          { "@type": "ListItem", position: 2, name: ABOUT_CONTACT_META.breadcrumbLabel, item: `https://libertybancard.com${ABOUT_CONTACT_PATH}` },
        ],
      },
    ],
    body,
  });
}
