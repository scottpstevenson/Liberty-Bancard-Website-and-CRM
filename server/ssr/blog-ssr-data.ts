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

function renderSection(section: BlogSection): string {
  switch (section.type) {
    case "heading":
      if (section.level === 2) {
        return `<h2>${escHtml(section.text || "")}</h2>`;
      }
      return `<h3>${escHtml(section.text || "")}</h3>`;
    case "paragraph":
      return `<p>${escHtml(section.text || "")}</p>`;
    case "list":
      const items = (section.items || []).map(i => `<li>${escHtml(i)}</li>`).join("\n");
      return `<ul>${items}</ul>`;
    case "cta":
      return `<div class="blog-cta"><p>${escHtml(section.text || "")}</p><a href="${escHtml(section.ctaHref || "/get-started")}" class="cta-button">${escHtml(section.ctaText || "Get Started")}</a></div>`;
    case "quote":
      return `<blockquote>${escHtml(section.text || "")}</blockquote>`;
    default:
      return "";
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderBlogPostHtml(post: BlogPost): string {
  const contentHtml = post.content.map(renderSection).join("\n");

  const faqsHtml = post.faqs && post.faqs.length > 0
    ? `<section class="blog-faqs">
<h2>Frequently Asked Questions</h2>
${post.faqs.map(faq => `<div class="faq-item"><h3>${escHtml(faq.question)}</h3><p>${escHtml(faq.answer)}</p></div>`).join("\n")}
</section>`
    : "";

  const articleSchema = JSON.stringify({
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
      "url": "https://libertybancard.com"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://libertybancard.com/blog/${post.slug}`
    }
  });

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://libertybancard.com/blog" },
      { "@type": "ListItem", "position": 3, "name": post.title, "item": `https://libertybancard.com/blog/${post.slug}` }
    ]
  });

  const faqSchema = post.faqs && post.faqs.length > 0
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": post.faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": { "@type": "Answer", "text": faq.answer }
        }))
      })}</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(post.title)} | Liberty Bancard</title>
<meta name="description" content="${escHtml(post.metaDescription)}">
<meta name="keywords" content="${escHtml(post.keywords)}">
<meta property="og:title" content="${escHtml(post.title)} | Liberty Bancard">
<meta property="og:description" content="${escHtml(post.metaDescription)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://libertybancard.com/blog/${post.slug}">
<meta property="article:published_time" content="${post.publishedISO}">
<meta property="article:modified_time" content="${post.modifiedISO}">
<link rel="canonical" href="https://libertybancard.com/blog/${post.slug}">
<script type="application/ld+json">${articleSchema}</script>
<script type="application/ld+json">${breadcrumbSchema}</script>
${faqSchema}
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.7; }
.site-header { background: #0f172a; padding: 1rem 2rem; }
.site-header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 1.25rem; }
nav.breadcrumb { padding: 1rem 2rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem; color: #64748b; }
nav.breadcrumb a { color: #3b82f6; text-decoration: none; }
nav.breadcrumb span { margin: 0 0.5rem; }
.blog-header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); color: #fff; padding: 4rem 2rem 3rem; }
.blog-header-inner { max-width: 860px; margin: 0 auto; }
.blog-meta { display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem; font-size: 0.875rem; color: #94a3b8; flex-wrap: wrap; }
.blog-category { background: #3b82f6; color: #fff; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.blog-header h1 { font-size: clamp(1.75rem, 4vw, 2.75rem); font-weight: 800; line-height: 1.2; margin-bottom: 1.25rem; }
.blog-excerpt { font-size: 1.125rem; color: #cbd5e1; line-height: 1.6; }
.blog-body { max-width: 860px; margin: 0 auto; padding: 3rem 2rem; }
.blog-body h2 { font-size: 1.625rem; font-weight: 700; margin: 2.5rem 0 1rem; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
.blog-body h3 { font-size: 1.25rem; font-weight: 600; margin: 2rem 0 0.75rem; color: #1e293b; }
.blog-body p { margin-bottom: 1.25rem; color: #334155; font-size: 1.05rem; }
.blog-body ul { margin: 0 0 1.5rem 1.5rem; }
.blog-body ul li { margin-bottom: 0.5rem; color: #334155; }
.blog-cta { background: linear-gradient(135deg, #0f172a, #1e3a5f); border-radius: 12px; padding: 2rem; margin: 2.5rem 0; text-align: center; }
.blog-cta p { color: #e2e8f0; margin-bottom: 1.25rem; font-size: 1rem; }
.cta-button { display: inline-block; background: #3b82f6; color: #fff; padding: 0.875rem 2rem; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; transition: background 0.2s; }
.cta-button:hover { background: #2563eb; }
.blog-faqs { margin-top: 3rem; padding-top: 2rem; border-top: 2px solid #e2e8f0; }
.blog-faqs h2 { font-size: 1.625rem; font-weight: 700; margin-bottom: 1.5rem; color: #0f172a; }
.faq-item { margin-bottom: 1.5rem; padding: 1.25rem; background: #f8fafc; border-radius: 8px; border-left: 4px solid #3b82f6; }
.faq-item h3 { font-size: 1.05rem; font-weight: 600; color: #0f172a; margin-bottom: 0.5rem; }
.faq-item p { color: #475569; margin: 0; }
.site-footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 2rem; margin-top: 4rem; font-size: 0.875rem; }
.site-footer a { color: #60a5fa; text-decoration: none; }
@media (max-width: 640px) { .blog-header, .blog-body, nav.breadcrumb { padding-left: 1rem; padding-right: 1rem; } }
</style>
</head>
<body>
<header class="site-header">
<a href="/">Liberty Bancard</a>
</header>
<nav class="breadcrumb">
<a href="/">Home</a><span>›</span><a href="/blog">Blog</a><span>›</span>${escHtml(post.title)}
</nav>
<header class="blog-header">
<div class="blog-header-inner">
<div class="blog-meta">
<span class="blog-category">${escHtml(post.category)}</span>
<span>${escHtml(post.publishDate)}</span>
<span>${escHtml(post.readTime)}</span>
<span>By ${escHtml(post.author)}</span>
</div>
<h1>${escHtml(post.title)}</h1>
<p class="blog-excerpt">${escHtml(post.excerpt)}</p>
</div>
</header>
<main>
<article class="blog-body">
${contentHtml}
${faqsHtml}
</article>
</main>
<footer class="site-footer">
<p>&copy; 2025 Liberty Bancard. All rights reserved. | <a href="/privacy-policy">Privacy Policy</a> | <a href="/terms">Terms</a></p>
</footer>
</body>
</html>`;
}

export function renderBlogHubHtml(posts: BlogPost[]): string {
  const itemListSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Liberty Bancard Blog",
    "description": "Expert guides on payment processing, merchant services, and reducing credit card fees",
    "numberOfItems": posts.length,
    "itemListElement": posts.slice(0, 20).map((post, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "url": `https://libertybancard.com/blog/${post.slug}`,
      "name": post.title
    }))
  });

  const webPageSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Blog | Liberty Bancard",
    "description": "Expert guides on payment processing, merchant services, and reducing credit card fees for businesses.",
    "url": "https://libertybancard.com/blog"
  });

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://libertybancard.com" },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://libertybancard.com/blog" }
    ]
  });

  const postCardsHtml = posts.map(post => `<article class="post-card">
<div class="post-meta"><span class="post-category">${escHtml(post.category)}</span><span class="post-date">${escHtml(post.publishDate)}</span><span class="post-read">${escHtml(post.readTime)}</span></div>
<h2><a href="/blog/${post.slug}">${escHtml(post.title)}</a></h2>
<p class="post-excerpt">${escHtml(post.excerpt)}</p>
<a href="/blog/${post.slug}" class="read-more">Read Article →</a>
</article>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Payment Processing Blog | Liberty Bancard</title>
<meta name="description" content="Expert guides on credit card processing fees, interchange rates, chargebacks, and how to reduce your merchant processing costs.">
<meta property="og:title" content="Payment Processing Blog | Liberty Bancard">
<meta property="og:description" content="Expert guides on credit card processing fees, interchange rates, chargebacks, and how to reduce your merchant processing costs.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://libertybancard.com/blog">
<link rel="canonical" href="https://libertybancard.com/blog">
<script type="application/ld+json">${itemListSchema}</script>
<script type="application/ld+json">${webPageSchema}</script>
<script type="application/ld+json">${breadcrumbSchema}</script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.6; }
.site-header { background: #0f172a; padding: 1rem 2rem; }
.site-header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 1.25rem; }
.blog-hub-header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); color: #fff; padding: 4rem 2rem 3rem; text-align: center; }
.blog-hub-header h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; margin-bottom: 1rem; }
.blog-hub-header p { font-size: 1.125rem; color: #cbd5e1; max-width: 600px; margin: 0 auto; }
.blog-grid { max-width: 1100px; margin: 3rem auto; padding: 0 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 2rem; }
.post-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.75rem; display: flex; flex-direction: column; gap: 0.75rem; transition: box-shadow 0.2s; }
.post-card:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
.post-meta { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: #64748b; }
.post-category { background: #eff6ff; color: #2563eb; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
.post-card h2 { font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
.post-card h2 a { color: #0f172a; text-decoration: none; }
.post-card h2 a:hover { color: #3b82f6; }
.post-excerpt { color: #64748b; font-size: 0.9rem; flex: 1; }
.read-more { color: #3b82f6; font-weight: 600; text-decoration: none; font-size: 0.9rem; align-self: flex-start; }
.read-more:hover { text-decoration: underline; }
.site-footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 2rem; margin-top: 4rem; font-size: 0.875rem; }
.site-footer a { color: #60a5fa; text-decoration: none; }
@media (max-width: 640px) { .blog-grid { grid-template-columns: 1fr; padding: 0 1rem; } }
</style>
</head>
<body>
<header class="site-header">
<a href="/">Liberty Bancard</a>
</header>
<header class="blog-hub-header">
<h1>Payment Processing Blog</h1>
<p>Expert guides on reducing processing fees, understanding interchange, fighting chargebacks, and growing your business.</p>
</header>
<main>
<div class="blog-grid">
${postCardsHtml}
</div>
</main>
<footer class="site-footer">
<p>&copy; 2025 Liberty Bancard. All rights reserved. | <a href="/privacy-policy">Privacy Policy</a> | <a href="/terms">Terms</a></p>
</footer>
</body>
</html>`;
}
