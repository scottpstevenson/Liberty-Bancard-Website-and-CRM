import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Privacy Policy" description="Liberty Bancard privacy policy. How we collect, use, and protect your information under GDPR, CCPA, and international data protection laws." path="/privacy-policy" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-privacy-heading">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-privacy-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-privacy-intro">
              <p>
                Liberty Bancard ("we," "us," or "our") respects your privacy and is committed to protecting the personal information you share with us. This Privacy Policy describes how we collect, use, share, and protect your information when you visit our website, submit forms, upload documents, create an account, or communicate with us. This policy applies to all users worldwide and describes your rights under applicable data protection laws including the EU General Data Protection Regulation (GDPR), UK GDPR, California Consumer Privacy Act (CCPA/CPRA), Brazil's LGPD, Canada's PIPEDA, Australia's Privacy Act, and other applicable legislation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Data Controller</h2>
              <p className="mb-3">
                Liberty Bancard is the data controller responsible for your personal data. Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. <strong>Liberty Bancard is not a bank, financial institution, or direct processor.</strong> We facilitate payment processing services on behalf of our acquiring bank partner(s). For questions about data processing or to exercise your rights, contact us at <a href="mailto:privacy@libertybancard.com" className="underline">privacy@libertybancard.com</a> or by phone at 954-266-8214.
              </p>
            </section>

            <section data-testid="section-privacy-collect">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Information We Collect</h2>
              <p className="mb-3">We collect the following categories of information:</p>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Information You Provide Directly</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Identity data: name, business name, job title</li>
                <li>Contact data: email address, phone number, mailing address</li>
                <li>Account data: login credentials, account preferences</li>
                <li>Business data: company name, industry, monthly processing volume, current payment processor, business age</li>
                <li>Financial data: processing statements you upload (we advise redacting sensitive account numbers)</li>
                <li>Communication data: messages, inquiries, support requests, and feedback</li>
                <li>Consent records: records of permissions you grant (SMS, email, marketing)</li>
              </ul>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Device data: IP address, browser type and version, operating system, device identifiers</li>
                <li>Usage data: pages visited, time on page, click patterns, referring URLs, search terms</li>
                <li>Location data: approximate geographic location derived from IP address</li>
                <li>Cookie and tracking data: as described in our <Link href="/cookie-policy" className="underline">Cookie Policy</Link></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Legal Basis for Processing (GDPR)</h2>
              <p className="mb-3">Under the GDPR and UK GDPR, we process your personal data on the following legal bases:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Consent:</strong> Where you have given clear consent for us to process your personal data for a specific purpose (e.g., marketing communications, cookies).</li>
                <li><strong>Contract:</strong> Where processing is necessary for the performance of a contract with you or to take steps at your request before entering into a contract.</li>
                <li><strong>Legitimate Interests:</strong> Where processing is necessary for our legitimate interests (or those of a third party) and your interests and fundamental rights do not override those interests. Our legitimate interests include providing and improving our services, maintaining security, and communicating about our services.</li>
                <li><strong>Legal Obligation:</strong> Where processing is necessary for compliance with a legal obligation to which we are subject.</li>
              </ul>
            </section>

            <section data-testid="section-privacy-use">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Respond to your inquiries and provide requested services</li>
                <li>Process applications and manage your account</li>
                <li>Communicate about your account, services, and relevant updates</li>
                <li>Send marketing communications (with your consent where required)</li>
                <li>Analyze processing statements and generate savings proposals</li>
                <li>Improve our website, products, and services</li>
                <li>Detect and prevent fraud, abuse, and security incidents</li>
                <li>Comply with applicable laws, regulations, and legal processes</li>
                <li>Enforce our terms and protect our rights</li>
              </ul>
            </section>

            <section data-testid="section-privacy-texts">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Text Messages, Calls, and Emails</h2>
              <p className="mb-3">
                By providing your phone number and/or email address and affirmatively opting in, you provide prior express written consent under the Telephone Consumer Protection Act (TCPA, 47 U.S.C. 227) and applicable state laws to receive autodialed and/or prerecorded calls, text messages, and emails from Liberty Bancard related to your inquiry, account, or services. This consent is not a condition of purchasing any goods or services.
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>You may opt out of text messages at any time by replying STOP to any message.</li>
                <li>You may opt out of marketing emails by clicking the unsubscribe link in any email.</li>
                <li>Message and data rates may apply. Message frequency varies.</li>
                <li>Carriers are not liable for delayed or undelivered messages.</li>
                <li>For help, reply HELP or contact <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a>.</li>
              </ul>
            </section>

            <section data-testid="section-privacy-share">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Share Your Information</h2>
              <p className="mb-3">We do not sell your personal information. We may share your information with:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Service Providers:</strong> Trusted third parties who assist us in operating our website and delivering our services (e.g., hosting providers, communication platforms, analytics providers), subject to data processing agreements.</li>
                <li><strong>Payment Processing Partners:</strong> Acquiring banks, payment networks, and processing platforms as necessary to facilitate your payment processing services.</li>
                <li><strong>Legal Compliance:</strong> When required by law, regulation, legal process, or governmental request.</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, reorganization, or sale of assets, with notice to you.</li>
                <li><strong>With Your Consent:</strong> For any other purpose disclosed to you at the time of collection with your consent.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">International Data Transfers</h2>
              <p>
                Your information may be transferred to and processed in countries other than your country of residence. When we transfer personal data internationally, we implement appropriate safeguards as required by applicable law, including Standard Contractual Clauses (SCCs) approved by the European Commission, adequacy decisions, or other lawful transfer mechanisms. By using our services, you acknowledge that your data may be transferred internationally subject to these safeguards.
              </p>
            </section>

            <section data-testid="section-privacy-security">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Security</h2>
              <p>
                We implement reasonable administrative, technical, and physical measures to protect your information, including encryption of data in transit (TLS/SSL), secure password hashing, access controls, and regular security reviews. However, no method of transmission over the internet or electronic storage is 100% secure. We encourage you to redact sensitive account numbers from any documents you upload. We do not store PCI cardholder data.
              </p>
            </section>

            <section data-testid="section-privacy-retention">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Data Retention</h2>
              <p>
                We retain your personal information only for as long as necessary to fulfill the purposes described in this policy, comply with legal obligations (including record-keeping requirements), resolve disputes, and enforce our agreements. When personal data is no longer needed, we securely delete or anonymize it. Retention periods vary by data type and are determined based on legal requirements, business needs, and the nature of the data.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Rights (GDPR - EU/UK)</h2>
              <p className="mb-3">If you are located in the European Economic Area (EEA) or the United Kingdom, you have the following rights under the GDPR:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Right of Access:</strong> Request a copy of the personal data we hold about you.</li>
                <li><strong>Right to Rectification:</strong> Request correction of inaccurate or incomplete personal data.</li>
                <li><strong>Right to Erasure:</strong> Request deletion of your personal data ("right to be forgotten") under certain conditions.</li>
                <li><strong>Right to Restrict Processing:</strong> Request that we limit our processing of your personal data.</li>
                <li><strong>Right to Data Portability:</strong> Receive your personal data in a structured, commonly used, machine-readable format.</li>
                <li><strong>Right to Object:</strong> Object to processing based on legitimate interests or for direct marketing purposes.</li>
                <li><strong>Right to Withdraw Consent:</strong> Withdraw consent at any time where processing is based on consent.</li>
                <li><strong>Right to Lodge a Complaint:</strong> File a complaint with your local data protection supervisory authority.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Rights (CCPA/CPRA - California)</h2>
              <p className="mb-3">If you are a California resident, you have the following rights under the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA):</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Right to Know:</strong> Request disclosure of the categories and specific pieces of personal information we have collected, used, disclosed, or sold.</li>
                <li><strong>Right to Delete:</strong> Request deletion of your personal information, subject to certain exceptions.</li>
                <li><strong>Right to Correct:</strong> Request correction of inaccurate personal information.</li>
                <li><strong>Right to Opt-Out of Sale/Sharing:</strong> We do not sell or share your personal information for cross-context behavioral advertising.</li>
                <li><strong>Right to Limit Use of Sensitive Personal Information:</strong> Direct us to limit use and disclosure of your sensitive personal information.</li>
                <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights.</li>
              </ul>
              <p className="mt-2">To exercise your rights, contact us at <a href="mailto:privacy@libertybancard.com" className="underline">privacy@libertybancard.com</a>. We will verify your identity before processing your request.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Additional International Rights</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Brazil (LGPD):</strong> Brazilian residents have rights to confirmation, access, correction, anonymization, portability, deletion, information about sharing, consent withdrawal, and filing complaints with the ANPD.</li>
                <li><strong>Canada (PIPEDA):</strong> Canadian residents have rights to access, correct, and challenge compliance with PIPEDA. Consent is required for collection, use, and disclosure of personal information.</li>
                <li><strong>Australia (Privacy Act):</strong> Australian residents have rights to access, correct, and complain about handling of personal information under the Australian Privacy Principles.</li>
                <li><strong>Other Jurisdictions:</strong> If you are located in another jurisdiction with data protection laws, you may have additional rights. Please contact us at <a href="mailto:privacy@libertybancard.com" className="underline">privacy@libertybancard.com</a>.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Do Not Sell or Share My Personal Information</h2>
              <p>
                We do not sell your personal information as defined by the CCPA/CPRA. We do not share your personal information for cross-context behavioral advertising. We do not use or disclose sensitive personal information for purposes other than those permitted by the CCPA/CPRA.
              </p>
            </section>

            <section data-testid="section-privacy-children">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Children's Privacy</h2>
              <p>
                Our website and services are not directed to children under the age of 16 (or under 13 in the United States under COPPA). We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately and we will take steps to delete such information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. Material changes will be communicated by posting the updated policy on this page with a revised "Last updated" date. Where required by law, we will obtain your consent to material changes. We encourage you to review this policy periodically.
              </p>
            </section>

            <section data-testid="section-privacy-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">
                For questions about this Privacy Policy, to exercise your data protection rights, or for any privacy-related concerns, please contact us:
              </p>
              <div className="space-y-2">
                <a href="mailto:privacy@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-privacy-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>privacy@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-privacy-phone">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
              <p className="mt-3 text-xs">
                EU/UK residents may also contact your local data protection supervisory authority.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
