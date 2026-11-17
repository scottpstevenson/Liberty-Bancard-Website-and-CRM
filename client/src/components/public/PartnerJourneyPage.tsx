import type { ReactNode } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PartnerApplicationForm } from "@/components/public/PartnerApplicationForm";
import {
  PartnerFaqList,
  PartnerReviewDisclosure,
  partnerFaqJsonLd,
  selectedPartnerFaqs,
} from "@/components/public/PartnerPageSections";
import { usePartnerReferralPolicy } from "@/hooks/use-partner-policy";
import {
  PARTNER_AGENT_JOURNEY,
  PARTNER_PATH_LABEL,
  PARTNER_PATH_ROUTE,
  PARTNER_PROFESSIONS,
  PARTNER_REFERRAL_JOURNEY,
  PARTNER_ROUTES,
  referralCompensationSentence,
  type PartnerPathId,
} from "@shared/partner-public-content";
import { trackPartnerEvent } from "@/lib/tracking";

const REFERRAL_FAQ_IDS = ["difference", "referral-compensation", "permission", "continuing", "timing", "account", "existing"] as const;
const AGENT_FAQ_IDS = ["difference", "base", "agent-all-deals", "continuing", "timing", "account", "existing"] as const;

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

function Steps({ steps }: { steps: readonly { title: string; body: string }[] }) {
  return (
    <ol className="grid grid-cols-1 gap-6 md:grid-cols-3" data-testid="partner-journey-steps">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4 md:block">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground md:mb-3" aria-hidden="true">{index + 1}</span>
          <div>
            <h3 className="public-card-title mb-1 text-foreground">{step.title}</h3>
            <p className="public-small text-muted-foreground">{step.body}</p>
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
  const faqIds = isReferral ? REFERRAL_FAQ_IDS : AGENT_FAQ_IDS;
  const faqs = selectedPartnerFaqs(policy, faqIds);
  const sourcePage = PARTNER_PATH_ROUTE[path];
  const seo = isReferral
    ? { title: "Referral Partner Program | Liberty Bancard", description: "Introduce businesses that agreed to hear from Liberty Bancard. Our team handles the sales, onboarding and support. Apply as a referral partner.", keywords: "referral partner, payment processing referral" }
    : { title: "Become a Sales Agent | Liberty Bancard", description: "Build your own merchant portfolio with Liberty Bancard. Prospect, guide the sale and coordinate onboarding with our team. Apply as a sales agent.", keywords: "merchant services sales agent, payment processing agent" };

  const comparisonLine: ReactNode = (
    <p className="public-small text-muted-foreground" data-testid="partner-journey-selected-path">
      Applying as: <strong className="text-foreground">{PARTNER_PATH_LABEL[path]}</strong>.{" "}
      <Link href={PARTNER_PATH_ROUTE[otherPath]} className="underline" data-testid="partner-journey-other-path-inline">
        Looking for the {PARTNER_PATH_LABEL[otherPath].toLowerCase()} path instead?
      </Link>
    </p>
  );

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title={seo.title} description={seo.description} path={sourcePage} keywords={seo.keywords} structuredData={[partnerFaqJsonLd(faqs)]} />
      <Navbar />
      <main className="marketing-surface flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">{PARTNER_PATH_LABEL[path]}</span>}
          headline={journey.heading}
          subheadline={journey.body}
          primaryCta={{ label: journey.applyCta, href: "#apply", onClick: () => trackPartnerEvent("partner_path_selected", { path, source_page: sourcePage }) }}
          secondaryCta={{ label: journey.otherPathLink, href: PARTNER_PATH_ROUTE[otherPath] }}
          data-testid={`section-partner-${path}-hero`}
        />

        {isReferral ? (
          <PublicSection labelledBy="partner-who-heading" data-testid="section-partner-who">
            <PublicSectionHeader id="partner-who-heading" title="Who this is for." description="People who work closely with business owners. Listing a profession here is not an endorsement of anyone." />
            <ul className="flex flex-wrap gap-2" data-testid="partner-profession-list">
              {PARTNER_PROFESSIONS.filter((p) => p.id !== "referral").map((profession) => {
                const page = PROFESSION_PAGES[profession.id];
                return (
                  <li key={profession.id} className="rounded-full border border-border px-4 text-sm text-foreground">
                    {page ? <Link href={page} className="inline-flex min-h-11 items-center underline">{profession.label}</Link> : <span className="inline-flex min-h-11 items-center">{profession.label}</span>}
                  </li>
                );
              })}
            </ul>
          </PublicSection>
        ) : null}

        <PublicSection tone="warm" labelledBy="partner-roles-heading" data-testid="section-partner-roles">
          <PublicSectionHeader id="partner-roles-heading" title={isReferral ? "Who does what." : "What the work involves."} />
          {isReferral ? (
            <TwoPanels leftTitle="What you do" left={PARTNER_REFERRAL_JOURNEY.youDo} rightTitle="What Liberty does" right={PARTNER_REFERRAL_JOURNEY.libertyDoes} />
          ) : (
            <>
              <TwoPanels leftTitle="What you do" left={PARTNER_AGENT_JOURNEY.responsibilities} rightTitle="What Liberty supports" right={PARTNER_AGENT_JOURNEY.libertySupport} />
              <p className="public-body public-secondary mt-6 max-w-3xl" data-testid="partner-agent-qualification">{PARTNER_AGENT_JOURNEY.qualification}</p>
            </>
          )}
          {isReferral ? <p className="public-body public-secondary mt-6 max-w-3xl" data-testid="partner-referral-compensation">{referralCompensationSentence(policy)}</p> : null}
        </PublicSection>

        <PublicSection labelledBy="partner-steps-heading" data-testid="section-partner-steps">
          <PublicSectionHeader id="partner-steps-heading" title="What happens next." />
          <Steps steps={journey.steps} />
        </PublicSection>

        <PublicSection tone="warm" id="apply" labelledBy="partner-application-heading" data-testid="section-partner-application">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <PublicSectionHeader id="partner-application-heading" title={journey.formHeading} description="Your application is reviewed by Liberty Bancard. If it moves forward we confirm terms in writing before any work begins. We do not promise a response time or any earnings." />
              {comparisonLine}
              <div className="mt-4"><PartnerReviewDisclosure /></div>
            </div>
            <div className="public-card p-6 md:p-8 lg:col-span-7" data-testid={`partner-${path}-application-surface`}>
              <PartnerApplicationForm path={path} sourcePage={sourcePage} initialProfession={initialProfession} />
            </div>
          </div>
        </PublicSection>

        <PublicSection labelledBy="partner-journey-faq-heading" data-testid="section-partner-journey-faq">
          <PublicSectionHeader id="partner-journey-faq-heading" title="Common questions." />
          <PartnerFaqList faqs={faqs} testId={`partner-${path}-faq`} />
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
