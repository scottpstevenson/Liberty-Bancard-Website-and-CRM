import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, ExternalLink, Search, RefreshCw } from "lucide-react";

interface SeoCoverageRow {
  path: string;
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  hasOgImage: boolean;
  hasJsonLd: boolean;
  inSitemap: boolean;
  noindex: boolean;
  ogTemplate: string;
  internalLinks: number;
  probed: boolean;
  warnings: string[];
}

interface SeoCoverageResponse {
  env: { gscVerificationConfigured: boolean; bingVerificationConfigured: boolean };
  totals: { total: number; indexable: number; noindex: number; withWarnings: number; inSitemap: number };
  rows: SeoCoverageRow[];
}

export default function SeoHealth() {
  const [search, setSearch] = useState("");
  const [showOnlyWarnings, setShowOnlyWarnings] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery<SeoCoverageResponse>({
    queryKey: ["/api/admin/seo-coverage"],
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (showOnlyWarnings && r.warnings.length === 0) return false;
      if (!q) return true;
      return (
        r.path.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [data, search, showOnlyWarnings]);

  return (
    <div className="space-y-6">
      <SEO
        title="SEO Health"
        description="Per-route SEO coverage report for Liberty Bancard."
        path="/dashboard/seo-health"
        noindex
      />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-display font-bold" data-testid="text-seo-health-title">SEO Health</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Per-route SEO coverage: title length, description length, OG image, JSON-LD, sitemap inclusion.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          data-testid="button-refresh-seo"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total Routes" value={data.totals.total} testId="kpi-total" />
          <KpiCard label="Indexable" value={data.totals.indexable} testId="kpi-indexable" />
          <KpiCard label="Noindex" value={data.totals.noindex} testId="kpi-noindex" />
          <KpiCard
            label="With Warnings"
            value={data.totals.withWarnings}
            tone={data.totals.withWarnings > 0 ? "warn" : "ok"}
            testId="kpi-warnings"
          />
          <KpiCard label="In Sitemap" value={data.totals.inSitemap} testId="kpi-sitemap" />
        </div>
      )}

      {data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Webmaster Verification</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <VerifyRow
              label="Google Search Console (GSC_VERIFICATION)"
              ok={data.env.gscVerificationConfigured}
            />
            <VerifyRow
              label="Bing Webmaster Tools (BING_VERIFICATION)"
              ok={data.env.bingVerificationConfigured}
            />
            <p className="text-xs text-muted-foreground pt-2">
              Set <code>GSC_VERIFICATION</code> and <code>BING_VERIFICATION</code> env vars (server-side, used in
              SSR HTML head) and <code>VITE_GSC_VERIFICATION</code> / <code>VITE_BING_VERIFICATION</code> for the
              SPA. Both surfaces inject verification meta when set.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm">Per-Route Coverage</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter routes..."
                  className="pl-8 h-9 w-56"
                  data-testid="input-seo-filter"
                />
              </div>
              <Button
                size="sm"
                variant={showOnlyWarnings ? "default" : "outline"}
                onClick={() => setShowOnlyWarnings((v) => !v)}
                data-testid="button-toggle-warnings"
              >
                <AlertTriangle className="w-4 h-4 mr-1.5" />
                {showOnlyWarnings ? "Showing warnings" : "Show only warnings"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No routes match your filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-seo-coverage">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Title (chars)</th>
                    <th className="py-2 pr-3">Desc (chars)</th>
                    <th className="py-2 pr-3">OG</th>
                    <th className="py-2 pr-3">JSON-LD</th>
                    <th className="py-2 pr-3">Links</th>
                    <th className="py-2 pr-3">Sitemap</th>
                    <th className="py-2 pr-3">Index</th>
                    <th className="py-2 pr-3">Warnings</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.path}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                      data-testid={`row-seo-${row.path.replace(/[^a-z0-9]+/gi, "-")}`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{row.path}</td>
                      <td className="py-2 pr-3">
                        <LengthBadge len={row.titleLength} good={[30, 65]} />
                      </td>
                      <td className="py-2 pr-3">
                        <LengthBadge len={row.descriptionLength} good={[100, 165]} />
                      </td>
                      <td className="py-2 pr-3">{row.hasOgImage ? "✓" : "—"}</td>
                      <td className="py-2 pr-3">{row.hasJsonLd ? "✓" : "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs" data-testid={`text-internal-links-${row.path.replace(/[^a-z0-9]+/gi, "-")}`}>{row.internalLinks}</td>
                      <td className="py-2 pr-3">{row.inSitemap ? "✓" : "—"}</td>
                      <td className="py-2 pr-3">
                        {row.noindex ? (
                          <Badge variant="outline" className="text-xs">noindex</Badge>
                        ) : (
                          <Badge className="text-xs">index</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.warnings.length === 0 ? (
                          <span className="inline-flex items-center text-green-600">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> ok
                          </span>
                        ) : (
                          <span className="text-amber-600" title={row.warnings.join("; ")}>
                            {row.warnings.length} issue{row.warnings.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={row.path}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center text-xs"
                          data-testid={`link-open-${row.path.replace(/[^a-z0-9]+/gi, "-")}`}
                        >
                          Open <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, tone, testId }: { label: string; value: number; tone?: "ok" | "warn"; testId?: string }) {
  const color = tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-display font-bold mt-1 ${color}`} data-testid={testId}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">configured</Badge>
      ) : (
        <Badge variant="outline">not set</Badge>
      )}
    </div>
  );
}

function LengthBadge({ len, good }: { len: number; good: [number, number] }) {
  const inRange = len >= good[0] && len <= good[1];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono ${
        inRange ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {len}
    </span>
  );
}
