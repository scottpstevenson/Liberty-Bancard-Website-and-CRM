import { lazy, Suspense } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from "./UserManagement";
import Permissions from "./Permissions";
import AuditLogs from "./AuditLogs";
import ConsentAudit from "./ConsentAudit";
import PciAssessment from "./PciAssessment";

const InformationFlow = lazy(() => import("./InformationFlow"));
const PreDeployGateResult = lazy(() => import("./PreDeployGateResult"));

export default function AdminHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const validTabs = isAdmin
    ? ["users", "permissions", "audit-log", "consent", "pci", "info-flow", "gate-result"]
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
        {isAdmin && <TabsTrigger value="info-flow" data-testid="tab-admin-info-flow">Information Flow</TabsTrigger>}
        {isAdmin && <TabsTrigger value="gate-result" data-testid="tab-admin-gate-result">Deploy Gate</TabsTrigger>}
      </TabsList>
      {isAdmin && <TabsContent value="users"><UserManagement /></TabsContent>}
      {isAdmin && <TabsContent value="permissions"><Permissions /></TabsContent>}
      {isAdmin && <TabsContent value="audit-log"><AuditLogs /></TabsContent>}
      <TabsContent value="consent"><ConsentAudit /></TabsContent>
      <TabsContent value="pci"><PciAssessment /></TabsContent>
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
    </Tabs>
  );
}
