import { Link } from "wouter";
import { Phone, Mail, Calendar } from "lucide-react";
import logoWhite from "@assets/logo-white.png";
import { CALENDAR_URL } from "@/lib/constants";

export function Footer() {
  const quickLinks = [
    { label: "Home", href: "/" },
    { label: "Get Started", href: CALENDAR_URL, external: true },
    { label: "Upload Statement", href: "/upload-statement" },
    { label: "About & Contact", href: "/about-contact" },
    { label: "Support", href: "/support" },
    { label: "Help Center", href: "/help" },
    { label: "Merchant Application", href: "/merchant-application" },
    { label: "Affiliate Program", href: "/affiliate" },
  ];

  const growWithUsLinks = [
    { label: "ISO & Partner Program", href: "/partners" },
    { label: "Partner Portal Login", href: "/partner-portal" },
    { label: "Affiliate Program", href: "/affiliate" },
    { label: "Residual Income Calculator", href: "/partners#calculator" },
    { label: "Become a Partner", href: "/partners#apply" },
  ];

  const quizLinks = [
    { label: "Free Savings Analysis Quiz", href: "/free-analysis" },
    { label: "Processing Cost Quiz", href: "/quiz/processing-cost" },
    { label: "Savings Calculator", href: "/savings-calculator" },
    { label: "Quick Estimate", href: "/estimate" },
    { label: "Upload Statement", href: "/upload-statement" },
    { label: "Get Started", href: CALENDAR_URL, external: true },
  ];

  const solutionLinks = [
    { label: "Liberty Zero™ — 0% Processing", href: "/0-percent-processing" },
    { label: "Beat Square & Stripe", href: "/beat-square-stripe" },
    { label: "Compare Rates", href: "/compare-rates" },
    { label: "vs Square", href: "/compare/square" },
    { label: "vs Stripe", href: "/compare/stripe" },
    { label: "vs Toast", href: "/compare/toast" },
    { label: "Terminal Shop", href: "/shop" },
  ];

  const industryFooterLinks = [
    { label: "Restaurant", href: "/industries/restaurant-payment-processing" },
    { label: "Retail", href: "/industries/retail-payment-processing" },
    { label: "Healthcare", href: "/industries/healthcare-payment-processing" },
    { label: "Salon & Spa", href: "/industries/salon-spa-payment-processing" },
    { label: "Auto Repair", href: "/industries/auto-repair-payment-processing" },
    { label: "Professional Services", href: "/industries/professional-services-payment-processing" },
    { label: "E-Commerce", href: "/industries/ecommerce-payment-processing" },
    { label: "Construction", href: "/industries/construction-payment-processing" },
  ];

  const blogLinks = [
    { label: "All Articles", href: "/blog" },
    { label: "FAQ", href: "/faq" },
    { label: "Case Studies", href: "/case-studies" },
    { label: "Why Liberty Bancard", href: "/why-liberty-bancard" },
    { label: "Hidden Fees Guide", href: "/blog/hidden-fees-payment-processing-guide" },
    { label: "PCI Compliance Checklist", href: "/blog/pci-compliance-checklist-small-business" },
    { label: "Interchange Plus vs Flat Rate", href: "/blog/interchange-plus-vs-flat-rate" },
  ];

  const platformLinks = [
    { label: "Staff Login / Dashboard", href: "/dashboard" },
    { label: "Sales Pipeline", href: "/dashboard/pipeline" },
    { label: "Support Tickets", href: "/dashboard/tickets" },
    { label: "AI Advisors", href: "/dashboard/chat" },
  ];

  const legalLinks = [
    { label: "Privacy Policy", href: "/privacy-policy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Cookie Policy", href: "/cookie-policy" },
    { label: "Advertising Disclosure", href: "/advertising-disclosure" },
    { label: "Accessibility", href: "/accessibility" },
    { label: "SMS Terms", href: "/sms-terms" },
    { label: "E-Sign Consent", href: "/esign-consent" },
    { label: "Surcharging Disclosure", href: "/surcharging-disclosure" },
    { label: "Merchant Policies", href: "/merchant-policies" },
    { label: "Security & Compliance", href: "/security-compliance" },
    { label: "Regulatory Notices", href: "/regulatory-notices" },
    { label: "Data Processing Agreement", href: "/data-processing-agreement" },
    { label: "Responsible AI", href: "/responsible-ai" },
    { label: "Testimonials Disclosure", href: "/testimonials-disclosure" },
    { label: "Law Enforcement Guidelines", href: "/law-enforcement" },
    { label: "Dispute Resolution", href: "/dispute-resolution" },
    { label: "Data Retention", href: "/data-retention" },
    { label: "TCPA Consent", href: "/tcpa-consent" },
    { label: "Refund Policy", href: "/refund-policy" },
    { label: "California Privacy (CCPA)", href: "/california-privacy" },
    { label: "ADA Compliance", href: "/ada-compliance" },
  ];

  return (
    <footer className="bg-primary text-primary-foreground pt-16 pb-8" data-testid="footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          <div>
            <Link href="/" data-testid="link-footer-logo">
              <img src={logoWhite} alt="Liberty Bancard" className="h-10 w-auto mb-4" />
            </Link>
            <p className="text-primary-foreground/70 text-sm leading-relaxed mb-6" data-testid="text-footer-description">
              We don't sell a rate. We prove your real cost and fix it.
            </p>
            <h4 className="font-semibold text-sm mb-3" data-testid="text-footer-contact-heading">Contact</h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="tel:9542668214"
                  className="flex items-center gap-2 text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-phone"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>Call/Text 954-266-8214</span>
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@libertybancard.com"
                  className="flex items-center gap-2 text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-email"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>support@libertybancard.com</span>
                </a>
              </li>
              <li>
                <a
                  href="/get-started"
                  className="flex items-center gap-2 text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-book-call"
                >
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span>Book 10-Minute Call</span>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-quicklinks-heading">Quick Links</h4>
            <ul className="space-y-3">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <h4 className="font-semibold text-lg mt-8 mb-4" data-testid="text-footer-grow-heading">Grow With Us</h4>
            <ul className="space-y-3">
              {growWithUsLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-grow-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <h4 className="font-semibold text-lg mt-8 mb-4" data-testid="text-footer-platform-heading">Platform</h4>
            <ul className="space-y-3">
              {platformLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-quizzes-heading">Free Tools & Quizzes</h4>
            <ul className="space-y-3">
              {quizLinks.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                      data-testid={`link-footer-quiz-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                      data-testid={`link-footer-quiz-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <h4 className="font-semibold text-lg mt-8 mb-4" data-testid="text-footer-solutions-heading">Solutions</h4>
            <ul className="space-y-3">
              {solutionLinks.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-solution-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <h4 className="font-semibold text-lg mt-8 mb-4" data-testid="text-footer-blog-heading">Blog & Resources</h4>
            <ul className="space-y-3">
              {blogLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-blog-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-industries-heading">Industries</h4>
            <ul className="space-y-3">
              {industryFooterLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-industry-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <h4 className="font-semibold text-lg mt-8 mb-4" data-testid="text-footer-legal-heading">Legal</h4>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/70 text-sm hover:text-primary-foreground transition-colors"
                    data-testid={`link-footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 space-y-4">
          <p className="text-primary-foreground/40 text-xs leading-relaxed" data-testid="text-footer-iso-disclosure">
            Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. Liberty Bancard is not a bank. All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor. Liberty Bancard facilitates payment processing services on behalf of its acquiring bank partner(s) and does not directly process transactions, hold merchant funds, or bear settlement risk.
          </p>

          <p className="text-primary-foreground/40 text-xs leading-relaxed" data-testid="text-footer-disclaimer">
            Disclosures: Pricing, program eligibility, funding speed, and equipment offers vary by merchant profile and are subject to underwriting approval. "Next-day funding" options may be available for qualified merchants and depend on cutoff times, bank schedules, and risk review. "0% processing" refers to compliant cash discount or surcharging programs where permitted; applicability depends on state law, card brand rules, and your business model. "Free terminal" placement requires an approved and active processing account, is subject to minimum processing requirements and contract term, and equipment remains the property of Liberty Bancard. Early termination fees may apply. PCI compliance is the merchant's responsibility; we provide guidance and support. We do not provide legal, tax, or financial advice.
          </p>

          <p className="text-primary-foreground/40 text-xs" data-testid="text-footer-compliance">
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review. Contract terms, early termination fees, and equipment return requirements are specified in the Merchant Processing Agreement.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <p className="text-primary-foreground/50 text-sm" data-testid="text-footer-copyright">
              &copy; {new Date().getFullYear()} Liberty Bancard. All rights reserved.
            </p>
            <Link
              href="/do-not-sell"
              className="text-primary-foreground/60 text-sm hover:text-primary-foreground transition-colors underline"
              data-testid="link-footer-do-not-sell"
            >
              Do Not Sell or Share My Personal Information
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
