// Public review offer record for the promotion banner, promotion list, shop and
// Free Analysis surfaces. Wording comes from approved claim records in
// shared/public-claims.ts; no free-processing, no-lease, free-placement or zero
// monthly-fee statement exists here because none has written program evidence.
//
// The promotion attribution code is retained only as a routing/attribution value
// (the `?promo=` query parameter and the stored `lb_promo_code`). It is never
// displayed and is not evidence that any benefit has been approved.

import { claimText } from "./public-claims";

export const PROMO_ATTRIBUTION_CODE = "FREE30";

export interface PublicOffer {
  id: string;
  title: string;
  description: string;
  /** Single-line wording for the banner bar. */
  shortDescription: string;
  ctaLabel: string;
  ctaHref: string;
}

export const REVIEW_OFFER: PublicOffer = {
  id: "statement-review",
  title: "Review Your Processing Options",
  description: claimText("offer.review.inquiry"),
  shortDescription: claimText("offer.review.short"),
  ctaLabel: "Request a Review",
  ctaHref: `/free-analysis?promo=${PROMO_ATTRIBUTION_CODE}`,
};

/** Equipment price-area label used wherever a monthly equipment fee has no product-specific written evidence. */
export const EQUIPMENT_TERMS_LABEL = claimText("equipment.terms.quote");

/** Shop trust-strip card that replaces the retired no-lease / free-placement assertion. */
export const SHOP_TERMS_CARD = {
  title: "Terms Confirmed in Writing",
  text: claimText("equipment.terms.card"),
} as const;
