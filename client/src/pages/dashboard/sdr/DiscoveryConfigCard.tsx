import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Settings, CheckCircle2, XCircle, Zap } from "lucide-react";

export interface SearchMatrixConfig {
  verticals: string[];
  metros: string[];
  dataSources: string[];
  state: string;
  limitPerSearch: number;
  enabled: boolean;
  schedule: string;
  dailyBudgetCap: number;
}

export interface SourceStatusData {
  serper: { configured: boolean; usage: any };
  outscraper: { configured: boolean; usage: any };
  apify: { configured: boolean; usage: any };
  apollo: { configured: boolean; usage: any };
}

interface Props {
  config: SearchMatrixConfig;
  sourceStatus: SourceStatusData | undefined;
  updateDataSources: (next: string[]) => void;
  apolloTestResult: { success: boolean; message: string } | null;
  setApolloTestResult: (v: { success: boolean; message: string } | null) => void;
  testApolloPending: boolean;
  onTestApollo: () => void;
}

export function DiscoveryConfigCard({ config, sourceStatus, updateDataSources, apolloTestResult, setApolloTestResult, testApolloPending, onTestApollo }: Props) {
  return (
    <Card data-testid="card-discovery-config">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Search Matrix Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium mb-2">Target Verticals</h4>
            <div className="flex flex-wrap gap-1.5">
              {config.verticals.map((v) => (
                <Badge key={v} variant="secondary" className="text-xs" data-testid={`badge-vertical-${v}`}>
                  {v}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Target Metros</h4>
            <div className="flex flex-wrap gap-1.5">
              {config.metros.map((m) => (
                <Badge key={m} variant="secondary" className="text-xs" data-testid={`badge-metro-${m}`}>
                  <MapPin className="w-3 h-3 mr-0.5" />
                  {m}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Data Sources</h4>
            <div className="flex flex-wrap gap-2">
              {["serper", "outscraper", "apify", "apollo"].map((s) => {
                const active = config.dataSources.includes(s);
                const srcStatus = sourceStatus?.[s as keyof SourceStatusData];
                return (
                  <button
                    key={s}
                    type="button"
                    data-testid={`btn-toggle-source-${s}`}
                    onClick={() => {
                      const next = active
                        ? config.dataSources.filter(x => x !== s)
                        : [...config.dataSources, s];
                      updateDataSources(next);
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors ${active ? "bg-primary/10 border-primary text-primary font-medium" : "bg-muted/50 border-muted text-muted-foreground"}`}
                  >
                    {active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    <span className="capitalize">{s}</span>
                    {!srcStatus?.configured && <span className="text-[10px] opacity-60">(no key)</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Click to enable/disable a source. Greyed sources require an API key.</p>
            <div className="mt-3 flex flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-fit text-xs h-7 px-2"
                data-testid="btn-test-apollo"
                disabled={testApolloPending}
                onClick={() => {
                  setApolloTestResult(null);
                  onTestApollo();
                }}
              >
                {testApolloPending ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Testing Apollo...</>
                ) : (
                  <><Zap className="w-3 h-3 mr-1" />Test Apollo Connection</>
                )}
              </Button>
              {apolloTestResult && (
                <p
                  data-testid="text-apollo-test-result"
                  className={`text-xs flex items-center gap-1 ${apolloTestResult.success ? "text-green-600" : "text-destructive"}`}
                >
                  {apolloTestResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {apolloTestResult.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Limit per search:</span>
              <span className="font-medium">{config.limitPerSearch}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Schedule:</span>
              <span className="font-medium">{config.schedule}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily budget cap:</span>
              <span className="font-medium">${config.dailyBudgetCap}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">State:</span>
              <span className="font-medium">{config.state}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
