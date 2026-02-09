import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCheck, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Notification } from "@shared/schema";

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

export default function Notifications() {
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<string>("all");

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
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
      const unread = notifications?.filter((n) => !n.read) || [];
      await Promise.all(unread.map((n) => apiRequest("PUT", `/api/notifications/${n.id}/read`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to mark all as read", description: err.message, variant: "destructive" });
    },
  });

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;

  const filteredNotifications = notifications?.filter((n) => {
    if (filterType === "all") return true;
    return n.type === filterType;
  }) || [];

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
