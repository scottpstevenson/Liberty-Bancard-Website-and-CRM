import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { CheckCheck, AlertTriangle, Info, AlertCircle, Settings, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Notification, NotificationPreference } from "@shared/schema";
import { NOTIFICATION_EVENT_TYPES } from "@shared/schema";

function getTypeIcon(type: string | null) {
  switch (type) {
    case "urgent": return <AlertTriangle className="w-4 h-4 text-destructive" />;
    case "alert": return <AlertCircle className="w-4 h-4 text-amber-500" />;
    default: return <Info className="w-4 h-4 text-muted-foreground" />;
  }
}

function getTypeVariant(type: string | null): "destructive" | "default" | "secondary" {
  switch (type) {
    case "urgent": return "destructive";
    case "alert": return "default";
    default: return "secondary";
  }
}

function getTypeLabel(type: string | null): string {
  switch (type) {
    case "urgent": return "Urgent";
    case "alert": return "Alert";
    default: return "Info";
  }
}

function formatEventType(eventType: string): string {
  return eventType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function Notifications() {
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<string>("all");
  const [prefsOpen, setPrefsOpen] = useState(false);

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
  });

  const { data: preferences, isLoading: prefsLoading } = useQuery<NotificationPreference[]>({
    queryKey: ["/api/notification-preferences"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PUT", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to mark as read", description: err.message, variant: "destructive" });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to mark all as read", description: err.message, variant: "destructive" });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/notifications/clear-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications cleared" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear notifications", description: err.message, variant: "destructive" });
    },
  });

  const togglePrefMutation = useMutation({
    mutationFn: async ({ eventType, enabled }: { eventType: string; enabled: boolean }) => {
      await apiRequest("PUT", "/api/notification-preferences", { eventType, enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update preference", description: err.message, variant: "destructive" });
    },
  });

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;
  const totalCount = notifications?.length || 0;

  const filteredNotifications = notifications?.filter((n) => {
    if (filterType === "all") return true;
    return n.type === filterType;
  }) || [];

  function isPrefEnabled(eventType: string): boolean {
    const pref = preferences?.find((p) => p.eventType === eventType);
    return pref ? !!pref.enabled : true;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="notifications-loading">
        <div className="text-muted-foreground">Loading notifications...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="notifications-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold" data-testid="text-notifications-title">Notifications</h2>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-unread-count">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-type">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="alert">Alerts</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="gap-2"
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-4 h-4" />
              Mark All Read
            </Button>
          )}
          {totalCount > 0 && (
            <Button
              variant="outline"
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
              className="gap-2"
              data-testid="button-clear-all"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </Button>
          )}
          <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                data-testid="button-notification-settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-notification-preferences">
              <DialogHeader>
                <DialogTitle data-testid="text-preferences-title">Notification Preferences</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {prefsLoading ? (
                  <div className="text-muted-foreground text-sm">Loading preferences...</div>
                ) : (
                  NOTIFICATION_EVENT_TYPES.map((eventType) => (
                    <div
                      key={eventType}
                      className="flex items-center justify-between gap-4"
                      data-testid={`pref-row-${eventType}`}
                    >
                      <span className="text-sm" data-testid={`text-pref-label-${eventType}`}>
                        {formatEventType(eventType)}
                      </span>
                      <Switch
                        checked={isPrefEnabled(eventType)}
                        onCheckedChange={(checked) =>
                          togglePrefMutation.mutate({ eventType, enabled: checked })
                        }
                        disabled={togglePrefMutation.isPending}
                        data-testid={`switch-pref-${eventType}`}
                      />
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-3" data-testid="notifications-list">
        {filteredNotifications.length === 0 && (
          <div className="text-center text-muted-foreground py-12" data-testid="text-no-notifications">
            No notifications
          </div>
        )}
        {filteredNotifications.map((notification) => (
          <Card
            key={notification.id}
            className={`cursor-pointer hover-elevate ${!notification.read ? "" : "opacity-60"}`}
            onClick={() => {
              if (!notification.read) markReadMutation.mutate(notification.id);
            }}
            data-testid={`card-notification-${notification.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  {getTypeIcon(notification.type)}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid={`text-notification-title-${notification.id}`}>
                      {notification.title}
                    </span>
                    <Badge
                      variant={getTypeVariant(notification.type)}
                      className="text-xs no-default-hover-elevate no-default-active-elevate"
                      data-testid={`badge-notification-type-${notification.id}`}
                    >
                      {getTypeLabel(notification.type)}
                    </Badge>
                    {!notification.read && (
                      <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-notification-unread-${notification.id}`}>
                        Unread
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground" data-testid={`text-notification-message-${notification.id}`}>
                    {notification.message}
                  </p>
                  <div className="text-xs text-muted-foreground" data-testid={`text-notification-time-${notification.id}`}>
                    {notification.createdAt ? new Date(notification.createdAt).toLocaleString() : ""}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
