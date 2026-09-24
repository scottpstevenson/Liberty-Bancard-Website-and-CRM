import {
  getAuthoritativeVerifiedContactLinks,
  type AuthoritativeContactBusinessLink,
} from "../commercial-link-authority";

export type SfpGapDimension =
  | "geography"
  | "target_vertical"
  | "official_domain"
  | "business_contact_channel"
  | "named_decision_maker";

export interface SfpGapVectorEntry {
  dimension: SfpGapDimension;
  open: boolean;
  closedBy: string | null;
  evidenceRef: string | null;
  subjectExclusions: Array<{
    subjectHash: string;
    authority: string;
    reasonCode: string;
    channel: string;
  }>;
}

export interface SfpBusinessGapVector {
  businessId: number;
  before: SfpGapVectorEntry[];
  after: SfpGapVectorEntry[];
  skippedProviderCalls: Array<{ provider: string; reason: string }>;
}

export async function computeContactLinkReuse(
  businessIds: number[],
): Promise<
  Map<
    number,
    {
      hasVerifiedContact: boolean;
      hasVerifiedNamedDecisionMaker: boolean;
      verifiedLinks: AuthoritativeContactBusinessLink[];
      skipReason: string | null;
    }
  >
> {
  const links = await getAuthoritativeVerifiedContactLinks(businessIds);
  const linksByBusiness = new Map<number, AuthoritativeContactBusinessLink[]>();
  for (const link of links) {
    const current = linksByBusiness.get(link.businessId) ?? [];
    current.push(link);
    linksByBusiness.set(link.businessId, current);
  }

  const result = new Map<
    number,
    {
      hasVerifiedContact: boolean;
      hasVerifiedNamedDecisionMaker: boolean;
      verifiedLinks: AuthoritativeContactBusinessLink[];
      skipReason: string | null;
    }
  >();
  for (const businessId of businessIds) {
    const verifiedLinks = linksByBusiness.get(businessId) ?? [];
    const verifiedContact = verifiedLinks.find((link) => Boolean(link.contactEmail));
    const verifiedNamedDecisionMaker = verifiedLinks.find(
      (link) => Boolean(link.contactName && link.contactTitle),
    );
    const satisfiedLink = verifiedNamedDecisionMaker ?? verifiedContact;
    result.set(businessId, {
      hasVerifiedContact: Boolean(verifiedContact),
      hasVerifiedNamedDecisionMaker: Boolean(verifiedNamedDecisionMaker),
      verifiedLinks,
      skipReason: satisfiedLink
        ? `verified_contact_reuse:decisionId=${satisfiedLink.decisionId}`
        : null,
    });
  }
  return result;
}

export interface ComputeSfpGapVectorInput {
  businessId: number;
  targetVerticalResolved: boolean;
  officialDomainKnown: boolean;
  hasFreeDiscoveryContactCandidate: boolean;
  verifiedLinkReuse: {
    hasVerifiedContact: boolean;
    hasVerifiedNamedDecisionMaker: boolean;
  };
  subjectSuppressions: Array<{
    subjectHash: string;
    authority: string;
    reasonCode: string;
    channel: string;
    scope: "contact" | "email" | "business";
  }>;
  businessWideSuppressionApplied: boolean;
  apolloSkipReason?: string | null;
  outscraperSkipReason?: string | null;
}

export async function computeSfpGapVector(
  input: ComputeSfpGapVectorInput,
): Promise<SfpBusinessGapVector> {
  const exclusionsFor = (dimension: "business_contact_channel" | "named_decision_maker") =>
    input.subjectSuppressions
      .filter((suppression) => {
        if (suppression.scope === "business") return false;
        if (dimension === "business_contact_channel") {
          return suppression.channel === "email" || suppression.channel === "all";
        }
        return suppression.scope === "contact";
      })
      .map(({ subjectHash, authority, reasonCode, channel }) => ({
        subjectHash,
        authority,
        reasonCode,
        channel,
      }));

  const before: SfpGapVectorEntry[] = [
    {
      dimension: "geography",
      open: false,
      closedBy: "cohort_freeze_geography_resolution",
      evidenceRef: null,
      subjectExclusions: [],
    },
    {
      dimension: "target_vertical",
      open: !input.targetVerticalResolved,
      closedBy: input.targetVerticalResolved ? "target_vertical_resolved" : null,
      evidenceRef: null,
      subjectExclusions: [],
    },
    {
      dimension: "official_domain",
      open: !input.officialDomainKnown,
      closedBy: input.officialDomainKnown ? "official_domain_known" : null,
      evidenceRef: null,
      subjectExclusions: [],
    },
    {
      dimension: "business_contact_channel",
      open: !(input.hasFreeDiscoveryContactCandidate || input.verifiedLinkReuse.hasVerifiedContact),
      closedBy: input.hasFreeDiscoveryContactCandidate
        ? "free_discovery_contact_candidate"
        : input.verifiedLinkReuse.hasVerifiedContact
          ? "verified_contact_reuse"
          : null,
      evidenceRef: null,
      subjectExclusions: exclusionsFor("business_contact_channel"),
    },
    {
      dimension: "named_decision_maker",
      open: !input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker,
      closedBy: input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker
        ? "verified_named_decision_maker_reuse"
        : null,
      evidenceRef: null,
      subjectExclusions: exclusionsFor("named_decision_maker"),
    },
  ];

  if (input.businessWideSuppressionApplied) {
    for (const entry of before) {
      if (entry.dimension === "geography") continue;
      entry.open = false;
      entry.closedBy = "business_wide_suppression_authoritative";
    }
  }

  const skippedProviderCalls: Array<{ provider: string; reason: string }> = [];
  if (input.verifiedLinkReuse.hasVerifiedNamedDecisionMaker && input.apolloSkipReason) {
    skippedProviderCalls.push({ provider: "apollo", reason: input.apolloSkipReason });
  }
  if (input.outscraperSkipReason) {
    skippedProviderCalls.push({ provider: "outscraper", reason: input.outscraperSkipReason });
  }

  return {
    businessId: input.businessId,
    before,
    after: before.map((entry) => ({
      ...entry,
      subjectExclusions: entry.subjectExclusions.map((exclusion) => ({ ...exclusion })),
    })),
    skippedProviderCalls,
  };
}

export function stopConditionsMet(vector: SfpBusinessGapVector): {
  allClosed: boolean;
  openDimensions: SfpGapDimension[];
} {
  const openDimensions = vector.after
    .filter((entry) => entry.open)
    .map((entry) => entry.dimension);
  return { allClosed: openDimensions.length === 0, openDimensions };
}