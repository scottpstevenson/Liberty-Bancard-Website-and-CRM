/**
 * Server-rendered documents for the six partnership routes (/partners, /partners/referrals, /partners/sales-agents,
 * /partners/cpa, /partners/bookkeeper, /partners/insurance).
 *
 * The document a browser, a crawler or a slow connection receives before the React page loads carries the real page: the
 * route's own title, description, canonical, h1, hero photograph, sections, FAQ and structured data. Every word comes from the
 * same shared records the React pages read (shared/partner-public-content.ts, partner-profession-content.ts,
 * partner-page-seo.ts, partner-page-media.ts, partner-residual-calculator.ts), so the document and the hydrated page cannot
 * disagree.
 *
 * Referral compensation. The only referral percentage that can appear is the one in the published-policy projection passed
 * in by the route (server/services/partner-public-policy.ts, administrator-approved, revocable). With no approved policy the
 * projection is `written_agreement` and every referral surface says compensation is confirmed in the written agreement.
 * Nothing in this file contains a rate. Because the words depend on that projection, the routes serve these documents with
 * `Cache-Control: no-cache`: an approval or a revocation is reflected on the next request, never after a CDN lifetime.
 *
 * No database import: the policy is an argument, so this module can be rendered by DB-less tests.
 */
import { ssrHtmlShell } from "../ssrShared";
import { pictureHtml } from "./picture";
import {
  PARTNER_AGENT_CARD,
  PARTNER_AGENT_JOURNEY,
  PARTNER_COMPARISON_ROWS,
  PARTNER_COMPENSATION_BASE,
  PARTNER_FAQ_IDS,
  PARTNER_HUB_HERO,
  PARTNER_HUB_SECTIONS,
  PARTNER_JOURNEY_SECTIONS,
  PARTNER_PATH_LABEL,
  PARTNER_PROCESS_STEPS,
  PARTNER_PROFESSION_SECTIONS,
  PARTNER_PROFESSIONS,
  PARTNER_REFERRAL_CARD,
  PARTNER_REFERRAL_JOURNEY,
  PARTNER_REVIEW_DISCLOSURE,
  PARTNER_ROUTES,
  buildPartnerFaqJsonLd,
  partnerReferralCardBody,
  referralCompensationSentence,
  selectPartnerFaqs,
  type PartnerFaq,
  type PartnerReferralPolicy,
} from "@shared/partner-public-content";
import { PARTNER_PROFESSION_PAGES, PARTNER_PROFESSION_PAGE_IDS } from "@shared/partner-profession-content";
import { PARTNER_PAGE_SEO, isPartnerSsrRoute, type PartnerPageSeo, type PartnerSsrRoute } from "@shared/partner-page-seo";
import { PARTNER_MEDIA_CAPTION, partnerMediaFor, partnerMediaObjectPosition, type PartnerMediaRole } from "@shared/partner-page-media";
import { PARTNER_RESIDUAL_COPY, PARTNER_RESIDUAL_DEFAULTS, PARTNER_RESIDUAL_BPS, formatPartnerResidualUsd, illustratePartnerResidual, parsePartnerResidualField } from "@shared/partner-residual-calculator";
import { partnerLink } from "@shared/partner-application";
import { AFFILIATE_PAGE } from "@shared/public-affiliate";

const BASE_URL = "https://libertybancard.com";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Tone = "canvas" | "warm" | "light" | "ink";

export function partnerSection(tone: Tone, id: string | null, label: string, inner: string, extra = ""): string {
  return `
  <section class="ssr-section ssr-section-${tone}${extra ? ` ${extra}` : ""}"${id ? ` id="${id}"` : ""} aria-labelledby="${label}">
    <div class="ssr-section-inner">
${inner}
    </div>
  </section>`;
}

export function partnerHeading(id: string, title: string, description?: string): string {
  return `      <h2 class="ssr-section-heading" id="${id}">${esc(title)}</h2>${description ? `\n      <p class="ssr-section-subheading">${esc(description)}</p>` : ""}`;
}

function mediaFigure(route: string, role: PartnerMediaRole): string {
  const entry = partnerMediaFor(route, role);
  const picture = pictureHtml({
    id: entry.imageId as Parameters<typeof pictureHtml>[0]["id"],
    variant: entry.variant,
    sizes: entry.sizes,
    alt: entry.alt,
    priority: entry.priority,
  });
  return `<figure class="ssr-partner-media ssr-partner-media--${role}" data-partner-media="${role}" data-partner-media-route="${esc(route)}">
          <div class="ssr-frame" style="--partner-focal:${esc(partnerMediaObjectPosition(entry))}">${picture}</div>
          <figcaption>${esc(PARTNER_MEDIA_CAPTION)}</figcaption>
        </figure>`;
}

export interface PartnerHeroModel {
  eyebrow: string;
  heading: string;
  body: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
  tertiary?: { label: string; href: string };
}

export function partnerHeroHtml(route: string, hero: PartnerHeroModel): string {
  return `
  <section class="ssr-hero ssr-hero--light ssr-hero--home ssr-hero--partner" data-partner-hero="${esc(route)}">
    <div class="ssr-hero-inner">
      <div class="ssr-hero-copy">
        <div class="ssr-hero-badge">${esc(hero.eyebrow)}</div>
        <h1>${esc(hero.heading)}</h1>
        <p class="ssr-hero-subtitle">${esc(hero.body)}</p>
        <div class="ssr-hero-buttons">
          <a href="${esc(hero.primary.href)}" class="ssr-btn-dark">${esc(hero.primary.label)}</a>${hero.secondary ? `
          <a href="${esc(hero.secondary.href)}" class="ssr-btn-outline">${esc(hero.secondary.label)}</a>` : ""}${hero.tertiary ? `
          <a href="${esc(hero.tertiary.href)}" class="ssr-btn-outline">${esc(hero.tertiary.label)}</a>` : ""}
        </div>
      </div>
      <div class="ssr-hero-media">
        ${mediaFigure(route, "hero")}
      </div>
    </div>
  </section>`;
}

function faqSection(tone: Tone, id: string, title: string, faqs: readonly PartnerFaq[]): string {
  return partnerSection(tone, null, id, `${partnerHeading(id, title)}
      <div class="ssr-faq-wrapper" data-partner-faq>
${faqs.map((faq) => `        <div class="ssr-faq-item"><div class="ssr-faq-q">${esc(faq.question)}</div><div class="ssr-faq-a">${esc(faq.answer)}</div></div>`).join("\n")}
      </div>`);
}

function stepsList(steps: readonly { title: string; body: string }[], cols: 3 | 4): string {
  return `      <ol class="ssr-steps ssr-steps--cols ssr-steps--cols-${cols}" data-partner-steps>
${steps.map((step, index) => `        <li><span class="ssr-step-num" aria-hidden="true">${index + 1}</span><div><div class="ssr-step-title">${esc(step.title)}</div><div class="ssr-card-text ssr-step-body">${esc(step.body)}</div></div></li>`).join("\n")}
      </ol>`;
}

function pathCards(policy: PartnerReferralPolicy, id: string): string {
  const card = (label: string, title: string, body: string, items: readonly string[], cta: string, href: string, primary: boolean) => `        <li class="ssr-card" data-partner-card>
          <div class="ssr-hero-badge" style="margin-bottom:0.5rem">${esc(label)}</div>
          <div class="ssr-card-title">${esc(title)}</div>
          <div class="ssr-card-text" style="margin-bottom:1rem">${esc(body)}</div>
          <ul class="ssr-list" style="margin-bottom:1.25rem">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
          <a href="${esc(href)}" class="${primary ? "ssr-btn-dark" : "ssr-btn-on-light"}">${esc(cta)}</a>
        </li>`;
  return `      <ul class="ssr-partner-split" style="list-style:none;margin:0;padding:0" aria-labelledby="${id}" data-partner-path-cards>
${card(PARTNER_PATH_LABEL.referral, PARTNER_REFERRAL_CARD.title, partnerReferralCardBody(policy), PARTNER_REFERRAL_CARD.responsibilities, PARTNER_REFERRAL_CARD.cta, PARTNER_ROUTES.referral, true)}
${card(PARTNER_PATH_LABEL.sales_agent, PARTNER_AGENT_CARD.title, PARTNER_AGENT_CARD.body, PARTNER_AGENT_CARD.responsibilities, PARTNER_AGENT_CARD.cta, PARTNER_ROUTES.salesAgent, false)}
      </ul>`;
}

function comparisonTable(id: string): string {
  return `      <div class="ssr-table-wrapper" data-partner-comparison>
        <table class="ssr-table" aria-labelledby="${id}">
          <thead><tr><th scope="col">&nbsp;</th><th scope="col">${esc(PARTNER_PATH_LABEL.referral)}</th><th scope="col">${esc(PARTNER_PATH_LABEL.sales_agent)}</th></tr></thead>
          <tbody>
${PARTNER_COMPARISON_ROWS.map((row) => `            <tr><th scope="row">${esc(row.attribute)}</th><td>${esc(row.referral)}</td><td>${esc(row.salesAgent)}</td></tr>`).join("\n")}
          </tbody>
        </table>
      </div>`;
}

/** The calculator's first render: same shared arithmetic, same defaults, same gate as the React component. */
function calculatorHtml(tone: Tone, policy: PartnerReferralPolicy, id: string, title: string, description: string): string {
  const illustration = illustratePartnerResidual({
    path: PARTNER_RESIDUAL_DEFAULTS.path,
    merchants: parsePartnerResidualField("merchants", PARTNER_RESIDUAL_DEFAULTS.merchants),
    avgMonthlyVolume: parsePartnerResidualField("avgMonthlyVolume", PARTNER_RESIDUAL_DEFAULTS.avgMonthlyVolume),
    bps: PARTNER_RESIDUAL_BPS.default,
    policy,
  });
  const result = illustration.kind === "amount"
    ? `<div class="ssr-calc-result" data-partner-calculator-result="amount">
          <div class="ssr-card-text">${esc(PARTNER_RESIDUAL_COPY.monthlyLabel)}</div>
          <div class="ssr-calc-figure">${esc(formatPartnerResidualUsd(illustration.monthly))}</div>
          <div class="ssr-card-text">${esc(PARTNER_RESIDUAL_COPY.annualLabel)}</div>
          <div class="ssr-calc-figure">${esc(formatPartnerResidualUsd(illustration.annualized))}</div>
        </div>`
    : `<div class="ssr-calc-result" data-partner-calculator-result="gated"><p>${esc(PARTNER_RESIDUAL_COPY.gated)}</p></div>`;
  return partnerSection(tone, "calculator", id, `${partnerHeading(id, title, description)}
      <div data-partner-calculator>
        <p class="ssr-card-text" style="margin-bottom:1rem">${esc(PARTNER_RESIDUAL_COPY.heading)} Assumptions: ${esc(PARTNER_RESIDUAL_DEFAULTS.merchants)} active merchants, ${esc(formatPartnerResidualUsd(Number(PARTNER_RESIDUAL_DEFAULTS.avgMonthlyVolume)))} average monthly card volume each, ${PARTNER_RESIDUAL_BPS.default} bps. Hypothetical results from the assumptions you choose.</p>
        ${result}
        <p class="ssr-note">${esc(PARTNER_RESIDUAL_COPY.formula)}</p>
        <p class="ssr-note">${esc(PARTNER_RESIDUAL_COPY.disclosure)}</p>
      </div>`);
}

function disclosure(): string {
  return `      <p class="ssr-note" data-partner-review-disclosure>${esc(PARTNER_REVIEW_DISCLOSURE)}</p>`;
}

function applySection(tone: Tone, id: string, title: string, description: string, extra: string): string {
  return partnerSection(tone, "apply", id, `${partnerHeading(id, title, description)}
${extra}
      <noscript><p class="ssr-note">The application form needs JavaScript. If you cannot use it, contact Liberty Bancard and mention that you want to apply as a partner.</p></noscript>`, "ssr-section-start");
}

function schemaFor(seo: PartnerPageSeo, faqs: readonly PartnerFaq[]): object[] {
  const url = `${BASE_URL}${seo.route}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: seo.name,
      description: seo.description,
      url,
      isPartOf: { "@type": "WebSite", name: "Liberty Bancard", url: BASE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
        ...(seo.route === PARTNER_ROUTES.hub ? [] : [{ "@type": "ListItem", position: 2, name: "Partnerships", item: `${BASE_URL}${PARTNER_ROUTES.hub}` }]),
        { "@type": "ListItem", position: seo.route === PARTNER_ROUTES.hub ? 2 : 3, name: seo.name, item: url },
      ],
    },
    buildPartnerFaqJsonLd(faqs),
  ];
}

// ── Pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function hubBody(policy: PartnerReferralPolicy, faqs: readonly PartnerFaq[]): string {
  return [
    partnerHeroHtml(PARTNER_ROUTES.hub, {
      eyebrow: PARTNER_HUB_HERO.eyebrow,
      heading: PARTNER_HUB_HERO.heading,
      body: PARTNER_HUB_HERO.body,
      primary: { label: PARTNER_HUB_HERO.primaryCta, href: PARTNER_ROUTES.referral },
      secondary: { label: PARTNER_HUB_HERO.secondaryCta, href: PARTNER_ROUTES.salesAgent },
      tertiary: { label: PARTNER_HUB_HERO.signIn, href: PARTNER_ROUTES.login },
    }),
    partnerSection("canvas", null, "partner-paths-heading", `      <div class="ssr-partner-lead" data-partner-paths-lead>
        <div>
${partnerHeading("partner-paths-heading", PARTNER_HUB_SECTIONS.paths.heading, PARTNER_HUB_SECTIONS.paths.description)}
        </div>
        ${mediaFigure(PARTNER_ROUTES.hub, "body")}
      </div>
${pathCards(policy, "partner-paths-heading")}`, "ssr-section-start"),
    partnerSection("light", null, "partner-compare-heading", `${partnerHeading("partner-compare-heading", PARTNER_HUB_SECTIONS.compare.heading, PARTNER_HUB_SECTIONS.compare.description)}
${comparisonTable("partner-compare-heading")}`),
    partnerSection("ink", null, "partner-process-heading", `${partnerHeading("partner-process-heading", PARTNER_HUB_SECTIONS.process.heading, PARTNER_HUB_SECTIONS.process.description)}
${stepsList(PARTNER_PROCESS_STEPS, 4)}`),
    calculatorHtml("canvas", policy, "partner-calculator-heading", PARTNER_HUB_SECTIONS.calculator.heading, PARTNER_HUB_SECTIONS.calculator.description),
    faqSection("light", "partner-faq-heading", PARTNER_HUB_SECTIONS.faq.heading, faqs),
    partnerSection("warm", "apply", "partner-apply-heading", `${partnerHeading("partner-apply-heading", PARTNER_HUB_SECTIONS.choose.heading, PARTNER_HUB_SECTIONS.choose.description)}
      <div class="ssr-btn-row">
        <a href="${PARTNER_ROUTES.referral}" class="ssr-btn-dark">${esc(PARTNER_HUB_SECTIONS.choose.referralCta)}</a>
        <a href="${PARTNER_ROUTES.salesAgent}" class="ssr-btn-on-light">${esc(PARTNER_HUB_SECTIONS.choose.agentCta)}</a>
        <a href="${PARTNER_ROUTES.login}" class="ssr-btn-on-light">${esc(PARTNER_HUB_HERO.signIn)}</a>
      </div>
${disclosure()}`, "ssr-section-start ssr-section-compact"),
  ].join("\n");
}

function twoLists(leftTitle: string, left: readonly string[], rightTitle: string, right: readonly string[]): string {
  const panel = (title: string, items: readonly string[]) => `        <li class="ssr-card"><div class="ssr-card-title">${esc(title)}</div><ul class="ssr-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></li>`;
  return `      <ul class="ssr-partner-split" style="list-style:none;margin:0;padding:0">
${panel(leftTitle, left)}
${panel(rightTitle, right)}
      </ul>`;
}

function referralBody(policy: PartnerReferralPolicy, faqs: readonly PartnerFaq[]): string {
  const journey = PARTNER_REFERRAL_JOURNEY;
  const professions = PARTNER_PROFESSIONS.filter((p) => p.id !== "referral");
  const pageFor: Record<string, string> = { cpa: PARTNER_ROUTES.cpa, bookkeeper: PARTNER_ROUTES.bookkeeper, insurance: PARTNER_ROUTES.insurance };
  return [
    partnerHeroHtml(PARTNER_ROUTES.referral, {
      eyebrow: PARTNER_PATH_LABEL.referral,
      heading: journey.heading,
      body: journey.body,
      primary: { label: journey.applyCta, href: "#apply" },
      secondary: { label: journey.otherPathLink, href: PARTNER_ROUTES.salesAgent },
    }),
    partnerSection("canvas", null, "partner-who-heading", `${partnerHeading("partner-who-heading", PARTNER_JOURNEY_SECTIONS.who.heading, PARTNER_JOURNEY_SECTIONS.who.description)}
      <ul class="ssr-chip-list" data-partner-profession-list>${professions.map((p) => `<li>${pageFor[p.id] ? `<a href="${pageFor[p.id]}">${esc(p.label)}</a>` : esc(p.label)}</li>`).join("")}</ul>`, "ssr-section-start"),
    partnerSection("warm", null, "partner-roles-heading", `${partnerHeading("partner-roles-heading", PARTNER_JOURNEY_SECTIONS.rolesReferral.heading)}
${twoLists("What you do", journey.youDo, "What Liberty does", journey.libertyDoes)}
      <p class="ssr-card-text" style="margin-top:1.5rem" data-partner-referral-compensation>${esc(referralCompensationSentence(policy))}</p>`, "ssr-section-start"),
    partnerSection("ink", null, "partner-steps-heading", `${partnerHeading("partner-steps-heading", PARTNER_JOURNEY_SECTIONS.steps.heading)}
${stepsList(journey.steps, 3)}`, "ssr-section-start"),
    applySection("light", "partner-application-heading", journey.formHeading, PARTNER_JOURNEY_SECTIONS.applicationDescription, disclosure()),
    faqSection("warm", "partner-journey-faq-heading", PARTNER_JOURNEY_SECTIONS.faq.heading, faqs),
  ].join("\n");
}

function agentBody(faqs: readonly PartnerFaq[]): string {
  const journey = PARTNER_AGENT_JOURNEY;
  return [
    partnerHeroHtml(PARTNER_ROUTES.salesAgent, {
      eyebrow: PARTNER_PATH_LABEL.sales_agent,
      heading: journey.heading,
      body: journey.body,
      primary: { label: journey.applyCta, href: "#apply" },
      secondary: { label: journey.otherPathLink, href: PARTNER_ROUTES.referral },
    }),
    partnerSection("canvas", null, "partner-roles-heading", `${partnerHeading("partner-roles-heading", PARTNER_JOURNEY_SECTIONS.rolesAgent.heading)}
${twoLists("What you do", journey.responsibilities, "What Liberty supports", journey.libertySupport)}`, "ssr-section-start"),
    partnerSection("ink", null, "partner-steps-heading", `${partnerHeading("partner-steps-heading", PARTNER_JOURNEY_SECTIONS.steps.heading)}
      <p class="ssr-card-text" style="margin-bottom:1.5rem;max-width:48rem" data-partner-agent-qualification>${esc(journey.qualification)}</p>
${stepsList(journey.steps, 3)}`, "ssr-section-start"),
    applySection("light", "partner-application-heading", journey.formHeading, PARTNER_JOURNEY_SECTIONS.applicationDescription, disclosure()),
    faqSection("warm", "partner-journey-faq-heading", PARTNER_JOURNEY_SECTIONS.faq.heading, faqs),
  ].join("\n");
}

function professionBody(route: string, policy: PartnerReferralPolicy, faqs: readonly PartnerFaq[]): string {
  const id = PARTNER_PROFESSION_PAGE_IDS.find((pid) => PARTNER_PROFESSION_PAGES[pid].route === route);
  if (!id) throw new Error(`No profession page for ${route}`);
  const content = PARTNER_PROFESSION_PAGES[id];
  const applyHref = partnerLink(PARTNER_ROUTES.referral, { profession: content.profession, hash: "apply" });
  return [
    partnerHeroHtml(route, {
      eyebrow: content.badge,
      heading: content.heading,
      body: content.body,
      primary: { label: content.applyCta, href: applyHref },
      secondary: { label: "Compare partnership paths", href: PARTNER_ROUTES.hub },
    }),
    partnerSection("canvas", null, "partner-profession-context-heading", `      <div class="ssr-partner-split">
        <div>
${partnerHeading("partner-profession-context-heading", content.contextHeading)}
${content.contextParagraphs.map((p) => `          <p class="ssr-card-text" style="margin-bottom:1rem">${esc(p)}</p>`).join("\n")}
          <ul class="ssr-list">${content.contextPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        </div>
        <div>
          ${mediaFigure(route, "body")}
          <div class="ssr-card" style="margin-top:1.5rem" data-partner-profession-referral-card>
            <div class="ssr-hero-badge" style="margin-bottom:0.5rem">${esc(PARTNER_PATH_LABEL.referral)}</div>
            <div class="ssr-card-title">${esc(PARTNER_REFERRAL_CARD.title)}</div>
            <div class="ssr-card-text" style="margin-bottom:0.75rem">${esc(partnerReferralCardBody(policy))}</div>
            <ul class="ssr-list">${PARTNER_REFERRAL_CARD.responsibilities.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
            <p class="ssr-note" data-partner-compensation-base>${esc(PARTNER_COMPENSATION_BASE)}</p>
          </div>
        </div>
      </div>`, "ssr-section-start"),
    calculatorHtml("light", policy, "partner-profession-calc-heading", PARTNER_PROFESSION_SECTIONS.calculator.heading, PARTNER_PROFESSION_SECTIONS.calculator.description),
    partnerSection("ink", null, "partner-profession-cta-heading", `${partnerHeading("partner-profession-cta-heading", PARTNER_PROFESSION_SECTIONS.next.heading, PARTNER_PROFESSION_SECTIONS.next.description)}
      <div class="ssr-btn-row"><a href="${esc(applyHref)}" class="ssr-btn-on-ink">${esc(content.applyCta)}</a></div>`, "ssr-section-start ssr-section-compact"),
    faqSection("canvas", "partner-profession-faq-heading", PARTNER_PROFESSION_SECTIONS.faq.heading, faqs),
  ].join("\n");
}

/** FAQ ids a route renders, in the shared order. The profession pages add their own questions first. */
export function partnerRouteFaqs(route: PartnerSsrRoute, policy: PartnerReferralPolicy): readonly PartnerFaq[] {
  if (route === PARTNER_ROUTES.hub) return selectPartnerFaqs(policy);
  if (route === PARTNER_ROUTES.referral) return selectPartnerFaqs(policy, PARTNER_FAQ_IDS.referral);
  if (route === PARTNER_ROUTES.salesAgent) return selectPartnerFaqs(policy, PARTNER_FAQ_IDS.salesAgent);
  const id = PARTNER_PROFESSION_PAGE_IDS.find((pid) => PARTNER_PROFESSION_PAGES[pid].route === route);
  if (!id) throw new Error(`No FAQ set for ${route}`);
  return [...PARTNER_PROFESSION_PAGES[id].faqs, ...selectPartnerFaqs(policy, PARTNER_FAQ_IDS.profession)];
}

/** The complete HTML document of one partnership route, for the given published-policy projection. */
export function getPartnerPageHtml(route: string, policy: PartnerReferralPolicy): string {
  if (!isPartnerSsrRoute(route)) throw new Error(`${route} is not a server-rendered partnership route`);
  const seo = PARTNER_PAGE_SEO[route];
  const faqs = partnerRouteFaqs(route, policy);
  let body: string;
  if (route === PARTNER_ROUTES.hub) body = hubBody(policy, faqs);
  else if (route === PARTNER_ROUTES.referral) body = referralBody(policy, faqs);
  else if (route === PARTNER_ROUTES.salesAgent) body = agentBody(faqs);
  else body = professionBody(route, policy, faqs);
  return ssrHtmlShell({
    title: seo.title,
    description: seo.description,
    canonical: seo.route,
    keywords: seo.keywords,
    schemaJsons: schemaFor(seo, faqs),
    body,
  });
}

/**
 * /affiliate: the entry for people who already have an affiliate account. Photographic hero with the sign-in path, the three
 * account points, and a brief navy band that sends new applicants to the referral-partner application. It states no
 * compensation figure, so unlike the six routes above it does not depend on the published-policy projection.
 */
export function getAffiliatePageHtml(): string {
  const route = PARTNER_ROUTES.affiliate;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: AFFILIATE_PAGE.title,
    description: AFFILIATE_PAGE.description,
    url: `${BASE_URL}${route}`,
  };
  const points = [
    ["Your link keeps working", "Existing affiliate links, codes and history are unchanged. Sign in to reach your dashboard."],
    ["You introduce, Liberty sells", "Our team handles the statement review, the sales conversation and onboarding."],
    ["Terms in writing", "Compensation is set in your written agreement, not on this page."],
  ] as const;
  const body = [
    partnerHeroHtml(route, {
      eyebrow: "Affiliate and referral accounts",
      heading: AFFILIATE_PAGE.heading,
      body: AFFILIATE_PAGE.intro,
      primary: { label: "Apply as a referral partner", href: `${PARTNER_ROUTES.referral}#apply` },
      secondary: { label: "Affiliate login", href: "#affiliate-account" },
    }),
    partnerSection("canvas", "affiliate-account", "affiliate-account-heading", `${partnerHeading("affiliate-account-heading", "Already an affiliate? Nothing changes for you.", "Your account, referral link and history stay exactly as they are. Sign in to reach your dashboard.")}
      <div class="ssr-grid-3">
${points.map(([title, text]) => `        <div class="ssr-card"><div class="ssr-card-title">${esc(title)}</div><div class="ssr-card-text">${esc(text)}</div></div>`).join("\n")}
      </div>`),
    partnerSection("ink", null, "affiliate-cta-heading", `${partnerHeading("affiliate-cta-heading", "Ready to apply?", "Your application is reviewed by Liberty Bancard. We confirm terms in writing before any work begins.")}
      <div class="ssr-btn-row">
        <a href="${PARTNER_ROUTES.referral}#apply" class="ssr-btn-on-ink">Apply as a referral partner</a>
        <a href="${PARTNER_ROUTES.hub}" class="ssr-btn-outline">Compare partnership paths</a>
      </div>`, "ssr-section-start ssr-section-compact"),
  ].join("\n");
  return ssrHtmlShell({
    title: AFFILIATE_PAGE.title,
    description: AFFILIATE_PAGE.description,
    canonical: route,
    keywords: "affiliate account, referral partner, payment processing referral",
    schemaJsons: [schema],
    body,
  });
}
