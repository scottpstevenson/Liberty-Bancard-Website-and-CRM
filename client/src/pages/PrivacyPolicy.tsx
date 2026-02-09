import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-privacy-heading">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-privacy-updated">
            Last updated: January 26, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-privacy-intro">
              <p>
                Liberty Bancard respects your privacy and is committed to protecting the personal information you share with us. This Privacy Policy describes how we collect, use, share, and protect your information when you visit our website, submit forms, upload documents, or communicate with us.
              </p>
            </section>

            <section data-testid="section-privacy-collect">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Information We Collect</h2>
              <p className="mb-3">We may collect the following types of information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Contact information (name, email address, phone number)</li>
                <li>Business information (company name, industry, monthly processing volume, current provider)</li>
                <li>Files you upload (such as processing statements)</li>
                <li>Communication data (messages you send us via forms, email, SMS, or chat)</li>
                <li>Website usage data (pages visited, time on site, browser type, IP address)</li>
              </ul>
            </section>

            <section data-testid="section-privacy-use">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Use Your Information</h2>
              <p className="mb-3">We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Respond to your inquiries and provide requested services</li>
                <li>Communicate with you about your account, our services, and relevant updates</li>
                <li>Improve our website, products, and services</li>
                <li>Comply with applicable laws, regulations, and legal processes</li>
              </ul>
            </section>

            <section data-testid="section-privacy-texts">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Text Messages and Emails</h2>
              <p>
                By providing your phone number and/or email address and opting in, you consent to receive text messages and emails from Liberty Bancard related to your inquiry, account, or services. You may opt out of text messages at any time by replying STOP. Message and data rates may apply. Message frequency varies.
              </p>
            </section>

            <section data-testid="section-privacy-share">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Share Your Information</h2>
              <p>
                We do not sell your personal information. We may share your information with trusted service providers who assist us in operating our website and delivering our services, subject to confidentiality agreements. We may also disclose information when required by law or to protect our rights.
              </p>
            </section>

            <section data-testid="section-privacy-security">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Security</h2>
              <p>
                We implement reasonable administrative, technical, and physical measures to protect your information. However, no method of transmission over the internet or electronic storage is 100% secure. We encourage you to redact sensitive account numbers from any documents you upload.
              </p>
            </section>

            <section data-testid="section-privacy-retention">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Retention</h2>
              <p>
                We retain your personal information for as long as necessary to fulfill the purposes described in this policy, comply with legal obligations, resolve disputes, and enforce our agreements.
              </p>
            </section>

            <section data-testid="section-privacy-choices">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Choices</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>You may opt out of SMS communications by replying STOP to any text message.</li>
                <li>You may unsubscribe from marketing emails by clicking the unsubscribe link in any email.</li>
                <li>You may request access to, correction of, or deletion of your personal information by contacting us.</li>
              </ul>
            </section>

            <section data-testid="section-privacy-children">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Children's Privacy</h2>
              <p>
                Our website and services are not directed to children under the age of 18. We do not knowingly collect personal information from children.
              </p>
            </section>

            <section data-testid="section-privacy-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">
                If you have questions about this Privacy Policy or wish to exercise your rights, please contact us:
              </p>
              <div className="space-y-2">
                <a
                  href="mailto:support@libertybancard.com"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  data-testid="link-privacy-email"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a
                  href="tel:9542668214"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  data-testid="link-privacy-phone"
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
