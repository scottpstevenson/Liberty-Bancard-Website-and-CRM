import { Card, CardContent } from "@/components/ui/card";
import { type ActivityEvent, formatRelativeTime, getActionMeta, getDetailText, getIntentFromEvent, ClassificationBadge } from "./shared";

export function ActivityTimelineFull({ events }: { events: ActivityEvent[] }) {
  const displayEvents = events.slice(0, 50);

  if (displayEvents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground" data-testid="activity-timeline-empty">
          No activity yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6" data-testid="activity-timeline">
        <div className="relative">
          {displayEvents.map((event, index) => {
            const { icon: Icon, label } = getActionMeta(event);
            const detail = getDetailText(event);
            const intent = getIntentFromEvent(event);
            const isLast = index === displayEvents.length - 1;

            return (
              <div
                key={event.id}
                className="relative flex gap-3 pb-4"
                data-testid={`activity-item-${event.id}`}
              >
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium" data-testid={`activity-label-${event.id}`}>
                      {label}
                    </p>
                    {intent && (
                      <ClassificationBadge intent={intent} />
                    )}
                  </div>
                  {detail && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`activity-detail-${event.id}`}>
                      {detail}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid={`activity-time-${event.id}`}>
                    {formatRelativeTime(event.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
