export const merchantApplicationSeo = {
  title: "Apply for Merchant Payment Processing",
  description: "Apply for merchant payment processing with Liberty Bancard. Review the business, ownership, banking, and processing information needed to apply.",
  path: "/merchant-application",
};

export const merchantApplicationSteps = [
  "Business Information",
  "Owner Information",
  "Bank Information",
  "Processing Details",
  "Equipment & Program",
  "Review & Submit",
] as const;

export const merchantApplicationIntro =
  `Complete your application in ${merchantApplicationSteps.length} steps. Approval is subject to underwriting review.`;
