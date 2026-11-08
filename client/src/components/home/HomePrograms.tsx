import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicAccordion, type PublicAccordionItem } from "@/components/public/PublicAccordion";
import { HOME_PROCESSING_ANCHOR } from "@shared/public-home-content";
import { COMPARE_LINKS } from "./home-content";
import { ZP_HOME_DESCRIPTION, ZP_HOME_FOOTNOTE, ZP_HOME_HEADING, ZP_HOME_PROGRAMS } from "@shared/zero-percent-content";

/** Per-program test ids and emphasis; wording comes from the shared program record. */
const PROGRAM_UI = {
  "cash-discount": { ctaTestId: "link-cash-discount-cta", itemTestId: "card-cash-discount", primary: true },
  surcharging: { ctaTestId: "link-surcharging-cta", itemTestId: "card-surcharging", primary: false },
  "interchange-plus": { ctaTestId: "link-interchange-cta", itemTestId: "card-interchange-plus", primary: false },
} as const;

/** Program options. The same record drives the accordion (< lg) and the three comparable cards (lg+). */
const PROGRAMS = ZP_HOME_PROGRAMS.map((program) => ({ ...program, ...PROGRAM_UI[program.value] }));

const FOOTNOTE = ZP_HOME_FOOTNOTE;

/**
 * Section 5: program options. Interchange Plus (the wholesale-rate program) is the default-open item;
 * each program has exactly one route that matches its intent. Program wording is read from the shared program record.
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
    <PublicSection tone="canvas" id={HOME_PROCESSING_ANCHOR} labelledBy="home-programs-heading" data-testid="section-choose-path">
      <PublicSectionHeader id="home-programs-heading" eyebrow="Program options" title={ZP_HOME_HEADING} description={ZP_HOME_DESCRIPTION} titleTestId="text-choose-path-heading" />
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
