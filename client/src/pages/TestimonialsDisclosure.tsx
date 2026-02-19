import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function TestimonialsDisclosure() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Testimonials & Reviews Disclosure" description="Liberty Bancard FTC testimonials and reviews disclosure. Understand how we use customer testimonials and endorsements." path="/testimonials-disclosure" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-testimonials-heading">
            Testimonials &amp; Reviews Disclosure
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-testimonials-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">FTC Compliance</h2>
              <p>
                In accordance with the Federal Trade Commission (FTC) Guides Concerning the Use of Endorsements and Testimonials in Advertising (16 CFR Part 255), Liberty Bancard provides this disclosure regarding testimonials, reviews, endorsements, and case studies that may appear on our website, marketing materials, social media accounts, or other communications.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Results May Vary</h2>
              <p>
                Testimonials and reviews on our website represent the individual experiences of the persons or businesses providing them. <strong>Results are not typical and your experience may vary.</strong> The savings, processing rates, service improvements, or other outcomes described in any testimonial, review, or case study are specific to that individual or business and should not be understood as a guarantee or promise that you will achieve the same or similar results. Actual outcomes depend on factors including your business type, transaction volume, payment mix, current pricing structure, and other variables specific to your situation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Authenticity</h2>
              <p className="mb-3">Liberty Bancard is committed to the following standards regarding testimonials and reviews:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>All testimonials and reviews featured on our website reflect genuine experiences of real customers or clients</li>
                <li>Testimonials may be edited for clarity, grammar, or length, but the substance and meaning of the original statement are preserved</li>
                <li>We do not fabricate testimonials, create fake reviews, or post reviews on behalf of customers without their knowledge and consent</li>
                <li>Where a testimonial includes specific dollar amounts, percentages, or measurable results, those figures are based on the individual's actual experience at the time of the testimonial</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Compensation &amp; Material Connections</h2>
              <p className="mb-3">We disclose material connections as required by the FTC:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Customer Testimonials:</strong> Some customers who provide testimonials may receive a benefit such as a fee reduction, account credit, gift card, or other incentive in exchange for their testimonial. Where such compensation is provided, it will be disclosed alongside the testimonial.</li>
                <li><strong>Case Studies:</strong> Businesses featured in case studies are current or former customers of Liberty Bancard. Their participation in the case study may be voluntary, or they may receive compensation or benefits. Any material connection is disclosed.</li>
                <li><strong>Partner Endorsements:</strong> If a referral partner, agent, or affiliate endorses Liberty Bancard's services, we will disclose the nature of that relationship (e.g., "This partner receives referral compensation from Liberty Bancard").</li>
                <li><strong>Employee Content:</strong> Content created by Liberty Bancard employees or agents is identified as such and does not represent independent customer reviews.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Third-Party Review Platforms</h2>
              <p>
                Reviews appearing on third-party platforms (such as Google Reviews, Trustpilot, BBB, or industry-specific directories) are governed by those platforms' own terms and policies. Liberty Bancard may encourage satisfied customers to leave reviews but does not control the content of reviews posted on third-party platforms. We do not suppress negative reviews or engage in review manipulation practices.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Savings Claims</h2>
              <p>
                Any savings claims, rate comparisons, or cost reduction figures referenced in testimonials, marketing materials, or on our website are based on analysis of actual merchant processing statements and are specific to the individual merchant's circumstances. Savings are calculated by comparing current effective rates to proposed pricing and are projections based on historical transaction data. Actual savings may be higher or lower depending on changes in business volume, payment mix, card brand interchange rates, and other factors. See our <Link href="/advertising-disclosure" className="underline">Advertising Disclosure</Link> for more information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Feedback</h2>
              <p>
                If you are a Liberty Bancard customer and would like to share your experience, or if you have concerns about a testimonial or review attributed to you, please contact us. We respect your right to have any testimonial removed or modified at any time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For questions about testimonials, reviews, or this disclosure:</p>
              <div className="space-y-2">
                <a href="mailto:marketing@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>marketing@libertybancard.com</span>
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
