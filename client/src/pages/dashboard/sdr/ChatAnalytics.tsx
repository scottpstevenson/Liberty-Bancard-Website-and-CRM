import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, MessageCircle, UserCheck, Calendar, ArrowRightLeft, Bot } from "lucide-react";

interface ChatAnalyticsData {
  chatsInitiated: number;
  chatMessages: number;
  chatLeadsCaptured: number;
  chatBookings: number;
  chatHandoffs: number;
  handoffRate: number;
}

export function ChatAnalytics() {
  const { data, isLoading } = useQuery<ChatAnalyticsData>({
    queryKey: ["/api/sdr/dashboard/chat-analytics"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const metrics = [
    { label: "Chats Initiated", value: data?.chatsInitiated || 0, icon: MessageSquare, color: "text-blue-600" },
    { label: "Messages", value: data?.chatMessages || 0, icon: MessageCircle, color: "text-purple-600" },
    { label: "Leads Captured", value: data?.chatLeadsCaptured || 0, icon: UserCheck, color: "text-green-600" },
    { label: "Bookings", value: data?.chatBookings || 0, icon: Calendar, color: "text-indigo-600" },
    { label: "Handoffs", value: data?.chatHandoffs || 0, icon: ArrowRightLeft, color: "text-orange-600" },
  ];

  return (
    <Card data-testid="card-sdr-chat-analytics">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          Chat Widget Analytics (Today)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="p-4 bg-muted/50 rounded-lg" data-testid={`chat-metric-${metric.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${metric.color}`} />
                  <span className="text-sm font-medium">{metric.label}</span>
                </div>
                <div className="text-2xl font-bold">{metric.value}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Handoff rate:</span>
            <span className="font-medium" data-testid="text-chat-handoff-rate">{data?.handoffRate || 0}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Conversion:</span>
            <span className="font-medium" data-testid="text-chat-conversion">
              {(data?.chatsInitiated || 0) > 0
                ? Math.round(((data?.chatLeadsCaptured || 0) / (data?.chatsInitiated || 1)) * 100)
                : 0}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
