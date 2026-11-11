import type { Express } from "express";
import {
  glossaryTerms,
  glossaryCategories,
  getTermBySlug,
  getRelatedTerms,
  type GlossaryTerm,
} from "../data/glossary-terms";
import { claimText } from "../../shared/public-claims";
import { ssrHtmlShell } from "../ssrShared";

const BASE_URL = "https://libertybancard.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Glossary definitions are plain strings that use a small, fixed set of conventions: blank-line paragraph
 * breaks, `**bold**`, `- ` bullets, `1. ` numbered items and indented sub-items. This renders them as
 * paragraphs, bold text and lists. Every source character is HTML-escaped first; the only markup added is
 * the paragraph and list structure and `<strong>` around a closed `**` pair, so a definition cannot inject
 * HTML and the standalone document needs no client script.
 */
interface GlossaryListLine {
  indent: number;
  ordered: boolean;
  number: number;
  text: string;
}

type GlossaryBlock = { kind: "text"; lines: string[] } | { kind: "list"; lines: GlossaryListLine[] };

const GLOSSARY_LIST_LINE = /^(\s*)(?:(-)|(\d+)\.)\s+(\S.*)$/;

function renderGlossaryInline(text: string): string {
  return escapeHtml(text.trim()).replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
}

function parseGlossaryBlocks(text: string): GlossaryBlock[] {
  const blocks: GlossaryBlock[] = [];
  for (const paragraph of text.split("\n\n")) {
    let textRun: string[] | undefined;
    let listRun: GlossaryListLine[] | undefined;
    for (const rawLine of paragraph.split("\n")) {
      if (rawLine.trim() === "") continue;
      const match = GLOSSARY_LIST_LINE.exec(rawLine);
      if (!match) {
        listRun = undefined;
        if (!textRun) {
          textRun = [];
          blocks.push({ kind: "text", lines: textRun });
        }
        textRun.push(rawLine);
        continue;
      }
      const item: GlossaryListLine = {
        indent: match[1].length,
        ordered: match[3] !== undefined,
        number: match[3] !== undefined ? Number(match[3]) : 0,
        text: match[4],
      };
      textRun = undefined;
      if (!listRun) {
        // A numbered step written as its own paragraph continues the list that the previous paragraph ended.
        const previous = blocks[blocks.length - 1];
        const last = previous?.kind === "list" ? previous.lines[previous.lines.length - 1] : undefined;
        if (previous?.kind === "list" && last && last.ordered && item.ordered && last.indent === item.indent && item.number === last.number + 1) {
          listRun = previous.lines;
        } else {
          listRun = [];
          blocks.push({ kind: "list", lines: listRun });
        }
      }
      listRun.push(item);
    }
  }
  return blocks;
}

function renderGlossaryList(lines: GlossaryListLine[]): string {
  let pos = 0;
  const build = (indent: number): string => {
    const first = lines[pos];
    const tag = first.ordered ? "ol" : "ul";
    const start = first.ordered && first.number !== 1 ? ` start="${first.number}"` : "";
    let html = `<${tag}${start}>`;
    while (pos < lines.length && lines[pos].indent >= indent && lines[pos].ordered === first.ordered) {
      const line = lines[pos++];
      html += `<li>${renderGlossaryInline(line.text)}`;
      while (pos < lines.length && lines[pos].indent > indent) html += build(lines[pos].indent);
      html += "</li>";
    }
    return `${html}</${tag}>`;
  };
  let html = "";
  while (pos < lines.length) html += build(lines[pos].indent);
  return html;
}

export function renderGlossaryText(text: string): string {
  return parseGlossaryBlocks(text)
    .map((block) => (block.kind === "list" ? renderGlossaryList(block.lines) : `<p>${block.lines.map(renderGlossaryInline).join("<br>")}</p>`))
    .join("");
}

export function buildTermPageHtml(term: GlossaryTerm, relatedTerms: GlossaryTerm[]): string {
  const title = `What Is ${term.name}? A Merchant's Guide | Liberty Bancard`;
  const description = term.shortDefinition;
  const canonicalUrl = `${BASE_URL}/learn/${term.slug}`;

  const definedTermSchema = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    "@id": canonicalUrl,
    name: term.name,
    description: term.shortDefinition,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      "@id": `${BASE_URL}/learn`,
      name: "Payment Processing Glossary",
      description: "Payment Processing Terms Every Merchant Should Know — by Liberty Bancard",
    },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: term.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Learning Center", item: `${BASE_URL}/learn` },
      { "@type": "ListItem", position: 3, name: term.name, item: canonicalUrl },
    ],
  };

  const webPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonicalUrl,
    datePublished: "2025-01-01",
    dateModified: new Date().toISOString().split("T")[0],
    breadcrumb: breadcrumbSchema,
    isPartOf: {
      "@type": "WebSite",
      name: "Liberty Bancard",
      url: BASE_URL,
    },
  };

  const body = `
    <nav class="ssr-gl-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/learn">Learning Center</a> &rsaquo; ${escapeHtml(term.name)}</nav>
    <article class="ssr-gl">
      <span class="ssr-gl-badge">${escapeHtml(term.category)}</span>
      <h1>What Is ${escapeHtml(term.name)}? A Merchant's Guide</h1>
      <p class="ssr-gl-shortdef">${escapeHtml(term.shortDefinition)}</p>

      <h2>The Complete Definition</h2>
      ${renderGlossaryText(term.fullDefinition)}

      <h2>How ${escapeHtml(term.name)} Affects Your Processing Costs</h2>
      ${renderGlossaryText(term.merchantImpact)}

      <h2>${escapeHtml(term.name)} Example</h2>
      <div class="ssr-gl-example"><pre>${escapeHtml(term.example)}</pre></div>

      <h2>Common Questions About ${escapeHtml(term.name)}</h2>
      ${term.faqs
        .map((faq) => `<div class="ssr-gl-faq"><h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p></div>`)
        .join("")}

      <h2>Related Terms</h2>
      <div class="ssr-gl-chips">${relatedTerms.map((rt) => `<a href="/learn/${escapeHtml(rt.slug)}" class="ssr-gl-chip">${escapeHtml(rt.name)}</a>`).join("")}</div>

      <section class="ssr-gl-cta">
        <h2>Reviewing ${escapeHtml(term.name)} With Liberty Bancard</h2>
        ${renderGlossaryText(term.libertySection)}
        <div class="ssr-gl-cta-links">${term.commercialLinks.map((cl) => `<a href="${escapeHtml(cl.href)}">${escapeHtml(cl.label)}</a>`).join("")}</div>
      </section>

      <div class="ssr-gl-note">
        <p>
          <strong>Continue learning:</strong> Browse all ${glossaryTerms.length} payment processing terms in the
          <a href="/learn">Payment Processing Glossary</a>, or
          <a href="/upload-statement">upload your statement</a> for a review of your processing costs.
        </p>
      </div>
    </article>`;

  return ssrHtmlShell({
    title,
    description,
    canonical: `/learn/${term.slug}`,
    ogType: "article",
    schemaJsons: [definedTermSchema, faqSchema, breadcrumbSchema, webPageSchema],
    body,
    hydrate: false,
  });
}

function buildHubPageHtml(): string {
  const title = "Payment Processing Glossary: Terms Merchants Need | Liberty Bancard";
  const description = `Payment processing glossary with ${glossaryTerms.length} key terms. Learn what interchange fees, chargebacks, merchant accounts and PCI compliance mean for your business.`;
  const canonicalUrl = `${BASE_URL}/learn`;

  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Payment Processing Glossary",
    description,
    numberOfItems: glossaryTerms.length,
    itemListElement: glossaryTerms.map((term, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "DefinedTerm",
        name: term.name,
        url: `${BASE_URL}/learn/${term.slug}`,
        description: term.shortDefinition,
      },
    })),
  };

  const definedTermSetSchema = {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": canonicalUrl,
    name: "Payment Processing Glossary",
    description,
    url: canonicalUrl,
  };

  const categoriesHtml = glossaryCategories
    .map((cat) => {
      const catTerms = glossaryTerms.filter((t) => t.category === cat);
      const termsHtml = catTerms
        .map(
          (t) => `<a href="/learn/${escapeHtml(t.slug)}" class="ssr-gl-term"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.shortDefinition)}</span></a>`
        )
        .join("");
      return `<section class="ssr-gl-category"><h2>${escapeHtml(cat)}</h2>${termsHtml}</section>`;
    })
    .join("");

  const body = `
    <section class="ssr-hero ssr-hero--light">
      <div class="ssr-hero-inner">
        <h1>Payment Processing Glossary</h1>
        <p class="ssr-hero-subtitle">Understanding your processing statement starts with the terminology. Browse ${glossaryTerms.length} payment processing terms, explained in plain English for merchants.</p>
        <div class="ssr-hero-buttons">
          <a href="/upload-statement" class="ssr-btn-dark">Review my statement</a>
        </div>
        <p class="ssr-hero-note">${escapeHtml(claimText("review.cost.free", "page"))}</p>
      </div>
    </section>
    <div class="ssr-gl">
      <p class="ssr-gl-count">${glossaryTerms.length} terms in ${glossaryCategories.length} categories.</p>
      <p class="ssr-gl-lead">Payment processing fees, terminology and pricing models can be hard to follow. This glossary explains the major terms in plain language so you can read your statement, compare options and ask better questions.</p>
      ${categoriesHtml}
      <section class="ssr-gl-cta">
        <h2>Ready to apply this knowledge?</h2>
        <p>${escapeHtml(claimText("review.taxonomy.summary", "page"))}</p>
        <div class="ssr-gl-cta-links">
          <a href="/upload-statement">Review my statement</a>
          <a href="/pricing-and-programs">Pricing &amp; programs</a>
        </div>
      </section>
    </div>`;

  return ssrHtmlShell({
    title,
    description,
    canonical: "/learn",
    schemaJsons: [itemListSchema, definedTermSetSchema],
    body,
    hydrate: false,
  });
}

function buildSitemapXml(): string {
  const today = new Date().toISOString().split("T")[0];
  const urls = [
    `  <url>
    <loc>${BASE_URL}/learn</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    ...glossaryTerms.map(
      (term) => `  <url>
    <loc>${BASE_URL}/learn/${term.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
}

export function registerGlossaryRoutes(app: Express) {
  app.get("/learn", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.send(buildHubPageHtml());
  });

  app.get("/learn/:slug", (req, res) => {
    const { slug } = req.params;
    const term = getTermBySlug(slug);

    if (!term) {
      res.status(404).redirect("/learn");
      return;
    }

    const relatedTerms = getRelatedTerms(slug);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.send(buildTermPageHtml(term, relatedTerms));
  });

  app.get("/sitemap-glossary.xml", (_req, res) => {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buildSitemapXml());
  });
}
