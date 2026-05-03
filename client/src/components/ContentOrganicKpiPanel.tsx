import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Linkedin, Calendar, TrendingUp, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface KpiResponse {
  blog: {
    published: number;
    scheduled: number;
    drafts: number;
    byPillar: Record<string, number>;
  };
  social: {
    published: number;
    scheduled: number;
    drafts: number;
  };
  upcomingBlog: Array<{ id: number; title: string; slug: string; scheduledAt: string; pillar: string | null }>;
  upcomingSocial: Array<{ id: number; body: string; scheduledAt: string; pillar: string | null }>;
}

export function ContentOrganicKpiPanel() {
  const { data, isLoading } = useQuery<KpiResponse>({
    queryKey: ["/api/content/kpis"],
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4" data-testid="panel-content-organic">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex gap-2 items-center"><FileText className="w-4 h-4" /> Blog Posts Published</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600" data-testid="kpi-blog-published">{data.blog.published}</div>
            <p className="text-xs text-muted-foreground mt-1">{data.blog.scheduled} scheduled · {data.blog.drafts} drafts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex gap-2 items-center"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Posts</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600" data-testid="kpi-social-published">{data.social.published}</div>
            <p className="text-xs text-muted-foreground mt-1">{data.social.scheduled} scheduled · {data.social.drafts} drafts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex gap-2 items-center"><TrendingUp className="w-4 h-4" /> Pillar Coverage</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="kpi-pillar-count">{Object.keys(data.blog.byPillar).length}</div>
            <p className="text-xs text-muted-foreground mt-1">of 4 content pillars active</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Blog Posts by Pillar</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(data.blog.byPillar).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-pillar-data">No pillar-tagged posts yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {["Cost & Pricing", "Programs", "Industry", "Compliance & Security"].map(p => (
                <div key={p} className="p-3 border rounded-lg" data-testid={`pillar-card-${p}`}>
                  <div className="text-2xl font-bold">{data.blog.byPillar[p] || 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">{p}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex gap-2 items-center"><Calendar className="w-4 h-4" /> Upcoming Blog Posts</CardTitle></CardHeader>
          <CardContent>
            {data.upcomingBlog.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-upcoming-blog">Nothing scheduled.</p>
            ) : (
              <div className="space-y-2">
                {data.upcomingBlog.map(p => (
                  <div key={p.id} className="text-sm p-2 border rounded" data-testid={`upcoming-blog-${p.id}`}>
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="flex gap-2 items-center mt-1 text-xs text-muted-foreground">
                      {p.pillar && <Badge variant="outline" className="text-xs">{p.pillar}</Badge>}
                      <span>{new Date(p.scheduledAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/dashboard/content" className="text-xs text-primary hover:underline mt-3 inline-block" data-testid="link-content-dash">Manage content →</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex gap-2 items-center"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> Upcoming LinkedIn Posts</CardTitle></CardHeader>
          <CardContent>
            {data.upcomingSocial.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-upcoming-social">Nothing scheduled.</p>
            ) : (
              <div className="space-y-2">
                {data.upcomingSocial.map(p => (
                  <div key={p.id} className="text-sm p-2 border rounded" data-testid={`upcoming-social-${p.id}`}>
                    <div className="text-xs line-clamp-2">{p.body}</div>
                    <div className="flex gap-2 items-center mt-1 text-xs text-muted-foreground">
                      {p.pillar && <Badge variant="outline" className="text-xs">{p.pillar}</Badge>}
                      <span>{new Date(p.scheduledAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/dashboard/social" className="text-xs text-primary hover:underline mt-3 inline-block" data-testid="link-social-dash">LinkedIn composer →</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
