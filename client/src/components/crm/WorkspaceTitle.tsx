import { Fragment, useMemo } from "react";
import { Link } from "wouter";
import { ShellPageTitle } from "@/components/ui/page-header";
import { isRecordPath, resolveWorkspaceIdentity } from "@/lib/workspace-identity";

/**
 * The employee shell's title slot. The selected area comes from the same registry as the sidebar, so the header can no longer
 * fall back to a generic label or a page name that belongs to another area. Where the route sits below the area (a page, a tab, a record)
 * the area name becomes the first crumb of one breadcrumb; the shell title stays in the page as visually hidden text so the
 * fallback heading is still announced. Single-record pages keep their own heading and Back control, so they show the area only.
 * Routes that belong to no sidebar area keep the label the shell already computed.
 */
export function WorkspaceTitle({ role, location, search, fallbackLabel, className }: {
  role: string; location: string; search: string; fallbackLabel: string; className: string;
}) {
  const identity = useMemo(
    () => resolveWorkspaceIdentity(role, search ? `${location}?${search.replace(/^\?/, "")}` : location),
    [role, location, search],
  );
  const showTrail = !!identity && !isRecordPath(location) && identity.crumbs.length > 1;
  return (
    <div className="min-w-0" data-testid="workspace-title" data-area={identity?.areaId ?? undefined}>
      <ShellPageTitle label={identity?.areaLabel ?? fallbackLabel} className={showTrail ? "sr-only" : className} />
      {showTrail && identity && (
        <nav aria-label="Breadcrumb" data-testid="shell-breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold sm:text-base">
            {identity.crumbs.map((crumb, index) => {
              const last = index === identity.crumbs.length - 1;
              return (
                <Fragment key={`${index}-${crumb.label}`}>
                  {index > 0 && <li aria-hidden="true" className="shrink-0 text-muted-foreground">/</li>}
                  <li className={`min-w-0 ${last ? "" : "shrink-[2]"}`}>
                    {last || !crumb.href
                      ? <span className="block truncate" aria-current={last ? "page" : undefined} data-testid={last ? "shell-breadcrumb-current" : undefined}>{crumb.label}</span>
                      : <Link href={crumb.href} className="block truncate font-medium text-muted-foreground underline-offset-2 hover:underline" data-testid={`shell-breadcrumb-link-${index}`}>{crumb.label}</Link>}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>
      )}
    </div>
  );
}
