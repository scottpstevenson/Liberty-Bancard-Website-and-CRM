import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function ResponsibleAI() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Responsible AI Disclosure" description="Liberty Bancard's responsible AI practices, transparency disclosures, and human oversight commitments for AI-powered services." path="/responsible-ai" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-responsible-ai-heading">
            Responsible AI Disclosure
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-responsible-ai-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment to Responsible AI</h2>
              <p>
                Liberty Bancard uses artificial intelligence (AI) to enhance our services, improve operational efficiency, and deliver better outcomes for merchants and prospective clients. We are committed to using AI responsibly, transparently, and ethically. This disclosure explains how AI is used in our operations, what decisions it informs, and the safeguards we have in place.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">How We Use AI</h2>
              <p className="mb-3">Liberty Bancard employs AI-powered features in the following areas:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>AI Advisors:</strong> Specialized AI assistants provide guidance to our internal teams across sales, support, onboarding, marketing, finance, compliance, and executive departments. These advisors help staff answer questions, draft communications, and follow best practices. AI advisor responses are always reviewed by human staff before any binding action is taken.</li>
                <li><strong>Lead Scoring &amp; Qualification:</strong> AI analyzes publicly available business information, website data, and submitted inquiry details to generate lead scores (0-100) across multiple dimensions. These scores help our sales team prioritize outreach. No merchant application is approved or denied based solely on an AI-generated score.</li>
                <li><strong>Lead Enrichment:</strong> AI assists in researching prospective merchants by analyzing publicly available business filings, websites, and industry data to build more complete prospect profiles. This helps us provide more relevant and personalized outreach.</li>
                <li><strong>Statement Analysis &amp; Savings Proposals:</strong> When merchants upload processing statements, AI assists in analyzing fee structures and generating savings proposals. All proposals are reviewed by qualified staff before presentation to the merchant. AI-generated savings estimates are projections, not guarantees.</li>
                <li><strong>Communication Assistance:</strong> AI helps draft email and SMS communications, including follow-ups, appointment reminders, and informational responses. All AI-assisted communications include compliance disclaimers and are subject to our compliance rules. Auto-replies to inbound messages are generated with compliance safeguards and are audit-logged.</li>
                <li><strong>Deal Blueprints &amp; Workflow Automation:</strong> AI generates recommended action plans for deals based on their stage, merchant profile, and historical patterns. These blueprints are suggestions for our sales team, not automated decisions.</li>
                <li><strong>Volume Estimation:</strong> AI assists in estimating processing volumes and potential residual revenue based on business type, location, and industry data. These estimates carry confidence levels and are clearly labeled as projections.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Human Oversight</h2>
              <p className="mb-3">We maintain human oversight over all AI-informed processes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>No merchant account application is approved or denied based solely on AI analysis</li>
                <li>All savings proposals and pricing recommendations are reviewed by qualified staff before delivery</li>
                <li>AI-generated communications are subject to compliance review rules</li>
                <li>Lead scores and qualifications inform prioritization but do not determine service eligibility</li>
                <li>Staff can override any AI recommendation at any time</li>
                <li>Critical decisions (account approval, pricing, contract terms) are made by authorized human personnel</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">AI Technology &amp; Data Practices</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>AI Provider:</strong> We use OpenAI's language models (GPT-4o and GPT-4o-mini) as our primary AI technology provider.</li>
                <li><strong>Data Usage:</strong> Your data submitted to AI features is processed solely for the purpose of providing the requested service. We do not use your data to train AI models. Our AI provider's API data processing terms confirm that API inputs and outputs are not used for model training.</li>
                <li><strong>Data Retention:</strong> AI-processed data is retained in accordance with our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>. AI interaction logs are retained for compliance and audit purposes.</li>
                <li><strong>No Sensitive Data in AI:</strong> We do not submit cardholder data (PAN, CVV, etc.), Social Security numbers, or other highly sensitive personal information to AI models. Statement analysis uses fee structures and transaction summaries, not individual cardholder-level data.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Compliance Safeguards</h2>
              <p className="mb-3">All AI-generated content is subject to the following compliance rules:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>No unsubstantiated savings claims or earnings guarantees</li>
                <li>Mandatory compliance disclaimers on all merchant-facing communications</li>
                <li>No legal, tax, or financial advice</li>
                <li>No storage or transmission of PCI-regulated cardholder data</li>
                <li>TCPA compliance for all automated communications</li>
                <li>Audit logging of all AI-generated auto-replies and communications</li>
                <li>Automatic suppression of auto-replies for unsubscribe requests, callback requests, and neutral-intent messages</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Limitations of AI</h2>
              <p className="mb-3">We want you to understand the limitations of our AI features:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>AI-generated content may contain errors or inaccuracies. We review AI outputs for accuracy, but perfection is not guaranteed.</li>
                <li>AI lead scores and volume estimates are projections based on available data and should not be relied upon as definitive assessments.</li>
                <li>AI does not replace professional advice. For legal, tax, or financial decisions related to your business, consult qualified professionals.</li>
                <li>AI-generated savings proposals are estimates based on the information provided and may not reflect actual results.</li>
                <li>AI systems can reflect biases present in training data. We monitor for and work to mitigate potential bias in our AI applications.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Rights</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>You may request that your data not be processed by AI features. This may limit certain services we can provide.</li>
                <li>You may request a human review of any AI-informed decision or recommendation that affects you.</li>
                <li>You may request information about how AI was used in any specific interaction or decision involving your account.</li>
                <li>You may opt out of AI-generated auto-replies by contacting us.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Regulatory Compliance</h2>
              <p>
                Liberty Bancard monitors and complies with emerging AI regulations, including but not limited to the EU Artificial Intelligence Act, state-level AI legislation (such as the Colorado AI Act), FTC guidance on AI and automated decision-making, and applicable consumer protection laws. We update our practices as regulatory requirements evolve.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about our use of AI or to exercise your rights regarding AI-processed data:</p>
              <div className="space-y-2">
                <a href="mailto:privacy@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>privacy@libertybancard.com</span>
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
