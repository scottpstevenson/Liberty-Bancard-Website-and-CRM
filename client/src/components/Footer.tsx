import { useId, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { ChevronDown, Phone, Mail, Calendar } from "lucide-react";
import logoWhite from "@/assets/logo-white.png";
import { CALENDAR_URL } from "@/lib/constants";
import { trackBookingCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { buildAttributedBookingUrl } from "@/lib/utm";
import { PUBLIC_FOOTER_GROUPS } from "@shared/public-footer-links";
import { FOOTER_COMPLIANCE, FOOTER_DISCLAIMER } from "@shared/public-disclosures";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True from the desktop breakpoint, where every footer group is always expanded. */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function FooterGroup({ id, label, links, desktop }: { id: string; label: string; links: { label: string; href: string }[]; desktop: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const expanded = desktop || open;
  return (
    <section className="border-t border-white/10 lg:border-0" data-testid={`footer-group-${id}`}>
      {desktop ? (
        <h3 className="mb-4 text-lg font-semibold" data-testid={`text-footer-${id}-heading`}>{label}</h3>
      ) : (
        <h3>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left text-base font-semibold text-primary-foreground"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            data-testid={`button-footer-${id}-toggle`}
          >
            <span data-testid={`text-footer-${id}-heading`}>{label}</span>
            <ChevronDown className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </h3>
      )}
      {/* Collapsed panels stay in the DOM (hidden), so every link remains present for assistive tech after expansion and for crawlers. */}
      <ul id={panelId} className={`${expanded ? "grid" : "hidden"} gap-x-4 pb-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-x-0 lg:pb-0`} data-testid={`list-footer-${id}`}>
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className="public-tap inline-flex items-center text-sm text-primary-foreground/80 transition-colors hover:text-primary-foreground lg:py-1"
              data-testid={`link-footer-${id}-${slug(link.label)}`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Footer() {
  const desktop = useIsDesktop();
  return (
    <footer className="relative bg-primary text-primary-foreground pt-10 pb-28 md:pb-8 lg:pt-16" data-testid="footer">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 grid grid-cols-1 gap-8 lg:mb-12 lg:grid-cols-[1.1fr_repeat(4,minmax(0,1fr))] lg:gap-10">
          <div>
            <Link href="/" data-testid="link-footer-logo">
              <img src={logoWhite} alt="Liberty Bancard" className="h-10 w-auto mb-4" />
            </Link>
            <p className="text-primary-foreground/80 text-sm leading-relaxed mb-5" data-testid="text-footer-description">
              We don't sell a rate. We prove your real cost and fix it.
            </p>
            <h4 className="font-semibold text-sm mb-2" data-testid="text-footer-contact-heading">Contact</h4>
            <ul className="space-y-1">
              <li>
                <a
                  href="tel:9542668214"
                  className="public-tap flex items-center gap-2 text-primary-foreground/80 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-phone"
                  onClick={() => trackPhoneCallClick({})}
                >
                  <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Call/Text 954-266-8214</span>
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@libertybancard.com"
                  className="public-tap flex items-center gap-2 text-primary-foreground/80 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-email"
                >
                  <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>support@libertybancard.com</span>
                </a>
              </li>
              <li>
                <a
                  href={buildAttributedBookingUrl(CALENDAR_URL, { ctaLocation: "footer" })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-tap flex items-center gap-2 text-primary-foreground/80 text-sm hover:text-primary-foreground transition-colors"
                  data-testid="link-footer-book-call"
                  onClick={() => trackBookingCtaClick({ ctaLocation: "footer" })}
                >
                  <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Book a review call</span>
                </a>
              </li>
            </ul>
          </div>

          <div className="grid gap-0 lg:contents" data-testid="footer-groups">
            {PUBLIC_FOOTER_GROUPS.map((group) => (
              <FooterGroup key={group.id} id={group.id} label={group.label} links={group.links} desktop={desktop} />
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 space-y-4">
          <p className="text-primary-foreground/70 text-xs leading-relaxed" data-testid="text-footer-iso-disclosure">
            Liberty Bancard is a registered Independent Sales Organization (ISO) and merchant services provider. Liberty Bancard is not a bank. All merchant accounts are subject to application, credit approval, and underwriting by the acquiring bank and payment processor. Liberty Bancard facilitates payment processing services on behalf of its acquiring bank partner(s) and does not directly process transactions, hold merchant funds, or bear settlement risk.
          </p>

          <p className="text-primary-foreground/70 text-xs leading-relaxed" data-testid="text-footer-disclaimer">
            {FOOTER_DISCLAIMER}
          </p>

          <p className="text-primary-foreground/70 text-xs" data-testid="text-footer-compliance">
            {FOOTER_COMPLIANCE}
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <p className="text-primary-foreground/70 text-sm" data-testid="text-footer-copyright">
              &copy; {new Date().getFullYear()} Liberty Bancard. All rights reserved.
            </p>
            <Link
              href="/do-not-sell"
              className="public-tap inline-flex items-center text-primary-foreground/60 text-sm hover:text-primary-foreground transition-colors underline"
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
