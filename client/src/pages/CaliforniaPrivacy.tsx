import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function CaliforniaPrivacy() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO
        title="California Privacy Rights (CCPA/CPRA)"
        description="Liberty Bancard California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA) disclosure. Your privacy rights as a California resident."
        path="/california-privacy"
        keywords="CCPA, CPRA, California privacy, California consumer privacy act, California privacy rights, Liberty Bancard"
        breadcrumbs={[{ name: "California Privacy Rights", path: "/california-privacy" }]}
        structuredData={getBreadcrumbSchema([{ name: "California Privacy Rights", path: "/california-privacy" }])}
      />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <nav className="text-sm text-muted-foreground mb-6" aria-label="Breadcrumb" data-testid="breadcrumb-california">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">California Privacy Rights</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-california-heading">
            California Privacy Rights (CCPA/CPRA)
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-california-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-california-intro">
              <p>
                This California Privacy Rights notice supplements Liberty Bancard's <Link href="/privacy-policy" className="underline">Privacy Policy</Link> and applies solely to California residents ("consumers" or "you") as required by the California Consumer Privacy Act of 2018 (CCPA) as amended by the California Privacy Rights Act of 2020 (CPRA), collectively referred to as "CCPA/CPRA" (Cal. Civ. Code 1798.100 et seq.). This notice describes your rights and our obligations regarding the collection, use, and disclosure of your personal information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Categories of Personal Information Collected</h2>
              <p className="mb-3">
                In the preceding 12 months, Liberty Bancard has collected the following categories of personal information from California consumers:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-border rounded-md">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left p-3 border-b border-border font-semibold text-foreground">Category</th>
                      <th className="text-left p-3 border-b border-border font-semibold text-foreground">Examples</th>
                      <th className="text-left p-3 border-b border-border font-semibold text-foreground">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">A. Identifiers</td>
                      <td className="p-3 border-b border-border">Name, email, phone number, IP address, business name</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">B. Personal Information (Cal. Civ. Code 1798.80(e))</td>
                      <td className="p-3 border-b border-border">Name, address, phone number, financial information (processing statements)</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">C. Protected Classifications</td>
                      <td className="p-3 border-b border-border">Age (for eligibility verification only)</td>
                      <td className="p-3 border-b border-border">No</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">D. Commercial Information</td>
                      <td className="p-3 border-b border-border">Processing volume, industry, current processor, transaction history</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">E. Biometric Information</td>
                      <td className="p-3 border-b border-border">Fingerprints, voice recordings, facial recognition</td>
                      <td className="p-3 border-b border-border">No</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">F. Internet/Network Activity</td>
                      <td className="p-3 border-b border-border">Browsing history, search history, cookies, page interactions</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">G. Geolocation Data</td>
                      <td className="p-3 border-b border-border">Approximate location from IP address</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">H. Sensory Data</td>
                      <td className="p-3 border-b border-border">Audio recordings of customer service calls (with notice)</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">I. Professional/Employment Info</td>
                      <td className="p-3 border-b border-border">Job title, business role, company information</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">K. Inferences</td>
                      <td className="p-3 border-b border-border">Lead scores, business profiles, preferences</td>
                      <td className="p-3 border-b border-border">Yes</td>
                    </tr>
                    <tr>
                      <td className="p-3 border-b border-border font-medium text-foreground">L. Sensitive Personal Information</td>
                      <td className="p-3 border-b border-border">Account login credentials, financial account information</td>
                      <td className="p-3 border-b border-border">Yes (limited)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Sources of Personal Information</h2>
              <p className="mb-3">We collect personal information from the following sources:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Directly from you:</strong> Forms, applications, file uploads, phone calls, emails, and chat</li>
                <li><strong>Automatically:</strong> Cookies, analytics tools, and server logs when you visit our website</li>
                <li><strong>Third parties:</strong> Business data providers, public records, referral partners, and payment processing partners</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Business Purposes for Collection</h2>
              <p className="mb-3">We use personal information for the following business purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Processing and responding to your inquiries and requests</li>
                <li>Providing payment processing services and managing your account</li>
                <li>Analyzing processing statements and generating savings proposals</li>
                <li>Marketing and advertising our services (with consent where required)</li>
                <li>Improving and personalizing our website and services</li>
                <li>Detecting and preventing fraud, security threats, and abuse</li>
                <li>Complying with legal obligations and regulatory requirements</li>
                <li>Internal research, analytics, and business operations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Sale and Sharing of Personal Information</h2>
              <p className="mb-3">
                <strong>Liberty Bancard does not sell your personal information</strong> as defined by the CCPA/CPRA. We do not exchange personal information for monetary or other valuable consideration.
              </p>
              <p>
                <strong>Liberty Bancard does not share your personal information for cross-context behavioral advertising</strong> as defined by the CPRA. We do not disclose personal information to third parties for the purpose of targeting you with advertisements across different websites, applications, or services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your California Privacy Rights</h2>
              <p className="mb-3">As a California resident, you have the following rights under the CCPA/CPRA:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Right to Know (Access):</strong> You have the right to request that we disclose the categories and specific pieces of personal information we have collected about you, the categories of sources, the business purposes for collection, and the categories of third parties with whom we share your information. You may request this information for the preceding 12 months.</li>
                <li><strong>Right to Delete:</strong> You have the right to request deletion of your personal information, subject to certain exceptions (e.g., completing a transaction, detecting fraud, complying with legal obligations).</li>
                <li><strong>Right to Correct:</strong> You have the right to request correction of inaccurate personal information that we maintain about you.</li>
                <li><strong>Right to Opt-Out of Sale/Sharing:</strong> Although we do not sell or share your personal information, you may submit an opt-out request at any time. Visit our <Link href="/do-not-sell" className="underline">Do Not Sell or Share</Link> page.</li>
                <li><strong>Right to Limit Use of Sensitive Personal Information:</strong> You have the right to limit our use and disclosure of your sensitive personal information to purposes necessary to perform our services.</li>
                <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising any of your CCPA/CPRA rights. We will not deny you services, charge different prices, provide a different level of service, or suggest you will receive different treatment for exercising your rights.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Submit a Request</h2>
              <p className="mb-3">You may submit a verifiable consumer request by:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Emailing <a href="mailto:privacy@libertybancard.com" className="underline">privacy@libertybancard.com</a> with the subject "California Privacy Request"</li>
                <li>Calling 954-266-8214</li>
                <li>Visiting our <Link href="/do-not-sell" className="underline">Do Not Sell or Share</Link> page</li>
              </ul>
              <p className="mt-3">
                You may make a request up to twice in a 12-month period. We will verify your identity before processing your request by matching the information you provide with our records. If we cannot verify your identity, we may request additional information. You may also designate an authorized agent to submit requests on your behalf, provided you verify your identity and authorize the agent in writing.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Response Timing</h2>
              <p>
                We will acknowledge your request within 10 business days and provide a substantive response within 45 calendar days of receiving your verifiable request. If we need additional time (up to 45 additional days), we will notify you in writing with an explanation of the reason for the extension.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Retention of Personal Information</h2>
              <p>
                We retain each category of personal information for as long as necessary to fulfill the business purpose for which it was collected, plus any additional period required by law. For specific retention periods, see our <Link href="/data-retention" className="underline">Data Retention Policy</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Financial Incentives</h2>
              <p>
                Liberty Bancard does not offer financial incentives or price or service differences in exchange for the retention or sale of personal information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Minors Under 16</h2>
              <p>
                We do not knowingly collect or sell personal information of minors under 16 years of age. Our services are intended for business owners and authorized representatives who are at least 18 years of age.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Changes to This Notice</h2>
              <p>
                We may update this California Privacy Rights notice from time to time. Changes will be posted on this page with an updated "Last updated" date. We encourage California residents to review this notice periodically.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Related Policies</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><Link href="/privacy-policy" className="underline">Privacy Policy</Link></li>
                <li><Link href="/do-not-sell" className="underline">Do Not Sell or Share My Personal Information</Link></li>
                <li><Link href="/data-retention" className="underline">Data Retention Policy</Link></li>
                <li><Link href="/cookie-policy" className="underline">Cookie Policy</Link></li>
              </ul>
            </section>

            <section data-testid="section-california-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about your California privacy rights or to submit a request:</p>
              <div className="space-y-2">
                <a href="mailto:privacy@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-california-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>privacy@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-california-phone">
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