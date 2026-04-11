import { ssrHtmlShell } from "../ssrShared";
import { CITIES, VERTICALS, getCityData, getVerticalData } from "./location-data";

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLocationHtml(citySlug: string, verticalSlug: string): string | null {
  const city = getCityData(citySlug);
  const vertical = getVerticalData(verticalSlug);
  if (!city || !vertical) return null;

  const canonical = `/locations/${city.slug}/${vertical.slug}`;
  const title = `${vertical.name} Payment Processing in ${city.name}, ${city.state}`;
  const description = `Transparent payment processing for ${vertical.name.toLowerCase()} businesses in ${city.name}, ${city.stateFullName}. Reduce credit card fees with interchange-plus pricing. Free statement review for ${city.name} ${vertical.name.toLowerCase()} owners.`;
  const keywords = `${vertical.name.toLowerCase()} payment processing ${city.name}, ${city.name} ${vertical.name.toLowerCase()} credit card processing, merchant services ${city.name} ${city.state}`;

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: vertical.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${vertical.name} Processing`, item: `https://libertybancard.com/industries/${vertical.industryPageSlug}` },
      { "@type": "ListItem", position: 3, name: `${city.name}, ${city.state}`, item: `https://libertybancard.com${canonical}` },
    ],
  };

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description,
    url: `https://libertybancard.com${canonical}`,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: { "@type": "State", name: city.stateFullName },
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
  };

  const statsHtml = [
    { value: vertical.avgRate, label: `Typical effective rate on ${city.name} ${vertical.name.toLowerCase()} statements` },
    { value: vertical.avgSavings, label: `Average annual savings identified per ${city.name} ${vertical.name.toLowerCase()} location` },
    { value: city.population, label: `${city.name} population — ${city.businessCount} businesses in our service area` },
  ]
    .map(
      (s) => `<div class="ssr-card" style="text-align:center;">
      <div class="ssr-stat-value">${esc(s.value)}</div>
      <div class="ssr-stat-label">${esc(s.label)}</div>
    </div>`
    )
    .join("");

  const benefitsHtml = [
    ...vertical.painPoints.map((p) => ({
      icon: "✗",
      color: "#ef4444",
      title: "Pain point",
      text: p,
    })),
    ...vertical.solutions.map((s) => ({
      icon: "✓",
      color: "#22c55e",
      title: "Solution",
      text: s,
    })),
  ]
    .map(
      (b) => `<div class="ssr-card ssr-pain-item">
      <div class="ssr-solution-icon" style="color:${b.color}">${b.icon}</div>
      <div>
        <div class="ssr-item-text">${esc(b.text)}</div>
      </div>
    </div>`
    )
    .join("");

  const faqsHtml = vertical.faqs
    .map(
      (f) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${esc(f.q)}</div>
      <div class="ssr-faq-a">${esc(f.a)}</div>
    </div>`
    )
    .join("");

  const relatedCities = CITIES.filter((c) => c.slug !== city.slug).slice(0, 10);
  const relatedVerticals = VERTICALS.filter((v) => v.slug !== vertical.slug).slice(0, 6);

  const otherCities = relatedCities
    .map((c) => `<a href="/locations/${c.slug}/${vertical.slug}" class="ssr-crosslink-btn">📍 ${esc(c.name)}, ${esc(c.state)}</a>`)
    .join("");

  const otherVerticals = relatedVerticals
    .map((v) => `<a href="/locations/${city.slug}/${v.slug}" class="ssr-crosslink-btn">📍 ${esc(v.name)} in ${esc(city.name)}</a>`)
    .join("");

  const openingParagraph = `${city.name} has ${city.businessCount} businesses. ${city.description}. If you run a ${vertical.name.toLowerCase()} in ${city.name}, here's what you're likely paying to process cards — and what you could be paying instead.`;

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">📍 ${esc(city.name)}, ${esc(city.stateFullName)}</div>
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <a href="/industries/${esc(vertical.industryPageSlug)}">${esc(vertical.name)} Processing</a><span>/</span>
          <a href="/locations/${esc(city.slug)}">${esc(city.name)}, ${esc(city.state)}</a><span>/</span>
          <span>${esc(vertical.name)}</span>
        </div>
        <h1>${esc(title)}</h1>
        <p class="ssr-hero-subtitle">${esc(openingParagraph)}</p>
        <div class="ssr-hero-buttons">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Free Statement Review</a>
          <a href="/industries/${esc(vertical.industryPageSlug)}" class="ssr-btn-outline">Learn More About ${esc(vertical.name)} Processing</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <div class="ssr-grid-3">${statsHtml}</div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Pain Points &amp; Solutions for ${esc(city.name)} ${esc(vertical.name)} Businesses</h2>
        <p class="ssr-section-subheading">Common issues we identify when reviewing statements from ${esc(city.name)}-area ${esc(vertical.name.toLowerCase())} businesses — and how Liberty Bancard solves them.</p>
        <div class="ssr-grid-2">${benefitsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(vertical.name)} Payment Processing in ${esc(city.name)}: FAQ</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(city.name)} ${esc(vertical.name)} Owners: See What You're Really Paying</h2>
          <p>Upload your most recent processing statement. We'll break it down line-by-line and show you exactly where your money goes. Keep the analysis even if you don't switch.</p>
          <div class="ssr-cta-buttons">
            <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — Free Review</a>
            <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h3 style="font-family:'Outfit',sans-serif;font-weight:700;text-align:center;margin-bottom:1rem;font-size:1.125rem;">
          More ${esc(vertical.name)} Processing Locations
        </h3>
        <div class="ssr-crosslinks">${otherCities}</div>

        <h3 style="font-family:'Outfit',sans-serif;font-weight:700;text-align:center;margin:2rem 0 1rem;font-size:1.125rem;">
          Other Industries in ${esc(city.name)}
        </h3>
        <div class="ssr-crosslinks">${otherVerticals}</div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title,
    description,
    canonical,
    keywords,
    schemaJsons: [faqSchema, breadcrumbSchema, localBusinessSchema],
    body,
  });
}

export function getLocationHtml(citySlug: string, industrySlug: string): string | null {
  return renderLocationHtml(citySlug, industrySlug);
}

export function getCityHubHtml(citySlug: string): string | null {
  const city = getCityData(citySlug);
  if (!city) return null;

  const canonical = `/locations/${city.slug}`;
  const title = `Payment Processing in ${city.name}, ${city.state} | Liberty Bancard`;
  const description = `Liberty Bancard serves ${city.name} businesses across all industries. Find industry-specific payment processing solutions for ${city.name}, ${city.stateFullName} merchants. Free statement review.`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${city.name}, ${city.state}`, item: `https://libertybancard.com${canonical}` },
    ],
  };

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description,
    url: `https://libertybancard.com${canonical}`,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: { "@type": "State", name: city.stateFullName },
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
    <div class="ssr-card">
      <a href="/locations/${esc(city.slug)}/${esc(v.slug)}" style="text-decoration:none;color:inherit;display:block;">
        <div class="ssr-item-title" style="margin-bottom:4px;">${esc(v.name)} Payment Processing</div>
        <div class="ssr-item-text" style="margin-bottom:8px;">Typical savings: ${esc(v.avgSavings)}/year · Avg rate: ${esc(v.avgRate)}</div>
        <div style="color:#0ea5e9;font-size:13px;font-weight:500;">View ${esc(city.name)} ${esc(v.name)} solutions →</div>
      </a>
    </div>`
  ).join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">📍 ${esc(city.name)}, ${esc(city.stateFullName)}</div>
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <span>${esc(city.name)}, ${esc(city.state)}</span>
        </div>
        <h1>Payment Processing in ${esc(city.name)}, ${esc(city.state)}</h1>
        <p class="ssr-hero-subtitle">${esc(city.description)}. Liberty Bancard serves ${esc(city.businessCount)} businesses across ${esc(city.name)} with transparent, interchange-plus payment processing.</p>
        <div class="ssr-hero-buttons">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Free Statement Review</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;">
          <span style="background:#e0f2fe;color:#0369a1;border-radius:6px;padding:6px 12px;font-size:13px;">📍 ${esc(city.name)}, ${esc(city.stateFullName)}</span>
          <span style="background:#e0f2fe;color:#0369a1;border-radius:6px;padding:6px 12px;font-size:13px;">👥 Population: ${esc(city.population)}</span>
          <span style="background:#e0f2fe;color:#0369a1;border-radius:6px;padding:6px 12px;font-size:13px;">🏪 ${esc(city.businessCount)} businesses</span>
        </div>
        <h2 class="ssr-section-heading">Industry-Specific Payment Processing in ${esc(city.name)}</h2>
        <p class="ssr-section-subheading">Select your industry below for tailored payment processing solutions, typical rates, and industry-specific savings information for ${esc(city.name)}-area businesses.</p>
        <div class="ssr-grid-2">${verticalCardsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${esc(city.name)} Business Owners: See What You're Really Paying</h2>
          <p>Upload your most recent processing statement. We'll break it down line-by-line and show you exactly where your money goes — no obligation.</p>
          <div class="ssr-cta-buttons">
            <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — Free Review</a>
            <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title,
    description,
    canonical,
    keywords: `payment processing ${city.name}, merchant services ${city.name} ${city.state}, credit card processing ${city.name}`,
    schemaJsons: [breadcrumbSchema, localBusinessSchema],
    body,
  });
}
