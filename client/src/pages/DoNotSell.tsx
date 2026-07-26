import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function DoNotSell() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Do Not Sell or Share My Personal Information" description="Liberty Bancard California Consumer Privacy Act (CCPA/CPRA) opt-out page. Exercise your right to opt out of the sale or sharing of personal information." path="/do-not-sell" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-do-not-sell-heading">
            Do Not Sell or Share My Personal Information
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-do-not-sell-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">California Consumer Privacy Act (CCPA/CPRA)</h2>
              <p>
                Under the California Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA), California residents have the right to opt out of the "sale" or "sharing" of their personal information. "Sale" under the CCPA includes disclosing personal information to a third party for monetary or other valuable consideration. "Sharing" includes disclosing personal information for cross-context behavioral advertising purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Liberty Bancard's Position</h2>
              <p className="mb-3">
                <strong>Liberty Bancard does not sell your personal information</strong> as defined by the CCPA/CPRA. We do not disclose your personal information to third parties in exchange for monetary compensation.
              </p>
              <p className="mb-3">
                <strong>Liberty Bancard does not share your personal information</strong> for cross-context behavioral advertising. We do not use your personal information for targeted advertising across other websites or services.
              </p>
              <p>
                We do not use or disclose sensitive personal information for purposes other than those expressly permitted by the CCPA/CPRA (Cal. Civ. Code 1798.121).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Use Your Information</h2>
              <p className="mb-3">We use your personal information only for the following business purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Providing and improving our payment processing services</li>
                <li>Processing your merchant account application</li>
                <li>Communicating with you about your account and services</li>
                <li>Sending marketing communications (with your consent)</li>
                <li>Complying with legal obligations</li>
                <li>Detecting and preventing fraud and security threats</li>
                <li>Internal analytics and service improvement</li>
              </ul>
              <p className="mt-3">
                For a complete description of how we collect, use, and share your information, please see our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your California Privacy Rights</h2>
              <p className="mb-3">As a California resident, you have the following rights under the CCPA/CPRA:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Right to Know:</strong> Request disclosure of the categories and specific pieces of personal information we have collected about you in the past 12 months.</li>
                <li><strong>Right to Delete:</strong> Request deletion of personal information we have collected about you, subject to certain exceptions.</li>
                <li><strong>Right to Correct:</strong> Request correction of inaccurate personal information.</li>
                <li><strong>Right to Opt-Out:</strong> Opt out of the sale or sharing of your personal information (we do not sell or share, but you may submit a request for the record).</li>
                <li><strong>Right to Limit:</strong> Direct us to limit use and disclosure of your sensitive personal information to what is necessary for the purposes for which it was collected.</li>
                <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights. You will not receive different pricing, quality of service, or access based on exercising your rights.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Submit a Request</h2>
              <p className="mb-3">
                To exercise any of your California privacy rights, you may contact us through one of the following methods:
              </p>
              <div className="space-y-2 mb-4">
                <a href="mailto:privacy@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>privacy@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
              <p className="mb-3">
                Please include "California Privacy Rights Request" in the subject line and specify which right(s) you wish to exercise. We will verify your identity before processing your request. You may also designate an authorized agent to submit a request on your behalf, subject to verification.
              </p>
              <p>
                We will respond to verified requests within 45 days. If additional time is needed (up to an additional 45 days), we will notify you of the extension and the reason.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Categories of Information Collected</h2>
              <p className="mb-3">In the past 12 months, we may have collected the following categories of personal information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Identifiers:</strong> Name, email, phone number, mailing address, business name</li>
                <li><strong>Commercial Information:</strong> Processing volume, business type, current processor, services of interest</li>
                <li><strong>Internet/Electronic Activity:</strong> Browsing history on our site, device information, IP address</li>
                <li><strong>Professional Information:</strong> Job title, business role, industry</li>
                <li><strong>Inferences:</strong> Lead scores, business profiles derived from the above</li>
              </ul>
              <p className="mt-3 text-xs">
                We do not collect biometric information, geolocation data (beyond approximate location from IP), or data about protected classifications for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Financial Incentive Programs</h2>
              <p>
                Liberty Bancard does not offer financial incentive programs (as defined by Cal. Civ. Code 1798.125(b)) that require the collection, retention, or sale of personal information in exchange for a benefit or price difference.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Global Privacy Control</h2>
              <p>
                Liberty Bancard honors the Global Privacy Control (GPC) signal. If your browser sends a GPC signal, we will treat it as a valid opt-out of the sale or sharing of personal information for that browser.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
