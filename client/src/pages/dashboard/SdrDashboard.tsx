import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SummaryCards } from "./sdr/SummaryCards";
import { FunnelVisualization } from "./sdr/FunnelVisualization";
import { StuckLeads } from "./sdr/StuckLeads";
import { ChannelHealth } from "./sdr/ChannelHealth";
import { ChatAnalytics } from "./sdr/ChatAnalytics";
import { DiscoveryDashboard } from "./sdr/DiscoveryDashboard";
import { ProcessorIntelligence } from "./sdr/ProcessorIntelligence";
import { SourceQualityDashboard } from "./sdr/SourceQualityDashboard";
import { IdentityHealthDashboard } from "./sdr/IdentityHealthDashboard";
import { MarketExpansionDashboard } from "./sdr/MarketExpansionDashboard";
import { WeeklyKpiReport } from "./sdr/WeeklyKpiReport";
import { AnomalyAlertsPanel } from "./sdr/AnomalyAlertsPanel";
import { SmsMetricsPanel } from "./sdr/SmsMetricsPanel";
import { VoiceAiStatusPanel } from "./sdr/VoiceAiStatusPanel";
import { SerperEnrichmentPanel } from "./sdr/SerperEnrichmentPanel";
import { DiscoveryControlsPanel } from "./sdr/DiscoveryControlsPanel";
import { LeadContactsPanel } from "./sdr/LeadContactsPanel";

export default function SdrDashboard() {
  return (
    <div className="space-y-6" data-testid="page-sdr-dashboard">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-sdr-title">AI SDR Dashboard</h2>
        <p className="text-muted-foreground">Autonomous lead development pipeline overview</p>
      </div>

      <Tabs defaultValue="summary" data-testid="tabs-sdr">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="summary" data-testid="tab-sdr-summary">Summary</TabsTrigger>
          <TabsTrigger value="discovery" data-testid="tab-sdr-discovery">Discovery</TabsTrigger>
          <TabsTrigger value="funnel" data-testid="tab-sdr-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="stuck" data-testid="tab-sdr-stuck">Stuck Leads</TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-sdr-channels">Channel Health</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-sdr-alerts">Anomaly Alerts</TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sdr-sms">SMS</TabsTrigger>
          <TabsTrigger value="enrichment" data-testid="tab-sdr-enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="voice" data-testid="tab-sdr-voice">Voice AI</TabsTrigger>
          <TabsTrigger value="nightlycontrols" data-testid="tab-sdr-nightlycontrols">Discovery Controls</TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-sdr-chat">Chat AI</TabsTrigger>
          <TabsTrigger value="processors" data-testid="tab-sdr-processors">Processor Intel</TabsTrigger>
          <TabsTrigger value="sources" data-testid="tab-sdr-sources">Source Quality</TabsTrigger>
          <TabsTrigger value="identity" data-testid="tab-sdr-identity">Inbox Health</TabsTrigger>
          <TabsTrigger value="market" data-testid="tab-sdr-market">Market Expansion</TabsTrigger>
          <TabsTrigger value="kpi" data-testid="tab-sdr-kpi">Weekly KPI</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-sdr-contacts">Lead Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryCards />
        </TabsContent>

        <TabsContent value="discovery" className="mt-4">
          <DiscoveryDashboard />
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <FunnelVisualization />
        </TabsContent>

        <TabsContent value="stuck" className="mt-4">
          <StuckLeads />
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <ChannelHealth />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <AnomalyAlertsPanel />
        </TabsContent>

        <TabsContent value="sms" className="mt-4">
          <SmsMetricsPanel />
        </TabsContent>

        <TabsContent value="enrichment" className="mt-4">
          <SerperEnrichmentPanel />
        </TabsContent>

        <TabsContent value="voice" className="mt-4">
          <VoiceAiStatusPanel />
        </TabsContent>

        <TabsContent value="nightlycontrols" className="mt-4">
          <DiscoveryControlsPanel />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatAnalytics />
        </TabsContent>

        <TabsContent value="processors" className="mt-4">
          <ProcessorIntelligence />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <SourceQualityDashboard />
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <IdentityHealthDashboard />
        </TabsContent>

        <TabsContent value="market" className="mt-4">
          <MarketExpansionDashboard />
        </TabsContent>

        <TabsContent value="kpi" className="mt-4">
          <WeeklyKpiReport />
        </TabsContent>

        <TabsContent value="contacts" className="mt-4">
          <LeadContactsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
