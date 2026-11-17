import { Link } from "wouter";
import { ArrowRight, Handshake, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicAccordion } from "@/components/public/PublicAccordion";
import {
  PARTNER_AGENT_CARD,
  PARTNER_COMPARISON_ROWS,
  PARTNER_PATH_LABEL,
  PARTNER_PROCESS_STEPS,
  PARTNER_REFERRAL_CARD,
  PARTNER_REVIEW_DISCLOSURE,
  PARTNER_ROUTES,
  partnerFaqs,
  partnerReferralCardBody,
  type PartnerFaq,
  type PartnerPathId,
  type PartnerReferralPolicy,
} from "@shared/partner-public-content";
import { trackPartnerEvent } from "@/lib/tracking";
import { partnerRouteWithAttribution } from "@/lib/partner-application-client";

/** FAQ structured data built from exactly the answers a page renders, never a longer list than the page shows. */
export function partnerFaqJsonLd(faqs: readonly PartnerFaq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
  };
}

interface PathCardsProps {
  policy: PartnerReferralPolicy;
  sourcePage: string;
  headingId: string;
}

/** The two path cards: equal weight, referral first, an explicit text link as the only action in each card. */
export function PartnerPathCards({ policy, sourcePage, headingId }: PathCardsProps) {
  const cards: { path: PartnerPathId; icon: typeof Handshake; title: string; body: string; cta: string; href: string; responsibilities: readonly string[] }[] = [
    { path: "referral", icon: Handshake, title: PARTNER_REFERRAL_CARD.title, body: partnerReferralCardBody(policy), cta: PARTNER_REFERRAL_CARD.cta, href: partnerRouteWithAttribution(PARTNER_ROUTES.referral), responsibilities: PARTNER_REFERRAL_CARD.responsibilities },
    { path: "sales_agent", icon: Briefcase, title: PARTNER_AGENT_CARD.title, body: PARTNER_AGENT_CARD.body, cta: PARTNER_AGENT_CARD.cta, href: partnerRouteWithAttribution(PARTNER_ROUTES.salesAgent), responsibilities: PARTNER_AGENT_CARD.responsibilities },
  ];
  return (
    <ul className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-labelledby={headingId} data-testid="partner-path-cards">
      {cards.map(({ path, icon: Icon, title, body, cta, href, responsibilities }) => (
        <li key={path} className="public-card flex flex-col p-6 md:p-8" data-testid={`partner-card-${path}`}>
          <Icon className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />
          <p className="public-eyebrow mb-1">{PARTNER_PATH_LABEL[path]}</p>
          <h3 className="public-h3 mb-3 text-foreground">{title}</h3>
          <p className="public-body public-secondary mb-4">{body}</p>
          <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-foreground">
            {responsibilities.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="mt-auto">
            <Button asChild variant={path === "referral" ? "default" : "outline"} className="min-h-11">
              <Link href={href} onClick={() => trackPartnerEvent("partner_path_selected", { path, source_page: sourcePage })} data-testid={`partner-card-${path}-cta`}>
                {cta} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One source of rows, two presentations (a table from md up, labelled role blocks on phones), each hidden from the other's audience. */
export function PartnerComparison({ headingId }: { headingId: string }) {
  return (
    <div data-testid="partner-comparison">
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-sm" aria-labelledby={headingId}>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-4 font-semibold text-foreground">&nbsp;</th>
              <th scope="col" className="py-3 pr-4 font-semibold text-foreground">{PARTNER_PATH_LABEL.referral}</th>
              <th scope="col" className="py-3 font-semibold text-foreground">{PARTNER_PATH_LABEL.sales_agent}</th>
            </tr>
          </thead>
          <tbody>
            {PARTNER_COMPARISON_ROWS.map((row) => (
              <tr key={row.attribute} className="border-b border-border align-top last:border-b-0">
                <th scope="row" className="py-3 pr-4 font-medium text-foreground">{row.attribute}</th>
                <td className="py-3 pr-4 text-muted-foreground">{row.referral}</td>
                <td className="py-3 text-muted-foreground">{row.salesAgent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:hidden">
        {(["referral", "sales_agent"] as const).map((path) => (
          <section key={path} className="public-card p-4" aria-label={PARTNER_PATH_LABEL[path]}>
            <h3 className="public-card-title mb-3 text-foreground">{PARTNER_PATH_LABEL[path]}</h3>
            <dl className="space-y-3 text-sm">
              {PARTNER_COMPARISON_ROWS.map((row) => (
                <div key={row.attribute}>
                  <dt className="font-medium text-foreground">{row.attribute}</dt>
                  <dd className="text-muted-foreground">{path === "referral" ? row.referral : row.salesAgent}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Four steps: a numbered vertical list on phones, 2×2 at md, one row of four at lg. */
export function PartnerProcess() {
  return (
    <ol className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4" data-testid="partner-process">
      {PARTNER_PROCESS_STEPS.map((step, index) => (
        <li key={step.title} className="flex gap-4 md:block">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground md:mb-3" aria-hidden="true">{index + 1}</span>
          <div>
            <h3 className="public-card-title mb-1 text-foreground">{step.title}</h3>
            <p className="public-small text-muted-foreground">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** FAQ list for the whole policy state (or a subset by id). The same list feeds the page's structured data. */
export function selectedPartnerFaqs(policy: PartnerReferralPolicy, ids?: readonly string[]): readonly PartnerFaq[] {
  const all = partnerFaqs(policy);
  return ids ? all.filter((faq) => ids.includes(faq.id)) : all;
}

export function PartnerFaqList({ faqs, testId = "partner-faq" }: { faqs: readonly PartnerFaq[]; testId?: string }) {
  return (
    <div className="max-w-[720px]">
      <PublicAccordion data-testid={testId} items={faqs.map((faq) => ({ value: faq.id, question: faq.question, answer: faq.answer, triggerTestId: `${testId}-trigger-${faq.id}` }))} />
    </div>
  );
}

export function PartnerReviewDisclosure() {
  return <p className="public-small text-muted-foreground max-w-3xl" data-testid="partner-review-disclosure-page">{PARTNER_REVIEW_DISCLOSURE}</p>;
}
