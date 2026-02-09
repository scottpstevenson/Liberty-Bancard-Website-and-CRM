import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Terms of Service" description="Liberty Bancard terms of service and conditions of use." path="/terms" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-terms-heading">
            Terms of Use
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-terms-updated">
            Last updated: January 26, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-terms-acceptance">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Acceptance of Terms</h2>
              <p>
                By accessing or using the Liberty Bancard website, you agree to be bound by these Terms of Use. If you do not agree, please do not use this website.
              </p>
            </section>

            <section data-testid="section-terms-purpose">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Website Purpose</h2>
              <p>
                This website is provided for informational purposes and to facilitate communication between you and Liberty Bancard regarding payment processing services. Content on this site is not a binding offer or guarantee of services, pricing, or results.
              </p>
            </section>

            <section data-testid="section-terms-no-guarantees">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">No Guarantees / No Savings Claims</h2>
              <p>
                Liberty Bancard does not guarantee savings, approval, funding speed, or specific pricing until a formal statement review has been completed and a written proposal has been provided. Any estimates, illustrations, or examples on this website are for informational purposes only and do not constitute a promise of results. Eligibility, underwriting, card brand rules, and applicable laws apply.
              </p>
            </section>

            <section data-testid="section-terms-no-advice">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">No Legal or Tax Advice</h2>
              <p>
                Nothing on this website constitutes legal, tax, or financial advice. You should consult with qualified professionals regarding your specific situation. Liberty Bancard is not responsible for decisions made based on information provided on this site.
              </p>
            </section>

            <section data-testid="section-terms-submissions">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">User Submissions</h2>
              <p>
                By submitting information through our website (including forms, file uploads, and communications), you represent that the information you provide is accurate and that you have the authority to share it. We encourage you to redact sensitive account numbers from any documents you upload. Submitted information will be handled in accordance with our Privacy Policy.
              </p>
            </section>

            <section data-testid="section-terms-ip">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Intellectual Property</h2>
              <p>
                All content on this website, including text, graphics, logos, and software, is the property of Liberty Bancard or its licensors and is protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works from this content without prior written consent.
              </p>
            </section>

            <section data-testid="section-terms-links">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Third-Party Links</h2>
              <p>
                This website may contain links to third-party websites. Liberty Bancard is not responsible for the content, privacy practices, or accuracy of any third-party websites. Inclusion of a link does not imply endorsement.
              </p>
            </section>

            <section data-testid="section-terms-liability">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by law, Liberty Bancard shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of this website or reliance on any information provided herein. This website is provided "as is" without warranties of any kind.
              </p>
            </section>

            <section data-testid="section-terms-changes">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Changes to These Terms</h2>
              <p>
                We reserve the right to update these Terms of Use at any time. Changes will be posted on this page with an updated "Last updated" date. Your continued use of the website after changes are posted constitutes acceptance of the revised terms.
              </p>
            </section>

            <section data-testid="section-terms-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">
                If you have questions about these Terms of Use, please contact us:
              </p>
              <div className="space-y-2">
                <a
                  href="mailto:support@libertybancard.com"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  data-testid="link-terms-email"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a
                  href="tel:9542668214"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  data-testid="link-terms-phone"
                >
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
