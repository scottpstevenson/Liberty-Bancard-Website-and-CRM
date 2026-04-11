import type { Express } from "express";
import {
  glossaryTerms,
  glossaryCategories,
  getTermBySlug,
  getRelatedTerms,
  type GlossaryTerm,
} from "../data/glossary-terms";

const BASE_URL = "https://libertybancard.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTermPageHtml(term: GlossaryTerm, relatedTerms: GlossaryTerm[]): string {
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

  const relatedLinksHtml = relatedTerms
    .map(
      (rt) =>
        `<a href="/learn/${escapeHtml(rt.slug)}" style="display:inline-block;margin:4px 8px 4px 0;padding:6px 14px;background:#f1f5f9;border-radius:20px;color:#1e40af;text-decoration:none;font-size:14px;">${escapeHtml(rt.name)}</a>`
    )
    .join("");

  const commercialLinksHtml = term.commercialLinks
    .map(
      (cl) =>
        `<a href="${escapeHtml(cl.href)}" style="display:inline-block;margin:8px 8px 0 0;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;">${escapeHtml(cl.label)}</a>`
    )
    .join("");

  const faqsHtml = term.faqs
    .map(
      (faq) => `
      <div style="border-bottom:1px solid #e2e8f0;padding:20px 0;">
        <h3 style="font-size:17px;font-weight:600;color:#1e293b;margin:0 0 8px;">${escapeHtml(faq.question)}</h3>
        <p style="color:#475569;line-height:1.7;margin:0;">${escapeHtml(faq.answer)}</p>
      </div>`
    )
    .join("");

  const fullDefinitionHtml = term.fullDefinition
    .split("\n\n")
    .map((para) => `<p style="color:#334155;line-height:1.8;margin-bottom:16px;">${escapeHtml(para.trim())}</p>`)
    .join("");

  const merchantImpactHtml = term.merchantImpact
    .split("\n\n")
    .map((para) => `<p style="color:#334155;line-height:1.8;margin-bottom:16px;">${escapeHtml(para.trim())}</p>`)
    .join("");

  const libertySectionHtml = term.libertySection
    .split("\n\n")
    .map((para) => `<p style="color:#334155;line-height:1.8;margin-bottom:16px;">${escapeHtml(para.trim())}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:type" content="article" />
  <meta name="robots" content="index, follow" />
  <script type="application/ld+json">${JSON.stringify(definedTermSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(webPageSchema)}</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #fff; color: #1e293b; }
    a { color: #1e40af; }
    .nav { background: #1e3a5f; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
    .nav a { color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; }
    .nav-links { display: flex; gap: 20px; }
    .nav-links a { color: rgba(255,255,255,0.85); font-weight: 400; font-size: 14px; }
    .breadcrumb { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 10px 24px; font-size: 13px; color: #64748b; }
    .breadcrumb a { color: #1e40af; text-decoration: none; }
    .container { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
    .category-badge { display: inline-block; background: #eff6ff; color: #1e40af; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; margin-bottom: 16px; }
    h1 { font-size: clamp(26px, 4vw, 36px); font-weight: 800; color: #0f172a; line-height: 1.25; margin: 0 0 16px; }
    .short-def { font-size: 18px; color: #475569; line-height: 1.6; background: #f8fafc; border-left: 4px solid #1e40af; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 40px; }
    h2 { font-size: 22px; font-weight: 700; color: #0f172a; margin: 40px 0 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .example-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 16px 0 32px; }
    .example-box pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; color: #166534; margin: 0; line-height: 1.7; }
    .cta-section { background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%); color: #fff; border-radius: 12px; padding: 32px; margin: 48px 0; }
    .cta-section h2 { color: #fff; border-color: rgba(255,255,255,0.2); }
    .cta-section p { color: rgba(255,255,255,0.9); line-height: 1.7; margin-bottom: 16px; }
    .cta-link { display: inline-block; background: #fff; color: #1e3a5f; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 8px 8px 0 0; }
    .footer { background: #0f172a; color: rgba(255,255,255,0.6); padding: 32px 24px; font-size: 13px; }
    .footer a { color: rgba(255,255,255,0.7); text-decoration: none; }
    .footer-inner { max-width: 860px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">Liberty Bancard</a>
    <div class="nav-links">
      <a href="/learn">Learning Center</a>
      <a href="/compare-rates">Compare Rates</a>
      <a href="/upload-statement">Free Analysis</a>
      <a href="/get-started">Get Started</a>
    </div>
  </nav>

  <div class="breadcrumb">
    <a href="/">Home</a> &rsaquo; <a href="/learn">Learning Center</a> &rsaquo; ${escapeHtml(term.name)}
  </div>

  <div class="container">
    <span class="category-badge">${escapeHtml(term.category)}</span>
    <h1>What Is ${escapeHtml(term.name)}? A Merchant's Guide</h1>
    <div class="short-def">${escapeHtml(term.shortDefinition)}</div>

    <h2>The Complete Definition</h2>
    ${fullDefinitionHtml}

    <h2>How ${escapeHtml(term.name)} Affects Your Processing Costs</h2>
    ${merchantImpactHtml}

    <h2>${escapeHtml(term.name)} Example</h2>
    <div class="example-box">
      <pre>${escapeHtml(term.example)}</pre>
    </div>

    <h2>Common Questions About ${escapeHtml(term.name)}</h2>
    ${faqsHtml}

    <h2>Related Terms</h2>
    <div style="margin-bottom:40px;">${relatedLinksHtml}</div>

    <div class="cta-section">
      <h2>How Liberty Bancard Handles ${escapeHtml(term.name)}</h2>
      ${libertySectionHtml}
      <div>${term.commercialLinks.map((cl) => `<a href="${escapeHtml(cl.href)}" class="cta-link">${escapeHtml(cl.label)}</a>`).join("")}</div>
    </div>

    <div style="margin-top:40px;padding:24px;background:#f8fafc;border-radius:8px;">
      <p style="font-size:14px;color:#64748b;margin:0;">
        <strong>Continue learning:</strong> Browse all 60 payment processing terms in our
        <a href="/learn">Payment Processing Glossary</a>, or
        <a href="/upload-statement">upload your statement</a> for a free analysis of your current processing costs.
      </p>
    </div>
  </div>

  <footer class="footer">
    <div class="footer-inner">
      <span>&copy; ${new Date().getFullYear()} Liberty Bancard &bull; Registered ISO/MSP with Visa &amp; Mastercard</span>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <a href="/learn">Learning Center</a>
        <a href="/privacy-policy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/security-compliance">Security</a>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

function buildHubPageHtml(): string {
  const title = "Payment Processing Glossary — Terms Every Merchant Should Know | Liberty Bancard";
  const description = "Comprehensive payment processing glossary with 60 key terms. Learn what interchange fees, chargebacks, merchant accounts, and PCI compliance mean for your business.";
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
          (t) => `
          <a href="/learn/${escapeHtml(t.slug)}" style="display:block;padding:12px 0;border-bottom:1px solid #f1f5f9;text-decoration:none;color:inherit;">
            <div style="font-weight:600;color:#1e293b;font-size:15px;">${escapeHtml(t.name)}</div>
            <div style="font-size:13px;color:#64748b;margin-top:3px;">${escapeHtml(t.shortDefinition)}</div>
          </a>`
        )
        .join("");

      return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;margin-bottom:24px;">
          <h2 style="font-size:19px;font-weight:700;color:#0f172a;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">${escapeHtml(cat)}</h2>
          ${termsHtml}
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:type" content="website" />
  <meta name="robots" content="index, follow" />
  <script type="application/ld+json">${JSON.stringify(itemListSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(definedTermSetSchema)}</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
    a { color: #1e40af; }
    .nav { background: #1e3a5f; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
    .nav a { color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; }
    .nav-links { display: flex; gap: 20px; }
    .nav-links a { color: rgba(255,255,255,0.85); font-weight: 400; font-size: 14px; }
    .hero { background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%); color: #fff; padding: 48px 24px 40px; text-align: center; }
    .hero h1 { font-size: clamp(22px, 4vw, 36px); font-weight: 800; margin: 0 0 12px; }
    .hero p { font-size: 17px; color: rgba(255,255,255,0.85); max-width: 640px; margin: 0 auto 24px; line-height: 1.6; }
    .hero-cta { display: inline-block; background: #fff; color: #1e3a5f; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; }
    .stats { display: flex; justify-content: center; gap: 32px; flex-wrap: wrap; padding: 24px; background: #fff; border-bottom: 1px solid #e2e8f0; }
    .stat { text-align: center; }
    .stat-num { font-size: 28px; font-weight: 800; color: #1e40af; }
    .stat-label { font-size: 13px; color: #64748b; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
    .footer { background: #0f172a; color: rgba(255,255,255,0.6); padding: 32px 24px; font-size: 13px; }
    .footer a { color: rgba(255,255,255,0.7); text-decoration: none; }
    .footer-inner { max-width: 900px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">Liberty Bancard</a>
    <div class="nav-links">
      <a href="/learn">Learning Center</a>
      <a href="/compare-rates">Compare Rates</a>
      <a href="/upload-statement">Free Analysis</a>
      <a href="/get-started">Get Started</a>
    </div>
  </nav>

  <div class="hero">
    <h1>Payment Processing Glossary</h1>
    <p>Understanding your processing statement starts with knowing the terminology. Browse 60 essential payment processing terms, explained in plain English for merchants.</p>
    <a href="/upload-statement" class="hero-cta">Get a Free Statement Analysis</a>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-num">60</div><div class="stat-label">Terms Defined</div></div>
    <div class="stat"><div class="stat-num">7</div><div class="stat-label">Categories</div></div>
    <div class="stat"><div class="stat-num">8,000+</div><div class="stat-label">Monthly Searches</div></div>
    <div class="stat"><div class="stat-num">Free</div><div class="stat-label">Statement Analysis</div></div>
  </div>

  <div class="container">
    <p style="color:#475569;line-height:1.7;margin-bottom:32px;font-size:16px;">
      Payment processing fees, terminology, and pricing models are intentionally complex. Processors profit from confusion. This glossary explains every major payment processing term in plain language — so you can understand your statement, compare processors intelligently, and negotiate from a position of knowledge.
    </p>

    ${categoriesHtml}

    <div style="margin-top:48px;background:linear-gradient(135deg,#1e3a5f,#1e40af);border-radius:12px;padding:32px;color:#fff;text-align:center;">
      <h2 style="color:#fff;font-size:22px;margin:0 0 12px;">Ready to Apply This Knowledge?</h2>
      <p style="color:rgba(255,255,255,0.9);margin:0 0 20px;font-size:16px;">Upload your processing statement and we'll break down every fee, show you what each term means for your costs, and tell you exactly what you'd save by switching to Liberty Bancard.</p>
      <a href="/upload-statement" style="display:inline-block;background:#fff;color:#1e3a5f;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-right:12px;">Upload Statement — It's Free</a>
      <a href="/compare-rates" style="display:inline-block;background:transparent;color:#fff;border:2px solid rgba(255,255,255,0.5);padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Compare Rates</a>
    </div>
  </div>

  <footer class="footer">
    <div class="footer-inner">
      <span>&copy; ${new Date().getFullYear()} Liberty Bancard &bull; Registered ISO/MSP with Visa &amp; Mastercard</span>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <a href="/learn">Learning Center</a>
        <a href="/privacy-policy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/security-compliance">Security</a>
      </div>
    </div>
  </footer>
</body>
</html>`;
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
