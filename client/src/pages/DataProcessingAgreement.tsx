import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";
import { Link } from "wouter";

export default function DataProcessingAgreement() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Data Processing Agreement (DPA)" description="Liberty Bancard Data Processing Agreement for GDPR and international data protection law compliance. Outlines how we process and protect personal data." path="/data-processing-agreement" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-dpa-heading">
            Data Processing Agreement (DPA)
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-dpa-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">1. Introduction</h2>
              <p>
                This Data Processing Agreement ("DPA") supplements our <Link href="/privacy-policy" className="underline">Privacy Policy</Link> and <Link href="/terms" className="underline">Terms of Service</Link> and is entered into between Liberty Bancard ("Processor" or "we") and the merchant or user of our services ("Controller" or "you"). This DPA applies where Liberty Bancard processes personal data on behalf of the Controller in connection with the provision of payment processing facilitation and related services, and where applicable data protection laws (including the EU General Data Protection Regulation 2016/679 ("GDPR"), UK GDPR, and other applicable legislation) require a data processing agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">2. Definitions</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>"Personal Data"</strong> means any information relating to an identified or identifiable natural person as defined in Article 4(1) of the GDPR.</li>
                <li><strong>"Processing"</strong> means any operation performed on Personal Data, including collection, recording, organization, structuring, storage, adaptation, alteration, retrieval, consultation, use, disclosure, erasure, or destruction.</li>
                <li><strong>"Data Subject"</strong> means the identified or identifiable natural person to whom the Personal Data relates.</li>
                <li><strong>"Sub-processor"</strong> means any third party engaged by the Processor to process Personal Data on behalf of the Controller.</li>
                <li><strong>"Controller"</strong> means the entity that determines the purposes and means of Processing Personal Data.</li>
                <li><strong>"Processor"</strong> means the entity that processes Personal Data on behalf of the Controller.</li>
                <li><strong>"Supervisory Authority"</strong> means the relevant data protection authority in the applicable jurisdiction.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">3. Scope &amp; Purpose of Processing</h2>
              <p className="mb-3">Liberty Bancard processes Personal Data solely for the purpose of providing the services described in the Merchant Processing Agreement and Terms of Service, including:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Facilitating merchant account applications and underwriting</li>
                <li>Processing and settling payment transactions (through our acquiring bank partners)</li>
                <li>Providing customer support and account management</li>
                <li>Communicating about account status, services, and relevant updates</li>
                <li>Compliance with legal and regulatory obligations</li>
                <li>Fraud prevention and security monitoring</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">4. Categories of Data &amp; Data Subjects</h2>
              <p className="mb-3"><strong>Categories of Data Subjects:</strong></p>
              <ul className="list-disc pl-6 space-y-1 mb-3">
                <li>Merchant owners, principals, and authorized representatives</li>
                <li>Merchant employees with access to the processing account</li>
                <li>Cardholders whose transactions are processed through the merchant's account</li>
              </ul>
              <p className="mb-3"><strong>Categories of Personal Data:</strong></p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Identity data (names, dates of birth, government ID numbers for KYC)</li>
                <li>Contact data (email, phone, address)</li>
                <li>Financial data (bank account details for settlement, processing history)</li>
                <li>Transaction data (transaction amounts, dates, merchant category codes)</li>
                <li>Technical data (IP addresses, device information, browser data)</li>
              </ul>
              <p className="mt-3">
                <strong>Note:</strong> Liberty Bancard does not process special categories of Personal Data (Article 9 GDPR) or criminal conviction data (Article 10 GDPR) except as required for KYC/AML compliance with appropriate legal basis.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">5. Processor Obligations</h2>
              <p className="mb-3">Liberty Bancard shall:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Process Personal Data only on documented instructions from the Controller, unless required by applicable law</li>
                <li>Ensure that persons authorized to process Personal Data are bound by confidentiality obligations</li>
                <li>Implement appropriate technical and organizational measures to ensure the security of Personal Data (Article 32 GDPR)</li>
                <li>Not engage Sub-processors without prior written authorization from the Controller (general or specific)</li>
                <li>Assist the Controller in responding to Data Subject rights requests (access, rectification, erasure, portability, restriction, objection)</li>
                <li>Assist the Controller in ensuring compliance with data protection impact assessments and prior consultations with supervisory authorities where required</li>
                <li>Delete or return all Personal Data upon termination of services, at the Controller's choice, unless retention is required by applicable law</li>
                <li>Make available to the Controller all information necessary to demonstrate compliance with this DPA and allow for audits and inspections</li>
                <li>Notify the Controller without undue delay (and in any event within 72 hours) after becoming aware of a Personal Data breach</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">6. Sub-processors</h2>
              <p className="mb-3">
                The Controller provides general authorization for Liberty Bancard to engage Sub-processors for the purposes described in this DPA. Current Sub-processors include:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Payment processor and acquiring bank partner(s) - transaction processing and settlement</li>
                <li>GoHighLevel (HighLevel Inc.) - CRM, communications (email, SMS), and workflow automation</li>
                <li>OpenAI - AI-powered features (data processed per OpenAI's data processing terms; no training on customer data)</li>
                <li>Hosting and infrastructure providers - secure data storage and application hosting</li>
              </ul>
              <p className="mt-3">
                Liberty Bancard will notify the Controller before adding or replacing any Sub-processor, providing the Controller an opportunity to object. Liberty Bancard will impose data protection obligations on Sub-processors that are no less protective than those in this DPA.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">7. International Data Transfers</h2>
              <p>
                Where Personal Data is transferred outside the European Economic Area (EEA), the United Kingdom, or other jurisdictions with data transfer restrictions, Liberty Bancard will ensure that appropriate safeguards are in place. These may include Standard Contractual Clauses (SCCs) approved by the European Commission (Commission Implementing Decision 2021/914), adequacy decisions, binding corporate rules, or other lawful transfer mechanisms. A copy of the applicable transfer mechanism can be obtained upon request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">8. Security Measures</h2>
              <p className="mb-3">Liberty Bancard implements appropriate technical and organizational measures including:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Encryption of data in transit (TLS 1.2+) and at rest</li>
                <li>Access controls with role-based permissions and least-privilege principles</li>
                <li>Secure password hashing (bcrypt)</li>
                <li>Regular security reviews and vulnerability assessments</li>
                <li>Incident response and breach notification procedures</li>
                <li>Employee training on data protection and security</li>
                <li>Physical security measures at data center facilities (via hosting providers)</li>
                <li>Business continuity and disaster recovery planning</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">9. Data Subject Rights</h2>
              <p>
                Liberty Bancard will assist the Controller in fulfilling its obligations to respond to Data Subject rights requests under applicable data protection law. This includes requests for access, rectification, erasure, restriction of processing, data portability, and objection. Liberty Bancard will promptly notify the Controller if it receives a request directly from a Data Subject and will not respond to such requests without the Controller's authorization, unless required by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">10. Data Breach Notification</h2>
              <p className="mb-3">
                In the event of a Personal Data breach, Liberty Bancard will:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Notify the Controller without undue delay and no later than 72 hours after becoming aware of the breach</li>
                <li>Provide the Controller with sufficient information to fulfill its own breach notification obligations under Articles 33 and 34 of the GDPR</li>
                <li>Take reasonable steps to mitigate the effects of the breach and prevent further unauthorized access</li>
                <li>Cooperate with the Controller and any supervisory authority in investigating and remediating the breach</li>
                <li>Document all facts relating to the breach, its effects, and the remedial actions taken</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">11. Audits</h2>
              <p>
                Liberty Bancard will make available to the Controller all information reasonably necessary to demonstrate compliance with this DPA. The Controller (or its authorized representative) may conduct audits, including inspections, upon reasonable notice (at least 30 days), during normal business hours, and no more than once per year, unless required by a supervisory authority or necessitated by a data breach. The Controller shall bear the costs of any audit unless the audit reveals material non-compliance by Liberty Bancard.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">12. Duration &amp; Termination</h2>
              <p>
                This DPA remains in effect for the duration of Liberty Bancard's processing of Personal Data on behalf of the Controller. Upon termination of the service agreement, Liberty Bancard will, at the Controller's choice, delete or return all Personal Data within 90 days, unless retention is required by applicable law. Liberty Bancard will certify deletion in writing upon request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">13. Governing Law</h2>
              <p>
                This DPA shall be governed by the laws that apply to the underlying service agreement between the parties. For EEA-based Controllers, the GDPR and applicable member state law shall apply to data protection matters. For UK-based Controllers, the UK GDPR and Data Protection Act 2018 shall apply. For matters not specifically addressed by data protection law, the governing law provisions of the Terms of Service shall apply.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">14. Contact</h2>
              <p className="mb-3">For questions about this Data Processing Agreement or to request a signed copy:</p>
              <div className="space-y-2">
                <a href="mailto:privacy@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>privacy@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" onClick={() => trackPhoneCallClick({ sourcePage: "/data-processing-agreement" })}>
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
