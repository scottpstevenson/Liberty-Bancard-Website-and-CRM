import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";

export default function AdvertisingDisclosure() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Advertising & Earnings Disclosure" description="Liberty Bancard advertising and earnings disclosure. FTC-compliant disclosures on testimonials, savings claims, and affiliate or referral relationships." path="/advertising-disclosure" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-ad-disclosure-heading">
            Advertising &amp; Earnings Disclosure
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-ad-disclosure-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">ISO &amp; Merchant Services Disclosure</h2>
              <p>
                Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. <strong>Liberty Bancard is not a bank, financial institution, lender, or direct processor.</strong> We act as an authorized agent and ISO of our acquiring bank partner(s) and payment processor(s) to market, sell, and facilitate payment processing services for merchants. All merchant accounts are issued by, and subject to the approval of, the acquiring bank. Liberty Bancard does not hold merchant funds, issue credit, or bear settlement risk. All references to "our services," "we provide," or similar language on this website and in our advertising materials refer to our role as an ISO facilitating services on behalf of our acquiring bank and processor partners.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">FTC Disclosure</h2>
              <p>
                In accordance with the Federal Trade Commission's (FTC) guidelines concerning the use of endorsements and testimonials in advertising (16 CFR Part 255), this disclosure is provided to ensure full transparency regarding the nature of our marketing communications and any material connections between Liberty Bancard and parties providing endorsements or testimonials.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">No Guaranteed Results</h2>
              <p>
                Liberty Bancard does not guarantee any specific results, savings, approval rates, funding speeds, or financial outcomes. Any case studies, examples, estimates, projections, or testimonials presented on this website or in our marketing materials are for illustrative purposes only and do not constitute a promise, guarantee, or prediction of results you will achieve. Individual results vary significantly based on business type, processing history, volume, risk profile, card brand rules, underwriting decisions, and other factors.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Savings Estimates &amp; Proposals</h2>
              <p>
                Any savings estimates, rate comparisons, or cost analyses presented on this website or in proposals are based on information provided by the prospective merchant and are subject to verification, underwriting, and approval. Actual savings may differ from estimates. No savings claim is valid without a completed statement review and written proposal. "Savings" references compare estimated costs under a proposed program to current costs as documented in a processing statement; they are not guarantees of future performance.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Testimonials &amp; Endorsements</h2>
              <p className="mb-3">
                Any testimonials or endorsements on this website represent the individual experiences and opinions of those who have used our services. Testimonials are not necessarily representative of all experiences and are not intended to guarantee that anyone will achieve the same or similar results. Specific results depend on many factors and are subject to the disclaimers above.
              </p>
              <p>
                Where testimonials are provided by individuals who have a material connection to Liberty Bancard (such as employees, partners, affiliates, or individuals who received compensation or consideration), such connection will be disclosed.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Affiliate &amp; Referral Relationships</h2>
              <p>
                This website may contain links to products or services offered by third parties. Liberty Bancard may receive compensation, referral fees, or commissions from third parties when you engage with their products or services through our links or referrals. Such relationships do not influence the accuracy of our content, but you should be aware of them when evaluating our recommendations. We only recommend products and services we believe provide value to our clients.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Forward-Looking Statements</h2>
              <p>
                Certain statements on this website may constitute "forward-looking statements" that involve risks and uncertainties. Words such as "may," "will," "expect," "anticipate," "estimate," "project," and similar expressions identify forward-looking statements. These statements are based on current expectations and assumptions and are subject to change. Actual results may differ materially from those expressed or implied in forward-looking statements.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Advertising Standards</h2>
              <p className="mb-3">
                Liberty Bancard is committed to truthful, non-deceptive advertising and marketing practices. Our advertising complies with applicable laws and regulations including but not limited to:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Federal Trade Commission Act (FTC Act) - Section 5 regarding unfair or deceptive practices</li>
                <li>FTC Endorsement Guides (16 CFR Part 255)</li>
                <li>CAN-SPAM Act - All commercial emails include opt-out mechanisms and accurate sender information</li>
                <li>Telephone Consumer Protection Act (TCPA) - Prior express written consent obtained before marketing calls/texts</li>
                <li>State consumer protection laws and advertising regulations</li>
                <li>Card brand rules regarding the marketing of payment processing services</li>
                <li>EU Unfair Commercial Practices Directive (where applicable)</li>
                <li>UK Consumer Protection from Unfair Trading Regulations 2008 (where applicable)</li>
                <li>Australian Consumer Law (where applicable)</li>
                <li>Canada's Competition Act and Anti-Spam Legislation (CASL) (where applicable)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Financial Services Disclaimer</h2>
              <p>
                Liberty Bancard is an Independent Sales Organization (ISO) and merchant services provider -- <strong>not a bank, financial institution, lender, or direct processor</strong>. We do not hold merchant funds, issue credit, provide legal, tax, accounting, or investment advice. We facilitate payment processing services on behalf of our acquiring bank partner(s). Information on this website about payment processing, rates, fees, and programs is provided for informational purposes only and should not be construed as financial advice. You should consult with qualified professionals regarding your specific business and financial needs. All merchant accounts are subject to application, approval, and underwriting by the acquiring bank and payment processor.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Free Terminal &amp; Equipment Offers</h2>
              <p className="mb-3">
                References to "free terminals," "free equipment," or "complimentary equipment" on this website or in our advertising materials are subject to the following conditions:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Free terminal placement requires approval of a merchant processing account and activation of processing services through Liberty Bancard.</li>
                <li>Equipment remains the property of Liberty Bancard (or its equipment provider) unless otherwise stated in a signed agreement.</li>
                <li>The merchant must maintain the processing account for the agreed-upon contract term. Early termination may result in an early termination fee and equipment return requirement.</li>
                <li>Minimum monthly processing volume requirements may apply. Failure to meet minimums may result in non-use fees or equipment return.</li>
                <li>Equipment must be returned in good working condition upon account closure.</li>
                <li>The "free terminal" offer is not contingent upon purchasing additional goods or services beyond the processing agreement.</li>
                <li>Offer availability and specific terms are subject to change without notice to prospective merchants. Existing signed agreements are honored per their terms.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contract Terms &amp; Pricing Disclosures</h2>
              <p className="mb-3">
                All advertising referencing rates, fees, pricing, contract length, or program features is subject to the following:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Advertised rates and fees are subject to qualification, underwriting approval, and the terms of the signed Merchant Processing Agreement (MPA).</li>
                <li>Contract terms (typically 1-3 years) are disclosed prior to signing and specified in the MPA.</li>
                <li>Early termination fees may apply if the merchant terminates before the end of the initial or renewal term.</li>
                <li>Interchange pass-through rates are set by Visa, Mastercard, American Express, and Discover and may change; Liberty Bancard does not control interchange rates.</li>
                <li>Monthly minimums, PCI compliance fees, statement fees, and other account-level fees may apply as disclosed in the MPA.</li>
                <li>Any rate or pricing advertised as "guaranteed" applies only for the initial contract term and only to the non-interchange component of fees, unless otherwise specified.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Geographic Applicability</h2>
              <p>
                Our services are primarily offered in the United States. However, our website is accessible globally. Any claims, offers, or services described on this website are subject to the laws of the jurisdiction in which the merchant operates and may not be available in all locations. International users should be aware that the information may not be applicable to their jurisdiction and should consult local regulations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about this disclosure, please contact us:</p>
              <div className="space-y-2">
                <a href="mailto:compliance@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>compliance@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" onClick={() => trackPhoneCallClick({ sourcePage: "/advertising-disclosure" })}>
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
