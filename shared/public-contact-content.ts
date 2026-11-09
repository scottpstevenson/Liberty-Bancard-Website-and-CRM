// About & Contact copy rendered by the React page (client/src/pages/AboutContact.tsx) and the
// server renderer (server/ssr/about-contact.ts). Three intent cards route a visitor to the right
// starting point; the statement and equipment descriptions come from approved claim records. No
// response-time, hours, office-address or staffing statement appears here because none has owner
// evidence, and no inquiry form is rendered here: the persisted inquiry flow belongs to the contact
// intake work, which uses the stable #inquiry section below as its mount point.

import { claimText } from "./public-claims";

export const ABOUT_CONTACT_PATH = "/about-contact";

export const ABOUT_CONTACT_META = {
  /** Title without the brand; the document title is the full `title`. */
  shortTitle: "About and Contact",
  title: "About and Contact | Liberty Bancard",
  description:
    "Talk to Liberty Bancard about payment processing, equipment or a statement review. Call, email, book a conversation or choose the starting point that fits.",
  breadcrumbLabel: "About & contact",
} as const;

export const ABOUT_CONTACT_HERO = {
  heading: "Let's talk about your business.",
  body: "Have a question about processing, equipment or a statement review? Choose the right starting point.",
} as const;

export interface ContactIntent {
  id: "statement" | "terminal" | "support";
  label: string;
  body: string;
  href: string;
}

export const ABOUT_CONTACT_INTENTS: readonly ContactIntent[] = [
  { id: "statement", label: "Review my statement", body: claimText("offer.review.short", "page"), href: "/upload-statement" },
  { id: "terminal", label: "Discuss checkout fit", body: claimText("equipment.options.summary", "page"), href: "/free-smart-terminal" },
  { id: "support", label: "Get support", body: "Questions about an existing account, equipment or a statement.", href: "/support" },
];

export const ABOUT_CONTACT_BOOKING_LABEL = "Book a processing conversation";

/** Verified channels only. Each is a real destination; none states hours, response time or text capability. */
export const PUBLIC_CONTACT_CHANNELS = {
  phone: { label: "Call 954-266-8214", display: "954-266-8214", href: "tel:+19542668214" },
  email: { label: "support@libertybancard.com", href: "mailto:support@libertybancard.com" },
  booking: { label: ABOUT_CONTACT_BOOKING_LABEL, href: "https://libertybancard.com/book" },
} as const;

/** Stable contact entry. The anchor id is part of the public contract; do not rename it. */
export const ABOUT_CONTACT_INQUIRY = {
  id: "inquiry",
  heading: "Choose how to reach Liberty Bancard",
  body: "Call or write to us, book a conversation, or start with a statement review. Tell us how your business takes payments and what you want to improve.",
} as const;

/** What happens after contact. Wording is process only; timing and approval claims come from claim records. */
export const ABOUT_CONTACT_PROCESS = {
  heading: "What happens after you reach out",
  steps: [
    { title: "Tell us about your business", body: "Share how you take payments today and what you want to improve." },
    { title: "We review the details", body: claimText("review.process.summary", "page") },
    { title: "Confirm next steps", body: claimText("timing.staged-process", "page") },
  ],
} as const;
