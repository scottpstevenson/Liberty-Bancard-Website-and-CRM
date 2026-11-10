// /free-analysis-guaranteed. The URL stays (inbound links, sitemap, durable intake elsewhere); the
// content does not. The earlier page promised a $50 gift card, a benchmark against "3,200+ statements"
// and a 24-hour written report; none has an approved condition or evidence. This record explains what a
// statement analysis covers using the statement-review copy that is already approved and sends the
// visitor to the one statement-review destination, /upload-statement, or to a question without a
// statement. The React page and the server document both read it.

import { FSR_FAQ, FSR_COST, FSR_WHAT_IT_IS, FSR_WHAT_YOU_RECEIVE } from "./free-statement-review-content";
import { claimText } from "./public-claims";
import { ABOUT_CONTACT_PATH } from "./public-contact-content";
import type { OverviewPage } from "./public-overview-pages";

export const FREE_ANALYSIS_PAGE_PATH = "/free-analysis-guaranteed";

export const FREE_ANALYSIS_PAGE: OverviewPage = {
  path: FREE_ANALYSIS_PAGE_PATH,
  shortTitle: "Free Statement Analysis",
  title: "Free Statement Analysis | Liberty Bancard",
  description:
    "See what a free statement analysis covers: your effective cost and each fee on your processing statement, explained line by line. No savings are promised.",
  keywords: "free merchant statement analysis, payment processing review, effective cost, processing fees explained",
  breadcrumbLabel: "Free statement analysis",
  h1: "A free analysis of your processing statement.",
  intro: `${FSR_WHAT_IT_IS.intro.split(":")[0]}. Your costs depend on your current pricing and transaction mix, so nothing here promises a saving.`,
  sections: [
    {
      id: "what-it-covers",
      heading: "What the analysis covers",
      layout: "cards",
      items: FSR_WHAT_IT_IS.parts.map((part) => ({ title: part.term, body: part.text })),
      footnote: FSR_WHAT_IT_IS.outro,
    },
    {
      id: "what-you-receive",
      heading: FSR_WHAT_YOU_RECEIVE.heading,
      layout: "cards",
      items: [
        { title: "A written explanation", body: FSR_WHAT_YOU_RECEIVE.text },
        { title: FSR_COST.heading, body: FSR_COST.text },
      ],
    },
    {
      id: "before-you-send",
      heading: FSR_FAQ.heading,
      layout: "cards",
      items: FSR_FAQ.items.map((item) => ({
        title: item.question,
        body: item.answer,
        ...("link" in item ? { link: { label: item.link.label, href: item.link.href } } : {}),
      })),
    },
  ],
  closing: {
    heading: "Start with your statement, or with a question.",
    body: claimText("review.process.summary"),
    primary: { label: "Get a free statement review", href: "/upload-statement" },
    secondary: { label: "Ask a question without a statement", href: `${ABOUT_CONTACT_PATH}#inquiry` },
  },
};

export const FREE_ANALYSIS_QUIZ_PATH = "/free-analysis";

/**
 * /free-analysis: the five-question quiz (client/src/pages/FreeAnalysis.tsx) that opens a statement
 * review request. The quiz states no savings figure, program recommendation or product pick, so this
 * record (server document and SEO route) carries none either.
 */
export const FREE_ANALYSIS_QUIZ_PAGE: OverviewPage = {
  ...FREE_ANALYSIS_PAGE,
  path: FREE_ANALYSIS_QUIZ_PATH,
  shortTitle: "Free Processing Analysis",
  title: "Free Processing Analysis | Liberty Bancard",
  description:
    "Answer five questions so a free statement review starts in the right place. No savings are promised; your statement shows your actual costs.",
  keywords: "free payment processing analysis, payment processing review, effective cost, merchant services review",
  breadcrumbLabel: "Free analysis",
  h1: "Tell us about your processing",
  intro:
    "Answer five quick questions so a free statement review starts in the right place. No savings are promised here: your costs depend on your current pricing and transaction mix, and your statement shows them.",
};
