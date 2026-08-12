import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RFI_CATEGORIES, RFI_STATUSES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Pencil, FileText } from "lucide-react";

const BLANK_FORM = {
  subject: "",
  description: "",
  category: "General",
  priority: "Normal",
  status: "Open",
  dueDate: "",
};

export default function RfiTab({ contactId }: { contactId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rfis = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/rfis", "contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/rfis?contactId=${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRfi, setEditingRfi] = useState<any | null>(null);
  const [form, setForm] = useState<typeof BLANK_FORM>({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openCreate = () => {
    setEditingRfi(null);
    setForm({ ...BLANK_FORM });
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (rfi: any) => {
    setEditingRfi(rfi);
    let dueDateStr = "";
    if (rfi.dueDate) {
      const d = new Date(rfi.dueDate);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        dueDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    setForm({
      subject: rfi.subject || "",
      description: rfi.description || "",
      category: rfi.category || "General",
      priority: rfi.priority || "Normal",
      status: rfi.status || "Open",
      dueDate: dueDateStr,
    });
    setErrors({});
    setDialogOpen(true);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.subject.trim()) errs.subject = "Subject is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const csrfToken = await getCsrfToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      };
      // Send explicit null for cleared optional fields so the server persists the clear.
      const payload = {
        contactId,
        subject: form.subject.trim(),
        description: form.description.trim() || null,
        category: form.category || null,
        priority: form.priority || null,
        status: form.status || null,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      };
      let res: Response;
      if (editingRfi) {
        res = await fetch(`/api/rfis/${editingRfi.id}`, {
          method: "PUT",
          credentials: "include",
          headers,
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/rfis", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      toast({ title: editingRfi ? "RFI updated" : "RFI created" });
      queryClient.invalidateQueries({ queryKey: ["/api/rfis", "contact", contactId] });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to save RFI", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const statusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    if (status === "Open") return "default";
    if (status === "In Progress") return "secondary";
    if (status === "Resolved") return "outline";
    if (status === "Closed") return "outline";
    return "secondary";
  };

  return (
    <div className="space-y-4" data-testid="rfi-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4" /> Requests for Information
        </h3>
        <Button size="sm" onClick={openCreate} data-testid="button-create-rfi">
          <Plus className="w-4 h-4 mr-1" /> New RFI
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading RFIs…
        </div>
      ) : rfis.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No RFIs on file. Click <strong>New RFI</strong> to create one.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table data-testid="table-rfis">
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfis.map((rfi: any) => (
                  <TableRow key={rfi.id} data-testid={`row-rfi-${rfi.id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate" title={rfi.subject}>
                      {rfi.subject}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{rfi.category || "—"}</TableCell>
                    <TableCell className="text-xs">{rfi.priority || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(rfi.status)} className="text-xs">
                        {rfi.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {rfi.dueDate ? new Date(rfi.dueDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(rfi)}
                        data-testid={`button-edit-rfi-${rfi.id}`}
                        title="Edit RFI"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent data-testid="dialog-rfi-form">
          <DialogHeader>
            <DialogTitle>{editingRfi ? "Edit RFI" : "Create RFI"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>
                Subject <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="Brief description of the request"
                data-testid="input-rfi-subject"
              />
              {errors.subject && (
                <p className="text-xs text-destructive" data-testid="error-rfi-subject">{errors.subject}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Details</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Full description or context…"
                rows={3}
                data-testid="input-rfi-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((p) => ({ ...p, category: v }))}>
                  <SelectTrigger data-testid="select-rfi-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(RFI_CATEGORIES as readonly string[]).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                  <SelectTrigger data-testid="select-rfi-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Low", "Normal", "High", "Urgent"].map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger data-testid="select-rfi-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(RFI_STATUSES as readonly string[]).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  data-testid="input-rfi-due-date"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-rfi">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} data-testid="button-save-rfi">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : (editingRfi ? "Save Changes" : "Create RFI")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
