import type { ReactNode } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PartnerApplicationForm } from "@/components/public/PartnerApplicationForm";
import { PartnerMedia } from "@/components/public/PartnerHeroMedia";
import {
  PartnerFaqList,
  PartnerReviewDisclosure,
  partnerFaqJsonLd,
  selectedPartnerFaqs,
} from "@/components/public/PartnerPageSections";
import { usePartnerReferralPolicy } from "@/hooks/use-partner-policy";
import {
  PARTNER_AGENT_JOURNEY,
  PARTNER_FAQ_IDS,
  PARTNER_JOURNEY_SECTIONS,
  PARTNER_PATH_LABEL,
  PARTNER_PATH_ROUTE,
  PARTNER_PROFESSIONS,
  PARTNER_REFERRAL_JOURNEY,
  PARTNER_ROUTES,
  referralCompensationSentence,
  type PartnerPathId,
} from "@shared/partner-public-content";
import { PARTNER_PAGE_SEO } from "@shared/partner-page-seo";
import { trackPartnerEvent } from "@/lib/tracking";
import { partnerRouteWithAttribution } from "@/lib/partner-application-client";

const PROFESSION_PAGES: Record<string, string> = {
  cpa: PARTNER_ROUTES.cpa,
  bookkeeper: PARTNER_ROUTES.bookkeeper,
  insurance: PARTNER_ROUTES.insurance,
};

function TwoPanels({ leftTitle, left, rightTitle, right }: { leftTitle: string; left: readonly string[]; rightTitle: string; right: readonly string[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {[{ title: leftTitle, items: left }, { title: rightTitle, items: right }].map((panel) => (
        <section key={panel.title} className="public-card p-6" aria-label={panel.title}>
          <h3 className="public-card-title mb-3 text-foreground">{panel.title}</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {panel.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Numbered steps on the navy band: white numerals disc, white titles, the band's light secondary text pair. */
function Steps({ steps }: { steps: readonly { title: string; body: string }[] }) {
  return (
    <ol className="grid grid-cols-1 gap-6 md:grid-cols-3" data-testid="partner-journey-steps">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4 md:block">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-base font-bold text-[hsl(var(--liberty-navy))] md:mb-3" aria-hidden="true">{index + 1}</span>
          <div>
            <h3 className="public-card-title mb-1 text-white">{step.title}</h3>
            <p className="public-small public-secondary">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface PartnerJourneyPageProps {
  path: PartnerPathId;
  /** Allowlisted profession preselect (referral only). */
  initialProfession?: string | null;
}

/** Canonical journey for one path: explanation, steps, the application, and a focused FAQ. */
export function PartnerJourneyPage({ path, initialProfession }: PartnerJourneyPageProps) {
  const { policy } = usePartnerReferralPolicy();
  const isReferral = path === "referral";
  const journey = isReferral ? PARTNER_REFERRAL_JOURNEY : PARTNER_AGENT_JOURNEY;
  const otherPath: PartnerPathId = isReferral ? "sales_agent" : "referral";
  const faqIds = isReferral ? PARTNER_FAQ_IDS.referral : PARTNER_FAQ_IDS.salesAgent;
  const faqs = selectedPartnerFaqs(policy, faqIds);
  const sourcePage = PARTNER_PATH_ROUTE[path];
  const seo = PARTNER_PAGE_SEO[sourcePage as keyof typeof PARTNER_PAGE_SEO];

  const comparisonLine: ReactNode = (
    <p className="public-small text-muted-foreground" data-testid="partner-journey-selected-path">
      Applying as: <strong className="text-foreground">{PARTNER_PATH_LABEL[path]}</strong>.{" "}
      <Link href={partnerRouteWithAttribution(PARTNER_PATH_ROUTE[otherPath])} className="underline" data-testid="partner-journey-other-path-inline">
        Looking for the {PARTNER_PATH_LABEL[otherPath].toLowerCase()} path instead?
      </Link>
    </p>
  );

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title={seo.title} brandSuffix={false} description={seo.description} path={sourcePage} keywords={seo.keywords} structuredData={[partnerFaqJsonLd(faqs)]} />
      <Navbar />
      <main className="marketing-surface partner-page flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">{PARTNER_PATH_LABEL[path]}</span>}
          headline={journey.heading}
          subheadline={journey.body}
          primaryCta={{ label: journey.applyCta, href: "#apply", onClick: () => trackPartnerEvent("partner_path_selected", { path, source_page: sourcePage }) }}
          secondaryCta={{ label: journey.otherPathLink, href: partnerRouteWithAttribution(PARTNER_PATH_ROUTE[otherPath]) }}
          media={<PartnerMedia route={sourcePage} />}
          data-testid={`section-partner-${path}-hero`}
        />

        {isReferral ? (
          <PublicSection labelledBy="partner-who-heading" data-testid="section-partner-who">
            <PublicSectionHeader id="partner-who-heading" title={PARTNER_JOURNEY_SECTIONS.who.heading} description={PARTNER_JOURNEY_SECTIONS.who.description} />
            <ul className="flex flex-wrap gap-2" data-testid="partner-profession-list">
              {PARTNER_PROFESSIONS.filter((p) => p.id !== "referral").map((profession) => {
                const page = PROFESSION_PAGES[profession.id];
                return (
                  <li key={profession.id} className="rounded-full border border-border px-4 text-sm text-foreground">
                    {page ? <Link href={partnerRouteWithAttribution(page)} className="inline-flex min-h-11 items-center underline">{profession.label}</Link> : <span className="inline-flex min-h-11 items-center">{profession.label}</span>}
                  </li>
                );
              })}
            </ul>
          </PublicSection>
        ) : null}

        <PublicSection tone={isReferral ? "warm" : "canvas"} labelledBy="partner-roles-heading" data-testid="section-partner-roles">
          <PublicSectionHeader id="partner-roles-heading" title={isReferral ? PARTNER_JOURNEY_SECTIONS.rolesReferral.heading : PARTNER_JOURNEY_SECTIONS.rolesAgent.heading} />
          {isReferral ? (
            <TwoPanels leftTitle="What you do" left={PARTNER_REFERRAL_JOURNEY.youDo} rightTitle="What Liberty does" right={PARTNER_REFERRAL_JOURNEY.libertyDoes} />
          ) : (
            <TwoPanels leftTitle="What you do" left={PARTNER_AGENT_JOURNEY.responsibilities} rightTitle="What Liberty supports" right={PARTNER_AGENT_JOURNEY.libertySupport} />
          )}
          {isReferral ? <p className="public-body public-secondary mt-6 max-w-3xl" data-testid="partner-referral-compensation">{referralCompensationSentence(policy)}</p> : null}
        </PublicSection>

        <PublicSection tone="ink" labelledBy="partner-steps-heading" data-testid="section-partner-steps">
          <PublicSectionHeader id="partner-steps-heading" inverse title={PARTNER_JOURNEY_SECTIONS.steps.heading} />
          {!isReferral ? <p className="public-body public-secondary mb-8 max-w-3xl" data-testid="partner-agent-qualification">{PARTNER_AGENT_JOURNEY.qualification}</p> : null}
          <Steps steps={journey.steps} />
        </PublicSection>

        <PublicSection tone="light" id="apply" labelledBy="partner-application-heading" data-testid="section-partner-application">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <PublicSectionHeader id="partner-application-heading" title={journey.formHeading} description={PARTNER_JOURNEY_SECTIONS.applicationDescription} />
              {comparisonLine}
              <div className="mt-4"><PartnerReviewDisclosure /></div>
            </div>
            <div className="partner-form-surface min-w-0 lg:col-span-7" data-testid={`partner-${path}-application-surface`}>
              <PartnerApplicationForm path={path} sourcePage={sourcePage} initialProfession={initialProfession} />
            </div>
          </div>
        </PublicSection>

        <PublicSection tone="warm" labelledBy="partner-journey-faq-heading" data-testid="section-partner-journey-faq">
          <PublicSectionHeader id="partner-journey-faq-heading" title={PARTNER_JOURNEY_SECTIONS.faq.heading} />
          <PartnerFaqList faqs={faqs} testId={`partner-${path}-faq`} />
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
