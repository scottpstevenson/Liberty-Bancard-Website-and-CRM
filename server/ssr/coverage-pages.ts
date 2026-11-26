import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ADAComplianceContent,
  DataRetentionContent,
  DisputeResolutionContent,
  adaComplianceSeo,
  dataRetentionSeo,
  disputeResolutionSeo,
} from "../../client/src/components/PublicPolicyContent";
import {
  getArticleBySlug,
  getArticlesByCategory,
  helpCategories,
  helpCenterHeading,
  helpCenterIntro,
  helpCenterSeo,
  helpDocumentTitle,
} from "../../client/src/lib/help-center-data";
import {
  merchantApplicationIntro,
  merchantApplicationSeo,
  merchantApplicationSteps,
} from "../../shared/merchant-application-content";
import { escapeHtml, ssrHtmlShell } from "../ssrShared";

interface PageMetadata {
  title: string;
  description: string;
  path: string;
  keywords?: string;
}

function renderPage(metadata: PageMetadata, body: string): string {
  return ssrHtmlShell({
    ...metadata,
    title: `${metadata.title} | Liberty Bancard`,
    canonical: metadata.path,
    body,
  });
}

function contentSection(heading: string, intro: string, content: string): string {
  return `
    <article class="ssr-section ssr-gl">
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(intro)}</p>
      ${content}
    </article>`;
}

export function getHelpHtml(categorySlug?: string, articleSlug?: string): string | undefined {
  if (!categorySlug) {
    const links = helpCategories.map(category =>
      `<li><a href="/help/${category.slug}">${escapeHtml(category.name)}</a> — ${escapeHtml(category.description)}</li>`,
    ).join("");
    return renderPage(helpCenterSeo, contentSection(helpCenterHeading, helpCenterIntro, `<ul>${links}</ul>`));
  }

  const category = helpCategories.find(item => item.slug === categorySlug);
  if (!category) return;
  const categoryPath = `/help/${category.slug}`;
  const categoryMeta = {
    title: helpDocumentTitle(category.name),
    description: category.description,
    path: categoryPath,
  };

  if (!articleSlug) {
    const links = getArticlesByCategory(category.slug).map(article =>
      `<li><a href="${categoryPath}/${article.slug}">${escapeHtml(article.title)}</a> — ${escapeHtml(article.summary)}</li>`,
    ).join("");
    return renderPage(categoryMeta, contentSection(category.name, category.description, `
      <p><a href="/help">Help Center</a></p>
      <ul>${links}</ul>`));
  }

  const article = getArticleBySlug(category.slug, articleSlug);
  if (!article) return;
  return renderPage({
    title: helpDocumentTitle(article.title),
    description: article.summary,
    path: `${categoryPath}/${article.slug}`,
    keywords: article.keywords,
  }, contentSection(article.title, article.summary, `
    <p><a href="${categoryPath}">${escapeHtml(category.name)}</a></p>
    ${article.content}`));
}

function policyPage(metadata: PageMetadata, Content: ComponentType) {
  return {
    path: metadata.path,
    render: () => renderPage(metadata, renderToStaticMarkup(createElement(Content))),
  };
}

export const publicPolicyPages = [
  policyPage(adaComplianceSeo, ADAComplianceContent),
  policyPage(dataRetentionSeo, DataRetentionContent),
  policyPage(disputeResolutionSeo, DisputeResolutionContent),
];

export function getMerchantApplicationHtml(): string {
  const steps = merchantApplicationSteps.map(step => `<li>${escapeHtml(step)}</li>`).join("");
  return renderPage(merchantApplicationSeo, contentSection("Merchant Application", merchantApplicationIntro, `
    <ol>${steps}</ol>
    <p><a href="/privacy-policy">Privacy Policy</a> · <a href="/help/getting-started">Merchant account help</a></p>`));
}
