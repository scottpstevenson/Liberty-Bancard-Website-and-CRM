import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  authProvider: string | null;
  emailVerified: string | null;
  createdAt: string | null;
}

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
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
                  <TableHead data-testid="th-joined">Joined</TableHead>
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
                    <TableCell data-testid={`text-joined-${u.id}`}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                {(!users || users.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground" data-testid="text-no-users">
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
