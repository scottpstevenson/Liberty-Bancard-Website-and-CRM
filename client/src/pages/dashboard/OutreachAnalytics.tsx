import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart2, Send, Mail, Eye, MessageCircle, AlertTriangle, Zap } from "lucide-react";
import type { Campaign, OutboundMessage } from "@shared/schema";

function getMessageStatusBadge(status: string | null | undefined) {
  switch (status) {
    case "queued":
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
    case "sent":
    case "sending":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "delivered":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "opened":
      return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800";
    case "replied":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800";
    case "bounced":
    case "failed":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

function getCampaignStatusBadge(status: string | null | undefined) {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "paused":
      return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "draft":
    default:
      return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800";
  }
}

export default function OutreachAnalytics() {
  const { toast } = useToast();

  const { data: campaigns, isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<OutboundMessage[]>({
    queryKey: ["/api/outbound-messages", "?limit=50"],
    queryFn: async () => {
      const res = await fetch("/api/outbound-messages?limit=50", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const processQueueMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/outbound/process-queue");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outbound-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Queue processed", description: "Outbound message queue has been processed." });
    },
    onError: (err: Error) => {
      toast({ title: "Queue processing failed", description: err.message, variant: "destructive" });
    },
  });

  const totalCampaigns = campaigns?.length || 0;
  const totalSent = campaigns?.reduce((sum, c) => sum + (c.totalSent || 0), 0) || 0;
  const totalOpened = campaigns?.reduce((sum, c) => sum + (c.totalOpened || 0), 0) || 0;
  const totalReplied = campaigns?.reduce((sum, c) => sum + (c.totalReplied || 0), 0) || 0;
  const totalBounced = campaigns?.reduce((sum, c) => sum + (c.totalBounced || 0), 0) || 0;
  const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : "0.0";
  const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : "0.0";
  const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : "0.0";

  const sortedCampaigns = campaigns
    ? [...campaigns].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      })
    : [];

  const isLoading = campaignsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-20 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-outreach-analytics-title">Outreach Analytics</h2>
          <p className="text-sm text-muted-foreground">Campaign performance and outbound message tracking</p>
        </div>
        <Button
          onClick={() => processQueueMutation.mutate()}
          disabled={processQueueMutation.isPending}
          className="gap-2"
          data-testid="button-process-queue"
        >
          <Zap className="w-4 h-4" />
          {processQueueMutation.isPending ? "Processing..." : "Process Queue"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card data-testid="card-kpi-total-campaigns">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Campaigns</CardTitle>
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-campaigns">{totalCampaigns}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-total-sent">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Messages Sent</CardTitle>
            <Send className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-sent">{totalSent}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-open-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Rate</CardTitle>
            <Eye className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-open-rate">{openRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">{totalOpened} opened</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-reply-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reply Rate</CardTitle>
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-reply-rate">{replyRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">{totalReplied} replied</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-bounce-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bounce Rate</CardTitle>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-bounce-rate">{bounceRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">{totalBounced} bounced</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-campaign-performance">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Campaign Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Opened</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Bounced</TableHead>
                <TableHead className="text-right">Open Rate</TableHead>
                <TableHead className="text-right">Reply Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24 text-muted-foreground" data-testid="text-no-campaigns">
                    No campaigns found
                  </TableCell>
                </TableRow>
              ) : (
                sortedCampaigns.map((campaign) => {
                  const cSent = campaign.totalSent || 0;
                  const cOpened = campaign.totalOpened || 0;
                  const cReplied = campaign.totalReplied || 0;
                  const cBounced = campaign.totalBounced || 0;
                  const cOpenRate = cSent > 0 ? ((cOpened / cSent) * 100).toFixed(1) : "0.0";
                  const cReplyRate = cSent > 0 ? ((cReplied / cSent) * 100).toFixed(1) : "0.0";

                  return (
                    <TableRow key={campaign.id} data-testid={`row-campaign-${campaign.id}`}>
                      <TableCell className="font-medium" data-testid={`text-campaign-name-${campaign.id}`}>
                        {campaign.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`no-default-hover-elevate no-default-active-elevate ${getCampaignStatusBadge(campaign.status)}`}
                          data-testid={`badge-campaign-status-${campaign.id}`}
                        >
                          {campaign.status || "draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-sent-${campaign.id}`}>{cSent}</TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-opened-${campaign.id}`}>{cOpened}</TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-replied-${campaign.id}`}>{cReplied}</TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-bounced-${campaign.id}`}>{cBounced}</TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-open-rate-${campaign.id}`}>{cOpenRate}%</TableCell>
                      <TableCell className="text-right" data-testid={`text-campaign-reply-rate-${campaign.id}`}>{cReplyRate}%</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="card-recent-messages">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Recent Outbound Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {messagesLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!messages || messages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24 text-muted-foreground" data-testid="text-no-messages">
                      No outbound messages found
                    </TableCell>
                  </TableRow>
                ) : (
                  messages.map((msg) => (
                    <TableRow key={msg.id} data-testid={`row-message-${msg.id}`}>
                      <TableCell className="font-medium" data-testid={`text-message-recipient-${msg.id}`}>
                        {msg.toEmail || msg.toPhone || "N/A"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" data-testid={`text-message-subject-${msg.id}`}>
                        {msg.personalizedSubject || msg.subject || "--"}
                      </TableCell>
                      <TableCell data-testid={`text-message-channel-${msg.id}`}>
                        {msg.channel || "email"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`no-default-hover-elevate no-default-active-elevate ${getMessageStatusBadge(msg.status)}`}
                          data-testid={`badge-message-status-${msg.id}`}
                        >
                          {msg.status || "queued"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" data-testid={`text-message-sent-at-${msg.id}`}>
                        {msg.sentAt
                          ? new Date(msg.sentAt).toLocaleString()
                          : msg.scheduledFor
                            ? `Scheduled: ${new Date(msg.scheduledFor).toLocaleString()}`
                            : "--"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}