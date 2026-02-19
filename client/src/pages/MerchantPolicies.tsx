import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function MerchantPolicies() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Merchant Policies - Chargebacks, Refunds & Cancellation" description="Liberty Bancard merchant policies covering chargeback procedures, dispute resolution, refund policy, and account cancellation." path="/merchant-policies" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-merchant-policies-heading">
            Merchant Policies
          </h1>
          <p className="text-sm text-muted-foreground mb-4" data-testid="text-merchant-policies-subtitle">
            Chargeback &amp; Dispute Policy | Refund &amp; Cancellation Policy
          </p>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-merchant-policies-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <div className="border-b border-border pb-2">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-chargeback-section">
                Chargeback &amp; Dispute Policy
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Overview</h2>
              <p>
                Chargebacks (also known as payment disputes) occur when a cardholder disputes a transaction with their issuing bank. As an Independent Sales Organization (ISO), Liberty Bancard facilitates the chargeback process between the merchant, the acquiring bank, and the card brands. This policy outlines merchant responsibilities, timelines, and procedures for handling chargebacks.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Merchant Responsibilities</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Respond Promptly:</strong> Merchants must respond to chargeback notifications within the timeframe specified by the card brand (typically 7-30 days depending on the card network and chargeback reason code). Failure to respond within the deadline results in automatic loss of the dispute.</li>
                <li><strong>Provide Documentation:</strong> Merchants must submit compelling evidence to support their case, including signed receipts, delivery confirmations, communication records, refund policy acknowledgments, and any other relevant documentation.</li>
                <li><strong>Monitor Chargeback Ratios:</strong> Merchants are responsible for maintaining chargeback ratios below card brand thresholds. Visa's threshold is 0.9% of transactions and 100 chargebacks per month. Mastercard's threshold is 1.0% of transactions. Exceeding these thresholds may result in enrollment in a monitoring program, additional fees, or account termination.</li>
                <li><strong>Maintain Records:</strong> Merchants should retain transaction records, signed receipts, delivery confirmations, and customer communications for a minimum of 24 months (or longer as required by the applicable card brand).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Chargeback Process</h2>
              <ol className="list-decimal pl-6 space-y-2">
                <li><strong>Notification:</strong> When a chargeback is filed, Liberty Bancard notifies the merchant via email and/or the merchant dashboard. The notification includes the transaction details, reason code, and response deadline.</li>
                <li><strong>Provisional Debit:</strong> The disputed amount is temporarily debited from the merchant's account and held by the acquiring bank pending resolution.</li>
                <li><strong>Merchant Response (Representment):</strong> The merchant may accept the chargeback or submit a rebuttal with supporting documentation. Liberty Bancard assists merchants in preparing their response.</li>
                <li><strong>Issuer Review:</strong> The cardholder's issuing bank reviews the merchant's evidence and makes a determination.</li>
                <li><strong>Resolution:</strong> If the merchant wins, the funds are returned to the merchant's account. If the cardholder wins, the debit becomes permanent. In some cases, the merchant may proceed to pre-arbitration or arbitration (subject to additional fees).</li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Chargeback Fees</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>A chargeback fee is assessed per dispute as specified in the Merchant Processing Agreement (typically $15-$35 per chargeback).</li>
                <li>Additional fees may apply for pre-arbitration and arbitration cases (card brand fees ranging from $150-$500).</li>
                <li>Merchants enrolled in card brand monitoring programs (e.g., Visa Dispute Monitoring Program, Mastercard Excessive Chargeback Program) may incur additional monthly fees.</li>
                <li>Excessive chargebacks may result in increased processing rates, reserve requirements, or account termination.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Chargeback Prevention</h2>
              <p className="mb-3">Liberty Bancard recommends the following best practices to minimize chargebacks:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Use clear and recognizable billing descriptors</li>
                <li>Obtain signed receipts or electronic authorizations for all transactions</li>
                <li>Respond promptly to customer inquiries and refund requests</li>
                <li>Ship with tracking and require signature confirmation for high-value orders</li>
                <li>Clearly display refund and return policies</li>
                <li>Use Address Verification Service (AVS) and CVV verification for card-not-present transactions</li>
                <li>Implement 3D Secure authentication where available</li>
                <li>Consider chargeback alert services (e.g., Ethoca, Verifi) that allow you to issue refunds before disputes are filed</li>
              </ul>
            </section>

            <div className="border-b border-border pb-2 pt-8">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-refund-section">
                Refund &amp; Cancellation Policy
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Account Cancellation Process</h2>
              <p className="mb-3">
                Merchants may request cancellation of their processing account at any time. To initiate cancellation:
              </p>
              <ol className="list-decimal pl-6 space-y-1">
                <li>Submit a written cancellation request via email to <a href="mailto:support@libertybancard.com" className="underline">support@libertybancard.com</a> or by calling 954-266-8214.</li>
                <li>Include your business name, merchant ID number (MID), and the requested closure date.</li>
                <li>Liberty Bancard will confirm receipt and process the request within 5-10 business days.</li>
                <li>Return any equipment provided under the free terminal program within 30 days of account closure.</li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Early Termination</h2>
              <p className="mb-3">
                If a merchant cancels their processing account before the end of the initial contract term or any renewal term, the following may apply:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Early Termination Fee (ETF):</strong> As specified in the signed Merchant Processing Agreement (typically $295-$595 depending on the program and remaining term). Some programs may offer reduced or waived ETFs under certain conditions.</li>
                <li><strong>Equipment Return:</strong> All equipment provided under the free terminal program must be returned in good working condition. A non-return fee may apply as specified in the agreement.</li>
                <li><strong>Outstanding Fees:</strong> Any outstanding processing fees, chargeback fees, monthly fees, or other account-level charges must be settled before the account can be fully closed.</li>
                <li><strong>Reserve Holds:</strong> The acquiring bank may retain a reserve for up to 180 days after account closure to cover potential chargebacks or adjustments.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Refund of Fees</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Processing Fees:</strong> Processing fees for completed transactions are non-refundable. These fees are earned at the time of transaction settlement.</li>
                <li><strong>Monthly/Annual Fees:</strong> Monthly fees are billed in arrears and are non-refundable. Annual fees (e.g., PCI compliance annual fee) are non-refundable once charged. If you cancel mid-cycle, you will be responsible for fees through the end of the current billing period.</li>
                <li><strong>Setup Fees:</strong> Any one-time setup or activation fees are non-refundable after the account has been activated and the first batch has been processed.</li>
                <li><strong>Billing Errors:</strong> If you believe you have been charged in error, contact us within 60 days of the charge. We will investigate and credit your account if an error is confirmed.</li>
                <li><strong>Overpayments:</strong> If an overpayment is identified, Liberty Bancard will refund the overpayment within 30 business days of confirmation.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Final Statement &amp; Settlement</h2>
              <p>
                After account closure, a final statement will be issued reflecting any remaining fees, adjustments, or credits. Final settlement of all outstanding balances will occur within 30-60 days of account closure, subject to the reserve hold period. The merchant will receive a written confirmation once the account is fully closed and all obligations have been satisfied.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Governing Agreement</h2>
              <p>
                In the event of a conflict between this policy and the signed Merchant Processing Agreement, the Merchant Processing Agreement shall control. This policy provides a general overview; specific terms are governed by your signed agreement with Liberty Bancard and the acquiring bank.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For chargeback assistance, refund inquiries, or cancellation requests:</p>
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
