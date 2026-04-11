import { ssrHtmlShell } from "../ssrShared";

interface LocationData {
  citySlug: string;
  cityName: string;
  industrySlug: string;
  industryName: string;
  industryPageSlug: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  heroTitle: string;
  heroSubtitle: string;
  localStats: { value: string; label: string }[];
  benefits: { title: string; description: string }[];
  faqs: { question: string; answer: string }[];
}

const cities = [
  { slug: "miami", name: "Miami" },
  { slug: "fort-lauderdale", name: "Fort Lauderdale" },
  { slug: "tampa", name: "Tampa" },
  { slug: "orlando", name: "Orlando" },
  { slug: "jacksonville", name: "Jacksonville" },
];

const topVerticals = [
  { slug: "restaurant", name: "Restaurant", industryPageSlug: "restaurant-payment-processing" },
  { slug: "auto-repair", name: "Auto Repair", industryPageSlug: "auto-repair-payment-processing" },
  { slug: "healthcare", name: "Healthcare", industryPageSlug: "healthcare-payment-processing" },
  { slug: "salon", name: "Salon & Spa", industryPageSlug: "salon-spa-payment-processing" },
  { slug: "retail", name: "Retail", industryPageSlug: "retail-payment-processing" },
];

const cityPopData: Record<string, { businesses: string; metro: string }> = {
  miami: { businesses: "12,000+", metro: "6.1 million" },
  "fort-lauderdale": { businesses: "8,500+", metro: "1.9 million" },
  tampa: { businesses: "9,200+", metro: "3.2 million" },
  orlando: { businesses: "10,800+", metro: "2.7 million" },
  jacksonville: { businesses: "7,600+", metro: "1.6 million" },
};

const verticalData: Record<string, {
  benefits: (city: { slug: string; name: string }) => { title: string; description: string }[];
  faqs: (city: { slug: string; name: string }) => { question: string; answer: string }[];
  avgRate: string;
  avgSavings: string;
}> = {
  restaurant: {
    avgRate: "2.4%",
    avgSavings: "$3,200",
    benefits: (city) => [
      { title: "Interchange-plus pricing for restaurants", description: `${city.name} restaurants process high volumes of card transactions daily. Interchange-plus pricing reveals your true costs and saves on every swipe, dip, and tap.` },
      { title: "Next-day funding for FL restaurants", description: `Keep your cash flow moving with next-day deposits. Buy ingredients, pay staff, and manage daily operations without waiting days for your money.` },
      { title: "Tip adjustment optimization", description: `Tip adjustments inflate processing costs for restaurants. We configure your terminals to minimize the interchange impact of gratuity adjustments.` },
      { title: "Local support when you need it", description: `Based in Fort Lauderdale, our team understands the ${city.name} restaurant scene and provides responsive support during your busiest hours.` },
    ],
    faqs: (city) => [
      { question: `What is the best payment processor for restaurants in ${city.name}?`, answer: `The best processor for ${city.name} restaurants is one that offers interchange-plus pricing, understands tip adjustments, and provides next-day funding. Liberty Bancard specializes in restaurant payment processing with transparent pricing and local Florida support.` },
      { question: `How much can ${city.name} restaurants save on processing fees?`, answer: `We typically identify $3,200 or more in annual savings for restaurants in the ${city.name} area. Your actual savings depend on your volume, average ticket, and current pricing structure — which we'll identify in your free statement review.` },
      { question: "Do you serve restaurants throughout the metro area?", answer: `Yes. We serve restaurants across the greater ${city.name} metropolitan area, including all surrounding neighborhoods and suburbs.` },
      { question: "Can I keep my current POS system?", answer: "In most cases, yes. We integrate with major restaurant POS systems and aren't tied to any single platform. We'll confirm compatibility during your statement review." },
    ],
  },
  "auto-repair": {
    avgRate: "3.0%",
    avgSavings: "$4,800",
    benefits: (city) => [
      { title: "High-ticket transaction optimization", description: `${city.name} auto shops process large repair invoices. Interchange-plus pricing saves significantly more on $1,000+ transactions than flat-rate pricing.` },
      { title: "Keyed-entry rate management", description: "Phone orders and fleet account payments get competitive keyed-entry rates, reducing the premium you pay on manually entered transactions." },
      { title: "Fast deposits for parts purchasing", description: `Auto shops need cash flow for parts. Qualified ${city.name} shops receive next-day deposits to keep your parts purchasing on schedule.` },
      { title: "Fleet and commercial card acceptance", description: "Accept Level II commercial and fleet cards at reduced interchange rates, saving your shop and fleet customers money." },
    ],
    faqs: (city) => [
      { question: `What is the cheapest credit card processing for auto shops in ${city.name}?`, answer: `The cheapest processing for ${city.name} auto shops is typically interchange-plus pricing, which saves the most on high-ticket transactions like engine work, transmission repairs, and body work. Upload your statement for a free comparison.` },
      { question: `How much can auto repair shops in ${city.name} save?`, answer: `We identify an average of $4,800 in annual savings for auto repair shops. Shops with higher average tickets or significant fleet card volume often save even more.` },
      { question: "Can I accept fleet cards at lower rates?", answer: "Yes. We configure your terminal for Level II processing, which qualifies fleet and commercial card transactions for lower interchange rates." },
      { question: "Will my large invoices be held?", answer: "We set appropriate processing limits during onboarding so legitimate large repair bills aren't flagged. This prevents unnecessary deposit delays." },
    ],
  },
  healthcare: {
    avgRate: "2.6%",
    avgSavings: "$4,100",
    benefits: (city) => [
      { title: "Optimized pricing for patient payments", description: `${city.name} medical practices handle co-pays, procedure payments, and balances of varying sizes. Interchange-plus pricing optimizes costs across all transaction types.` },
      { title: "PCI-compliant payment solutions", description: "Secure, encrypted terminals and PCI-compliant processing infrastructure to protect patient payment data." },
      { title: "Patient payment plans", description: "Set up recurring billing for patient payment plans with secure card-on-file storage and automated charges." },
      { title: "Clear reporting for billing teams", description: `Help your ${city.name} practice billing team reconcile payments easily with detailed, exportable transaction reports.` },
    ],
    faqs: (city) => [
      { question: `What payment processing do ${city.name} medical practices use?`, answer: `${city.name} medical practices benefit from interchange-plus pricing with PCI-compliant terminals and detailed reporting. Liberty Bancard provides HIPAA-aware processing solutions designed for healthcare workflows.` },
      { question: "Is your processing HIPAA compliant?", answer: "Our payment processing is PCI DSS compliant. Payment data is handled separately from protected health information. We design solutions to support your overall compliance posture." },
      { question: "Can patients pay bills online?", answer: "Yes. We offer secure online payment links that patients can use to pay balances from any device, reducing collection calls." },
      { question: "Do you support recurring patient payment plans?", answer: "Yes. Secure card-on-file and recurring billing allow you to set up payment plans with automatic monthly charges." },
    ],
  },
  salon: {
    avgRate: "2.8%",
    avgSavings: "$2,400",
    benefits: (city) => [
      { title: "Tip-optimized processing", description: `${city.name} salons and spas process tips on nearly every transaction. We configure terminals to minimize the interchange cost of tip adjustments.` },
      { title: "Card-on-file for no-shows", description: "Protect your schedule with secure card-on-file storage for appointment deposits and no-show fee collection." },
      { title: "Software-agnostic integration", description: `Use your preferred salon management software without being locked into overpriced bundled processing rates.` },
      { title: "Next-day funding", description: `Qualified ${city.name} salons receive deposits by the next business day, keeping cash flow aligned with daily operations.` },
    ],
    faqs: (city) => [
      { question: `What is the best payment processing for salons in ${city.name}?`, answer: `The best processing for ${city.name} salons offers tip optimization, card-on-file for no-shows, and works with your existing scheduling software. Liberty Bancard provides all of these with transparent interchange-plus pricing.` },
      { question: "Can I charge no-show fees?", answer: "Yes. With secure card-on-file tokenization, you can store client cards and charge cancellation or no-show fees according to your salon's policy." },
      { question: "How do tip adjustments affect my costs?", answer: "Each tip adjustment can trigger higher interchange rates. We configure your terminal to prompt for tips at the point of sale, reducing post-authorization adjustments." },
      { question: "Do you work with salon booking software?", answer: "We work alongside your existing salon management software. Our processing integrates separately, so you're not locked into bundled rates." },
    ],
  },
  retail: {
    avgRate: "2.3%",
    avgSavings: "$2,800",
    benefits: (city) => [
      { title: "True interchange-plus for retail", description: `${city.name} retailers save significantly on debit card transactions with interchange-plus pricing versus flat-rate processors.` },
      { title: "Terminal purchase options", description: "Own your equipment outright instead of paying inflated lease costs. Modern EMV and NFC terminals at competitive prices." },
      { title: "Multi-location management", description: `Manage multiple ${city.name} area locations with consolidated reporting and consistent pricing from a single point of contact.` },
      { title: "Chargeback support and prevention", description: "Guidance on chargeback responses and best practices to reduce disputes and protect your revenue." },
    ],
    faqs: (city) => [
      { question: `What is the cheapest credit card processing for retail in ${city.name}?`, answer: `For ${city.name} retail stores processing over $10,000/month, interchange-plus pricing consistently costs less than flat-rate processors like Square or Stripe. Upload your statement for a free comparison.` },
      { question: "Can I use my existing terminals?", answer: "Many existing terminals can be reprogrammed. We'll assess your equipment during onboarding and advise on compatibility." },
      { question: "Do you support contactless payments?", answer: "Yes. All terminals we provide support EMV chip, contactless/NFC, Apple Pay, and Google Pay." },
      { question: `Do you support multiple store locations in ${city.name}?`, answer: `Yes. We set up consolidated reporting across all your ${city.name} area locations with consistent pricing and one dedicated contact.` },
    ],
  },
};

function generateLocationData(city: typeof cities[0], vertical: typeof topVerticals[0]): LocationData {
  const pop = cityPopData[city.slug] || { businesses: "5,000+", metro: "1 million" };
  const vd = verticalData[vertical.slug];

  return {
    citySlug: city.slug,
    cityName: city.name,
    industrySlug: vertical.slug,
    industryName: vertical.name,
    industryPageSlug: vertical.industryPageSlug,
    metaTitle: `${vertical.name} Payment Processing in ${city.name}, FL | Liberty Bancard`,
    metaDescription: `Transparent payment processing for ${vertical.name.toLowerCase()} businesses in ${city.name}, Florida. Reduce credit card fees with interchange-plus pricing. Free statement review for ${city.name} ${vertical.name.toLowerCase()} owners.`,
    keywords: `${vertical.name.toLowerCase()} payment processing ${city.name}, ${city.name} ${vertical.name.toLowerCase()} credit card processing, ${vertical.name.toLowerCase()} merchant services ${city.name} FL, payment processing ${city.name} Florida`,
    heroTitle: `${vertical.name} Payment Processing in ${city.name}, FL`,
    heroSubtitle: `Serving ${pop.businesses} ${vertical.name.toLowerCase()} businesses in the greater ${city.name} metro area (population ${pop.metro}). Local support, transparent pricing, and real savings on every transaction.`,
    localStats: [
      { value: vd.avgRate, label: `Average effective rate on ${city.name} ${vertical.name.toLowerCase()} statements` },
      { value: vd.avgSavings, label: `Average annual savings identified per ${city.name} location` },
      { value: "FL-Based", label: "Local Fort Lauderdale headquarters with Florida support team" },
    ],
    benefits: vd.benefits(city),
    faqs: vd.faqs(city),
  };
}

const LOCATION_LOOKUP: Record<string, LocationData> = {};
for (const city of cities) {
  for (const vertical of topVerticals) {
    const key = `${city.slug}/${vertical.slug}`;
    LOCATION_LOOKUP[key] = generateLocationData(city, vertical);
  }
}

function renderLocationHtml(data: LocationData): string {
  const canonical = `/locations/${data.citySlug}/${data.industrySlug}`;

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://libertybancard.com/" },
      { "@type": "ListItem", position: 2, name: `${data.industryName} Processing`, item: `https://libertybancard.com/industries/${data.industryPageSlug}` },
      { "@type": "ListItem", position: 3, name: `${data.cityName}, FL`, item: `https://libertybancard.com${canonical}` },
    ],
  };
  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description: data.metaDescription,
    url: `https://libertybancard.com${canonical}`,
    telephone: "+1-954-266-8214",
    areaServed: {
      "@type": "City",
      name: data.cityName,
      containedInPlace: { "@type": "State", name: "Florida" },
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
  };

  const statsHtml = data.localStats
    .map(
      (s) => `<div class="ssr-card" style="text-align:center;">
      <div class="ssr-stat-value">${s.value}</div>
      <div class="ssr-stat-label">${s.label}</div>
    </div>`
    )
    .join("");

  const benefitsHtml = data.benefits
    .map(
      (b) => `<div class="ssr-card ssr-pain-item">
      <div class="ssr-solution-icon">✓</div>
      <div>
        <div class="ssr-item-title">${b.title}</div>
        <div class="ssr-item-text">${b.description}</div>
      </div>
    </div>`
    )
    .join("");

  const faqsHtml = data.faqs
    .map(
      (f) => `<div class="ssr-faq-item">
      <div class="ssr-faq-q">${f.question}</div>
      <div class="ssr-faq-a">${f.answer}</div>
    </div>`
    )
    .join("");

  const otherCities = cities
    .filter((c) => c.slug !== data.citySlug)
    .map((c) => `<a href="/locations/${c.slug}/${data.industrySlug}" class="ssr-crosslink-btn">📍 ${c.name}</a>`)
    .join("");

  const otherVerticals = topVerticals
    .filter((v) => v.slug !== data.industrySlug)
    .map((v) => `<a href="/locations/${data.citySlug}/${v.slug}" class="ssr-crosslink-btn">📍 ${v.name} in ${data.cityName}</a>`)
    .join("");

  const body = `
    <div class="ssr-hero" style="padding-top: 2rem;">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">📍 ${data.cityName}, Florida</div>
        <div class="ssr-breadcrumb">
          <a href="/">Home</a><span>/</span>
          <a href="/industries/${data.industryPageSlug}">${data.industryName} Processing</a><span>/</span>
          <span>${data.cityName}, FL</span>
        </div>
        <h1>${data.heroTitle}</h1>
        <p class="ssr-hero-subtitle">${data.heroSubtitle}</p>
        <div class="ssr-hero-buttons">
          <a href="/upload-statement" class="ssr-btn-primary">📤 Free Statement Review</a>
          <a href="/industries/${data.industryPageSlug}" class="ssr-btn-outline">Learn More About ${data.industryName} Processing</a>
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
        <h2 class="ssr-section-heading">Why ${data.cityName} ${data.industryName} Businesses Choose Liberty Bancard</h2>
        <p class="ssr-section-subheading">We review your actual statement and build a solution around your real numbers — not estimates.</p>
        <div class="ssr-grid-2">${benefitsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${data.industryName} Payment Processing in ${data.cityName}: FAQ</h2>
        <div class="ssr-faq-wrapper">${faqsHtml}</div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>${data.cityName} ${data.industryName} Owners: See What You're Really Paying</h2>
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
          More ${data.industryName} Processing Locations in Florida
        </h3>
        <div class="ssr-crosslinks">${otherCities}</div>

        <h3 style="font-family:'Outfit',sans-serif;font-weight:700;text-align:center;margin:2rem 0 1rem;font-size:1.125rem;">
          Other Industries in ${data.cityName}
        </h3>
        <div class="ssr-crosslinks">${otherVerticals}</div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: data.metaTitle,
    description: data.metaDescription,
    canonical,
    keywords: data.keywords,
    schemaJsons: [faqSchema, breadcrumbSchema, localBusinessSchema],
    body,
  });
}

export function getLocationHtml(citySlug: string, industrySlug: string): string | null {
  const key = `${citySlug}/${industrySlug}`;
  const data = LOCATION_LOOKUP[key];
  if (!data) return null;
  return renderLocationHtml(data);
}
