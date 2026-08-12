import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateCta {
  label: string;
  onClick?: () => void;
  href?: string;
  testId?: string;
}

interface EmptyStateProps {
  /** Lucide icon component or any ReactNode to render as the graphic */
  icon?: React.ElementType;
  heading: string;
  description?: string;
  cta?: EmptyStateCta;
  className?: string;
  testId?: string;
}

/**
 * Shared empty-state component used across all 12 audited pages.
 * Renders an icon (if provided), a heading, optional description, and optional CTA button.
 * Ensures consistent visual treatment instead of ad-hoc "No results" strings.
 */
export function EmptyState({
  icon: Icon,
  heading,
  description,
  cta,
  className,
  testId,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-4 gap-3",
        className
      )}
      data-testid={testId ?? "empty-state"}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1 max-w-xs">
        <p className="font-medium text-foreground" data-testid="empty-state-heading">
          {heading}
        </p>
        {description && (
          <p className="text-sm text-muted-foreground" data-testid="empty-state-description">
            {description}
          </p>
        )}
      </div>
      {cta && (
        cta.href ? (
          <Button asChild variant="outline" size="sm" data-testid={cta.testId}>
            <a href={cta.href}>{cta.label}</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={cta.onClick} data-testid={cta.testId}>
            {cta.label}
          </Button>
        )
      )}
    </div>
  );
}
