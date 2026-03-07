import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function SecurityCompliance() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Security & Compliance - AML/KYC & PCI" description="Liberty Bancard security and compliance posture including AML/KYC procedures and PCI DSS compliance." path="/security-compliance" breadcrumbs={[{ name: "Security & Compliance", path: "/security-compliance" }]} />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-security-compliance-heading">
            Security &amp; Compliance
          </h1>
          <p className="text-sm text-muted-foreground mb-4" data-testid="text-security-compliance-subtitle">
            AML/KYC Compliance | PCI DSS Statement
          </p>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-security-compliance-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <div className="border-b border-border pb-2">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-aml-section">
                Anti-Money Laundering (AML) &amp; Know Your Customer (KYC)
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment</h2>
              <p>
                Liberty Bancard is committed to preventing money laundering, terrorist financing, and other financial crimes. As a registered Independent Sales Organization (ISO) facilitating payment processing services, we maintain policies and procedures designed to comply with the Bank Secrecy Act (BSA), the USA PATRIOT Act, Office of Foreign Assets Control (OFAC) regulations, Financial Crimes Enforcement Network (FinCEN) requirements, and applicable anti-money laundering laws at the federal and state level.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Know Your Customer (KYC) Procedures</h2>
              <p className="mb-3">
                Before onboarding a new merchant, Liberty Bancard performs due diligence to verify the identity of the business and its principals. Our KYC procedures include:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Collection and verification of business legal name, DBA, EIN/TIN, and state of incorporation</li>
                <li>Identification and verification of beneficial owners (individuals owning 25% or more) and control persons</li>
                <li>Government-issued identification verification for all principals and authorized signers</li>
                <li>OFAC and sanctions list screening (SDN list, Sectoral Sanctions, and other applicable lists)</li>
                <li>MATCH/TMF (Terminated Merchant File) database screening</li>
                <li>Business legitimacy verification (website review, physical location, business license)</li>
                <li>Industry and risk category assessment</li>
                <li>Enhanced due diligence for high-risk industries or geographies</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Ongoing Monitoring</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Transaction monitoring for unusual patterns, velocity changes, or suspicious activity</li>
                <li>Periodic re-screening against sanctions and watchlists</li>
                <li>Review of chargeback ratios and refund patterns</li>
                <li>Annual beneficial ownership re-verification for high-risk accounts</li>
                <li>Reporting of suspicious activity to FinCEN as required by law</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Prohibited Activities</h2>
              <p className="mb-3">
                Liberty Bancard does not knowingly provide services to businesses or individuals engaged in:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Money laundering or terrorist financing</li>
                <li>Fraud, identity theft, or deceptive business practices</li>
                <li>Activities prohibited by OFAC sanctions</li>
                <li>Illegal sale of controlled substances or unlicensed pharmaceuticals</li>
                <li>Illegal gambling or unlicensed gaming operations</li>
                <li>Sale of counterfeit goods or intellectual property infringement</li>
                <li>Any activity that violates card brand operating regulations</li>
              </ul>
              <p className="mt-3">
                Discovery of prohibited activity will result in immediate account suspension, reporting to the appropriate authorities, and termination of the merchant relationship.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Employee Training</h2>
              <p>
                All Liberty Bancard employees with merchant-facing responsibilities receive training on AML/KYC procedures, red flag identification, suspicious activity reporting, and OFAC compliance. Training is conducted upon hiring and refreshed annually.
              </p>
            </section>

            <div className="border-b border-border pb-2 pt-8">
              <h2 className="text-2xl font-display font-bold text-foreground" data-testid="text-pci-section">
                PCI DSS Compliance Statement
              </h2>
            </div>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our PCI Posture</h2>
              <p>
                Liberty Bancard is committed to the security of cardholder data and adheres to the Payment Card Industry Data Security Standard (PCI DSS) as established by the PCI Security Standards Council. As an ISO, we work exclusively with PCI-compliant payment processors and acquiring banks to ensure that cardholder data is protected throughout the transaction lifecycle.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">What We Do Not Store</h2>
              <p className="mb-3">
                Liberty Bancard does <strong>not</strong> store, process, or transmit the following cardholder data:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Full primary account numbers (PAN)</li>
                <li>Card verification values (CVV/CVC/CVV2)</li>
                <li>PIN blocks or encrypted PIN data</li>
                <li>Full magnetic stripe or chip data</li>
                <li>Card expiration dates (except as part of truncated references)</li>
              </ul>
              <p className="mt-3">
                All cardholder data processing is handled by our PCI-compliant payment processor and acquiring bank partners. We encourage merchants to redact sensitive information from any documents submitted to us.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Merchant PCI Compliance Obligations</h2>
              <p className="mb-3">
                All merchants accepting credit card payments are required to comply with PCI DSS. Merchant compliance obligations include:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Annual PCI Self-Assessment Questionnaire (SAQ):</strong> Most small merchants complete SAQ A, SAQ A-EP, SAQ B, SAQ C, or SAQ D depending on how they process transactions.</li>
                <li><strong>Quarterly Network Vulnerability Scans:</strong> Required for merchants with internet-facing systems, performed by an Approved Scanning Vendor (ASV).</li>
                <li><strong>Maintaining Secure Systems:</strong> Keep all systems, software, and terminals updated with security patches. Use firewalls, anti-virus software, and strong access controls.</li>
                <li><strong>PCI Compliance Fee:</strong> A monthly or annual PCI compliance fee may apply as specified in the Merchant Processing Agreement. This fee covers access to PCI compliance tools, SAQ hosting, and support.</li>
                <li><strong>Non-Compliance Fees:</strong> Merchants who fail to validate PCI compliance may be assessed a monthly non-compliance fee. Liberty Bancard provides tools and assistance to help merchants achieve and maintain compliance.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Data Breach Response</h2>
              <p>
                In the event of a suspected or confirmed data breach involving cardholder data, merchants must notify Liberty Bancard immediately. We will work with the merchant, the acquiring bank, and the card brands to initiate the required breach response procedures, including forensic investigation, notification requirements, and remediation. Data breach costs (including forensic investigation, card brand fines, and card reissuance costs) may be passed through to the merchant as specified in the Merchant Processing Agreement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Website Security</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>All data transmitted between your browser and our website is encrypted using TLS (Transport Layer Security)</li>
                <li>Passwords are hashed using industry-standard bcrypt algorithms and are never stored in plaintext</li>
                <li>Session management uses secure, HTTP-only cookies</li>
                <li>Regular security reviews and updates are performed on our systems</li>
                <li>Access to systems and data is restricted on a need-to-know basis with role-based access controls</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Reporting Security Concerns</h2>
              <p className="mb-3">If you discover a security vulnerability or suspect unauthorized access, please contact us immediately:</p>
              <div className="space-y-2">
                <a href="mailto:security@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>security@libertybancard.com</span>
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
