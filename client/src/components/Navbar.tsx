import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Menu, X, Phone, Mail, Upload, Calendar, LayoutDashboard } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import logoBlue from "@assets/logo-blue.png";
import { ThemeToggle } from "@/components/ThemeToggle";

const solutionLinks = [
  { name: "0% Processing Programs", href: "/0-percent-processing" },
  { name: "Beat Square & Stripe", href: "/beat-square-stripe" },
  { name: "Upload Statement", href: "/upload-statement" },
  { name: "Get Started", href: "/get-started" },
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
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className="fixed w-full z-50" data-testid="navbar">
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
          data-testid="mobile-nav-backdrop"
        />
      )}

      <div className="bg-primary text-primary-foreground relative z-50">
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

      <div className="bg-muted/80 border-b border-border/30 relative z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p
            className="text-[10px] text-muted-foreground text-center py-0.5 leading-tight"
            data-testid="text-compliance"
          >
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
          </p>
        </div>
      </div>

      <div
        className={cn(
          "transition-all duration-200 border-b relative z-50",
          scrolled
            ? "bg-background shadow-sm border-border/80"
            : "bg-background/80 backdrop-blur-md border-border/50"
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <Link
              href="/"
              className="flex items-center shrink-0"
              data-testid="link-logo"
            >
              <img src={logoBlue} alt="Liberty Bancard" className="h-10 w-auto" />
            </Link>

            <div className="hidden lg:flex items-center gap-4">
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

              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className={cn(
                        "text-sm font-medium transition-colors bg-transparent hover:bg-transparent focus:bg-transparent data-[active]:bg-transparent data-[state=open]:bg-transparent h-auto p-0",
                        solutionLinks.some(l => location === l.href)
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid="button-nav-solutions"
                    >
                      Solutions
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-56 py-1">
                        {solutionLinks.map((link) => (
                          <Link
                            key={link.name}
                            href={link.href}
                            className={cn(
                              "block px-4 py-2.5 text-sm transition-colors",
                              location === link.href
                                ? "text-primary bg-primary/5"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            )}
                            data-testid={`link-nav-solution-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            {link.name}
                          </Link>
                        ))}
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className={cn(
                        "text-sm font-medium transition-colors bg-transparent hover:bg-transparent focus:bg-transparent data-[active]:bg-transparent data-[state=open]:bg-transparent h-auto p-0",
                        location.startsWith("/industries")
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid="button-nav-industries"
                    >
                      Industries
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-64 py-1">
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
                            data-testid={`link-nav-industry-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            {link.name}
                          </Link>
                        ))}
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className={cn(
                        "text-sm font-medium transition-colors bg-transparent hover:bg-transparent focus:bg-transparent data-[active]:bg-transparent data-[state=open]:bg-transparent h-auto p-0",
                        resourceLinks.some(l => location === l.href)
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid="button-nav-resources"
                    >
                      Resources
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-52 py-1">
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
                            data-testid={`link-nav-resource-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            {link.name}
                          </Link>
                        ))}
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>

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
              <a
                href="tel:9542668214"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-phone"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>954-266-8214</span>
              </a>
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

            <div className="lg:hidden relative z-50">
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
          <div className="lg:hidden bg-background border-t border-border/50 animate-in slide-in-from-top-2 duration-200 relative z-50">
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
