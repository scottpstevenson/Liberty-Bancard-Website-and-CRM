import { INDUSTRIES_HUB, industryHref, PUBLIC_INDUSTRIES } from "@shared/public-industries";
import { ssrHtmlShell } from "../ssrShared";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Server-rendered /industries hub. Lists every existing industry page; navigation copy only. */
export function getIndustriesHubHtml(): string {
  const body = `
    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h1 class="ssr-section-heading" style="text-align:left;">${esc(INDUSTRIES_HUB.heading)}</h1>
        <p class="ssr-section-subheading" style="text-align:left;">${esc(INDUSTRIES_HUB.intro)}</p>
        <div class="ssr-grid-3">
${PUBLIC_INDUSTRIES.map((i) => `          <a href="${industryHref(i.slug)}" class="ssr-card" style="display:block;text-decoration:none;border-top:3px solid #071D57;">
            <h2 class="ssr-card-title">${esc(i.label)}</h2>
            <div class="ssr-card-text">${esc(i.summary)}</div>
          </a>`).join("\n")}
        </div>
      </div>
    </section>
  `;
  return ssrHtmlShell({
    title: `${INDUSTRIES_HUB.title} | Liberty Bancard`,
    description: INDUSTRIES_HUB.description,
    canonical: INDUSTRIES_HUB.path,
    keywords: INDUSTRIES_HUB.keywords,
    schemaJsons: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: `https://libertybancard.com${INDUSTRIES_HUB.path}` },
        ],
      },
    ],
    body,
  });
}
