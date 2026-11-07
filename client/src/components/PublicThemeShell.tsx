import { useEffect, type ReactNode } from "react";

/**
 * Wraps marketing and legal/disclosure routes with `.marketing-theme`.
 *
 * `.marketing-theme` in index.css asserts the brand-light token set, foreground
 * and canvas regardless of OS dark-mode or ThemeProvider state (P0-1 in
 * design-system spec). `.dark .marketing-theme` re-asserts the same values so the
 * `.dark` class on `<html>` cannot cascade into marketing page surfaces, and the
 * `dark:` Tailwind variant is switched off inside `.marketing-theme`.
 *
 * Radix menus, sheets, dialogs and selects portal to <body>, outside this
 * wrapper. While a public route is mounted we therefore also mark <body> with
 * `.marketing-theme` and <html> with `.public-surface` (light canvas / colour
 * scheme) so portalled public surfaces are light too. Both markers are removed
 * on unmount, so CRM, portal and auth routes never see them.
 *
 * Apply to: marketing-allowlist routes (see App.tsx MARKETING_PATHS).
 * Do NOT apply to: dashboard, portal, auth, tokenised, mobile, or thanks routes.
 */
export function PublicThemeShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const { body, documentElement } = document;
    body.classList.add("marketing-theme");
    documentElement.classList.add("public-surface");
    return () => {
      body.classList.remove("marketing-theme");
      documentElement.classList.remove("public-surface");
    };
  }, []);
  return <div className="marketing-theme light">{children}</div>;
}
