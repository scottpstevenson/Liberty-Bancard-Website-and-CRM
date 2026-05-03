import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mic } from "lucide-react";

export function VoiceAiStatusPanel() {
  const { data, isLoading } = useQuery<{
    voiceAiEnabled: boolean;
    configuredScripts: Array<{
      verticalKey: string;
      verticalLabel: string;
      hasOpening: boolean;
      hasQualifyingQuestions: boolean;
      hasObjectionHandlers: boolean;
      hasComplianceDisclosure: boolean;
    }>;
    totalScripts: number;
    readyForActivation: boolean;
  }>({
    queryKey: ["/api/sdr/voice-ai/status"],
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4" data-testid="panel-voice-ai">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-voice-status">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Voice AI</span>
            </div>
            <Badge className={data?.voiceAiEnabled
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }>
              {data?.voiceAiEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
        <Card data-testid="card-voice-scripts">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Configured Scripts</div>
            <div className="text-xl font-bold">{data?.totalScripts || 0}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-voice-ready">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Ready for Activation</div>
            <Badge className={data?.readyForActivation
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
            }>
              {data?.readyForActivation ? "Ready" : "Not Ready"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {data?.configuredScripts && data.configuredScripts.length > 0 && (
        <Card data-testid="card-voice-script-list">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Script Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.configuredScripts.map((script) => (
                <div key={script.verticalKey} className="flex items-center justify-between p-2 rounded border" data-testid={`voice-script-${script.verticalKey}`}>
                  <span className="text-sm font-medium">{script.verticalLabel}</span>
                  <div className="flex items-center gap-2">
                    {script.hasOpening && <Badge variant="outline" className="text-xs">Opening</Badge>}
                    {script.hasQualifyingQuestions && <Badge variant="outline" className="text-xs">Questions</Badge>}
                    {script.hasObjectionHandlers && <Badge variant="outline" className="text-xs">Objections</Badge>}
                    {script.hasComplianceDisclosure && <Badge variant="outline" className="text-xs">Compliance</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!data?.voiceAiEnabled && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-voice-disabled">
            <Mic className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="font-medium">Voice AI is not enabled</div>
            <div className="text-xs mt-1">Set VOICE_AI_ENABLED=true to activate voice calling</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
