import { getCityData, getVerticalData, CITIES, VERTICALS } from "./location-data";

export function getLocationHtml(citySlug: string, verticalSlug: string): string | null {
  const city = getCityData(citySlug);
  const vertical = getVerticalData(verticalSlug);

  if (!city || !vertical) return null;

  const baseUrl = "https://libertybancard.com";
  const pageUrl = `${baseUrl}/locations/${city.slug}/${vertical.slug}`;
  const vName = vertical.name.replace(/\s*&\s*/g, " and ");
  const title = `${vName} Payment Processing in ${city.name}, ${city.state}`;
  const description = `${city.name} ${vName.toLowerCase()} businesses: reduce processing fees with Liberty Bancard interchange-plus pricing. Free statement review, no obligation.`;

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description,
    url: pageUrl,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: {
        "@type": "State",
        name: city.stateFullName,
      },
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: vertical.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${baseUrl}/` },
      { "@type": "ListItem", position: 2, name: `${vertical.name} Processing`, item: `${baseUrl}/industries/${vertical.industryPageSlug}` },
      { "@type": "ListItem", position: 3, name: `${city.name}, ${city.state}`, item: pageUrl },
    ],
  };

  const relatedCities = CITIES.filter((c) => c.slug !== city.slug).slice(0, 8);
  const relatedVerticals = VERTICALS.filter((v) => v.slug !== vertical.slug).slice(0, 5);

  const painPointsHtml = vertical.painPoints
    .map((p) => `<li style="margin-bottom:8px;padding-left:8px;">${escHtml(p)}</li>`)
    .join("");

  const solutionsHtml = vertical.solutions
    .map((s) => `<li style="margin-bottom:8px;padding-left:8px;">${escHtml(s)}</li>`)
    .join("");

  const faqsHtml = vertical.faqs
    .map(
      (faq, i) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:12px;">
      <h3 style="font-size:16px;font-weight:600;color:#1e293b;margin:0 0 10px;">${escHtml(faq.q)}</h3>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0;">${escHtml(faq.a)}</p>
    </div>`
    )
    .join("");

  const relatedCitiesHtml = relatedCities
    .map(
      (c) =>
        `<a href="/locations/${c.slug}/${vertical.slug}" style="display:inline-block;padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;color:#334155;text-decoration:none;margin:4px;">
          ${escHtml(c.name)}, ${escHtml(c.state)}
        </a>`
    )
    .join("");

  const relatedVerticalsHtml = relatedVerticals
    .map(
      (v) =>
        `<a href="/locations/${city.slug}/${v.slug}" style="display:inline-block;padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;color:#334155;text-decoration:none;margin:4px;">
          ${escHtml(v.name)} Processing in ${escHtml(city.name)}
        </a>`
    )
    .join("");

  const openingParagraph = `${city.name} has ${city.businessCount} businesses. If you run a ${vertical.name.toLowerCase()} in ${city.name}, here's what you're likely paying to process cards — and what you could be paying instead.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}" />
  <meta name="keywords" content="${escHtml(vertical.name.toLowerCase())} payment processing ${escHtml(city.name)}, ${escHtml(city.name)} ${escHtml(vertical.name.toLowerCase())} credit card processing, merchant services ${escHtml(city.name)} ${escHtml(city.state)}" />
  <link rel="canonical" href="${escHtml(pageUrl)}" />
  <meta property="og:title" content="${escHtml(title)}" />
  <meta property="og:description" content="${escHtml(description)}" />
  <meta property="og:url" content="${escHtml(pageUrl)}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escHtml(title)}" />
  <meta name="twitter:description" content="${escHtml(description)}" />
  <script type="application/ld+json">${JSON.stringify(localBusinessSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#fff;line-height:1.6}
    a{color:inherit}
    .container{max-width:1100px;margin:0 auto;padding:0 24px}
    nav{background:#0f172a;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
    nav a{color:#fff;text-decoration:none;font-weight:600;font-size:18px}
    nav .nav-links{display:flex;gap:24px}
    nav .nav-links a{font-size:14px;font-weight:400;color:rgba(255,255,255,.8)}
    .hero{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:80px 24px 60px;color:#fff}
    .hero-badge{font-size:13px;color:#38bdf8;font-weight:600;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em}
    .hero h1{font-size:clamp(28px,4vw,44px);font-weight:800;line-height:1.2;margin-bottom:16px;max-width:700px}
    .hero p{font-size:17px;color:rgba(255,255,255,.75);max-width:620px;margin-bottom:32px;line-height:1.7}
    .btn{display:inline-block;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer;border:none}
    .btn-primary{background:#0ea5e9;color:#fff}
    .btn-outline{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25);margin-left:12px}
    .breadcrumb{background:#f1f5f9;padding:12px 24px;font-size:13px;color:#64748b}
    .breadcrumb a{color:#0ea5e9;text-decoration:none}
    .breadcrumb span{margin:0 6px}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;padding:48px 24px;background:#f8fafc}
    .stat-card{background:#fff;border-radius:10px;padding:24px;text-align:center;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .stat-value{font-size:32px;font-weight:800;color:#0ea5e9;margin-bottom:6px}
    .stat-label{font-size:13px;color:#64748b;line-height:1.5}
    .section{padding:64px 24px}
    .section-alt{background:#f8fafc}
    h2{font-size:clamp(22px,3vw,32px);font-weight:700;color:#0f172a;margin-bottom:16px}
    .section-lead{color:#64748b;font-size:16px;margin-bottom:40px;max-width:600px;line-height:1.7}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:40px}
    @media(max-width:700px){.two-col{grid-template-columns:1fr}.btn-outline{margin-left:0;margin-top:12px}}
    ul.pain-list,ul.solution-list{list-style:none;padding:0}
    ul.pain-list li::before{content:"✗ ";color:#ef4444;font-weight:700}
    ul.solution-list li::before{content:"✓ ";color:#22c55e;font-weight:700}
    .cta-section{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:80px 24px;text-align:center;color:#fff}
    .cta-section h2{color:#fff;margin-bottom:16px}
    .cta-section p{color:rgba(255,255,255,.75);font-size:17px;max-width:560px;margin:0 auto 36px}
    .links-section{padding:40px 24px;border-top:1px solid #e2e8f0;background:#fff}
    .links-section h3{font-size:16px;font-weight:600;color:#334155;margin-bottom:16px}
    footer{background:#0f172a;color:rgba(255,255,255,.7);padding:40px 24px;font-size:13px;text-align:center}
    footer a{color:#38bdf8;text-decoration:none}
    .opening-para{font-size:17px;color:#334155;line-height:1.8;margin-bottom:32px;padding:24px;background:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:0 8px 8px 0}
  </style>
</head>
<body>

<nav>
  <a href="/">Liberty Bancard</a>
  <div class="nav-links">
    <a href="/industries/restaurant-payment-processing">Industries</a>
    <a href="/upload-statement">Free Review</a>
    <a href="/about-contact">Contact</a>
  </div>
</nav>

<div class="breadcrumb">
  <div class="container">
    <a href="/">Home</a><span>›</span>
    <a href="/industries/${escHtml(vertical.industryPageSlug)}">${escHtml(vertical.name)} Processing</a><span>›</span>
    <a href="/locations/${escHtml(city.slug)}">${escHtml(city.name)}, ${escHtml(city.state)}</a><span>›</span>
    <span>${escHtml(vertical.name)}</span>
  </div>
</div>

<section class="hero">
  <div class="container">
    <div class="hero-badge">📍 ${escHtml(city.name)}, ${escHtml(city.stateFullName)}</div>
    <h1>${escHtml(title)}</h1>
    <p>${escHtml(openingParagraph)}</p>
    <div>
      <a href="/upload-statement" class="btn btn-primary">Free Statement Review</a>
      <a href="/industries/${escHtml(vertical.industryPageSlug)}" class="btn btn-outline">Learn About ${escHtml(vertical.name)} Processing</a>
    </div>
  </div>
</section>

<div class="stats-grid">
  <div class="container" style="display:contents">
    <div class="stat-card">
      <div class="stat-value">${escHtml(vertical.avgRate)}</div>
      <div class="stat-label">Typical effective rate we find on ${escHtml(city.name)} ${escHtml(vertical.name.toLowerCase())} statements</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${escHtml(vertical.avgSavings)}</div>
      <div class="stat-label">Average annual savings identified per ${escHtml(city.name)} ${escHtml(vertical.name.toLowerCase())} location</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${escHtml(city.population)}</div>
      <div class="stat-label">${escHtml(city.name)} population — ${escHtml(city.businessCount)} businesses served by our local support team</div>
    </div>
  </div>
</div>

<section class="section">
  <div class="container">
    <div class="opening-para">
      ${escHtml(city.description)}. ${escHtml(city.name)}'s ${escHtml(vertical.name.toLowerCase())} businesses — found across ${escHtml(city.neighborhoods)} — are processing cards every day at rates that could be significantly lower with the right processor.
    </div>

    <div class="two-col">
      <div>
        <h2>Pain Points for ${escHtml(city.name)} ${escHtml(vertical.name)} Businesses</h2>
        <p class="section-lead">These are the most common issues we identify when reviewing statements from ${escHtml(city.name)}-area ${escHtml(vertical.name.toLowerCase())} businesses.</p>
        <ul class="pain-list">
          ${painPointsHtml}
        </ul>
      </div>
      <div>
        <h2>How Liberty Bancard Solves Them</h2>
        <p class="section-lead">Our solutions are built around your real numbers, not estimates. Here's what we bring to ${escHtml(city.name)} ${escHtml(vertical.name.toLowerCase())} businesses.</p>
        <ul class="solution-list">
          ${solutionsHtml}
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="section section-alt">
  <div class="container">
    <h2>${escHtml(vertical.name)} Payment Processing in ${escHtml(city.name)}: Frequently Asked Questions</h2>
    <p class="section-lead">Common questions from ${escHtml(city.name)}-area ${escHtml(vertical.name.toLowerCase())} business owners considering Liberty Bancard.</p>
    ${faqsHtml}
  </div>
</section>

<section class="cta-section">
  <div class="container">
    <h2>${escHtml(city.name)} ${escHtml(vertical.name)} Owners: See What You're Really Paying</h2>
    <p>Upload your most recent processing statement. We'll break it down line by line and show you exactly where your money goes. Keep the analysis even if you don't switch.</p>
    <a href="/upload-statement" class="btn btn-primary" style="margin-right:12px;">Upload Statement — Free Review</a>
    <a href="tel:+19542668214" class="btn btn-outline">Call (954) 266-8214</a>
  </div>
</section>

<div class="links-section">
  <div class="container">
    <h3>${escHtml(vertical.name)} Processing in Other Cities</h3>
    <div style="margin-bottom:32px;">
      ${relatedCitiesHtml}
    </div>
    <h3>Other Industries in ${escHtml(city.name)}</h3>
    <div>
      ${relatedVerticalsHtml}
    </div>
  </div>
</div>

<footer>
  <div class="container">
    <p>© ${new Date().getFullYear()} Liberty Bancard | 
      <a href="/">Home</a> · 
      <a href="/locations/${escHtml(city.slug)}">All Industries in ${escHtml(city.name)}</a> · 
      <a href="/upload-statement">Free Statement Review</a> · 
      <a href="/about-contact">Contact Us</a>
    </p>
    <p style="margin-top:12px;font-size:12px;color:rgba(255,255,255,.4);">
      Liberty Bancard is a registered ISO/MSP. Payment processing services are provided by member banks. 
      Serving ${escHtml(city.name)}, ${escHtml(city.stateFullName)} and nationwide.
    </p>
  </div>
</footer>

</body>
</html>`;
}

export function getCityHubHtml(citySlug: string): string | null {
  const city = getCityData(citySlug);
  if (!city) return null;

  const baseUrl = "https://libertybancard.com";
  const pageUrl = `${baseUrl}/locations/${city.slug}`;
  const title = `Payment Processing in ${city.name}, ${city.state} | Liberty Bancard`;
  const description = `${city.name} businesses save on credit card processing with Liberty Bancard interchange-plus pricing. Free statement review for ${city.name}, ${city.state} merchants.`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${baseUrl}/` },
      { "@type": "ListItem", position: 2, name: `${city.name}, ${city.state}`, item: pageUrl },
    ],
  };

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description,
    url: pageUrl,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: {
        "@type": "State",
        name: city.stateFullName,
      },
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
  };

  const verticalCardsHtml = VERTICALS.map(
    (v) => `
    <a href="/locations/${city.slug}/${v.slug}" style="display:block;border:1px solid #e2e8f0;border-radius:10px;padding:20px;text-decoration:none;color:inherit;background:#fff;transition:border-color .2s;margin-bottom:16px;">
      <div style="font-size:16px;font-weight:600;color:#0f172a;margin-bottom:6px;">${escHtml(v.name)} Payment Processing</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:10px;">Typical savings: ${escHtml(v.avgSavings)}/year · Avg rate: ${escHtml(v.avgRate)}</div>
      <div style="font-size:13px;color:#0ea5e9;font-weight:500;">View ${escHtml(city.name)} ${escHtml(v.name)} solutions →</div>
    </a>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}" />
  <link rel="canonical" href="${escHtml(pageUrl)}" />
  <meta property="og:title" content="${escHtml(title)}" />
  <meta property="og:description" content="${escHtml(description)}" />
  <meta property="og:url" content="${escHtml(pageUrl)}" />
  <meta property="og:type" content="website" />
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(localBusinessSchema)}</script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#fff;line-height:1.6}
    a{color:inherit}
    .container{max-width:1100px;margin:0 auto;padding:0 24px}
    nav{background:#0f172a;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
    nav a{color:#fff;text-decoration:none;font-weight:600;font-size:18px}
    nav .nav-links{display:flex;gap:24px}
    nav .nav-links a{font-size:14px;font-weight:400;color:rgba(255,255,255,.8)}
    .hero{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:80px 24px 60px;color:#fff}
    .hero h1{font-size:clamp(28px,4vw,44px);font-weight:800;line-height:1.2;margin-bottom:16px}
    .hero p{font-size:17px;color:rgba(255,255,255,.75);max-width:620px;margin-bottom:32px;line-height:1.7}
    .btn{display:inline-block;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none}
    .btn-primary{background:#0ea5e9;color:#fff}
    .breadcrumb{background:#f1f5f9;padding:12px 24px;font-size:13px;color:#64748b}
    .breadcrumb a{color:#0ea5e9;text-decoration:none}
    .breadcrumb span{margin:0 6px}
    .section{padding:64px 24px}
    h2{font-size:clamp(22px,3vw,32px);font-weight:700;color:#0f172a;margin-bottom:16px}
    .section-lead{color:#64748b;font-size:16px;margin-bottom:32px;line-height:1.7}
    .verticals-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0}
    footer{background:#0f172a;color:rgba(255,255,255,.7);padding:40px 24px;font-size:13px;text-align:center}
    footer a{color:#38bdf8;text-decoration:none}
    .city-stat{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 16px;margin:4px;font-size:14px;color:#0369a1}
  </style>
</head>
<body>

<nav>
  <a href="/">Liberty Bancard</a>
  <div class="nav-links">
    <a href="/industries/restaurant-payment-processing">Industries</a>
    <a href="/upload-statement">Free Review</a>
    <a href="/about-contact">Contact</a>
  </div>
</nav>

<div class="breadcrumb">
  <div class="container">
    <a href="/">Home</a><span>›</span>
    <span>${escHtml(city.name)}, ${escHtml(city.state)}</span>
  </div>
</div>

<section class="hero">
  <div class="container">
    <h1>Payment Processing in ${escHtml(city.name)}, ${escHtml(city.state)}</h1>
    <p>${escHtml(city.description)}. Liberty Bancard serves ${escHtml(city.businessCount)} businesses across ${escHtml(city.name)} with transparent, interchange-plus payment processing.</p>
    <a href="/upload-statement" class="btn btn-primary">Free Statement Review</a>
  </div>
</section>

<section class="section">
  <div class="container">
    <div style="margin-bottom:32px;">
      <span class="city-stat">📍 ${escHtml(city.name)}, ${escHtml(city.stateFullName)}</span>
      <span class="city-stat">👥 Population: ${escHtml(city.population)}</span>
      <span class="city-stat">🏪 ${escHtml(city.businessCount)} businesses</span>
      <span class="city-stat">🏘️ ${escHtml(city.neighborhoods)}</span>
    </div>
    <h2>Industry-Specific Payment Processing in ${escHtml(city.name)}</h2>
    <p class="section-lead">
      Select your industry below for tailored payment processing solutions, typical rates, and industry-specific savings information for ${escHtml(city.name)}-area businesses.
    </p>
    <div class="verticals-grid">
      ${verticalCardsHtml}
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <p>© ${new Date().getFullYear()} Liberty Bancard | 
      <a href="/">Home</a> · 
      <a href="/upload-statement">Free Statement Review</a> · 
      <a href="/about-contact">Contact Us</a>
    </p>
    <p style="margin-top:12px;font-size:12px;color:rgba(255,255,255,.4);">
      Liberty Bancard is a registered ISO/MSP. Serving ${escHtml(city.name)}, ${escHtml(city.stateFullName)} and nationwide.
    </p>
  </div>
</footer>

</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
