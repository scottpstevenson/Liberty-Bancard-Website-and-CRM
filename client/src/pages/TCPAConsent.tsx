import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function TCPAConsent() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="TCPA Consent Policy | Liberty Bancard"
        description="Liberty Bancard TCPA consent policy for telephone calls and text messages. Understand your rights under the Telephone Consumer Protection Act."
        path="/tcpa-consent"
        keywords="TCPA consent, telephone consumer protection act, text message consent, call consent, Liberty Bancard"
        breadcrumbs={[{ name: "TCPA Consent", path: "/tcpa-consent" }]}
        structuredData={getBreadcrumbSchema([{ name: "TCPA Consent", path: "/tcpa-consent" }])}
      />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <nav className="text-sm text-muted-foreground mb-6" aria-label="Breadcrumb" data-testid="breadcrumb-tcpa">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">TCPA Consent</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-tcpa-heading">
            TCPA Consent Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-tcpa-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-tcpa-intro">
              <p>
                This TCPA Consent Policy describes how Liberty Bancard ("we," "us," or "our") obtains, uses, and manages your consent for telephone calls and text messages (SMS/MMS) under the Telephone Consumer Protection Act (TCPA, 47 U.S.C. 227), its implementing regulations (47 C.F.R. 64.1200), and applicable state telemarketing and communication laws.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Consent to Receive Calls and Text Messages</h2>
              <p className="mb-3">
                By providing your telephone number on any Liberty Bancard form, application, or communication channel and affirmatively opting in (e.g., checking a consent checkbox, clicking "Submit," or verbally consenting during a call), you provide your prior express written consent as defined under the TCPA to receive:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Autodialed Calls:</strong> Calls made using an automatic telephone dialing system (ATDS) or prerecorded/artificial voice messages to the telephone number(s) you provide.</li>
                <li><strong>Text Messages (SMS/MMS):</strong> Automated and manual text messages, including marketing, informational, transactional, and service-related messages.</li>
                <li><strong>Live Calls:</strong> Live telephone calls from Liberty Bancard representatives regarding your inquiry, account, or our services.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Purpose of Communications</h2>
              <p className="mb-3">We may contact you by phone or text message for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Responding to your inquiry or form submission</li>
                <li>Providing information about payment processing services, pricing, and programs</li>
                <li>Following up on merchant applications and onboarding</li>
                <li>Account notifications, service updates, and billing information</li>
                <li>Appointment reminders and scheduling confirmations</li>
                <li>Marketing and promotional offers related to our services</li>
                <li>Customer support and technical assistance</li>
                <li>Compliance and regulatory notifications</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Consent Is Not Required for Purchase</h2>
              <p>
                Your consent to receive autodialed or prerecorded calls and text messages is <strong>not a condition of purchasing any goods or services</strong> from Liberty Bancard. You may choose not to provide consent and still engage with our services through other communication channels (email, live calls, or in-person).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Message Frequency and Charges</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Message Frequency:</strong> Message frequency varies based on your interactions with us and the nature of your account. You may receive multiple messages per week during active onboarding or support interactions.</li>
                <li><strong>Message and Data Rates:</strong> Standard message and data rates from your wireless carrier may apply. Liberty Bancard does not charge for text messages, but your carrier may.</li>
                <li><strong>Carrier Liability:</strong> Carriers (e.g., T-Mobile, AT&T, Verizon) are not liable for delayed or undelivered messages.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Opt Out</h2>
              <p className="mb-3">You may revoke your consent and opt out of receiving calls and text messages at any time using any of the following methods:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Text STOP:</strong> Reply STOP, UNSUBSCRIBE, CANCEL, END, or QUIT to any text message from Liberty Bancard.</li>
                <li><strong>Call Us:</strong> Call 954-266-8214 and request to be removed from our call and text lists.</li>
                <li><strong>Email Us:</strong> Send your opt-out request to <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> with the subject line "TCPA Opt-Out."</li>
                <li><strong>Written Request:</strong> Send a written request to our mailing address.</li>
              </ul>
              <p className="mt-3">
                Upon receiving your opt-out request, we will process it within 10 business days. You may receive a final confirmation message acknowledging your opt-out. Opting out of marketing messages does not affect transactional or account-related messages that are necessary for the performance of our contract with you.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Get Help</h2>
              <p>
                For help with text messages, reply HELP to any message from Liberty Bancard, or contact us at <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or call 954-266-8214.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Do Not Call Registry</h2>
              <p>
                Liberty Bancard maintains an internal do-not-call list and honors the National Do Not Call Registry. If you have registered your phone number on the National Do Not Call Registry and do not wish to receive calls from us, we will honor that registration. Note that providing your phone number and opting in through our forms constitutes an established business relationship and express consent, which may permit certain communications even if your number is on the Do Not Call Registry.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Consent Records</h2>
              <p>
                Liberty Bancard maintains records of all consent obtained, including the date, time, method of consent (web form, verbal, written), the specific language presented at the time of consent, and the telephone number(s) for which consent was provided. These records are retained for a minimum of five (5) years or as required by applicable law and are available upon request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">State-Specific Provisions</h2>
              <p className="mb-3">
                In addition to federal TCPA requirements, Liberty Bancard complies with applicable state telemarketing and communication laws, including but not limited to:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Florida:</strong> Florida Telephone Solicitation Act (Fla. Stat. 501.059)</li>
                <li><strong>California:</strong> California's Invasion of Privacy Act and CCPA/CPRA requirements</li>
                <li><strong>New York:</strong> New York Telephone Consumer Protection Act</li>
                <li><strong>Illinois:</strong> Illinois Automatic Telephone Dialers Act</li>
                <li><strong>Washington:</strong> Washington Automatic Dialing and Announcing Device statute</li>
              </ul>
              <p className="mt-3">
                If your state provides additional protections beyond federal TCPA requirements, those protections apply to you.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Third-Party Service Providers</h2>
              <p>
                Liberty Bancard may use third-party communication platforms and service providers to deliver calls and text messages on our behalf. These providers are contractually obligated to comply with the TCPA and applicable privacy laws and may only use your information as directed by us for the purposes described in this policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Changes to This Policy</h2>
              <p>
                We may update this TCPA Consent Policy from time to time. Material changes will be communicated by posting the updated policy on this page with a revised "Last updated" date. Your continued provision of consent after changes are posted constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Related Policies</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><Link href="/privacy-policy" className="underline">Privacy Policy</Link></li>
                <li><Link href="/sms-terms" className="underline">SMS Terms of Service</Link></li>
                <li><Link href="/terms" className="underline">Terms of Service</Link></li>
                <li><Link href="/do-not-sell" className="underline">Do Not Sell or Share My Personal Information</Link></li>
              </ul>
            </section>

            <section data-testid="section-tcpa-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about this TCPA Consent Policy or to exercise your rights:</p>
              <div className="space-y-2">
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-tcpa-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-tcpa-phone">
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