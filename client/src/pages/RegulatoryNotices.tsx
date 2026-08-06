import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";

export default function RegulatoryNotices() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Regulatory Notices - Do Not Call & DMCA" description="Liberty Bancard regulatory notices covering our Do Not Call policy, DMCA copyright procedures, and compliance with federal communications regulations." path="/regulatory-notices" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-regulatory-heading">
            Regulatory Notices
          </h1>
          <p className="text-sm text-muted-foreground mb-4" data-testid="text-regulatory-subtitle">
            Do Not Call Policy | DMCA Copyright Notice
          </p>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-regulatory-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <div className="border-b border-border pb-2">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-dnc-section">
                Do Not Call Policy
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment</h2>
              <p>
                Liberty Bancard is committed to complying with the Telephone Consumer Protection Act (TCPA, 47 U.S.C. 227), the FTC Telemarketing Sales Rule (TSR, 16 CFR Part 310), the National Do Not Call Registry, and all applicable state do-not-call and telemarketing regulations. This policy applies to all outbound telephone calls and text messages made by Liberty Bancard, its employees, agents, and authorized third-party vendors.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Do Not Call Procedures</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>National Do Not Call Registry:</strong> Liberty Bancard maintains and regularly updates a suppression list that includes all numbers registered on the National Do Not Call Registry. We scrub our calling lists against the registry at least every 31 days as required by the TSR.</li>
                <li><strong>Internal Do Not Call List:</strong> We maintain an internal do-not-call list of individuals who have requested not to be contacted by Liberty Bancard. Requests are processed within 30 days and remain in effect permanently unless you request to be removed.</li>
                <li><strong>State Do Not Call Lists:</strong> We comply with all applicable state-level do-not-call registries and telemarketing regulations, which may provide additional protections beyond federal law.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Opt Out</h2>
              <p className="mb-3">To be placed on our internal do-not-call list, you may:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Tell the caller during any call that you do not wish to be called again</li>
                <li>Reply STOP to any text message from Liberty Bancard</li>
                <li>Email <a href="mailto:donotcall@libertybancard.com" className="underline">donotcall@libertybancard.com</a> with your name and phone number(s)</li>
                <li>Call 954-266-8214 and request to be added to our do-not-call list</li>
                <li>Register your number with the National Do Not Call Registry at <a href="https://www.donotcall.gov" className="underline" target="_blank" rel="noopener noreferrer">donotcall.gov</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Calling Hours</h2>
              <p>
                Liberty Bancard limits outbound marketing calls and text messages to the hours of 8:00 AM to 9:00 PM in the recipient's local time zone, as required by the TCPA. Time-sensitive account alerts or messages sent in response to an inbound inquiry may be delivered outside these hours.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Exemptions</h2>
              <p className="mb-3">The following communications are not subject to do-not-call restrictions under applicable law:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Calls made with your prior express written consent (e.g., after submitting a form with TCPA consent language)</li>
                <li>Calls or messages related to an existing business relationship (account servicing, transaction confirmations, chargeback notifications)</li>
                <li>Calls required by law or regulation</li>
              </ul>
              <p className="mt-3 text-xs">
                Even with an existing business relationship or prior consent, you may request to be placed on our do-not-call list at any time using the methods above, and we will honor that request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Complaints</h2>
              <p>
                If you believe Liberty Bancard has contacted you in violation of this policy or applicable telemarketing laws, please contact us immediately at <a href="mailto:compliance@libertybancard.com" className="underline">compliance@libertybancard.com</a> or call 954-266-8214. We take all complaints seriously and will investigate promptly. You may also file a complaint with the Federal Trade Commission at <a href="https://www.ftc.gov" className="underline" target="_blank" rel="noopener noreferrer">ftc.gov</a> or with your state attorney general's office.
              </p>
            </section>

            <div className="border-b border-border pb-2 pt-8">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-dmca-section">
                DMCA Copyright Notice
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Copyright Protection</h2>
              <p>
                All content on the Liberty Bancard website, including text, graphics, logos, images, audio, video, software, data compilations, and the design, selection, and arrangement thereof, is the exclusive property of Liberty Bancard or its content suppliers and is protected by United States and international copyright laws (17 U.S.C. 101 et seq.). All rights reserved.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">DMCA Takedown Procedure</h2>
              <p className="mb-3">
                Liberty Bancard respects the intellectual property rights of others and complies with the Digital Millennium Copyright Act (DMCA, 17 U.S.C. 512). If you believe that content on our website infringes your copyright, you may submit a DMCA takedown notice to our designated agent with the following information:
              </p>
              <ol className="list-decimal pl-6 space-y-1">
                <li>A physical or electronic signature of the copyright owner or a person authorized to act on their behalf</li>
                <li>Identification of the copyrighted work claimed to have been infringed</li>
                <li>Identification of the material that is claimed to be infringing, with sufficient detail to allow us to locate it (e.g., URL)</li>
                <li>Your contact information: name, address, telephone number, and email address</li>
                <li>A statement that you have a good-faith belief that the use of the material is not authorized by the copyright owner, its agent, or the law</li>
                <li>A statement, made under penalty of perjury, that the information in the notice is accurate and that you are authorized to act on behalf of the copyright owner</li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Designated DMCA Agent</h2>
              <p className="mb-3">Send DMCA takedown notices to:</p>
              <div className="space-y-2">
                <p className="text-foreground font-medium">Liberty Bancard - DMCA Agent</p>
                <a href="mailto:legal@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>legal@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" onClick={() => trackPhoneCallClick({ sourcePage: "/regulatory-notices" })}>
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Counter-Notification</h2>
              <p>
                If you believe that material removed or disabled as a result of a DMCA takedown notice was not infringing, or that you have authorization to use the material, you may submit a counter-notification to our designated agent. The counter-notification must include the information specified in 17 U.S.C. 512(g)(3). Upon receipt of a valid counter-notification, we will provide a copy to the original complainant and restore the material within 10-14 business days unless the complainant files a court action.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Repeat Infringers</h2>
              <p>
                Liberty Bancard will terminate access for users who are repeat copyright infringers in appropriate circumstances, in accordance with 17 U.S.C. 512(i).
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
