/**
 * The terminal entrance of /get-started as one pure contract shared by the browser page and the server-rendered HTML, so a
 * first response (crawler, link preview, no-JavaScript, slow hydration) says the same thing the hydrated page does.
 *
 * Only two entrances select the terminal inquiry: an allowlisted `offer` route value and the compatible `terminal=yes`.
 * Nothing from the query string is ever echoed: the result is a closed set of booleans and an allowlisted offer id.
 */
import { resolveInquiryOffer } from "./public-inquiry";

export interface TerminalIntent {
  terminal: boolean;
  offer: "free-terminal" | null;
}

/** `search` may carry a leading `?`. Anything unsupported keeps the generic goal quiz. */
export function readTerminalIntent(search: string): TerminalIntent {
  const params = new URLSearchParams(search);
  const offer = resolveInquiryOffer(params.get("offer"));
  const terminal = Boolean(offer) || params.get("terminal") === "yes";
  return { terminal, offer: offer ? "free-terminal" : null };
}

export const TERMINAL_INQUIRY_PATH = "/get-started";

export const TERMINAL_INQUIRY_PAGE = {
  /** Browser/SEO title (the site brand is appended by each renderer). */
  title: "Terminal Options for Qualified Merchants",
  description:
    "Tell us about your business so we can review equipment-program eligibility. Approved processing account required; processing fees and equipment program terms apply.",
  heading: "Let’s review your terminal options.",
  body: "Tell us about your business so we can review equipment-program eligibility.",
  /** What the short inquiry asks for. It does not ask for an application, ownership, bank or identity details. */
  asksHeading: "What the short inquiry asks",
  asks: [
    "Your business name, your name and an email address",
    "A phone number, only if you want a call (optional)",
    "Your business type and rough monthly card volume",
    "Whether you currently lease a terminal",
  ],
  asksNote: "No statement is required to ask, and sending this is not an application or an approval.",
  phoneLead: "Prefer to talk it through?",
} as const;
