/**
 * Public not-found copy and recovery links, shared by the React not-found page (client/src/pages/not-found.tsx) and the
 * server-rendered 404 document (server/ssr/not-found.ts) so a direct load of an unknown dynamic URL and a client-side
 * navigation to the same URL show the same words and the same links. Dependency-free on purpose.
 */
import { ABOUT_CONTACT_PATH } from "./public-contact-content";

export const PUBLIC_NOT_FOUND = {
  code: "404",
  seoTitle: "Page Not Found",
  seoDescription:
    "The page you're looking for may have been moved, renamed, or no longer exists. Return to Liberty Bancard's homepage.",
  title: "We couldn't find that page",
  message: "The page you're looking for may have been moved, renamed, or no longer exists. Let's get you back on track.",
  homeLabel: "Go to Homepage",
  popularHeading: "Popular destinations",
  links: [
    { label: "Home", href: "/" },
    { label: "Industries", href: "/industries" },
    { label: "Areas Served", href: "/areas-served" },
    { label: "Free Savings Analysis", href: "/free-analysis" },
    { label: "Upload a Statement", href: "/upload-statement" },
    { label: "Equipment Shop", href: "/shop" },
    { label: "Talk to Liberty Bancard", href: ABOUT_CONTACT_PATH },
  ],
  helpLinks: [
    { label: "Help Center", href: "/help" },
    { label: "Contact Support", href: "/support" },
  ],
} as const;
