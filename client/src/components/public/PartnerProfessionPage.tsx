import { Link } from "wouter";
import { CheckCircle } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PartnerResidualCalculator } from "@/components/public/PartnerResidualCalculator";
import {
  PartnerFaqList,
  PartnerReviewDisclosure,
  partnerFaqJsonLd,
  selectedPartnerFaqs,
} from "@/components/public/PartnerPageSections";
import { usePartnerReferralPolicy } from "@/hooks/use-partner-policy";
import { PARTNER_PROFESSION_PAGES, type PartnerProfessionPageId } from "@shared/partner-profession-content";
import {
  PARTNER_COMPENSATION_BASE,
  PARTNER_PATH_LABEL,
  PARTNER_ROUTES,
  PARTNER_REFERRAL_CARD,
  partnerReferralCardBody,
} from "@shared/partner-public-content";
import { partnerLink, pickPartnerAttribution } from "@shared/partner-application";
import { trackPartnerEvent } from "@/lib/tracking";

const SHARED_FAQ_IDS = ["referral-compensation", "permission", "calculator", "account", "existing"] as const;

/**
 * One profession landing page, parameterized by content. It carries no form handler and no commercial figure of its
 * own: the application is the canonical referral page (with the profession and allowlisted attribution carried in the
 * link), and compensation wording and the example come from the shared policy projection.
 */
export function PartnerProfessionPage({ id }: { id: PartnerProfessionPageId }) {
  const content = PARTNER_PROFESSION_PAGES[id];
  const { policy } = usePartnerReferralPolicy();
  const search = typeof window === "undefined" ? "" : window.location.search;
  const applyHref = partnerLink(PARTNER_ROUTES.referral, {
    attribution: pickPartnerAttribution(new URLSearchParams(search)),
    profession: content.profession,
    hash: "apply",
  });
  const faqs = [...content.faqs, ...selectedPartnerFaqs(policy, SHARED_FAQ_IDS)];
  const onApply = () => trackPartnerEvent("partner_path_selected", { path: "referral", profession: content.profession, source_page: content.route });

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title={content.seo.title} description={content.seo.description} path={content.route} keywords={content.seo.keywords} structuredData={[partnerFaqJsonLd(faqs)]} />
      <Navbar />
      <main className="marketing-surface flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">{content.badge}</span>}
          headline={content.heading}
          subheadline={content.body}
          primaryCta={{ label: content.applyCta, href: applyHref, onClick: onApply }}
          secondaryCta={{ label: "Compare partnership paths", href: PARTNER_ROUTES.hub }}
          data-testid={`section-partner-${id}-hero`}
        />

        <PublicSection labelledBy="partner-profession-context-heading" data-testid={`section-partner-${id}-context`}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <div>
              <PublicSectionHeader id="partner-profession-context-heading" title={content.contextHeading} />
              {content.contextParagraphs.map((paragraph) => <p key={paragraph} className="public-body public-secondary mb-4">{paragraph}</p>)}
              <ul className="space-y-3">
                {content.contextPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                    <span className="text-sm text-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <section className="public-card p-6 md:p-8" aria-labelledby="partner-profession-card-heading" data-testid="partner-profession-referral-card">
              <p className="public-eyebrow mb-1">{PARTNER_PATH_LABEL.referral}</p>
              <h2 id="partner-profession-card-heading" className="public-h3 mb-3 text-foreground">{PARTNER_REFERRAL_CARD.title}</h2>
              <p className="public-body public-secondary mb-4">{partnerReferralCardBody(policy)}</p>
              <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-foreground">
                {PARTNER_REFERRAL_CARD.responsibilities.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="public-small text-muted-foreground" data-testid="partner-compensation-base">{PARTNER_COMPENSATION_BASE}</p>
            </section>
          </div>
        </PublicSection>

        <PublicSection tone="warm" id="calculator" labelledBy="partner-profession-calc-heading" data-testid={`section-partner-${id}-calculator`}>
          <PublicSectionHeader id="partner-profession-calc-heading" title="See how a portfolio could add up." description="An illustration with assumptions you choose. It is not a quote, an average or a promise of earnings." />
          <PartnerResidualCalculator policy={policy} initialPath="referral" headingLevel="h3" />
          <div className="mt-6"><PartnerReviewDisclosure /></div>
        </PublicSection>

        <PublicSection labelledBy="partner-profession-faq-heading" data-testid={`section-partner-${id}-faq`}>
          <PublicSectionHeader id="partner-profession-faq-heading" title="Common questions." />
          <PartnerFaqList faqs={faqs} testId={`partner-${id}-faq`} />
        </PublicSection>

        <PublicSection tone="warm" labelledBy="partner-profession-cta-heading" data-testid={`section-partner-${id}-cta`}>
          <PublicSectionHeader id="partner-profession-cta-heading" title="Ready to apply?" description="The application is short, needs no password and creates no account." />
          <Button asChild className="min-h-11">
            <Link href={applyHref} onClick={onApply} data-testid={`button-partner-${id}-apply`}>{content.applyCta}</Link>
          </Button>
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
