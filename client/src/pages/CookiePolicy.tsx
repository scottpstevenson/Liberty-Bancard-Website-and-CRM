import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Mail, Phone } from "lucide-react";

export default function CookiePolicy() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Cookie Policy | Liberty Bancard" description="Liberty Bancard cookie policy explains how we use cookies and similar tracking technologies. Learn how to manage your preferences and opt-out options." path="/cookie-policy" />
      <Navbar />
      <main className="flex-grow pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-cookie-policy-heading">
            Cookie Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-10" data-testid="text-cookie-policy-updated">
            Last updated: February 19, 2026
          </p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <p>
                This Cookie Policy explains how Liberty Bancard ("we," "us," or "our") uses cookies and similar tracking technologies when you visit our website. This policy should be read together with our Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">What Are Cookies?</h2>
              <p>
                Cookies are small text files that are placed on your device (computer, tablet, or mobile phone) when you visit a website. They are widely used to make websites work more efficiently, provide reporting information, and assist with personalization. Cookies set by the website operator are called "first-party cookies." Cookies set by parties other than the website operator are called "third-party cookies."
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Types of Cookies We Use</h2>

              <div className="space-y-4 mt-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Strictly Necessary Cookies</h3>
                  <p>These cookies are essential for the website to function and cannot be switched off. They are usually set in response to actions you take, such as setting your privacy preferences, logging in, or filling in forms. These cookies do not store any personally identifiable information. Without these cookies, the services you have asked for cannot be provided.</p>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Functional Cookies</h3>
                  <p>These cookies enable the website to provide enhanced functionality and personalization. They may be set by us or by third-party providers whose services we have added to our pages. If you do not allow these cookies, some or all of these features may not function properly.</p>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Analytics Cookies</h3>
                  <p>These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. They help us know which pages are the most and least popular and how visitors move around the site. All information these cookies collect is aggregated and therefore anonymous.</p>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Marketing Cookies</h3>
                  <p>These cookies may be set through our site by our advertising partners. They may be used by those companies to build a profile of your interests and show you relevant adverts on other sites. They do not directly store personal information but are based on uniquely identifying your browser and internet device.</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Similar Technologies</h2>
              <p>
                In addition to cookies, we may use other similar technologies such as web beacons (also known as pixel tags or clear GIFs), local storage, and session storage. These technologies serve similar purposes to cookies and are subject to the same controls and preferences you set for cookies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Your Choices and Controls</h2>
              <p className="mb-3">You have several options for managing cookies:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Cookie Consent Banner:</strong> When you first visit our website, you can accept all cookies, reject non-essential cookies, or customize your preferences using our cookie consent banner.</li>
                <li><strong>Browser Settings:</strong> Most web browsers allow you to control cookies through their settings. You can set your browser to refuse cookies, delete cookies, or alert you when a cookie is being set. Note that disabling cookies may affect website functionality.</li>
                <li><strong>Opt-Out Links:</strong> For certain third-party cookies, you can opt out through industry opt-out mechanisms such as the Digital Advertising Alliance (DAA) at <a href="https://optout.aboutads.info" className="underline" target="_blank" rel="noopener noreferrer">optout.aboutads.info</a>, the Network Advertising Initiative (NAI) at <a href="https://optout.networkadvertising.org" className="underline" target="_blank" rel="noopener noreferrer">optout.networkadvertising.org</a>, or the European Interactive Digital Advertising Alliance (EDAA) at <a href="https://youronlinechoices.eu" className="underline" target="_blank" rel="noopener noreferrer">youronlinechoices.eu</a>.</li>
                <li><strong>Do Not Track:</strong> Some browsers include a "Do Not Track" (DNT) feature. We honor Do Not Track signals where technically feasible.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">International Considerations</h2>
              <p>
                We comply with applicable cookie and privacy laws including the EU General Data Protection Regulation (GDPR), the ePrivacy Directive, the UK Data Protection Act 2018, the California Consumer Privacy Act (CCPA/CPRA), Brazil's LGPD, Canada's PIPEDA, Australia's Privacy Act, and other applicable data protection laws. Depending on your jurisdiction, you may have additional rights regarding cookies and tracking technologies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Updates to This Policy</h2>
              <p>
                We may update this Cookie Policy from time to time to reflect changes in technology, regulation, or our business practices. We will notify you of material changes by posting the updated policy on this page with a revised "Last updated" date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">Contact Us</h2>
              <p className="mb-3">If you have questions about our use of cookies, please contact us:</p>
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
