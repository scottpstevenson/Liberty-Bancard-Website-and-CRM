/**
 * Profession-page copy (CPA, bookkeeper, insurance). Client and server safe: no compensation figure, savings claim,
 * timing promise or approval promise lives here. Compensation wording, the calculator and the shared FAQ come from the
 * partner content owner (shared/partner-public-content.ts) and the published-policy projection, so the three pages can
 * never drift from the hub or from each other.
 */
import { PARTNER_ROUTES } from "./partner-public-content";

export const PARTNER_PROFESSION_PAGE_IDS = ["cpa", "bookkeeper", "insurance"] as const;
export type PartnerProfessionPageId = (typeof PARTNER_PROFESSION_PAGE_IDS)[number];

export interface PartnerProfessionPageContent {
  id: PartnerProfessionPageId;
  route: string;
  /** The profession id carried to the referral application (`?profession=`). */
  profession: PartnerProfessionPageId;
  seo: { title: string; description: string; keywords: string };
  badge: string;
  heading: string;
  body: string;
  applyCta: string;
  contextHeading: string;
  contextParagraphs: readonly string[];
  contextPoints: readonly string[];
  /** Profession-specific questions only; the shared hub FAQ answers carry every commercial statement. */
  faqs: readonly { id: string; question: string; answer: string }[];
}

export const PARTNER_PROFESSION_PAGES: Record<PartnerProfessionPageId, PartnerProfessionPageContent> = {
  cpa: {
    id: "cpa",
    route: PARTNER_ROUTES.cpa,
    profession: "cpa",
    seo: {
      title: "CPA Referral Partners | Liberty Bancard",
      description: "CPAs who see client processing fees on the P&L can introduce a business to Liberty Bancard with the owner's permission. Liberty handles the sales process.",
      keywords: "CPA referral partner, accountant partner program, merchant services referral for CPAs",
    },
    badge: "For CPAs and accountants",
    heading: "Your clients’ card-processing costs are on the P&L you already review.",
    body: "If a client would like a second opinion on what they pay to accept cards, you can introduce them to Liberty Bancard with their permission. Liberty handles the statement review, the sales conversation and onboarding.",
    applyCta: "Apply as a referral partner",
    contextHeading: "You are already looking at the numbers.",
    contextParagraphs: [
      "Processing fees show up in the financial statements you already review. A client who asks whether they could pay less is a natural moment for an introduction.",
      "You do not need to explain pricing or make a sales pitch. You ask whether the owner is open to hearing from Liberty, and you pass their details along only if they say yes.",
    ],
    contextPoints: [
      "Introduce only clients who agreed to hear from Liberty",
      "Liberty reviews the client’s statement and explains any proposal itself",
      "Your written agreement sets out qualifying referrals and compensation",
    ],
    faqs: [
      {
        id: "cpa-endorsement",
        question: "Is an introduction an endorsement?",
        answer: "An introduction is a business referral, not an endorsement of a financial product. Check how your state board and professional standards treat referral arrangements before you take part.",
      },
      {
        id: "cpa-disclosure",
        question: "Should I tell clients I may be compensated?",
        answer: "Clear disclosure to the client is good practice, and some professional rules require it. Follow the rules that apply to you. Your written agreement describes what Liberty expects of its partners.",
      },
      {
        id: "cpa-conversation",
        question: "How do I raise it with a client?",
        answer: "Keep it simple: ask whether they would like a processing statement review from a company you work with, and only share their details if they agree. Liberty handles the rest.",
      },
      {
        id: "cpa-contract",
        question: "What if the client is under contract with their current processor?",
        answer: "That is a question for Liberty’s review of the client’s statement and agreement. You are not asked to advise on it.",
      },
    ],
  },
  bookkeeper: {
    id: "bookkeeper",
    route: PARTNER_ROUTES.bookkeeper,
    profession: "bookkeeper",
    seo: {
      title: "Bookkeeper Referral Partners | Liberty Bancard",
      description: "Bookkeepers who reconcile card-processing statements can introduce a business to Liberty Bancard with the owner's permission. Liberty handles the sales process.",
      keywords: "bookkeeper referral partner, bookkeeper partner program, merchant services referral for bookkeepers",
    },
    badge: "For bookkeepers",
    heading: "You reconcile the processing statements. You know when a client is unsure about them.",
    body: "When a client wants a second opinion on their card-processing costs, you can introduce them to Liberty Bancard with their permission. Liberty handles the statement review, the sales conversation and onboarding.",
    applyCta: "Apply as a referral partner",
    contextHeading: "A natural fit with the work you already do.",
    contextParagraphs: [
      "Reconciliation puts processing deposits and fees in front of you every month. When a client asks whether the fees look right, an introduction is a practical next step.",
      "Your part ends at the introduction. Liberty reviews the statement, explains any proposal and completes onboarding with the client.",
    ],
    contextPoints: [
      "Introduce only clients who agreed to hear from Liberty",
      "No need to explain pricing models or run the sale",
      "Your written agreement sets out qualifying referrals and compensation",
    ],
    faqs: [
      {
        id: "bk-when",
        question: "When is a good time to make an introduction?",
        answer: "When a client has asked about their fees or a statement and would welcome a second opinion. Ask first; share their details only with their agreement.",
      },
      {
        id: "bk-role",
        question: "What do I do after the introduction?",
        answer: "Stay available if the client has questions about you. Liberty handles the sales conversation, any proposal, underwriting and onboarding.",
      },
      {
        id: "bk-disclosure",
        question: "Should I tell clients I may be compensated?",
        answer: "Clear disclosure to the client is good practice, and some professional rules require it. Follow the rules that apply to you.",
      },
    ],
  },
  insurance: {
    id: "insurance",
    route: PARTNER_ROUTES.insurance,
    profession: "insurance",
    seo: {
      title: "Insurance Agent Referral Partners | Liberty Bancard",
      description: "Business insurance agents can introduce a small business to Liberty Bancard with the owner's permission. Liberty handles the sales process.",
      keywords: "insurance agent referral partner, partner program for insurance agents, merchant services referral for insurance agents",
    },
    badge: "For insurance agents",
    heading: "You talk with small-business owners about their costs. Card processing is one of them.",
    body: "When a business client mentions card-processing costs, you can introduce them to Liberty Bancard with their permission. Liberty handles the statement review, the sales conversation and onboarding.",
    applyCta: "Apply as a referral partner",
    contextHeading: "Part of the overhead conversation you already have.",
    contextParagraphs: [
      "Business owners ask their insurance agent about reducing overhead. If card processing comes up, you can offer an introduction to a company that reviews statements.",
      "You do not need payments expertise. Liberty explains any proposal and completes onboarding with the business.",
    ],
    contextPoints: [
      "Introduce only businesses that agreed to hear from Liberty",
      "No payments expertise or sales process required from you",
      "Your written agreement sets out qualifying referrals and compensation",
    ],
    faqs: [
      {
        id: "ins-expertise",
        question: "Do I need to understand payment processing?",
        answer: "No. Your role is the introduction. Liberty handles the statement review, any proposal, underwriting and onboarding.",
      },
      {
        id: "ins-licensing",
        question: "Does this affect my insurance license?",
        answer: "Rules differ by state and carrier. Check how your license, your agency agreements and your carriers treat outside referral arrangements before you take part.",
      },
      {
        id: "ins-disclosure",
        question: "Should I tell clients I may be compensated?",
        answer: "Clear disclosure to the client is good practice, and some rules require it. Follow the rules that apply to you.",
      },
    ],
  },
};
