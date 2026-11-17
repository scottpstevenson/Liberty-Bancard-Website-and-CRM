import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PublicHero } from "@/components/public/PublicHero";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PartnerResidualCalculator } from "@/components/public/PartnerResidualCalculator";
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
import { PARTNER_HUB_HERO, PARTNER_PATH_LABEL, PARTNER_ROUTES } from "@shared/partner-public-content";
import { trackPartnerEvent } from "@/lib/tracking";

const SOURCE_PAGE = PARTNER_ROUTES.hub;

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
        title="Partnerships — Referral Partners & Sales Agents | Liberty Bancard"
        description="Introduce a business that needs payment processing, or build your own portfolio as a sales agent. Compare the two Liberty Bancard partnership paths and apply."
        path="/partners"
        keywords="payment processing referral partner, merchant services sales agent, Liberty Bancard partnerships"
        structuredData={[partnerFaqJsonLd(faqs)]}
      />
      <Navbar />
      <main className="marketing-surface flex-grow public-main-offset">
        <PublicHero
          badge={<span className="public-eyebrow">{PARTNER_HUB_HERO.eyebrow}</span>}
          headline={PARTNER_HUB_HERO.heading}
          subheadline={PARTNER_HUB_HERO.body}
          primaryCta={{ label: PARTNER_HUB_HERO.primaryCta, href: PARTNER_ROUTES.referral, onClick: () => trackPartnerEvent("partner_path_selected", { path: "referral", source_page: SOURCE_PAGE }) }}
          secondaryCta={{ label: PARTNER_HUB_HERO.secondaryCta, href: PARTNER_ROUTES.salesAgent, onClick: () => trackPartnerEvent("partner_path_selected", { path: "sales_agent", source_page: SOURCE_PAGE }) }}
          tertiaryLinks={[{ label: PARTNER_HUB_HERO.signIn, href: PARTNER_ROUTES.login }]}
          data-testid="section-partner-hub-hero"
        />

        <PublicSection labelledBy="partner-paths-heading" data-testid="section-partner-paths">
          <PublicSectionHeader id="partner-paths-heading" title="Two ways to partner with Liberty." description="Choose the path that matches the work you want to do." />
          <PartnerPathCards policy={policy} sourcePage={SOURCE_PAGE} headingId="partner-paths-heading" />
        </PublicSection>

        <PublicSection tone="warm" labelledBy="partner-compare-heading" data-testid="section-partner-comparison">
          <PublicSectionHeader id="partner-compare-heading" title="How the two paths differ." />
          <PartnerComparison headingId="partner-compare-heading" />
        </PublicSection>

        <PublicSection labelledBy="partner-process-heading" data-testid="section-partner-process">
          <PublicSectionHeader id="partner-process-heading" title="How it works." />
          <PartnerProcess />
        </PublicSection>

        <PublicSection tone="warm" id="calculator" labelledBy="partner-calculator-heading" data-testid="section-partner-calculator">
          <PublicSectionHeader id="partner-calculator-heading" title="See how a portfolio could add up." description="An illustration with assumptions you choose. It is not a quote, an average or a promise of earnings." />
          <PartnerResidualCalculator policy={policy} headingLevel="h3" />
          <div className="mt-6"><PartnerReviewDisclosure /></div>
        </PublicSection>

        <PublicSection labelledBy="partner-faq-heading" data-testid="section-partner-faq">
          <PublicSectionHeader id="partner-faq-heading" title="Questions partners ask." />
          <PartnerFaqList faqs={faqs} />
        </PublicSection>

        <PublicSection tone="warm" id="apply" labelledBy="partner-apply-heading" data-testid="section-partner-choose-path">
          <PublicSectionHeader id="partner-apply-heading" title="Choose your path." description="Each path has its own short application. There is no password and no account to create." />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="min-h-11">
              <Link href={PARTNER_ROUTES.referral} onClick={() => trackPartnerEvent("partner_path_selected", { path: "referral", source_page: SOURCE_PAGE })} data-testid="partner-final-cta-referral">
                {PARTNER_PATH_LABEL.referral}: refer a business
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={PARTNER_ROUTES.salesAgent} onClick={() => trackPartnerEvent("partner_path_selected", { path: "sales_agent", source_page: SOURCE_PAGE })} data-testid="partner-final-cta-agent">
                {PARTNER_PATH_LABEL.sales_agent}: build a portfolio
              </Link>
            </Button>
          </div>
        </PublicSection>
      </main>
      <Footer />
    </div>
  );
}
