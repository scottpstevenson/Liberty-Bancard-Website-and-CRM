import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function SmsTerms() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="SMS Terms & Conditions | Liberty Bancard" description="Liberty Bancard SMS text messaging terms and conditions. Covers carrier compliance, message frequency, opt-out instructions, and applicable data rates." path="/sms-terms" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-sms-terms-heading">
            SMS Terms &amp; Conditions
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-sms-terms-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Program Overview</h2>
              <p>
                By opting in to receive text messages from Liberty Bancard, you agree to receive recurring automated SMS and MMS messages related to your inquiry, merchant account, payment processing services, appointment reminders, service updates, and promotional offers. The Liberty Bancard SMS program is operated by Liberty Bancard, a registered Independent Sales Organization (ISO) and merchant services provider.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Consent &amp; Opt-In</h2>
              <p className="mb-3">
                By providing your mobile phone number and checking the consent box on any Liberty Bancard form, or by texting a keyword to our designated number, you provide your prior express written consent under the Telephone Consumer Protection Act (TCPA, 47 U.S.C. 227) to receive autodialed and/or prerecorded text messages from Liberty Bancard and its agents at the mobile number you provide.
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Consent is not a condition of purchase or service.</li>
                <li>You may opt in by submitting a web form with the SMS consent checkbox, texting a keyword (e.g., START) to our designated number, or verbally consenting during a phone call (recorded for compliance).</li>
                <li>Your consent covers informational messages (account updates, appointment reminders, service notifications) and promotional messages (offers, savings opportunities, program updates).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Message Frequency &amp; Content</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Message frequency varies.</strong> You may receive up to 10 messages per month depending on your account activity and communication preferences.</li>
                <li>Message types include: inquiry follow-ups, appointment confirmations and reminders, account status updates, statement review results, proposal notifications, onboarding updates, service alerts, and promotional offers.</li>
                <li>Messages are sent during standard business hours (9 AM - 8 PM ET) unless they are time-sensitive account alerts.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Opt-Out Instructions</h2>
              <p className="mb-3">
                You may opt out of receiving text messages at any time using any of the following methods:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Reply STOP:</strong> Text STOP, QUIT, CANCEL, END, or UNSUBSCRIBE to any message from Liberty Bancard. You will receive a one-time confirmation message and no further messages will be sent.</li>
                <li><strong>Contact Us:</strong> Call 954-266-8214 or email <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> to request removal from our SMS list.</li>
              </ul>
              <p className="mt-3">
                After opting out, you may still receive a single confirmation message. If you wish to re-enroll, you may text START or re-submit a consent form on our website.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Help &amp; Support</h2>
              <p>
                For help or questions about our SMS program, text HELP to any Liberty Bancard message, call 954-266-8214, or email <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a>. Our support team is available Monday through Friday, 9 AM - 6 PM ET.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Costs &amp; Data Rates</h2>
              <p>
                <strong>Message and data rates may apply.</strong> Liberty Bancard does not charge for text messages, but your mobile carrier may charge standard messaging and data fees. Check your mobile plan for details. Liberty Bancard is not responsible for any charges imposed by your carrier.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Carrier Disclaimer</h2>
              <p>
                <strong>Carriers are not liable for delayed or undelivered messages.</strong> Message delivery is subject to effective transmission by your mobile carrier. T-Mobile, AT&amp;T, Verizon, and other carriers are not responsible for the content, timeliness, accuracy, or delivery of messages sent by or on behalf of Liberty Bancard. Liberty Bancard is not responsible for messages that fail to send or are delayed due to carrier network issues, device incompatibility, or service outages.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Supported Carriers</h2>
              <p>
                Our SMS program is compatible with most major U.S. carriers including AT&amp;T, T-Mobile, Verizon, Sprint, U.S. Cellular, and others. Some carriers may not support all message types (e.g., MMS). If your carrier does not support our messaging, you may not receive messages from Liberty Bancard.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Privacy &amp; Data Use</h2>
              <p>
                Your phone number and opt-in consent are collected solely for the purpose of sending you the messages described above. We do not sell, rent, or share your phone number or opt-in information with third parties for their marketing purposes. Your information is handled in accordance with our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>. Phone numbers collected for SMS are stored securely and used only by Liberty Bancard and its authorized service providers (e.g., GoHighLevel) for the stated purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Compliance</h2>
              <p>
                This SMS program complies with the Telephone Consumer Protection Act (TCPA), the CAN-SPAM Act, the Cellular Telecommunications Industry Association (CTIA) Messaging Principles and Best Practices, and applicable state regulations. Liberty Bancard maintains records of opt-in consent as required by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Changes to SMS Terms</h2>
              <p>
                We may update these SMS Terms from time to time. Material changes will be posted on this page with a revised "Last updated" date. Continued participation in the SMS program after changes are posted constitutes acceptance of the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Information</h2>
              <p className="mb-3">For questions about our SMS program:</p>
              <div className="space-y-2">
                <p className="text-foreground font-medium">Liberty Bancard</p>
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
