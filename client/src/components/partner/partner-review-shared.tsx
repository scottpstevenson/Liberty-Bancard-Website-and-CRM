import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { businessZoneNote, formatBusinessDateTime } from "@shared/business-time";

/**
 * Pieces shared by the application and introduction review surfaces: business-time formatting with the zone stated,
 * the append-only history list, and permission-aware "Open ..." links to the existing canonical destinations.
 */

/** Liberty business time with the zone abbreviation, never the browser zone. */
export const fmtBusiness = (iso: string | null | undefined) => formatBusinessDateTime(iso, { empty: "—", invalid: "Invalid date" });

export function BusinessTimeNote() {
  return <p className="text-xs text-muted-foreground" data-testid="business-time-note">{businessZoneNote()}</p>;
}

export interface ReviewHistoryEvent {
  id: string; eventType: string; fromStatus: string | null; toStatus: string; fromRevision: number | null; toRevision: number | null;
  actorId: string; actorName: string | null; note: string | null; details: Record<string, unknown>; at: string;
}

const EVENT_LABEL: Record<string, string> = {
  accept: "Accepted", decline: "Declined", needs_info: "Marked as needing information", reopened: "Returned to review",
  resolve_duplicate: "Resolved as a duplicate of an existing record", keep_existing_referrer: "Kept the existing referrer",
};

export function ReviewHistory({ events, statusLabel }: { events: ReviewHistoryEvent[]; statusLabel: (status: string) => string }) {
  return (
    <section aria-label="History" className="space-y-2" data-testid="review-history">
      <h3 className="text-lg font-semibold">History</h3>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="review-history-empty">No staff transitions have been recorded.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="rounded-md border p-3 text-sm" data-testid="review-history-event">
              <div className="font-medium">{EVENT_LABEL[event.eventType] ?? event.eventType}</div>
              <div className="text-xs text-muted-foreground">
                {event.fromStatus ? `${statusLabel(event.fromStatus)} → ` : ""}{statusLabel(event.toStatus)}
                {event.fromRevision !== null && event.toRevision !== null ? ` (revision ${event.fromRevision} → ${event.toRevision})` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtBusiness(event.at)} by {event.actorName ?? `staff id ${event.actorId}`}
              </div>
              {event.note ? <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{event.note}</p> : null}
              {event.details.messageSent === false ? <p className="mt-1 text-xs text-muted-foreground">No message was sent.</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A destination link that meets the 44 px target size and names its destination. */
export function OpenLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm text-blue-700 underline-offset-2 hover:underline" data-testid={testId}>
      {children}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

/** Existing canonical destinations. A contact is a CRM contact page; a request is the website-request list narrowed to its short reference. */
export const contactHref = (id: number) => `/dashboard/contacts/${id}`;
export const referralsHref = () => "/dashboard/referral-program?tab=referrals";
export const requestHref = (requestId: string) => `/dashboard/lead-ops?tab=pipeline&ref=${requestId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
