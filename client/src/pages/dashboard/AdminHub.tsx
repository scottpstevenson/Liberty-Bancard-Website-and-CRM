import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from "./UserManagement";
import Permissions from "./Permissions";
import AuditLogs from "./AuditLogs";
import ConsentAudit from "./ConsentAudit";
import PciAssessment from "./PciAssessment";

export default function AdminHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const validTabs = isAdmin
    ? ["users", "permissions", "audit-log", "consent", "pci"]
    : ["consent", "pci"];

  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab = validTabs.includes(raw) ? raw : validTabs[0];
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/admin-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        {isAdmin && <TabsTrigger value="users" data-testid="tab-admin-users">User Management</TabsTrigger>}
        {isAdmin && <TabsTrigger value="permissions" data-testid="tab-admin-permissions">Permissions</TabsTrigger>}
        {isAdmin && <TabsTrigger value="audit-log" data-testid="tab-admin-audit-log">Audit Log</TabsTrigger>}
        <TabsTrigger value="consent" data-testid="tab-admin-consent">Consent Audit</TabsTrigger>
        <TabsTrigger value="pci" data-testid="tab-admin-pci">PCI Assessment</TabsTrigger>
      </TabsList>
      {isAdmin && <TabsContent value="users"><UserManagement /></TabsContent>}
      {isAdmin && <TabsContent value="permissions"><Permissions /></TabsContent>}
      {isAdmin && <TabsContent value="audit-log"><AuditLogs /></TabsContent>}
      <TabsContent value="consent"><ConsentAudit /></TabsContent>
      <TabsContent value="pci"><PciAssessment /></TabsContent>
    </Tabs>
  );
}
