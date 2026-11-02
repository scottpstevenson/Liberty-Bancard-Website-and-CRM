import { FIRST_PARTY_BOOK_URL, SECURE_UPLOAD_URL } from "./message-cta-contract";

/**
 * Stage 4C1 reconciliation of the GoHighLevel sales-booking widget link by step PURPOSE.
 *
 * Only the link address changes; every other character of the step stays as written. A link is retargeted only when its
 * own label states the purpose:
 *   - "book": a booking label (Book / Schedule / Reschedule / Rebook / Let's talk ...) on the sales widget -> the
 *     first-party /book address, which resolves the selected sales calendar.
 *   - "upload": an upload label on the sales widget -> the secure statement-upload page. An upload call to action is
 *     never turned into a booking call to action.
 * Not touched here, on purpose:
 *   - the Account Management calendar (a different widget address) and every link whose label is not listed above,
 *     including application, referral, proposal and unlabelled links;
 *   - sequences that are active (the adoption owner refuses them; pausing is a separate, explicit decision);
 *   - 60-Day Merchant Health Review and 90-Day QBR (existing-merchant account management by purpose).
 */
export type LinkRetarget = "book" | "upload";

export const SALES_WIDGET_URL = "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const BOOKING_LABEL = /\b(book|schedule|reschedule|rebook)\b|grab a quick call|let'?s (talk|chat)|talk to someone/i;
const UPLOAD_LABEL = /\bupload\b/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ANCHOR = new RegExp(`(<a\\b[^>]*?\\bhref=")${escape(SALES_WIDGET_URL)}("[^>]*>)([^<]*)(</a>)`, "g");

export function retargetSalesWidgetLinks(text: string, channel: "email" | "sms", kind: LinkRetarget): string {
  if (channel === "sms") return kind === "book" ? text.split(SALES_WIDGET_URL).join(FIRST_PARTY_BOOK_URL) : text;
  const target = kind === "book" ? FIRST_PARTY_BOOK_URL : SECURE_UPLOAD_URL;
  const label = kind === "book" ? BOOKING_LABEL : UPLOAD_LABEL;
  return text.replace(ANCHOR, (whole, open, close, text2, end) => (label.test(text2) ? `${open}${target}${close}${text2}${end}` : whole));
}

/** [sequenceId, sequenceName, [[stepOrder, channel, purpose], ...]] from the 2026-11-01 read-only production snapshot. */
export const LINK_RECONCILIATION_STEPS: ReadonlyArray<readonly [number, string, ReadonlyArray<readonly [number, "email" | "sms", LinkRetarget]>]> = [
  [4, "1. Switch & Save — Statement Audit", [[4, "email", "upload"], [5, "email", "upload"]]],
  [8, "5. Chargeback Defense", [[4, "email", "book"]]],
  [13, "10. Retail Merchants — SDR Outbound + Drip", [[1, "email", "book"], [5, "email", "book"], [6, "sms", "book"]]],
  [14, "11. Auto Merchants — SDR Outbound + Drip", [[1, "email", "book"], [5, "email", "book"], [6, "sms", "book"]]],
  [15, "12. Medical & Med Spa — SDR Outbound + Drip", [[1, "email", "book"], [5, "email", "book"], [6, "sms", "book"]]],
  [16, "13. Recurring Billing — Subscription Merchants", [[4, "email", "book"], [5, "sms", "book"]]],
  [17, "14. Text-to-Pay & Payment Links", [[4, "sms", "book"]]],
  [18, "15. Omnichannel — Online + In-Person", [[5, "sms", "book"]]],
  [20, "17. Contract Escape — Switch Help", [[4, "email", "book"], [5, "sms", "book"]]],
  [21, "18. Objection Crusher — Overcome Hesitation", [[6, "sms", "book"]]],
  [24, "V-Retail: SDR Outbound Prospecting", [[4, "email", "book"]]],
  [33, "V-Restaurant: SDR Outbound Prospecting", [[4, "email", "upload"]]],
  [38, "Post-Call Review Follow-Up", [[1, "email", "book"], [3, "email", "book"]]],
  [39, "Proposal Follow-Up", [[1, "email", "book"], [3, "email", "book"]]],
  [40, "No-Show Reschedule", [[1, "sms", "book"], [2, "email", "book"], [3, "sms", "book"]]],
  [41, "Long-Term Nurture", [[2, "email", "book"]]],
  [42, "22. FL Auto Repair — Vertical Playbook", [[1, "email", "upload"], [2, "sms", "book"], [4, "sms", "book"]]],
  [43, "23. FL Med Spa — Vertical Playbook", [[1, "email", "book"], [2, "sms", "book"], [4, "sms", "book"], [5, "email", "book"]]],
  [44, "24. FL Medical/Dental — Vertical Playbook", [[1, "email", "book"], [2, "sms", "book"], [4, "sms", "book"], [5, "email", "book"]]],
  [45, "SDR: Cold Outbound — Auto Repair", [[4, "email", "upload"], [7, "email", "book"], [10, "email", "book"], [11, "sms", "book"]]],
  [46, "SDR: Cold Outbound — Med Spa", [[4, "email", "book"], [7, "email", "book"], [10, "email", "book"], [11, "sms", "book"]]],
  [47, "SDR: Cold Outbound — Dental", [[4, "email", "book"], [7, "email", "book"], [10, "email", "book"], [11, "sms", "book"]]],
  [48, "SDR: Reply Engaged", [[1, "email", "book"], [5, "email", "book"]]],
  [49, "SDR: Statement Chase", [[1, "email", "upload"], [5, "email", "upload"]]],
  [50, "SDR: Proposal Follow-Up", [[5, "email", "book"]]],
  [51, "SDR: No-Show Recovery", [[1, "sms", "book"], [2, "email", "book"], [5, "email", "book"]]],
  [52, "Voicemail Follow-Up SMS", [[1, "sms", "book"]]],
  [53, "25. FL Construction — Vertical Playbook", [[1, "email", "book"], [2, "sms", "book"], [4, "sms", "book"], [5, "email", "book"]]],
  [54, "SDR: Cold Outbound — Construction", [[4, "email", "upload"], [7, "email", "book"], [10, "email", "book"], [11, "sms", "book"]]],
  [87, "W6 — Statement Uploaded", [[4, "email", "book"]]],
  [89, "W6 — No-Show Recovery", [[1, "email", "book"], [4, "email", "book"]]],
  [90, "W6 — Proposal Sent", [[1, "email", "book"], [4, "email", "book"]]],
];
