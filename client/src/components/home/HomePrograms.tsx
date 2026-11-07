import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicAccordion, type PublicAccordionItem } from "@/components/public/PublicAccordion";
import { COMPARE_LINKS } from "./home-content";

/** Program options. The same record drives the accordion (< lg) and the three comparable cards (lg+). */
const PROGRAMS = [
  {
    value: "cash-discount",
    title: "Cash Discount",
    badge: "All 50 states",
    summary: "Stop absorbing card fees — your revenue stays the same no matter how customers pay",
    body: "Your cash price is your posted price. Processing cost is covered automatically — it never comes out of your revenue. Legal in all 50 states with proper signage and receipts.*",
    points: ["Legal in all 50 states", "Compliant signage + receipts provided", "Staff script included"],
    figureLabel: "Your processing cost",
    figure: "Eliminated, when eligible*",
    cta: "Get My Savings Analysis",
    href: "/0-percent-processing",
    ctaTestId: "link-cash-discount-cta",
    itemTestId: "card-cash-discount",
    primary: true,
  },
  {
    value: "surcharging",
    title: "Compliant Surcharging",
    badge: "Most states",
    summary: "A clearly disclosed fee on eligible credit card sales — we verify your state before recommending this",
    body: "A disclosed fee appears on eligible credit card transactions at checkout. State law and card brand rules govern where this applies. We handle state eligibility checks, card-brand notices, compliant receipts, and signage.*",
    points: ["Required card-brand notices handled for you", "State eligibility confirmed before enrollment", "Compliant receipts + checkout disclosures"],
    figureLabel: "Your processing cost",
    figure: "$0 out of your revenue*",
    cta: "Get My Savings Analysis",
    href: "/0-percent-processing",
    ctaTestId: "link-surcharging-cta",
    itemTestId: "card-surcharging",
    primary: false,
  },
  {
    value: "interchange-plus",
    title: "Interchange Plus",
    badge: "One price for all customers",
    summary: "Pay the actual card-network rate plus a small visible markup",
    body: "No bundled tiers. No mystery fees. You see every penny of markup on every transaction — and we'll show you how your current rate compares before you decide.*",
    points: ["Real interchange passthrough — no tiers", "Full statement transparency on every charge", "Compare your current effective rate for free"],
    figureLabel: "Illustrative structure",
    figure: "Interchange + 0.25% / transaction*",
    cta: "Get My Rate Comparison",
    href: "/compare-rates",
    ctaTestId: "link-interchange-cta",
    itemTestId: "card-interchange-plus",
    primary: false,
  },
] as const;

const FOOTNOTE = "*Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.";

/**
 * Section 5: program options. Interchange Plus (the wholesale-rate program) is the default-open item;
 * each program has exactly one route that matches its intent. Disclosure text is carried over unchanged.
 */
export function HomePrograms() {
  const items: PublicAccordionItem[] = PROGRAMS.map((p) => ({
    value: p.value,
    testId: `${p.itemTestId}-mobile`,
    question: (
      <span className="block pr-2">
        <span className="block public-card-title text-foreground">{p.title}</span>
        <span className="block public-small font-normal public-secondary">{p.summary}</span>
      </span>
    ),
    answer: (
      <>
        <p className="mb-4">{p.body}</p>
        <Button asChild variant={p.primary ? "default" : "outline"} className="public-cta gap-2 sm:w-auto">
          <Link href={p.href} data-testid={`${p.ctaTestId}-mobile`}>
            {p.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </>
    ),
  }));

  return (
    <PublicSection tone="canvas" labelledBy="home-programs-heading" data-testid="section-choose-path">
      <PublicSectionHeader id="home-programs-heading" eyebrow="Program options" title="Choose your path to lower processing cost" description="Two programs can eliminate your processor fees when you qualify. If you would rather keep one price for every customer, Interchange Plus gives you the most transparency at a lower rate." titleTestId="text-choose-path-heading" />
      <div className="lg:hidden">
        <PublicAccordion items={items} defaultValue="interchange-plus" data-testid="accordion-choose-path" />
      </div>
      <ul className="hidden gap-6 lg:grid lg:grid-cols-3" data-testid="grid-choose-path">
        {PROGRAMS.map((p) => (
          <li key={p.value} className="public-card flex flex-col p-6" data-testid={p.itemTestId}>
            <span className="public-eyebrow mb-2">{p.badge}</span>
            <h3 className="public-h3 text-foreground">{p.title}</h3>
            <p className="public-body public-secondary mt-2">{p.body}</p>
            <ul className="mt-4 grid flex-1 content-start gap-2">
              {p.points.map((point) => (
                <li key={point} className="public-small flex items-start gap-2 text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <div className="public-caption uppercase tracking-wider public-secondary">{p.figureLabel}</div>
              <div className="num text-sm font-semibold text-foreground">{p.figure}</div>
            </div>
            <Button asChild variant={p.primary ? "default" : "outline"} className="public-cta mt-4 gap-2">
              <Link href={p.href} data-testid={p.ctaTestId}>
                {p.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      <p className="public-caption public-secondary mt-4" data-testid="text-choose-path-footnote">{FOOTNOTE}</p>
      <nav aria-label="Compare by processor" className="mt-6 border-t border-border pt-4" data-testid="section-compare-links">
        <p className="public-small mb-1 font-medium text-foreground">Compare by processor</p>
        <ul className="flex flex-wrap gap-x-6">
          {COMPARE_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="public-tap inline-flex items-center text-primary underline underline-offset-4 hover:no-underline" data-testid={link.testId}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PublicSection>
  );
}
