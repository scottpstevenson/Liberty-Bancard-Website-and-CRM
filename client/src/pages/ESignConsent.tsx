import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function ESignConsent() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="E-Sign Consent & Electronic Communications" description="Liberty Bancard electronic signature consent and electronic communications disclosure under the E-Sign Act." path="/esign-consent" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-esign-heading">
            E-Sign Consent &amp; Electronic Communications
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-esign-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">E-Sign Act Consent</h2>
              <p>
                By using Liberty Bancard's website, submitting forms, creating an account, or entering into a Merchant Processing Agreement, you consent to the use of electronic signatures, electronic records, and electronic delivery of documents in accordance with the Electronic Signatures in Global and National Commerce Act (E-Sign Act, 15 U.S.C. 7001 et seq.) and the Uniform Electronic Transactions Act (UETA) as adopted by the applicable state.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Scope of Consent</h2>
              <p className="mb-3">This consent applies to all documents, disclosures, notices, and communications related to your relationship with Liberty Bancard, including but not limited to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Merchant Processing Applications and Agreements</li>
                <li>Equipment placement and lease agreements</li>
                <li>Program terms and conditions</li>
                <li>Rate schedules and fee disclosures</li>
                <li>Privacy policies, terms of service, and other legal notices</li>
                <li>Account statements and billing notices</li>
                <li>Service updates and change notifications</li>
                <li>Correspondence and support communications</li>
                <li>Tax forms and regulatory disclosures (where permitted by law)</li>
                <li>Amendment or termination notices</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Electronic Delivery</h2>
              <p className="mb-3">
                You agree that Liberty Bancard may deliver all communications, documents, disclosures, and notices electronically by one or more of the following methods:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email to the address you provide on your application or account</li>
                <li>Posting on the Liberty Bancard website or merchant portal</li>
                <li>Through our CRM dashboard or account management system</li>
                <li>Via text message (SMS/MMS) to your mobile number on file</li>
                <li>Through a secure document delivery platform or e-signature service</li>
              </ul>
              <p className="mt-3">
                Electronic delivery has the same legal effect as physical delivery of paper documents. You agree that electronic records satisfy any requirement that communications be "in writing."
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Electronic Signatures</h2>
              <p className="mb-3">
                You agree that your electronic signature on any document or agreement has the same legal validity, enforceability, and admissibility as a handwritten signature. Electronic signatures may be captured through:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Clicking an "I Agree," "Accept," "Sign," or similar button</li>
                <li>Typing your name in a designated signature field</li>
                <li>Drawing your signature on a touchscreen or input device</li>
                <li>Using a third-party e-signature platform (e.g., DocuSign, HelloSign)</li>
                <li>Any other method that captures your intent to sign</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Hardware &amp; Software Requirements</h2>
              <p className="mb-3">
                To receive and retain electronic communications and documents, you will need:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>A device (computer, tablet, or smartphone) with internet access</li>
                <li>A current web browser that supports TLS 1.2 or higher (e.g., Chrome, Firefox, Safari, Edge)</li>
                <li>A valid email address capable of receiving attachments</li>
                <li>Sufficient storage to save or print documents for your records</li>
                <li>A PDF reader (e.g., Adobe Acrobat Reader) to view certain documents</li>
              </ul>
              <p className="mt-3">
                If our system requirements change in a way that may prevent you from accessing electronic communications, we will notify you and provide you the option to withdraw consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Right to Paper Copies</h2>
              <p>
                You have the right to receive any document or communication in paper form. To request a paper copy of any electronic document, contact us at <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or call 954-266-8214. We will provide paper copies at no charge; however, we reserve the right to charge a reasonable fee for excessive requests. Requesting a paper copy does not withdraw your consent to electronic communications.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Withdrawing Consent</h2>
              <p className="mb-3">
                You may withdraw your consent to receive electronic communications at any time by contacting us in writing at <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or by calling 954-266-8214. Please note:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Withdrawing consent does not affect the legal validity of any electronic signature or document previously executed or delivered.</li>
                <li>Withdrawing consent may affect your ability to use certain services or features that require electronic communication.</li>
                <li>Some services, including online account management, may not be available without electronic communications consent.</li>
                <li>We will process your withdrawal within 10 business days and confirm via your preferred communication method.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Updating Your Contact Information</h2>
              <p>
                It is your responsibility to keep your email address, phone number, and mailing address current with Liberty Bancard. If your contact information changes, please update it promptly by contacting us at <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or calling 954-266-8214. We are not responsible for communications that fail to reach you due to outdated contact information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Record Retention</h2>
              <p>
                We recommend that you print or save a copy of all electronic documents and communications for your records. Liberty Bancard retains electronic records in accordance with applicable legal and regulatory requirements. You may request access to your electronic records at any time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about electronic communications or this consent:</p>
              <div className="space-y-2">
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
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
