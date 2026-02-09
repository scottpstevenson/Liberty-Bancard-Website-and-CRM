import { Link } from "wouter";
import { Phone, Mail, Calendar } from "lucide-react";

export function Footer() {
  const quickLinks = [
    { label: "Home", href: "/" },
    { label: "0% Programs", href: "/0-percent-processing" },
    { label: "Beat Square & Stripe", href: "/beat-square-stripe" },
    { label: "About", href: "/about-contact" },
    { label: "Support", href: "/support" },
    { label: "Upload Statement", href: "/upload-statement" },
    { label: "Get Started", href: "/get-started" },
  ];

  const legalLinks = [
    { label: "Privacy Policy", href: "/privacy-policy" },
    { label: "Terms", href: "/terms" },
  ];

  return (
    <footer className="bg-primary text-primary-foreground pt-16 pb-8" data-testid="footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          <div>
            <Link href="/" data-testid="link-footer-logo">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-lg">L</span>
                </div>
                <span className="font-bold text-xl tracking-tight">Liberty Bancard</span>
              </div>
            </Link>
            <p className="text-primary-foreground/70 text-sm leading-relaxed" data-testid="text-footer-description">
              We don't sell a rate. We prove your real cost and fix it.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-quicklinks-heading">Quick Links</h4>
            <ul className="space-y-3">
              {quickLinks.map((link) => (
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
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-contact-heading">Contact</h4>
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
            <h4 className="font-semibold text-lg mb-4" data-testid="text-footer-legal-heading">Legal</h4>
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
          <p className="text-primary-foreground/40 text-xs leading-relaxed" data-testid="text-footer-disclaimer">
            Disclosures: Liberty Bancard provides payment processing and related services. Pricing, program eligibility, funding speed, and equipment offers vary by merchant profile and are subject to underwriting approval. "Next-day funding" options may be available for qualified merchants and depend on cutoff times, bank schedules, and risk review. "0% processing" refers to compliant cash discount or surcharging programs where permitted; applicability depends on state law, card brand rules, and your business model. PCI compliance is the merchant's responsibility; we provide guidance and support. We do not provide legal or tax advice.
          </p>

          <p className="text-primary-foreground/40 text-xs" data-testid="text-footer-compliance">
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
          </p>

          <p className="text-primary-foreground/50 text-sm" data-testid="text-footer-copyright">
            &copy; {new Date().getFullYear()} Liberty Bancard. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
