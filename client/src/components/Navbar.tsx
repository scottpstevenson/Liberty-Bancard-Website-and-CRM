import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Menu, X, Phone, Mail, Upload, Calendar, LayoutDashboard, ChevronDown, Zap, Handshake } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logoBlue from "@assets/logo-blue.png";
import { ThemeToggle } from "@/components/ThemeToggle";

const solutionLinks = [
  { name: "Liberty Zero™ — Pay $0 to Process", href: "/0-percent-processing", featured: true },
  { name: "Beat Square & Stripe", href: "/beat-square-stripe", featured: false },
  { name: "Upload Statement", href: "/upload-statement", featured: false },
  { name: "Get Started", href: "/get-started", featured: false },
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
  { name: "Blog", href: "/blog" },
  { name: "FAQ", href: "/faq" },
  { name: "Help Center", href: "/help" },
  { name: "Case Studies", href: "/case-studies" },
  { name: "Why Liberty Bancard", href: "/why-liberty-bancard" },
  { name: "Savings Calculator", href: "/savings-calculator" },
  { name: "Compare Rates", href: "/compare-rates" },
  { name: "About & Contact", href: "/about-contact" },
  { name: "Support", href: "/support" },
];

export function Navbar() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [industriesOpen, setIndustriesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  return (
    <nav className="fixed w-full z-50" data-testid="navbar">
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-8 gap-2 sm:gap-4 text-xs">
            <a
              href="tel:9542668214"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              data-testid="link-phone"
            >
              <Phone className="w-3 h-3" />
              <span className="hidden xs:inline">Call/Text</span> <span>954-266-8214</span>
            </a>
            <span className="opacity-60 hidden sm:inline">|</span>
            <a
              href="mailto:support@libertybancard.com"
              className="hidden sm:flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              data-testid="link-email"
            >
              <Mail className="w-3 h-3" />
              <span>support@libertybancard.com</span>
            </a>
          </div>
        </div>
      </div>

      <div className="bg-muted/80 border-b border-border/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p
            className="text-[10px] text-muted-foreground text-center py-0.5 leading-tight"
            data-testid="text-compliance"
          >
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
          </p>
        </div>
      </div>

      <div className="bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <Link
              href="/"
              className="flex items-center shrink-0"
              data-testid="link-logo"
            >
              <img src={logoBlue} alt="Liberty Bancard" className="h-10 w-auto" />
            </Link>

            <div className="hidden lg:flex items-center gap-6">
              <Link
                href="/"
                className={cn(
                  "text-sm font-medium transition-colors",
                  location === "/"
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="link-nav-home"
              >
                Home
              </Link>

              <div
                className="relative"
                onMouseEnter={() => setSolutionsOpen(true)}
                onMouseLeave={() => setSolutionsOpen(false)}
              >
                <button
                  className={cn(
                    "text-sm font-medium transition-colors flex items-center gap-1",
                    solutionLinks.some(l => location === l.href)
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="button-nav-solutions"
                >
                  Solutions
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <div
                  className={cn(
                    "absolute top-full left-0 mt-1 w-72 bg-background border border-border rounded-md shadow-lg py-1 z-50 transition-all",
                    solutionsOpen ? "opacity-100 visible" : "opacity-0 invisible"
                  )}
                >
                  {solutionLinks.map((link) => (
                    link.featured ? (
                      <Link
                        key={link.name}
                        href={link.href}
                        className={cn(
                          "flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b border-border",
                          location === link.href
                            ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                            : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 bg-emerald-50/50 dark:bg-emerald-950/10"
                        )}
                        onClick={() => setSolutionsOpen(false)}
                        data-testid={`link-nav-solution-liberty-zero`}
                      >
                        <Zap className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-semibold">{link.name}</span>
                      </Link>
                    ) : (
                      <Link
                        key={link.name}
                        href={link.href}
                        className={cn(
                          "block px-4 py-2.5 text-sm transition-colors",
                          location === link.href
                            ? "text-primary bg-primary/5"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        onClick={() => setSolutionsOpen(false)}
                        data-testid={`link-nav-solution-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        {link.name}
                      </Link>
                    )
                  ))}
                </div>
              </div>

              <div
                className="relative"
                onMouseEnter={() => setIndustriesOpen(true)}
                onMouseLeave={() => setIndustriesOpen(false)}
              >
                <button
                  className={cn(
                    "text-sm font-medium transition-colors flex items-center gap-1",
                    location.startsWith("/industries")
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="button-nav-industries"
                >
                  Industries
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <div
                  className={cn(
                    "absolute top-full left-0 mt-1 w-60 bg-background border border-border rounded-md shadow-lg py-1 z-50 transition-all",
                    industriesOpen ? "opacity-100 visible" : "opacity-0 invisible"
                  )}
                >
                  {industryLinks.map((link) => (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        "block px-4 py-2.5 text-sm transition-colors",
                        location === link.href
                          ? "text-primary bg-primary/5"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                      onClick={() => setIndustriesOpen(false)}
                      data-testid={`link-nav-industry-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.name}
                    </Link>
                  ))}
                </div>
              </div>

              <div
                className="relative"
                onMouseEnter={() => setResourcesOpen(true)}
                onMouseLeave={() => setResourcesOpen(false)}
              >
                <button
                  className={cn(
                    "text-sm font-medium transition-colors flex items-center gap-1",
                    resourceLinks.some(l => location === l.href)
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="button-nav-resources"
                >
                  Resources
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <div
                  className={cn(
                    "absolute top-full left-0 mt-1 w-52 bg-background border border-border rounded-md shadow-lg py-1 z-50 transition-all",
                    resourcesOpen ? "opacity-100 visible" : "opacity-0 invisible"
                  )}
                >
                  {resourceLinks.map((link) => (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        "block px-4 py-2.5 text-sm transition-colors",
                        location === link.href
                          ? "text-primary bg-primary/5"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                      onClick={() => setResourcesOpen(false)}
                      data-testid={`link-nav-resource-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {link.name}
                    </Link>
                  ))}
                </div>
              </div>

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
                  location.startsWith("/dashboard")
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="link-nav-dashboard"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                {user ? "Dashboard" : "Staff Login"}
              </Link>
            </div>

            <div className="hidden lg:flex items-center gap-3">
              <ThemeToggle />
              <a href="#" data-testid="link-book-call">
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

            <div className="lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(!isOpen)}
                data-testid="button-mobile-menu"
                aria-label={isOpen ? "Close menu" : "Open menu"}
              >
                {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className="lg:hidden bg-background border-t border-border/50 animate-in slide-in-from-top-2 duration-200">
            <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
              <Link
                href="/"
                className={cn(
                  "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  location === "/"
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setIsOpen(false)}
                data-testid="link-mobile-nav-home"
              >
                Home
              </Link>

              <div className="h-px bg-border my-2" />

              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Solutions</p>
              {solutionLinks.map((link) => (
                link.featured ? (
                  <Link
                    key={link.name}
                    href={link.href}
                    className={cn(
                      "px-3 py-2.5 rounded-md text-sm font-semibold transition-colors flex items-center gap-2",
                      location === link.href
                        ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                        : "text-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    )}
                    onClick={() => setIsOpen(false)}
                    data-testid="link-mobile-solution-liberty-zero"
                  >
                    <Zap className="w-4 h-4 shrink-0" />
                    {link.name}
                  </Link>
                ) : (
                  <Link
                    key={link.name}
                    href={link.href}
                    className={cn(
                      "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      location === link.href
                        ? "text-primary bg-primary/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    onClick={() => setIsOpen(false)}
                    data-testid={`link-mobile-solution-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    {link.name}
                  </Link>
                )
              ))}

              <div className="h-px bg-border my-2" />

              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Industries</p>
              {industryLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    location === link.href
                      ? "text-primary bg-primary/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => setIsOpen(false)}
                  data-testid={`link-mobile-industry-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  {link.name}
                </Link>
              ))}

              <div className="h-px bg-border my-2" />

              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resources</p>
              {resourceLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    location === link.href
                      ? "text-primary bg-primary/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => setIsOpen(false)}
                  data-testid={`link-mobile-resource-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  {link.name}
                </Link>
              ))}

              <div className="h-px bg-border my-2" />

              <Link
                href="/partners"
                className={cn(
                  "px-3 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                  location === "/partners" || location === "/partner-portal"
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setIsOpen(false)}
                data-testid="link-mobile-nav-partners"
              >
                <Handshake className="w-4 h-4" />
                Partner Program
              </Link>

              <Link
                href="/dashboard"
                className={cn(
                  "px-3 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                  location.startsWith("/dashboard")
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setIsOpen(false)}
                data-testid="link-mobile-nav-dashboard"
              >
                <LayoutDashboard className="w-4 h-4" />
                {user ? "Dashboard" : "Staff Login"}
              </Link>

              <div className="h-px bg-border my-2" />

              <div className="flex flex-col gap-2 px-3 py-2">
                <a
                  href="tel:9542668214"
                  className="text-sm text-muted-foreground flex items-center gap-2"
                  data-testid="link-mobile-phone"
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

              <div className="h-px bg-border my-2" />

              <div className="flex flex-col gap-2 px-3">
                <a href="#" data-testid="link-mobile-book-call">
                  <Button variant="outline" className="w-full gap-2">
                    <Calendar className="w-4 h-4" />
                    Book 10-Min Call
                  </Button>
                </a>
                <Link
                  href="/upload-statement"
                  onClick={() => setIsOpen(false)}
                  data-testid="link-mobile-upload-statement"
                >
                  <Button className="w-full gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Statement
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
