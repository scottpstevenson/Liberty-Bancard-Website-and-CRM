import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Star, ThumbsDown, Minus, MessageSquare, BarChart3, Users } from "lucide-react";
import type { NpsResponse } from "@shared/schema";

interface NpsStats {
  total: number;
  submitted: number;
  avgScore: number;
  promoters: number;
  detractors: number;
  passives: number;
  npsScore: number;
}

function ScoreBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{count} <span className="text-muted-foreground text-xs">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function NpsDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<NpsStats>({
    queryKey: ["/api/nps/stats"],
  });

  const { data: responses = [], isLoading: responsesLoading } = useQuery<NpsResponse[]>({
    queryKey: ["/api/nps"],
  });

  const isLoading = statsLoading || responsesLoading;

  const recentSubmitted = responses.filter(r => r.submittedAt).slice(0, 10);

  const getScoreCategory = (score: number | null) => {
    if (score === null) return { label: "—", variant: "secondary" as const };
    if (score >= 9) return { label: "Promoter", variant: "default" as const };
    if (score >= 7) return { label: "Passive", variant: "secondary" as const };
    return { label: "Detractor", variant: "destructive" as const };
  };

  const npsColor = (score: number) => {
    if (score >= 50) return "text-green-600 dark:text-green-400";
    if (score >= 0) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  if (isLoading) {
    return (
      <div className="space-y-8" data-testid="nps-loading">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="nps-dashboard-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">NPS / CSAT Dashboard</h1>
        <p className="text-muted-foreground mt-1">Net Promoter Score tracking and merchant satisfaction surveys</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-nps-score">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">NPS Score</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${npsColor(stats?.npsScore ?? 0)}`} data-testid="text-nps-score">
              {stats?.npsScore ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">−100 to +100</p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-score">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Score</CardTitle>
            <Star className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-avg-score">{stats?.avgScore ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">out of 10</p>
          </CardContent>
        </Card>

        <Card data-testid="card-submitted">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Responses</CardTitle>
            <MessageSquare className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-submitted">{stats?.submitted ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">of {stats?.total ?? 0} sent</p>
          </CardContent>
        </Card>

        <Card data-testid="card-promoters">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Promoters</CardTitle>
            <Users className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-promoters">
              {stats?.promoters ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">scores 9–10</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-score-breakdown">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Score Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScoreBar label="Promoters (9–10)" count={stats?.promoters ?? 0} total={stats?.submitted ?? 0} color="bg-green-500" />
            <ScoreBar label="Passives (7–8)" count={stats?.passives ?? 0} total={stats?.submitted ?? 0} color="bg-amber-400" />
            <ScoreBar label="Detractors (0–6)" count={stats?.detractors ?? 0} total={stats?.submitted ?? 0} color="bg-red-500" />
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Response rate: {stats?.total ? Math.round(((stats.submitted) / stats.total) * 100) : 0}%
              </p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-recent-responses">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Recent Responses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentSubmitted.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No responses yet</p>
            ) : (
              <div className="space-y-3">
                {recentSubmitted.map((r) => {
                  const category = getScoreCategory(r.score);
                  return (
                    <div key={r.id} className="flex items-start gap-3 p-3 rounded-md border" data-testid={`nps-response-${r.id}`}>
                      <div className="shrink-0">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm">
                          {r.score ?? "?"}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={category.variant} className="text-xs">{category.label}</Badge>
                          <span className="text-xs text-muted-foreground">Day {r.dayTrigger} survey</span>
                          {r.submittedAt && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(r.submittedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {r.comment && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.comment}</p>
                        )}
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          {r.reviewRequestQueued && <span className="text-green-600">Review requested ✓</span>}
                          {r.healthAlertCreated && <span className="text-amber-600">Alert created ⚠</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
