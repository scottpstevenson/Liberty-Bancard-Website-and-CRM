import { type ReactNode } from "react";

/**
 * Wraps marketing and legal/disclosure routes with `.marketing-theme`.
 *
 * `.marketing-theme` in index.css asserts the brand-light token set regardless
 * of OS dark-mode or ThemeProvider state (P0-1 in design-system spec).
 * `.dark .marketing-theme` re-asserts those same values so the `.dark` class
 * on `<html>` cannot cascade into marketing page surfaces.
 *
 * Apply to: marketing-allowlist routes (see App.tsx MARKETING_PATHS).
 * Do NOT apply to: dashboard, portal, auth, tokenised, mobile, or thanks routes.
 */
export function PublicThemeShell({ children }: { children: ReactNode }) {
  return <div className="marketing-theme light">{children}</div>;
}
