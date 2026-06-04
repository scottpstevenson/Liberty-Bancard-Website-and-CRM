import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Link2,
  Copy,
  QrCode,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip as RechartsTooltip,
} from "recharts";
import QRCode from "qrcode";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SparkPoint { week: string; count: number }

interface ChannelRow {
  channel: string;
  periodCount: number;
  prevPeriodCount: number;
  thisWeek: number;
  lastWeek: number;
  conversionRate: number;
  sparkline: SparkPoint[];
}

interface GrowthKPIData {
  thisWeekTotal: number;
  prevWeekTotal: number;
  weekOverWeekChange: number;
  target: number;
  displayWeeks: number;
  channels: ChannelRow[];
  weekLabels: string[];
}

interface GeneratedLink {
  id: string;
  channel: string;
  medium: string;
  campaign: string;
  destination: string;
  url: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_RANGES: { label: string; weeks: number }[] = [
  { label: "This Week", weeks: 1 },
  { label: "Last 4 Weeks", weeks: 4 },
  { label: "Last 12 Weeks", weeks: 12 },
];

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  partner: "Partner",
  gbp: "GBP",
  affiliate: "Affiliate",
  newsletter: "Newsletter",
  haro: "HARO",
  youtube: "YouTube",
  direct: "Direct",
  other: "Other",
};

const UTM_CHANNELS: { value: string; label: string; medium: string }[] = [
  { value: "linkedin", label: "LinkedIn", medium: "social" },
  { value: "reddit", label: "Reddit", medium: "social" },
  { value: "haro", label: "HARO", medium: "pr" },
  { value: "partner", label: "Partner", medium: "referral" },
  { value: "newsletter", label: "Newsletter", medium: "email" },
  { value: "webinar", label: "Webinar", medium: "event" },
  { value: "gbp", label: "Google Business Profile", medium: "organic" },
  { value: "youtube", label: "YouTube", medium: "video" },
  { value: "podcast", label: "Podcast", medium: "podcast" },
  { value: "email-blast", label: "Email Blast", medium: "email" },
  { value: "event", label: "Event", medium: "event" },
];

const DESTINATION_PAGES: { value: string; label: string }[] = [
  { value: "/upload-statement", label: "Upload Statement" },
  { value: "/get-started", label: "Get Started" },
  { value: "/free-analysis", label: "Free Analysis" },
  { value: "/savings-calculator", label: "Savings Calculator" },
  { value: "/estimate", label: "Estimate" },
  { value: "/partners", label: "Partners" },
];

const LINK_HISTORY_KEY = "lb_utm_link_history";
const MAX_HISTORY = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadLinkHistory(): GeneratedLink[] {
  try {
    const raw = localStorage.getItem(LINK_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLinkHistory(links: GeneratedLink[]) {
  localStorage.setItem(LINK_HISTORY_KEY, JSON.stringify(links.slice(0, MAX_HISTORY)));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildUTMUrl(channel: string, medium: string, campaign: string, destination: string): string {
  const origin = window.location.origin;
  const url = new URL(origin + destination);
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", medium);
  if (campaign) url.searchParams.set("utm_campaign", campaign.replace(/\s+/g, "-").toLowerCase());
  url.searchParams.set("utm_content", new Date().toISOString().split("T")[0]);
  return url.toString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: SparkPoint[] }) {
  if (!data || data.length < 2) {
    return <div className="h-8 w-20 bg-muted/40 rounded" />;
  }
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="count"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <RechartsTooltip
            contentStyle={{ fontSize: 11, padding: "2px 6px" }}
            formatter={(v: number) => [v, "signups"]}
            labelFormatter={(l: string) => `Week of ${l}`}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeekOverWeekBadge({ change }: { change: number }) {
  if (change > 0) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1" data-testid="badge-wow-change">
        <ArrowUpRight className="w-3 h-3" />+{change}%
      </Badge>
    );
  }
  if (change < 0) {
    return (
      <Badge variant="destructive" className="gap-1" data-testid="badge-wow-change">
        <ArrowDownRight className="w-3 h-3" />{change}%
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1" data-testid="badge-wow-change">
      <Minus className="w-3 h-3" />0%
    </Badge>
  );
}

function ProgressArc({ value, max }: { value: number; max: number }) {
  const pct = Math.min(value / max, 1);
  const radius = 56;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <svg viewBox="0 0 128 72" className="w-40 h-24" aria-hidden="true">
      <path
        d={`M 12 64 A ${radius} ${radius} 0 0 1 116 64`}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={`M 12 64 A ${radius} ${radius} 0 0 1 116 64`}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GrowthKPI() {
  const { toast } = useToast();
  const [selectedRange, setSelectedRange] = useState(TIME_RANGES[2]);

  // UTM builder state
  const [utmChannel, setUtmChannel] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmDestination, setUtmDestination] = useState("/upload-statement");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [linkHistory, setLinkHistory] = useState<GeneratedLink[]>(() => loadLinkHistory());

  const { data, isLoading } = useQuery<GrowthKPIData>({
    queryKey: ["/api/analytics/growth-kpi", selectedRange.weeks],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/growth-kpi?weeks=${selectedRange.weeks}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch growth KPI data");
      return res.json();
    },
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const selectedChannelConfig = UTM_CHANNELS.find(c => c.value === utmChannel);

  const handleGenerate = useCallback(async () => {
    if (!utmChannel) {
      toast({ title: "Select a channel", variant: "destructive" });
      return;
    }
    const cfg = UTM_CHANNELS.find(c => c.value === utmChannel);
    if (!cfg) return;

    const url = buildUTMUrl(cfg.value, cfg.medium, utmCampaign, utmDestination);
    setGeneratedUrl(url);

    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 2 });
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl("");
    }

    const newLink: GeneratedLink = {
      id: crypto.randomUUID(),
      channel: cfg.label,
      medium: cfg.medium,
      campaign: utmCampaign || "(none)",
      destination: utmDestination,
      url,
      createdAt: new Date().toISOString(),
    };

    const updated = [newLink, ...linkHistory].slice(0, MAX_HISTORY);
    setLinkHistory(updated);
    saveLinkHistory(updated);
  }, [utmChannel, utmCampaign, utmDestination, linkHistory, toast]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied to clipboard" });
    });
  };

  const thisWeekTotal = data?.thisWeekTotal ?? 0;
  const target = data?.target ?? 1000;
  const weekOverWeekChange = data?.weekOverWeekChange ?? 0;
  const targetPct = Math.round((thisWeekTotal / target) * 100);

  return (
    <div className="space-y-8" data-testid="growth-kpi-page">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Growth KPI Dashboard</h2>
          <p className="text-sm text-muted-foreground">Weekly signups by channel vs. 1,000/week target</p>
        </div>
        <div className="flex gap-2 flex-wrap" data-testid="time-range-toggle">
          {TIME_RANGES.map(range => (
            <Button
              key={range.weeks}
              size="sm"
              variant={selectedRange.weeks === range.weeks ? "default" : "outline"}
              onClick={() => setSelectedRange(range)}
              data-testid={`button-range-${range.weeks}w`}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Top KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Weekly Signup Arc */}
        <Card className="sm:col-span-1" data-testid="card-weekly-signups">
          <CardContent className="pt-6 flex flex-col items-center">
            <div className="relative">
              <ProgressArc value={thisWeekTotal} max={target} />
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mb-1" />
                ) : (
                  <span className="text-3xl font-bold leading-none" data-testid="text-this-week-total">{thisWeekTotal.toLocaleString()}</span>
                )}
                <span className="text-xs text-muted-foreground">of {target.toLocaleString()} / wk</span>
              </div>
            </div>
            <p className="text-sm font-medium mt-2">This Week's Signups</p>
            <div className="flex items-center gap-2 mt-1">
              {isLoading ? <Skeleton className="h-5 w-16" /> : <WeekOverWeekBadge change={weekOverWeekChange} />}
              <span className="text-xs text-muted-foreground">vs last week</span>
            </div>
          </CardContent>
        </Card>

        {/* Target Progress */}
        <Card data-testid="card-target-progress">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Target Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-10 w-24 mb-2" />
            ) : (
              <>
                <div className="text-3xl font-bold" data-testid="text-target-pct">{targetPct}%</div>
                <div className="w-full h-2 rounded-full bg-muted mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(targetPct, 100)}%` }}
                    data-testid="progress-target"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.max(target - thisWeekTotal, 0).toLocaleString()} signups to goal
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Week-over-week */}
        <Card data-testid="card-wow-trend">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {weekOverWeekChange >= 0
                ? <TrendingUp className="w-4 h-4 text-green-600" />
                : <TrendingDown className="w-4 h-4 text-destructive" />}
              Week-over-Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-10 w-20 mb-2" /> : (
              <>
                <div
                  className={`text-3xl font-bold ${weekOverWeekChange >= 0 ? "text-green-600" : "text-destructive"}`}
                  data-testid="text-wow-change"
                >
                  {weekOverWeekChange > 0 ? "+" : ""}{weekOverWeekChange}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  This week: {thisWeekTotal} · Last week: {data?.prevWeekTotal ?? 0}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Channel Breakdown Table ── */}
      <Card data-testid="card-channel-breakdown">
        <CardHeader>
          <CardTitle className="text-base">
            Channel Breakdown
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              — {selectedRange.label}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-channels">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Channel</th>
                  <th className="text-right px-3 py-3 font-medium text-muted-foreground" data-testid="th-current-period">
                    {selectedRange.weeks === 1 ? "This Week" : `Last ${selectedRange.weeks} Wks`}
                  </th>
                  <th className="text-right px-3 py-3 font-medium text-muted-foreground" data-testid="th-prev-period">
                    {selectedRange.weeks === 1 ? "Last Week" : `Prior ${selectedRange.weeks} Wks`}
                  </th>
                  <th className="text-right px-3 py-3 font-medium text-muted-foreground">Conv. Rate</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">8-wk Trend</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-3 py-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="px-3 py-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="px-3 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="px-4 py-3 text-right"><Skeleton className="h-8 w-20 ml-auto" /></td>
                    </tr>
                  ))
                  : (data?.channels ?? []).map(ch => {
                    const diff = ch.periodCount - ch.prevPeriodCount;
                    return (
                      <tr key={ch.channel} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-channel-${ch.channel}`}>
                        <td className="px-4 py-3 font-medium">{CHANNEL_LABELS[ch.channel] ?? ch.channel}</td>
                        <td className="px-3 py-3 text-right font-semibold" data-testid={`text-channel-period-${ch.channel}`}>{ch.periodCount}</td>
                        <td className="px-3 py-3 text-right text-muted-foreground" data-testid={`text-channel-prev-${ch.channel}`}>{ch.prevPeriodCount}</td>
                        <td className="px-3 py-3 text-right">
                          <Badge variant={ch.conversionRate > 0 ? "secondary" : "outline"} data-testid={`badge-channel-conv-${ch.channel}`}>
                            {ch.conversionRate}%
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {diff > 0
                              ? <span className="text-xs text-green-600 font-medium">+{diff}</span>
                              : diff < 0
                              ? <span className="text-xs text-destructive font-medium">{diff}</span>
                              : <span className="text-xs text-muted-foreground">—</span>}
                            <Sparkline data={ch.sparkline} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── UTM Link Builder ── */}
      <Card data-testid="card-utm-builder">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            UTM Campaign Link Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="utm-channel">Channel *</Label>
              <Select value={utmChannel} onValueChange={setUtmChannel}>
                <SelectTrigger id="utm-channel" data-testid="select-utm-channel">
                  <SelectValue placeholder="Select channel…" />
                </SelectTrigger>
                <SelectContent>
                  {UTM_CHANNELS.map(c => (
                    <SelectItem key={c.value} value={c.value} data-testid={`option-channel-${c.value}`}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="utm-medium">Medium (auto)</Label>
              <Input
                id="utm-medium"
                value={selectedChannelConfig?.medium ?? ""}
                readOnly
                className="bg-muted/40 text-muted-foreground"
                data-testid="input-utm-medium"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="utm-campaign">Campaign Name</Label>
              <Input
                id="utm-campaign"
                placeholder="e.g. june-outreach"
                value={utmCampaign}
                onChange={e => setUtmCampaign(e.target.value)}
                data-testid="input-utm-campaign"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="utm-destination">Destination Page</Label>
              <Select value={utmDestination} onValueChange={setUtmDestination}>
                <SelectTrigger id="utm-destination" data-testid="select-utm-destination">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATION_PAGES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={!utmChannel} data-testid="button-generate-utm">
            Generate Link
          </Button>

          {generatedUrl && (
            <div className="space-y-4" data-testid="utm-result">
              <div className="p-3 rounded-md bg-muted/50 font-mono text-sm break-all flex items-start gap-2">
                <span className="flex-1" data-testid="text-generated-url">{generatedUrl}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 h-7 w-7"
                  onClick={() => copyToClipboard(generatedUrl)}
                  aria-label="Copy URL"
                  data-testid="button-copy-generated-url"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>

              {qrDataUrl && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4" data-testid="qr-code-section">
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={qrDataUrl}
                      alt="QR code for generated UTM link"
                      className="w-32 h-32 rounded-md border"
                      data-testid="img-qr-code"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = qrDataUrl;
                        a.download = `qr-${utmChannel}-${Date.now()}.png`;
                        a.click();
                      }}
                      className="gap-1.5"
                      data-testid="button-download-qr"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Download QR
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Scan or print this QR code for offline/event use. Points to the same tagged URL.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Link History ── */}
      {linkHistory.length > 0 && (
        <Card data-testid="card-link-history">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              My Generated Links
              <Badge variant="secondary">{linkHistory.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-link-history">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Channel</th>
                    <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden sm:table-cell">Campaign</th>
                    <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden md:table-cell">Destination</th>
                    <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden lg:table-cell">Created</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {linkHistory.map(link => (
                    <tr key={link.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-link-${link.id}`}>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{link.channel}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground hidden sm:table-cell">{link.campaign}</td>
                      <td className="px-3 py-3 text-muted-foreground hidden md:table-cell">{link.destination}</td>
                      <td className="px-3 py-3 text-muted-foreground hidden lg:table-cell">{formatDate(link.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(link.url)}
                          className="gap-1.5 h-7"
                          data-testid={`button-copy-link-${link.id}`}
                          aria-label={`Copy link for ${link.channel}`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
