export interface VerticalAdvisorContext {
  vertical: string;
  slug: string;
  painPoints: string[];
  objections: Array<{ objection: string; rebuttal: string }>;
  complianceNotes: string[];
  talkingPoints: string[];
  recommendedOfferPaths: string[];
  avgTicketRange: string;
  typicalVolume: string;
}

export const VERTICAL_ADVISOR_CONTEXTS: Record<string, VerticalAdvisorContext> = {
  med_spa: {
    vertical: "Med Spa",
    slug: "med_spa",
    painPoints: [
      "High average tickets ($200–$800+) mean processor markup is magnified — even 0.2% overpayment is significant.",
      "Luxury card types (Amex, Visa Infinite, World Elite Mastercard) dominate the clientele and carry premium interchange; many processors bury this in tiered pricing.",
      "Chargebacks from disputed cosmetic results (Botox, fillers, laser treatments) are common and expensive if not documented properly.",
      "Tip adjustments on services add complexity — terminal must support tip-on-screen or tip-on-paper correctly to avoid card brand violations.",
      "Seasonal spikes (holiday gift cards, pre-summer body treatments) cause volume swings processors may flag.",
      "Gift card and package prepayment accounting is a frequent pain point.",
    ],
    objections: [
      {
        objection: "My current processor is fine — I don't have time to switch.",
        rebuttal: "Totally fair. The switch itself takes about a week and we handle all the programming. But first — send us one statement. On a med spa doing $80K/month, even cutting your effective rate by 0.3% saves $240/month. The 15-minute analysis is free.",
      },
      {
        objection: "I use Square because it's simple.",
        rebuttal: "Square is simple but expensive — 2.6% + 10¢ on card-present plus their premium card surcharge for Amex. A med spa with $80K volume is paying roughly $2,100/month. At interchange-plus, that same volume typically runs $900–$1,200. The gap is real.",
      },
      {
        objection: "I don't want to deal with PCI compliance.",
        rebuttal: "Liberty Bancard handles PCI compliance guidance and our terminals are EMV/NFC certified. You're already responsible for PCI whether you're on Square or anyone else — we just make it easier.",
      },
      {
        objection: "We process a lot of Amex — I don't want to lose that.",
        rebuttal: "We support all card brands including Amex OptBlue, which actually gives smaller merchants better Amex rates than going direct. You keep full Amex acceptance.",
      },
    ],
    complianceNotes: [
      "Med spas are NOT medical providers for HIPAA purposes in most cases, but if they handle PHI (e.g., linked to a physician), PCI and HIPAA may both apply — do not make HIPAA claims; escalate to compliance.",
      "Cosmetic procedure chargebacks often involve 'services not as described' — recommend merchants document consent forms and results with time-stamped photos.",
      "Gift card liability: prepaid packages must comply with state gift card laws. Do not give legal advice; refer to their attorney.",
      "Tip adjustment rules: card brands require the tip be added before the transaction is settled or with customer authorization. Clarify terminal workflow.",
      "No savings claims without statement review. All rate quotes require: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Med spas often run 3.0–3.5% effective rates on tiered pricing. Interchange-plus typically brings that to 2.0–2.4%.",
      "Our Dual Pricing / Cash Discount program is legal in all 50 states and eliminates processing fees entirely for cash/check payers.",
      "Next-day funding means gift card redemptions and package deposits clear fast — no cash flow gaps.",
      "Contactless/tap-to-pay terminals improve checkout speed in a high-volume service environment.",
      "We can program your terminal for tip prompting to stay card-brand compliant.",
    ],
    recommendedOfferPaths: ["Dual Pricing", "Interchange Plus", "Cash Discount"],
    avgTicketRange: "$150–$600",
    typicalVolume: "$30K–$200K/month",
  },

  dental: {
    vertical: "Dental",
    slug: "dental",
    painPoints: [
      "Insurance coordination means split payments (insurance pays portion, patient pays remainder) — terminal must handle partial payments cleanly.",
      "High average tickets ($500–$5,000+ for procedures) amplify the cost of high effective rates.",
      "Dental offices often process with healthcare-specific processors at inflated rates, not realizing they qualify for standard interchange.",
      "Payment plans and in-house financing create complexity — some processors restrict recurring billing.",
      "Staff turnover creates risk of PCI scope issues when card data is handled manually.",
      "Many dental practices still key-enter insurance reimbursements, triggering higher-rate card-not-present interchange.",
    ],
    objections: [
      {
        objection: "We already use a dental-specific processor.",
        rebuttal: "Dental-specific processors often charge a premium for the vertical branding. Your underlying interchange is the same — you just pay more markup. Send us a statement and we'll show you side-by-side.",
      },
      {
        objection: "Our patients use a lot of CareCredit.",
        rebuttal: "CareCredit is a separate product — we work alongside it. Patients who don't qualify for CareCredit pay by card, and that's where our pricing saves you money.",
      },
      {
        objection: "I don't want to bother changing our billing system.",
        rebuttal: "We integrate with most dental practice management software and our terminal swap is handled by our team — you don't touch the software side. We can confirm compatibility before you commit to anything.",
      },
    ],
    complianceNotes: [
      "Dental offices are covered entities under HIPAA. Payment card processing itself is exempt from HIPAA, but any system that links payment data to PHI (patient name + procedure) may require a BAA — escalate to compliance, do not advise.",
      "Key-entered transactions (card-not-present) carry higher interchange — recommend migrating to terminal or e-invoicing for patient billing.",
      "Payment plan / recurring billing: verify the practice has proper cardholder authorization documentation on file for stored card charges.",
      "PCI Scope: Front-desk staff handling physical cards are in-scope for PCI. Recommend P2PE (point-to-point encryption) terminals to reduce PCI burden.",
      "No savings claims without statement review. Always include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Dental practices often see effective rates of 2.8–3.8% — we typically bring this to 1.9–2.5% at interchange-plus.",
      "Large single-procedure tickets ($2,000–$8,000) mean even a 0.5% rate difference is $10–$40 per transaction.",
      "Our terminals support partial payment workflows for insurance co-pay scenarios.",
      "Next-day funding improves cash flow — no waiting 2–3 business days for large deposits.",
      "P2PE terminals reduce PCI compliance scope significantly — we can walk your team through the annual SAQ reduction.",
    ],
    recommendedOfferPaths: ["Interchange Plus", "Dual Pricing", "Wholesale"],
    avgTicketRange: "$200–$2,500",
    typicalVolume: "$20K–$150K/month",
  },

  auto_repair: {
    vertical: "Auto Repair",
    slug: "auto_repair",
    painPoints: [
      "Mix of consumer and commercial fleet cards — fleet cards (Voyager, WEX, Fuelman) require separate acceptance and different interchange categories.",
      "Variable ticket sizes (oil change at $80 to transmission rebuild at $3,000) make flat-rate pricing expensive on large jobs.",
      "Customers often dispute charges when repairs cost more than the estimate — chargebacks around 'unauthorized amount' are common.",
      "Parts + labor split billing is common but creates complexity for some processors.",
      "Debit-heavy customer base — surcharge and cash discount programs are well-suited here.",
    ],
    objections: [
      {
        objection: "My customers pay cash a lot — I don't process much.",
        rebuttal: "That's exactly who benefits from our Cash Discount program. You give cash customers a discount (or price parity), and card customers see a small service fee — your processing becomes essentially free on card transactions.",
      },
      {
        objection: "I'm locked in a contract with my current processor.",
        rebuttal: "When does it end? We can often cover early termination fees up to $500. In the meantime, send us a statement — if the savings justify it, we may cover the exit cost entirely.",
      },
      {
        objection: "We use a shop management system (Mitchell, Shop-Ware, Tekmetric) — will it work?",
        rebuttal: "We integrate with most shop management platforms. Let me confirm your specific system and I'll get you compatibility details before you commit to anything.",
      },
    ],
    complianceNotes: [
      "Fleet card acceptance (WEX, Voyager, Fuelman, FleetCor) requires a separate fleet card merchant account — these are NOT standard Visa/Mastercard. Do not promise fleet card acceptance without verifying underwriting.",
      "Surcharge programs must comply with state law — some states restrict or prohibit surcharging (Connecticut, Massachusetts, Puerto Rico have restrictions). Always verify.",
      "Pre-authorization / estimate holds: card brands allow pre-auth holds for estimated amounts. Final settlement must match or the merchant risks chargebacks. Recommend clear written estimates.",
      "Parts/labor split invoicing: no card brand restriction, but documentation helps dispute resolution.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Cash Discount program is a natural fit — many auto repair customers prefer cash and the program rewards them.",
      "Interchange-plus pricing reduces cost on high-ticket repair jobs significantly versus flat-rate processors.",
      "Our terminals support tip prompts if applicable for service advisors.",
      "Mobile payment acceptance for lot attendants or roadside service is supported via mobile reader.",
      "Fast approval — most shops are approved in 24–48 hours.",
    ],
    recommendedOfferPaths: ["Cash Discount", "Dual Pricing", "Interchange Plus"],
    avgTicketRange: "$80–$1,500",
    typicalVolume: "$15K–$100K/month",
  },

  salon: {
    vertical: "Salon",
    slug: "salon",
    painPoints: [
      "Tip adjustments are the #1 operational pain point — terminals must support tip-on-screen, and the workflow must be card-brand compliant to avoid chargebacks.",
      "Booth rental vs. owner-operated split creates multiple MID complexity — some salons run multiple processors for different chairs.",
      "Square and PayPal dominate this space at 2.6%+ — most salon owners don't realize they're overpaying.",
      "High card-present volume with small average tickets makes per-transaction fees critical.",
      "Gift card sales and redemptions require proper accounting.",
      "Appointment no-shows and last-minute cancellations drive card-on-file retention requests — processors must support stored credentials.",
    ],
    objections: [
      {
        objection: "I use Square and it's fine.",
        rebuttal: "Square charges 2.6% + 10¢ for card-present. On a salon doing $20K/month with a $60 average ticket, that's roughly $525/month. At interchange-plus, you're typically at $330–$380. That's $150–$200 back per month.",
      },
      {
        objection: "My customers love tipping on the Square screen.",
        rebuttal: "Our terminals have tip-on-screen too — same experience, better rate. Your customers won't notice a difference.",
      },
      {
        objection: "I rent out chairs — only some are mine.",
        rebuttal: "We can set up separate accounts for booth renters if needed, or a single account for your station with clear reporting. Let's talk through your setup and design the right structure.",
      },
    ],
    complianceNotes: [
      "Tip adjustments: card brand rules require tip authorization before settlement. Terminal must prompt customer for tip before transaction is closed, OR merchant must get a signed tip authorization for manual additions. Non-compliant tip workflow is a chargeback and card brand violation risk.",
      "Stored credentials / card-on-file for no-show fees: must have written cardholder consent with explicit disclosure of the fee amount and trigger. Recommend a cancellation policy agreement signed at booking.",
      "Surcharging: check state law — some states restrict surcharge programs. California recently updated its rules; verify current status.",
      "Booth rental booth renters are separate legal entities — do not co-mingle funds or MIDs.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Tip-on-screen terminals — same checkout experience as Square, meaningfully lower rate.",
      "Per-transaction fee reduction matters at small average tickets: even $0.05/transaction adds up at 300+ transactions/month.",
      "Card-on-file / stored credential setup for no-show fee enforcement — we support this properly.",
      "Cash Discount program is popular with salons — cash-paying clients get the posted price, card clients see a small service fee.",
      "Gift card program integration available.",
    ],
    recommendedOfferPaths: ["Cash Discount", "Dual Pricing", "Interchange Plus"],
    avgTicketRange: "$40–$200",
    typicalVolume: "$10K–$80K/month",
  },

  gym: {
    vertical: "Gym",
    slug: "gym",
    painPoints: [
      "Recurring membership billing is the core business — ACH is significantly cheaper than card for monthly dues.",
      "Chargebacks from membership cancellation disputes are the highest-risk category in this vertical.",
      "Seasonal spikes (January) and drops (summer) make volume forecasting hard — processors sometimes flag the spike.",
      "Day pass and retail (supplements, gear) sales add card-present complexity alongside recurring billing.",
      "Member cancellation disputes — 'I cancelled and they kept charging me' — require airtight cancellation documentation.",
      "High-risk underwriting concern: gym memberships historically have elevated chargeback rates, which some processors flag.",
    ],
    objections: [
      {
        objection: "We use Mindbody/ABC Fitness — they handle our payments.",
        rebuttal: "Mindbody and ABC Fitness resell payment processing at a markup. You're paying for the software AND their processor's margin. You can often use a third-party processor and keep the software — let me check your specific platform.",
      },
      {
        objection: "Our members pay by card — we can't switch to ACH.",
        rebuttal: "ACH works alongside card processing. Members who are comfortable giving bank account info (and most are for subscription services) can shift to ACH at a fraction of the cost. You'd offer both options.",
      },
      {
        objection: "We get a lot of chargebacks from cancellations.",
        rebuttal: "That's a documentation issue, not a processor issue. We can advise on cancellation workflows and dispute response procedures that significantly reduce chargeback loss. Your processor rate shouldn't be inflated because of chargeback risk you can manage.",
      },
    ],
    complianceNotes: [
      "Gym memberships in many states are regulated by state health spa laws — do not give legal advice on membership contracts; refer to their attorney.",
      "ACH debits for recurring membership require NACHA-compliant authorization — written or digital authorization with disclosure of amount, frequency, and cancellation process. This is the merchant's responsibility.",
      "Chargeback risk: gyms are a higher-risk vertical. Underwriting may require lower monthly volume caps initially or a rolling reserve. Be upfront about this.",
      "Stored credentials for recurring billing: card brand rules require initial authorization, subsequent use notifications, and a clear cancellation process.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "ACH for recurring dues reduces membership billing cost from ~2.5% to roughly $0.25–$0.50 per transaction.",
      "Card processing for retail and day passes at interchange-plus versus flat-rate saves meaningfully on higher-volume months.",
      "Dispute management guidance: we help gyms implement cancellation workflows that dramatically reduce friendly fraud chargebacks.",
      "January volume spike is expected and normal — our underwriting team understands seasonal gym patterns.",
      "Next-day funding keeps cash flow healthy during seasonal ramp-ups.",
    ],
    recommendedOfferPaths: ["Interchange Plus", "Wholesale", "Dual Pricing"],
    avgTicketRange: "$25–$150 (monthly dues); $5–$80 (retail)",
    typicalVolume: "$15K–$200K/month",
  },

  hotel: {
    vertical: "Hotel",
    slug: "hotel",
    painPoints: [
      "Lodging interchange qualification requires specific MCC (5011 lodging) and transaction data fields — many hotels are misclassified and paying non-lodging interchange rates.",
      "Pre-authorization and incremental authorization (for incidental holds) are standard in hospitality — not all processors handle this cleanly.",
      "Travel rewards cards (Visa Signature, World Elite Mastercard, Amex Platinum) dominate hotel card mix and carry premium interchange — tiered processors often downgrade these.",
      "No-show fees and extended stay billing require stored credential compliance.",
      "Third-party booking (Expedia, Booking.com) creates split-settlement complexity.",
      "High average tickets with multi-night stays mean chargebacks for 'cancelled reservation' or 'not as described' can be very large.",
    ],
    objections: [
      {
        objection: "We use a PMS system that handles everything.",
        rebuttal: "Most PMS systems (Cloudbeds, Opera, Mews, etc.) integrate with multiple processors. The processor choice affects your rate — your PMS just passes transactions through. Let's make sure you're passing lodging data fields to qualify for lodging interchange.",
      },
      {
        objection: "Our rates seem fine.",
        rebuttal: "Hotels often assume they're on lodging interchange but are actually processing as generic retail because the lodging addendum data isn't being sent. That can add 0.5–1.0% to every transaction. Send us a statement — we'll verify your interchange qualification.",
      },
      {
        objection: "We have OTA (Expedia, Booking.com) bookings — those aren't our card transactions.",
        rebuttal: "Correct — OTA bookings settle through them. But your direct bookings, walk-ins, and on-property charges are your transactions. That's what we optimize.",
      },
    ],
    complianceNotes: [
      "Lodging MCC (5011) and addendum data: hotels MUST send lodging addendum fields (check-in date, check-out date, folio number, room rate) to qualify for lodging interchange. Confirm the PMS is passing this data.",
      "Pre-authorization: initial pre-auth holds for incidentals are card-brand compliant. However, holds must be released or finalized within the card brand's time limits (Visa: 31 days for lodging). Exceeding this creates authorization failures and potential card brand violations.",
      "Incremental authorization: Visa and Mastercard allow incremental authorization for hotels — processor must support this to avoid large auth mismatches at checkout.",
      "No-show fee stored credentials: written guest authorization required at booking, with clear disclosure of no-show policy and fee amount.",
      "Chargebacks: 'Cancelled reservation' is the #1 dispute reason in hospitality. Cancellation policy must be clearly disclosed at booking and on the receipt.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "We ensure your transactions qualify for lodging interchange — many hotels are unknowingly paying retail rates.",
      "Full lodging addendum data support: we configure your PMS integration to send all required fields.",
      "Incremental authorization support for extended stay and incidental hold management.",
      "Chargeback dispute response guidance specific to hospitality — we know the card brand rules for cancelled reservation disputes.",
      "Travel rewards card acceptance is standard — Amex OptBlue available for independent properties.",
    ],
    recommendedOfferPaths: ["Interchange Plus", "Wholesale"],
    avgTicketRange: "$150–$1,500 per stay",
    typicalVolume: "$30K–$500K/month",
  },

  landscaping: {
    vertical: "Landscaping",
    slug: "landscaping",
    painPoints: [
      "Seasonal volume swings (spring/summer peak, fall/winter slow) make annual cost estimates tricky and can trigger processor reviews.",
      "Field-based operations mean most payments are taken on-site — mobile card acceptance is critical.",
      "Mix of consumer and commercial (property management, HOA) clients — commercial cards carry different interchange rates.",
      "Invoice-based billing with net-30 terms means some customers pay by card weeks after service, creating card-not-present costs.",
      "Cash and check are still common — cash discount programs are a natural fit.",
      "Large landscape installation projects ($5,000–$50,000+) push processors to flag individual transactions.",
    ],
    objections: [
      {
        objection: "We mostly use checks — cards aren't a big deal for us.",
        rebuttal: "That's changing in this industry. HOAs and commercial property managers increasingly pay by card. When they do, you want a low rate. And for residential clients who want to pay by card, a Cash Discount program makes it essentially free.",
      },
      {
        objection: "I use PayPal or Venmo for smaller jobs.",
        rebuttal: "PayPal charges 3.49% + 49¢ for invoice payments. On a $500 lawn maintenance job, that's $17.94. With interchange-plus processing, that same transaction runs $8–$10. It adds up across 50–100 jobs a month.",
      },
      {
        objection: "My volume is too seasonal — will the processor cancel me?",
        rebuttal: "We underwrite for seasonal businesses. Your annual volume matters more than any single slow month. We document the seasonality upfront so it doesn't trigger a review.",
      },
    ],
    complianceNotes: [
      "Large ticket transactions ($5,000+) may require voice authorization or additional documentation depending on the processor's risk policy. Advise merchants to have project contracts and customer identification ready for large installs.",
      "Card-not-present (invoiced transactions paid by card online or over phone) carries higher interchange than card-present. Recommend migrating to hosted payment page or virtual terminal with AVS to minimize downgrades.",
      "Surcharging in field service: verify state law compliance. Some states restrict surcharging.",
      "Commercial card interchange: Level 2/3 data (PO number, tax amount, item detail) reduces commercial card interchange — most landscaping invoices qualify for Level 2.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Mobile card reader for field acceptance — works on iOS and Android, no cell signal needed for offline mode.",
      "Cash Discount program: residential clients who pay cash get a discount, card clients see a small service fee. Effectively free card processing.",
      "Level 2 commercial card processing reduces your cost when billing property management companies and HOAs.",
      "Seasonal underwriting: we document your business cycle upfront so volume swings don't trigger account reviews.",
      "Virtual terminal for phone-in card payments from existing customers.",
    ],
    recommendedOfferPaths: ["Cash Discount", "Interchange Plus", "Dual Pricing"],
    avgTicketRange: "$100–$5,000",
    typicalVolume: "$10K–$150K/month (seasonal)",
  },

  construction: {
    vertical: "Construction",
    slug: "construction",
    painPoints: [
      "Very large ticket sizes ($10,000–$500,000+) mean even a 0.1% rate difference is significant.",
      "Progress billing (draw requests tied to project milestones) creates multiple large transactions over time.",
      "Commercial and corporate cards dominate — these carry premium interchange that tiered processors lump into the highest tier.",
      "ACH is strongly preferred for large invoices — card processing on a $100K draw is expensive at any rate.",
      "Retention withheld by GC creates payment timeline complexity.",
      "Cash flow gaps between project expenses and payment receipt are a chronic pain point.",
    ],
    objections: [
      {
        objection: "We mostly get paid by check or ACH.",
        rebuttal: "That's ideal for large draws. But subcontractors, material vendors, and some residential clients want to pay by card. A flat-rate processor on a $15,000 payment is charging you $390. Interchange-plus brings that to $150–$200.",
      },
      {
        objection: "Our GC pays us by check — this doesn't apply.",
        rebuttal: "Your residential and commercial renovation clients often pay by card. And if you're accepting any card payments at all, your rate on those transactions matters. What's your current processor?",
      },
      {
        objection: "We don't want monthly fees.",
        rebuttal: "Our interchange-plus model has a small monthly fee but no PCI fees, no batch fees, and no junk fees. On your transaction volume, the net cost is almost always lower than flat-rate with 'no monthly fee.'",
      },
    ],
    complianceNotes: [
      "Large ticket processing: transactions above certain thresholds may require voice authorization or additional verification. Have project contract and lien waiver ready for documentation.",
      "ACH for large draws: NACHA rules govern ACH debits. For construction, ACH credits (paying subs) vs. ACH debits (collecting from clients) have different rules — clarify which direction the merchant needs.",
      "Level 2/3 card data: commercial card interchange is significantly reduced when purchase order number and tax amount are included. Construction invoices almost always qualify — ensure the payment system passes these fields.",
      "Lien law compliance: payment processing has no direct interaction with lien law, but late payment from processing delays can trigger lien filing windows — mention fast funding.",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "Interchange-plus with Level 2/3 commercial card data — dramatically reduces cost on corporate and purchasing card transactions.",
      "ACH integration for large milestone draws — $0.25–$0.50 flat cost versus 2–3% on a card transaction.",
      "Same-day or next-day ACH settlement improves cash flow between draw disbursements.",
      "No per-transaction caps — we handle large-ticket transactions without account freezes.",
      "Project-based invoicing tools via virtual terminal or hosted payment page.",
    ],
    recommendedOfferPaths: ["Interchange Plus", "Wholesale"],
    avgTicketRange: "$500–$50,000+",
    typicalVolume: "$20K–$1M+/month (project-dependent)",
  },

  legal: {
    vertical: "Legal",
    slug: "legal",
    painPoints: [
      "IOLTA trust accounts MUST be kept separate from operating accounts — commingling is a bar ethics violation and a serious compliance risk.",
      "Many payment processors do not support IOLTA-compliant processing (trust account deposits separate from operating funds).",
      "Retainer billing and case-progress billing create recurring and milestone payment needs.",
      "Card acceptance for trust account deposits requires the processing fee to come from operating funds — not from the trust deposit. This is non-negotiable under bar rules.",
      "Confidentiality concerns about client payment data stored by the processor.",
      "Large retainer payments ($5,000–$50,000+) may trigger processor review.",
    ],
    objections: [
      {
        objection: "We don't take credit cards — clients pay by check.",
        rebuttal: "That's increasingly a competitive disadvantage. Clients want to put retainers on a business card for the rewards points. And online card payments reduce collections friction significantly. The IOLTA compliance issue is real but solvable — it's about how the processing is set up.",
      },
      {
        objection: "I've heard card processing violates our bar rules for trust accounts.",
        rebuttal: "That was a real concern in the past. Today, IOLTA-compliant payment processing exists — it's specifically designed so the processing fee is drawn from your operating account, not the trust deposit. The ABA and most state bars have guidance endorsing compliant card acceptance for trust accounts.",
      },
      {
        objection: "Client confidentiality — I don't want a third party holding our client payment data.",
        rebuttal: "Our processing is PCI DSS compliant. We don't store full card data — tokenization means we only store a token, not the card number. Your client's payment information is not accessible to us after processing.",
      },
    ],
    complianceNotes: [
      "IOLTA CRITICAL: Never suggest standard merchant processing for a law firm's trust account without confirming IOLTA-compliant setup. The processing fee must be debited from the firm's operating account — NOT the trust deposit. This requires a processor that supports dual-account fee routing. Escalate to a specialist before quoting.",
      "IOLTA-compliant processing: the ABA Model Rules and most state bar rules allow card acceptance for trust accounts provided: (1) no fee is taken from the trust deposit, (2) the firm maintains separate trust and operating accounts, (3) the processor agreement is set up correctly. Refer the firm to their state bar's guidance.",
      "Retainer billing: card-on-file for subsequent billing against a retainer must have explicit cardholder authorization specifying amount, trigger, and process.",
      "PCI compliance: law firms are small merchants but still in-scope for PCI. Recommend SAQ-A or SAQ-B depending on their environment.",
      "Do not give legal advice. Do not advise on bar compliance beyond: 'We support IOLTA-compliant processing — your bar association and ethics counsel should review the setup.'",
      "No savings claims without statement review. Include: 'Eligibility, underwriting, card brand rules, and applicable laws apply.'",
    ],
    talkingPoints: [
      "IOLTA-compliant processing: trust deposits go to the trust account, operating fees come from the operating account — no bar rule conflict.",
      "Online payment portal for retainer collection — clients can pay from anywhere, reducing collections calls.",
      "Card acceptance increases retainer collection speed by 30–50% compared to check-only billing.",
      "Large retainer transactions ($10,000+) handled without account freezes — underwritten for legal vertical.",
      "PCI-compliant tokenization — client card data is not stored in your system or ours.",
    ],
    recommendedOfferPaths: ["Interchange Plus", "Wholesale"],
    avgTicketRange: "$500–$25,000",
    typicalVolume: "$10K–$200K/month",
  },
};

export const SUPPORTED_VERTICAL_SLUGS = Object.keys(VERTICAL_ADVISOR_CONTEXTS);

export function normalizeVerticalSlug(vertical: string): string {
  return vertical
    .toLowerCase()
    .replace(/[\s\/\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function getVerticalContext(vertical: string): VerticalAdvisorContext | null {
  if (VERTICAL_ADVISOR_CONTEXTS[vertical]) return VERTICAL_ADVISOR_CONTEXTS[vertical];
  const slug = normalizeVerticalSlug(vertical);
  return VERTICAL_ADVISOR_CONTEXTS[slug] || null;
}

export function isVerticalSupported(vertical: string): boolean {
  return getVerticalContext(vertical) !== null;
}

export function buildVerticalSystemPromptBlock(vertical: string): string {
  const ctx = getVerticalContext(vertical);
  if (!ctx) return "";

  const lines: string[] = [
    `\n─── VERTICAL CONTEXT: ${ctx.vertical.toUpperCase()} ───`,
    `Average Ticket: ${ctx.avgTicketRange} | Typical Monthly Volume: ${ctx.typicalVolume}`,
    `Recommended Offer Paths: ${ctx.recommendedOfferPaths.join(", ")}`,
    "",
    "PAIN POINTS:",
    ...ctx.painPoints.map((p, i) => `${i + 1}. ${p}`),
    "",
    "COMMON OBJECTIONS & REBUTTALS:",
    ...ctx.objections.map(
      (o, i) =>
        `${i + 1}. OBJECTION: "${o.objection}"\n   REBUTTAL: ${o.rebuttal}`
    ),
    "",
    "COMPLIANCE NOTES (must follow):",
    ...ctx.complianceNotes.map((n, i) => `${i + 1}. ${n}`),
    "",
    "TALKING POINTS:",
    ...ctx.talkingPoints.map((t, i) => `${i + 1}. ${t}`),
    "─────────────────────────────────────────────",
  ];

  return lines.join("\n");
}
