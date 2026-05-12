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
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderOpen, Search, Download, Trash2, Filter, FileText,
  FileImage, File, Calendar, User, Building2, ExternalLink,
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
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);

  const { data: docs = [], isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ["/api/merchant-documents", categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.set("category", categoryFilter);
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

  const categoryCount: Record<string, number> = {};
  docs.forEach(d => {
    const cat = d.category || "Other";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  return (
    <div className="space-y-6" data-testid="document-vault-page">
      <PageHeader
        title="Document Vault"
        subtitle="All merchant KYC documents across all records"
        testId="text-vault-title"
        actions={
          <div className="text-sm text-muted-foreground" data-testid="text-doc-count">
            {docs.length} document{docs.length !== 1 ? "s" : ""} total
          </div>
        }
      />

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
        {(search || categoryFilter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearch(""); setCategoryFilter("all"); }}
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
              {search || categoryFilter !== "all"
                ? "Try adjusting your filters"
                : "Documents uploaded from merchant records will appear here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {filtered.length} document{filtered.length !== 1 ? "s" : ""}
              {(search || categoryFilter !== "all") && " matching filters"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map(doc => (
                <div
                  key={doc.id}
                  className="flex flex-wrap md:flex-nowrap items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  data-testid={`doc-row-${doc.id}`}
                >
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
                    <span className="text-xs text-muted-foreground" data-testid={`text-doc-size-${doc.id}`}>
                      {formatFileSize(doc.fileSize)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>
                      <Calendar className="h-3 w-3" /> {formatDate(doc.createdAt)}
                    </span>
                    {doc.uploadedBy && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-uploader-${doc.id}`}>
                        <User className="h-3 w-3" /> {doc.uploadedBy}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
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
              ))}
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
