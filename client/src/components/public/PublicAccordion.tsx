import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export interface PublicAccordionItem {
  value: string;
  question: ReactNode;
  answer: ReactNode;
  testId?: string;
  triggerTestId?: string;
  contentTestId?: string;
}

export interface PublicAccordionProps {
  items: PublicAccordionItem[];
  /** Single mode only. Default open item must be a real item value. */
  defaultValue?: string;
  className?: string;
  "data-testid"?: string;
}

/** Single-open accordion with 48px triggers and 16/26 answers from the public contract. */
export function PublicAccordion({ items, defaultValue, className, "data-testid": testId }: PublicAccordionProps) {
  return (
    <Accordion type="single" collapsible defaultValue={defaultValue} className={cn("public-card px-4 md:px-6", className)} data-testid={testId}>
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value} className="border-b border-border last:border-b-0" data-testid={item.testId}>
          <AccordionTrigger className="public-accordion-trigger text-foreground hover:no-underline" data-testid={item.triggerTestId}>{item.question}</AccordionTrigger>
          <AccordionContent className="public-accordion-body pb-4" data-testid={item.contentTestId}>{item.answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
