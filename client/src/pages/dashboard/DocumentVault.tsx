import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DOCUMENT_CATEGORIES } from "@shared/schema";
import type { Document, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen, Search, Download, Trash2, Filter, FileText,
  FileImage, File, Calendar, User, Building2, ExternalLink,
  CheckCircle2, XCircle, Clock, Archive, Package,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function getCategoryColor(category: string | null | undefined): string {
  switch (category) {
    case "Application": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "Voided Check": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "Photo ID": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "Bank Statement": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "EIN Letter": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "Signed Proposal": return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200";
    case "Processing Statement": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function getStatusInfo(status: string | null | undefined): { label: string; className: string; icon: typeof Clock } {
  switch (status) {
    case "approved": return { label: "Approved", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle2 };
    case "rejected": return { label: "Rejected", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: XCircle };
    case "archived": return { label: "Archived", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: Archive };
    default: return { label: "Pending", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: Clock };
  }
}

function FileIcon({ mimeType }: { mimeType: string | null | undefined }) {
  if (!mimeType) return <File className="h-5 w-5 text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

type DocumentWithContact = Document & { contactName?: string; companyName?: string };

export default function DocumentVault() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const { data: docs = [], isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ["/api/merchant-documents", categoryFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/merchant-documents?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const { data: contactsRes } = useQuery<{ data: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
  });
  const contacts = contactsRes?.data ?? [];
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  const enrichedDocs: DocumentWithContact[] = docs.map(doc => {
    const contact = doc.contactId ? contactMap.get(doc.contactId) : undefined;
    return {
      ...doc,
      contactName: contact ? `${contact.firstName} ${contact.lastName}` : undefined,
      companyName: contact?.companyName || undefined,
    };
  });

  const filtered = enrichedDocs.filter(doc => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      doc.fileName.toLowerCase().includes(q) ||
      (doc.contactName?.toLowerCase().includes(q)) ||
      (doc.companyName?.toLowerCase().includes(q)) ||
      (doc.category?.toLowerCase().includes(q)) ||
      (doc.uploadedBy?.toLowerCase().includes(q))
    );
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/merchant-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      setDeleteTarget(null);
      toast({ title: "Document deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete document", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/merchant-documents/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      toast({ title: "Document status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const categoryCount: Record<string, number> = {};
  docs.forEach(d => {
    const cat = d.category || "Other";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every(d => selectedIds.has(d.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(d => d.id)));
    }
  }

  function toggleSelectDoc(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDownload() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setIsBulkDownloading(true);
    try {
      const res = await fetch("/api/documents/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Download failed" }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `documents_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Downloaded ${ids.length} document${ids.length !== 1 ? "s" : ""} as ZIP` });
    } catch (err: any) {
      toast({ title: "Bulk download failed", description: err.message, variant: "destructive" });
    } finally {
      setIsBulkDownloading(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="document-vault-page">
      <PageHeader
        title="Document Vault"
        subtitle="All merchant KYC documents across all records"
        testId="text-vault-title"
        actions={
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDownload}
                disabled={isBulkDownloading}
                data-testid="button-bulk-download"
              >
                <Package className="h-4 w-4 mr-2" />
                {isBulkDownloading ? "Downloading..." : `Download ${selectedIds.size} as ZIP`}
              </Button>
            )}
            <div className="text-sm text-muted-foreground" data-testid="text-doc-count">
              {docs.length} document{docs.length !== 1 ? "s" : ""} total
            </div>
          </div>
        }
      />

      {/* Pending KYC Summary Card — quick-filter shortcut */}
      {(() => {
        const pendingKycCount = docs.filter(d => d.category === "KYC" && (!d.status || d.status === "pending")).length;
        const isKycPendingActive = categoryFilter === "KYC" && statusFilter === "pending";
        return (
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-amber-300 dark:border-amber-700 ${isKycPendingActive ? "ring-2 ring-amber-500" : ""}`}
            onClick={() => {
              if (isKycPendingActive) {
                setCategoryFilter("all");
                setStatusFilter("all");
              } else {
                setCategoryFilter("KYC");
                setStatusFilter("pending");
              }
            }}
            data-testid="card-pending-kyc"
          >
            <CardContent className="py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400" data-testid="count-pending-kyc">
                  {pendingKycCount}
                </div>
                <div className="text-xs text-muted-foreground">Pending KYC</div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Category Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {DOCUMENT_CATEGORIES.slice(0, 8).map(cat => (
          <Card
            key={cat}
            className={`cursor-pointer transition-all hover:shadow-md ${categoryFilter === cat ? "ring-2 ring-primary" : ""}`}
            onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
            data-testid={`card-category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
          >
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold" data-testid={`count-category-${cat.replace(/\s+/g, "-").toLowerCase()}`}>
                {categoryCount[cat] || 0}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{cat}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, merchant, category..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-docs"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48" data-testid="select-category-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {DOCUMENT_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {(search || categoryFilter !== "all" || statusFilter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); }}
            data-testid="button-clear-filters"
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Documents Table */}
      {docsLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground" data-testid="text-no-docs">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No documents found</p>
            <p className="text-sm mt-1">
              {search || categoryFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Documents uploaded from merchant records will appear here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-3">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all documents"
                  data-testid="checkbox-select-all"
                />
                {filtered.length} document{filtered.length !== 1 ? "s" : ""}
                {(search || categoryFilter !== "all" || statusFilter !== "all") && " matching filters"}
              </CardTitle>
              {selectedIds.size > 0 && (
                <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map(doc => {
                const statusInfo = getStatusInfo(doc.status);
                const StatusIcon = statusInfo.icon;
                return (
                  <div
                    key={doc.id}
                    className={`flex flex-wrap md:flex-nowrap items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${selectedIds.has(doc.id) ? "bg-primary/5" : ""}`}
                    data-testid={`doc-row-${doc.id}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(doc.id)}
                      onCheckedChange={() => toggleSelectDoc(doc.id)}
                      aria-label={`Select ${doc.fileName}`}
                      data-testid={`checkbox-doc-${doc.id}`}
                    />

                    <div className="shrink-0">
                      <FileIcon mimeType={doc.mimeType} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-doc-filename-${doc.id}`}>
                        {doc.fileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {doc.companyName && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-company-${doc.id}`}>
                            <Building2 className="h-3 w-3" /> {doc.companyName}
                          </span>
                        )}
                        {doc.contactName && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-contact-${doc.id}`}>
                            <User className="h-3 w-3" /> {doc.contactName}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getCategoryColor(doc.category)}`} data-testid={`badge-doc-category-${doc.id}`}>
                        {doc.category || "Other"}
                      </span>
                      <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.className}`} data-testid={`badge-doc-status-${doc.id}`}>
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                      <span className="text-xs text-muted-foreground" data-testid={`text-doc-size-${doc.id}`}>
                        {formatFileSize(doc.fileSize)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>
                        <Calendar className="h-3 w-3" /> {formatDate(doc.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Status actions (admin/manager only — enforced server-side too) */}
                      {doc.status !== 'approved' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-green-700 hover:text-green-800 hover:bg-green-50 dark:text-green-400"
                          onClick={() => statusMutation.mutate({ id: doc.id, status: 'approved' })}
                          disabled={statusMutation.isPending}
                          aria-label={`Approve ${doc.fileName}`}
                          data-testid={`button-approve-doc-${doc.id}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                      )}
                      {doc.status !== 'rejected' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-red-700 hover:text-red-800 hover:bg-red-50 dark:text-red-400"
                          onClick={() => statusMutation.mutate({ id: doc.id, status: 'rejected' })}
                          disabled={statusMutation.isPending}
                          aria-label={`Reject ${doc.fileName}`}
                          data-testid={`button-reject-doc-${doc.id}`}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                        </Button>
                      )}
                      {doc.contactId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setLocation(`/dashboard/contacts/${doc.contactId}`)}
                          aria-label={`View merchant record for ${doc.fileName}`}
                          data-testid={`button-view-merchant-${doc.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/merchant-documents/${doc.id}/access-token`, { credentials: "include" });
                            if (!res.ok) throw new Error("Failed to get access token");
                            const { url } = await res.json();
                            window.open(url, "_blank");
                          } catch {
                            toast({ title: "Download failed", description: "Could not generate download link", variant: "destructive" });
                          }
                        }}
                        aria-label={`Download ${doc.fileName}`}
                        data-testid={`button-download-doc-${doc.id}`}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:text-destructive"
                        onClick={() => setDeleteTarget(doc)}
                        aria-label={`Delete ${doc.fileName}`}
                        data-testid={`button-delete-doc-${doc.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent data-testid="dialog-confirm-delete">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <span className="font-medium text-foreground">{deleteTarget?.fileName}</span>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
