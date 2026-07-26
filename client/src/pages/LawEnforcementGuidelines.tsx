import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function LawEnforcementGuidelines() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Law Enforcement & Subpoena Guidelines" description="Liberty Bancard guidelines for law enforcement agencies and legal process for data and records requests." path="/law-enforcement" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-law-enforcement-heading">
            Law Enforcement &amp; Subpoena Guidelines
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-law-enforcement-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Purpose</h2>
              <p>
                This page provides guidance for law enforcement agencies, regulatory bodies, and legal professionals seeking information or records from Liberty Bancard in connection with legal proceedings, investigations, or regulatory inquiries. Liberty Bancard cooperates with lawful requests in accordance with applicable federal and state law, while protecting the privacy rights of our customers and merchants.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Types of Legal Process Accepted</h2>
              <p className="mb-3">Liberty Bancard responds to the following types of valid legal process:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Subpoenas:</strong> A valid subpoena issued by a court of competent jurisdiction or authorized governmental body. Grand jury subpoenas are accepted for criminal investigations.</li>
                <li><strong>Court Orders:</strong> Orders issued by a judge or magistrate compelling production of records or information.</li>
                <li><strong>Search Warrants:</strong> Warrants issued by a judge based on probable cause, compliant with the Fourth Amendment and applicable state law.</li>
                <li><strong>National Security Letters (NSLs):</strong> Requests authorized under applicable federal statutes for national security investigations.</li>
                <li><strong>Regulatory Requests:</strong> Formal requests from regulatory agencies with jurisdiction over payment processing or financial services (e.g., FinCEN, state attorneys general, card brand compliance departments).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Information We May Provide</h2>
              <p className="mb-3">Depending on the nature and scope of the legal process, Liberty Bancard may be able to provide:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Merchant account application information (business name, owner identity, contact details)</li>
                <li>Account activity records (dates of service, account status)</li>
                <li>Communication records (emails, support tickets, correspondence)</li>
                <li>Transaction summaries and processing history (as available from our records)</li>
                <li>IP addresses and access logs associated with account activity</li>
              </ul>
              <p className="mt-3">
                <strong>Note:</strong> Liberty Bancard is an Independent Sales Organization (ISO), not a payment processor or bank. Detailed transaction-level data (individual cardholder transactions, settlement records, funding details) is maintained by the acquiring bank and payment processor, not by Liberty Bancard. Requests for transaction-level data should be directed to the appropriate financial institution.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Information We Do Not Maintain</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Full cardholder account numbers (PAN), CVVs, or other PCI-regulated cardholder data</li>
                <li>Individual transaction-level settlement or funding records (held by the acquiring bank)</li>
                <li>Cardholder identity information (held by the issuing bank)</li>
                <li>PIN data or encrypted authentication data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Submission Requirements</h2>
              <p className="mb-3">All legal process must:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Be issued by a court or governmental body with proper jurisdiction</li>
                <li>Be properly served on Liberty Bancard's registered agent or legal department</li>
                <li>Specifically identify the records, accounts, or information sought</li>
                <li>Include the case or investigation number</li>
                <li>Include contact information for the requesting officer or attorney</li>
                <li>State the applicable legal authority under which the request is made</li>
              </ul>
              <p className="mt-3">
                Overly broad or unduly burdensome requests may be challenged or narrowed. Liberty Bancard reserves the right to seek to quash or modify legal process that does not meet applicable legal standards.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Where to Send Legal Process</h2>
              <p className="mb-3">All legal process should be directed to:</p>
              <div className="space-y-2">
                <p className="text-foreground font-medium">Liberty Bancard - Legal Department</p>
                <a href="mailto:legal@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>legal@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
              <p className="mt-3 text-xs">
                We accept service via email for expediency, but original documents may be required depending on the nature of the request. Please include a return email address and phone number for follow-up.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Response Timeline</h2>
              <p>
                Liberty Bancard will acknowledge receipt of valid legal process within 3 business days. We will produce responsive records within the timeframe specified in the legal process or, if no timeframe is specified, within 30 days of receipt. Emergency or expedited requests will be processed as quickly as possible upon verification of the emergency circumstances.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Customer Notification</h2>
              <p>
                Unless prohibited by law, court order, or applicable legal process (such as a non-disclosure order or gag order), Liberty Bancard will make reasonable efforts to notify affected merchants or customers before disclosing their information in response to legal process. This notification allows the affected party to seek legal counsel and, if appropriate, challenge the request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Cost Reimbursement</h2>
              <p>
                Liberty Bancard may seek reimbursement for reasonable costs incurred in responding to legal process, including staff time, document production, and electronic data retrieval, as permitted by applicable law. Cost estimates will be provided upon request before production begins.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Preservation Requests</h2>
              <p>
                Law enforcement agencies may submit a formal preservation request to Liberty Bancard to preserve records related to a specific account or investigation pending issuance of legal process. Preservation requests should be submitted to <a href="mailto:legal@libertybancard.com" className="underline">legal@libertybancard.com</a> and must identify the specific accounts or records to be preserved. Records will be preserved for 90 days, renewable upon written request.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
