import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { trackPhoneCallClick } from "@/lib/analytics";

export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Accessibility Statement | Liberty Bancard" description="Liberty Bancard's commitment to digital accessibility. We follow ADA and WCAG 2.1 guidelines to ensure our website is usable by all visitors." path="/accessibility" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-accessibility-heading">
            Accessibility Statement
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-accessibility-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment</h2>
              <p>
                Liberty Bancard is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards to ensure we provide equal access to all users.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Standards</h2>
              <p className="mb-3">
                We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA. These guidelines are developed by the World Wide Web Consortium (W3C) and define how to make web content more accessible to people with disabilities. The guidelines address accessibility across three levels: A, AA, and AAA.
              </p>
              <p>Our accessibility efforts are guided by:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>Americans with Disabilities Act (ADA) - Title III</li>
                <li>Section 508 of the Rehabilitation Act</li>
                <li>Web Content Accessibility Guidelines (WCAG) 2.1 Level AA</li>
                <li>European Accessibility Act (EAA) (where applicable)</li>
                <li>Equality Act 2010 (UK) (where applicable)</li>
                <li>Disability Discrimination Act (Australia) (where applicable)</li>
                <li>Accessible Canada Act (where applicable)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Measures Taken</h2>
              <p className="mb-3">We take the following measures to ensure accessibility:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Semantic HTML structure with proper heading hierarchy</li>
                <li>Alt text for meaningful images and decorative image handling</li>
                <li>Keyboard navigation support throughout the website</li>
                <li>Sufficient color contrast ratios for text and interactive elements</li>
                <li>Clearly labeled form inputs with associated labels</li>
                <li>ARIA attributes where appropriate to enhance screen reader compatibility</li>
                <li>Responsive design that works across devices and screen sizes</li>
                <li>Focus indicators for interactive elements</li>
                <li>Text resizing support without loss of functionality</li>
                <li>Avoidance of content that may cause seizures or physical reactions</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Known Limitations</h2>
              <p>
                Despite our best efforts, some areas of the website may not yet be fully accessible. We are actively working to identify and resolve accessibility issues. If you encounter any barriers, please contact us so we can provide the information or service you need through an alternative method while we work on improving accessibility.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Feedback &amp; Assistance</h2>
              <p className="mb-3">
                We welcome your feedback on the accessibility of our website. If you encounter accessibility barriers or need assistance, please contact us. We will work with you to provide the information or service you need in an accessible format.
              </p>
              <div className="space-y-2">
                <a href="mailto:accessibility@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>accessibility@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" onClick={() => trackPhoneCallClick({ sourcePage: "/accessibility-statement" })}>
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>954-266-8214</span>
                </a>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Enforcement &amp; Complaints</h2>
              <p>
                If you are not satisfied with our response to your accessibility concern, you may file a complaint with the U.S. Department of Justice, the relevant state attorney general's office, or the applicable regulatory body in your jurisdiction. In the EU, you may contact your national equality body. In the UK, you may contact the Equality and Human Rights Commission (EHRC). In Australia, you may contact the Australian Human Rights Commission.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
