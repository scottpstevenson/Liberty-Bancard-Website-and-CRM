import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Database } from "lucide-react";
import type { DataDeleteRequest } from "@shared/schema";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow-500 text-black" },
  processing: { label: "Processing", className: "bg-blue-600 text-white" },
  completed: { label: "Completed", className: "bg-green-600 text-white" },
  denied: { label: "Denied", className: "bg-red-600 text-white" },
};

export default function DataRequests() {
  const { toast } = useToast();

  const { data: requests, isLoading } = useQuery<DataDeleteRequest[]>({
    queryKey: ["/api/data-requests"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PUT", `/api/data-requests/${id}`, {
        status,
        processedAt: status === "completed" || status === "denied" ? new Date().toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-requests"] });
      toast({ title: "Status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="page-data-requests">
      <div className="flex flex-wrap items-center gap-3">
        <Database className="w-6 h-6 text-foreground" />
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-data-requests-heading">
          Data Requests
        </h1>
        <Badge variant="secondary" data-testid="badge-data-requests-count">
          {requests?.length || 0} total
        </Badge>
      </div>

      <Card data-testid="card-data-requests-table">
        <CardContent className="pt-6">
          {!requests || requests.length === 0 ? (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-requests">
              No data requests yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-data-requests">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Request Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((req) => {
                    const config = STATUS_CONFIG[req.status || "pending"] || STATUS_CONFIG.pending;
                    return (
                      <TableRow key={req.id} data-testid={`row-data-request-${req.id}`}>
                        <TableCell className="whitespace-nowrap text-sm" data-testid={`text-request-date-${req.id}`}>
                          {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "N/A"}
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-request-name-${req.id}`}>
                          {req.fullName}
                        </TableCell>
                        <TableCell data-testid={`text-request-email-${req.id}`}>
                          {req.email}
                        </TableCell>
                        <TableCell data-testid={`text-request-type-${req.id}`}>
                          {req.requestType}
                        </TableCell>
                        <TableCell>
                          <Badge className={config.className} data-testid={`badge-request-status-${req.id}`}>
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={req.status || "pending"}
                            onValueChange={(value) => updateMutation.mutate({ id: req.id, status: value })}
                          >
                            <SelectTrigger className="w-[140px]" data-testid={`select-request-action-${req.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="processing">Processing</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="denied">Denied</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
