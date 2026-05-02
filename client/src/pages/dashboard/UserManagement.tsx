import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, ShieldCheck, ShieldOff, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  authProvider: string | null;
  emailVerified: string | null;
  totpEnabled: boolean | null;
  permissions: string[] | null;
  createdAt: string | null;
}

interface MfaSettings {
  mfaRequired: boolean;
}

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [togglingVtId, setTogglingVtId] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: mfaSettings } = useQuery<MfaSettings>({
    queryKey: ["/api/admin/mfa-settings"],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const res = await apiRequest("PUT", `/api/admin/users/${id}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role updated", description: "User role has been changed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMfaRequiredMutation = useMutation({
    mutationFn: async (required: boolean) => {
      const res = await apiRequest("PUT", "/api/admin/mfa-settings", { mfaRequired: required });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/admin/mfa-settings"], data);
      toast({
        title: data.mfaRequired ? "MFA Required" : "MFA Optional",
        description: data.mfaRequired
          ? "All users will be required to set up 2FA on next login."
          : "2FA is now optional for users.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleVtPermissionMutation = useMutation({
    mutationFn: async ({ id, permissions }: { id: string; permissions: string[] }) => {
      const res = await apiRequest("PUT", `/api/admin/users/${id}/permissions`, { permissions });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setTogglingVtId(null);
      toast({ title: "Permission Updated", description: "Virtual Terminal access has been updated." });
    },
    onError: (error: Error) => {
      setTogglingVtId(null);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetMfaMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/reset-2fa`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setResettingId(null);
      toast({ title: "2FA Reset", description: "Two-factor authentication has been removed for this user." });
    },
    onError: (error: Error) => {
      setResettingId(null);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (user?.role !== "admin") {
    return (
      <Card data-testid="card-access-denied">
        <CardContent className="p-6">
          <p className="text-muted-foreground" data-testid="text-access-denied">You do not have permission to view this page.</p>
        </CardContent>
      </Card>
    );
  }

  const roleBadgeVariant = (role: string | null) => {
    switch (role) {
      case "admin": return "destructive" as const;
      case "manager": return "default" as const;
      case "agent": return "secondary" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="space-y-6" data-testid="page-user-management">
      <Card data-testid="card-mfa-enforcement">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Security Enforcement
          </CardTitle>
          <CardDescription>Require all users to enable two-factor authentication.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Switch
              id="require-mfa"
              checked={mfaSettings?.mfaRequired ?? false}
              onCheckedChange={(checked) => toggleMfaRequiredMutation.mutate(checked)}
              disabled={toggleMfaRequiredMutation.isPending}
              data-testid="switch-require-mfa"
            />
            <Label htmlFor="require-mfa" className="text-sm font-normal cursor-pointer">
              Require 2FA for all users
              {mfaSettings?.mfaRequired && (
                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                  — Users without 2FA will be prompted to enroll on next login
                </span>
              )}
            </Label>
            {toggleMfaRequiredMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-user-management">
        <CardHeader>
          <CardTitle data-testid="text-user-management-title">User Management</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3" data-testid="skeleton-loading">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table data-testid="table-users">
              <TableHeader>
                <TableRow>
                  <TableHead data-testid="th-name">Name</TableHead>
                  <TableHead data-testid="th-email">Email</TableHead>
                  <TableHead data-testid="th-role">Role</TableHead>
                  <TableHead data-testid="th-auth-provider">Auth Provider</TableHead>
                  <TableHead data-testid="th-email-verified">Email Verified</TableHead>
                  <TableHead data-testid="th-2fa">2FA</TableHead>
                  <TableHead data-testid="th-vt">Virtual Terminal</TableHead>
                  <TableHead data-testid="th-joined">Joined</TableHead>
                  <TableHead data-testid="th-actions">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                    <TableCell data-testid={`text-name-${u.id}`}>
                      {u.firstName || ""} {u.lastName || ""}
                    </TableCell>
                    <TableCell data-testid={`text-email-${u.id}`}>
                      {u.email || "-"}
                    </TableCell>
                    <TableCell data-testid={`cell-role-${u.id}`}>
                      <Select
                        value={u.role || "merchant"}
                        onValueChange={(value) => updateRoleMutation.mutate({ id: u.id, role: value })}
                        disabled={u.id === user?.id || updateRoleMutation.isPending}
                      >
                        <SelectTrigger className="w-32" data-testid={`select-role-${u.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin" data-testid={`option-admin-${u.id}`}>Admin</SelectItem>
                          <SelectItem value="manager" data-testid={`option-manager-${u.id}`}>Manager</SelectItem>
                          <SelectItem value="agent" data-testid={`option-agent-${u.id}`}>Agent</SelectItem>
                          <SelectItem value="merchant" data-testid={`option-merchant-${u.id}`}>Merchant</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell data-testid={`text-auth-provider-${u.id}`}>
                      <Badge variant="outline" className="text-xs">
                        {u.authProvider || "local"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-verified-${u.id}`}>
                      <Badge variant={u.emailVerified ? "default" : "secondary"} className="text-xs">
                        {u.emailVerified ? "Verified" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`cell-2fa-${u.id}`}>
                      {u.totpEnabled ? (
                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <ShieldCheck className="w-4 h-4" />
                          <span className="text-xs font-medium">On</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <ShieldOff className="w-4 h-4" />
                          <span className="text-xs">Off</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-testid={`cell-vt-${u.id}`}>
                      {u.role === "admin" || u.role === "manager" ? (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Always On</Badge>
                      ) : (
                        <Switch
                          checked={(u.permissions || []).includes("virtual_terminal")}
                          disabled={togglingVtId === u.id || toggleVtPermissionMutation.isPending}
                          onCheckedChange={(checked) => {
                            setTogglingVtId(u.id);
                            const current = u.permissions || [];
                            const updated = checked
                              ? [...current.filter((p) => p !== "virtual_terminal"), "virtual_terminal"]
                              : current.filter((p) => p !== "virtual_terminal");
                            toggleVtPermissionMutation.mutate({ id: u.id, permissions: updated });
                          }}
                          data-testid={`switch-vt-${u.id}`}
                        />
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-joined-${u.id}`}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell data-testid={`cell-actions-${u.id}`}>
                      {u.totpEnabled && u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setResettingId(u.id);
                            resetMfaMutation.mutate(u.id);
                          }}
                          disabled={resettingId === u.id}
                          className="text-xs h-7"
                          data-testid={`button-reset-2fa-${u.id}`}
                        >
                          {resettingId === u.id ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="w-3 h-3 mr-1" />
                          )}
                          Reset 2FA
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(!users || users.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground" data-testid="text-no-users">
                      No users found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
