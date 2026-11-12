import { Button } from "@/components/ui/button";
import { MOBILE_HOME, type MobileDestination } from "@/lib/mobile-destination";

type Choice = Extract<MobileDestination, { kind: "choose" }>;

/**
 * Shown when a phone-width browser opens an employee view the mobile app cannot reproduce exactly. The address the person
 * opened stays in the address bar (reload, resize and Back keep it); nothing is replaced with the mobile home page.
 */
export function MobileDestinationNotice({ destination, onOpenDesktop }: { destination: Choice; onOpenDesktop: () => void }) {
  return (
    <main className="crm-theme crm-page mx-auto max-w-md p-4" data-testid="mobile-destination-notice">
      <h1 className="text-lg font-semibold">This view is not in the mobile app</h1>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="text-mobile-destination-reason">{destination.reason}</p>
      <p className="mt-2 text-sm">
        You can open the same page in the desktop layout, which keeps the record, filters and selection from the link, or go to the mobile home page.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Button type="button" className="min-h-11" onClick={onOpenDesktop} data-testid="button-open-desktop-layout">
          Open this page in the desktop layout
        </Button>
        <Button asChild type="button" variant="outline" className="min-h-11">
          <a href={destination.mobileHref || MOBILE_HOME} data-testid="link-mobile-home">Go to the mobile home page</a>
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">The desktop layout choice is remembered on this device; switch back from More in the mobile app.</p>
    </main>
  );
}
