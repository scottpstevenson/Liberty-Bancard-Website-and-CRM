import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, BarChart3, Cpu, Megaphone, PieChart } from "lucide-react";

interface ProcessorDistItem {
  vendor: string;
  count: number;
}

interface AdDistItem {
  platform: string;
  running: number;
  notRunning: number;
}

interface ConversionByProcessorItem {
  vendor: string;
  total: number;
  converted: number;
  conversionRate: number;
}

interface ProcessorIntelData {
  processorDistribution: ProcessorDistItem[];
  coverage: { total: number; detected: number; coverageRate: number };
  adDistribution: AdDistItem[];
  conversionByProcessor: ConversionByProcessorItem[];
}

export function ProcessorIntelligence() {
  const { data, isLoading } = useQuery<ProcessorIntelData>({
    queryKey: ["/api/sdr/processor-intelligence"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const coverage = data?.coverage || { total: 0, detected: 0, coverageRate: 0 };
  const processors = data?.processorDistribution || [];
  const adDist = data?.adDistribution || [];
  const totalProcessorDetections = processors.reduce((sum, p) => sum + p.count, 0);

  const VENDOR_COLORS: Record<string, string> = {
    Square: "bg-blue-500",
    Stripe: "bg-purple-500",
    Toast: "bg-orange-500",
    Clover: "bg-green-500",
    Shopify: "bg-emerald-500",
    PayPal: "bg-yellow-500",
    Mindbody: "bg-pink-500",
    Vagaro: "bg-indigo-500",
    Boulevard: "bg-teal-500",
    NCR: "bg-gray-500",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card data-testid="card-processor-coverage">
          <CardContent className="p-4 flex items-center gap-3">
            <PieChart className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-sm text-muted-foreground">Detection Coverage</div>
              <div className="text-xl font-bold" data-testid="value-processor-coverage">{coverage.coverageRate}%</div>
              <div className="text-xs text-muted-foreground">{coverage.detected} of {coverage.total} businesses</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-processor-detections">
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="w-5 h-5 text-purple-600" />
            <div>
              <div className="text-sm text-muted-foreground">Total Detections</div>
              <div className="text-xl font-bold" data-testid="value-processor-detections">{totalProcessorDetections}</div>
              <div className="text-xs text-muted-foreground">{processors.length} unique processors</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-ad-signals">
          <CardContent className="p-4 flex items-center gap-3">
            <Megaphone className="w-5 h-5 text-orange-600" />
            <div>
              <div className="text-sm text-muted-foreground">Running Ads</div>
              <div className="text-xl font-bold" data-testid="value-ads-running">{adDist.reduce((sum, a) => sum + a.running, 0)}</div>
              <div className="text-xs text-muted-foreground">{adDist.length} platforms tracked</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-processor-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Processor Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {processors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No processors detected yet. Run detection on businesses to populate this view.</p>
            ) : (
              <div className="space-y-3">
                {processors.map((p) => {
                  const pct = totalProcessorDetections > 0 ? Math.round((p.count / totalProcessorDetections) * 100) : 0;
                  return (
                    <div key={p.vendor} data-testid={`processor-row-${p.vendor.toLowerCase()}`}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{p.vendor}</span>
                        <span className="text-muted-foreground">{p.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${VENDOR_COLORS[p.vendor] || "bg-gray-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ad-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              Ad Platform Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {adDist.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No ad signals detected yet.</p>
            ) : (
              <div className="space-y-3">
                {adDist.map((a) => (
                  <div key={a.platform} className="p-3 bg-muted/50 rounded-lg" data-testid={`ad-row-${a.platform}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-medium capitalize">{a.platform}</span>
                      <div className="flex gap-2">
                        <Badge variant="default" data-testid={`badge-ads-running-${a.platform}`}>{a.running} running</Badge>
                        <Badge variant="outline">{a.notRunning} inactive</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(data?.conversionByProcessor || []).length > 0 && (
        <Card data-testid="card-conversion-by-processor">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Conversion Rate by Processor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.conversionByProcessor || []).map((c) => (
                <div key={c.vendor} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg" data-testid={`conversion-row-${c.vendor.toLowerCase()}`}>
                  <div>
                    <span className="font-medium">{c.vendor}</span>
                    <span className="text-sm text-muted-foreground ml-2">({c.total} leads)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{c.converted} converted</span>
                    <Badge variant={c.conversionRate >= 20 ? "default" : "outline"} data-testid={`badge-conversion-${c.vendor.toLowerCase()}`}>
                      {c.conversionRate}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-switchable-targets">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Top Switchable Targets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {processors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No data available yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {processors.filter(p => ["Square", "Stripe", "Toast", "Clover", "PayPal", "Shopify"].includes(p.vendor)).map((p) => (
                <div key={p.vendor} className="p-3 bg-muted/50 rounded-lg text-center" data-testid={`switchable-target-${p.vendor.toLowerCase()}`}>
                  <div className="text-lg font-bold">{p.count}</div>
                  <div className="text-sm text-muted-foreground">{p.vendor}</div>
                  <Badge variant="outline" className="mt-1 text-xs">Switchable</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
