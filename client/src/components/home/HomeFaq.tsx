import { Link } from "wouter";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicAccordion, type PublicAccordionItem } from "@/components/public/PublicAccordion";
import { HOME_FAQ } from "@shared/public-home-content";

const inlineLink = "font-medium text-primary underline underline-offset-2";

/**
 * Common questions. Questions, answers and the optional follow-up link come from
 * shared/public-home-content.ts (answers read the public claim records), so the server-rendered Home
 * lists the same text.
 */
export function HomeFaq() {
  const items: PublicAccordionItem[] = HOME_FAQ.items.map((item, i) => ({
    value: `q${i + 1}`,
    question: item.question,
    answer: (
      <>
        {item.answer}
        {item.link && (
          <>
            {" "}
            <Link href={item.link.href} className={inlineLink}>{item.link.label}</Link>
          </>
        )}
      </>
    ),
    testId: `faq-item-${i}`,
    triggerTestId: `faq-trigger-${i}`,
    contentTestId: `faq-content-${i}`,
  }));

  return (
    <PublicSection tone="canvas" data-home-section="faq" labelledBy="home-faq-heading" data-testid="section-faq">
      <div className="mx-auto max-w-3xl">
        <PublicSectionHeader id="home-faq-heading" title={HOME_FAQ.heading} titleTestId="text-faq-heading" />
        <PublicAccordion items={items} data-testid="accordion-faq" />
      </div>
    </PublicSection>
  );
}
