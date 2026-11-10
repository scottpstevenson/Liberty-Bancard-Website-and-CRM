// Why Liberty (/why-liberty-bancard). One record read by the React page and the server renderer.
//
// The earlier page stated merchant counts, annual volume, uptime, a company-held PCI level, a dated
// milestone history and staff imagery. None of those has evidence on file, so none appears here, in the
// title, the description or any schema block. The page is built from the founder note already approved
// for Home, the review process the statement page describes, program and equipment statements read from
// public claim records, and the contact channels the Contact page lists. It names no certification: a
// real one can be added only once the current entity, scope and evidence are supplied, and not from a
// partner's credential.

import { claimText } from "./public-claims";
import { FSR_DISCLOSURE, FSR_PROCESS } from "./free-statement-review-content";
import { HOME_FOUNDER } from "./public-home-content";
import { ABOUT_CONTACT_BOOKING_LABEL, ABOUT_CONTACT_PATH, PUBLIC_CONTACT_CHANNELS } from "./public-contact-content";
import type { OverviewPage } from "./public-overview-pages";

export const WHY_LIBERTY_PATH = "/why-liberty-bancard";

export const WHY_LIBERTY_PAGE: OverviewPage = {
  path: WHY_LIBERTY_PATH,
  shortTitle: "Why Liberty Bancard: Review First, Then Decide",
  title: "Why Liberty Bancard: Review First, Then Decide | Liberty Bancard",
  description:
    "Hear from the founder, see how a statement review works and reach Liberty Bancard through verified channels. We explain what you pay before you decide.",
  keywords: "why liberty bancard, statement review, payment processing review, merchant services provider",
  breadcrumbLabel: "Why Liberty Bancard",
  h1: "Why Liberty Bancard starts with your statement.",
  intro: `${FSR_DISCLOSURE} We begin by explaining what you pay now, then talk about whether an alternative fits your business.`,
  sections: [
    {
      id: "founder-note",
      heading: HOME_FOUNDER.heading,
      layout: "cards",
      items: [
        {
          title: "A note from the founder",
          body: HOME_FOUNDER.body,
          link: { label: HOME_FOUNDER.cta.label, href: HOME_FOUNDER.cta.href },
        },
      ],
    },
    {
      id: "review-process",
      heading: "How a statement review works",
      intro: "The review is the starting point. It is how we explain your costs before anyone proposes a change.",
      layout: "steps",
      items: [
        { title: "Share a statement", body: FSR_PROCESS.steps[0] },
        { title: "We review the charges", body: FSR_PROCESS.steps[1] },
        { title: "We walk you through it", body: FSR_PROCESS.steps[2] },
      ],
      footnote: `${FSR_PROCESS.support} ${claimText("timing.staged-process")}`,
      media: {
        imageId: "process-review-hands",
        variant: "wide",
        sizes: "(min-width: 1024px) 440px, calc(100vw - 32px)",
        caption: "Illustrative image of a checklist review. It does not show Liberty staff or a customer, and it contains no figures.",
      },
    },
    {
      id: "what-we-cover",
      heading: "What we can help you look at",
      layout: "cards",
      items: [
        {
          title: "Your current statement",
          body: claimText("offer.review.short"),
          link: { label: "Get a free statement review", href: "/upload-statement" },
        },
        {
          title: "Processing programs",
          body: `${claimText("program.overview")} ${claimText("program.remaining-costs")}`,
          link: { label: "See pricing and programs", href: "/pricing-and-programs" },
        },
        {
          title: "Equipment",
          body: `${claimText("equipment.options.summary")} ${claimText("equipment.agreement.summary")}`,
          link: { label: "Discuss checkout fit", href: "/free-smart-terminal" },
        },
      ],
    },
    {
      id: "reach-us",
      heading: "Reach us directly",
      intro: "These are the contact channels Liberty Bancard uses.",
      layout: "cards",
      items: [
        {
          title: "Phone, email or a booked conversation",
          body: "Call, write, or book a time to talk. You can also start without a statement.",
          points: [
            `Phone: ${PUBLIC_CONTACT_CHANNELS.phone.display}`,
            `Email: ${PUBLIC_CONTACT_CHANNELS.email.label}`,
            ABOUT_CONTACT_BOOKING_LABEL,
          ],
          link: { label: "See all contact options", href: ABOUT_CONTACT_PATH },
        },
      ],
    },
  ],
  closing: {
    heading: "See what you are paying.",
    body: claimText("review.process.summary"),
    primary: { label: "Get a free statement review", href: "/upload-statement" },
    secondary: { label: "Ask a question without a statement", href: `${ABOUT_CONTACT_PATH}#inquiry` },
  },
};
