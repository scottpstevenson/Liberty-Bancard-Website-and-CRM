import { lazy, Suspense } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from "./UserManagement";
import Permissions from "./Permissions";
import AuditLogs from "./AuditLogs";
import ConsentAudit from "./ConsentAudit";
import PciAssessment from "./PciAssessment";
import AgentManagement from "./AgentManagement";

const InformationFlow = lazy(() => import("./InformationFlow"));
const PreDeployGateResult = lazy(() => import("./PreDeployGateResult"));
const AutomationRegistry = lazy(() => import("./AutomationRegistry"));
const SettingsIntegrations = lazy(() => import("./SettingsIntegrations"));
const GhlIntegrationHub = lazy(() => import("./GhlIntegrationHub"));

export default function AdminHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isPrivileged = isAdmin || user?.role === "manager";

  const validTabs = isAdmin
    ? ["users", "permissions", "audit-log", "consent", "pci", "agents", "integrations", "ghl", "info-flow", "gate-result", "automations"]
    : isPrivileged
    ? ["consent", "pci", "agents", "integrations", "ghl"]
    : ["consent", "pci"];

  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab") ?? "";
  const tab = validTabs.includes(raw) ? raw : validTabs[0];
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/admin-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1">
        {isAdmin && <TabsTrigger value="users" data-testid="tab-admin-users">User Management</TabsTrigger>}
        {isAdmin && <TabsTrigger value="permissions" data-testid="tab-admin-permissions">Permissions</TabsTrigger>}
        {isAdmin && <TabsTrigger value="audit-log" data-testid="tab-admin-audit-log">Audit Log</TabsTrigger>}
        <TabsTrigger value="consent" data-testid="tab-admin-consent">Consent Audit</TabsTrigger>
        <TabsTrigger value="pci" data-testid="tab-admin-pci">PCI Assessment</TabsTrigger>
        {isPrivileged && <TabsTrigger value="agents" data-testid="tab-admin-agents">Agent Management</TabsTrigger>}
        {isPrivileged && <TabsTrigger value="integrations" data-testid="tab-admin-integrations">Integrations</TabsTrigger>}
        {isPrivileged && <TabsTrigger value="ghl" data-testid="tab-admin-ghl">GHL Integration</TabsTrigger>}
        {isAdmin && <TabsTrigger value="info-flow" data-testid="tab-admin-info-flow">Information Flow</TabsTrigger>}
        {isAdmin && <TabsTrigger value="gate-result" data-testid="tab-admin-gate-result">Deploy Gate</TabsTrigger>}
        {isAdmin && <TabsTrigger value="automations" data-testid="tab-admin-automations">Automations</TabsTrigger>}
      </TabsList>
      {isAdmin && <TabsContent value="users"><UserManagement /></TabsContent>}
      {isAdmin && <TabsContent value="permissions"><Permissions /></TabsContent>}
      {isAdmin && <TabsContent value="audit-log"><AuditLogs /></TabsContent>}
      <TabsContent value="consent"><ConsentAudit /></TabsContent>
      <TabsContent value="pci"><PciAssessment /></TabsContent>
      {isPrivileged && (
        <TabsContent value="agents"><AgentManagement /></TabsContent>
      )}
      {isPrivileged && (
        <TabsContent value="integrations">
          <Suspense fallback={<div className="py-12 text-center text-muted-foreground animate-pulse">Loading…</div>}>
            <SettingsIntegrations />
          </Suspense>
        </TabsContent>
      )}
      {isPrivileged && (
        <TabsContent value="ghl">
          <Suspense fallback={<div className="py-12 text-center text-muted-foreground animate-pulse">Loading…</div>}>
            <GhlIntegrationHub />
          </Suspense>
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="info-flow">
          <Suspense fallback={<div className="py-12 text-center text-muted-foreground animate-pulse">Loading…</div>}>
            <InformationFlow />
          </Suspense>
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="gate-result">
          <Suspense fallback={<div className="py-12 text-center text-muted-foreground animate-pulse">Loading…</div>}>
            <PreDeployGateResult />
          </Suspense>
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="automations">
          <Suspense fallback={<div className="py-12 text-center text-muted-foreground animate-pulse">Loading…</div>}>
            <AutomationRegistry />
          </Suspense>
        </TabsContent>
      )}
    </Tabs>
  );
}
