/**
 * Audience-specific guide for the CRM Referral & Partner Program page. One source, reusing the approved public
 * partner content: it never states a percentage, flat fee, bonus tier or payout date. Compensation appears only as
 * "your written agreement" or as the published, approved projection that `referralCompensationSentence` renders.
 *
 * Pure data (no db, no React) so the page and its certification read the same words.
 */
import {
  PARTNER_COMPARISON_ROWS,
  PARTNER_INTRODUCTION_PERMISSION,
  PARTNER_REVIEW_DISCLOSURE,
  referralCompensationSentence,
  type PartnerReferralPolicy,
} from "./partner-public-content";

export const PARTNER_GUIDE_AUDIENCES = ["applicant", "staff", "referral", "sales_agent"] as const;
export type PartnerGuideAudience = (typeof PARTNER_GUIDE_AUDIENCES)[number];

export interface PartnerGuideSection {
  id: string;
  title: string;
  /** Plain paragraphs and short lists; `lines` render as separate list items. */
  body: string;
  lines?: readonly string[];
}

export const PARTNER_GUIDE_AUDIENCE_LABEL: Record<PartnerGuideAudience, string> = {
  applicant: "Applicants",
  staff: "Staff reviewing partners",
  referral: "Referral partners",
  sales_agent: "Sales agents",
};

export const PARTNER_GUIDE_INTRO =
  "Everyone starts with an application. Liberty Bancard reviews it, confirms terms in writing, and only then sets up portal access. Pick the audience that matches you.";

export function partnerGuideSections(audience: PartnerGuideAudience, policy: PartnerReferralPolicy): readonly PartnerGuideSection[] {
  const referralPay = referralCompensationSentence(policy);
  const comparison = PARTNER_COMPARISON_ROWS.find((row) => row.attribute === "Your role");
  switch (audience) {
    case "applicant":
      return [
        {
          id: "applicant-steps",
          title: "From application to your first introduction",
          body: "Apply on the public partners page. No account, password, statements or financial documents are needed to apply.",
          lines: [
            "1. Apply: choose the referral-partner or sales-agent path.",
            "2. Pending review: Liberty Bancard reviews the application. Review timing is not promised on the public page.",
            "3. Explicit terms: if the application moves forward, compensation terms are confirmed in a written agreement.",
            "4. Invitation and account setup: an accepted partner receives an invitation to set up portal access.",
            "5. Permitted introductions: only an active referral partner can submit introductions, and only for businesses that agreed to hear from Liberty.",
          ],
        },
        {
          id: "applicant-needs-info",
          title: "If we need more information",
          body: "An application can be marked as needing information. That status change does not send a message by itself; the partnerships team contacts the applicant separately. A declined or withdrawn application can be returned to review by an administrator; submitting the form again does not reopen it.",
        },
        { id: "applicant-disclosure", title: "Review and approval", body: PARTNER_REVIEW_DISCLOSURE },
      ];
    case "staff":
      return [
        {
          id: "staff-flow",
          title: "How a partner is created and approved",
          body: "Public applications arrive as pending review in the Applications tab. Nothing is active until an administrator accepts it with a written terms reference.",
          lines: [
            "Applications tab: review the answers, then accept, decline, or mark as needing information. Marking as needing information only changes the status and records your note; no message is sent.",
            "Return to review: an administrator can reopen a declined, withdrawn or needs-information application with a written reason. Accepted partners and partners that already have an account or recorded terms cannot be reopened.",
            "Invitation: acceptance queues the account-setup invitation. The application detail shows whether it is queued, held, sent or failed.",
            "Add Partner (administrators only) is manual entry for a partner whose terms are already agreed in writing. It does not replace application review, and it does not set terms on its own.",
            "Introductions tab: approved partners submit introductions. Staff review identity evidence, then accept, decline, or close a duplicate or competing introduction, always with a written reason. A decision never creates a commission, moves attribution or merges companies.",
          ],
        },
        {
          id: "staff-compensation",
          title: "Compensation",
          body: `Compensation follows each partner's written agreement. This page and the public pages do not publish a rate card. ${referralPay}`,
        },
        { id: "staff-times", title: "Times", body: "Review times use Liberty business time (Eastern), not your device's time zone." },
      ];
    case "referral":
      return [
        {
          id: "referral-role",
          title: "What a referral partner does",
          body: comparison?.referral ?? "Introduce businesses that agreed to hear from Liberty.",
          lines: [
            "Introduce only a business whose owner or decision-maker agreed to hear from Liberty Bancard.",
            "Tell us who you are introducing and why.",
            "Liberty Bancard handles the sales conversation, pricing, proposals and onboarding.",
          ],
        },
        {
          id: "referral-permission",
          title: "Permission before every introduction",
          body: `Each introduction records your statement that the contact agreed to be introduced (${PARTNER_INTRODUCTION_PERMISSION.version}). It is not the business's marketing consent and it does not sign them up for marketing.`,
        },
        {
          id: "referral-review",
          title: "What happens after you submit",
          body: "Our team reviews each introduction. Some are held for staff while we check whether the business is already known to us. A held introduction is not lost and does not need to be resubmitted. Review does not create an agreement or a payment.",
        },
        { id: "referral-pay", title: "Compensation", body: `${referralPay} Your agreement sets what counts as a qualifying referral, attribution and payment timing.` },
      ];
    case "sales_agent":
      return [
        {
          id: "agent-role",
          title: "What a sales agent does",
          body: comparison?.salesAgent ?? "Prospect, develop and help close your own merchant relationships.",
          lines: [
            "Prospect and build relationships with business owners.",
            "Guide each opportunity through discovery, proposal and onboarding with Liberty Bancard.",
            "Keep merchant information accurate and handle it with care.",
          ],
        },
        {
          id: "agent-difference",
          title: "How this differs from a referral partner",
          body: "A referral partner makes the introduction and Liberty leads the sale. A sales agent leads the sale with Liberty's support, so the responsibilities and the compensation schedule are different. Your signed schedule defines both.",
        },
        {
          id: "agent-pay",
          title: "Compensation",
          body: "Compensation follows your signed compensation schedule, which states which lead sources qualify and how adjustments work. Terms for company-provided or referred leads are confirmed separately. Nothing is payable until the schedule is signed.",
        },
      ];
  }
}

/** Every string the guide can render, for censuses that must find no unsupported promise. */
export function partnerGuideAllText(policy: PartnerReferralPolicy): string {
  const parts: string[] = [PARTNER_GUIDE_INTRO];
  for (const audience of PARTNER_GUIDE_AUDIENCES) {
    parts.push(PARTNER_GUIDE_AUDIENCE_LABEL[audience]);
    for (const section of partnerGuideSections(audience, policy)) parts.push(section.title, section.body, ...(section.lines ?? []));
  }
  return parts.join("\n");
}
