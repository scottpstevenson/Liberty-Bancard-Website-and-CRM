import { SEO, getBreadcrumbSchema } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function ADACompliance() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="ADA & WCAG Compliance Notice | Liberty Bancard"
        description="Liberty Bancard ADA compliance and WCAG accessibility commitment. Our digital accessibility standards, accommodations, and how to request assistance."
        path="/ada-compliance"
        keywords="ADA compliance, WCAG, web accessibility, digital accessibility, Section 508, Liberty Bancard"
        breadcrumbs={[{ name: "ADA Compliance", path: "/ada-compliance" }]}
        structuredData={getBreadcrumbSchema([{ name: "ADA Compliance", path: "/ada-compliance" }])}
      />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <nav className="text-sm text-muted-foreground mb-6" aria-label="Breadcrumb" data-testid="breadcrumb-ada">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">ADA & WCAG Compliance</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-ada-heading">
            ADA &amp; WCAG Compliance Notice
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-ada-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section data-testid="section-ada-intro">
              <p>
                Liberty Bancard is committed to ensuring that our website and digital services are accessible to all individuals, including those with disabilities. We strive to comply with the Americans with Disabilities Act (ADA), Section 508 of the Rehabilitation Act, the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA, and other applicable accessibility standards and regulations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Our Commitment to Accessibility</h2>
              <p className="mb-3">
                We believe that the internet should be accessible to everyone. Liberty Bancard is dedicated to providing a website experience that is usable, navigable, and understandable for people of all abilities, including those who use assistive technologies such as screen readers, magnifiers, voice recognition software, and alternative input devices. Our accessibility efforts include:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Designing with accessibility as a core requirement, not an afterthought</li>
                <li>Regularly testing our website for accessibility barriers</li>
                <li>Training our development team on accessibility best practices</li>
                <li>Incorporating user feedback to improve accessibility</li>
                <li>Working toward continuous improvement in accessibility compliance</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Accessibility Standards</h2>
              <p className="mb-3">
                Liberty Bancard's website is designed to conform to the following standards:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>WCAG 2.1 Level AA:</strong> The Web Content Accessibility Guidelines (WCAG) 2.1 published by the World Wide Web Consortium (W3C) are the internationally recognized standard for web accessibility. Level AA conformance addresses the most common barriers for disabled users.</li>
                <li><strong>ADA Title III:</strong> The Americans with Disabilities Act (ADA) Title III requires that places of public accommodation, which courts have interpreted to include websites, be accessible to people with disabilities.</li>
                <li><strong>Section 508:</strong> Section 508 of the Rehabilitation Act requires federal agencies and their contractors to make electronic and information technology accessible. We follow these standards as best practice.</li>
                <li><strong>EN 301 549:</strong> The European standard for digital accessibility, which incorporates WCAG 2.1 requirements.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Accessibility Features</h2>
              <p className="mb-3">Our website includes the following accessibility features:</p>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Perceivable</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Text alternatives (alt text) for meaningful images</li>
                <li>Sufficient color contrast ratios between text and backgrounds</li>
                <li>Content that is structured with proper heading hierarchy (H1-H6)</li>
                <li>Responsive design that adapts to different screen sizes and zoom levels</li>
                <li>Text that can be resized up to 200% without loss of content or functionality</li>
              </ul>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Operable</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Full keyboard navigation support for all interactive elements</li>
                <li>Visible focus indicators for keyboard users</li>
                <li>Skip navigation links to bypass repetitive content</li>
                <li>No content that flashes more than three times per second</li>
                <li>Sufficient time to read and interact with content</li>
              </ul>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Understandable</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Clear and consistent navigation across all pages</li>
                <li>Descriptive labels on form fields and interactive controls</li>
                <li>Error identification and suggestions for form validation</li>
                <li>Language attribute set on the HTML element</li>
                <li>Predictable behavior for interactive elements</li>
              </ul>

              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Robust</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Valid, semantic HTML markup</li>
                <li>ARIA (Accessible Rich Internet Applications) attributes where appropriate</li>
                <li>Compatibility with current assistive technologies</li>
                <li>Progressive enhancement for older browsers</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Known Limitations</h2>
              <p className="mb-3">
                While we strive for full WCAG 2.1 Level AA conformance, some content may have accessibility limitations. Known areas where we are actively working to improve include:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Some older PDF documents may not be fully accessible; contact us for accessible alternatives</li>
                <li>Third-party embedded content (videos, maps, widgets) may have limited accessibility that is outside our direct control</li>
                <li>Some complex interactive features (dashboards, charts) may have reduced accessibility for screen reader users; we are working to improve these</li>
              </ul>
              <p className="mt-3">
                We are committed to addressing these limitations and continuously improving our website's accessibility.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Assistive Technology Compatibility</h2>
              <p className="mb-3">Our website is designed to be compatible with the following assistive technologies:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Screen Readers:</strong> JAWS, NVDA, VoiceOver (macOS/iOS), TalkBack (Android)</li>
                <li><strong>Screen Magnifiers:</strong> ZoomText, Windows Magnifier, macOS Zoom</li>
                <li><strong>Speech Recognition:</strong> Dragon NaturallySpeaking, Windows Speech Recognition, Voice Control (macOS)</li>
                <li><strong>Keyboard Navigation:</strong> Full functionality available via keyboard only</li>
                <li><strong>Switch Devices:</strong> Compatible with switch access and alternative input devices</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Testing and Evaluation</h2>
              <p className="mb-3">
                We regularly evaluate our website for accessibility through:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Automated accessibility scanning tools</li>
                <li>Manual testing with assistive technologies</li>
                <li>Keyboard-only navigation testing</li>
                <li>Color contrast analysis</li>
                <li>User feedback review and incorporation</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Alternative Access and Accommodations</h2>
              <p className="mb-3">
                If you encounter any accessibility barriers or need assistance accessing any content or functionality on our website, we are happy to assist. We can provide:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Information in alternative formats (large print, audio, plain text)</li>
                <li>Assistance completing forms or applications by phone</li>
                <li>Accessible versions of documents upon request</li>
                <li>Direct communication with our team via phone, email, or text</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Feedback and Accessibility Concerns</h2>
              <p className="mb-3">
                We welcome your feedback on the accessibility of our website. If you encounter an accessibility barrier, have difficulty using any part of our website, or have suggestions for improvement, please contact us. We take all accessibility feedback seriously and will make reasonable efforts to address your concern promptly.
              </p>
              <p>When contacting us about an accessibility issue, please include:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>The web page URL where you experienced the issue</li>
                <li>A description of the accessibility barrier</li>
                <li>The assistive technology you were using (if applicable)</li>
                <li>Your preferred method of contact</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Third-Party Content</h2>
              <p>
                Our website may include content from third-party sources (embedded videos, payment forms, social media widgets, maps, etc.). While we strive to ensure all third-party content meets accessibility standards, we may have limited control over the accessibility of third-party content. If you encounter accessibility issues with third-party content on our site, please contact us and we will work with the third party to address the issue or provide an accessible alternative.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Enforcement and Complaints</h2>
              <p className="mb-3">
                If you believe that Liberty Bancard has not adequately addressed your accessibility concern, you have the right to file a complaint with:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>U.S. Department of Justice:</strong> ADA complaints can be filed with the DOJ Civil Rights Division</li>
                <li><strong>Office for Civil Rights (OCR):</strong> Complaints regarding Section 508 compliance</li>
                <li><strong>Your state's attorney general or human rights commission</strong></li>
              </ul>
              <p className="mt-3">
                We encourage you to contact us first so we can resolve any issues directly and promptly.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Continuous Improvement</h2>
              <p>
                Accessibility is an ongoing effort. We regularly review and update our website to improve accessibility. Our goal is to provide an inclusive digital experience for all visitors. This policy is reviewed and updated at least annually.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Related Policies</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><Link href="/accessibility" className="underline">Accessibility Statement</Link></li>
                <li><Link href="/privacy-policy" className="underline">Privacy Policy</Link></li>
                <li><Link href="/terms" className="underline">Terms of Service</Link></li>
              </ul>
            </section>

            <section data-testid="section-ada-contact">
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">For accessibility questions, concerns, or accommodation requests:</p>
              <div className="space-y-2">
                <a href="mailto:support@libertybancard.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-ada-email">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
                <a href="tel:9542668214" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors" data-testid="link-ada-phone">
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