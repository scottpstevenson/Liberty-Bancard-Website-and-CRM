import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Menu, X, Phone, Mail, Upload, Calendar, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logoBlue from "@assets/logo-blue.png";

const navLinks = [
  { name: "Home", href: "/" },
  { name: "0% Programs", href: "/0-percent-processing" },
  { name: "Beat Square & Stripe", href: "/beat-square-stripe" },
  { name: "About", href: "/about-contact" },
  { name: "Support", href: "/support" },
];

export function Navbar() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed w-full z-50" data-testid="navbar">
      {/* Top Bar */}
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-8 gap-4 text-xs">
            <a
              href="tel:9542668214"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              data-testid="link-phone"
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

      {/* Compliance Microline */}
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

      {/* Main Nav */}
      <div className="bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center shrink-0"
              data-testid="link-logo"
            >
              <img src={logoBlue} alt="Liberty Bancard" className="h-10 w-auto" />
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden lg:flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    location === link.href
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`link-nav-${link.href.replace(/\//g, "").replace(/-/g, "-") || "home"}`}
                >
                  {link.name}
                </Link>
              ))}
              {user && (
                <Link
                  href="/dashboard"
                  className={cn(
                    "text-sm font-medium transition-colors flex items-center gap-1.5",
                    location === "/dashboard"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="link-nav-dashboard"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Dashboard
                </Link>
              )}
            </div>

            {/* Desktop CTAs */}
            <div className="hidden lg:flex items-center gap-3">
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

            {/* Mobile Menu Button */}
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

        {/* Mobile Menu */}
        {isOpen && (
          <div className="lg:hidden bg-background border-t border-border/50 animate-in slide-in-from-top-2 duration-200">
            <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
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
                  data-testid={`link-mobile-nav-${link.href.replace(/\//g, "").replace(/-/g, "-") || "home"}`}
                >
                  {link.name}
                </Link>
              ))}
              {user && (
                <Link
                  href="/dashboard"
                  className={cn(
                    "px-3 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                    location === "/dashboard"
                      ? "text-primary bg-primary/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => setIsOpen(false)}
                  data-testid="link-mobile-nav-dashboard"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
              )}

              <div className="h-px bg-border my-2" />

              {/* Mobile Contact Info */}
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

              {/* Mobile CTAs */}
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
