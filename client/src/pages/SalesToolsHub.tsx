import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

import {
  Calculator,
  BarChart3,
  ClipboardList,
  Upload,
  FileText,
  Monitor,
  DollarSign,
  Link2,
  Check,
  ExternalLink,
  ArrowRight,
  Zap,
} from "lucide-react";

const BASE_URL = "https://libertybancard.com";

interface SalesTool {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline";
  utmContent: string;
  audience: string;
}

const tools: SalesTool[] = [
  {
    id: "savings-calculator",
    title: "Savings Calculator",
    description: "Let prospects estimate how much they could save on processing fees. Enter monthly volume, current rate, and card mix to get a live savings estimate.",
    icon: Calculator,
    href: "/savings-calculator",
    badge: "Most Shared",
    badgeVariant: "default",
    utmContent: "savings-calculator",
    audience: "Merchants evaluating cost savings",
  },
  {
    id: "rate-comparison",
    title: "Rate Comparison Table",
    description: "Side-by-side comparison of Liberty Bancard vs Square, Stripe, Clover, and Toast. Covers pricing, features, contract terms, and support.",
    icon: BarChart3,
    href: "/compare-rates",
    utmContent: "rate-comparison",
    audience: "Merchants comparing processors",
  },
  {
    id: "beat-square-stripe",
    title: "Beat Square & Stripe",
    description: "Focused comparison of flat-rate pricing vs interchange-plus. Shows how most growing businesses overpay with Square and Stripe.",
    icon: Zap,
    href: "/beat-square-stripe",
    badge: "High Converting",
    badgeVariant: "secondary",
    utmContent: "beat-square-stripe",
    audience: "Current Square/Stripe users",
  },
  {
    id: "cost-quiz",
    title: "Processing Cost Quiz",
    description: "A 5-question quiz that helps merchants identify whether they're overpaying. Low-commitment entry point that leads to a statement upload.",
    icon: ClipboardList,
    href: "/quiz/processing-cost",
    utmContent: "cost-quiz",
    audience: "Cold prospects, early stage leads",
  },
  {
    id: "upload-statement",
    title: "Upload Statement",
    description: "Direct link to our statement upload form. Merchants upload their latest processing statement for a free, line-by-line cost analysis.",
    icon: Upload,
    badge: "Primary CTA",
    badgeVariant: "default",
    utmContent: "upload-statement",
    href: "/upload-statement",
    audience: "Warm leads ready to compare",
  },
  {
    id: "estimate",
    title: "Get a Free Estimate",
    description: "No statement? No problem. Merchants enter volume and industry to get an estimated rate range and a free custom quote.",
    icon: DollarSign,
    href: "/estimate",
    utmContent: "estimate",
    audience: "Prospects without a statement ready",
  },
  {
    id: "equipment",
    title: "Equipment Catalog",
    description: "Full catalog of available terminals — Clover Flex 3, Clover Mini, PAX A920, Dejavoo QD4, SwipeSimple, and more. Includes specs, best-fit guide, and request form.",
    icon: Monitor,
    href: "/shop",
    utmContent: "equipment",
    audience: "Merchants evaluating hardware options",
  },
  {
    id: "sales-onepager",
    title: "Industry One-Pagers",
    description: "Sales resources tailored by vertical — restaurant, retail, medical, auto, home services, and cash discount. Designed for agents to share with prospects.",
    icon: FileText,
    href: "/sales/one-pager",
    badge: "Agent Only",
    badgeVariant: "outline",
    utmContent: "sales-onepager",
    audience: "Used by reps during discovery",
  },
];

function CopyShareButton({ tool, className }: { tool: SalesTool; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareUrl = `${BASE_URL}${tool.href}?utm_source=agent&utm_medium=share&utm_content=${tool.utmContent}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    toast({ title: "Link copied!", description: `Sharing: ${tool.title}` });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={`gap-1.5 text-xs ${className ?? ""}`}
      onClick={handleCopy}
      data-testid={`button-share-${tool.id}`}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-green-500" />
          Link Copied!
        </>
      ) : (
        <>
          <Link2 className="w-3.5 h-3.5" />
          Copy Share Link
        </>
      )}
    </Button>
  );
}

function trackToolClick(tool: SalesTool) {
  apiRequest("POST", "/api/analytics/tool-click", {
    toolId: tool.id,
    toolTitle: tool.title,
    source: "sales-tools-hub",
  }).catch(() => {});
}

export default function SalesToolsHub() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Sales Tools Hub — Liberty Bancard"
        description="All merchant-facing sales tools in one place. Share calculator links, comparison pages, and conversion tools with prospects using UTM-tracked URLs."
        path="/sales-tools"
        noindex={false}
      />
      <Navbar />

      <main className="flex-grow pt-28 pb-20 md:pb-0">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
            <div className="max-w-2xl">
              <Badge variant="secondary" className="mb-4" data-testid="badge-sales-tools">
                Field Rep Resources
              </Badge>
              <h1
                className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white mb-4 leading-tight"
                data-testid="text-hub-heading"
              >
                Sales Tools Hub
              </h1>
              <p
                className="text-lg text-white/75 leading-relaxed"
                data-testid="text-hub-subheading"
              >
                All merchant-facing conversion tools in one place. Share links include UTM tracking so you can see which tools drive the most statement uploads.
              </p>
            </div>
          </div>
        </section>

        <section className="py-12 bg-background">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-tools-heading">
                  Merchant-Facing Tools
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Click "Copy Share Link" to get a UTM-tracked URL ready to paste in email, text, or chat.
                </p>
              </div>
              <span className="text-sm text-muted-foreground hidden sm:block">
                {tools.length} tools
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <Card
                    key={tool.id}
                    className="flex flex-col border border-border hover:border-primary/30 transition-colors duration-200"
                    data-testid={`card-tool-${tool.id}`}
                  >
                    <CardContent className="flex flex-col flex-1 p-5 gap-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5 text-primary" />
                        </div>
                        {tool.badge && (
                          <Badge variant={tool.badgeVariant} className="text-[10px] shrink-0">
                            {tool.badge}
                          </Badge>
                        )}
                      </div>

                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground mb-1.5 text-sm leading-snug" data-testid={`text-tool-title-${tool.id}`}>
                          {tool.title}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {tool.description}
                        </p>
                      </div>

                      <div className="text-[10px] text-muted-foreground/60 border-t border-border pt-3">
                        <span className="font-medium">Audience:</span> {tool.audience}
                      </div>

                      <div className="flex flex-col gap-2 pt-1">
                        <CopyShareButton tool={tool} />
                        <Link href={tool.href} data-testid={`link-open-tool-${tool.id}`} onClick={() => trackToolClick(tool)}>
                          <Button size="sm" className="w-full gap-1.5 text-xs">
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open Tool
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-12 bg-muted/30 border-t border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-lg font-display font-bold text-foreground mb-6" data-testid="text-quick-links-heading">
              Quick Links
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link href="/assets" data-testid="link-asset-library">
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-3 p-4">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-foreground">Asset Library</p>
                      <p className="text-xs text-muted-foreground">One-pagers, case studies, packets</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto shrink-0" />
                  </CardContent>
                </Card>
              </Link>
              <Link href="/upload-statement" data-testid="link-upload-statement-hub">
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Upload className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-foreground">Upload Statement</p>
                      <p className="text-xs text-muted-foreground">Start a merchant review</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto shrink-0" />
                  </CardContent>
                </Card>
              </Link>
              <Link href="/dashboard" data-testid="link-dashboard-hub">
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-3 p-4">
                    <BarChart3 className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-foreground">Agent Dashboard</p>
                      <p className="text-xs text-muted-foreground">CRM, pipeline, contacts</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
