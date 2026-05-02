import { Link } from "wouter";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbCrumb {
  name: string;
  path: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbCrumb[];
  className?: string;
  variant?: "default" | "dark";
}

export function Breadcrumbs({ items, className, variant = "default" }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  const text = variant === "dark" ? "text-white/70" : "text-muted-foreground";
  const linkHover = variant === "dark" ? "hover:text-white" : "hover:text-foreground";
  const current = variant === "dark" ? "text-white" : "text-foreground";

  return (
    <nav
      aria-label="Breadcrumb"
      className={`text-sm ${text} ${className || ""}`}
      data-testid="breadcrumbs-nav"
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li className="flex items-center">
          <Link
            href="/"
            className={`inline-flex items-center gap-1 transition-colors ${linkHover}`}
            data-testid="link-breadcrumb-home"
          >
            <Home className="w-3.5 h-3.5" />
            <span className="sr-only sm:not-sr-only">Home</span>
          </Link>
        </li>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.path}-${idx}`} className="flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              {isLast ? (
                <span
                  className={`font-medium ${current}`}
                  aria-current="page"
                  data-testid={`text-breadcrumb-${idx}`}
                >
                  {item.name}
                </span>
              ) : (
                <Link
                  href={item.path}
                  className={`transition-colors ${linkHover}`}
                  data-testid={`link-breadcrumb-${idx}`}
                >
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
