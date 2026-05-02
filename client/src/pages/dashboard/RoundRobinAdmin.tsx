import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus, Trash2, Pause, Play, RotateCcw, Users, ArrowRightLeft, ClipboardList } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface RoundRobinRep {
  userId: string;
  name: string;
  email: string;
  paused: boolean;
  assignedCount: number;
}

interface RoundRobinPool {
  reps: RoundRobinRep[];
  currentIndex: number;
  enabled: boolean;
  log: Array<{
    contactId: number;
    contactName: string;
    assignedTo: string;
    assignedName: string;
    assignedAt: string;
  }>;
}

export default function RoundRobinAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newRep, setNewRep] = useState({ userId: "", name: "", email: "" });

  const { data: pool, isLoading } = useQuery<RoundRobinPool>({
    queryKey: ["/api/admin/round-robin"],
    refetchInterval: 30000,
  });

  const { data: adminUsers } = useQuery<Array<{ id: string; email: string | null; firstName: string | null; lastName: string | null }>>({
    queryKey: ["/api/admin/users"],
  });

  const { data: logData } = useQuery<{ log: RoundRobinPool["log"] }>({
    queryKey: ["/api/admin/round-robin/log"],
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/admin/round-robin", { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/round-robin"] });
      toast({ title: pool?.enabled ? "Round-robin disabled" : "Round-robin enabled" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addRepMutation = useMutation({
    mutationFn: async (rep: { userId: string; name: string; email: string }) => {
      const res = await apiRequest("POST", "/api/admin/round-robin/rep", rep);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/round-robin"] });
      setNewRep({ userId: "", name: "", email: "" });
      toast({ title: "Rep added to rotation" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const togglePauseMutation = useMutation({
    mutationFn: async ({ userId, paused }: { userId: string; paused: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/round-robin/rep/${userId}`, { paused });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/round-robin"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeRepMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/round-robin/rep/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/round-robin"] });
      toast({ title: "Rep removed from rotation" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!["admin", "manager"].includes(user?.role || "")) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Admin or Manager access required.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const reps = pool?.reps || [];
  const log = logData?.log || [];
  const activeCount = reps.filter((r) => !r.paused).length;

  const handleAddRep = () => {
    if (!newRep.userId || !newRep.name) {
      toast({ title: "userId and name are required", variant: "destructive" });
      return;
    }
    addRepMutation.mutate(newRep);
  };

  const handleSelectUser = (userId: string) => {
    const u = adminUsers?.find((u) => u.id === userId);
    if (u) {
      setNewRep({
        userId: u.id,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || u.id,
        email: u.email || "",
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="page-round-robin">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6" />
            Round-Robin Lead Assignment
          </h2>
          <p className="text-muted-foreground text-sm">
            Auto-assign new inbound contacts to reps in rotation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {pool?.enabled ? "Active" : "Disabled"}
          </span>
          <Switch
            checked={pool?.enabled ?? false}
            onCheckedChange={(val) => toggleEnabledMutation.mutate(val)}
            disabled={toggleEnabledMutation.isPending}
            data-testid="switch-round-robin-enabled"
          />
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="stat-rr-total-reps">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Total Reps</p>
            <p className="text-2xl font-bold">{reps.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-rr-active-reps">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Play className="w-3 h-3" /> Active</p>
            <p className="text-2xl font-bold text-green-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-rr-paused-reps">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Pause className="w-3 h-3" /> Paused</p>
            <p className="text-2xl font-bold text-amber-600">{reps.length - activeCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-rr-total-assigned">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Assigned</p>
            <p className="text-2xl font-bold">{log.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Assignment Pool */}
      <Card data-testid="card-assignment-pool">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Assignment Pool
          </CardTitle>
          <CardDescription>
            Reps are assigned leads in order. Pause a rep to skip them (e.g. vacation mode).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No reps in pool yet. Add reps below to start auto-assigning leads.
            </p>
          ) : (
            <Table data-testid="table-rep-pool">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reps.map((rep, idx) => (
                  <TableRow key={rep.userId} data-testid={`row-rep-${rep.userId}`} className={idx === (pool?.currentIndex || 0) % Math.max(activeCount, 1) && !rep.paused ? "bg-green-50 dark:bg-green-950/20" : ""}>
                    <TableCell className="font-medium">{rep.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{rep.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{rep.assignedCount || 0}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rep.paused ? "secondary" : "default"} className="text-xs">
                        {rep.paused ? "Paused" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => togglePauseMutation.mutate({ userId: rep.userId, paused: !rep.paused })}
                          disabled={togglePauseMutation.isPending}
                          data-testid={`button-toggle-pause-${rep.userId}`}
                        >
                          {rep.paused ? <Play className="w-3 h-3 mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                          {rep.paused ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive"
                          onClick={() => removeRepMutation.mutate(rep.userId)}
                          disabled={removeRepMutation.isPending}
                          data-testid={`button-remove-rep-${rep.userId}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Add rep form */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Add Rep to Pool</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-1">
                <Label htmlFor="rr-user-id" className="text-xs mb-1 block">User ID</Label>
                <div className="flex gap-2">
                  <Input
                    id="rr-user-id"
                    placeholder="User ID"
                    value={newRep.userId}
                    onChange={(e) => setNewRep((p) => ({ ...p, userId: e.target.value }))}
                    className="h-8 text-sm"
                    data-testid="input-rep-user-id"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="rr-name" className="text-xs mb-1 block">Name</Label>
                <Input
                  id="rr-name"
                  placeholder="Full name"
                  value={newRep.name}
                  onChange={(e) => setNewRep((p) => ({ ...p, name: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-rep-name"
                />
              </div>
              <div>
                <Label htmlFor="rr-email" className="text-xs mb-1 block">Email</Label>
                <Input
                  id="rr-email"
                  type="email"
                  placeholder="Email (optional)"
                  value={newRep.email}
                  onChange={(e) => setNewRep((p) => ({ ...p, email: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-rep-email"
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleAddRep}
                  disabled={addRepMutation.isPending || !newRep.userId || !newRep.name}
                  className="h-8 w-full"
                  data-testid="button-add-rep"
                >
                  {addRepMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <UserPlus className="w-3 h-3 mr-1" />}
                  Add
                </Button>
              </div>
            </div>
            {adminUsers && adminUsers.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-2">Or pick from existing users:</p>
                <div className="flex flex-wrap gap-2">
                  {adminUsers.slice(0, 10).map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleSelectUser(u.id)}
                      className="text-xs px-2 py-1 rounded border bg-muted/50 hover:bg-muted transition-colors"
                      data-testid={`button-select-user-${u.id}`}
                    >
                      {u.firstName} {u.lastName} ({u.email})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Assignment Log */}
      <Card data-testid="card-assignment-log">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Assignment Log
          </CardTitle>
          <CardDescription>Recent lead assignments (last 200 entries)</CardDescription>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No assignments logged yet. When round-robin is enabled and a new contact is created, assignments appear here.
            </p>
          ) : (
            <Table data-testid="table-assignment-log">
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.slice(0, 50).map((entry, idx) => (
                  <TableRow key={idx} data-testid={`row-log-${idx}`}>
                    <TableCell className="text-sm">{entry.contactName}</TableCell>
                    <TableCell className="text-sm font-medium">{entry.assignedName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(entry.assignedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
