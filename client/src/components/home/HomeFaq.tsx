import { Link } from "wouter";
import { PublicSection, PublicSectionHeader } from "@/components/public/PublicSection";
import { PublicAccordion, type PublicAccordionItem } from "@/components/public/PublicAccordion";
import { CALENDAR_URL } from "@/lib/constants";
import { claimText } from "@shared/public-claims";

const inlineLink = "font-medium text-primary underline underline-offset-2";

/** Section 7: six common questions, all answers carried over from the previous Home page. */
export function HomeFaq() {
  const items: PublicAccordionItem[] = [
    { question: "Do I have to switch processors to get the breakdown?", answer: "No. The statement review is how we prove your real cost. You keep the breakdown either way - no strings attached. Many merchants use it to have a more informed conversation with their current processor." },
    { question: "Is my statement secure?", answer: claimText("review.handling.summary", "faq") },
    {
      question: "How long does a review take?",
      answer: (
        <>
          Our team reviews your statement and follows up with what we found and your options. If you have a deadline,{" "}
          <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" className={inlineLink}>book a review call</a>{" "}
          and let us know your timeline.
        </>
      ),
    },
    {
      question: "What if I don't have my statement handy?",
      answer: (
        <>
          Use our <Link href="/estimate" className={inlineLink}>Quick Estimate tool</Link> to get a rough effective rate right now. For the complete picture with line-item detail, upload a statement when you have it.
        </>
      ),
    },
    {
      question: "I'm on Square or Stripe. Can you still help?",
      answer: (
        <>
          Absolutely. We'll compare apples-to-apples using your actual numbers. Many businesses processing over $10k/month find that flat-rate pricing costs significantly more than interchange-plus. <Link href="/beat-square-stripe" className={inlineLink}>See the comparison</Link>.
        </>
      ),
    },
    {
      question: 'Is "0% processing" actually legal?',
      answer: (
        <>
          "0%" programs have rules. We only recommend compliant cash discount or surcharging programs where permitted by law and appropriate for your business model. We handle disclosures, receipt formatting, and staff scripts. <Link href="/0-percent-processing" className={inlineLink}>Learn more</Link>.
        </>
      ),
    },
  ].map((item, i) => ({ ...item, value: `q${i + 1}`, testId: `faq-item-${i}`, triggerTestId: `faq-trigger-${i}`, contentTestId: `faq-content-${i}` }));

  return (
    <PublicSection tone="canvas" labelledBy="home-faq-heading" data-testid="section-faq">
      <div className="mx-auto max-w-3xl">
        <PublicSectionHeader id="home-faq-heading" title="Common questions" titleTestId="text-faq-heading" />
        <PublicAccordion items={items} data-testid="accordion-faq" />
      </div>
    </PublicSection>
  );
}
