import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Menu,
  Phone,
  Mail,
  Upload,
  Calendar,
  LayoutDashboard,
  ChevronDown,
  Zap,
  Handshake,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import logoBlue from "@assets/logo-blue.png";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CALENDAR_URL } from "@/lib/constants";
import { trackCalendarBooking, trackBookingCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { buildAttributedBookingUrl } from "@/lib/utm";

// ─── Rationalised link lists ────────────────────────────────────────────────

const solutionLinks = [
  {
    name: "Statement Analysis",
    href: "/free-analysis",
    desc: "Upload a statement and get a free line-item cost breakdown",
    featured: true,
  },
  {
    name: "Cash Discount & Surcharging",
    href: "/0-percent-processing",
    desc: "Compliant fee-offset programs — process at 0%",
    featured: false,
  },
  {
    name: "Free Smart Terminal",
    href: "/free-smart-terminal",
    desc: "Modern hardware at no extra cost for qualifying merchants",
    featured: false,
  },
  {
    name: "Virtual Terminal & Equipment",
    href: "/shop",
    desc: "Browse payment terminals, POS systems, and accessories",
    featured: false,
  },
  {
    name: "ISO Partner Program",
    href: "/partners",
    desc: "Earn 30–50% residuals for every merchant you refer",
    featured: false,
  },
];

const industryLinks = [
  { name: "Restaurant", href: "/industries/restaurant-payment-processing" },
  { name: "Retail", href: "/industries/retail-payment-processing" },
  { name: "Healthcare", href: "/industries/healthcare-payment-processing" },
  { name: "Salon & Spa", href: "/industries/salon-spa-payment-processing" },
  { name: "Auto Repair", href: "/industries/auto-repair-payment-processing" },
  { name: "Professional Services", href: "/industries/professional-services-payment-processing" },
  { name: "E-Commerce", href: "/industries/ecommerce-payment-processing" },
  { name: "Construction", href: "/industries/construction-payment-processing" },
];

const resourceLinks = [
  {
    name: "Blog",
    href: "/blog",
    desc: "Expert guides on processing costs, fees, and merchant services",
  },
  {
    name: "Help Center",
    href: "/help",
    desc: "Browse articles on account setup, billing, terminals, and compliance",
  },
  {
    name: "Savings Calculator",
    href: "/savings-calculator",
    desc: "Estimate how much you could save with interchange-plus pricing",
  },
  {
    name: "Free Analysis",
    href: "/free-analysis",
    desc: "60-second quiz — get a personalised savings estimate",
  },
  {
    name: "Case Studies",
    href: "/case-studies",
    desc: "Real merchant results from switching to Liberty Bancard",
  },
  {
    name: "Sales Training",
    href: "/sales-tools",
    desc: "Partner resources, one-pagers, and objection handlers",
  },
  {
    name: "Partner Resources",
    href: "/partners",
    desc: "ISO tools, co-branded collateral, and partner portal access",
  },
];

// ─── Desktop dropdown item ───────────────────────────────────────────────────

function DropdownItem({
  href,
  name,
  desc,
  active,
  featured,
  onClose,
  testId,
}: {
  href: string;
  name: string;
  desc?: string;
  active: boolean;
  featured?: boolean;
  onClose: () => void;
  testId?: string;
}) {
  if (featured) {
    return (
      <Link
        href={href}
        className={cn(
          "flex items-start gap-2.5 px-4 py-3 text-sm transition-colors border-b border-border",
          active
            ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
            : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 bg-emerald-50/50 dark:bg-emerald-950/10"
        )}
        onClick={onClose}
        data-testid={testId}
      >
        <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-semibold block">{name}</span>
          {desc && <span className="text-xs text-emerald-600/70 dark:text-emerald-500/70">{desc}</span>}
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "block px-4 py-2.5 text-sm transition-colors",
        active ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
      onClick={onClose}
      data-testid={testId}
    >
      <span className="font-medium block leading-snug">{name}</span>
      {desc && <span className="text-xs text-muted-foreground mt-0.5 block">{desc}</span>}
    </Link>
  );
}

// ─── Main Navbar ─────────────────────────────────────────────────────────────

export function Navbar() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [industriesOpen, setIndustriesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  // Close all dropdowns and mobile drawer on route change
  useEffect(() => {
    setSolutionsOpen(false);
    setIndustriesOpen(false);
    setResourcesOpen(false);
    setMobileOpen(false);
  }, [location]);

  return (
    <nav className="fixed w-full z-50" data-testid="navbar">
      {/* Desktop-only phone/email bar */}
      <div className="hidden md:block bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-8 gap-2 sm:gap-4 text-xs">
            <a
              href="tel:9542668214"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              data-testid="link-phone"
              onClick={() => trackPhoneCallClick({})}
            >
              <Phone className="w-3 h-3" />
              <span>Call/Text 954-266-8214</span>
            </a>
            <span className="opacity-60">|</span>
            <a
              href="mailto:support@libertybancard.com"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              data-testid="link-email"
            >
              <Mail className="w-3 h-3" />
              <span>support@libertybancard.com</span>
            </a>
          </div>
        </div>
      </div>

      <div className="bg-card/95 backdrop-blur-md border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-[72px] md:h-16 gap-4">
            {/* Logo */}
            <Link href="/" className="flex items-center shrink-0" data-testid="link-logo">
              <img
                src={logoBlue}
                alt="Liberty Bancard"
                className="h-8 w-auto max-w-[240px] md:h-10 md:max-w-none"
              />
            </Link>

            {/* Desktop nav */}
            <div className="hidden lg:flex items-center gap-6">
              <Link
                href="/"
                className={cn(
                  "text-sm font-medium transition-colors",
                  location === "/" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="link-nav-home"
              >
                Home
              </Link>

              {/* Solutions dropdown */}
              <DesktopDropdown
                label="Solutions"
                isOpen={solutionsOpen}
                onOpen={() => setSolutionsOpen(true)}
                onClose={() => setSolutionsOpen(false)}
                active={solutionLinks.some(l => location === l.href)}
                testId="button-nav-solutions"
                width="w-80"
              >
                {solutionLinks.map((link) => (
                  <DropdownItem
                    key={link.name}
                    href={link.href}
                    name={link.name}
                    desc={link.desc}
                    active={location === link.href}
                    featured={link.featured}
                    onClose={() => setSolutionsOpen(false)}
                    testId={`link-nav-solution-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  />
                ))}
              </DesktopDropdown>

              {/* Industries dropdown */}
              <DesktopDropdown
                label="Industries"
                isOpen={industriesOpen}
                onOpen={() => setIndustriesOpen(true)}
                onClose={() => setIndustriesOpen(false)}
                active={location.startsWith("/industries")}
                testId="button-nav-industries"
                width="w-64"
              >
                {industryLinks.map((link) => (
                  <DropdownItem
                    key={link.name}
                    href={link.href}
                    name={link.name}
                    active={location === link.href}
                    onClose={() => setIndustriesOpen(false)}
                    testId={`link-nav-industry-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  />
                ))}
              </DesktopDropdown>

              {/* Resources dropdown */}
              <DesktopDropdown
                label="Resources"
                isOpen={resourcesOpen}
                onOpen={() => setResourcesOpen(true)}
                onClose={() => setResourcesOpen(false)}
                active={resourceLinks.some(l => location === l.href)}
                testId="button-nav-resources"
                width="w-80"
              >
                {resourceLinks.map((link) => (
                  <DropdownItem
                    key={link.name}
                    href={link.href}
                    name={link.name}
                    desc={link.desc}
                    active={location === link.href}
                    onClose={() => setResourcesOpen(false)}
                    testId={`link-nav-resource-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  />
                ))}
              </DesktopDropdown>

              <Link
                href="/partners"
                className={cn(
                  "text-sm font-medium transition-colors flex items-center gap-1.5",
                  location === "/partners" || location === "/partner-portal"
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="link-nav-partners"
              >
                <Handshake className="w-3.5 h-3.5" />
                Partner Program
              </Link>

              <Link
                href="/dashboard"
                className={cn(
                  "text-sm font-medium transition-colors flex items-center gap-1.5",
                  location.startsWith("/dashboard") ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="link-nav-dashboard"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                {user ? "Dashboard" : "Staff Login"}
              </Link>
            </div>

            {/* Desktop CTAs */}
            <div className="hidden lg:flex items-center gap-3">
              <ThemeToggle />
              <a
                href={buildAttributedBookingUrl(CALENDAR_URL, { ctaLocation: "navbar_desktop" })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackCalendarBooking("navbar_desktop");
                  trackBookingCtaClick({ ctaLocation: "navbar_desktop" });
                }}
                data-testid="link-book-call"
              >
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Book 10-Min Call
                </Button>
              </a>
              <Link href="/upload-statement" data-testid="link-upload-statement">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </Button>
              </Link>
            </div>

            {/* Mobile hamburger */}
            <div className="lg:hidden">
              <Button
                variant="ghost"
                className="h-11 w-11 p-0"
                onClick={() => setMobileOpen(true)}
                data-testid="button-mobile-menu"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Mobile full-height Sheet drawer ───────────────────────────────── */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="right"
            className="w-[85vw] max-w-sm p-0 flex flex-col"
            data-testid="mobile-nav-drawer"
          >
            {/* SheetContent already renders an absolute close (X) button top-right;
                no custom SheetClose needed here — adding one creates duplicates. */}
            <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0 pr-12">
              <SheetTitle asChild>
                <Link href="/" onClick={() => setMobileOpen(false)} data-testid="link-mobile-logo">
                  <img src={logoBlue} alt="Liberty Bancard" className="h-7 w-auto" />
                </Link>
              </SheetTitle>
            </SheetHeader>

            {/* Scrollable nav body */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <Link
                href="/"
                className={cn(
                  "block px-3 py-2.5 rounded-md text-sm font-medium transition-colors mb-1",
                  location === "/" ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setMobileOpen(false)}
                data-testid="link-mobile-nav-home"
              >
                Home
              </Link>

              {/* Accordion groups */}
              <Accordion type="single" collapsible className="w-full">
                {/* Solutions */}
                <AccordionItem value="solutions" className="border-none">
                  <AccordionTrigger
                    className="px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:no-underline rounded-md hover:bg-muted/50"
                    data-testid="accordion-trigger-solutions"
                  >
                    Solutions
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    {solutionLinks.map((link) => (
                      <Link
                        key={link.name}
                        href={link.href}
                        className={cn(
                          "block px-4 py-2.5 rounded-md text-sm transition-colors",
                          link.featured ? "font-semibold text-emerald-600" : "font-medium",
                          location === link.href
                            ? "text-primary bg-primary/5"
                            : link.featured
                              ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        onClick={() => setMobileOpen(false)}
                        data-testid={`link-mobile-solution-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        {link.name}
                        {link.desc && (
                          <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                            {link.desc}
                          </span>
                        )}
                      </Link>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                {/* Industries */}
                <AccordionItem value="industries" className="border-none">
                  <AccordionTrigger
                    className="px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:no-underline rounded-md hover:bg-muted/50"
                    data-testid="accordion-trigger-industries"
                  >
                    Industries
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    {industryLinks.map((link) => (
                      <Link
                        key={link.name}
                        href={link.href}
                        className={cn(
                          "block px-4 py-2.5 rounded-md text-sm font-medium transition-colors",
                          location === link.href
                            ? "text-primary bg-primary/5"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        onClick={() => setMobileOpen(false)}
                        data-testid={`link-mobile-industry-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        {link.name}
                      </Link>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                {/* Resources */}
                <AccordionItem value="resources" className="border-none">
                  <AccordionTrigger
                    className="px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:no-underline rounded-md hover:bg-muted/50"
                    data-testid="accordion-trigger-resources"
                  >
                    Resources
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    {resourceLinks.map((link) => (
                      <Link
                        key={link.name}
                        href={link.href}
                        className={cn(
                          "block px-4 py-2.5 rounded-md text-sm font-medium transition-colors",
                          location === link.href
                            ? "text-primary bg-primary/5"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        onClick={() => setMobileOpen(false)}
                        data-testid={`link-mobile-resource-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        {link.name}
                        {link.desc && (
                          <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                            {link.desc}
                          </span>
                        )}
                      </Link>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="h-px bg-border my-2" />

              <Link
                href="/partners"
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  location === "/partners" || location === "/partner-portal"
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setMobileOpen(false)}
                data-testid="link-mobile-nav-partners"
              >
                <Handshake className="w-4 h-4" />
                Partner Program
              </Link>

              <Link
                href="/dashboard"
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  location.startsWith("/dashboard")
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setMobileOpen(false)}
                data-testid="link-mobile-nav-dashboard"
              >
                <LayoutDashboard className="w-4 h-4" />
                {user ? "Dashboard" : "Staff Login"}
              </Link>

              <div className="h-px bg-border my-2" />

              {/* Contact info */}
              <div className="flex flex-col gap-2 px-3 py-2">
                <a
                  href="tel:9542668214"
                  className="text-sm text-muted-foreground flex items-center gap-2"
                  data-testid="link-mobile-phone"
                  onClick={() => trackPhoneCallClick({})}
                >
                  <Phone className="w-4 h-4" />
                  Call/Text 954-266-8214
                </a>
                <a
                  href="mailto:support@libertybancard.com"
                  className="text-sm text-muted-foreground flex items-center gap-2"
                  data-testid="link-mobile-email"
                >
                  <Mail className="w-4 h-4" />
                  support@libertybancard.com
                </a>
              </div>
            </div>

            {/* Pinned CTA buttons at the bottom of the drawer */}
            <div className="shrink-0 border-t border-border p-4 flex flex-col gap-2 bg-background">
              <a
                href={buildAttributedBookingUrl(CALENDAR_URL, { ctaLocation: "navbar_mobile" })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackCalendarBooking("navbar_mobile");
                  trackBookingCtaClick({ ctaLocation: "navbar_mobile" });
                  setMobileOpen(false);
                }}
                data-testid="link-mobile-book-call"
              >
                <Button variant="outline" className="w-full gap-2">
                  <Calendar className="w-4 h-4" />
                  Book a Free Call
                </Button>
              </a>
              <Link
                href="/upload-statement"
                onClick={() => setMobileOpen(false)}
                data-testid="link-mobile-upload-statement"
              >
                <Button className="w-full gap-2">
                  <Upload className="w-4 h-4" />
                  Upload My Statement
                </Button>
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

// ─── Desktop dropdown wrapper ─────────────────────────────────────────────────

function DesktopDropdown({
  label,
  isOpen,
  onOpen,
  onClose,
  active,
  testId,
  width,
  children,
}: {
  label: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  active: boolean;
  testId: string;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        className={cn(
          "text-sm font-medium transition-colors flex items-center gap-1",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        )}
        data-testid={testId}
      >
        {label}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <div
        className={cn(
          `absolute top-full left-0 mt-1 ${width} bg-background border border-border rounded-md shadow-lg py-1 z-50 transition-all`,
          isOpen ? "opacity-100 visible" : "opacity-0 invisible"
        )}
      >
        {children}
      </div>
    </div>
  );
}
