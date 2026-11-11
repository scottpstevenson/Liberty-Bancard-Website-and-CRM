import { PUBLIC_NOT_FOUND } from "../../shared/public-not-found";
import { ssrHtmlShell } from "../ssrShared";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Branded not-found document for unknown dynamic public URLs (an industry, city, city-and-industry or competitor that
 * does not exist). The caller sends it with HTTP 404, so it is never a soft 404 and never a redirect to an unrelated
 * page. It carries the shared header and footer, says what happened, links back to Home, Industries, Areas Served,
 * the analysis and upload pages and contact, and is noindex. It does not hydrate, so the React app does not replace it.
 * The words and links are the same ones the React not-found page uses (shared/public-not-found.ts).
 */
export function getPublicNotFoundHtml(): string {
  const links = PUBLIC_NOT_FOUND.links
    .map((l) => `<li><a href="${escapeHtml(l.href)}" data-testid="link-404-${l.href.replace(/\W+/g, "-")}">${escapeHtml(l.label)}</a></li>`)
    .join("");
  const help = PUBLIC_NOT_FOUND.helpLinks
    .map((l) => `<a href="${escapeHtml(l.href)}" data-testid="link-404-${l.href.replace(/\W+/g, "-")}">${escapeHtml(l.label)}</a>`)
    .join("");
  const body = `
    <section class="ssr-notfound">
      <div class="ssr-section-inner">
        <div class="ssr-notfound-card" data-testid="page-not-found">
          <p class="ssr-notfound-code" data-testid="text-404-code">${PUBLIC_NOT_FOUND.code}</p>
          <h1 data-testid="text-404-title">${escapeHtml(PUBLIC_NOT_FOUND.title)}</h1>
          <p class="ssr-notfound-message" data-testid="text-404-message">${escapeHtml(PUBLIC_NOT_FOUND.message)}</p>
          <div class="ssr-notfound-home"><a class="ssr-btn-dark" href="/" data-testid="link-404-home">${escapeHtml(PUBLIC_NOT_FOUND.homeLabel)}</a></div>
          <p class="ssr-notfound-heading">${escapeHtml(PUBLIC_NOT_FOUND.popularHeading)}</p>
          <ul class="ssr-notfound-links">${links}</ul>
          <div class="ssr-notfound-help">${help}</div>
        </div>
      </div>
    </section>`;
  return ssrHtmlShell({
    title: `${PUBLIC_NOT_FOUND.seoTitle} | Liberty Bancard`,
    description: PUBLIC_NOT_FOUND.seoDescription,
    canonical: "/404",
    ogImage: "https://libertybancard.com/og/default/home.png",
    body,
    hydrate: false,
    robots: "noindex, follow",
  });
}
