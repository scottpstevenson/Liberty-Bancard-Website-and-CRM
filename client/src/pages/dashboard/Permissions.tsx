import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useState, useMemo } from "react";

interface RoutePermission {
  method: string;
  path: string;
  requiredRoles: string[];
}

interface RoutePermissionsResponse {
  routes: RoutePermission[];
}

const methodColor = (m: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (m) {
    case "GET": return "secondary";
    case "POST": return "default";
    case "PUT":
    case "PATCH": return "outline";
    case "DELETE": return "destructive";
    default: return "outline";
  }
};

const roleBadge = (role: string): "default" | "secondary" | "destructive" | "outline" => {
  if (role === "admin") return "destructive";
  if (role === "manager") return "default";
  if (role === "any-authenticated") return "secondary";
  if (role === "public") return "outline";
  return "secondary";
};

export default function Permissions() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("");

  const { data, isLoading } = useQuery<RoutePermissionsResponse>({
    queryKey: ["/api/admin/route-permissions"],
  });

  const filtered = useMemo(() => {
    const routes = data?.routes ?? [];
    if (!filter.trim()) return routes;
    const q = filter.toLowerCase();
    return routes.filter(
      (r) =>
        r.path.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q) ||
        r.requiredRoles.some((role) => role.toLowerCase().includes(q))
    );
  }, [data, filter]);

  if (user?.role !== "admin") {
    return (
      <Card data-testid="card-access-denied">
        <CardContent className="p-6">
          <p className="text-muted-foreground" data-testid="text-access-denied">
            You do not have permission to view this page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-permissions">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-permissions-title">Permissions Audit</CardTitle>
          <CardDescription>
            Auto-generated from the live Express route table. Each row shows the role(s) required to call that endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Filter by path, method, or role..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-4 max-w-md"
            data-testid="input-filter-permissions"
          />
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="border rounded-md">
              <Table data-testid="table-permissions">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24" data-testid="th-method">Method</TableHead>
                    <TableHead data-testid="th-path">Path</TableHead>
                    <TableHead data-testid="th-roles">Required Role(s)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => (
                    <TableRow key={`${r.method}-${r.path}-${i}`} data-testid={`row-route-${i}`}>
                      <TableCell data-testid={`text-method-${i}`}>
                        <Badge variant={methodColor(r.method)} className="text-xs font-mono">
                          {r.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-path-${i}`}>
                        {r.path}
                      </TableCell>
                      <TableCell data-testid={`cell-roles-${i}`}>
                        <div className="flex flex-wrap gap-1">
                          {r.requiredRoles.map((role) => (
                            <Badge key={role} variant={roleBadge(role)} className="text-xs">
                              {role}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground" data-testid="text-no-routes">
                        No routes match the filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {data && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="text-route-count">
              Showing {filtered.length} of {data.routes.length} registered API routes.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
