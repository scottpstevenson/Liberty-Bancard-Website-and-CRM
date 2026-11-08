import { FSR_HOME_LINK_TEXT } from "@shared/free-statement-review-content";
import { claimText } from "@shared/public-claims";
import { ZP_HOME_SSR } from "@shared/zero-percent-content";
import { HOME_FOUNDER, HOME_HERO, HOME_PROCESSING_ANCHOR, HOME_SOLUTIONS, HOME_SOLUTIONS_ANCHOR, HOME_STARTING_POINTS } from "@shared/public-home-content";
import { ssrHtmlShell } from "../ssrShared";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function getHomeHtml(): string {
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Liberty Bancard",
    url: "https://libertybancard.com",
    telephone: "+1-954-266-8214",
    email: "support@libertybancard.com",
    description: "Transparent merchant payment processing with interchange-plus pricing, cash discount and surcharging program reviews, and dedicated support for small businesses.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
    sameAs: [],
  };

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Liberty Bancard",
    description: "Transparent merchant payment processing with interchange-plus pricing and dedicated support.",
    url: "https://libertybancard.com",
    telephone: "+1-954-266-8214",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Fort Lauderdale",
      addressRegion: "FL",
      addressCountry: "US",
    },
    priceRange: "$$",
    openingHours: "Mo-Fr 09:00-18:00",
  };

  const webSiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Liberty Bancard",
    url: "https://libertybancard.com",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://libertybancard.com/blog?q={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  };

  const body = `
    <div class="ssr-hero">
      <div class="ssr-hero-inner">
        <div class="ssr-hero-badge">${esc(HOME_HERO.eyebrow)}</div>
        <h1>${esc(HOME_HERO.heading)}</h1>
        <p class="ssr-hero-subtitle">
          ${esc(HOME_HERO.body)}
        </p>
        <div class="ssr-hero-buttons">
          <a href="${HOME_HERO.primary.href}" class="ssr-btn-primary">${esc(HOME_HERO.primary.label)}</a>
          <a href="${HOME_HERO.secondary.href}" class="ssr-btn-outline">${esc(HOME_HERO.secondary.label)}</a>
        </div>
      </div>
    </div>

    <section class="ssr-section ssr-section-muted" id="${HOME_SOLUTIONS_ANCHOR}">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_SOLUTIONS.heading)}</h2>
        <div class="ssr-grid-3">
${HOME_SOLUTIONS.cards.map((card) => `          <a href="${card.href}" class="ssr-card" style="display:block;text-decoration:none;border-top:3px solid #071D57;">
            <div class="ssr-card-title">${esc(card.title)}</div>
            <div class="ssr-card-text">${esc(card.body)}</div>
            <div class="ssr-card-text" style="margin-top:0.75rem;font-weight:600;color:#071D57;text-decoration:underline;">${esc(card.linkLabel)}</div>
          </a>`).join("\n")}
        </div>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <div style="max-width:48rem;border-left:4px solid #C8102E;padding-left:1.25rem;">
          <h2 class="ssr-section-heading" style="text-align:left;">${esc(HOME_FOUNDER.heading)}</h2>
          <p class="ssr-section-subheading" style="text-align:left;">${esc(HOME_FOUNDER.body)}</p>
          <a href="${HOME_FOUNDER.cta.href}" class="ssr-btn-dark">${esc(HOME_FOUNDER.cta.label)}</a>
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <div class="ssr-grid-3">
          <div class="ssr-card" style="text-align:center;">
            <!-- source: Internal — company founding year, verified Aug 2026 -->
            <!-- measuredAs: Calendar years of operation from founding -->
            <div class="ssr-stat-value">10+</div>
            <div class="ssr-stat-label">Years in Business</div>
          </div>
          <div class="ssr-card" style="text-align:center;">
            <!-- source: Internal — CRM cumulative merchant count, last verified Aug 2026 -->
            <!-- measuredAs: Cumulative approved merchant accounts, all-time -->
            <div class="ssr-stat-value">5,000+</div>
            <div class="ssr-stat-label">Merchants Served</div>
          </div>
          <div class="ssr-card" style="text-align:center;">
            <div class="ssr-stat-value">FL-Based</div>
            <div class="ssr-stat-label">South Florida Team</div>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section" id="${HOME_PROCESSING_ANCHOR}">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">What We Do Differently</h2>
        <p class="ssr-section-subheading">Most processors hide their margins in bundled rates. We don't.</p>
        <div class="ssr-grid-2">
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">💲</div>
            <div>
              <div class="ssr-item-title">Interchange-Plus Pricing</div>
              <div class="ssr-item-text">You see the exact card network cost plus our transparent markup. No bundled rates, no hidden fees — just the truth about what payment processing actually costs.</div>
            </div>
          </div>
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">📊</div>
            <div>
              <div class="ssr-item-title">Free Statement Review</div>
              <div class="ssr-item-text">Upload your current statement and we'll review every line item. We'll explain what you're paying and who charges it. No commitment required.</div>
            </div>
          </div>
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">⚡</div>
            <div>
              <div class="ssr-item-title">${ZP_HOME_SSR.title}</div>
              <div class="ssr-item-text">${ZP_HOME_SSR.text}</div>
            </div>
          </div>
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">🤝</div>
            <div>
              <div class="ssr-item-title">Dedicated Account Rep</div>
              <div class="ssr-item-text">A real person who knows your business, answers when you call, and helps when something goes wrong. Not a call center, not a ticket system — a dedicated partner.</div>
            </div>
          </div>
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">🏦</div>
            <div>
              <div class="ssr-item-title">Funding Availability</div>
              <div class="ssr-item-text">${claimText("funding.availability", "home")}*</div>
            </div>
          </div>
          <div class="ssr-card ssr-pain-item">
            <div class="ssr-solution-icon">🖥</div>
            <div>
              <div class="ssr-item-title">Equipment Options</div>
              <div class="ssr-item-text">${claimText("equipment.options.summary", "home")}*</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">How the Free Statement Review Works</h2>
        <p class="ssr-section-subheading">Three steps to knowing exactly what payment processing should cost your business.</p>
        <div class="ssr-grid-3">
          <div class="ssr-card" style="text-align:center;">
            <div style="font-size:2rem;margin-bottom:0.75rem;">1️⃣</div>
            <div class="ssr-card-title">Upload Your Statement</div>
            <div class="ssr-card-text">Securely upload your most recent processing statement — any processor, any format. Takes 30 seconds.</div>
          </div>
          <div class="ssr-card" style="text-align:center;">
            <div style="font-size:2rem;margin-bottom:0.75rem;">2️⃣</div>
            <div class="ssr-card-title">We Analyze It</div>
            <div class="ssr-card-text">Our team reviews every line item, explains each fee and who charges it, and calculates your effective cost.</div>
          </div>
          <div class="ssr-card" style="text-align:center;">
            <div style="font-size:2rem;margin-bottom:0.75rem;">3️⃣</div>
            <div class="ssr-card-title">See Your Options</div>
            <div class="ssr-card-text">We explain your options with the calculation inputs shown. Keep the analysis either way.</div>
          </div>
        </div>
        <div style="text-align:center;margin-top:2rem;">
          <a href="/upload-statement" class="ssr-btn-dark">📤 Start Free Statement Review</a>
        </div>
        <p style="text-align:center;margin-top:1rem;"><a href="/upload-statement">${FSR_HOME_LINK_TEXT}</a></p>
      </div>
    </section>

    <section class="ssr-section">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">Industries We Serve</h2>
        <p class="ssr-section-subheading">Payment processing built around how your industry actually operates.</p>
        <div class="ssr-grid-3">
          <a href="/industries/restaurant-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">🍽 Restaurant</div>
            <div class="ssr-card-text">Tip handling, POS compatibility questions, and statement review for high-volume restaurant operations.</div>
          </a>
          <a href="/industries/retail-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">🛍 Retail</div>
            <div class="ssr-card-text">Interchange-plus pricing shows the card-network cost by card type. Multi-location management, chargeback support.</div>
          </a>
          <a href="/industries/healthcare-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">🏥 Healthcare</div>
            <div class="ssr-card-text">PCI-compliant solutions for medical and dental practices. Patient payment plans, clear reporting.</div>
          </a>
          <a href="/industries/salon-spa-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">💇 Salon &amp; Spa</div>
            <div class="ssr-card-text">Card-on-file for no-shows, tip-optimized processing, software-agnostic integration.</div>
          </a>
          <a href="/industries/auto-repair-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">🔧 Auto Repair</div>
            <div class="ssr-card-text">High-ticket optimization, fleet card acceptance, fast deposits for parts purchasing.</div>
          </a>
          <a href="/industries/professional-services-payment-processing" class="ssr-card" style="display:block;text-decoration:none;">
            <div class="ssr-card-title">💼 Professional Services</div>
            <div class="ssr-card-text">Virtual terminal, payment links for invoices, retainer billing, variable volume support.</div>
          </a>
        </div>
        <p style="text-align:center;margin-top:1.5rem;"><a href="/industries" style="font-weight:600;text-decoration:underline;">All industries</a></p>
      </div>
    </section>

    <section class="ssr-section ssr-section-muted">
      <div class="ssr-section-inner">
        <h2 class="ssr-section-heading">${esc(HOME_STARTING_POINTS.heading)}</h2>
        <div class="ssr-grid-2">
${HOME_STARTING_POINTS.cards.map((card) => `          <div class="ssr-card" style="border-top:3px solid #071D57;">
            <div class="ssr-card-title">${esc(card.title)}</div>
            <div class="ssr-card-text">${esc(card.body)}</div>
            <p style="margin-top:1rem;"><a href="${card.href}" class="ssr-btn-dark">${esc(card.ctaLabel)}</a></p>
            <div class="ssr-card-text" style="margin-top:0.75rem;">${esc(card.note)}</div>
          </div>`).join("\n")}
        </div>
      </div>
    </section>

    <section class="ssr-section ssr-section-dark">
      <div class="ssr-section-inner">
        <div class="ssr-cta-section">
          <h2>Ready to Stop Overpaying for Payment Processing?</h2>
          <p>Upload your statement and we'll show you exactly what you're paying and exactly what you should be paying. Takes 30 seconds to start. No commitment required.</p>
          <div class="ssr-cta-buttons">
            <a href="/upload-statement" class="ssr-btn-primary">📤 Upload Statement — Free Review</a>
            <a href="tel:9542668214" class="ssr-btn-outline">📞 Call (954) 266-8214</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return ssrHtmlShell({
    title: "Merchant Payment Processing | Liberty Bancard",
    description: "Liberty Bancard offers transparent interchange-plus payment processing, a free statement review, cash discount and surcharging reviews, and merchant support.",
    canonical: "/",
    // Logo card sized for iOS/social square crops; the generated card is the fallback for other pages.
    ogImage: "https://libertybancard.com/og-home-logo-card.jpg",
    keywords: "merchant payment processing, interchange plus pricing, credit card processing, payment processor, merchant services, 0 percent processing, free statement review",
    schemaJsons: [orgSchema, localBusinessSchema, webSiteSchema],
    body,
  });
}
