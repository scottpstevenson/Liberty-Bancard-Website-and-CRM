import { PartnerJourneyPage } from "@/components/public/PartnerJourneyPage";

/** /partners/referrals: the canonical referral journey and application. `?profession=` preselects an allowlisted profession. */
export default function PartnerReferralApplication() {
  const profession = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("profession");
  return <PartnerJourneyPage path="referral" initialProfession={profession} />;
}
