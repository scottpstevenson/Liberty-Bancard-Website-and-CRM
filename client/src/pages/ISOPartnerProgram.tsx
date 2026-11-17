import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PartnerResidualCalculator } from "@/components/public/PartnerResidualCalculator";
import { PartnerMedia } from "@/components/public/PartnerHeroMedia";
import {
  PartnerComparison,
  PartnerFaqList,
  PartnerPathCards,
  PartnerProcess,
  PartnerReviewDisclosure,
  partnerFaqJsonLd,
  selectedPartnerFaqs,
} from "@/components/public/PartnerPageSections";
import { Button } from "@/components/ui/button";
import { usePartnerReferralPolicy } from "@/hooks/use-partner-policy";
import { PARTNER_HUB_HERO, PARTNER_HUB_SECTIONS, PARTNER_ROUTES } from "@shared/partner-public-content";
import { PARTNER_PAGE_SEO } from "@shared/partner-page-seo";
import { trackPartnerEvent } from "@/lib/tracking";
import { partnerRouteWithAttribution } from "@/lib/partner-application-client";

const SOURCE_PAGE = PARTNER_ROUTES.hub;
const SEO_RECORD = PARTNER_PAGE_SEO[PARTNER_ROUTES.hub];

/**
 * /partners: the canonical hub for both partnership paths. It holds no application form and creates no account; each
 * path owns its own application page. Referral compensation wording comes only from the published policy projection.
 */
export default function ISOPartnerProgram() {
  const { policy } = usePartnerReferralPolicy();
  const faqs = selectedPartnerFaqs(policy);

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title={SEO_RECORD.title}
        brandSuffix={false}
        description={SEO_RECORD.description}
        path={SEO_RECORD.route}
        keywords={SEO_RECORD.keywords}
        structuredData={[partnerFaqJsonLd(faqs)]}
      />
      <Navbar />
      <main className="marketing-surface partner-page flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">{PARTNER_HUB_HERO.eyebrow}</span>}
          headline={PARTNER_HUB_HERO.heading}
          subheadline={PARTNER_HUB_HERO.body}
          primaryCta={{ label: PARTNER_HUB_HERO.primaryCta, href: partnerRouteWithAttribution(PARTNER_ROUTES.referral), onClick: () => trackPartnerEvent("partner_path_selected", { path: "referral", source_page: SOURCE_PAGE }) }}
          secondaryCta={{ label: PARTNER_HUB_HERO.secondaryCta, href: partnerRouteWithAttribution(PARTNER_ROUTES.salesAgent), onClick: () => trackPartnerEvent("partner_path_selected", { path: "sales_agent", source_page: SOURCE_PAGE }) }}
          tertiaryLinks={[{ label: PARTNER_HUB_HERO.signIn, href: PARTNER_ROUTES.login }]}
          media={<PartnerMedia route={PARTNER_ROUTES.hub} />}
          data-testid="section-partner-hub-hero"
        />

        <PublicSection labelledBy="partner-paths-heading" data-testid="section-partner-paths">
          <PublicSectionHeader id="partner-paths-heading" title={PARTNER_HUB_SECTIONS.paths.heading} description={PARTNER_HUB_SECTIONS.paths.description} />
          <PartnerPathCards policy={policy} sourcePage={SOURCE_PAGE} headingId="partner-paths-heading" />
        </PublicSection>

        <PublicSection tone="light" labelledBy="partner-compare-heading" data-testid="section-partner-comparison">
          <PublicSectionHeader id="partner-compare-heading" title={PARTNER_HUB_SECTIONS.compare.heading} description={PARTNER_HUB_SECTIONS.compare.description} />
          <PartnerComparison headingId="partner-compare-heading" />
        </PublicSection>

        <PublicSection tone="ink" labelledBy="partner-process-heading" data-testid="section-partner-process">
          <PublicSectionHeader id="partner-process-heading" inverse title={PARTNER_HUB_SECTIONS.process.heading} description={PARTNER_HUB_SECTIONS.process.description} />
          <PartnerProcess onInk />
        </PublicSection>

        <PublicSection id="calculator" labelledBy="partner-calculator-heading" data-testid="section-partner-calculator">
          <PublicSectionHeader id="partner-calculator-heading" title={PARTNER_HUB_SECTIONS.calculator.heading} description={PARTNER_HUB_SECTIONS.calculator.description} />
          <PartnerResidualCalculator policy={policy} headingLevel="h3" />
          <div className="mt-6"><PartnerReviewDisclosure /></div>
        </PublicSection>

        <PublicSection tone="light" labelledBy="partner-faq-heading" data-testid="section-partner-faq">
          <PublicSectionHeader id="partner-faq-heading" title={PARTNER_HUB_SECTIONS.faq.heading} />
          <PartnerFaqList faqs={faqs} />
        </PublicSection>

        <PublicSection tone="warm" id="apply" labelledBy="partner-apply-heading" className="!py-10" data-testid="section-partner-choose-path">
          <PublicSectionHeader id="partner-apply-heading" title={PARTNER_HUB_SECTIONS.choose.heading} description={PARTNER_HUB_SECTIONS.choose.description} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-auto min-h-11 whitespace-normal py-2.5 text-center">
              <Link href={partnerRouteWithAttribution(PARTNER_ROUTES.referral)} onClick={() => trackPartnerEvent("partner_path_selected", { path: "referral", source_page: SOURCE_PAGE })} data-testid="partner-final-cta-referral">
                {PARTNER_HUB_SECTIONS.choose.referralCta}
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2.5 text-center">
              <Link href={partnerRouteWithAttribution(PARTNER_ROUTES.salesAgent)} onClick={() => trackPartnerEvent("partner_path_selected", { path: "sales_agent", source_page: SOURCE_PAGE })} data-testid="partner-final-cta-agent">
                {PARTNER_HUB_SECTIONS.choose.agentCta}
              </Link>
            </Button>
            <Button asChild variant="ghost" className="h-auto min-h-11 whitespace-normal py-2.5 text-center">
              <Link href={PARTNER_ROUTES.login} data-testid="partner-final-sign-in">{PARTNER_HUB_HERO.signIn}</Link>
            </Button>
          </div>
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
