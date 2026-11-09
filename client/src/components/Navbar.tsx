import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Menu, Phone, Mail, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import logoBlue from "@/assets/logo-blue-420.png";
import { PUBLIC_CONTACT_CHANNELS } from "@shared/public-contact-content";
import { trackPhoneCallClick } from "@/lib/analytics";
import {
  isHomeAnchor,
  needsNativeNavigation,
  navTestId,
  PUBLIC_NAV_CTA,
  PUBLIC_NAV_GROUPS,
  PUBLIC_NAV_UTILITIES,
  type PublicNavGroup,
  type PublicNavLink,
} from "@shared/public-navigation";

// The five groups, their links, the header action and the utility links (Support, Account sign in, Partner
// sign in) come from shared/public-navigation.ts, the same model the server-rendered header reads. The full
// desktop header (five groups, three utilities and the action) needs 1280px to fit without crowding, so the
// labelled Menu button serves everything narrower.

/**
 * Hash links to a section of Home navigate natively so the browser scrolls, and so do the server-only glossary
 * pages (the client router has no route for them); everything else is client-side.
 */
function NavAnchor({
  href,
  className,
  onClick,
  children,
  ...rest
}: {
  href: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
  "data-testid"?: string;
  "data-active"?: boolean;
  "aria-current"?: "page";
}) {
  if (needsNativeNavigation(href)) {
    return (
      <a href={href} className={className} onClick={onClick} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}

function isGroupActive(group: PublicNavGroup, location: string): boolean {
  if (group.id === "industries") return location === "/industries" || location.startsWith("/industries/");
  if (group.id === "equipment") return location === "/shop" || location.startsWith("/shop/") || location === "/free-smart-terminal";
  if (group.id === "resources") return ["/learn", "/blog", "/compare-rates", "/faq", "/case-studies", "/savings-calculator"].some((p) => location === p || location.startsWith(`${p}/`));
  if (group.id === "company") return ["/about-contact", "/why-liberty-bancard", "/partners"].includes(location);
  return group.links.some((l) => !isHomeAnchor(l.href) && location === l.href);
}

// ─── Desktop dropdown ────────────────────────────────────────────────────────

function DesktopDropdown({
  group,
  isOpen,
  onOpen,
  onClose,
  location,
}: {
  group: PublicNavGroup;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  location: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = isGroupActive(group, location);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <button
        type="button"
        className="public-nav-link flex items-center gap-1 py-5 text-sm font-medium transition-colors"
        data-active={active}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => (isOpen ? onClose() : onOpen())}
        data-testid={`button-nav-${group.id}`}
      >
        {group.label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        className={cn(
          "absolute left-0 top-full z-50 w-80 rounded-md border border-border bg-background py-1 shadow-lg transition-opacity",
          isOpen ? "visible opacity-100" : "invisible opacity-0",
        )}
        data-testid={`menu-nav-${group.id}`}
      >
        {group.links.map((link) => (
          <DropdownItem key={`${link.label}-${link.href}`} group={group} link={link} active={!isHomeAnchor(link.href) && location === link.href} onClose={onClose} />
        ))}
        {group.offer?.current && (
          <div className="mx-3 mb-2 mt-1 border-t border-border pt-2">
            <NavAnchor
              href={group.offer.href}
              onClick={onClose}
              className="block rounded-md border border-border bg-[hsl(var(--liberty-surface))] px-3 py-2.5 text-sm transition-colors hover:border-[hsl(var(--liberty-navy))]"
              data-testid={`link-nav-offer-${group.id}`}
            >
              <span className="block font-semibold leading-snug text-foreground">{group.offer.label}</span>
              {group.offer.description && <span className="mt-0.5 block text-xs text-muted-foreground">{group.offer.description}</span>}
            </NavAnchor>
          </div>
        )}
      </div>
    </div>
  );
}

function DropdownItem({ group, link, active, onClose }: { group: PublicNavGroup; link: PublicNavLink; active: boolean; onClose: () => void }) {
  return (
    <NavAnchor
      href={link.href}
      onClick={onClose}
      className={cn(
        "block px-4 py-2.5 text-sm transition-colors",
        active ? "bg-[hsl(var(--liberty-surface))] text-[hsl(var(--liberty-navy))]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
      data-testid={`link-nav-${group.id}-${navTestId(link.label)}`}
    >
      <span className="block font-medium leading-snug">{link.label}</span>
      {link.description && <span className="mt-0.5 block text-xs text-muted-foreground">{link.description}</span>}
    </NavAnchor>
  );
}

// ─── Main Navbar ─────────────────────────────────────────────────────────────

export function Navbar() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const drawerId = useId();
  // The Menu button sits outside the Sheet and has no SheetTrigger, so Radix has no trigger ref to hand focus back to
  // and focus would land on BODY after the drawer unmounts. Keep an explicit ref and restore it for the dismissals that
  // stay on the same page (Escape, the close button, the overlay); a navigation close must never refocus the old page.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocusRef = useRef(true);
  // The page region that was on screen when a drawer link was activated; the destination's own region replaces it.
  const departingMainRef = useRef<Element | null>(null);

  const openMobileMenu = useCallback(() => {
    restoreMenuFocusRef.current = true;
    departingMainRef.current = document.querySelector("main");
    setMobileOpen(true);
  }, []);
  const closeMobileForNavigation = useCallback(() => {
    restoreMenuFocusRef.current = false;
    departingMainRef.current = document.querySelector("main");
    setMobileOpen(false);
  }, []);
  const handleDrawerCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (restoreMenuFocusRef.current) {
      menuButtonRef.current?.focus();
      return;
    }
    // Navigation: the link that was activated is gone and the page changed, so focus the new page's main region. Route
    // modules load lazily, so the destination's <main> can appear after the drawer has closed; wait for it (never the
    // departing page's region) and fall back to the current one only when the destination is the same page.
    const departing = departingMainRef.current;
    const started = performance.now();
    const focusDestination = () => {
      const main = document.querySelector<HTMLElement>("main");
      const elapsed = performance.now() - started;
      if (main && (main !== departing || elapsed > 1000)) {
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.style.outline = "none";
        main.focus({ preventScroll: true });
        return;
      }
      if (elapsed < 4000) requestAnimationFrame(focusDestination);
    };
    focusDestination();
  }, []);

  // Close dropdowns and the mobile drawer on route change
  useEffect(() => {
    setOpenGroup(null);
    restoreMenuFocusRef.current = false;
    setMobileOpen(false);
  }, [location]);

  const closeAll = useCallback(() => setOpenGroup(null), []);

  return (
    <nav className="fixed z-50 w-full" data-testid="navbar" aria-label="Main">
      <div className="border-b border-border bg-card/95 shadow-sm backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-4 md:h-16">
            {/* Logo */}
            <Link href="/" className="flex min-h-11 shrink-0 items-center" data-testid="link-logo">
              <img src={logoBlue} alt="Liberty Bancard" width={154} height={32} className="h-7 w-auto max-w-[200px] md:h-9 md:max-w-none" />
            </Link>

            {/* Desktop groups */}
            <div className="hidden items-center gap-6 xl:flex">
              {PUBLIC_NAV_GROUPS.map((group) => (
                <DesktopDropdown
                  key={group.id}
                  group={group}
                  isOpen={openGroup === group.id}
                  onOpen={() => setOpenGroup(group.id)}
                  onClose={closeAll}
                  location={location}
                />
              ))}
            </div>

            {/* Header action: utility links (from 1280px) and the single primary action (from 400px) */}
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="hidden items-center gap-4 xl:flex" data-testid="nav-utilities">
                {PUBLIC_NAV_UTILITIES.map((utility) => (
                  <Link
                    key={utility.href}
                    href={utility.href}
                    className="public-nav-link inline-flex min-h-11 items-center whitespace-nowrap text-[13px] font-medium transition-colors"
                    data-active={location === utility.href}
                    data-testid={`link-nav-${navTestId(utility.label)}`}
                  >
                    {utility.label}
                  </Link>
                ))}
              </div>
              <Button asChild className="public-cta--brand hidden h-10 min-[400px]:inline-flex" data-testid="link-nav-talk">
                <Link href={PUBLIC_NAV_CTA.href}>{PUBLIC_NAV_CTA.label}</Link>
              </Button>

              {/* Labelled menu button below 1280px */}
              <div className="xl:hidden">
                <Button
                  ref={menuButtonRef}
                  variant="ghost"
                  className="h-11 gap-2 px-3 text-primary [&_svg]:size-6"
                  onClick={openMobileMenu}
                  data-testid="button-mobile-menu"
                  aria-label="Open menu"
                  aria-haspopup="dialog"
                  aria-expanded={mobileOpen}
                  aria-controls={drawerId}
                >
                  <Menu className="h-6 w-6" aria-hidden="true" />
                  <span className="text-sm font-semibold">Menu</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Mobile full-height Sheet drawer ───────────────────────────────── */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            id={drawerId}
            side="right"
            onCloseAutoFocus={handleDrawerCloseAutoFocus}
            className="flex w-[85vw] max-w-sm flex-col p-0"
            closeClassName="right-2 top-2 grid h-11 w-11 place-items-center opacity-100 [&_svg]:h-5 [&_svg]:w-5"
            data-testid="mobile-nav-drawer"
          >
            {/* SheetContent already renders an absolute close (X) button top-right;
                no custom SheetClose needed here — adding one creates duplicates. */}
            <SheetHeader className="shrink-0 border-b border-border px-4 pb-2 pr-14 pt-2">
              <SheetTitle asChild>
                <Link href="/" className="flex min-h-11 items-center" onClick={closeMobileForNavigation} data-testid="link-mobile-logo">
                  <img src={logoBlue} alt="Liberty Bancard" width={134} height={28} className="h-7 w-auto max-w-full" />
                </Link>
              </SheetTitle>
            </SheetHeader>

            {/* Scrollable nav body */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <Accordion type="single" collapsible className="w-full">
                {PUBLIC_NAV_GROUPS.map((group) => (
                  <AccordionItem key={group.id} value={group.id} className="border-none">
                    <AccordionTrigger
                      className="min-h-11 rounded-md px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50 hover:no-underline"
                      data-testid={`accordion-trigger-${group.id}`}
                    >
                      {group.label}
                    </AccordionTrigger>
                    <AccordionContent className="pb-1">
                      {group.links.map((link) => {
                        const active = !isHomeAnchor(link.href) && location === link.href;
                        return (
                          <NavAnchor
                            key={`${link.label}-${link.href}`}
                            href={link.href}
                            className={cn(
                              "flex min-h-11 flex-col justify-center rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
                              active ? "bg-[hsl(var(--liberty-surface))] text-[hsl(var(--liberty-navy))]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                            onClick={closeMobileForNavigation}
                            aria-current={active ? "page" : undefined}
                            data-testid={`link-mobile-${group.id}-${navTestId(link.label)}`}
                          >
                            {link.label}
                            {link.description && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{link.description}</span>}
                          </NavAnchor>
                        );
                      })}
                      {group.offer?.current && (
                        <NavAnchor
                          href={group.offer.href}
                          className="mx-3 mt-1 block rounded-md border border-border bg-[hsl(var(--liberty-surface))] px-3 py-2.5 text-sm"
                          onClick={closeMobileForNavigation}
                          data-testid={`link-mobile-offer-${group.id}`}
                        >
                          <span className="block min-h-6 font-semibold leading-snug text-foreground">{group.offer.label}</span>
                          {group.offer.description && <span className="mt-0.5 block text-xs text-muted-foreground">{group.offer.description}</span>}
                        </NavAnchor>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              <div className="my-2 h-px bg-border" />

              <ul className="grid" aria-label="Support and sign in">
                {PUBLIC_NAV_UTILITIES.map((utility) => (
                  <li key={utility.href}>
                    <Link
                      href={utility.href}
                      className={cn(
                        "flex min-h-11 items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                        location === utility.href ? "bg-[hsl(var(--liberty-surface))] text-[hsl(var(--liberty-navy))]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                      onClick={closeMobileForNavigation}
                      data-testid={`link-mobile-${navTestId(utility.label)}`}
                    >
                      {utility.label}
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Contact info */}
              <div className="flex flex-col gap-1 px-3 py-2">
                <a
                  href={PUBLIC_CONTACT_CHANNELS.phone.href}
                  className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
                  data-testid="link-mobile-phone"
                  onClick={() => trackPhoneCallClick({})}
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {PUBLIC_CONTACT_CHANNELS.phone.label}
                </a>
                <a href={PUBLIC_CONTACT_CHANNELS.email.href} className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground" data-testid="link-mobile-email">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {PUBLIC_CONTACT_CHANNELS.email.label}
                </a>
              </div>
            </div>

            {/* Pinned primary action */}
            <div className="shrink-0 border-t border-border bg-background p-4">
              <Button asChild size="lg" className="public-cta public-cta--brand w-full" data-testid="link-mobile-talk">
                <Link href={PUBLIC_NAV_CTA.href} onClick={closeMobileForNavigation}>
                  {PUBLIC_NAV_CTA.label}
                </Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
