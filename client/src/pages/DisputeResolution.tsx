import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function DisputeResolution() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Dispute Resolution - How to File a Dispute" description="Liberty Bancard dispute resolution process. Learn how to file a complaint, our response timeline, and how arbitration works for merchant disputes." path="/dispute-resolution" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-dispute-resolution-heading">
            Dispute Resolution
          </h1>
          <p className="text-sm text-muted-foreground mb-4" data-testid="text-dispute-resolution-subtitle">
            How to File a Complaint or Dispute
          </p>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-dispute-resolution-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment</h2>
              <p>
                Liberty Bancard is committed to resolving disputes fairly, promptly, and transparently. We take all complaints seriously and strive to reach a resolution that satisfies both parties. This page outlines the steps you can take to resolve a dispute or file a complaint.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Step 1: Contact Our Support Team</h2>
              <p className="mb-3">
                Most issues can be resolved quickly by contacting our support team directly. Before filing a formal dispute, we encourage you to reach out:
              </p>
              <div className="space-y-2 mb-4">
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214 (Mon-Fri 9 AM - 6 PM ET)</span>
                </a>
              </div>
              <p>
                When contacting support, please include your business name, merchant ID (if applicable), a clear description of the issue, and any supporting documentation (statements, correspondence, screenshots). Our support team will respond within 1 business day and work to resolve the issue.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Step 2: Escalation to Management</h2>
              <p>
                If our support team is unable to resolve your issue to your satisfaction, you may request escalation to management. Escalated complaints are reviewed by a senior manager within 5 business days. To escalate, reply to your existing support correspondence with "REQUEST ESCALATION" in the subject line, or email <a href="mailto:complaints@libertybancard.com" className="underline">complaints@libertybancard.com</a> directly with the details of your complaint and the support ticket reference number.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Step 3: Formal Written Complaint</h2>
              <p className="mb-3">
                If your issue remains unresolved after escalation, you may submit a formal written complaint. Your written complaint should include:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Your full name and business name</li>
                <li>Merchant ID number (if applicable)</li>
                <li>A detailed description of the complaint</li>
                <li>Dates and timeline of events</li>
                <li>Copies of relevant documents, statements, or correspondence</li>
                <li>The resolution you are seeking</li>
                <li>Your preferred contact method and availability</li>
              </ul>
              <p className="mt-3">
                Submit your formal complaint to <a href="mailto:complaints@libertybancard.com" className="underline">complaints@libertybancard.com</a> with "FORMAL COMPLAINT" in the subject line. We will acknowledge receipt within 3 business days and provide a written response within 15 business days.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Step 4: Mediation (Optional)</h2>
              <p>
                Before proceeding to binding arbitration, either party may propose voluntary mediation. Mediation involves a neutral third-party mediator who facilitates discussion and helps both parties reach a mutually acceptable resolution. Mediation is non-binding and confidential. If both parties agree to mediation, Liberty Bancard will share the cost of the mediator equally with the complainant. Mediation may be conducted in person, by phone, or by video conference.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Step 5: Binding Arbitration</h2>
              <p className="mb-3">
                As outlined in our <Link href="/terms" className="underline">Terms of Service</Link>, disputes that cannot be resolved through the steps above are subject to binding arbitration under the Federal Arbitration Act (FAA, 9 U.S.C. 1 et seq.) and the rules of the American Arbitration Association (AAA).
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Individual Basis:</strong> Arbitration is conducted on an individual basis. Class actions, class arbitrations, and representative actions are waived to the fullest extent permitted by law.</li>
                <li><strong>Location:</strong> Arbitration will be conducted in Broward County, Florida, or by mutual agreement at another location or remotely.</li>
                <li><strong>Costs:</strong> For claims under $10,000, Liberty Bancard will pay all arbitration filing fees and administrative costs. For claims over $10,000, costs are shared as provided by the AAA Commercial Arbitration Rules.</li>
                <li><strong>Decision:</strong> The arbitrator's decision is final and binding. Judgment on the award may be entered in any court of competent jurisdiction.</li>
                <li><strong>Opt-Out:</strong> You may opt out of the arbitration provision within 30 days of entering into an agreement with Liberty Bancard by sending written notice to <a href="mailto:legal@libertybancard.com" className="underline">legal@libertybancard.com</a>.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Small Claims Court</h2>
              <p>
                Notwithstanding the arbitration provision, either party may bring an individual action in small claims court for disputes within that court's jurisdictional limits. If the action is removed from small claims court or transferred to a court of general jurisdiction, the arbitration provision applies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Billing Disputes</h2>
              <p className="mb-3">
                If you believe you have been charged in error or have a billing-related dispute:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Contact support within 60 days of the date the charge appeared on your statement</li>
                <li>Provide a clear description of the disputed charge, including the amount and date</li>
                <li>We will investigate and respond within 15 business days</li>
                <li>If an error is confirmed, a credit will be applied to your account within the next billing cycle</li>
                <li>During the investigation, the disputed amount will not be subject to collection activity</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">External Resources</h2>
              <p className="mb-3">If you are unable to resolve your dispute through our internal process, you may also contact:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Better Business Bureau (BBB):</strong> <a href="https://www.bbb.org" className="underline" target="_blank" rel="noopener noreferrer">bbb.org</a></li>
                <li><strong>Florida Attorney General:</strong> <a href="https://www.myfloridalegal.com" className="underline" target="_blank" rel="noopener noreferrer">myfloridalegal.com</a></li>
                <li><strong>Consumer Financial Protection Bureau (CFPB):</strong> <a href="https://www.consumerfinance.gov/complaint" className="underline" target="_blank" rel="noopener noreferrer">consumerfinance.gov/complaint</a></li>
                <li><strong>Federal Trade Commission (FTC):</strong> <a href="https://www.ftc.gov/complaint" className="underline" target="_blank" rel="noopener noreferrer">ftc.gov/complaint</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">No Retaliation</h2>
              <p>
                Liberty Bancard will not retaliate against any merchant or customer for filing a complaint, dispute, or arbitration claim. Your account status, pricing, and service level will not be adversely affected by exercising your rights under this dispute resolution process.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
