import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, ArrowLeft, Search, HelpCircle, MessageSquare } from "lucide-react";
import { SEO } from "@/components/SEO";

const popularLinks: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Free Savings Analysis", href: "/free-analysis" },
  { label: "Upload a Statement", href: "/upload-statement" },
  { label: "Equipment Shop", href: "/shop" },
  { label: "Help Center", href: "/help" },
  { label: "Contact Support", href: "/support" },
];

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <SEO
        title="Page Not Found"
        description="The page you're looking for may have been moved, renamed, or no longer exists. Return to Liberty Bancard's homepage."
        noindex
      />
      <Card className="w-full max-w-xl" data-testid="page-not-found">
        <CardContent className="p-8 sm:p-10 text-center">
          <p className="text-sm font-semibold text-primary mb-2" data-testid="text-404-code">404</p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-3" data-testid="text-404-title">
            We couldn't find that page
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mb-8 max-w-md mx-auto" data-testid="text-404-message">
            The page you're looking for may have been moved, renamed, or no longer exists. Let's get you back on track.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
            <Link href="/" data-testid="link-404-home">
              <Button className="gap-2 w-full sm:w-auto">
                <Home className="w-4 h-4" /> Go to Homepage
              </Button>
            </Link>
            <Button
              variant="outline"
              className="gap-2 w-full sm:w-auto"
              onClick={() => window.history.back()}
              data-testid="button-404-back"
              aria-label="Go back to the previous page"
            >
              <ArrowLeft className="w-4 h-4" /> Go Back
            </Button>
          </div>

          <div className="border-t border-border pt-6 text-left">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2 justify-center">
              <Search className="w-3.5 h-3.5" /> Popular destinations
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {popularLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors px-2 py-1.5 rounded hover-elevate text-center"
                  data-testid={`link-404-${link.href.replace(/\W+/g, "-")}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <Link href="/help" className="flex items-center gap-1 hover:text-primary transition-colors" data-testid="link-404-help">
              <HelpCircle className="w-3.5 h-3.5" /> Help Center
            </Link>
            <Link href="/support" className="flex items-center gap-1 hover:text-primary transition-colors" data-testid="link-404-support">
              <MessageSquare className="w-3.5 h-3.5" /> Contact Support
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
