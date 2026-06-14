import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Upload, FolderOpen, Calendar, User, Download, Trash2, CheckCircle2, XCircle, Clock, Archive, AlertCircle, Plus } from "lucide-react";
import type { Document } from "@shared/schema";
import { DOCUMENT_CATEGORIES } from "@shared/schema";
import { formatDate, getDocCategoryColor, formatFileSize, DocFileIcon } from "./shared";

const MERCHANT_EXPECTED_DOCS = [
  { category: "Application", label: "Merchant Application" },
  { category: "Photo ID", label: "Government-Issued Photo ID" },
  { category: "Voided Check", label: "Voided Check / Bank Letter" },
  { category: "Processing Statement", label: "Processing Statement" },
] as const;

const PARTNER_EXPECTED_DOCS = [
  { category: "EIN Letter", label: "W9 / EIN Letter" },
  { category: "Signed Proposal", label: "Partner Agreement" },
] as const;

function getStatusInfo(status: string | null | undefined): { label: string; className: string; icon: typeof Clock } {
  switch (status) {
    case "approved": return { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", icon: CheckCircle2 };
    case "rejected": return { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", icon: XCircle };
    case "archived": return { label: "Archived", className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: Archive };
    default: return { label: "Pending", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300", icon: Clock };
  }
}

export function ContactDocumentsTab({ contactId, userRole, isPartnerContact }: { contactId: number; userRole?: string; isPartnerContact?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const placeholderInputRef = useRef<HTMLInputElement>(null);

  const [uploadCategory, setUploadCategory] = useState("Other");
  const [placeholderCategory, setPlaceholderCategory] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<Document | null>(null);

  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
  const expectedDocs = isPartnerContact ? PARTNER_EXPECTED_DOCS : MERCHANT_EXPECTED_DOCS;

  const { data: docs = [], isLoading } = useQuery<Document[]>({
    queryKey: ["/api/merchant-documents/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/merchant-documents/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/merchant-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      setDeleteDocTarget(null);
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
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      toast({ title: "Document status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const uploadFile = useCallback(async (file: File, categoryOverride?: string) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", categoryOverride || uploadCategory);
      formData.append("contactId", String(contactId));

      const uploadHeaders: Record<string, string> = {};
      const csrfUpload = getCsrfToken();
      if (csrfUpload) uploadHeaders["X-CSRF-Token"] = csrfUpload;
      const res = await fetch("/api/merchant-documents/upload", {
        method: "POST",
        headers: uploadHeaders,
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents/contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-documents"] });
      setPlaceholderCategory(null);
      toast({ title: "Document uploaded", description: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [contactId, uploadCategory, queryClient, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handlePlaceholderFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && placeholderCategory) uploadFile(file, placeholderCategory);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const uploadedCategories = new Set(docs.map(d => d.category || "Other"));
  const missingDocs = expectedDocs.filter(d => !uploadedCategories.has(d.category));

  return (
    <div className="space-y-4" data-testid="contact-documents-tab">
      {/* Missing Document Placeholders */}
      {missingDocs.length > 0 && (
        <Card className="border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              Missing Required Documents ({missingDocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {missingDocs.map(missing => (
              <div
                key={missing.category}
                className="flex items-center justify-between py-2 px-3 rounded-lg border border-dashed border-amber-200 dark:border-amber-800 bg-white dark:bg-background"
                data-testid={`placeholder-doc-${missing.category.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="font-medium">{missing.label}</span>
                  <span className="text-xs">— not yet uploaded</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-amber-300 dark:border-amber-700"
                  onClick={() => {
                    setPlaceholderCategory(missing.category);
                    placeholderInputRef.current?.click();
                  }}
                  data-testid={`button-upload-missing-${missing.category.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <Plus className="h-3 w-3 mr-1" /> Upload
                </Button>
              </div>
            ))}
            <input
              ref={placeholderInputRef}
              type="file"
              className="hidden"
              onChange={handlePlaceholderFileChange}
              accept="*/*"
              data-testid="input-placeholder-file-upload"
            />
          </CardContent>
        </Card>
      )}

      {/* Upload Zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="space-y-1">
              <label className="text-sm font-medium">Category</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="w-48" data-testid="select-upload-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept="*/*"
              data-testid="input-file-upload"
            />
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Drop file here or click to upload</p>
                <p className="text-xs text-muted-foreground">PDF, images, or any document type</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-documents">
            <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No documents uploaded yet</p>
            <p className="text-sm mt-1">Upload KYC documents using the zone above</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              {docs.length} Document{docs.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {docs.map(doc => {
                const statusInfo = getStatusInfo(doc.status);
                const StatusIcon = statusInfo.icon;
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    data-testid={`doc-item-${doc.id}`}
                  >
                    <div className="shrink-0">
                      <DocFileIcon mimeType={doc.mimeType} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-doc-name-${doc.id}`}>
                        {doc.fileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {doc.fileSize && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-doc-filesize-${doc.id}`}>
                            {formatFileSize(doc.fileSize)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>
                          <Calendar className="h-3 w-3" />
                          {formatDate(doc.createdAt)}
                        </span>
                        {doc.uploadedBy && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-doc-uploader-${doc.id}`}>
                            <User className="h-3 w-3" />
                            {doc.uploadedBy}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${getDocCategoryColor(doc.category)}`}
                        data-testid={`badge-doc-category-${doc.id}`}
                      >
                        {doc.category || "Other"}
                      </span>
                      <span
                        className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.className}`}
                        data-testid={`badge-doc-status-${doc.id}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                      {isAdminOrManager && (
                        <>
                          {doc.status !== 'approved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-green-700 hover:bg-green-50 dark:text-green-400"
                              onClick={() => statusMutation.mutate({ id: doc.id, status: 'approved' })}
                              disabled={statusMutation.isPending}
                              aria-label={`Approve ${doc.fileName}`}
                              data-testid={`button-approve-doc-${doc.id}`}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                          )}
                          {doc.status !== 'rejected' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-red-700 hover:bg-red-50 dark:text-red-400"
                              onClick={() => statusMutation.mutate({ id: doc.id, status: 'rejected' })}
                              disabled={statusMutation.isPending}
                              aria-label={`Reject ${doc.fileName}`}
                              data-testid={`button-reject-doc-${doc.id}`}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          )}
                        </>
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
                        data-testid={`button-download-${doc.id}`}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:text-destructive"
                        onClick={() => setDeleteDocTarget(doc)}
                        aria-label={`Delete ${doc.fileName}`}
                        data-testid={`button-delete-${doc.id}`}
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
      <Dialog open={!!deleteDocTarget} onOpenChange={open => !open && setDeleteDocTarget(null)}>
        <DialogContent data-testid="dialog-confirm-doc-delete">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <span className="font-medium text-foreground">{deleteDocTarget?.fileName}</span>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocTarget(null)} data-testid="button-cancel-doc-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteDocTarget && deleteDocMutation.mutate(deleteDocTarget.id)}
              disabled={deleteDocMutation.isPending}
              data-testid="button-confirm-doc-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
