import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Smartphone } from "lucide-react";

export function SmsMetricsPanel() {
  const { data, isLoading } = useQuery<{
    smsEnabled: boolean;
    today: { total: number; sent: number; failed: number; replied: number; replyRate: number };
  }>({
    queryKey: ["/api/sdr/sms-metrics"],
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  if (!data?.smsEnabled) {
    return (
      <Card data-testid="card-sms-disabled">
        <CardContent className="p-6 text-center">
          <Smartphone className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <div className="font-medium text-muted-foreground">SMS Channel Disabled</div>
          <div className="text-xs text-muted-foreground mt-1">Set SMS_ENABLED=true to activate SMS outreach</div>
        </CardContent>
      </Card>
    );
  }

  const stats = data.today;
  return (
    <div className="space-y-4" data-testid="panel-sms-metrics">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card data-testid="card-sms-total">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Attempts</div>
            <div className="text-xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-sent">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Sent</div>
            <div className="text-xl font-bold text-green-600">{stats.sent}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-failed">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Failed</div>
            <div className="text-xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-replied">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Replied</div>
            <div className="text-xl font-bold text-blue-600">{stats.replied}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-sms-reply-rate">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Reply Rate</div>
            <div className="text-xl font-bold">{stats.replyRate}%</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
