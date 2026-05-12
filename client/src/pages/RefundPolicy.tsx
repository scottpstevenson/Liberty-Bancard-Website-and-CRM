import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function RefundPolicy() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Refund & Cancellation Policy | Liberty Bancard"
        description="Liberty Bancard refund and cancellation policy. Understand our policies for account cancellation, early termination, equipment returns, and fee refunds."
        path="/refund-policy"
        keywords="refund policy, cancellation policy, early termination, equipment return, Liberty Bancard"
        breadcrumbs={[{ name: "Refund Policy", path: "/refund-policy" }]}
        structuredData={getBreadcrumbSchema([{ name: "Refund Policy", path: "/refund-policy" }])}
      />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <nav className="text-sm text-muted-foreground mb-6" aria-label="Breadcrumb" data-testid="breadcrumb-refund">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">Refund & Cancellation Policy</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-refund-heading">
            Refund &amp; Cancellation Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-refund-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-refund-intro">
              <p>
                This Refund and Cancellation Policy describes Liberty Bancard's policies regarding account cancellation, early termination, equipment returns, and refund eligibility. Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. <strong>Liberty Bancard is not a bank.</strong> Merchant accounts are underwritten and maintained by our acquiring bank partner(s). The specific terms of your merchant account are governed by your signed Merchant Processing Agreement (MPA).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Account Cancellation</h2>
              <p className="mb-3">
                You may request cancellation of your merchant processing account at any time by contacting Liberty Bancard in writing. To initiate a cancellation, please:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Email your cancellation request to <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> with the subject line "Account Cancellation Request"</li>
                <li>Include your business name, merchant ID (MID), and the name of the authorized signer on the account</li>
                <li>Call 954-266-8214 to speak with a representative about your cancellation</li>
              </ul>
              <p className="mt-3">
                Cancellation requests are typically processed within 5-10 business days. You will receive written confirmation when your account has been closed. You are responsible for all fees, transactions, and chargebacks that occur prior to the effective date of cancellation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Early Termination Fee (ETF)</h2>
              <p className="mb-3">
                If your Merchant Processing Agreement includes a contract term (commonly 1-3 years), cancellation before the end of the initial term or any renewal term may result in an early termination fee (ETF). Key details include:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>ETF Amount:</strong> The early termination fee amount is disclosed in your signed Merchant Processing Agreement and typically ranges from $295 to $595, depending on the program, equipment placement, and remaining contract term.</li>
                <li><strong>No-ETF Programs:</strong> Some Liberty Bancard programs offer month-to-month agreements with no early termination fee. Ask your representative about no-ETF options.</li>
                <li><strong>Waiver Requests:</strong> In certain circumstances, Liberty Bancard may consider ETF waiver requests on a case-by-case basis. Contact us to discuss your specific situation.</li>
                <li><strong>Auto-Renewal:</strong> If your agreement auto-renews, you may cancel during the renewal period without an ETF by providing written notice at least 30-90 days before the renewal date, as specified in your agreement.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Equipment Returns</h2>
              <p className="mb-3">
                If you received equipment (terminals, POS devices, pin pads) through Liberty Bancard's equipment placement or free terminal program:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Return Requirement:</strong> Equipment provided under a loaner, placement, or lease program must be returned in good working condition within 30 days of account closure.</li>
                <li><strong>Return Shipping:</strong> You are responsible for return shipping costs unless otherwise specified in your agreement. We recommend using a tracked and insured shipping method.</li>
                <li><strong>Non-Return Fee:</strong> Failure to return equipment within 30 days may result in a non-return fee as specified in your Merchant Processing Agreement (typically $300-$800 depending on the equipment model).</li>
                <li><strong>Damaged Equipment:</strong> Equipment returned in damaged condition (beyond normal wear and tear) may be subject to a damage fee or replacement cost.</li>
                <li><strong>Purchased Equipment:</strong> Equipment that was purchased outright by the merchant does not need to be returned and is the merchant's property.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Fee Refunds</h2>
              <p className="mb-3">Liberty Bancard's refund policy for processing fees and charges is as follows:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Processing Fees:</strong> Processing fees (interchange, markup, transaction fees) are earned upon transaction processing and are generally non-refundable. These fees are charged by the card networks and acquiring bank and cannot be reversed after settlement.</li>
                <li><strong>Monthly Fees:</strong> Monthly fees (statement fees, PCI compliance fees, monthly minimums) are generally non-refundable for the month in which they were assessed. If your account was billed in error, we will issue a credit or refund for the erroneous charge.</li>
                <li><strong>Setup Fees:</strong> One-time setup or activation fees are non-refundable once your account has been activated and approved.</li>
                <li><strong>Billing Errors:</strong> If you believe you were charged in error, contact us within 60 days of the charge. We will investigate and, if an error is confirmed, issue a refund or credit within 30 business days.</li>
                <li><strong>Overcharges:</strong> If a rate or fee was applied incorrectly (different from what was agreed upon in your Merchant Processing Agreement), we will correct the error and issue a refund or credit for the difference.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Chargebacks and Disputes</h2>
              <p>
                Chargebacks (transaction disputes initiated by cardholders) are handled by the card networks and acquiring bank, not by Liberty Bancard. Chargeback fees are non-refundable. If you receive a chargeback, you will be notified and given an opportunity to respond. For more information on chargeback procedures, see your Merchant Processing Agreement or contact our support team. For details on our dispute resolution process, see our <Link href="/dispute-resolution" className="underline">Dispute Resolution Policy</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Reserves and Holdbacks</h2>
              <p>
                Some merchant accounts may have a reserve or holdback placed on their account by the acquiring bank as part of the underwriting process. Reserves are held to cover potential chargebacks, refunds, or other liabilities. Upon account closure, reserves are typically released after a holding period (commonly 90-180 days) once all potential liabilities have cleared. The specific terms of any reserve are outlined in your Merchant Processing Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Cooling-Off Period</h2>
              <p>
                Some states provide a cooling-off period during which you may cancel a new contract without penalty. If your state provides such protections, they apply to your Merchant Processing Agreement. Contact us if you wish to exercise a cooling-off period cancellation right within the applicable timeframe.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How to Request a Refund</h2>
              <p className="mb-3">To request a refund or dispute a charge:</p>
              <ol className="list-decimal pl-6 space-y-2">
                <li>Contact our support team at <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or call 954-266-8214</li>
                <li>Provide your business name, merchant ID (MID), and a description of the charge in question</li>
                <li>Include any supporting documentation (statements, screenshots, correspondence)</li>
                <li>We will investigate your request and respond within 10 business days</li>
                <li>If a refund is approved, it will be issued to your bank account on file within 30 business days</li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Governing Terms</h2>
              <p>
                In the event of a conflict between this Refund and Cancellation Policy and your signed Merchant Processing Agreement, the Merchant Processing Agreement shall control. This policy is provided for general informational purposes and does not supersede or modify any contractual agreement between you and Liberty Bancard or the acquiring bank.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Related Policies</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><Link href="/terms" className="underline">Terms of Service</Link></li>
                <li><Link href="/merchant-policies" className="underline">Merchant Policies</Link></li>
                <li><Link href="/dispute-resolution" className="underline">Dispute Resolution</Link></li>
                <li><Link href="/privacy-policy" className="underline">Privacy Policy</Link></li>
              </ul>
            </section>

            <section data-testid="section-refund-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about refunds, cancellations, or this policy:</p>
              <div className="space-y-2">
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-refund-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-refund-phone">
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