// About & Contact entry copy. Three intent cards route a visitor to the right starting point; the
// statement and equipment descriptions come from approved claim records. No response-time, office
// address or staffing statement appears here because none has owner evidence.

import { claimText } from "./public-claims";

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
  { id: "terminal", label: "Check terminal eligibility", body: claimText("equipment.options.summary", "page"), href: "/free-smart-terminal" },
  { id: "support", label: "Get support", body: "Questions about an existing account, equipment or a statement.", href: "/support" },
];

export const ABOUT_CONTACT_BOOKING_LABEL = "Book a processing conversation";
