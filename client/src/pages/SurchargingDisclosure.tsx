import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function SurchargingDisclosure() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Surcharging & Cash Discount Disclosures" description="Liberty Bancard surcharging and cash discount program disclosures, state-by-state compliance, and card brand requirements." path="/surcharging-disclosure" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-surcharging-heading">
            Surcharging &amp; Cash Discount Program Disclosures
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-surcharging-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Overview</h2>
              <p>
                Liberty Bancard offers compliant "0% processing" programs that allow merchants to offset or eliminate their credit card processing costs. These programs fall into two categories: <strong>Cash Discount Programs</strong> and <strong>Compliant Surcharging Programs</strong>. This page discloses the regulatory requirements, state-by-state considerations, card brand rules, and merchant obligations associated with each program type. Liberty Bancard is a registered Independent Sales Organization (ISO) and is not a bank or direct processor.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Cash Discount Programs</h2>
              <p className="mb-3">
                A cash discount program offers customers a discount for paying with cash (or non-credit methods) rather than credit card. All posted prices reflect the credit card price, and a discount is applied at the point of sale when the customer pays with cash, check, or debit.
              </p>
              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Key Requirements</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>All posted/advertised prices must be the standard (credit card) price</li>
                <li>The cash discount must be clearly disclosed at the point of entry and at the point of sale</li>
                <li>The discount must be offered equally to all customers paying with cash or non-credit methods</li>
                <li>Receipts must clearly show the listed price, the cash discount amount, and the final price paid</li>
                <li>Signage must be displayed at the entrance, at the register, and at any location where prices are posted</li>
                <li>Cash discount programs are legal in all 50 states under the Dodd-Frank Act and the Durbin Amendment</li>
              </ul>
              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Merchant Obligations</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Display required signage provided by Liberty Bancard at all points of interaction</li>
                <li>Use a point-of-sale terminal or system that automatically applies and displays the cash discount</li>
                <li>Train staff to explain the program to customers</li>
                <li>Ensure the discount is applied consistently and without discrimination</li>
                <li>Maintain compliance with local and state consumer protection laws</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Compliant Surcharging Programs</h2>
              <p className="mb-3">
                A surcharging program adds a fee to credit card transactions to cover processing costs. Surcharging is permitted in most -- but not all -- U.S. states and is subject to strict card brand rules and state regulations.
              </p>
              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Card Brand Rules</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Visa:</strong> Surcharging is permitted on Visa credit card transactions. The surcharge amount cannot exceed the merchant's cost of acceptance or 3% of the transaction amount, whichever is lower. Surcharging is not permitted on Visa debit card transactions. Merchants must notify Visa and their acquirer at least 30 days before implementing a surcharge.</li>
                <li><strong>Mastercard:</strong> Similar rules to Visa. Surcharges cannot exceed the merchant's cost of acceptance or 3%. Surcharging is not permitted on debit transactions. Merchants must register with Mastercard through their acquirer.</li>
                <li><strong>American Express:</strong> Permits surcharging under conditions similar to Visa and Mastercard. The surcharge must be applied equally across all card brands accepted.</li>
                <li><strong>Discover:</strong> Permits surcharging. The surcharge must not exceed the surcharge applied to other card brands.</li>
              </ul>
              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Merchant Obligations for Surcharging</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Notify your acquirer and the applicable card brands at least 30 days before implementing a surcharge</li>
                <li>Display clear signage at the point of entry and at the point of sale disclosing the surcharge</li>
                <li>Disclose the surcharge amount on every receipt as a separate line item</li>
                <li>Never surcharge debit card transactions (PIN or signature)</li>
                <li>Never surcharge prepaid card transactions</li>
                <li>Ensure the surcharge does not exceed the merchant's cost of acceptance or the card brand cap (currently 3%)</li>
                <li>Apply the surcharge equally across all credit card brands accepted</li>
                <li>Comply with all applicable state laws (see state restrictions below)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">State Restrictions &amp; Considerations</h2>
              <p className="mb-3">
                Surcharging laws vary by state. As of the date of this disclosure, the following states have restrictions or prohibitions on credit card surcharging. <strong>This information is subject to change as laws evolve. Merchants should consult with legal counsel regarding the current status of surcharging laws in their state.</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>States where surcharging is prohibited or restricted:</strong> Connecticut and Massachusetts have statutes that restrict or prohibit credit card surcharges. Puerto Rico also restricts surcharging.</li>
                <li><strong>States with specific surcharging regulations:</strong> Several states have enacted specific rules regarding surcharging disclosure, caps, or registration requirements. These include but may not be limited to: Colorado, Maine, New York, Oklahoma, Texas, and Utah.</li>
                <li><strong>Cash discount programs:</strong> Cash discount programs are generally legal in all 50 states, including states that prohibit surcharging, because a cash discount is legally distinct from a surcharge.</li>
              </ul>
              <p className="mt-3 text-xs">
                Note: State surcharging laws are evolving. Court decisions, legislative changes, and regulatory actions may affect the legality of surcharging in any given state at any time. Liberty Bancard does not provide legal advice. Merchants are responsible for understanding and complying with the laws of their operating jurisdiction. We recommend consulting a qualified attorney.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Liberty Bancard's Role</h2>
              <p>
                Liberty Bancard assists merchants with program setup, compliant signage, terminal programming, and card brand registration. We provide guidance and tools to help merchants implement compliant programs. However, <strong>the merchant is ultimately responsible for maintaining compliance</strong> with all applicable laws, card brand rules, and signage/disclosure requirements. Liberty Bancard does not provide legal advice and is not liable for a merchant's failure to comply with applicable laws or card brand rules. We recommend that merchants consult with qualified legal counsel before implementing any surcharging or cash discount program.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">No Guarantees</h2>
              <p>
                References to "0% processing," "eliminate processing fees," or similar language on our website or in marketing materials refer to the potential outcome of implementing a compliant cash discount or surcharging program. Actual results depend on program compliance, customer payment mix, transaction volume, and other factors. These programs do not eliminate all fees -- account fees, monthly minimums, PCI compliance fees, and other account-level charges may still apply as disclosed in the Merchant Processing Agreement. See our <Link href="/advertising-disclosure" className="underline">Advertising Disclosure</Link> for more information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about surcharging or cash discount programs:</p>
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
