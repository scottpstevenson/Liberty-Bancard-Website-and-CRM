import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PublicSectionTone = "canvas" | "warm" | "light" | "ink";

export interface PublicSectionProps {
  tone?: PublicSectionTone;
  /** Accessible name for the section (id of its heading). */
  labelledBy?: string;
  id?: string;
  className?: string;
  containerClassName?: string;
  children: ReactNode;
  "data-testid"?: string;
}

/** Page band: vertical rhythm, background tone and the 1200px content container from the public contract. */
export function PublicSection({ tone = "canvas", labelledBy, id, className, containerClassName, children, "data-testid": testId }: PublicSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("public-section", `public-section--${tone}`, className)}
      data-testid={testId}
    >
      <div className={cn("public-container", containerClassName)}>{children}</div>
    </section>
  );
}

export interface PublicSectionHeaderProps {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  as?: ElementType;
  align?: "start" | "center";
  className?: string;
  titleTestId?: string;
}

/** Section heading block: optional eyebrow, one h2 on the contract scale, optional lead paragraph. */
export function PublicSectionHeader({ id, eyebrow, title, description, as: Heading = "h2", align = "start", className, titleTestId }: PublicSectionHeaderProps) {
  return (
    <div className={cn("mb-6 md:mb-8", align === "center" && "mx-auto text-center", "max-w-3xl", className)}>
      {eyebrow && <p className="public-eyebrow mb-2">{eyebrow}</p>}
      <Heading id={id} className="public-h2 text-foreground" data-testid={titleTestId}>
        {title}
      </Heading>
      {description && <p className="public-body public-secondary mt-3">{description}</p>}
    </div>
  );
}
