import { ssrHtmlShell } from "../ssrShared";

export interface BlogSection {
  type: "paragraph" | "heading" | "list" | "cta" | "quote";
  text?: string;
  items?: string[];
  ctaText?: string;
  ctaHref?: string;
  level?: 2 | 3;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  readTime: string;
  publishDate: string;
  publishedISO: string;
  modifiedISO: string;
  keywords: string;
  metaDescription: string;
  content: BlogSection[];
  faqs?: { question: string; answer: string }[];
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSection(section: BlogSection): string {
  switch (section.type) {
    case "heading":
      if (section.level === 2) {
        return `<h2 style="font-size:1.625rem;font-weight:700;margin:2.5rem 0 1rem;color:#0f172a;">${escHtml(section.text || "")}</h2>`;
      }
      return `<h3 style="font-size:1.25rem;font-weight:600;margin:2rem 0 0.75rem;color:#1e293b;">${escHtml(section.text || "")}</h3>`;
    case "paragraph":
      return `<p style="margin-bottom:1.25rem;color:#334155;font-size:1.05rem;line-height:1.7;">${escHtml(section.text || "")}</p>`;
    case "list":
      const items = (section.items || []).map(i => `<li style="margin-bottom:0.5rem;color:#334155;line-height:1.7;">${escHtml(i)}</li>`).join("\n");
      return `<ul style="margin:0 0 1.5rem 1.5rem;">${items}</ul>`;
    case "cta":
      return `<div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:12px;padding:2rem;margin:2.5rem 0;text-align:center;"><p style="color:#e2e8f0;margin-bottom:1.25rem;font-size:1rem;">${escHtml(section.text || "")}</p><a href="${escHtml(section.ctaHref || "/get-started")}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:0.875rem 2rem;border-radius:8px;text-decoration:none;font-weight:700;">${escHtml(section.ctaText || "Get Started")}</a></div>`;
    case "quote":
      return `<blockquote style="border-left:4px solid #cbd5e1;padding:0.5rem 0 0.5rem 1.25rem;margin:1.5rem 0;font-style:italic;color:#475569;">${escHtml(section.text || "")}</blockquote>`;
    default:
      return "";
  }
}

function blogConversionCta(): string {
  return `<section class="ssr-section" style="background:#1e3a5f;color:#fff;">
    <div class="ssr-section-inner" style="text-align:center;max-width:48rem;">
      <h2 style="font-family:'Outfit',system-ui,sans-serif;font-size:1.75rem;font-weight:700;margin-bottom:1rem;">Ready to See What You're Really Paying?</h2>
      <p style="color:rgba(255,255,255,0.8);margin-bottom:2rem;">Upload your processing statement for a free, line-by-line breakdown. Keep the analysis even if you don't switch.</p>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;">
        <a href="/upload-statement" class="ssr-btn-primary">Upload Statement →</a>
        <a href="/free-analysis" class="ssr-btn-outline">Get My Free Analysis</a>
      </div>
    </div>
  </section>`;
}

export function renderBlogPostHtml(post: BlogPost): string {
  const contentHtml = post.content.map(renderSection).join("\n");

  const faqsHtml = post.faqs && post.faqs.length > 0
    ? `<section style="margin-top:3rem;padding-top:2rem;border-top:2px solid #e2e8f0;">
<h2 style="font-size:1.625rem;font-weight:700;margin-bottom:1.5rem;color:#0f172a;">Frequently Asked Questions</h2>
${post.faqs.map(faq => `<div style="margin-bottom:1.5rem;padding:1.25rem;background:#f8fafc;border-radius:8px;border-left:4px solid #1e3a5f;"><h3 style="font-size:1.05rem;font-weight:600;color:#0f172a;margin-bottom:0.5rem;">${escHtml(faq.question)}</h3><p style="color:#475569;margin:0;">${escHtml(faq.answer)}</p></div>`).join("\n")}
</section>`
    : "";

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": post.metaDescription,
    "author": { "@type": "Organization", "name": post.author },
    "datePublished": post.publishedISO,
    "dateModified": post.modifiedISO,
    "publisher": {
      "@type": "Organization",
      "name": "Liberty Bancard",
      "url": "https://libertybancard.com",
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://libertybancard.com/blog/${post.slug}`,
    },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://libertybancard.com/blog" },
      { "@type": "ListItem", "position": 3, "name": post.title, "item": `https://libertybancard.com/blog/${post.slug}` },
    ],
  };

  const schemas: object[] = [articleSchema, breadcrumbSchema];
  if (post.faqs && post.faqs.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": post.faqs.map(faq => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": { "@type": "Answer", "text": faq.answer },
      })),
    });
  }

  const body = `
  <div class="ssr-hero" style="padding:4rem 0 3rem;">
    <div class="ssr-hero-inner" style="max-width:48rem;">
      <div class="ssr-breadcrumb">
        <a href="/">Home</a><span>/</span><a href="/blog">Blog</a><span>/</span><span>${escHtml(post.title)}</span>
      </div>
      <div class="ssr-hero-badge">${escHtml(post.category)}</div>
      <h1>${escHtml(post.title)}</h1>
      <p class="ssr-hero-subtitle">${escHtml(post.excerpt)}</p>
      <div style="display:flex;gap:1rem;align-items:center;font-size:0.875rem;color:rgba(255,255,255,0.65);flex-wrap:wrap;margin-top:1rem;">
        <span>By ${escHtml(post.author)}</span>
        <span>•</span>
        <span>${escHtml(post.publishDate)}</span>
        <span>•</span>
        <span>${escHtml(post.readTime)}</span>
      </div>
    </div>
  </div>

  <section class="ssr-section">
    <div class="ssr-section-inner" style="max-width:48rem;">
      <article>
${contentHtml}
${faqsHtml}
      </article>
    </div>
  </section>

  ${blogConversionCta()}`;

  return ssrHtmlShell({
    title: `${post.title} | Liberty Bancard`,
    description: post.metaDescription,
    canonical: `/blog/${post.slug}`,
    keywords: post.keywords,
    ogType: "article",
    schemaJsons: schemas,
    body,
  });
}

export function renderBlogHubHtml(posts: BlogPost[]): string {
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Liberty Bancard Blog",
    "description": "Expert guides on payment processing, merchant services, and reducing credit card fees",
    "numberOfItems": posts.length,
    "itemListElement": posts.slice(0, 20).map((post, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "url": `https://libertybancard.com/blog/${post.slug}`,
      "name": post.title,
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://libertybancard.com/blog" },
    ],
  };

  const postCardsHtml = posts.map(post => `<article style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.75rem;display:flex;flex-direction:column;gap:0.75rem;">
<div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;font-size:0.8rem;color:#64748b;">
  <span style="background:#eff6ff;color:#1e3a5f;padding:0.2rem 0.6rem;border-radius:4px;font-weight:600;font-size:0.75rem;">${escHtml(post.category)}</span>
  <span>${escHtml(post.publishDate)}</span>
  <span>${escHtml(post.readTime)}</span>
</div>
<h2 style="font-size:1.125rem;font-weight:700;line-height:1.3;"><a href="/blog/${post.slug}" style="color:#0f172a;text-decoration:none;">${escHtml(post.title)}</a></h2>
<p style="color:#64748b;font-size:0.9rem;flex:1;">${escHtml(post.excerpt)}</p>
<a href="/blog/${post.slug}" style="color:#1e3a5f;font-weight:600;text-decoration:none;font-size:0.9rem;align-self:flex-start;">Read Article →</a>
</article>`).join("\n");

  const body = `
  <div class="ssr-hero">
    <div class="ssr-hero-inner">
      <div class="ssr-breadcrumb"><a href="/">Home</a><span>/</span><span>Blog</span></div>
      <div class="ssr-hero-badge">📚 Insights & Guides</div>
      <h1>Payment Processing Insights</h1>
      <p class="ssr-hero-subtitle">Expert guides to help you understand your processing costs, avoid hidden fees, and make smarter decisions about merchant services.</p>
    </div>
  </div>

  <section class="ssr-section ssr-section-muted">
    <div class="ssr-section-inner">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.5rem;">
${postCardsHtml}
      </div>
    </div>
  </section>

  ${blogConversionCta()}`;

  return ssrHtmlShell({
    title: "Payment Processing Blog | Liberty Bancard",
    description: "Expert guides on credit card processing fees, interchange rates, chargebacks, and how to reduce your merchant processing costs.",
    canonical: "/blog",
    ogImage: "https://libertybancard.com/og/blog/index.svg",
    schemaJsons: [itemListSchema, breadcrumbSchema],
    body,
  });
}
