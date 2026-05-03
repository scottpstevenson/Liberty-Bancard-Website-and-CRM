import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, Phone, MessageCircle, Send, ShieldCheck } from "lucide-react";

interface ChannelActivityData {
  emailsSent: number;
  smsSent: number;
  callsMade: number;
  emailReplyRate: number;
  smsReplyRate: number;
  optOutRate: number;
  optOuts: number;
  noAnswerRate: number;
  emailDailyLimit: number;
  smsDailyLimit: number;
  callDailyLimit: number;
}

export function ChannelHealth() {
  const { data, isLoading } = useQuery<ChannelActivityData>({
    queryKey: ["/api/sdr/dashboard/activity"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const channels = [
    {
      label: "Emails Sent",
      value: data?.emailsSent || 0,
      icon: Mail,
      replyRate: data?.emailReplyRate || 0,
      limit: data?.emailDailyLimit || 200,
      usage: data?.emailsSent ? Math.round(((data?.emailsSent || 0) / (data?.emailDailyLimit || 200)) * 100) : 0,
    },
    {
      label: "SMS Sent",
      value: data?.smsSent || 0,
      icon: MessageCircle,
      replyRate: data?.smsReplyRate || 0,
      limit: data?.smsDailyLimit || 100,
      usage: data?.smsSent ? Math.round(((data?.smsSent || 0) / (data?.smsDailyLimit || 100)) * 100) : 0,
    },
    {
      label: "Calls Made",
      value: data?.callsMade || 0,
      icon: Phone,
      replyRate: null as number | null,
      limit: data?.callDailyLimit || 50,
      usage: data?.callsMade ? Math.round(((data?.callsMade || 0) / (data?.callDailyLimit || 50)) * 100) : 0,
      noAnswerRate: data?.noAnswerRate || 0,
    },
  ];

  return (
    <Card data-testid="card-sdr-channel-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="w-5 h-5" />
          Channel Health (Today)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {channels.map((ch) => {
            const Icon = ch.icon;
            return (
              <div key={ch.label} className="p-4 bg-muted/50 rounded-lg" data-testid={`channel-${ch.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{ch.label}</span>
                </div>
                <div className="text-2xl font-bold">{ch.value}</div>
                <div className="mt-2 space-y-1">
                  {ch.replyRate !== null && (
                    <div className="text-xs text-muted-foreground">
                      Reply rate: <span className="font-medium">{ch.replyRate}%</span>
                    </div>
                  )}
                  {"noAnswerRate" in ch && ch.noAnswerRate !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      No-answer rate: <span className="font-medium">{ch.noAnswerRate}%</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Daily limit: <span className="font-medium">{ch.value}/{ch.limit}</span> ({ch.usage}%)
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className={`h-full rounded-full transition-all ${ch.usage > 80 ? "bg-red-500" : ch.usage > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(ch.usage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Opt-outs today:</span>
            <span className="font-medium">{data?.optOuts || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Opt-out rate:</span>
            <span className="font-medium">{data?.optOutRate || 0}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
