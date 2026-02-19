import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Terms of Service" description="Liberty Bancard terms of service, advertising disclaimers, TCPA compliance, and conditions of use." path="/terms" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-terms-heading">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-terms-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-terms-acceptance">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing, browsing, or using the Liberty Bancard website ("Site"), creating an account, or using any of our services, you ("you" or "User") agree to be bound by these Terms of Service ("Terms"), our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>, our <Link href="/cookie-policy" className="underline">Cookie Policy</Link>, and our <Link href="/advertising-disclosure" className="underline">Advertising Disclosure</Link>, all of which are incorporated herein by reference. If you do not agree to these Terms, you must not access or use this Site or our services. We reserve the right to modify these Terms at any time. Continued use of the Site after posting of changes constitutes acceptance of the modified Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">2. Eligibility</h2>
              <p>
                You must be at least 18 years of age and have the legal capacity to enter into a binding agreement to use this Site and our services. By using this Site, you represent and warrant that you meet these requirements. If you are using the Site on behalf of a business entity, you represent that you have the authority to bind that entity to these Terms.
              </p>
            </section>

            <section data-testid="section-terms-iso">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">3. Independent Sales Organization (ISO) Disclosure</h2>
              <p className="mb-3">
                Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. <strong>Liberty Bancard is not a bank.</strong> We do not directly process credit card transactions, issue merchant accounts, or hold funds. We act as an authorized agent and ISO of our acquiring bank partner(s) and payment processor(s) to market and facilitate payment processing services for merchants.
              </p>
              <p className="mb-3">
                All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor. Liberty Bancard's role is to facilitate the application process, provide customer support, assist with equipment setup, and serve as a liaison between merchants and the payment processor/acquiring bank. The acquiring bank is the entity that holds the merchant account, settles transactions, and bears the settlement risk.
              </p>
              <p>
                Card brand rules, regulations, and operating guidelines (including those from Visa, Mastercard, American Express, and Discover) apply to all merchant accounts and processing activities facilitated by Liberty Bancard.
              </p>
            </section>

            <section data-testid="section-terms-purpose">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">4. Website Purpose &amp; Disclaimer</h2>
              <p>
                This website is provided for informational purposes and to facilitate communication between you and Liberty Bancard regarding payment processing services. Content on this site, including but not limited to text, graphics, images, and other material, is not a binding offer, contract, or guarantee of services, pricing, rates, savings, or results. All content is provided "as is" and "as available" without warranties of any kind, express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
              </p>
            </section>

            <section data-testid="section-terms-no-guarantees">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">5. No Guarantees / No Savings Claims</h2>
              <p>
                Liberty Bancard does not guarantee savings, approval, funding speed, or specific pricing until a formal statement review has been completed and a written proposal has been provided. Any estimates, illustrations, projections, case studies, or examples on this website are for informational purposes only and do not constitute a promise, guarantee, or prediction of results. Individual results vary significantly based on business type, processing history, volume, risk profile, card brand rules, underwriting decisions, and other factors. Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claim is valid without a completed statement review and a written proposal.
              </p>
            </section>

            <section data-testid="section-terms-no-advice">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">6. No Legal, Tax, or Financial Advice</h2>
              <p>
                Nothing on this website constitutes legal, tax, accounting, investment, or financial advice. Liberty Bancard is an Independent Sales Organization (ISO) and merchant services provider -- <strong>not a bank, financial advisor, attorney, lender, or financial institution</strong>. We facilitate payment processing services on behalf of our acquiring bank partner(s). You should consult with qualified professionals regarding your specific business, legal, tax, and financial needs. Liberty Bancard is not responsible for decisions made based on information provided on this site.
              </p>
            </section>

            <section data-testid="section-terms-equipment">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">7. Free Terminal / Equipment Program</h2>
              <p className="mb-3">
                Liberty Bancard may offer a "free terminal" or complimentary equipment placement program, subject to the following conditions and requirements:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Qualification:</strong> Free terminal placement is available only to merchants who are approved for and maintain an active processing account through Liberty Bancard. The equipment offer is contingent upon successful application approval and activation of the merchant account.</li>
                <li><strong>Equipment Ownership:</strong> Equipment provided under the free terminal program remains the property of Liberty Bancard (or its equipment provider) unless otherwise stated in a signed agreement. The terminal is placed with the merchant on a loaner or lease-to-own basis depending on the specific program.</li>
                <li><strong>Minimum Processing Requirements:</strong> To maintain eligibility for the free terminal, the merchant must meet minimum monthly processing volume requirements as specified in the merchant agreement. Merchants who do not meet minimum processing thresholds may be subject to a monthly minimum fee, non-use fee, or equipment return requirement.</li>
                <li><strong>Contract Term:</strong> The free terminal program requires the merchant to maintain their processing account for the duration of the agreed-upon contract term. Early termination of the processing agreement may result in an early termination fee (ETF) and the requirement to return equipment.</li>
                <li><strong>Return of Equipment:</strong> Upon account closure or termination, the merchant must return the terminal in good working condition within 30 days. Failure to return equipment may result in a non-return fee as specified in the merchant agreement.</li>
                <li><strong>Equipment Condition:</strong> The merchant is responsible for maintaining the terminal in good working condition. Damage, loss, or theft of the terminal that is not covered by warranty may result in a replacement fee.</li>
                <li><strong>No Obligation to Purchase:</strong> The free terminal offer is not contingent upon the purchase of any additional goods or services beyond the payment processing agreement.</li>
                <li><strong>Availability:</strong> Free terminal placement is subject to availability and Liberty Bancard reserves the right to modify or discontinue this program at any time without prior notice to prospective merchants. Existing merchant agreements will be honored per their signed terms.</li>
              </ul>
            </section>

            <section data-testid="section-terms-contract">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">8. Contract Terms &amp; Early Termination</h2>
              <p className="mb-3">
                Merchant processing agreements facilitated by Liberty Bancard are subject to the following general terms. The specific terms of your agreement are governed by your signed Merchant Processing Agreement (MPA) and any applicable addenda.
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Contract Length:</strong> Standard merchant processing agreements have an initial term as specified in the signed Merchant Processing Agreement (commonly 1-3 years depending on the program and equipment placement). The exact term length is disclosed and agreed upon prior to signing.</li>
                <li><strong>Auto-Renewal:</strong> Unless otherwise stated in the signed agreement, merchant processing agreements may auto-renew for successive renewal terms (commonly 1-year periods) unless either party provides written notice of non-renewal at least 30-90 days prior to the end of the current term, as specified in the merchant agreement.</li>
                <li><strong>Early Termination Fee (ETF):</strong> If a merchant terminates their processing agreement before the end of the initial term or any renewal term, an early termination fee may apply. The ETF amount is disclosed in the Merchant Processing Agreement and typically ranges from $295 to $595 depending on the program and remaining term. Some programs may offer no-ETF options at different pricing tiers.</li>
                <li><strong>Rate Guarantees:</strong> Liberty Bancard offers rate lock guarantees for the duration of the initial contract term on select programs. Interchange pass-through rates are subject to card brand rate adjustments, which are set by Visa, Mastercard, American Express, and Discover and are outside the control of Liberty Bancard or the acquiring bank.</li>
                <li><strong>Monthly Minimums:</strong> Some merchant accounts may require a minimum monthly processing fee. If the merchant's processing fees do not meet the monthly minimum, the difference may be charged to the merchant's account.</li>
                <li><strong>Account Closure:</strong> To close an account, the merchant must provide written notice to Liberty Bancard. Closure is subject to any remaining contractual obligations, equipment return requirements, and outstanding fees or chargebacks.</li>
                <li><strong>Governing Terms:</strong> In the event of a conflict between these website Terms of Service and the signed Merchant Processing Agreement, the Merchant Processing Agreement shall control.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">9. Accounts &amp; Registration</h2>
              <p>
                When you create an account on our Site, you agree to provide accurate, current, and complete information and to update it as necessary. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized access or use. We reserve the right to suspend or terminate accounts at our discretion.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">10. Communications Consent (TCPA / CAN-SPAM / CASL)</h2>
              <p className="mb-3">
                By providing your phone number and/or email address and affirmatively opting in through our forms, you provide prior express written consent as defined by the Telephone Consumer Protection Act (TCPA, 47 U.S.C. 227) and its implementing regulations (47 C.F.R. 64.1200) to receive:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Autodialed and/or prerecorded calls and text messages (SMS/MMS)</li>
                <li>Informational and marketing emails</li>
              </ul>
              <p className="mt-3">
                from Liberty Bancard and its agents at the telephone number(s) and email address(es) you provide. This consent is not a condition of purchasing any goods or services. You may revoke consent at any time by replying STOP to any text message, clicking unsubscribe in any email, or contacting us directly. Message and data rates may apply. Message frequency varies.
              </p>
              <p className="mt-3">
                Our email communications comply with the CAN-SPAM Act (15 U.S.C. 7701 et seq.), Canada's Anti-Spam Legislation (CASL), the EU ePrivacy Directive, and applicable state and international anti-spam laws. All commercial emails include accurate header information, a valid physical address, clear identification as advertising (where applicable), and a functional unsubscribe mechanism.
              </p>
            </section>

            <section data-testid="section-terms-submissions">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">11. User Submissions &amp; Data</h2>
              <p>
                By submitting information through our website (including forms, file uploads, and communications), you represent that the information you provide is accurate and that you have the authority to share it. We encourage you to redact sensitive account numbers from any documents you upload. We do not store PCI cardholder data. Submitted information will be handled in accordance with our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>. You grant Liberty Bancard a non-exclusive, royalty-free license to use submitted information solely for the purpose of providing the requested services.
              </p>
            </section>

            <section data-testid="section-terms-ip">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">12. Intellectual Property</h2>
              <p>
                All content on this website, including text, graphics, logos, images, software, and compilations, is the property of Liberty Bancard or its licensors and is protected by applicable intellectual property laws, including copyright, trademark, and patent laws. You may not reproduce, distribute, modify, create derivative works from, publicly display, or otherwise exploit this content without prior written consent. All trademarks, service marks, and trade names displayed on this site are the property of their respective owners.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">13. Prohibited Uses</h2>
              <p className="mb-3">You agree not to use this Site to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Violate any applicable local, state, national, or international law or regulation</li>
                <li>Submit false, misleading, or fraudulent information</li>
                <li>Interfere with or disrupt the Site's functionality or security</li>
                <li>Attempt to gain unauthorized access to any systems or data</li>
                <li>Scrape, harvest, or collect information from the Site by automated means without consent</li>
                <li>Transmit viruses, malware, or other harmful code</li>
                <li>Impersonate any person or entity or misrepresent your affiliation</li>
              </ul>
            </section>

            <section data-testid="section-terms-links">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">14. Third-Party Links &amp; Services</h2>
              <p>
                This website may contain links to third-party websites, applications, or services. Liberty Bancard is not responsible for the content, privacy practices, accuracy, or availability of any third-party websites or services. Inclusion of a link does not imply endorsement, sponsorship, or affiliation. Your use of third-party websites is at your own risk and subject to their terms and policies.
              </p>
            </section>

            <section data-testid="section-terms-liability">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">15. Limitation of Liability</h2>
              <p>
                TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, LIBERTY BANCARD, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING FROM OR RELATED TO YOUR USE OF OR INABILITY TO USE THIS WEBSITE OR OUR SERVICES, WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY OTHER LEGAL THEORY. THIS LIMITATION APPLIES EVEN IF LIBERTY BANCARD HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. IN JURISDICTIONS THAT DO NOT ALLOW THE EXCLUSION OR LIMITATION OF LIABILITY FOR CERTAIN DAMAGES, OUR LIABILITY SHALL BE LIMITED TO THE MAXIMUM EXTENT PERMITTED BY LAW.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">16. Indemnification</h2>
              <p>
                You agree to indemnify, defend, and hold harmless Liberty Bancard, its officers, directors, employees, agents, and affiliates from and against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or related to your use of the Site, your violation of these Terms, your violation of any third-party rights, or any information you submit through the Site.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">17. Dispute Resolution &amp; Arbitration</h2>
              <p className="mb-3">
                Any dispute, controversy, or claim arising out of or relating to these Terms or the breach, termination, or validity thereof shall be resolved as follows:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Informal Resolution:</strong> You agree to first attempt to resolve any dispute informally by contacting us at <a href="mailto:legal@libertybancard.com" className="underline">legal@libertybancard.com</a>. We will attempt to resolve the dispute within 30 days.</li>
                <li><strong>Binding Arbitration:</strong> If the dispute cannot be resolved informally, it shall be resolved by binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules. The arbitration shall take place in Broward County, Florida, unless otherwise agreed.</li>
                <li><strong>Class Action Waiver:</strong> You agree that any arbitration or legal proceeding shall be conducted on an individual basis and not as a class action, class arbitration, or representative action. You waive any right to participate in a class action lawsuit or class-wide arbitration.</li>
                <li><strong>Small Claims Exception:</strong> Either party may bring qualifying claims in small claims court.</li>
              </ul>
              <p className="mt-3 text-xs">
                Note: Some jurisdictions may not allow binding pre-dispute arbitration or class action waivers. If any provision of this section is found unenforceable in your jurisdiction, the remainder shall remain in effect, and disputes shall be resolved in the courts specified in the Governing Law section.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">18. Governing Law &amp; Jurisdiction</h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the State of Florida, United States, without regard to its conflict of law provisions. For any disputes not subject to arbitration, you consent to the exclusive jurisdiction and venue of the state and federal courts located in Broward County, Florida. Nothing in these Terms shall deprive consumers of mandatory protections afforded by the laws of their country of residence where applicable.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">19. Severability</h2>
              <p>
                If any provision of these Terms is found to be unlawful, void, or unenforceable, that provision shall be deemed severable and shall not affect the validity and enforceability of the remaining provisions. The unenforceable provision shall be replaced with an enforceable provision that most closely reflects the intent of the original.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">20. Entire Agreement</h2>
              <p>
                These Terms, together with our Privacy Policy, Cookie Policy, and Advertising Disclosure, constitute the entire agreement between you and Liberty Bancard regarding the use of this Site and supersede all prior agreements, understandings, and communications, whether written or oral.
              </p>
            </section>

            <section data-testid="section-terms-changes">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">21. Changes to These Terms</h2>
              <p>
                We reserve the right to update these Terms at any time. Material changes will be posted on this page with an updated "Last updated" date. Where required by law, we will provide advance notice or obtain consent before material changes take effect. Your continued use of the website after changes are posted constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section data-testid="section-terms-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">22. Contact Us</h2>
              <p className="mb-3">
                If you have questions about these Terms of Service, please contact us:
              </p>
              <div className="space-y-2">
                <a href="mailto:legal@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-terms-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>legal@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-terms-phone">
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
