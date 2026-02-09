import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, User, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { name: "Home", href: "/" },
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
  ];

  return (
    <nav className="fixed w-full z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-display font-bold text-lg">L</span>
            </div>
            <span className="font-display font-bold text-xl text-primary tracking-tight">Liberty Bancard</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
              >
                {link.name}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <Link href="/dashboard">
                  <Button variant="ghost" className="font-medium">Dashboard</Button>
                </Link>
                <Button 
                  onClick={() => logout()}
                  variant="outline" 
                  size="sm"
                  className="gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <a href="/api/login">
                  <Button variant="ghost" className="font-medium">Log in</Button>
                </a>
                <Link href="/get-started">
                  <Button className="font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-primary hover:text-primary/80 transition-colors"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-background border-b border-border p-4 animate-in slide-in-from-top-4 duration-200">
          <div className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-base font-medium text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </a>
            ))}
            <div className="h-px bg-border my-2" />
            {user ? (
              <div className="flex flex-col gap-3">
                <Link href="/dashboard" onClick={() => setIsOpen(false)}>
                  <Button className="w-full">Go to Dashboard</Button>
                </Link>
                <Button 
                  onClick={() => logout()}
                  variant="outline" 
                  className="w-full gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <a href="/api/login">
                  <Button variant="outline" className="w-full">Log in</Button>
                </a>
                <Link href="/get-started" onClick={() => setIsOpen(false)}>
                  <Button className="w-full">Get Started</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
